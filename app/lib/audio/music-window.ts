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
  /**
   * Which of the two screens is on: the shared archive, or the reader's own music.
   *
   * It lives in the window's state rather than in a component's `useState` because the *address* decides
   * it (`?music=1` opens the archive, `?music=mine` opens the personal shelf) and the two have to agree:
   * a screen held in local state would ignore the second half of a link, and a link that half-works is
   * worse than one that does not.
   */
  screen: MusicScreen;
};

export type MusicScreen = 'archive' | 'mine';

/** Shut, on the archive. One shared object, so React can compare it by identity. */
const SHUT: MusicWindowState = { open: false, screen: 'archive' };

const slot = createWindowSlot<MusicWindowState>(SHUT);

/** The window as it is now, for `useSyncExternalStore`. */
export const musicWindowState = slot.state;

/** Draws from the window: the listener fires when it opens or closes. */
export const subscribeToMusicWindow = slot.subscribe;

/** The archive's address: the board, so the reader keeps the thread they were on. */
export const MUSIC_HREF = '/forum?music=1';

/** The reader's own music, as its own address: a link somebody can be sent, and a screen that survives a reload. */
export const LIBRARY_HREF = '/forum?music=mine';

/**
 * Opens the window, on one screen or the other.
 *
 * The screen is a parameter rather than a separate opener because they are the same window: a reader
 * switching between them should not see the frame close and reopen, which is what two openers would give
 * them. Defaulting to the archive keeps every existing caller - the MUSIC shelf, a post's plate, a tag
 * badge - working unchanged.
 */
export function openMusic(screen: MusicScreen = 'archive'): void {
  slot.set({ open: true, screen });
}

export function closeMusic(): void {
  if (slot.state().open) slot.set(SHUT);
}

/** Switches screens while the window stays open. */
export function showMusicScreen(screen: MusicScreen): void {
  if (slot.state().open && slot.state().screen !== screen) slot.set({ open: true, screen });
}

/**
 * A press on the archive's own key: opening when shut, closing when open.
 *
 * The side panel's key is a *switch* - it sits on the screen the archive is drawn over, so a reader
 * who has finished with it presses the same key again rather than hunting for the window's
 * `[ X CLOSE ]`. This is that answer, and this is the only door that answers this way.
 *
 * What it deliberately is not is the behaviour of a *link* into the archive. A tag badge, the Start
 * menu's MUSIC shelf and a post's `♪ MP3` plate are addresses a reader follows from somewhere else -
 * possibly from a screen with no key of its own - and a link that closed the window when it was
 * already open would be a link that sometimes does nothing visible. Those keep `openMusic`, which
 * only ever opens. The distinction is the same one the arcade keeps between its own key and its
 * invitations, and `Temp/check-flows.cjs` holds both to it.
 */
export function toggleMusic(): void {
  if (slot.state().open) closeMusic();
  else openMusic();
}

/**
 * Whether the address still needs spending when the window closes.
 *
 * The board plate opens the archive without touching the URL, so a press that closes it has nothing
 * to clear. The side panel's key opens it by *following the address* (`/forum?music=1`), so once the
 * window is shut that address is a lie - and worse, it is one the effect below would read again the
 * next time anything re-ran it. Clearing it is what keeps the same key working twice.
 */
export function musicAddressSpentByClose(search: string): boolean {
  return musicRequested(search);
}

/** Whether an address asks for the archive. A query about anything else opens nothing. */
export function musicRequested(search: string): boolean {
  return new URLSearchParams(search).get('music') !== null;
}

/**
 * Which screen an address asks for.
 *
 * `?music=1` is the archive, which is every link that existed before there were two screens - so it has
 * to keep meaning the archive rather than becoming ambiguous. `?music=mine` is the reader's own music.
 * Anything else (`?music=0`, `?music=yes`) is still a request, because the presence of the parameter is
 * what opens the window; it simply names no screen, so the archive is what shows.
 */
export function musicScreenRequested(search: string): MusicScreen {
  return new URLSearchParams(search).get('music') === 'mine' ? 'mine' : 'archive';
}
