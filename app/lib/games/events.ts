import { GAME_CATALOGUE } from './catalogue';
import type { CommsEvent, CommsEventKind } from '../comms/types';

/**
 * A game event, written down as the line a reader sees.
 *
 * The words live here rather than in the screen for the same reason the address of a window lives with
 * the window: the mock store and Supabase both file what this returns, so a thread reads identically
 * whichever store it came out of, and a fourth kind of event is a fourth case here rather than a fourth
 * `if` somewhere in a component.
 *
 * Every line is written from the *thread's* point of view, not the reader's, because one row is read by
 * two accounts. "CHALLENGED :: TIC-TAC-TOE" is true for both of them; "challenged you" would be true
 * for one and a lie for the other. Who did it is already on the row - the message is signed, like every
 * other message - so the line does not have to repeat it.
 */
export function commsEventBody(kind: CommsEventKind, game: string): string {
  const title = gameTitle(game);

  switch (kind) {
    case 'invite':
      return `CHALLENGED :: ${title}`;
    case 'answer':
      return `CHALLENGE ANSWERED :: ${title}`;
    case 'cancel':
      return `CHALLENGE CALLED OFF :: ${title}`;
  }
}

/**
 * The game's name as a sentence can carry it.
 *
 * Read from `GAME_CATALOGUE` rather than through `gameById`, which is the one thing this must not use:
 * `gameById` falls back to the *first* game, so an id this build does not know would be filed as a
 * challenge at Tic-Tac-Toe - a wrong fact, silently, in a permanent record. A game that cannot be found
 * falls back to its own id in capitals, because a plate that says `CHALLENGED :: ` and stops has lost
 * the one thing it was there to say.
 */
export function gameTitle(game: string): string {
  return GAME_CATALOGUE.find((entry) => entry.id === game)?.title ?? game.toUpperCase();
}

/** Builds the whole event, so no caller has to remember which three fields go together. */
export function gameEvent(kind: CommsEventKind, gameId: string, inviteId: string): CommsEvent {
  return { kind, gameId, inviteId };
}

/**
 * What an event's plate says.
 *
 * These are the *reader's* words rather than the thread's, because a plate is a label on a row rather
 * than a sentence one account said to another - and because a plate can be read by a third account in a
 * group, for whom "you were challenged" would be false.
 */
export const EVENT_LABELS: Record<CommsEventKind, string> = {
  invite: '[ GAME CHALLENGE ]',
  answer: '[ CHALLENGE ANSWERED ]',
  cancel: '[ CHALLENGE CANCELLED ]',
};
