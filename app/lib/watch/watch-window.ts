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
 *
 * A room can also be folded away (`collapsed`): still drawn, still in the room and still playing, only out
 * of sight, with the TV box above the music player to bring it back. Folding spends the address too, so any
 * link to the room (a `[ TV ]` key, the board's record, WEB's OPEN ROOM) is a new address again, and opening
 * the room it names unfolds it.
 */

export type WatchFocus = { kind: 'prelive'; mediaItemId: string } | { kind: 'room'; roomId: string };

export type WatchWindowState = {
  open: boolean;
  focus: WatchFocus | null;
  /** Folded away to the TV box: the room plays on out of sight. */
  collapsed: boolean;
};

const CLOSED: WatchWindowState = { open: false, focus: null, collapsed: false };

const slot = createWindowSlot<WatchWindowState>(CLOSED);

export const watchWindowState = slot.state;
/** What the server drew, for hydration: closed. A room opened before this part of the page hydrates (your music room after a reload) is drawn just after. */
export const watchWindowServerState = (): WatchWindowState => CLOSED;
export const subscribeToWatchWindow = slot.subscribe;

/**
 * Opens the window. A second open for the same purpose is no change, so nothing re-renders for it, unless
 * the room was folded away: asked for again, it comes back.
 */
export function openWatch(focus: WatchFocus): void {
  const current = slot.state();
  if (current.open && current.focus !== null && sameFocus(current.focus, focus)) {
    if (current.collapsed) slot.set({ ...current, collapsed: false });
    return;
  }

  slot.set({ open: true, focus, collapsed: false });
}

export function closeWatch(): void {
  if (slot.state().open) slot.set(CLOSED);
}

/** Folds an open room away to the TV box; it keeps playing. */
export function collapseWatch(): void {
  const current = slot.state();
  if (current.open && current.focus?.kind === 'room' && !current.collapsed) slot.set({ ...current, collapsed: true });
}

/** Brings a folded room back. */
export function expandWatch(): void {
  const current = slot.state();
  if (current.open && current.collapsed) slot.set({ ...current, collapsed: false });
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
