import { accountSettingsLoaded, madeSwitches, subscribeToAccountSettingsLoaded } from '../settings/account-settings';
import type { MadeKind } from '../settings/settings-rules';
import { madeAnchor, madeDay, madeThreadTitle, shouldFileMade } from './made';
import { forgetMadeThings } from './made-things';
import type { ForumAnchor, ForumThread } from './types';

/**
 * Filing a MADE row (SPEC-forum-v3.md, M1A and M4A): the maker's own tab, the first time that day they make something
 * public with that kind's switch on, files one board post anchored `made:<person>:<day>`. Later things the same day file
 * nothing: the row reads them live (`./made-things.ts`) and grows.
 *
 * Called from where each kind is made public (a drawing saved to the art shelf, a character put on a profile, a file or a
 * track added on /files, a letter made public). The board is in `ForumProvider`, which hands this module what it needs
 * (`registerMadeFiler`), so a caller only says which kind it made.
 */

type Filer = {
  /** Who is signed in, or null. */
  person: () => { id: string; displayName: string } | null;
  /** The board as it stands. */
  threads: () => readonly ForumThread[];
  create: (request: { title: string; body: string; anchor: ForumAnchor }) => Promise<ForumThread>;
};

let filer: Filer | null = null;
/** Days this tab already filed (or is filing) a row for, so two quick makes in one tab never file two. */
const filed = new Set<string>();

export function registerMadeFiler(next: Filer | null): void {
  filer = next;
}

/** Waits, a few seconds at most, for the account's settings: the switches decide, and a guess never files. */
function settingsRead(): Promise<boolean> {
  if (accountSettingsLoaded()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(accountSettingsLoaded());
    }, 8000);
    const unsubscribe = subscribeToAccountSettingsLoaded(() => {
      if (!accountSettingsLoaded()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** Something of this kind was just made public by whoever is signed in. Never throws: a row that cannot be filed is not. */
export async function fileMade(kind: MadeKind): Promise<void> {
  try {
    const current = filer;
    const me = current?.person() ?? null;
    if (current === null || me === null) return;
    // Their own row reads again, whether or not one is filed now: the thing is new.
    forgetMadeThings();
    if (!(await settingsRead())) return;
    const day = madeDay();
    const key = `${me.id}|${day}`;
    if (filed.has(key)) return;
    if (!shouldFileMade({ person: me.id, switchOn: madeSwitches()[kind], day, threads: current.threads() })) return;
    filed.add(key);
    await current.create({ title: madeThreadTitle(me.displayName, day), body: '', anchor: madeAnchor(me.id, day) }).catch(() => {
      filed.delete(key);
    });
  } catch {
    // The thing itself is made; only its line on the board is missing.
  }
}
