/**
 * Whose history it is, and where it is kept: on the account, which nobody else reads, and in this browser under the account's own key.
 */
import { accountHistory, addToAccountHistory, clearAccountHistory, forgetInAccountHistory } from './account';
import { forAccount, keptRows, rowsFrom, without, withVisit, type Seen } from './history';

const STORAGE_PREFIX = 'debaser-seeing-history-v1:';
const NONE: readonly Seen[] = [];

let held: { owner: string | null; rows: readonly Seen[] } = { owner: null, rows: NONE };
const listeners = new Set<() => void>();

export const historyRows = (): readonly Seen[] => held.rows;
export const historyRowsOnServer = (): readonly Seen[] => NONE;

export function subscribeToHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function keep(rows: readonly Seen[]): void {
  held = { ...held, rows };
  for (const listener of listeners) listener();
  if (held.owner === null) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + held.owner, JSON.stringify(rows));
  } catch {
    // Full or refused: it lasts as long as the page.
  }
}

/** What is kept now: another tab of the site may have written since this one read. */
function readKept(owner: string): readonly Seen[] | null {
  try {
    const text = window.localStorage.getItem(STORAGE_PREFIX + owner);
    return text === null ? null : rowsFrom(JSON.parse(text), Date.now());
  } catch {
    return null;
  }
}

export function openHistoryOf(owner: string | null): void {
  if (held.owner === owner) return;
  let rows: readonly Seen[] = NONE;
  if (owner !== null) rows = readKept(owner) ?? NONE;
  held = { owner, rows };
  for (const listener of listeners) listener();
  if (owner === null) return;
  void accountHistory()
    .catch(() => null)
    .then((kept) => {
      if (kept === null || held.owner !== owner) return;
      // What was seen here and the account has not heard of (a line that was down, or from before it was kept there) goes to it.
      const known = new Set(kept.map((row) => `${row.at} ${row.address}`));
      const unheard = held.rows.filter((row) => !known.has(`${row.at} ${row.address}`));
      // (A page OWN EYE showed stays in this browser: the account is never told of it.)
      void addToAccountHistory(forAccount(unheard)).catch(() => undefined);
      keep(keptRows([...kept, ...unheard].sort((a, b) => b.at - a.at), Date.now()));
    });
}

export function noteSeen(seen: Seen): void {
  if (held.owner === null) return;
  const before = readKept(held.owner) ?? held.rows;
  const after = withVisit(before, seen);
  keep(after);
  if (after.length > 0 && after[0].at === seen.at && after[0].address === seen.address) void addToAccountHistory(forAccount([after[0]])).catch(() => undefined);
}

export function forgetOne(row: Seen): void {
  if (held.owner === null) return;
  keep(without(readKept(held.owner) ?? held.rows, row.at, row.address));
  if (row.own !== true) void forgetInAccountHistory(row).catch(() => undefined);
}

/** One key clears it. */
export async function clearHistory(): Promise<boolean> {
  keep(NONE);
  return clearAccountHistory().catch(() => false);
}
