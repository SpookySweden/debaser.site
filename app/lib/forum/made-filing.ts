import { accountSettingsLoaded, madeSwitches, subscribeToAccountSettingsLoaded, subscribeToMadeSwitches } from '../settings/account-settings';
import type { MadeKind } from '../settings/settings-rules';
import { madeAnchor, madeBody, madeDay, madeThreadTitle, shouldFileMade } from './made';
import { forgetMadeThings } from './made-things';
import type { ForumAnchor, ForumThread } from './types';

/**
 * Filing a MADE row (SPEC-forum-v3.md, M1A and M4A): the maker's own tab, the first time that day they make something
 * public with that kind's switch on, files one board post anchored `made:<person>:<day>`. Later things the same day file
 * nothing: the row reads them live (`./made-things.ts`) and grows.
 *
 * The row's body says which kinds it lists (`madeBody`): the kinds whose switch is on. Only the maker can read their own
 * switches, so their tab writes them into the row when it files it, and again whenever the switches change that day, and
 * every reader lists only those kinds. A switch turned off takes that kind off today's row too; it never deletes a thing.
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
  /** Rewrites a row's body (the kinds it lists): the maker's own post, so the database lets only them. */
  update: (threadId: string, body: string) => Promise<ForumThread>;
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

/** This person's row for today, if the board holds one (the first filed, as the board shows). */
function todaysRow(current: Filer, person: string): ForumThread | null {
  const anchorId = madeAnchor(person, madeDay()).id;
  const rows = current.threads().filter((thread) => thread.anchor.kind === 'board' && thread.anchor.id === anchorId);
  if (rows.length === 0) return null;
  return rows.reduce((first, row) => (Date.parse(row.createdAt) < Date.parse(first.createdAt) ? row : first));
}

/** Today's row lists the kinds switched on now: rewritten only when they differ. */
async function keepRowKinds(): Promise<void> {
  const current = filer;
  const me = current?.person() ?? null;
  if (current === null || me === null || !accountSettingsLoaded()) return;
  const row = todaysRow(current, me.id);
  const body = madeBody(madeSwitches());
  if (row === null || row.body.trim() === body) return;
  await current.update(row.id, body).catch(() => undefined);
}

if (typeof window !== 'undefined') {
  // A switch pressed in PRIVACY: today's row stops (or starts) listing that kind at once.
  subscribeToMadeSwitches(() => void keepRowKinds());
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
    if (!shouldFileMade({ person: me.id, switchOn: madeSwitches()[kind], day, threads: current.threads() })) {
      // A row is already up (or this kind is switched off): it only needs to list the kinds switched on now.
      await keepRowKinds();
      return;
    }
    if (filed.has(key)) return;
    filed.add(key);
    await current.create({ title: madeThreadTitle(me.displayName, day), body: madeBody(madeSwitches()), anchor: madeAnchor(me.id, day) }).catch(() => {
      filed.delete(key);
    });
  } catch {
    // The thing itself is made; only its line on the board is missing.
  }
}
