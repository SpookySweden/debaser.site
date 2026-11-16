import type { AudioTrack } from './tracks';

/**
 * LOVE BUZZ on arrival (Luke, 2026-11-16: "on loading the website play love buzz on loop quietly in the music player").
 * Pure, so a check can walk every rule; the component that acts on it is `app/components/LoveBuzzOnArrival.tsx`.
 *
 * - It is in the site's music already: the shelf holds the same file twice (both uploaded by sweden on 2026-09-25), one
 *   titled "LOVE BUZZ - UPLOAD TEST", the other retitled "KIVE - WU TANG". The one whose title says LOVE BUZZ is chosen;
 *   failing that, a file named love-buzz.
 * - **Once a visit** (this browser tab, `sessionStorage`): the first page of a visit loads it, looping, at a quiet volume.
 *   A reload or the next page in the same tab never loads it again, so a reader who stopped it is not started again.
 * - Browsers refuse sound before the reader touches the page, so it starts on the first click or key press, a moment
 *   after it, and only if by then nothing else is playing: not the bar (the reader pressed PLAY on it, or on another
 *   song), not a video, not a room, and the bar still holds LOVE BUZZ.
 */

/** Where the visit remembers that it has already been greeted. */
export const LOVE_BUZZ_KEY = 'debaser.audio.love-buzz.v1';

/** The quiet volume it arrives at, 0 to 1. A louder saved volume is lowered to this; a quieter one is kept. */
export const QUIET_VOLUME = 0.25;

/** How long after the first click or key press it waits, so whatever that press started is seen first. */
export const START_DELAY_MS = 400;

/** LOVE BUZZ on the shelf, or undefined when the shelf does not hold it. */
export function findLoveBuzz(queue: readonly AudioTrack[]): AudioTrack | undefined {
  return (
    queue.find((track) => /^\s*love\s*buzz\b/i.test(track.title)) ??
    queue.find((track) => /(?:^|\/)love-buzz[^/]*\.(?:wav|mp3|ogg|flac|m4a)$/i.test(track.src))
  );
}

/** What the visit has done about it: nothing yet, loaded and waiting for a touch, started, or let go. */
export type ArrivalMark = 'loaded' | 'started' | 'skipped';

export function readArrival(storage: Pick<Storage, 'getItem'> | null): ArrivalMark | null {
  try {
    const value = storage?.getItem(LOVE_BUZZ_KEY) ?? null;
    return value === 'loaded' || value === 'started' || value === 'skipped' ? value : null;
  } catch {
    return null;
  }
}

export function writeArrival(storage: Pick<Storage, 'setItem'> | null, mark: ArrivalMark): void {
  try {
    storage?.setItem(LOVE_BUZZ_KEY, mark);
  } catch {
    // Storage blocked: it holds for this page only.
  }
}

/** What else may be playing or asking for the bar when the page arrives, or when the first press comes. */
export type Busy = {
  /** The bar is playing (anything). */
  playing: boolean;
  /** A video, a picture or an outside player is on the site's screen (the floating player). */
  screen: boolean;
  /** A live room has the bar, or a room's window is open. */
  room: boolean;
  /** The reader is following somebody's queue. */
  following: boolean;
};

function busy(state: Busy): boolean {
  return state.playing || state.screen || state.room || state.following;
}

/**
 * On arrival, once the shelf has been read: `load` it (looping, quiet) the first time in a visit when nothing else holds
 * the bar; `skip` (and remember) when something does or the shelf has no LOVE BUZZ; `wait` while the shelf is still being
 * read; `none` when the visit already settled it.
 */
export function arrivalStep(mark: ArrivalMark | null, shelfRead: boolean, found: boolean, state: Busy): 'load' | 'skip' | 'wait' | 'none' {
  if (mark !== null) return 'none';
  if (!shelfRead) return 'wait';
  if (!found || busy(state)) return 'skip';
  return 'load';
}

/** At the first press (a moment after it): start it only if it was loaded, the bar still holds it, and nothing else plays. */
export function startOnPress(mark: ArrivalMark | null, holdsLoveBuzz: boolean, state: Busy): boolean {
  return mark === 'loaded' && holdsLoveBuzz && !busy(state);
}

/** The volume it arrives at: the reader's own when it is already quiet, else `QUIET_VOLUME`. */
export function arrivalVolume(saved: number): number {
  return Number.isFinite(saved) ? Math.min(saved, QUIET_VOLUME) : QUIET_VOLUME;
}
