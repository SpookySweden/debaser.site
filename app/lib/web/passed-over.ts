/**
 * Rows shown and passed over in MEDIA's default feed (SPEC-media-feed.md, "What drops out"): a row shown in the first
 * block on 3 different days without being opened rests for a week. Kept in this browser only: ids and day numbers, at
 * most 500 rows, each forgotten 14 days after it was last shown. Never sent anywhere. The rules are pure here (a check
 * holds them); `readResting` / `noteFirstBlock` / `noteOpenedRow` are the browser's side, and storage that throws or
 * comes back empty simply rests nothing.
 */

const KEY = 'debaser.media-passed-over.v1';
const DAY_MS = 86_400_000;
export const PASSED_MAX = 500;
export const PASSED_KEEP_DAYS = 14;
export const PASSED_DAYS = 3;
export const REST_DAYS = 7;

/** id -> the days (day numbers) it was shown in the first block, and the day its rest ends, if resting. */
export type PassedOver = Readonly<Record<string, { days: readonly number[]; restUntil?: number }>>;

const dayOf = (now: number) => Math.floor(now / DAY_MS);

/** The ids resting today. */
export function restingIds(store: PassedOver, now: number): ReadonlySet<string> {
  const today = dayOf(now);
  return new Set(Object.entries(store).filter(([, entry]) => entry.restUntil !== undefined && entry.restUntil > today).map(([id]) => id));
}

/** The store after these ids were shown in today's first block: a third day starts a week's rest. Old and extra rows go. */
export function withFirstBlock(store: PassedOver, ids: readonly string[], now: number): PassedOver {
  const today = dayOf(now);
  const next: Record<string, { days: readonly number[]; restUntil?: number }> = {};
  for (const [id, entry] of Object.entries(store)) {
    const last = Math.max(...entry.days, entry.restUntil ?? 0);
    if (today - last <= PASSED_KEEP_DAYS) next[id] = entry;
  }
  for (const id of ids) {
    const before = next[id];
    if (before?.restUntil !== undefined && before.restUntil > today) continue;
    const days = [...new Set([...(before?.restUntil !== undefined ? [] : (before?.days ?? [])), today])].slice(-PASSED_DAYS);
    next[id] = days.length >= PASSED_DAYS ? { days, restUntil: today + REST_DAYS } : { days };
  }
  const newest = Object.entries(next)
    .sort(([, a], [, b]) => Math.max(...b.days) - Math.max(...a.days))
    .slice(0, PASSED_MAX);
  return Object.fromEntries(newest);
}

/** The store after a row was opened: it was not passed over after all. */
export function withOpenedRow(store: PassedOver, id: string): PassedOver {
  if (!(id in store)) return store;
  const next = { ...store };
  delete next[id];
  return next;
}

function read(): PassedOver {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as unknown;
    if (typeof saved !== 'object' || saved === null) return {};
    const out: Record<string, { days: number[]; restUntil?: number }> = {};
    for (const [id, entry] of Object.entries(saved as Record<string, unknown>)) {
      const value = entry as { days?: unknown; restUntil?: unknown };
      const days = Array.isArray(value?.days) ? value.days.filter((day): day is number => Number.isInteger(day)) : [];
      if (id.length > 300 || days.length === 0) continue;
      out[id] = Number.isInteger(value.restUntil) ? { days, restUntil: value.restUntil as number } : { days };
    }
    return out;
  } catch {
    return {};
  }
}

function write(store: PassedOver): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: nothing rests, which is only a little less tidy.
  }
}

/** The ids resting in this browser today, read once a visit. */
export function readResting(now: number): ReadonlySet<string> {
  return restingIds(read(), now);
}

/** The first block of today's feed was drawn with these rows. */
export function noteFirstBlock(ids: readonly string[], now: number): void {
  write(withFirstBlock(read(), ids, now));
}

/** A row in the feed was opened. */
export function noteOpenedRow(id: string): void {
  const store = read();
  const next = withOpenedRow(store, id);
  if (next !== store) write(next);
}
