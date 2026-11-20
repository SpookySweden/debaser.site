/**
 * Settings that follow the account (SPEC-forum-v3.md, F1B and F2A): the small meeting point between each setting's own
 * code and the account sync (`./account-settings.ts`). Kept free of imports on purpose: the theme, cursor and background
 * slots load it, and they are read while `layout.tsx` is drawn on the server, so nothing here may pull in the database.
 *
 * Each setting still lives where it always did, as one key in this browser's storage. A setting's own code tells this bus
 * when the reader changed it (`noteSettingChanged`), and listens for the account's choices having been written into the
 * browser's storage (`subscribeToAccountSettings`), when it reads its key again.
 */

/** Which of the browser's keys follow the account, by the short name they are saved under in `user_settings.settings`. */
export const SYNCED_KEYS = {
  theme: 'debaser.site.theme.v2',
  cursor: 'debaser.site.cursor.v2',
  backdrop: 'debaser.site.backdrop.v2',
  forumPlace: 'debaser.forum.board.v1',
  forumSort: 'debaser.forum.sort',
  wirePaused: 'debaser.forum.wire-paused.v1',
  hideMade: 'debaser.forum.hide-made.v1',
  mediaFolds: 'debaser.media.filter-folds.v1',
  mediaView: 'debaser.media.view.v1',
  playerBar: 'debaser.audio.bar.v1',
  // FIRSTVISIT: the desktop tour seen, skipped or owed (`../ui/first-visit-tour.ts`), so a second computer doesn't tour again.
  tour: 'debaser.tour.v1',
} as const;

export type SyncedName = keyof typeof SYNCED_KEYS;

export const SYNCED_NAMES = Object.keys(SYNCED_KEYS) as SyncedName[];

const changeListeners = new Set<(name: SyncedName) => void>();
const appliedListeners = new Set<() => void>();
const markListeners = new Set<() => void>();

/** A setting's own code, after the reader changed it and it is in this browser's storage. */
export function noteSettingChanged(name: SyncedName): void {
  for (const listener of changeListeners) listener(name);
}

/** The account sync hears of every change here. */
export function onSettingChanged(listener: (name: SyncedName) => void): () => void {
  changeListeners.add(listener);
  return () => void changeListeners.delete(listener);
}

/** The account sync, once the account's choices are written into this browser's storage. */
export function announceAccountSettings(): void {
  for (const listener of appliedListeners) listener();
}

/** A setting's own code: read your key again, the account's choice is in it now. */
export function subscribeToAccountSettings(listener: () => void): () => void {
  appliedListeners.add(listener);
  return () => void appliedListeners.delete(listener);
}

/** The board's read marks (`../forum/read-state.ts`), after a post was opened: the account saves them in a batch. */
export function noteReadMarkSaved(): void {
  for (const listener of markListeners) listener();
}

export function onReadMarkSaved(listener: () => void): () => void {
  markListeners.add(listener);
  return () => void markListeners.delete(listener);
}
