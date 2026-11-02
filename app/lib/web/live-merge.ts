import type { WebStreamItem } from './dedupe';
import { compareByDate, type SortDir } from './web-sort';

/**
 * How results from several sources join one list while they arrive (SPEC-web-search.md, one live search; the order
 * from SPEC-web-sort.md). Pure and client-safe, so `scripts/check-web-live-merge.cjs` and `check-web-sort.cjs` hold
 * every rule here.
 *
 * - Each item shows once: a result is dropped when its id (`platform:externalId`) is already listed, or is an
 *   ALSO ON copy of a listed stream row. Whichever source answers first keeps the row.
 * - The list is in its order (`ListOrder`): by date, newest or oldest first, or the sources taking turns, each
 *   in its own order (BEST MATCH, POPULAR).
 * - Until the reader scrolls or presses anything, arrivals slot into the list in that order.
 * - After that (`frozen`), nothing moves under them: arrivals wait in `held`, behind a "N MORE RESULTS" key at
 *   the top; pressing it puts them at the top, in the list's order among themselves.
 * - A row that plays (a media server's title, with SERVER buttons) takes the place of the same title's KINO row,
 *   which has none, wherever that row is; it never moves. The other way round, the KINO row is dropped. A source
 *   marked `swapOnly` (the saved stream under POPULAR, which has no popularity of its own) only ever does that: its
 *   rows wait in `waiting` until their KINO row arrives, and never show on their own.
 * - LOAD MORE is the reader asking for more, so its arrivals go at the end of the list, in order among themselves,
 *   never above what is already there.
 * - By date, a source's rows are **held back** (`lanes`, its `buffer`) while that source's own next page, or any
 *   other source's, could still hold a row that belongs above them: each source's next page is no newer than the
 *   last row it gave (its `frontier`), so a row is shown only once it is at least as new as every frontier of a
 *   source with more. Nothing shown is ever overtaken by a later page, and LOAD MORE continues in order
 *   (`lanesToAsk`: the source holding the others back is asked by itself). A source that has not answered yet holds
 *   nothing back: its first rows slot in as they arrive, as before. When it does answer, rows already shown that its
 *   next page could beat go back to waiting, as long as the reader has not scrolled or pressed anything yet.
 */

export type ListOrder = { kind: 'date'; dir: SortDir } | { kind: 'turns' };

/** One source's place: rows held back, the last row it gave (by date), whether it has more, and its turns so far. */
export type Lane = { buffer: WebStreamItem[]; frontier: string | null; more: boolean; count: number };

export type LiveList = {
  shown: WebStreamItem[];
  held: WebStreamItem[];
  frozen: boolean;
  /** Every id listed, held or held back, ALSO ON copies included. */
  seen: ReadonlySet<string>;
  order: ListOrder;
  /** Each row's turn (BEST MATCH, POPULAR): its place in its own source's list, then the source's place. */
  turns: ReadonlyMap<string, number>;
  lanes: Readonly<Record<string, Lane>>;
  /** A `swapOnly` source's rows, waiting for their KINO row. */
  waiting: WebStreamItem[];
};

export function emptyLive(order: ListOrder = { kind: 'date', dir: 'desc' }): LiveList {
  return { shown: [], held: [], frozen: false, seen: new Set(), order, turns: new Map(), lanes: {}, waiting: [] };
}

export const EMPTY_LIVE: LiveList = emptyLive();

/** Where a page came from: its source, whether that source has more, and whether it only replaces KINO rows. */
export type Arrival = {
  lane: string;
  more: boolean;
  swapOnly?: boolean;
  /** The whole page as the source sent it, before the filters kept some: where the source is, by date. */
  page?: readonly { publishedAt: string }[];
};

/** Where rows shown too early wait again (see `arrive`); a lane of its own with no pages to ask. */
const EARLY = 'shown-early';

/** A source's place among the turns; the order is fixed so the same search always reads the same way. */
const LANE_RANK = ['stream', 'internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'kino'];
const LANE_SPACE = 100;
function laneRank(lane: string): number {
  const rank = LANE_RANK.indexOf(lane);
  return rank === -1 ? LANE_RANK.length : rank;
}

/** The list's order as a comparison. */
export function compareIn(list: Pick<LiveList, 'order' | 'turns'>): (a: WebStreamItem, b: WebStreamItem) => number {
  if (list.order.kind === 'date') return compareByDate(list.order.dir);
  const { turns } = list;
  return (a, b) => {
    const ta = turns.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const tb = turns.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function idsOf(item: WebStreamItem): string[] {
  return [item.id, ...item.alsoOn.map((copy) => copy.id)];
}

const plays = (item: WebStreamItem) => (item.media?.copies.length ?? 0) > 0;

/** Beyond every date: a source that answered with no rows yet but has more could still beat anything. */
const UNKNOWN = { desc: '￿', asc: '' } as const;

/**
 * Rows the reader may now see: by date, those no source with more could still beat. A source that has answered but
 * given no rows yet (YouTube's date windows out of time before their first day; a page the filters emptied) holds
 * everything back until it does.
 */
function newestFrontier(lanes: Readonly<Record<string, Lane>>, dir: SortDir): string | null {
  let bound: string | null = null;
  for (const lane of Object.values(lanes)) {
    if (!lane.more) continue;
    if (lane.frontier === null) return UNKNOWN[dir];
    if (bound === null || (dir === 'desc' ? lane.frontier > bound : lane.frontier < bound)) bound = lane.frontier;
  }
  return bound;
}

/**
 * Adds what arrived. `end`: LOAD MORE's answers, appended below everything already shown. `from`: the source and
 * whether it has more (without it, the rows join as they are, held back by nothing).
 */
export function arrive(list: LiveList, items: readonly WebStreamItem[], end = false, from?: Arrival): LiveList {
  const seen = new Set(list.seen);
  const fresh: WebStreamItem[] = [];
  let { shown, held, waiting } = list;
  let lanes = list.lanes;
  const swap = (item: WebStreamItem) => {
    // The same title: one that plays replaces one that does not, in place (and in a held-back row's place).
    const swapIn = (rows: WebStreamItem[]) => rows.map((row) => (row.id === item.id && plays(item) && !plays(row) && row.media !== undefined ? item : row));
    shown = swapIn(shown);
    held = swapIn(held);
    // ... and in a row still held back by date (a KINO row waiting on another source).
    if (Object.values(lanes).some((lane) => lane.buffer.some((row) => row.id === item.id))) {
      lanes = Object.fromEntries(Object.entries(lanes).map(([name, lane]) => [name, { ...lane, buffer: swapIn(lane.buffer) }]));
    }
  };
  for (const item of items) {
    if (idsOf(item).some((id) => seen.has(id))) {
      swap(item);
      continue;
    }
    if (from?.swapOnly) {
      if (!waiting.some((row) => row.id === item.id)) waiting = [...waiting, item];
      continue;
    }
    for (const id of idsOf(item)) seen.add(id);
    fresh.push(item);
  }
  // Waiting rows whose KINO row is here now take its place: listed already, or arriving in this very page.
  if (waiting.length > 0) {
    const ready = waiting.filter((row) => seen.has(row.id));
    for (const row of ready) {
      swap(row);
      const at = fresh.findIndex((item) => item.id === row.id && !plays(item) && item.media !== undefined);
      if (at !== -1) fresh[at] = row;
    }
    if (ready.length > 0) waiting = waiting.filter((row) => !seen.has(row.id));
  }

  // Turns: each new row's place in its own source's list.
  let turns = list.turns;
  const lane = from ? (lanes[from.lane] ?? { buffer: [], frontier: null, more: true, count: 0 }) : null;
  if (from && lane) {
    if (list.order.kind === 'turns' && fresh.length > 0) {
      const next = new Map(turns);
      fresh.forEach((item, index) => next.set(item.id, (lane.count + index) * LANE_SPACE + laneRank(from.lane)));
      turns = next;
    }
    // By date, the frontier is the last row the source gave in its order (repeats count: they say where it is).
    let frontier = lane.frontier;
    if (list.order.kind === 'date') {
      const dir = list.order.dir;
      for (const item of from.page ?? items) {
        if (from.swapOnly) break;
        if (frontier === null || (dir === 'desc' ? item.publishedAt < frontier : item.publishedAt > frontier)) frontier = item.publishedAt;
      }
    }
    lanes = { ...lanes, [from.lane]: { buffer: lane.buffer, frontier, more: from.more, count: lane.count + fresh.length } };
  }

  // By date, everything is held back in its source's lane first; then whatever no source can still beat comes out.
  let released = fresh;
  if (list.order.kind === 'date' && from) {
    const dir = list.order.dir;
    lanes = { ...lanes, [from.lane]: { ...lanes[from.lane], buffer: [...lanes[from.lane].buffer, ...fresh] } };
    const bound = newestFrontier(lanes, dir);
    const free = (item: WebStreamItem) => bound === null || (dir === 'desc' ? item.publishedAt >= bound : item.publishedAt <= bound);
    // Rows shown before this source answered may now be beaten by its next page. Until the reader has scrolled or
    // pressed anything the list may still change, so they go back to waiting (from then on they stay put).
    if (!list.frozen && !end) {
      const early = shown.filter((item) => !free(item));
      if (early.length > 0) {
        shown = shown.filter(free);
        const back = lanes[EARLY] ?? { buffer: [], frontier: null, more: false, count: 0 };
        lanes = { ...lanes, [EARLY]: { ...back, buffer: [...back.buffer, ...early] } };
      }
    }
    released = [];
    const opened: Record<string, Lane> = {};
    for (const [name, each] of Object.entries(lanes)) {
      const out = each.buffer.filter(free);
      if (out.length > 0) {
        released.push(...out);
        opened[name] = { ...each, buffer: each.buffer.filter((item) => !free(item)) };
      }
    }
    if (released.length > 0) lanes = { ...lanes, ...opened };
  }

  const unchanged = released.length === 0 && shown === list.shown && held === list.held && waiting === list.waiting && lanes === list.lanes && turns === list.turns;
  if (unchanged) return list;
  const base = { ...list, shown, held, waiting, seen, turns, lanes };
  if (released.length === 0) return base;
  const compare = compareIn(base);
  released.sort(compare);
  if (end) return { ...base, shown: [...shown, ...released] };
  if (list.frozen) return { ...base, held: [...held, ...released] };
  return { ...base, shown: [...shown, ...released].sort(compare) };
}

/** The reader scrolled or pressed something: from now on nothing slots in above them. */
export function freeze(list: LiveList): LiveList {
  return list.frozen ? list : { ...list, frozen: true };
}

/** "N MORE RESULTS" pressed: the held results go at the top, in the list's order. Still frozen. */
export function release(list: LiveList): LiveList {
  if (list.held.length === 0) return list;
  return { ...list, shown: [...[...list.held].sort(compareIn(list)), ...list.shown], held: [] };
}

/** How many rows are held back by date, waiting for another source's next page. */
export function heldBack(list: LiveList): number {
  return Object.values(list.lanes).reduce((sum, lane) => sum + lane.buffer.length, 0);
}

/**
 * Which sources LOAD MORE asks. By date, with rows held back: only the source holding them back (its frontier is
 * the newest of those with more), so the list grows in order. Otherwise every source that has more.
 */
export function lanesToAsk(list: LiveList): string[] {
  const more = Object.entries(list.lanes).filter(([, lane]) => lane.more);
  if (list.order.kind !== 'date' || heldBack(list) === 0) return more.map(([name]) => name);
  const bound = newestFrontier(list.lanes, list.order.dir);
  const limiting = more.find(([, lane]) => lane.frontier === bound || lane.frontier === null);
  return limiting ? [limiting[0]] : more.map(([name]) => name);
}
