import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toWebItem as archiveItem } from './adapters/internet-archive';
import { toWebItem as openverseItem } from './adapters/openverse';
import { safeFetchJson, SafeFetchError, buildUrl, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { toWebItem as peertubeItem } from './search/providers/peertube';
import { batchCost, cleanWords, requestFor, worstCaseCost, type TaggableItem } from './tagging';
import type { WebItem } from './types';

/**
 * The catalogue sweep (Luke, 2026-11-05; SPEC-discover.md): open catalogues read through their public APIs, tagged by Claude through the
 * Message Batches API, and counted. Run by /api/web/sweep every two minutes (Luke's ramp, 2026-11-06). SERVER ONLY. Past the row limit items are
 * dropped: what stays is each word's count and closest words, and the newest rows that can be offered to people.
 *
 * **Nothing from TMDB goes to Claude.** TMDB's terms exclude AI use, so this file reads only the five sources below; a film's facts come from
 * Wikidata (CC0), a show's from TVmaze (CC BY-SA), and a plot from Wikipedia (CC BY-SA), which goes to Claude and is never stored or shown.
 * A title's TMDB number may be kept, because it comes from Wikidata and is only a number.
 *
 * Every source is read gently: a fixed agent naming this project and no person, a pause between calls, and a 429 stops that source for the run.
 */

export const SWEEP_SOURCES = ['internet_archive', 'peertube', 'openverse', 'wikidata', 'tvmaze'] as const;
export type SweepSource = (typeof SWEEP_SOURCES)[number];

/** Luke's limit, the whole of it (2026-11-06). Everything out counts at its worst case, so what's in flight can't pass it. */
export const SWEEP_LIMIT_USD = 60;
/** What the tagging job and the word pass may have out at worst, which the sweep leaves them. */
const OTHER_JOBS_IN_FLIGHT_USD = 0.6;
/** Batches out at once. At a full run each, inside the 200,000 requests Claude's API lets wait in its queue. */
export const MAX_OUT = 30;
/** The most one batch holds, which `web_pool_out` must be able to return, and more than a run can read, so no read item is cut. */
const MAX_BATCH = 6000;
/**
 * A run lives inside the route's 240 seconds, and a batch created but not yet marked is paid for and forgotten if it's cut off, so collecting stops
 * starting new batches this long into a run, reading lasts this long, and a run that spent long collecting doesn't read at all. It reads next time.
 */
const COLLECTING_TOO_LONG_MS = 100_000;
const READ_FOR_MS = 60_000;
/** How long a run holds the job. Past the route's limit, so a run that was cut off lets go by itself. */
const CLAIM_SECONDS = 245;
const AGENT = 'DebaserSiteSweep/1.0 (+https://github.com/SpookySweden/debaser.site)';

/** Named collections only (Luke, 2026-11-05): the open upload areas can hold adult or copied material, and these rows get offered to people. */
export const ARCHIVE_COLLECTIONS = ['librivoxaudio', 'prelinger', 'feature_films', 'etree', 'oldtimeradio', 'classic_tv', 'animationandcartoons', 'silent_films'] as const;
const ARCHIVE_ROWS = 1000;
const ARCHIVE_CALLS = 4;
const PEERTUBE_ROWS = 100;
const PEERTUBE_CALLS = 10;
/** Sepia refuses a `start` of 9,000 or more, so from there it goes on from the oldest date it reached, with `endDate`. */
const PEERTUBE_DEEPEST = 9000;
const OPENVERSE_CALLS = 3;
/** Openverse states 200 requests a day without a key, which MEDIA's own reads share. The job runs every two minutes, so it counts them. */
const OPENVERSE_PER_DAY = 60;
const WIKIDATA_FILMS = 500;
const WIKIDATA_PART = 100;
const WIKIPEDIA_PART = 20;
const MAX_TEXT = 600;

const ARCHIVE_FIELDS = ['identifier', 'title', 'creator', 'description', 'date', 'publicdate', 'mediatype', 'subject', 'access-restricted-item'];

/** A row of `web_pool_items`, and what goes to Claude: the description goes out and is not kept. */
export type PoolCandidate = TaggableItem & {
  platform: SweepSource;
  externalId: string;
  host: string | null;
  publishedAt: string | null;
  tmdbRef: string | null;
};

export type SweepState = Record<string, Record<string, unknown>>;

export type SweepDeps = {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** PeerTube instances from the public index; a host outside it is never used. */
  peertubeHosts: ReadonlySet<string>;
};

type Read = { items: PoolCandidate[]; state: Record<string, unknown> };

const pause = (deps: SweepDeps, ms: number) => (deps.sleep ?? ((wait: number) => new Promise<void>((resolve) => setTimeout(resolve, wait))))(ms);
const iso = (value: unknown): string | null => {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function fromWebItem(item: WebItem, platform: SweepSource, host: string | null): PoolCandidate {
  return {
    id: `${platform}:${item.externalId}`,
    platform,
    externalId: item.externalId,
    host,
    kind: item.kind,
    title: item.title,
    creator: item.creator ?? null,
    description: item.description ?? null,
    tags: item.tags ?? null,
    publishedAt: iso(item.publishedAt),
    tmdbRef: null,
  };
}

const getJson = (url: string, hosts: readonly string[], deps: SweepDeps, accept?: string) =>
  safeFetchJson(url, { allowedHosts: hosts, fetchImpl: deps.fetch, userAgent: AGENT, maxBytes: 4 * 1024 * 1024, ...(accept ? { accept } : {}) });

/** A bad answer stops that source for this run and keeps what it already has: never the whole sweep. */
async function each(calls: number, deadline: number, deps: SweepDeps, gapMs: number, call: (index: number) => Promise<boolean>): Promise<void> {
  const now = deps.now ?? Date.now;
  for (let index = 0; index < calls && now() < deadline; index += 1) {
    if (index > 0) await pause(deps, gapMs);
    try {
      if (!(await call(index))) return;
    } catch {
      return;
    }
  }
}

/** Internet Archive's scrape API, in order with its own cursor: its preferred way to read many rows. */
export async function readArchive(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  let cursor = typeof state.cursor === 'string' ? state.cursor : null;
  let rows = typeof state.rows === 'number' ? state.rows : ARCHIVE_ROWS;
  let done = false;
  const q = `collection:(${ARCHIVE_COLLECTIONS.join(' OR ')})`;
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(ARCHIVE_CALLS, deadline, deps, 1000, async () => {
    const query: [string, string][] = [['q', q], ['fields', ARCHIVE_FIELDS.join(',')], ['count', String(rows)]];
    if (cursor) query.push(['cursor', cursor]);
    let answer: { items?: unknown[]; cursor?: unknown };
    try {
      answer = (await getJson(buildUrl('archive.org', ['services', 'search', 'v1', 'scrape'], query), ['archive.org'], deps)) as { items?: unknown[]; cursor?: unknown };
    } catch (error) {
      // Too big or too slow: ask for fewer next run, so one heavy page can't stop this source for good. A 429 just stops for now.
      if (!(error instanceof SafeFetchError && error.status === 429)) rows = Math.max(100, Math.floor(rows / 2));
      return false;
    }
    for (const doc of answer.items ?? []) {
      const item = archiveItem(doc, fetchedAt);
      if (item === null) continue;
      const subject = (doc as { subject?: unknown }).subject;
      const tags = (Array.isArray(subject) ? subject : typeof subject === 'string' ? subject.split(';') : []).filter((one): one is string => typeof one === 'string').slice(0, 20);
      items.push({ ...fromWebItem(item, 'internet_archive', null), tags });
    }
    cursor = typeof answer.cursor === 'string' ? answer.cursor : null;
    rows = ARCHIVE_ROWS;
    // The end of the collections. It stops here rather than going round: rows past the newest 100,000 are gone, so a second lap would pay again.
    if (cursor === null) done = true;
    return cursor !== null;
  });
  return { items, state: done ? { done: true } : { cursor, rows } };
}

/** PeerTube through Sepia Search, newest first, safe-for-work only, on instances in the public index. */
export async function readPeertube(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  let start = typeof state.start === 'number' ? state.start : 0;
  let before = typeof state.before === 'string' ? state.before : null;
  let done = false;
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(PEERTUBE_CALLS, deadline, deps, 1000, async () => {
    const query: [string, string][] = [['count', String(PEERTUBE_ROWS)], ['start', String(start)], ['sort', '-publishedAt'], ['nsfw', 'false']];
    if (before !== null) query.push(['endDate', before]);
    const url = buildUrl('sepiasearch.org', ['api', 'v1', 'search', 'videos'], query);
    let docs: unknown[];
    try {
      docs = ((await getJson(url, ['sepiasearch.org'], deps)) as { data?: unknown[] }).data ?? [];
    } catch (error) {
      if (error instanceof SafeFetchError && error.status === 400) done = true;
      return false;
    }
    for (const doc of docs) {
      const item = peertubeItem(doc, deps.peertubeHosts, fetchedAt);
      if (item !== null) items.push(fromWebItem(item, 'peertube', new URL(item.url).hostname));
    }
    start += docs.length;
    if (docs.length === 0) done = true;
    if (start + PEERTUBE_ROWS > PEERTUBE_DEEPEST) {
      // Items at exactly this date come round again and are skipped as already held. The same date twice means it can't get further.
      const oldest = iso((docs[docs.length - 1] as { publishedAt?: unknown } | undefined)?.publishedAt);
      if (oldest === null || oldest === before) done = true;
      before = oldest;
      start = 0;
    }
    return docs.length > 0 && !done;
  });
  return { items, state: done ? { done: true } : { start, ...(before !== null ? { before } : {}) } };
}

/** A few pages a run, and a few dozen a day. */
export async function readOpenverse(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  let page = typeof state.page === 'number' ? state.page : 1;
  let media: 'audio' | 'images' = state.media === 'images' ? 'images' : 'audio';
  let done = false;
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  const day = fetchedAt.slice(0, 10);
  let calls = state.day === day && typeof state.calls === 'number' ? state.calls : 0;
  await each(Math.min(OPENVERSE_CALLS, OPENVERSE_PER_DAY - calls), deadline, deps, 3000, async () => {
    calls += 1;
    const url = buildUrl('api.openverse.org', ['v1', media, ''], [['page_size', '20'], ['page', String(page)]]);
    let docs: unknown[] = [];
    try {
      docs = ((await getJson(url, ['api.openverse.org'], deps)) as { results?: unknown[] }).results ?? [];
    } catch (error) {
      // Past the last page it may read: start the other kind from the top next time. A 429 stops here.
      if (error instanceof SafeFetchError && error.status === 429) return false;
      if (media === 'images') done = true;
      media = 'images';
      page = 1;
      return false;
    }
    for (const doc of docs) {
      const item = openverseItem(doc, media === 'audio' ? 'audio' : 'image', fetchedAt);
      if (item !== null) items.push(fromWebItem(item, 'openverse', null));
    }
    page += 1;
    return docs.length > 0;
  });
  return { items, state: done ? { done: true } : { page, media, day, calls } };
}

type Binding = Record<string, { value?: string } | undefined>;
const text = (row: Binding, name: string): string => row[name]?.value ?? '';
const list = (row: Binding, name: string, most: number): string[] => text(row, name).split('|').map((one) => one.trim()).filter(Boolean).slice(0, most);

/** Films and shows that Wikidata lists a TMDB number for: their facts from Wikidata, a plot from Wikipedia to give Claude something to read. */
export async function readWikidata(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  const property = state.property === 'P4983' ? 'P4983' : 'P4947';
  let offset = typeof state.offset === 'number' ? state.offset : 0;
  const hosts = ['query.wikidata.org'];
  const ask = (sparql: string) => getJson(buildUrl('query.wikidata.org', ['sparql'], [['query', sparql], ['format', 'json']]), hosts, deps, 'application/sparql-results+json') as Promise<{ results?: { bindings?: Binding[] } }>;

  let listed: { qid: string; tmdb: string }[] = [];
  try {
    // A show TVmaze has too (P8600) comes from TVmaze, so it's only paid for once.
    const notTwice = property === 'P4983' ? ' FILTER NOT EXISTS { ?item wdt:P8600 ?tvmaze }' : '';
    const answer = await ask(`SELECT ?item ?tmdb WHERE { ?item wdt:${property} ?tmdb .${notTwice} } LIMIT ${WIKIDATA_FILMS} OFFSET ${offset}`);
    listed = (answer.results?.bindings ?? [])
      .map((row) => ({ qid: text(row, 'item').split('/').pop() ?? '', tmdb: text(row, 'tmdb') }))
      .filter((row) => /^Q[0-9]{1,12}$/.test(row.qid) && /^[0-9]{1,12}$/.test(row.tmdb));
  } catch {
    return { items, state: { property, offset } };
  }
  if (listed.length === 0) {
    // The end of films: on to shows, then finished.
    return { items, state: property === 'P4947' ? { property: 'P4983', offset: 0 } : { done: true } };
  }

  const kind = property === 'P4947' ? 'movie' : 'tv';
  const tmdbOf = new Map(listed.map((row) => [row.qid, row.tmdb]));
  const articles = new Map<string, string>();
  const factsOf = new Map<string, { title: string; date: string | null; creator: string | null; facts: string }>();
  const parts = Array.from({ length: Math.ceil(listed.length / WIKIDATA_PART) }, (_, at) => listed.slice(at * WIKIDATA_PART, (at + 1) * WIKIDATA_PART));
  let done = 0;
  await each(parts.length, deadline - 4000, deps, 1000, async (at) => {
    const values = parts[at].map((row) => `wd:${row.qid}`).join(' ');
    const answer = await ask(`SELECT ?item ?label ?date ?article (GROUP_CONCAT(DISTINCT ?gl;separator='|') AS ?genres) (GROUP_CONCAT(DISTINCT ?dl;separator='|') AS ?directors) (GROUP_CONCAT(DISTINCT ?cl;separator='|') AS ?cast) (GROUP_CONCAT(DISTINCT ?ml;separator='|') AS ?music) WHERE { VALUES ?item { ${values} } ?item rdfs:label ?label . FILTER(LANG(?label)='en') OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P136 ?g . ?g rdfs:label ?gl . FILTER(LANG(?gl)='en') } OPTIONAL { ?item wdt:P57 ?d . ?d rdfs:label ?dl . FILTER(LANG(?dl)='en') } OPTIONAL { ?item wdt:P161 ?c . ?c rdfs:label ?cl . FILTER(LANG(?cl)='en') } OPTIONAL { ?item wdt:P86 ?m . ?m rdfs:label ?ml . FILTER(LANG(?ml)='en') } OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> } } GROUP BY ?item ?label ?date ?article`);
    for (const row of answer.results?.bindings ?? []) {
      const qid = text(row, 'item').split('/').pop() ?? '';
      if (factsOf.has(qid) || !tmdbOf.has(qid)) continue;
      const genres = list(row, 'genres', 6);
      const directors = list(row, 'directors', 3);
      const cast = list(row, 'cast', 8);
      const music = list(row, 'music', 2);
      const date = iso(text(row, 'date'));
      const year = date === null ? '' : `, ${date.slice(0, 4)}`;
      factsOf.set(qid, {
        title: sanitiseText(text(row, 'label'), 300),
        date,
        creator: directors.length > 0 ? sanitiseText(directors.join(', '), 200) : null,
        facts: [`${kind === 'movie' ? 'Film' : 'Show'}${year}.`, genres.length ? `Genres: ${genres.join(', ')}.` : '', directors.length ? `Directed by ${directors.join(', ')}.` : '', cast.length ? `Starring ${cast.join(', ')}.` : '', music.length ? `Music by ${music.join(', ')}.` : ''].filter(Boolean).join(' '),
      });
      const article = text(row, 'article');
      if (article.startsWith('https://en.wikipedia.org/wiki/')) {
        try {
          articles.set(qid, decodeURIComponent(article.slice('https://en.wikipedia.org/wiki/'.length)));
        } catch {
          // A strange address: that film just goes without a plot.
        }
      }
    }
    done = at + 1;
    return true;
  });

  // A plot where there's time: only ever sent to Claude, never stored or shown.
  const plots = new Map<string, string>();
  const wanted = [...articles.entries()];
  await each(Math.ceil(wanted.length / WIKIPEDIA_PART), deadline, deps, 200, async (at) => {
    const part = wanted.slice(at * WIKIPEDIA_PART, (at + 1) * WIKIPEDIA_PART);
    const url = buildUrl('en.wikipedia.org', ['w', 'api.php'], [['action', 'query'], ['prop', 'extracts'], ['exintro', '1'], ['explaintext', '1'], ['exlimit', String(WIKIPEDIA_PART)], ['exchars', String(MAX_TEXT)], ['format', 'json'], ['redirects', '1'], ['titles', part.map(([, title]) => title.replace(/_/g, ' ')).join('|')]]);
    const answer = (await getJson(url, ['en.wikipedia.org'], deps)) as { query?: { pages?: Record<string, { title?: string; extract?: string }>; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] } };
    const renamed = new Map([...(answer.query?.normalized ?? []), ...(answer.query?.redirects ?? [])].map((one) => [one.to, one.from]));
    const byTitle = new Map(Object.values(answer.query?.pages ?? {}).map((page) => [page.title ?? '', page.extract ?? '']));
    for (const [qid, title] of part) {
      const wantedTitle = title.replace(/_/g, ' ');
      let extract = byTitle.get(wantedTitle);
      if (extract === undefined) for (const [to, from] of renamed) if (from === wantedTitle) extract = byTitle.get(to);
      if (extract) plots.set(qid, sanitiseText(extract, MAX_TEXT));
    }
    return true;
  });

  for (const row of listed.slice(0, done * WIKIDATA_PART)) {
    const found = factsOf.get(row.qid);
    if (!found || found.title.length === 0) continue;
    const plot = plots.get(row.qid);
    items.push({
      id: `wikidata:${row.qid}`,
      platform: 'wikidata',
      externalId: row.qid,
      host: null,
      kind: 'video',
      title: found.title,
      creator: found.creator,
      description: plot ? `${found.facts} ${plot}` : found.facts,
      tags: null,
      publishedAt: found.date,
      tmdbRef: `${kind}:${row.tmdb}`,
    });
  }
  offset += done * WIKIDATA_PART;
  return { items, state: { property, offset } };
}

/** TVmaze's index, 250 shows a page. Its summaries go to Claude; the page credits it, and its words are not shown. */
export async function readTvmaze(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  let page = typeof state.page === 'number' ? state.page : 0;
  let done = false;
  await each(1, deadline, deps, 0, async () => {
    let shows: unknown[];
    try {
      shows = (await getJson(buildUrl('api.tvmaze.com', ['shows'], [['page', String(page)]]), ['api.tvmaze.com'], deps)) as unknown[];
    } catch (error) {
      // A 404 is the end of the index. Anything else is tried again.
      if (error instanceof SafeFetchError && error.status === 404) done = true;
      return false;
    }
    if (!Array.isArray(shows)) return false;
    for (const doc of shows as { id?: unknown; name?: unknown; summary?: unknown; genres?: unknown; premiered?: unknown; type?: unknown; language?: unknown; network?: { name?: unknown } | null }[]) {
      if (typeof doc?.id !== 'number' || typeof doc.name !== 'string') continue;
      const genres = Array.isArray(doc.genres) ? doc.genres.filter((one): one is string => typeof one === 'string').slice(0, 6) : [];
      const facts = [`Show${typeof doc.type === 'string' ? ` (${doc.type})` : ''}.`, genres.length ? `Genres: ${genres.join(', ')}.` : '', typeof doc.language === 'string' ? `In ${doc.language}.` : ''].filter(Boolean).join(' ');
      const summary = sanitiseText(doc.summary, MAX_TEXT);
      items.push({
        id: `tvmaze:${doc.id}`,
        platform: 'tvmaze',
        externalId: String(doc.id),
        host: null,
        kind: 'video',
        title: sanitiseText(doc.name, 300),
        creator: typeof doc.network?.name === 'string' ? sanitiseText(doc.network.name, 200) : null,
        description: summary ? `${facts} ${summary}` : facts,
        tags: null,
        publishedAt: iso(doc.premiered),
        tmdbRef: null,
      });
    }
    page += 1;
    return true;
  });
  return { items, state: done ? { done: true } : { page } };
}

const READERS: Record<SweepSource, (state: Record<string, unknown>, deadline: number, deps: SweepDeps) => Promise<Read>> = {
  internet_archive: readArchive,
  peertube: readPeertube,
  openverse: readOpenverse,
  wikidata: readWikidata,
  tvmaze: readTvmaze,
};

/**
 * Where each source got to. The second round (2026-11-06): the first runs moved every source on while only the first 1,000 items of each run were sent, so
 * each starts again from the top. What's already held is skipped without being paid for (`web_pool_unknown`).
 */
const stateKey = (source: SweepSource) => `${source}@2`;

/** Reads every source at once, each stopping at the deadline. One source failing costs only its own rows. */
export async function readSources(state: SweepState, deadline: number, deps: SweepDeps): Promise<{ items: PoolCandidate[]; state: SweepState }> {
  const reads = await Promise.all(
    SWEEP_SOURCES.map(async (source) => {
      const place = state[stateKey(source)] ?? {};
      try {
        return { source, read: await READERS[source](place, deadline, deps) };
      } catch {
        return { source, read: { items: [], state: place } };
      }
    }),
  );
  return { items: reads.flatMap(({ read }) => read.items), state: Object.fromEntries(reads.map(({ source, read }) => [stateKey(source), read.state])) };
}

export type WordCount = { word: string; items: number; partners: Record<string, number> };
/** A row of `web_word_stats` holding how many items have been counted in all, which the page needs for its total. */
export const TOTAL_ROW = '#total';
const MAX_PARTNERS_SENT = 100;

/** One chunk of tagged items as word counts. Pure. */
export function countWords(rows: readonly { id: string; words: readonly string[] }[]): WordCount[] {
  const counts = new Map<string, { items: number; partners: Map<string, number> }>();
  for (const { words } of rows) {
    const once = [...new Set(words)];
    for (const word of once) {
      const entry = counts.get(word) ?? { items: 0, partners: new Map<string, number>() };
      entry.items += 1;
      for (const other of once) if (other !== word) entry.partners.set(other, (entry.partners.get(other) ?? 0) + 1);
      counts.set(word, entry);
    }
  }
  const out: WordCount[] = [...counts.entries()].map(([word, entry]) => ({
    word,
    items: entry.items,
    partners: Object.fromEntries([...entry.partners.entries()].sort(([a, one], [b, two]) => two - one || (a < b ? -1 : 1)).slice(0, MAX_PARTNERS_SENT)),
  }));
  if (rows.length > 0) out.push({ word: TOTAL_ROW, items: rows.filter((row) => row.words.length > 0).length, partners: {} });
  return out;
}

export type SweepStore = {
  spent(): Promise<number>;
  recordSpend(batchId: string, inputTokens: number, outputTokens: number, usd: number): Promise<void>;
  /** One run at a time. False: a run is still going. */
  claim(seconds: number): Promise<boolean>;
  unclaim(): Promise<void>;
  /** Takes the worst case before a batch exists. Null if it would pass the limit. */
  reserve(items: number, worstUsd: number, limitUsd: number): Promise<number | null>;
  reserved(reservation: number, batchId: string): Promise<void>;
  unreserve(reservation: number): Promise<void>;
  /** The next numbered part of a batch's word counts, and one part of them, counted once. */
  statsPlace(batchId: string): Promise<number>;
  addStats(batchId: string, part: number, stats: readonly WordCount[]): Promise<void>;
  room(): Promise<boolean>;
  state(): Promise<SweepState>;
  saveState(source: string, state: Record<string, unknown>): Promise<void>;
  unknown(ids: readonly string[]): Promise<string[]>;
  sent(batchId: string, rows: readonly PoolCandidate[]): Promise<void>;
  pending(): Promise<string[]>;
  outIn(batchId: string): Promise<string[]>;
  /** One chunk of answers. */
  collect(batchId: string, rows: readonly { id: string; words: string[] }[]): Promise<void>;
  /** What a finished batch left without words stops being out, and its worst case stops counting. Past the row limit, the oldest go. */
  release(batchId: string): Promise<void>;
};

export type SweepResult = { collected: number; sent: number; waiting: number; inputTokens: number; outputTokens: number; read?: Partial<Record<SweepSource, number>>; stopped?: 'spending limit' | 'database full'; busy?: true };

const COLLECT_CHUNK = 500;
const SMALLEST_CHUNK = 25;
/** A batch's word counts go in once, in parts this many words long, so a run cut short carries on and each word is rewritten once a batch. */
const STATS_PART = 200;

type Read_ = (state: SweepState, deadline: number) => Promise<{ items: PoolCandidate[]; state: SweepState }>;

/** One run, if no other is still going. */
export async function runSweep(client: Pick<Anthropic, 'messages'>, store: SweepStore, read: Read_, now: () => number = Date.now): Promise<SweepResult> {
  if (!(await store.claim(CLAIM_SECONDS))) return { collected: 0, sent: 0, waiting: 0, inputTokens: 0, outputTokens: 0, busy: true };
  try {
    return await oneRun(client, store, read, now);
  } finally {
    await store.unclaim().catch(() => undefined);
  }
}

/** Collect what has finished, then read and send the next items. Several batches can be out at once; each counts at its worst case until it's collected. */
async function oneRun(client: Pick<Anthropic, 'messages'>, store: SweepStore, read: Read_, now: () => number): Promise<SweepResult> {
  const startedAt = now();
  let collected = 0;
  let waiting = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const batchId of await store.pending()) {
    if (now() - startedAt > COLLECTING_TOO_LONG_MS) {
      waiting += 1;
      continue;
    }
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status !== 'ended') {
      waiting += 1;
      continue;
    }
    // Only what's still out, so a run that stopped halfway carries on rather than counting anything twice.
    const idFor = new Map((await store.outIn(batchId)).map((id) => [digestFor(id), id]));
    const rows: { id: string; words: string[] }[] = [];
    const counted: { id: string; words: string[] }[] = [];
    let batchInput = 0;
    let batchOutput = 0;
    for await (const result of await client.messages.batches.results(batchId)) {
      if (result.result.type !== 'succeeded') continue;
      batchInput += result.result.message.usage.input_tokens;
      batchOutput += result.result.message.usage.output_tokens;
      if (result.result.message.stop_reason === 'refusal') continue;
      const answer = result.result.message.content.find((block) => block.type === 'text');
      const words = answer?.type === 'text' ? cleanWords(answer.text) : null;
      const id = idFor.get(result.custom_id);
      if (words !== null) counted.push({ id: result.custom_id, words });
      if (words !== null && id !== undefined) rows.push({ id, words });
    }
    inputTokens += batchInput;
    outputTokens += batchOutput;
    await store.recordSpend(batchId, batchInput, batchOutput, batchCost(batchInput, batchOutput));
    // A chunk the database's short time limit refuses is tried in halves, so one big chunk can't stop the job for good.
    const collectChunk = async (chunk: typeof rows): Promise<void> => {
      try {
        await store.collect(batchId, chunk);
      } catch (error) {
        if (chunk.length <= SMALLEST_CHUNK) throw error;
        const middle = Math.floor(chunk.length / 2);
        await collectChunk(chunk.slice(0, middle));
        await collectChunk(chunk.slice(middle));
      }
    };
    for (let start = 0; start < rows.length; start += COLLECT_CHUNK) await collectChunk(rows.slice(start, start + COLLECT_CHUNK));
    // Counted from every answer, sorted, so a run cut short works out the same parts again and carries on from the next one.
    const stats = countWords(counted).sort((a, b) => (a.word < b.word ? -1 : 1));
    const parts = Math.ceil(stats.length / STATS_PART);
    for (let part = await store.statsPlace(batchId); part < parts; part += 1) await store.addStats(batchId, part, stats.slice(part * STATS_PART, (part + 1) * STATS_PART));
    await store.release(batchId);
    collected += rows.length;
  }

  if (waiting >= MAX_OUT) return { collected, sent: 0, waiting, inputTokens, outputTokens };

  const limit = SWEEP_LIMIT_USD - OTHER_JOBS_IN_FLIGHT_USD;
  const spent = await store.spent();
  if (spent >= limit) return { collected, sent: 0, waiting, inputTokens, outputTokens, stopped: 'spending limit' };
  if (!(await store.room())) return { collected, sent: 0, waiting, inputTokens, outputTokens, stopped: 'database full' };

  if (now() - startedAt > COLLECTING_TOO_LONG_MS) return { collected, sent: 0, waiting, inputTokens, outputTokens };

  const found = await read(await store.state(), now() + READ_FOR_MS);
  // Once each, however many sources or pages it came from, and nothing the site already holds.
  const unique = [...new Map(found.items.map((item) => [item.id, item])).values()].slice(0, MAX_BATCH);
  const fresh = new Set(unique.length === 0 ? [] : await store.unknown(unique.map((item) => item.id)));
  const items: PoolCandidate[] = [];
  let worst = 0;
  let heldBack = false;
  for (const item of unique) {
    if (!fresh.has(item.id)) continue;
    const cost = worstCaseCost(item);
    if (spent + worst + cost > limit) {
      heldBack = true;
      break;
    }
    worst += cost;
    items.push(item);
  }
  const counts: Partial<Record<SweepSource, number>> = {};
  for (const item of items) counts[item.platform] = (counts[item.platform] ?? 0) + 1;

  const saveAll = async () => {
    for (const [source, state] of Object.entries(found.state)) await store.saveState(source, state);
  };
  if (items.length === 0) {
    // Held back by the limit means these items weren't sent, so the place stays where it was.
    if (!heldBack) await saveAll();
    return { collected, sent: 0, waiting, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}) };
  }

  // Taken before the batch exists, all at once in the database, so the limit holds whatever else is out.
  const reservation = await store.reserve(items.length, worst, limit);
  if (reservation === null) return { collected, sent: 0, waiting, inputTokens, outputTokens, read: counts, stopped: 'spending limit' };
  let batch: { id: string };
  try {
    // Never retried by itself: a retry after a lost answer would pay for the same items twice.
    batch = await client.messages.batches.create({ requests: items.map(requestFor) }, { maxRetries: 0 });
  } catch (error) {
    // Only an outright refusal gives the money back. With no answer at all the batch may exist, so its worst case stays counted.
    if ((error as { status?: unknown }).status !== undefined) await store.unreserve(reservation).catch(() => undefined);
    throw error;
  }
  const mark = async () => {
    await store.reserved(reservation, batch.id);
    await store.sent(batch.id, items);
  };
  try {
    await mark().catch(mark);
  } catch (error) {
    // A batch nothing remembers would be paid for and never read.
    await client.messages.batches.cancel(batch.id).catch(() => undefined);
    throw error;
  }
  if (!heldBack) await saveAll();
  return { collected, sent: items.length, waiting: waiting + 1, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}) };
}

/** The same digest `requestFor` puts in a request's custom id. */
function digestFor(id: string): string {
  return requestFor({ id, kind: 'other', title: '', creator: null, description: null, tags: null }).custom_id;
}

const SENT_CHUNK = 1000;
const API_ROWS = 1000;

/** The store, through the lock-checking database functions (supabase/migrations/*_web_pool.sql): no server key needed. */
export function makeSweepStore(db: SupabaseClient, lock: string): SweepStore {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, { p_secret: lock, ...args });
    if (error) throw new Error('TAGGING_DATABASE');
    return data as T;
  };
  return {
    // Spent, plus the worst of everything out.
    spent: async () => Number(await call<number | string>('web_tag_committed', {})),
    recordSpend: async (batchId, inputTokens, outputTokens, usd) => {
      await call('web_tag_spend_add', { p_batch: batchId, p_input: inputTokens, p_output: outputTokens, p_usd: usd });
    },
    claim: (seconds) => call<boolean>('web_sweep_claim', { p_seconds: seconds }),
    unclaim: async () => {
      await call('web_sweep_unclaim', {});
    },
    reserve: async (items, worstUsd, limitUsd) => {
      const made = await call<number | string | null>('web_sweep_reserve', { p_items: items, p_worst: worstUsd, p_limit: limitUsd });
      return made === null ? null : Number(made);
    },
    reserved: async (reservation, batchId) => {
      await call('web_sweep_reserved', { p_id: reservation, p_batch: batchId });
    },
    unreserve: async (reservation) => {
      await call('web_sweep_unreserve', { p_id: reservation });
    },
    statsPlace: (batchId) => call<number>('web_sweep_stats_place', { p_batch: batchId }),
    addStats: async (batchId, part, stats) => {
      await call('web_sweep_stats_add', { p_batch: batchId, p_part: part, p_stats: stats });
    },
    room: () => call<boolean>('web_pool_room', {}),
    state: async () => {
      const rows = await call<{ source: string; state: Record<string, unknown> }[]>('web_sweep_state_read', {});
      return Object.fromEntries(rows.map((row) => [row.source, row.state]));
    },
    saveState: async (source, state) => {
      await call('web_sweep_state_write', { p_source: source, p_state: state });
    },
    // The API answers at most 1,000 rows a call, so each call asks about at most that many.
    unknown: async (ids) => {
      const out: string[] = [];
      for (let start = 0; start < ids.length; start += API_ROWS) out.push(...(await call<string[]>('web_pool_unknown', { p_ids: ids.slice(start, start + API_ROWS) })));
      return out;
    },
    sent: async (batchId, rows) => {
      for (let start = 0; start < rows.length; start += SENT_CHUNK) {
        const part = rows.slice(start, start + SENT_CHUNK).map((row) => ({
          id: row.id,
          platform: row.platform,
          externalId: row.externalId,
          host: row.host,
          kind: row.kind,
          title: row.title,
          creator: row.creator,
          publishedAt: row.publishedAt,
          tmdbRef: row.tmdbRef,
        }));
        await call('web_pool_sent', { p_batch: batchId, p_rows: part });
      }
    },
    pending: () => call<string[]>('web_pool_pending', {}),
    // Likewise, a page at a time, for a batch bigger than one answer.
    outIn: async (batchId) => {
      const out: string[] = [];
      for (let start = 0; start < MAX_BATCH; start += API_ROWS) {
        const { data, error, status } = await db.rpc('web_pool_out', { p_secret: lock, p_batch: batchId }).range(start, start + API_ROWS - 1);
        if (error) throw Object.assign(new Error('TAGGING_DATABASE'), { name: `database web_pool_out ${status}` });
        const rows = (data ?? []) as unknown as string[];
        out.push(...rows);
        if (rows.length < API_ROWS) break;
      }
      return [...new Set(out)];
    },
    collect: async (batchId, rows) => {
      await call('web_pool_collect', { p_batch: batchId, p_rows: rows, p_stats: [] });
    },
    release: async (batchId) => {
      await call('web_pool_release', { p_batch: batchId });
    },
  };
}
