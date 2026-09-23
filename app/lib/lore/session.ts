import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { LoreChannelMessage, LoreRoom } from './types';

/**
 * The part of live editing that does not care where the messages come from.
 *
 * Above this line is a `Y.Doc` and an `Awareness` from the Yjs ecosystem; below it is a room that
 * can send JSON and hand back what arrives. Everything in between is here, once, so the Supabase
 * transport (./supabase-lore-repository.ts) and the between-tabs one (./mock-lore-repository.ts)
 * cannot drift apart in the parts that matter: when to ask for the document, what to answer with,
 * and when a peer counts as gone.
 *
 * The handshake, in three steps:
 *
 *   1. a joiner broadcasts `sync-request` and puts its own presence on the wire;
 *   2. whoever is already there answers that peer alone with the whole document as one update, so
 *      the joiner merges it into what it already had instead of replacing it;
 *   3. every change after that is one `update` per change, applied on arrival.
 *
 * Two tabs typing at once therefore both keep typing: Yjs merges the two runs of edits on both
 * sides, which is the reason for a CRDT rather than a save button one of them would lose.
 */

export type LorePeer = {
  clientId: number;
  /** The account's display name, as it rides on the caret. */
  name: string;
  colour: string;
  /** True for the tab reading this page. */
  self: boolean;
};

/** What the room's own line says: asking, in the room with others, or here alone. */
export type LoreStatus = 'SYNCING' | 'LIVE' | 'ALONE';

/** Who a tab is on the wire: the name that rides on its caret, and the colour that caret is drawn in. */
export type LoreIdentity = { name: string; colour: string };

/**
 * That identity as the awareness state everyone reads.
 *
 * The colour is written twice, under both spellings, because two readers want different ones:
 * this site's own code (and everything it prints) says `colour`, while the caret extension that
 * draws the cursor reads `color` and falls back to a transparent caret for anything it does not
 * recognise as a hex. One field, two keys, so neither reader has to care which wrote it.
 */
export function lorePresence(identity: LoreIdentity): Record<string, string> {
  return { name: identity.name, colour: identity.colour, color: identity.colour };
}

export type LoreSession = {
  /** Everyone in the room, this tab first, then the others by name. */
  peers: () => LorePeer[];
  onPeers: (handler: (peers: LorePeer[]) => void) => () => void;
  status: () => LoreStatus;
  onStatus: (handler: (status: LoreStatus) => void) => () => void;
  /** Leaves the room: drops this tab's presence, tells the others, and lets go of the channel. */
  destroy: () => void;
};

type LoreSessionOptions = {
  room: LoreRoom;
  doc: Y.Doc;
  awareness: Awareness;
  user: LoreIdentity;
};

/** How long a joiner waits for an answer before deciding it is the only one here. */
const SYNC_WINDOW_MS = 1500;

/** How often this tab repeats its own presence, so the others never age it out. */
const HEARTBEAT_MS = 10_000;

/**
 * Bytes to text and back.
 *
 * Base64 rather than an array of numbers: every transport here carries JSON, and a page's whole
 * state in base64 is a few kilobytes where a number array would be several times that. The
 * chunking is only so a large document does not go through `String.fromCharCode` in one call.
 */
const BASE64_CHUNK = 0x2000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/**
 * Joins a page's room and keeps the document in step with everybody else in it.
 *
 * The session owns four listeners and two timers, and `destroy` is the only way to let go of
 * them - which is what the editor's own cleanup calls when the reader walks away from the page.
 */
export function createLoreSession({ room, doc, awareness, user }: LoreSessionOptions): LoreSession {
  const peerListeners = new Set<(peers: LorePeer[]) => void>();
  const statusListeners = new Set<(status: LoreStatus) => void>();
  let status: LoreStatus = 'SYNCING';
  let destroyed = false;

  awareness.setLocalStateField('user', lorePresence(user));

  const readPeers = (): LorePeer[] => {
    const peers: LorePeer[] = [];

    awareness.getStates().forEach((state, clientId) => {
      const identity = state.user as { name?: string; colour?: string } | undefined;

      peers.push({
        clientId,
        name: typeof identity?.name === 'string' && identity.name.length > 0 ? identity.name : 'SOMEONE',
        colour: typeof identity?.colour === 'string' ? identity.colour : '#000080',
        self: clientId === doc.clientID,
      });
    });

    return peers.sort((left, right) => {
      if (left.self) return -1;
      if (right.self) return 1;

      return left.name.localeCompare(right.name);
    });
  };

  const publish = (): void => {
    const peers = readPeers();
    for (const listener of peerListeners) listener(peers);
  };

  const setStatus = (next: LoreStatus): void => {
    if (status === next) return;

    status = next;
    for (const listener of statusListeners) listener(next);
  };

  /** This tab's own presence, repeated on a timer so the others never mark it gone. */
  const announce = (): void => {
    room.send({
      kind: 'awareness',
      from: doc.clientID,
      update: bytesToBase64(encodeAwarenessUpdate(awareness, [doc.clientID])),
    });
  };

  /** A change to this tab's document: one message, and everybody listening merges it. */
  const onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (destroyed || origin === 'remote') return;

    room.send({ kind: 'update', from: doc.clientID, update: bytesToBase64(update) });
  };

  /** A change to who is here: this tab's own state is what the others need to hear about. */
  const onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (destroyed) return;

    publish();

    if (origin === 'remote') return;

    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;

    room.send({
      kind: 'awareness',
      from: doc.clientID,
      update: bytesToBase64(encodeAwarenessUpdate(awareness, changed)),
    });
  };

  const onMessage = (message: LoreChannelMessage): void => {
    if (destroyed || message.from === doc.clientID) return;

    switch (message.kind) {
      case 'sync-request': {
        // Somebody has just arrived: hand them the whole document, and them alone.
        room.send({
          kind: 'sync-response',
          from: doc.clientID,
          to: message.from,
          state: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        });
        announce();
        return;
      }

      case 'sync-response': {
        // An answer to this tab's own request, and nobody else's.
        if (message.to !== doc.clientID) return;

        Y.applyUpdate(doc, base64ToBytes(message.state), 'remote');
        setStatus('LIVE');
        announce();
        return;
      }

      case 'update': {
        Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
        setStatus('LIVE');
        return;
      }

      case 'awareness': {
        const before = awareness.getStates().size;
        applyAwarenessUpdate(awareness, base64ToBytes(message.update), 'remote');

        // Somebody arriving is enough to say the room is shared, caret or no caret.
        if (awareness.getStates().size > before) setStatus('LIVE');
        return;
      }

      case 'gone': {
        removeAwarenessStates(awareness, [message.from], 'remote');
        return;
      }
    }
  };

  doc.on('update', onDocUpdate);
  awareness.on('update', onAwarenessUpdate);
  const stopListening = room.listen(onMessage);

  // Ask for the document, and say who is here.
  room.send({ kind: 'sync-request', from: doc.clientID });
  announce();

  // Bare timers rather than `window.*`: a session is a document and a room, and nothing about it is
  // the browser's - which is what lets the same code be run headless in a check.
  const syncWindow: ReturnType<typeof setTimeout> = setTimeout(() => {
    // Nobody answered: this page is open here and nowhere else. Still joined, so anybody arriving
    // later is heard - they ask, and this tab answers.
    if (status === 'SYNCING') setStatus('ALONE');
  }, SYNC_WINDOW_MS);

  const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
    announce();
    publish();
  }, HEARTBEAT_MS);

  publish();

  return {
    peers: readPeers,
    onPeers: (handler) => {
      peerListeners.add(handler);
      handler(readPeers());

      return () => void peerListeners.delete(handler);
    },
    status: () => status,
    onStatus: (handler) => {
      statusListeners.add(handler);
      handler(status);

      return () => void statusListeners.delete(handler);
    },
    destroy: () => {
      if (destroyed) return;

      destroyed = true;
      clearTimeout(syncWindow);
      clearInterval(heartbeat);
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      stopListening();

      // Tell the room this tab is leaving before letting go of the channel. A message lost in the
      // last moment is not a problem: a presence that is never repeated goes stale on its own.
      const removal = encodeAwarenessUpdate(awareness, [doc.clientID]);
      awareness.setLocalState(null);
      room.send({ kind: 'awareness', from: doc.clientID, update: bytesToBase64(removal) });
      room.send({ kind: 'gone', from: doc.clientID });
      room.close();
    },
  };
}

