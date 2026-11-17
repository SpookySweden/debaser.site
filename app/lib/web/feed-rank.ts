import { dedupeKey } from './dedupe';
import { readingChooser, type Lane, type ReadingRow } from './feed-mix';
import { COLD_BELOW, itemWords, normalMaker, spelledOf, type Profile } from './feed-profile';
import { dayJitter } from './recommend';
import type { ReadingKind } from './brief/feeds';
import type { WebItem } from './types';

/**
 * MEDIA's default feed, version 2 (SPEC-media-feed-v2.md; Luke, 2026-11-17: "All A"): every candidate the feed's sources
 * offer, scored against the person's profile (feed-profile.ts), then laid out 12 at a time within limits that keep a screen
 * varied. Pure, so `Temp/check-media-feed-rank.cjs` holds it: nothing here reads a clock, the browser or the network.
 *
 * - Each screen of 12: 9 like what the person plays (2 of them reading) and 3 new near what they like (decision 1A).
 * - At most 1 per creator (2 for a creator they have finished several things by), and a creator on one screen sits out the
 *   next; at most 4 per site (decision 3A); at most 2 people's picks, and something sent to them personally is on the
 *   first screen (decision 2A).
 * - With nothing to go on, a balanced sampler: pictured, worded rows first, at most 2 per site (decision 5A).
 * - Every row says why it is here in plain words, never a number (decision 4A).
 *
 * **It holds still.** A source that arrives late joins from block `fromBlock`, and nothing before that block depends on it,
 * so a late answer never moves a row already on screen. The scores decide order only and never leave this file.
 */

export type FeedLane = 'you' | 'youtube' | 'reading' | 'new' | 'people' | 'live';
export type Person = { id: string; name: string };
/** How a person openly shared a row: sent to this reader, recommended publicly, or queued in a room the reader joined. */
export type SharedHow = 'sent' | 'recommended' | 'queued';
export type SharedRow<T> = { item: T; people: readonly Person[]; how: SharedHow };

export type RankInput<T extends WebItem> = {
  /** The whole saved stream (every enabled row, with Claude's words as `pickWords`). */
  pool: readonly T[];
  youtube: Lane<T> | null;
  reading: Lane<ReadingRow<T>> | null;
  /** The DISCOVER catalogue's finds for this person's words or preset. */
  discover: Lane<T> | null;
  /** Rows people openly shared, with who: one lane per way they arrive (read with the history, found later in the catalogue). */
  people: readonly Lane<SharedRow<T>>[];
  /**
   * Lives on now that fit the reader (SPEC-live-streams.md, use-live-lane.ts), already in their order: one LIVE place a
   * screen, never a stand-in for another place. A live is offered even if its channel was opened lately.
   */
  live?: Lane<T> | null;
  /** Signed out: no YOUR YOUTUBE, the reading kinds in an even turn. */
  visitor: boolean;
  readingOpens: Readonly<Partial<Record<ReadingKind, number>>>;
  profile: Profile;
  /** Rows that stay out besides the profile's own (NOT FOR ME pressed this visit, resting, a confirmed Short). */
  dropped: (item: T) => boolean;
  /** The visit's clock, read once by the page. */
  now: number;
  /** Stop after this many blocks (default: until the candidates run out). */
  maxBlocks?: number;
};

/** `block`: which screen of 12 the row is on (0 first). Every screen is a whole 12 except where the candidates ran out. */
export type RankedRow<T> = { item: T; lane: FeedLane; why: string; block: number; kind?: ReadingKind; people?: readonly Person[] };

export const BLOCK_SIZE = 12;
type Role = 'familiar' | 'new' | 'reading' | 'live';
/**
 * The roles of a block's 12 places: 3 new (places 3, 7, 12), 2 reading (4 and 10, never side by side) and 1 LIVE (5,
 * SPEC-live-streams.md: "lives mixed in"); with no live that fits, place 5 is like what you play.
 */
export const BLOCK_ROLES: readonly Role[] = ['familiar', 'familiar', 'new', 'reading', 'live', 'familiar', 'new', 'familiar', 'familiar', 'reading', 'familiar', 'new'];

const DAY_MS = 86_400_000;
/** At least this much fit to count as "like what you play". */
export const FITS = 1;
const WORD_CAP = 4;
const MAKER_CAP = 3;
const MAKER_WEIGHT = 2;
/** A creator weighted this much (two finished things) may have 2 rows a screen and needn't sit out the next. */
const STRONG_MAKER = 8;
const SITE_MAX = 4;
const SITE_MAX_COLD = 2;
const PEOPLE_MAX = 2;
const SENT = 50;
const VIDEO_PLATFORMS = new Set(['youtube', 'peertube', 'vimeo']);

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** How well a row fits the person: its words, its maker (capped, so one channel can never outweigh everything), its site. */
export function fitOf(item: Pick<WebItem, 'title' | 'tags' | 'pickWords' | 'creator' | 'platform'>, profile: Profile): number {
  const words = itemWords(item);
  let raw = 0;
  let size = 0;
  for (const [word, share] of words) {
    raw += share * clamp(profile.words[word] ?? 0, -WORD_CAP, WORD_CAP);
    size += share;
  }
  // Long tag lists are evened out, so a row doesn't win by having many words.
  const wordScore = size > 4 ? raw / Math.sqrt(size / 4) : raw;
  const maker = item.creator ? clamp(profile.makers[normalMaker(item.creator)] ?? 0, -8, MAKER_CAP) * MAKER_WEIGHT : 0;
  const site = Math.min(Math.max(profile.platforms[item.platform] ?? 0, 0), 4) * 0.25;
  return wordScore + maker + site;
}

/** Freshness by kind: uploads halve every 30 days; audiobooks, films and archives barely date. */
function freshOf(item: Pick<WebItem, 'platform' | 'publishedAt'>, now: number): number {
  const age = Math.max(0, now - Date.parse(item.publishedAt)) / DAY_MS;
  if (!Number.isFinite(age)) return 0;
  return VIDEO_PLATFORMS.has(item.platform) ? 0.5 ** (age / 30) : 0.3 * 0.5 ** (age / 90);
}

/** A picture, words or a description; a YouTube Short counts against. */
function extrasOf(item: WebItem): number {
  let extra = 0;
  if (item.thumbnailUrl) extra += 0.5;
  if ((item.tags?.length ?? 0) > 0 || (item.pickWords?.length ?? 0) > 0 || (item.description ?? '').trim().length > 40) extra += 0.5;
  if (item.platform === 'youtube' && item.durationSeconds !== undefined && item.durationSeconds > 0 && item.durationSeconds <= 60) extra -= 2;
  return extra;
}

/** How much people's sharing lifts a row: sent personally lifts it to the top; a close person's pick more than a stranger's. */
function socialOf(shared: SharedRow<unknown> | undefined, profile: Profile): number {
  if (shared === undefined) return 0;
  if (shared.how === 'sent') return SENT;
  let lift = 0;
  for (const person of shared.people) lift += person.id.startsWith('anon:') ? 0.5 : 1 + 2 * (profile.closeness.get(person.id) ?? 0);
  return Math.min(4, lift);
}

const shortTitle = (title: string) => (title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title).toUpperCase();

/** Why a row that fits is here: the thing done it shares most with, its channel or maker, or a word. Words only. */
export function familiarWhy(item: Pick<WebItem, 'title' | 'tags' | 'pickWords' | 'creator'>, profile: Profile): string {
  const words = itemWords(item);
  const maker = item.creator ? normalMaker(item.creator) : '';
  let best: { title: string; verb: string } | null = null;
  let bestShared = 0;
  for (const reason of profile.reasons) {
    let shared = 0;
    for (const [word, share] of words) if (reason.words.has(word)) shared += share;
    if (maker !== '' && reason.maker === maker) shared += 2;
    if (shared >= 1 && shared > bestShared) {
      best = reason;
      bestShared = shared;
    }
  }
  if (best !== null) return `BECAUSE YOU ${best.verb} ${shortTitle(best.title)}`;
  if (maker !== '' && profile.channels.has(maker)) return 'FROM A CHANNEL YOU WATCH';
  if (maker !== '' && (profile.makers[maker] ?? 0) > 0 && item.creator) return `MORE FROM ${item.creator.toUpperCase()}`;
  const word = strongestShared(words, profile);
  return word !== null ? `FITS ${spelledOf(profile, word).toUpperCase()}` : 'PICKED FOR TODAY';
}

/** The person's strongest word this row shares, or null. */
function strongestShared(words: ReadonlyMap<string, number>, profile: Profile): string | null {
  let best: string | null = null;
  let weight = 0;
  for (const word of words.keys()) {
    const mine = profile.words[word] ?? 0;
    if (mine > weight) {
      best = word;
      weight = mine;
    }
  }
  return best;
}

const READING_WHY: Record<ReadingKind, string> = { news: "TODAY'S NEWS", paper: 'A NEW PAPER', longread: 'A LONG READ FOR TODAY', tech: 'IN TECH TODAY' };

/** Why a person's pick is here: who, and how. */
function peopleWhy(shared: SharedRow<unknown>): string {
  const named = shared.people.filter((person) => !person.id.startsWith('anon:'));
  const name = named[0]?.name.toUpperCase();
  if (shared.how === 'sent') return name ? `${name.trim()} SENT YOU THIS` : 'SENT TO YOU';
  if (shared.how === 'queued') return 'QUEUED IN A ROOM YOU JOINED';
  // A person whose name didn't come with the pick (or is blank) is not named.
  if (!name) return 'RECOMMENDED HERE';
  return named.length > 1 ? `${name} AND OTHERS RECOMMENDED THIS` : `${name} RECOMMENDED THIS`;
}

type Entry<T> = {
  item: T;
  lane: Exclude<FeedLane, 'reading'>;
  fromBlock: number;
  fit: number;
  score: number;
  newScore: number;
  shared?: SharedRow<T>;
  maker: string;
  /** May take a "like what you play" place. */
  familiar: boolean;
  /** May take a "new to you" place. */
  fresh: boolean;
};

/** The ranked feed: blocks of 12 until nothing is left (or `maxBlocks`). Every row once, the same work once too. */
export function rankFeed<T extends WebItem>(input: RankInput<T>): RankedRow<T>[] {
  const { profile, now } = input;
  const day = Math.floor(now / DAY_MS);
  const cold = profile.evidence < COLD_BELOW;
  const out = profile.out;
  const gone = (item: T) => out.has(item.id) || input.dropped(item);

  // Every candidate once: a row offered by two sources keeps the entry that scores higher (a person's pick usually).
  const entries = new Map<string, Entry<T>>();
  const offer = (item: T, lane: Entry<T>['lane'], fromBlock: number, shared?: SharedRow<T>) => {
    if (gone(item)) return;
    const fit = fitOf(item, profile);
    if (fit <= -3 && shared?.how !== 'sent') return;
    const jitter = dayJitter(item.id, day);
    const extras = extrasOf(item);
    const fresh = freshOf(item, now);
    const social = socialOf(shared, profile);
    const score = cold ? extras + 0.5 * fresh + social + jitter : fit + social + fresh + extras + jitter;
    const novelty = (profile.platforms[item.platform] ?? 0) > 0 ? 0 : 0.5;
    const newScore = (lane === 'new' ? 1 : 0) + clamp(fit, 0, FITS) + extras + 0.5 * fresh + novelty + jitter;
    const entry: Entry<T> = {
      item,
      lane,
      fromBlock,
      fit,
      score,
      newScore,
      shared,
      maker: item.creator ? normalMaker(item.creator) : '',
      familiar: cold || fit >= FITS || social > 0 || lane === 'youtube',
      fresh: lane === 'new' || (fit < FITS && fit > -1 && social === 0),
    };
    const before = entries.get(item.id);
    // A later source never replaces an earlier one's row: that would change blocks already drawn.
    if (before === undefined || (entry.fromBlock <= before.fromBlock && (entry.score > before.score || (entry.shared !== undefined && before.shared === undefined)))) entries.set(item.id, entry);
  };
  for (const item of input.pool) offer(item, 'you', 0);
  if (input.youtube !== null && !input.visitor) for (const item of input.youtube.rows) offer(item, 'youtube', input.youtube.fromBlock);
  if (input.discover !== null) for (const item of input.discover.rows) offer(item, 'new', input.discover.fromBlock);
  for (const shared of input.people) for (const row of shared.rows) offer(row.item, 'people', shared.fromBlock, row);

  const all = [...entries.values()];
  const byScore = [...all].sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1));
  const byNew = [...all].filter((entry) => entry.fresh).sort((a, b) => b.newScore - a.newScore || (a.item.id < b.item.id ? -1 : 1));

  const shown = new Set<string>();
  const works = new Set<string>();
  const usable = (item: T) => {
    if (shown.has(item.id) || gone(item)) return false;
    const work = dedupeKey(item);
    return work === null || !works.has(work);
  };
  const take = (item: T) => {
    shown.add(item.id);
    const work = dedupeKey(item);
    if (work !== null) works.add(work);
  };
  // Lives (SPEC-live-streams.md): only the page's own drops apply (NOT FOR ME, a confirmed Short), never "opened lately":
  // a channel watched here is exactly what the LIVE place looks for.
  const live = input.live ?? null;
  const usableLive = (item: T) => {
    if (shown.has(item.id) || input.dropped(item)) return false;
    const work = dedupeKey(item);
    return work === null || !works.has(work);
  };

  const nextReading =
    input.reading === null
      ? null
      : readingChooser(input.reading.rows, { visitor: input.visitor, readingOpens: input.readingOpens, now, fit: (item: T) => fitOf(item, profile) });

  const rows: RankedRow<T>[] = [];
  let lastBlockMakers = new Set<string>();
  const strong = (maker: string) => (profile.makers[maker] ?? 0) >= STRONG_MAKER;
  for (let block = 0; input.maxBlocks === undefined || block < input.maxBlocks; block += 1) {
    const makers = new Map<string, number>();
    const sites = new Map<string, number>();
    let people = 0;
    let placed = 0;
    let readingPlaced = 0;
    const siteMax = cold ? SITE_MAX_COLD : SITE_MAX;
    const fits = (entry: Entry<T>, siteLimit: boolean, sitOut: boolean) => {
      if (entry.fromBlock > block || !usable(entry.item)) return false;
      if (entry.maker !== '') {
        const already = makers.get(entry.maker) ?? 0;
        if (already >= (strong(entry.maker) ? 2 : 1)) return false;
        if (sitOut && lastBlockMakers.has(entry.maker) && !strong(entry.maker)) return false;
      }
      if (entry.shared !== undefined && people >= PEOPLE_MAX) return false;
      if (siteLimit && (sites.get(entry.item.platform) ?? 0) >= siteMax) return false;
      return true;
    };
    const place = (entry: Entry<T>, role: 'familiar' | 'new') => {
      take(entry.item);
      if (entry.maker !== '') makers.set(entry.maker, (makers.get(entry.maker) ?? 0) + 1);
      sites.set(entry.item.platform, (sites.get(entry.item.platform) ?? 0) + 1);
      if (entry.shared !== undefined) people += 1;
      const lane: FeedLane = entry.shared !== undefined ? 'people' : role === 'new' && entry.lane === 'you' ? 'new' : entry.lane;
      rows.push({ item: entry.item, lane, why: whyOf(entry, role), block, ...(entry.shared !== undefined ? { people: entry.shared.people } : {}) });
      placed += 1;
    };
    const whyOf = (entry: Entry<T>, role: 'familiar' | 'new'): string => {
      if (entry.shared !== undefined) return peopleWhy(entry.shared);
      if (cold) return 'PICKED FOR TODAY';
      if (role === 'new' || entry.fit < FITS) {
        const near = strongestShared(itemWords(entry.item), profile);
        return near !== null && (profile.words[near] ?? 0) > 0 ? `NEW: NEAR ${spelledOf(profile, near).toUpperCase()}` : 'NEW TO YOU';
      }
      return familiarWhy(entry.item, profile);
    };
    const anything = () => true;
    const isFamiliar = (entry: Entry<T>) => entry.familiar;
    /** Where each kind of place looks, in turn: [list, which entries, placed as new]. */
    const looks: Record<Role, readonly [readonly Entry<T>[], (entry: Entry<T>) => boolean, boolean][]> = {
      new: [[byNew, anything, true], [byScore, isFamiliar, false]],
      reading: [[byScore, isFamiliar, false], [byNew, anything, true]],
      familiar: [[byScore, isFamiliar, false], [byScore, anything, false]],
      // With no live that fits, the LIVE place is like what you play.
      live: [[byScore, isFamiliar, false], [byScore, anything, false]],
    };
    const choose = (role: Role): { entry: Entry<T>; asNew: boolean } | null => {
      // The site limit gives way first, then sitting out the next screen; one per creator on a screen never does.
      for (const [siteLimit, sitOut] of [[true, true], [false, true], [false, false]] as const) {
        for (const [list, filter, asNew] of looks[role]) {
          for (const entry of list) if (filter(entry) && fits(entry, siteLimit, sitOut)) return { entry, asNew };
        }
      }
      return null;
    };
    for (const role of BLOCK_ROLES) {
      if (role === 'reading') {
        if (nextReading !== null && input.reading !== null && block >= input.reading.fromBlock && readingPlaced < 2) {
          const row = nextReading(usable);
          if (row !== null) {
            take(row.item);
            const fit = fitOf(row.item, profile);
            rows.push({ item: row.item, lane: 'reading', block, kind: row.kind, why: !cold && fit >= FITS ? familiarWhy(row.item, profile) : READING_WHY[row.kind] });
            readingPlaced += 1;
            placed += 1;
            continue;
          }
        }
      }
      if (role === 'live' && live !== null && block >= live.fromBlock) {
        // The next live in its own order that may still show and whose channel isn't on this screen or the last.
        const item = live.rows.find((one) => {
          if (!usableLive(one)) return false;
          const maker = one.creator ? normalMaker(one.creator) : '';
          return maker === '' || ((makers.get(maker) ?? 0) === 0 && !lastBlockMakers.has(maker));
        });
        if (item !== undefined) {
          take(item);
          const maker = item.creator ? normalMaker(item.creator) : '';
          if (maker !== '') makers.set(maker, 1);
          sites.set(item.platform, (sites.get(item.platform) ?? 0) + 1);
          const fit = fitOf(item, profile);
          const why = cold ? 'ON NOW' : fit >= FITS ? familiarWhy(item, profile) : maker !== '' && profile.channels.has(maker) ? 'FROM A CHANNEL YOU WATCH' : 'ON NOW';
          rows.push({ item, lane: 'live', block, why });
          placed += 1;
          continue;
        }
      }
      const chosen = choose(role);
      if (chosen !== null) place(chosen.entry, chosen.asNew ? 'new' : 'familiar');
    }
    // A source that arrived late may still have rows for a later screen: the feed goes on to it rather than end here.
    const pending = all.some((entry) => entry.fromBlock > block) || (input.reading !== null && input.reading.fromBlock > block) || (live !== null && live.fromBlock > block);
    // A block of reading alone (or reading and lives) is never drawn: they flavour the list, they never become it.
    const blockRows = rows.slice(rows.length - placed);
    if (placed === 0 || blockRows.every((row) => row.lane === 'reading' || row.lane === 'live')) {
      rows.length -= placed;
      if (pending) continue;
      break;
    }
    // A screen that could not be filled is the last, unless a late source is still to join.
    if (placed < BLOCK_SIZE && !pending) break;
    lastBlockMakers = new Set([...makers.keys()]);
  }
  return rows;
}
