import { createWindowSlot } from '../ui/window-slot';
import { GAME_IDS, isGameId, type GameId } from './types';

/**
 * The arcade as a window: which one is open, and what it was opened to do.
 *
 * A desktop has one arcade, and it is not a page. Opening it from the board, from an account's name
 * or from the bell has to leave the reader where they were reading, so the thing being opened is a
 * window over the page - and what is being opened is this: one small store, the way the profile
 * cache is one small store (`lib/profile/profile-cache.ts`), with the window itself drawn once in
 * `layout.tsx` (./components/ArcadeWindow.tsx).
 *
 * The address is the other way in, and it is deliberately three different questions:
 *
 *   /forum?arcade=1                             the floor - the header key and the Start menu row
 *   /forum?invite=<inviteId>                    one invitation, answered on arrival (the bell)
 *   /forum?challenge=<userId>&game=<gameId>     one account, asked for a game (a post's plate)
 *
 * `?game` is read through `isGameId`, so a hand-written link cannot ask for a game the arcade does
 * not have; anything else falls back to the catalogue's first. Nothing is pushed or replaced in the
 * address when a plate opens the window: the URL is a way *in*, and a link that still says what it
 * meant is honest.
 */

/** The game a challenge starts on: the catalogue's first, so a third game can lead the list. */
export const ARCADE_DEFAULT_GAME: GameId = GAME_IDS[0];

/** What the window is for. */
export type ArcadeFocus =
  | { kind: 'floor' }
  | { kind: 'invite'; inviteId: string }
  /** The opponent by id: the name is read from the directory where it is drawn. */
  | { kind: 'challenge'; opponentId: string; game: GameId };

export type ArcadeWindowState = {
  open: boolean;
  /** What it is for, while it is open. */
  focus: ArcadeFocus;
};

/** Shut, on the floor. One shared object, so React can compare it by identity. */
const CLOSED: ArcadeWindowState = { open: false, focus: { kind: 'floor' } };

const slot = createWindowSlot<ArcadeWindowState>(CLOSED);

/** The window as it is now, for `useSyncExternalStore`. */
export const arcadeWindowState = slot.state;

/** Draws from the window: the listener fires when it opens, changes purpose or closes. */
export const subscribeToArcadeWindow = slot.subscribe;

/** Opens the arcade, on the floor unless it was opened to do something. */
export function openArcade(focus: ArcadeFocus = { kind: 'floor' }): void {
  slot.set({ open: true, focus });
}

export function closeArcade(): void {
  if (arcadeWindowState().open) slot.set(CLOSED);
}

/** The link to a window, so nav rows, legend links and the bell all spell it the same way. */
export function arcadeHref(focus: ArcadeFocus): string {
  switch (focus.kind) {
    case 'invite':
      return `/forum?invite=${encodeURIComponent(focus.inviteId)}`;
    case 'challenge':
      return `/forum?challenge=${encodeURIComponent(focus.opponentId)}&game=${focus.game}`;
    default:
      return '/forum?arcade=1';
  }
}

/**
 * A press on the arcade's own key: opening it when shut, closing it when open.
 *
 * The board's plate and the side panel's key are *switches* - both sit on the screen the arcade is
 * drawn over, so a reader who has finished with it presses the same key again rather than hunting for
 * the window's `[ X CLOSE ]`. This is that answer, in one place, so the two doors cannot disagree.
 *
 * Two things it is deliberately not.
 *
 * It is not the behaviour of an *invitation* or a *challenge*. Those arrive as addresses from
 * somewhere else - the bell, a post's plate - and they carry a `focus` saying what the arcade was
 * opened to do (see `ArcadeFocus`). A toggle has no focus to offer: a second press would either
 * re-open the floor over the game in progress, or do nothing visible. So a focused open stays a
 * focused open, and only ever opens.
 *
 * It is not a toggle *to* the floor either. `toggleArcade` opens on the floor when shut, which is
 * what the key means, and closes whatever is open when open - a challenge on screen and a press on
 * the key is a reader leaving the arcade, not a reader asking for a different game.
 */
export function toggleArcade(): void {
  if (arcadeWindowState().open) closeArcade();
  else openArcade();
}

/**
 * Whether the address still needs spending when the arcade closes.
 *
 * The key opens the arcade by *following* an address (`/forum?arcade=1`), and an invitation or a
 * challenge does the same (`?invite=`, `?challenge=&game=`). Once the window is shut that address is
 * a lie, and worse, it is one the effect in ./components/ArcadeWindow.tsx would read again the next
 * time it ran - reopening the thing the reader just closed. All three shapes are recognised here, so
 * clearing the address is one question rather than three.
 */
export function arcadeAddressSpentByClose(search: string): boolean {
  return arcadeFocusFromSearch(search) !== null;
}

/** What an address asks for, or null for an address that says nothing about the arcade. */
export function arcadeFocusFromSearch(search: string): ArcadeFocus | null {
  const params = new URLSearchParams(search);

  const inviteId = params.get('invite');
  if (inviteId !== null && inviteId.length > 0) return { kind: 'invite', inviteId };

  const opponentId = params.get('challenge');
  if (opponentId !== null && opponentId.length > 0) {
    const game = params.get('game');

    return { kind: 'challenge', opponentId, game: isGameId(game) ? game : ARCADE_DEFAULT_GAME };
  }

  return params.get('arcade') === null ? null : { kind: 'floor' };
}
