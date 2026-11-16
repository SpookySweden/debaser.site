import { dedupeKey } from './dedupe';
import { dayJitter, tasteScore, type Taste } from './recommend';
import { READING_KINDS, type ReadingKind } from './brief/feeds';
import type { WebItem } from './types';

/**
 * MEDIA's default feed (SPEC-media-feed.md; Luke's yes, 2026-11-16): every recommender mixed into one list, drawn in blocks
 * of 12. Pure, so `Temp/check-media-feed-mix.cjs` holds it: nothing here reads a clock, the browser or the network.
 *
 * Each block follows one pattern of places: 5 FOR YOU (the saved stream in this reader's order), 2 YOUR YOUTUBE, 2
 * READING (a paper, news story, long read or tech link), 2 NEW TO YOU (the DISCOVER catalogue) and 1 PEOPLE'S PICKS.
 * A place whose source has nothing goes to FOR YOU, then NEW TO YOU, then PEOPLE'S PICKS; reading never takes more
 * than its own two places.
 *
 * **The list holds still.** Every source is a list that only grows at its end, and a source that arrives late is used
 * only from the block after the last one already drawn (`fromBlock`). The mix stops where FOR YOU runs out while the
 * stream has more pages, rather than fill FOR YOU's places with something else: so LOAD MORE adds blocks below and
 * never moves a row already on screen.
 */

export type MixLane = 'you' | 'youtube' | 'reading' | 'new' | 'people';

/** The 12 places of a block (SPEC-media-feed.md, "What Luke will see"). One table: "reading 3 in 12" is one line here. */
export const BLOCK_PATTERN: readonly MixLane[] = ['you', 'you', 'youtube', 'reading', 'you', 'new', 'people', 'youtube', 'you', 'reading', 'you', 'new'];
export const BLOCK_SIZE = BLOCK_PATTERN.length;

/** Where an empty place goes, in order. Reading is never a stand-in. */
export const FILL_ORDER: readonly MixLane[] = ['you', 'new', 'people'];

/** A source that arrived: its rows in its own order, usable from block `fromBlock` (0 when it was there at the start). */
export type Lane<T> = { rows: readonly T[]; fromBlock: number };

export type ReadingRow<T> = { kind: ReadingKind; item: T };

export type MixInput<T extends WebItem> = {
  /** The saved stream already in this reader's order (recommend.ts), page after page. */
  forYou: readonly T[];
  /** False while the stream has more pages to load: the mix waits for them rather than fill FOR YOU's places. */
  forYouEnded: boolean;
  youtube: Lane<T> | null;
  reading: Lane<ReadingRow<T>> | null;
  discover: Lane<T> | null;
  people: Lane<T> | null;
  /** Signed out: no YOUR YOUTUBE (its places go to FOR YOU) and the four reading kinds in an even turn. */
  visitor: boolean;
  /** How many reading rows of each kind this reader opened or finished in the last 30 days (`readingOpens`). */
  readingOpens: Readonly<Partial<Record<ReadingKind, number>>>;
  taste: Taste;
  /** Rows that stay out: opened in the last 30 days, NOT FOR ME, passed over three days running. */
  dropped: (item: T) => boolean;
  /** The visit's clock, read once by the page. */
  now: number;
};

export type MixedRow<T> = { item: T; lane: MixLane; kind?: ReadingKind };

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

/** Better first: words that match the reader's taste, then newer, then the day's jitter. */
function readingOrder<T extends WebItem>(taste: Taste, day: number) {
  return (a: T, b: T): number => {
    const taste_ = tasteScore(b, taste) - tasteScore(a, taste);
    if (taste_ !== 0) return taste_;
    const age = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (Number.isFinite(age) && age !== 0) return age;
    return dayJitter(b.id, day) - dayJitter(a.id, day) || a.id.localeCompare(b.id);
  };
}

/** The reading lane's chooser: whose turn each kind has, and which outlet's row within it. */
function readingChooser<T extends WebItem>(rows: readonly ReadingRow<T>[], input: MixInput<T>) {
  const day = Math.floor(input.now / DAY_MS);
  const order = readingOrder<T>(input.taste, day);
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
  const share = (kind: ReadingKind) => (input.visitor ? 1 : kindShare(input.readingOpens[kind]));
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

/**
 * The mixed list: blocks of 12 for as long as FOR YOU has rows (or, once the stream has ended, while anything is left).
 * Every row comes once; the same work from two sources once too (`dedupeKey`), from the first place that picked it.
 */
export function mixFeed<T extends WebItem>(input: MixInput<T>): MixedRow<T>[] {
  const shown = new Set<string>();
  const works = new Set<string>();
  const usable = (item: T) => {
    if (shown.has(item.id) || input.dropped(item)) return false;
    const work = dedupeKey(item);
    return work === null || !works.has(work);
  };
  const take = (item: T) => {
    shown.add(item.id);
    const work = dedupeKey(item);
    if (work !== null) works.add(work);
  };

  const cursors: Record<Exclude<MixLane, 'reading'>, number> = { you: 0, youtube: 0, new: 0, people: 0 };
  const laneOf = (lane: Exclude<MixLane, 'reading'>): Lane<T> | null =>
    lane === 'you' ? { rows: input.forYou, fromBlock: 0 } : lane === 'youtube' ? (input.visitor ? null : input.youtube) : lane === 'new' ? input.discover : input.people;
  const nextFrom = (lane: Exclude<MixLane, 'reading'>, block: number): T | null => {
    const source = laneOf(lane);
    if (source === null || block < source.fromBlock) return null;
    while (cursors[lane] < source.rows.length) {
      const item = source.rows[cursors[lane]];
      cursors[lane] += 1;
      if (usable(item)) return item;
    }
    return null;
  };
  /** Whether FOR YOU has run out for now while more of the stream may come: the mix must wait. */
  const youWaits = () => !input.forYouEnded && cursors.you >= input.forYou.length;

  const nextReading = input.reading === null ? null : readingChooser(input.reading.rows, input);
  const out: MixedRow<T>[] = [];
  for (let block = 0; ; block += 1) {
    const start = out.length;
    let placed = 0;
    for (const place of BLOCK_PATTERN) {
      if (place === 'reading' && nextReading !== null && block >= (input.reading as Lane<ReadingRow<T>>).fromBlock) {
        const row = nextReading(usable);
        if (row !== null) {
          take(row.item);
          out.push({ item: row.item, lane: 'reading', kind: row.kind });
          placed += 1;
          continue;
        }
      }
      const order = place === 'reading' ? FILL_ORDER : [place, ...FILL_ORDER.filter((lane) => lane !== place)];
      let filled = false;
      for (const lane of order as Exclude<MixLane, 'reading'>[]) {
        const item = nextFrom(lane, block);
        if (item !== null) {
          take(item);
          out.push({ item, lane });
          placed += 1;
          filled = true;
          break;
        }
        // FOR YOU is next in line but has run out for now: stop here, so the rows below wait for LOAD MORE.
        if (lane === 'you' && youWaits()) return out;
      }
      if (!filled && youWaits()) return out;
    }
    // A block of reading alone is never drawn: reading flavours the list, it never becomes it.
    if (out.slice(start).every((row) => row.lane === 'reading')) return out.slice(0, start);
    if (placed === 0) return out;
  }
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
