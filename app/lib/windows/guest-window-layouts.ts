import { readSavedLayouts, type SavedLayouts } from '../ui/window-layout';

/**
 * A guest's layouts: this browser only, one per screen shape, in local storage.
 *
 * Kept apart from the account stores on purpose. Signing in swaps to the account's layout and signing out
 * swaps back, so a guest arrangement is never written over somebody's saved one, nor the other way round.
 */
const STORAGE_KEY = 'debaser.windows.guest.v1';

export function loadGuestLayouts(): SavedLayouts | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : readSavedLayouts(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveGuestLayouts(layouts: SavedLayouts): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Storage refused: the layout lasts as long as the tab, which is still useful.
  }
}
