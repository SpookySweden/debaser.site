import { createWindowSlot } from '../ui/window-slot';

/**
 * The preferences window, as a window beside the board.
 *
 * It is a module-level slot rather than a piece of state in the side panel for the reason every other
 * utility window is: the panel's own menu is drawn by `SidebarProfile`, which re-renders when the
 * session moves, and a window whose open state lived there would be closed by a session change. It
 * also means the window can be drawn once at the shell and no page has to know about it.
 *
 * There is no address, deliberately, and it is the one utility window that has none. The arcade, the
 * archive and a conversation are all places a reader arrives at from a link somebody sent them, so
 * they each have a URL to be sent. A theme is a setting on *this browser*: a link to "open somebody
 * else's preferences" would promise to change their colours and would not, which is worse than a
 * window you can only open from the panel you are standing in.
 */

export type PreferencesWindowState = {
  open: boolean;
};

/** Shut. One shared object, so React can compare it by identity. */
const SHUT: PreferencesWindowState = { open: false };

const slot = createWindowSlot<PreferencesWindowState>(SHUT);

/** The window as it is now, for `useSyncExternalStore`. */
export const preferencesWindowState = slot.state;

/** Draws from the window: the listener fires when it opens or closes. */
export const subscribeToPreferencesWindow = slot.subscribe;

export function openPreferences(): void {
  slot.set({ open: true });
}

export function closePreferences(): void {
  if (slot.state().open) slot.set(SHUT);
}

/**
 * A press on the panel's `[ PREFERENCES ]` row: open when shut, close when open.
 *
 * The same switch the shelf keys keep, and for the same reason - the row sits on the screen the window
 * is drawn over, so a reader who is finished presses the row again rather than hunting for the
 * window's `[ CLOSE ]`. `Temp/check-preferences.cjs` holds it.
 */
export function togglePreferences(): void {
  if (slot.state().open) closePreferences();
  else openPreferences();
}
