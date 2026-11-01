import { createWindowSlot } from '../ui/window-slot';

/**
 * The stream room as a window: built and read here, the way the arcade's is (`lib/games/arcade-window.ts`).
 *
 * Two addresses, two purposes (SPEC-watch-together.md):
 *
 *   /forum?watch=new&media=<itemId>    the host's window before going live: the file loaded, GO LIVE
 *   /forum?watch=<roomId>              a room, to watch or to host
 *
 * The window is drawn once in `layout.tsx`, so a stream keeps playing while the reader walks the site.
 * Going live swaps the first purpose for the second in the store; the address is spent on close.
 */

export type WatchFocus = { kind: 'prelive'; mediaItemId: string } | { kind: 'room'; roomId: string };

export type WatchWindowState = {
  open: boolean;
  focus: WatchFocus | null;
};

const CLOSED: WatchWindowState = { open: false, focus: null };

const slot = createWindowSlot<WatchWindowState>(CLOSED);

export const watchWindowState = slot.state;
export const subscribeToWatchWindow = slot.subscribe;

/** Opens the window. A second open for the same purpose is no change, so nothing re-renders for it. */
export function openWatch(focus: WatchFocus): void {
  const current = slot.state();
  if (current.open && current.focus !== null && sameFocus(current.focus, focus)) return;

  slot.set({ open: true, focus });
}

export function closeWatch(): void {
  if (slot.state().open) slot.set(CLOSED);
}

function sameFocus(a: WatchFocus, b: WatchFocus): boolean {
  if (a.kind === 'room' && b.kind === 'room') return a.roomId === b.roomId;
  if (a.kind === 'prelive' && b.kind === 'prelive') return a.mediaItemId === b.mediaItemId;
  return false;
}

/** The link to a room, so the `[ TV ]` key, the forum record and the archive spell it the same way. */
export function watchHref(focus: WatchFocus): string {
  return focus.kind === 'prelive'
    ? `/forum?watch=new&media=${encodeURIComponent(focus.mediaItemId)}`
    : `/forum?watch=${encodeURIComponent(focus.roomId)}`;
}

/** What an address asks for, or null for one that says nothing about a stream. */
export function watchFocusFromSearch(search: string): WatchFocus | null {
  const params = new URLSearchParams(search);
  const watch = params.get('watch');
  if (watch === null || watch.length === 0) return null;

  if (watch === 'new') {
    const media = params.get('media');
    return media === null || media.length === 0 ? null : { kind: 'prelive', mediaItemId: media };
  }

  return { kind: 'room', roomId: watch };
}
