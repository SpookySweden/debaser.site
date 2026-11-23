/**
 * BROWSER's history (SPEC-seeing-machine.md, answer 15: private to the account, one key to clear it, 90 days). Pure: every change takes the
 * rows as they are, newest first, and gives back the rows as they become.
 */
import { readAddress } from './address';
import { cleanTitle } from './tabs';

/** One page seen. `from` is the page it was come to from, in the same tab, for the TRAIL. */
export type Seen = { address: string; title: string; at: number; from: string | null };

export const HISTORY_DAYS = 90;
export const HISTORY_MOST = 2000;
const DAY_MS = 86_400_000;
/** The same page seen again this soon is the same visit. */
const SAME_VISIT_MS = 60_000;

export const isOutside = (address: string): boolean => /^https?:/.test(address);

/** Rows still within the days, as many as are kept. */
export function keptRows(rows: readonly Seen[], now: number): Seen[] {
  return rows.filter((row) => now - row.at < HISTORY_DAYS * DAY_MS && row.at <= now + DAY_MS).slice(0, HISTORY_MOST);
}

export function withVisit(rows: readonly Seen[], seen: Seen): Seen[] {
  if (!isOutside(seen.address)) return [...rows];
  const last = rows[0];
  if (last !== undefined && last.address === seen.address && seen.at - last.at < SAME_VISIT_MS) return [{ ...last, title: seen.title || last.title }, ...rows.slice(1)];
  return keptRows([seen, ...rows], seen.at);
}

export const without = (rows: readonly Seen[], at: number, address: string): Seen[] => rows.filter((row) => row.at !== at || row.address !== address);

/** The pages seen last, each once (a page's parts are one page), newest first: a new tab's way back. */
export function recentPages(rows: readonly Seen[], most: number): Seen[] {
  const seen = new Set<string>();
  const out: Seen[] = [];
  for (const row of rows) {
    const page = row.address.split('#')[0];
    if (seen.has(page)) continue;
    seen.add(page);
    out.push(row);
    if (out.length >= most) break;
  }
  return out;
}

/** Every word somewhere in a page's title or address. */
export function findIn(rows: readonly Seen[], words: string): Seen[] {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  return wanted.length === 0 ? [...rows] : rows.filter((row) => wanted.every((word) => `${row.title} ${row.address}`.toLowerCase().includes(word)));
}

/** Read back through one door: what isn't a whole row of an outside page is dropped. */
export function rowsFrom(value: unknown, now: number): Seen[] {
  if (!Array.isArray(value)) return [];
  const rows: Seen[] = [];
  for (const each of value.slice(0, HISTORY_MOST)) {
    if (typeof each !== 'object' || each === null) continue;
    const { address, title, at, from } = each as Record<string, unknown>;
    const read = typeof address === 'string' ? readAddress(address) : null;
    if (read === null || !read.ok || !isOutside(read.address) || typeof at !== 'number' || !Number.isFinite(at)) continue;
    const came = typeof from === 'string' ? readAddress(from) : null;
    rows.push({ address: read.address, title: (typeof title === 'string' ? cleanTitle(title) : null) ?? read.address, at, from: came !== null && came.ok && isOutside(came.address) ? came.address : null });
  }
  return keptRows(rows.sort((a, b) => b.at - a.at), now);
}
