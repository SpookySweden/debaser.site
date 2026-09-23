import { createWindowSlot } from '../ui/window-slot';

/**
 * The music archive as a window beside the board.
 *
 * The archive used to be a page of its own (`/music`), and the cost of that was the thing this site
 * can least afford: a reader following a thread who wants to check what a track was called had to
 * leave the thread to do it. It is a window now - drawn once in `layout.tsx`, docked beside the feed,
 * draggable by its title bar - so the thread being read is always still on screen.
 *
 * It is one address, the board's, the same way the arcade's is:
 *
 *   /forum?music=1        open the archive (the MUSIC shelf, a track's tag badge, a post's plate)
 *   /forum?music=1&tag=…  open it already filtered, which is what a tag badge means
 *
 * `tag` is the directory's own business (`MusicDirectory` reads it), so this module only answers the
 * one question the window is: was it asked for? A state that lives in a module rather than in a
 * provider is what keeps the board from re-rendering when the archive is opened, filtered or closed.
 */

export type MusicWindowState = {
  open: boolean;
};

/** Shut. One shared object, so React can compare it by identity. */
const SHUT: MusicWindowState = { open: false };

const slot = createWindowSlot<MusicWindowState>(SHUT);

/** The window as it is now, for `useSyncExternalStore`. */
export const musicWindowState = slot.state;

/** Draws from the window: the listener fires when it opens or closes. */
export const subscribeToMusicWindow = slot.subscribe;

/** The archive's address: the board, so the reader keeps the thread they were on. */
export const MUSIC_HREF = '/forum?music=1';

export function openMusic(): void {
  slot.set({ open: true });
}

export function closeMusic(): void {
  if (slot.state().open) slot.set(SHUT);
}

/** Whether an address asks for the archive. A query about anything else opens nothing. */
export function musicRequested(search: string): boolean {
  return new URLSearchParams(search).get('music') !== null;
}
