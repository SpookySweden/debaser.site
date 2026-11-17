import { dayJitter } from './recommend';
import { READING_KINDS, type ReadingKind } from './brief/feeds';
import type { WebItem } from './types';

/**
 * Pieces of MEDIA's default feed shared by the ranker (feed-rank.ts, SPEC-media-feed-v2.md): a late-arriving source, the
 * reading chooser, and what the history says about reading. Pure, so `Temp/check-media-feed-mix.cjs` and
 * `Temp/check-media-feed-rank.cjs` hold them: nothing here reads a clock, the browser or the network.
 *
 * The first version's fixed 12-place pattern (SPEC-media-feed.md, FEED fccc05e) was replaced by the ranker on 2026-11-17
 * (Luke: "All A"); the reading rules below are unchanged from it.
 */

/** A source that arrived: its rows in its own order, usable from block `fromBlock` (0 when it was there at the start). */
export type Lane<T> = { rows: readonly T[]; fromBlock: number };

export type ReadingRow<T> = { kind: ReadingKind; item: T };

const DAY_MS = 86_400_000;

/** A reading kind's share: one, plus one for every 3 of its rows opened in 30 days, at most two more. */
export function kindShare(opens: number | undefined): number {
  return 1 + Math.min(2, Math.floor(Math.max(0, opens ?? 0) / 3));
}

/** The outlet a reading row came from, for the turn rules. */
export const outletOf = (item: WebItem): string => item.outlet ?? item.creator ?? item.platform;

/** Hacker News keeps its own front-page order: the order only, nothing else of the site's is read. */
const KEEPS_ITS_ORDER = new Set(['HACKER NEWS']);

/** Reading rows are no more than this many places of 48 rows apart from one outlet: 8 reading places in 48 rows. */
const OUTLET_WINDOW = 8;
const OUTLET_MAX = 2;

/** Better first: how well it fits the reader, then newer, then the day's jitter. */
function readingOrder<T extends WebItem>(fit: (item: T) => number, day: number) {
  return (a: T, b: T): number => {
    const taste = fit(b) - fit(a);
    if (taste !== 0) return taste;
    const age = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (Number.isFinite(age) && age !== 0) return age;
    return dayJitter(b.id, day) - dayJitter(a.id, day) || a.id.localeCompare(b.id);
  };
}

export type ReadingContext<T> = {
  /** Signed out: the four kinds in an even turn. */
  visitor: boolean;
  /** How many reading rows of each kind this reader opened or finished in the last 30 days (`readingOpens`). */
  readingOpens: Readonly<Partial<Record<ReadingKind, number>>>;
  /** How well a row fits the reader (feed-rank.ts `fitOf`): better fits first within an outlet. */
  fit: (item: T) => number;
  now: number;
};

/**
 * The reading chooser: whose turn each kind has, and which outlet's row within it. Each kind gets places in proportion to
 * its share; one outlet never twice running within a kind and no more than twice in 8 reading places.
 */
export function readingChooser<T extends WebItem>(rows: readonly ReadingRow<T>[], context: ReadingContext<T>) {
  const day = Math.floor(context.now / DAY_MS);
  const order = readingOrder<T>(context.fit, day);
  // Each kind's outlets, each a queue in its own order.
  const queues = new Map<ReadingKind, Map<string, T[]>>();
  for (const { kind, item } of rows) {
    const outlets = queues.get(kind) ?? new Map<string, T[]>();
    const outlet = outletOf(item);
    outlets.set(outlet, [...(outlets.get(outlet) ?? []), item]);
    queues.set(kind, outlets);
  }
  for (const outlets of queues.values()) {
    for (const [outlet, items] of outlets) if (!KEEPS_ITS_ORDER.has(outlet)) items.sort(order);
  }
  const share = (kind: ReadingKind) => (context.visitor ? 1 : kindShare(context.readingOpens[kind]));
  const served = new Map<ReadingKind, number>();
  const lastOutlet = new Map<ReadingKind, string>();
  const recent: string[] = [];
  // Which kind leads a tie turns with the day, so the first reading place isn't always the same kind.
  const kinds = READING_KINDS.map((_, index) => READING_KINDS[(index + day) % READING_KINDS.length]);

  /** The next reading row, or null when every kind is empty. `usable` says whether a row may still be shown. */
  return (usable: (item: T) => boolean): ReadingRow<T> | null => {
    for (const outlets of queues.values()) for (const items of outlets.values()) while (items.length > 0 && !usable(items[0])) items.shift();
    const open = kinds.filter((kind) => [...(queues.get(kind)?.values() ?? [])].some((items) => items.length > 0));
    if (open.length === 0) return null;
    // The kind furthest behind its share.
    const kind = open.reduce((best, next) => ((served.get(next) ?? 0) / share(next) < (served.get(best) ?? 0) / share(best) ? next : best));
    const heads = [...(queues.get(kind) as Map<string, T[]>).entries()].filter(([, items]) => items.length > 0);
    const allowed = (outlet: string, strict: boolean) =>
      (!strict || outlet !== lastOutlet.get(kind) || heads.length === 1) && recent.slice(-OUTLET_WINDOW).filter((one) => one === outlet).length < (strict ? OUTLET_MAX : Infinity);
    const pool = heads.filter(([outlet]) => allowed(outlet, true));
    const [outlet, items] = (pool.length > 0 ? pool : heads).sort(([, a], [, b]) => order(a[0], b[0]))[0];
    const item = items.shift() as T;
    served.set(kind, (served.get(kind) ?? 0) + 1);
    lastOutlet.set(kind, outlet);
    recent.push(outlet);
    return { kind, item };
  };
}

/** History rows of a reading kind opened or finished in the last 30 days, counted by kind (`readingOpens`). */
export function readingOpens(
  rows: readonly { kind: string; ref: string; action: string; lastAt: string }[],
  now: number,
): Partial<Record<ReadingKind, number>> {
  const counts: Partial<Record<ReadingKind, number>> = {};
  for (const row of rows) {
    if (row.kind !== 'media' || !['opened', 'played', 'read', 'finished', 'more'].includes(row.action)) continue;
    if (now - Date.parse(row.lastAt) > 30 * DAY_MS) continue;
    const platform = row.ref.split(':')[0];
    const kind = READING_KINDS.find((one) => one === platform);
    if (kind !== undefined) counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

/** The ids opened, played, read or finished in the last 30 days: they stay out of the default feed. */
export function openedLately(rows: readonly { kind: string; ref: string; action: string; lastAt: string }[], now: number): ReadonlySet<string> {
  return new Set(
    rows
      .filter((row) => row.kind === 'media' && ['opened', 'played', 'read', 'finished', 'skipped'].includes(row.action) && now - Date.parse(row.lastAt) <= 30 * DAY_MS)
      .map((row) => row.ref),
  );
}
