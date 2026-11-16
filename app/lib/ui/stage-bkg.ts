/**
 * `[ BKG ]`: whether a fullscreen video is dressed (SPEC-rooms-your-room.md, part 4; Luke, 2026-11-16: "have it be a toggle
 * called bkg which appears inside of the bar/backround in the top left corner of it similar to the backround settings
 * button").
 *
 * On (how everybody starts): the picture is the video's own shape with its black bars trimmed off, and the chosen
 * background runs round it. Off: the video as its player shows it, black bars and all, nothing trimmed. It is also the way
 * out when the bars were judged wrong and picture was cut.
 *
 * Kept in this browser only, like the background itself. A plain store of its own, not a window slot: the top bar's undo
 * arrows hear every window slot's writes, and this is no window.
 */
const STORAGE_KEY = 'debaser.site.stage-bkg.v1';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // No storage (private mode, blocked cookies): on, as everybody starts.
    return true;
  }
}

let on = typeof window === 'undefined' ? true : readStored();
const listeners = new Set<() => void>();

/** Whether a fullscreen video is dressed, for `useSyncExternalStore`. */
export function stageBkgOn(): boolean {
  return on;
}

/** What the server draws with: on. Nothing of this shows until something is fullscreen, which only a browser can be. */
export function stageBkgOnServer(): boolean {
  return true;
}

export function subscribeToStageBkg(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setStageBkg(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // It still applies for this visit; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

export function toggleStageBkg(): void {
  setStageBkg(!on);
}
