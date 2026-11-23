/**
 * Whose history it is, and where it is kept: in this browser, under the account's own key, until Phase 5's tables exist and it moves to the
 * account. Private either way: nothing about it is sent anywhere now.
 */
import { rowsFrom, without, withVisit, type Seen } from './history';

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

export function openHistoryOf(owner: string | null): void {
  if (held.owner === owner) return;
  let rows: readonly Seen[] = NONE;
  if (owner !== null) {
    try {
      rows = rowsFrom(JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + owner) ?? 'null'), Date.now());
    } catch {
      // Nothing readable: an empty history.
    }
  }
  held = { owner, rows };
  for (const listener of listeners) listener();
}

export function noteSeen(seen: Seen): void {
  if (held.owner !== null) keep(withVisit(held.rows, seen));
}

export function forgetOne(row: Seen): void {
  keep(without(held.rows, row.at, row.address));
}

/** One key clears it. */
export function clearHistory(): void {
  keep(NONE);
}
