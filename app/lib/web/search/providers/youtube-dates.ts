/**
 * YouTube by date (SPEC-web-sort.md, "YouTube by date"). SERVER ONLY.
 *
 * YouTube no longer sorts a search by upload date (its "Upload date" filter now answers in relevance order: tested
 * 2026-11-02). What it does honour is `after:` / `before:` in the words, and live-checked the same day against real
 * upload times, `after:D before:D+1` is exactly the uploads of day D (Pacific time). Within a window the order is
 * still relevance, so a window is only shown once it has been read whole, and the smallest window is one day:
 *
 * 1. every year still to show is asked at once (first page only, InnerTube is free) to see which have uploads;
 * 2. the first such year (newest or oldest, as asked) is split into months, asked at once, and the first month with
 *    uploads into days, asked at once;
 * 3. each day with uploads is read to its end (a day of a common word may run to a few pages), dated, and ordered;
 *    days are taken until a page's worth is found. The cursor holds the next day still to show (`yw-n-YYYYMMDD`
 *    going back, `yw-o-YYYYMMDD` going forward), so LOAD MORE carries on exactly where this stopped.
 *
 * Dates: with the YouTube key set, one `videos.list` call per 50 videos (1 quota unit) gives each upload's exact time.
 * Without it, a video "N hours ago" keeps that time and every other video of a day is dated midday (UTC) of that day,
 * ties in id order: exact to the day. Either way the date shown is the date ordered by.
 *
 * Never send an empty window: `after:D before:D` is silently ignored and answers with everything (tested).
 *
 * Within a window YouTube matches loosely: past its first page or two, anything near the words fills in (live-checked
 * 2026-11-02: "night of the living dead" today ran into LitRPG audiobooks). Ordered by date that filler would come
 * first, so a dated video is kept only when every word searched is in its title, channel or description: the saved
 * stream's own rule (search.ts `matchesSearch`).
 *
 * The risk, said once: the operators are undocumented. Every answer is checked against its window (each video's
 * "N years ago" must fit it, and a video that does not is dropped); an answer mostly outside its window means YouTube
 * stopped honouring them, and the search answers "YOUTUBE: CAN'T SORT BY DATE" rather than show a wrong order.
 */
import { safeFetchJson, type FetchLike } from '../../safe-fetch';
import { matchesSearch, searchWords } from '../../search';
import type { WebItem } from '../../types';
import { SearchProblemError, type SearchPage } from '../types';
import { toWebItem as apiItem, youtubeKey, ytVideoUrl } from './youtube';
import { innertubeSearchAged } from './youtube-innertube';

/** The first YouTube upload was on 2005-04-23; nothing older can turn up. */
export const YT_FIRST_DAY = '2005-04-23';
/** Enough rows for one LOAD MORE; a day is never cut, so a page may hold more. */
export const YT_DATED_PAGE = 20;
/** A day of a common word may run to a few pages; past this many the day is shown as read. */
const MAX_PAGES_PER_DAY = 8;
/** Requests one search may spend (InnerTube costs nothing, but each takes time). */
export const YT_DATED_BUDGET = 120;
/** One answer stops exploring after this long and says where it got to; LOAD MORE carries on from there. */
export const YT_DATED_DEADLINE_MS = 9_000;
/** A cursor: which way, and the next day still to show. */
export const YT_DATED_CURSOR = /^yw-([no])-(\d{8})$/;

const DAY_MS = 86_400_000;
/** How many parts a sparse window is cut into (`narrower`). */
const SPARSE_PARTS = 8;
/** Slack for time zones and YouTube's rounding when a date is checked against its window. */
const SLACK_MS = 2 * DAY_MS;

export type Direction = 'newest' | 'oldest';
/** Days as `YYYY-MM-DD`, a window as [from, to): `to` is the day after its last. */
export type Window = { from: string; to: string };

const toMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fromMs(toMs(day) + n * DAY_MS);

/** Today in Pacific time, roughly: YouTube's days begin there. */
export function todayOf(now: Date): string {
  return fromMs(now.getTime() - 7 * 3_600_000);
}

/** The words with a window: `night after:2008-03-10 before:2008-03-11`. Throws on an empty window (see above). */
export function windowQuery(words: string, window: Window): string {
  if (!(window.from < window.to)) throw new Error('empty window');
  return `${words} after:${window.from} before:${window.to}`;
}

/** A window cut into calendar years, months or days, oldest first. Pure. */
export function split(window: Window, unit: 'year' | 'month' | 'day'): Window[] {
  const parts: Window[] = [];
  let from = window.from;
  while (from < window.to) {
    const [y, m] = from.split('-').map(Number);
    let end: string;
    if (unit === 'day') end = addDays(from, 1);
    else if (unit === 'month') end = fromMs(Date.UTC(y, m, 1));
    else end = fromMs(Date.UTC(y + 1, 0, 1));
    const to = end < window.to ? end : window.to;
    parts.push({ from, to });
    from = to;
  }
  return parts;
}

/**
 * The smaller windows to ask next inside one with uploads. A window with a few uploads (`sparse`) is cut into eight,
 * asked at once, so a year with three uploads reaches its days in three rounds of questions (8 x 8 x 8 > 365) rather
 * than asking all 365; a full one is split by the calendar (a year into months, a month into days), as most of its
 * days will have uploads. Pure.
 */
export function narrower(window: Window, sparse: boolean): Window[] {
  const days = Math.round((toMs(window.to) - toMs(window.from)) / DAY_MS);
  if (days <= 1) return [window];
  if (sparse) {
    const parts = Math.min(SPARSE_PARTS, days);
    const cuts = Array.from({ length: parts + 1 }, (_, index) => (index === parts ? window.to : addDays(window.from, Math.floor((days * index) / parts))));
    return cuts.slice(0, -1).map((from, index) => ({ from, to: cuts[index + 1] }));
  }
  const [fromYear, fromMonth] = window.from.split('-');
  const [lastYear, lastMonth] = addDays(window.to, -1).split('-');
  if (fromYear !== lastYear) return split(window, 'year');
  return split(window, fromMonth !== lastMonth ? 'month' : 'day');
}

/**
 * Whether a video's age fits its window: "N units ago" means uploaded at most `date` and more than one unit before
 * it, which must overlap the window. A window's days are Pacific time (07:00 or 08:00 UTC to the same next day): an
 * hour-exact age is held to exactly that, so a video "5 hours ago" never fits two days back; a coarser age gets a
 * couple of days' slack for YouTube's rounding. Pure.
 */
export function fitsWindow(date: string, unitMs: number, window: Window): boolean {
  const at = Date.parse(date);
  if (unitMs <= 3_600_000) return at >= toMs(window.from) + 7 * 3_600_000 && at - unitMs < toMs(window.to) + 8 * 3_600_000;
  return at + SLACK_MS >= toMs(window.from) && at - unitMs - SLACK_MS < toMs(window.to);
}

/**
 * Whether an answer honoured its window. YouTube slips a few of the last days' videos into any answer (live-checked
 * 2026-11-02: "14 hours ago" inside a 2005 window); those are dropped, and each turns up in its own window anyway.
 * `judged`: the videos that fit, plus those that miss and are older than a day. A thin answer strays too (3 of 5 in a
 * 2005 month were from 2014), so only an answer of 8 or more is judged: most of those missing means the operators are
 * being ignored (an ignored window answers a full page of everything). Pure.
 */
export function windowHonoured(judged: number, fitting: number): boolean {
  return judged < 8 || fitting * 2 >= judged;
}

/**
 * A day's videos dated (see the header) and in the order asked. `exact`: upload times from `videos.list` by id.
 * Pure, so `scripts/check-web-sort.cjs` holds it.
 */
export function dateDay(items: readonly WebItem[], units: ReadonlyMap<string, number>, day: string, direction: Direction, exact: ReadonlyMap<string, string> = new Map()): WebItem[] {
  // Day D in Pacific time is about 08:00 UTC on D to 07:00 UTC on D+1; an hour-exact age is kept within it.
  const start = toMs(day) + 8 * 3_600_000;
  const end = toMs(day) + DAY_MS + 7 * 3_600_000 - 1000;
  const midday = new Date(toMs(day) + 12 * 3_600_000).toISOString();
  const dated = items.map((item) => {
    const own = exact.get(item.externalId);
    if (own !== undefined) return { ...item, publishedAt: own };
    if ((units.get(item.externalId) ?? Infinity) <= 3_600_000) {
      const at = Math.min(Math.max(Date.parse(item.publishedAt), start), end);
      return { ...item, publishedAt: new Date(at).toISOString() };
    }
    return { ...item, publishedAt: midday };
  });
  return dated.sort((a, b) => {
    const by = a.publishedAt === b.publishedAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.publishedAt < b.publishedAt ? 1 : -1;
    return direction === 'newest' ? by : -by;
  });
}

type Probe = { window: Window; items: WebItem[]; units: Map<string, number>; next: string | null };

/**
 * One page of YouTube by date, from `cursor` (null: from today going back, or from YouTube's first day going
 * forward). `fetchImpl` reaches InnerTube (and, with a key, the Data API's `videos.list`).
 */
export async function datedSearch(
  words: string,
  direction: Direction,
  cursor: string | null,
  deps: { fetch?: FetchLike; now?: () => Date; env?: Readonly<Record<string, string | undefined>> },
): Promise<SearchPage> {
  const now = deps.now?.() ?? new Date();
  const fetchedAt = now.toISOString();
  const today = todayOf(now);
  const resumed = cursor === null ? null : YT_DATED_CURSOR.exec(cursor);
  if (cursor !== null && (resumed === null || resumed[1] !== direction[0])) return { items: [], next: null };
  const at = resumed === null ? (direction === 'newest' ? today : YT_FIRST_DAY) : `${resumed[2].slice(0, 4)}-${resumed[2].slice(4, 6)}-${resumed[2].slice(6, 8)}`;
  if (Number.isNaN(toMs(at)) || at < YT_FIRST_DAY || at > today) return { items: [], next: null };
  // What is still to show: everything up to `at` going back, or from `at` going forward.
  const remaining: Window = direction === 'newest' ? { from: YT_FIRST_DAY, to: addDays(at, 1) } : { from: at, to: addDays(today, 1) };

  const wanted = searchWords(words) ?? [];
  let spent = 0;
  const deadline = Date.now() + YT_DATED_DEADLINE_MS;
  const stop = () => found.length >= YT_DATED_PAGE || spent >= YT_DATED_BUDGET || Date.now() > deadline;
  const probe = async (window: Window, continuation: string | null = null): Promise<Probe> => {
    spent += 1;
    const page = await innertubeSearchAged(windowQuery(words, window), continuation, deps.fetch, fetchedAt);
    const fits = (item: WebItem) => fitsWindow(item.publishedAt, page.units.get(item.externalId) ?? Infinity, window);
    const fitting = page.items.filter(fits);
    const matching = fitting.filter((item) => matchesSearch(item, wanted));
    // The slipped-in videos are always fresh ("14 hours ago"), so only older strays count against the window.
    const judged = page.items.filter((item) => fits(item) || (page.units.get(item.externalId) ?? Infinity) > DAY_MS);
    if (!windowHonoured(judged.length, fitting.length)) throw new SearchProblemError("CAN'T SORT BY DATE");
    return { window, items: matching, units: page.units, next: typeof page.next === 'string' ? page.next : null };
  };
  const inOrder = <T,>(list: T[]) => (direction === 'newest' ? [...list].reverse() : list);
  /** Asks every window at once, in the order asked; null once the budget would be overspent. */
  const probeAll = async (windows: Window[]) => (spent + windows.length > YT_DATED_BUDGET ? null : Promise.all(inOrder(windows).map((window) => probe(window))));

  const found: WebItem[] = [];
  const seen = new Set<string>();
  /** The next day still to show; null once everything is shown. */
  let nextDay: string | null = at;
  const pastDay = (day: string) => {
    const next = direction === 'newest' ? addDays(day, -1) : addDays(day, 1);
    nextDay = next < YT_FIRST_DAY || next > today ? null : next;
  };
  const pastWindow = (window: Window) => pastDay(direction === 'newest' ? window.from : addDays(window.to, -1));

  const readDay = async (first: Probe) => {
    const items = [...first.items];
    const units = new Map(first.units);
    let next = first.next;
    for (let page = 1; next !== null && page < MAX_PAGES_PER_DAY && spent < YT_DATED_BUDGET; page += 1) {
      const more = await probe(first.window, next);
      items.push(...more.items);
      for (const [id, unit] of more.units) units.set(id, unit);
      next = more.next;
    }
    const fresh = items.filter((item) => !seen.has(item.id) && seen.add(item.id));
    const exact = await exactTimes(fresh, deps, fetchedAt);
    found.push(...dateDay(fresh, units, first.window.from, direction, exact));
  };

  /** Reads a window that has uploads, down to its days, in the order asked. True once this page should stop. */
  const explore = async (window: Probe): Promise<boolean> => {
    if (window.items.length === 0) {
      pastWindow(window.window);
      return false;
    }
    if (window.window.to === addDays(window.window.from, 1)) {
      await readDay(window);
      pastDay(window.window.from);
      return stop();
    }
    if (stop()) return true;
    // Sparse: under half a page in the window (YouTube pads a thin answer with stray recent videos, so it still has a next page).
    const parts = await probeAll(narrower(window.window, window.next === null || window.items.length < YT_DATED_PAGE / 2));
    if (parts === null) return true;
    for (const part of parts) if (await explore(part)) return true;
    return false;
  };

  const years = await probeAll(split(remaining, 'year'));
  if (years !== null) {
    for (const year of years) if (await explore(year)) break;
  }
  const resume: string | null = nextDay;
  return { items: found, next: resume === null ? null : `yw-${direction[0]}-${resume.replace(/-/g, '')}` };
}

/** Exact upload times by id from `videos.list` (1 unit per 50), when the key is set; none on any failure. */
async function exactTimes(items: readonly WebItem[], deps: { fetch?: FetchLike; env?: Readonly<Record<string, string | undefined>> }, fetchedAt: string): Promise<Map<string, string>> {
  const key = youtubeKey(deps);
  const times = new Map<string, string>();
  if (key === null || items.length === 0) return times;
  for (let start = 0; start < items.length; start += 50) {
    const ids = items.slice(start, start + 50).map((item) => item.externalId);
    try {
      const body = (await safeFetchJson(ytVideoUrl(ids.join(','), key), { allowedHosts: ['www.googleapis.com'], fetchImpl: deps.fetch })) as { items?: unknown };
      for (const doc of Array.isArray(body?.items) ? body.items : []) {
        const item = apiItem(doc, fetchedAt, 'videos');
        if (item) times.set(item.externalId, item.publishedAt);
      }
    } catch {
      // The day is still exact to the day without them.
    }
  }
  return times;
}
