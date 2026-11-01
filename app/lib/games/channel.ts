import { getSupabaseBrowserClient } from '../supabase/client';
import type { Board, Mark } from './tic-tac-toe';
import type { DuelSide, DuelState } from './paddle-duel';

/**
 * The wire a match runs on: two browsers, one channel, no server of our own.
 *
 * An invitation names a game, and the two accounts who own it are the only ones who know the
 * channel's name (`match:<invite id>`), so the match is private by obscurity of an id rather than by
 * a rule - which is the right trade here, because nothing written on this wire is kept. Realtime
 * broadcast is exactly that: messages passed between the clients that are in the room, with no row
 * written and no read policy to get wrong.
 *
 * Two games, two shapes of traffic, one message type:
 *
 *   tic-tac-toe   a move is `{ cell, mark }`, and both sides apply it to the board they already
 *                 hold with the same rule (./tic-tac-toe.ts). Nobody is the authority, which is
 *                 safe because a move either fits the board or is refused by the receiver.
 *   paddle duel   the host runs the arithmetic and sends the whole state; the guest sends only where
 *                 its paddle wants to be. One authority, so the two courts cannot disagree.
 *
 * The mock store cannot reach another browser, so with it the channel is this browser's own
 * `BroadcastChannel`: two tabs of the same site can play together, which is enough to walk the flow
 * without a project. With neither, the channel is quiet and the match says the other side is not
 * answering rather than pretending.
 */

export type GameMessage =
  | { kind: 'hello'; name: string }
  | { kind: 'move'; cell: number; mark: Mark }
  | { kind: 'board'; board: Board }
  | { kind: 'state'; state: DuelState }
  | { kind: 'paddle'; side: DuelSide; y: number; name: string }
  | { kind: 'bye' };

export type GameChannel = {
  /** Sends one message to whoever else is in the room. */
  send(message: GameMessage): void;
  /** Every message from the other side, until the returned function is called. */
  subscribe(listener: (message: GameMessage) => void): () => void;
  close(): void;
};

const EVENT = 'game';

/** The room's name: an invitation, and nothing else. */
export function matchChannelName(inviteId: string): string {
  return `match:${inviteId}`;
}

/**
 * The channel for one match.
 *
 * Built on demand and closed with the screen, so a player who walks away is not left subscribed.
 * Broadcast carries our own messages back to us by default, so `self: false` is set: a move this
 * client made is already on its own board, and hearing it twice would apply it twice.
 */
export function createGameChannel(inviteId: string, onStatus?: (status: string) => void): GameChannel {
  const topic = matchChannelName(inviteId);
  const client = getSupabaseBrowserClient();

  if (client === null) return createLocalChannel(topic);

  const channel = client.channel(topic, { config: { broadcast: { self: false } } });
  const listeners = new Set<(message: GameMessage) => void>();

  channel.on('broadcast', { event: EVENT }, (message) => {
    const payload = (message as { payload?: GameMessage }).payload;
    if (payload === undefined) return;

    for (const listener of listeners) listener(payload);
  });

  channel.subscribe((status) => onStatus?.(status));

  return {
    send: (message) => {
      void channel.send({ type: 'broadcast', event: EVENT, payload: message });
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      void client.removeChannel(channel);
    },
  };
}

/**
 * The same channel inside one browser, for a project on the mock store.
 *
 * `BroadcastChannel` is in every browser this site supports; where it is not, the channel is quiet
 * and the match plays on with one player, which is what solo mode is.
 */
function createLocalChannel(topic: string): GameChannel {
  if (typeof BroadcastChannel === 'undefined') return createQuietChannel();

  const wire = new BroadcastChannel(`debaser.${topic}`);
  const listeners = new Set<(message: GameMessage) => void>();

  wire.onmessage = (event: MessageEvent<GameMessage>) => {
    for (const listener of listeners) listener(event.data);
  };

  return {
    send: (message) => wire.postMessage(message),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      wire.close();
    },
  };
}

function createQuietChannel(): GameChannel {
  return {
    send: () => undefined,
    subscribe: () => () => undefined,
    close: () => undefined,
  };
}
