import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

/**
 * Where a reader stopped in the comic, `<chapter>/<page>` (SPEC-comic.md, CONTINUE): kept in this browser, and synced to the
 * account like the site's other settings (`comicPlace` in the settings bus), so both of a reader's computers agree.
 */

export const PLACE_KEY = 'debaser.site.comic.place';

export function readPlace(): string | null {
  try {
    return window.localStorage.getItem(PLACE_KEY);
  } catch {
    return null;
  }
}

/** Keeps the place, and tells the account sync when it changed. */
export function writePlace(value: string): void {
  try {
    if (window.localStorage.getItem(PLACE_KEY) === value) return;
    window.localStorage.setItem(PLACE_KEY, value);
    noteSettingChanged('comicPlace');
  } catch {
    // A storage that throws (a private window): CONTINUE just won't know.
  }
}

/** Hears the place change: in another tab, or when the account's copy arrives. */
export function subscribePlace(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  const unhook = subscribeToAccountSettings(listener);
  return () => {
    window.removeEventListener('storage', listener);
    unhook();
  };
}
