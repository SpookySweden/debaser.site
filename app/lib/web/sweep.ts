import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toWebItem as archiveItem } from './adapters/internet-archive';
import { toWebItem as openverseItem } from './adapters/openverse';
import { decodePoolFile, encodePoolFile, ITEMS_PER_FILE, POOL_BUCKET, wordsIn, type PoolFileRow } from './pool-files';
import { poolStore } from './pool-store';
import { safeFetchJson, SafeFetchError, buildUrl, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { toWebItem as peertubeItem } from './search/providers/peertube';
import { batchCost, cleanWords, requestFor, worstCaseCost, type TaggableItem } from './tagging';
import type { WebItem } from './types';

/**
 * The catalogue sweep (Luke, 2026-11-05; SPEC-discover.md): open catalogues read through their public APIs, tagged by Claude through the
 * Message Batches API, and counted. Run by /api/web/sweep every two minutes (Luke's ramp, 2026-11-06). SERVER ONLY. Past the row limit items are
 * kept as compressed files (pool-files.ts): what stays in the database is each word's count and closest words, which files hold which words, and a sample of rows.
 *
 * This file reads the five sources below: a film's facts come from Wikidata (CC0), a show's from TVmaze (CC BY-SA), and a plot from Wikipedia
 * (CC BY-SA), which goes to Claude and is never stored or shown. A title's TMDB number comes from Wikidata.
 *
 * Every source is read gently: a fixed agent naming this project and no person, a pause between calls, and a 429 stops that source for the run.
 */

export const SWEEP_SOURCES = ['internet_archive', 'peertube', 'openverse', 'wikidata', 'tvmaze'] as const;
export type SweepSource = (typeof SWEEP_SOURCES)[number];

/** Luke's limit, the whole of it (2026-11-06). Everything out counts at its worst case, so what's in flight can't pass it. */
export const SWEEP_LIMIT_USD = 60;
/** What the tagging job and the word pass may have out at worst, which the sweep leaves them. */
const OTHER_JOBS_IN_FLIGHT_USD = 0.6;
/**
 * Batches out at once. Claude's API lets about 200,000 requests wait in its queue (measured: it refused the 8th batch with a 429), and a batch of 27,000 takes 20 to 25 minutes, so this is what
 * caps the rate. Seven is as many as fit, and the job doesn't read pages it would only have to read again.
 */
export const MAX_OUT = 7;
/** The most one batch holds: more than a run can read, so no read item is cut. */
const MAX_BATCH = 35_000;
/** Batches sent before the files, whose rows are in the table, at most this many a batch (`web_pool_out`). */
const MAX_BATCH_IN_ROWS = 6000;
/**
 * A run lives inside the route's 240 seconds, and a batch created but not yet marked is paid for and forgotten if it's cut off, so collecting stops
 * starting new batches this long into a run, reading lasts this long, and a run that spent long collecting doesn't read at all. It reads next time.
 */
const COLLECTING_TOO_LONG_MS = 100_000;
const READ_FOR_MS = 60_000;
/** How long a run holds the job. Past the route's limit, so a run that was cut off lets go by itself. */
const CLAIM_SECONDS = 245;
const AGENT = 'DebaserSiteSweep/1.0 (+https://github.com/SpookySweden/debaser.site)';

/** The collections Luke named on 2026-11-05 are read first. */
export const ARCHIVE_COLLECTIONS = ['librivoxaudio', 'prelinger', 'feature_films', 'etree', 'oldtimeradio', 'classic_tv', 'animationandcartoons', 'silent_films'] as const;
/**
 * Then everything public (Luke, 2026-11-06: "Everything public"): 74 million items, skipping adult-flagged, restricted and dark ones, and the named collections,
 * already read and paid for. The $60 reaches about 2% of that, and the Archive lists by name, so reading from the top would be only names starting with a digit.
 * So it takes turns through the first letters, each with its own place, and what gets tagged is a spread.
 */
export const ARCHIVE_WIDER = `mediatype:(movies OR audio OR texts OR image) AND NOT collection:(no-preview OR adult OR TrumpDCInsurrectionJan062021 OR ${ARCHIVE_COLLECTIONS.join(' OR ')}) AND NOT access-restricted-item:true AND NOT noindex:true AND NOT nsfw:true`;
const ARCHIVE_FIRST_LETTERS = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
/** Few big calls rather than many small ones, as it asks: 5,000 rows take 8 seconds. */
const ARCHIVE_ROWS = 5000;
const ARCHIVE_CALLS = 4;
const PEERTUBE_ROWS = 100;
const PEERTUBE_CALLS = 30;
/** Sepia refuses a `start` of 9,000 or more, so from there it goes on from the oldest date it reached, with `endDate`. */
const PEERTUBE_DEEPEST = 9000;
const OPENVERSE_CALLS = 3;
/** Openverse states 200 requests a day without a key, which MEDIA's own reads share. The job runs every two minutes, so it counts them. */
const OPENVERSE_PER_DAY = 60;
const WIKIDATA_FILMS = 1000;
const WIKIDATA_PART = 100;
/** TVmaze allows 20 calls per 10 seconds. One a second is half that. */
const TVMAZE_CALLS = 20;
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
  safeFetchJson(url, { allowedHosts: hosts, fetchImpl: deps.fetch, userAgent: AGENT, maxBytes: 16 * 1024 * 1024, timeoutMs: 25_000, ...(accept ? { accept } : {}) });

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
  let wider = state.wider === true;
  let done = false;
  // On the wider list: whose turn, and each first letter's own place. A letter that's finished holds `false`.
  let turn = typeof state.turn === 'number' ? state.turn : 0;
  const places: Record<string, string | false> = { ...((state.places as Record<string, string | false> | undefined) ?? {}) };
  const nextLetter = () => {
    for (let step = 0; step < ARCHIVE_FIRST_LETTERS.length; step += 1) {
      const letter = ARCHIVE_FIRST_LETTERS[(turn + step) % ARCHIVE_FIRST_LETTERS.length];
      if (places[letter] !== false) {
        turn = (turn + step) % ARCHIVE_FIRST_LETTERS.length;
        return letter;
      }
    }
    return null;
  };
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(ARCHIVE_CALLS, deadline, deps, 1000, async () => {
    const letter = wider ? nextLetter() : null;
    if (wider && letter === null) {
      done = true;
      return false;
    }
    const place = letter === null ? cursor : (places[letter] as string | undefined) ?? null;
    const q = letter === null ? `collection:(${ARCHIVE_COLLECTIONS.join(' OR ')})` : `${ARCHIVE_WIDER} AND identifier:${letter}*`;
    const query: [string, string][] = [['q', q], ['fields', ARCHIVE_FIELDS.join(',')], ['count', String(rows)]];
    if (place) query.push(['cursor', place]);
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
    const next = typeof answer.cursor === 'string' ? answer.cursor : null;
    rows = ARCHIVE_ROWS;
    if (letter !== null) {
      // A letter's end stops that letter, for good: going round would pay again.
      places[letter] = next ?? false;
      turn = (turn + 1) % ARCHIVE_FIRST_LETTERS.length;
      return true;
    }
    cursor = next;
    // The end of the named collections: on to the wider list.
    if (cursor === null) {
      wider = true;
      return false;
    }
    return true;
  });
  if (done) return { items, state: { done: true } };
  return { items, state: wider ? { wider: true, rows, turn, places } : { cursor, rows } };
}

/** PeerTube through Sepia Search, newest first, safe-for-work only, on instances in the public index. */
export async function readPeertube(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  if (state.done === true) return { items, state };
  let start = typeof state.start === 'number' ? state.start : 0;
  let before = typeof state.before === 'string' ? state.before : null;
  // Items at exactly the date it went back from come round again, and rows no longer say what's held, so it remembers them.
  let edge = new Set(Array.isArray(state.edge) ? state.edge.filter((one): one is string => typeof one === 'string') : []);
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
    const read: { id: string; at: string | null }[] = [];
    for (const doc of docs) {
      const item = peertubeItem(doc, deps.peertubeHosts, fetchedAt);
      if (item === null) continue;
      read.push({ id: item.externalId, at: iso((doc as { publishedAt?: unknown }).publishedAt) });
      if (!edge.has(item.externalId)) items.push(fromWebItem(item, 'peertube', new URL(item.url).hostname));
    }
    start += docs.length;
    if (docs.length === 0) done = true;
    if (start + PEERTUBE_ROWS > PEERTUBE_DEEPEST) {
      // The same date twice means it can't get further.
      const oldest = iso((docs[docs.length - 1] as { publishedAt?: unknown } | undefined)?.publishedAt);
      if (oldest === null || oldest === before) done = true;
      before = oldest;
      start = 0;
      edge = new Set(read.filter((one) => one.at === oldest).map((one) => one.id));
    }
    return docs.length > 0 && !done;
  });
  return { items, state: done ? { done: true } : { start, ...(before !== null ? { before, edge: [...edge] } : {}) } };
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
  // Half the run for facts and a gap as long as each call, which keeps to half of Wikidata's 60 seconds of query time a minute; the rest for plots.
  const startedFacts = (deps.now ?? Date.now)();
  await each(parts.length, startedFacts + (deadline - startedFacts) * 0.7, deps, 2500, async (at) => {
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
  await each(TVMAZE_CALLS, deadline, deps, 1000, async () => {
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
/** The map uses 30 closest words at most. A pair seen once in a big batch says nothing, and writing it is most of what fills the database's time. */
const MAX_PARTNERS_SENT = 30;
const BIG_BATCH = 1000;

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
    partners: Object.fromEntries([...entry.partners.entries()].filter(([, count]) => rows.length < BIG_BATCH || count >= 2).sort(([a, one], [b, two]) => two - one || (a < b ? -1 : 1)).slice(0, MAX_PARTNERS_SENT)),
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
  pending(): Promise<string[]>;
  outIn(batchId: string): Promise<string[]>;
  /** A file in the pool's bucket. Null if there's no such file. */
  putFile(path: string, file: Uint8Array): Promise<void>;
  getFile(path: string): Promise<Uint8Array | null>;
  removeFile(path: string): Promise<void>;
  /** Registers a file written, so lists can find it by its words. Twice changes nothing. */
  fileAdd(path: string, items: number, words: readonly string[]): Promise<void>;
  /** A sample of a batch as rows, for the map's own list. */
  hotAdd(rows: readonly PoolFileRow[]): Promise<void>;
  /** Rows sent before the files, copied in a little at a time. */
  unfiled(limit: number): Promise<PoolFileRow[]>;
  filed(ids: readonly string[]): Promise<void>;
  /** One chunk of answers. */
  collect(batchId: string, rows: readonly { id: string; words: string[] }[]): Promise<void>;
  /** What a finished batch left without words stops being out, and its worst case stops counting. Past the row limit, the oldest go. */
  release(batchId: string): Promise<void>;
};

export type SweepResult = { collected: number; sent: number; waiting: number; inputTokens: number; outputTokens: number; read?: Partial<Record<SweepSource, number>>; stopped?: 'spending limit' | 'database full'; busy?: true; noWords?: number; collectFailed?: string };

const COLLECT_CHUNK = 500;
const SMALLEST_CHUNK = 25;
/** A batch's word counts go in once, in numbered parts, so a run cut short carries on. A part stays small enough for the database's few seconds a statement, as a word and its closest words. */
const STATS_PART_SIZE = 600;

/** The same counts always make the same parts, so a run that was cut short carries on from the right place. */
export function statsParts(stats: readonly WordCount[]): WordCount[][] {
  const parts: WordCount[][] = [];
  let size = 0;
  for (const one of stats) {
    const weight = 1 + Object.keys(one.partners).length;
    if (parts.length === 0 || size + weight > STATS_PART_SIZE) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(one);
    size += weight;
  }
  return parts;
}
/** Of each batch, this many stay as rows for the map's own list. */
const HOT_PER_BATCH = 200;
/** The rows sent before the files, moved over in files this size, this many a run. */
const UNFILED_FILE = 1000;
const UNFILED_PER_RUN = 10;

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
  // Answers that came back unusable, or not at all, which are said rather than lost quietly. Not sent again: there's more to read than the money can tag.
  let noWords = 0;
  let collectFailed: string | null = null;
  const said = () => ({ ...(noWords > 0 ? { noWords } : {}), ...(collectFailed !== null ? { collectFailed } : {}) });

  for (const batchId of await store.pending()) {
    if (now() - startedAt > COLLECTING_TOO_LONG_MS) {
      waiting += 1;
      continue;
    }
    let unfinished = false;
    // One batch the database can't take in right now mustn't stop the rest of the job: it stopped everything for ten minutes once. It carries on from its place next run.
    try {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status !== 'ended') {
      waiting += 1;
      continue;
    }
    // Only what's still out, so a run that stopped halfway carries on rather than counting anything twice.
    const outFile = await store.getFile(outPath(batchId));
    const heldOut = outFile === null ? null : decodePoolFile(outFile);
    const fromFile = new Map((heldOut ?? []).map((row) => [digestFor(idOf(row)), row]));
    const idFor = new Map((heldOut === null ? await store.outIn(batchId) : []).map((id) => [digestFor(id), id]));
    const wordsFor = new Map<PoolFileRow, string[]>();
    const rows: { id: string; words: string[] }[] = [];
    const counted: { id: string; words: string[] }[] = [];
    let batchInput = 0;
    let batchOutput = 0;
    for await (const result of await client.messages.batches.results(batchId)) {
      if (result.result.type !== 'succeeded') {
        noWords += 1;
        continue;
      }
      batchInput += result.result.message.usage.input_tokens;
      batchOutput += result.result.message.usage.output_tokens;
      if (result.result.message.stop_reason === 'refusal') {
        noWords += 1;
        continue;
      }
      const answer = result.result.message.content.find((block) => block.type === 'text');
      const words = answer?.type === 'text' ? cleanWords(answer.text) : null;
      const id = idFor.get(result.custom_id);
      if (words === null) noWords += 1;
      if (words !== null) counted.push({ id: result.custom_id, words });
      if (words !== null && id !== undefined) rows.push({ id, words });
      const fileRow = fromFile.get(result.custom_id);
      if (words !== null && fileRow !== undefined) wordsFor.set(fileRow, words);
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
    const parts = statsParts(countWords(counted).sort((a, b) => (a.word < b.word ? -1 : 1)));
    for (let part = await store.statsPlace(batchId); part < parts.length; part += 1) {
      // Out of time: it carries on from this part next run.
      if (now() - startedAt > COLLECTING_TOO_LONG_MS) {
        unfinished = true;
        break;
      }
      await store.addStats(batchId, part, parts[part]);
    }
    if (unfinished) {
      waiting += 1;
      continue;
    }
    if (heldOut !== null) {
      // In the order of the file sent, so a run cut short writes the same files again.
      const tagged = heldOut.filter((row) => wordsFor.has(row)).map((row) => ({ ...row, words: wordsFor.get(row) as string[] }));
      for (let at = 0; at * ITEMS_PER_FILE < tagged.length; at += 1) {
        const part = tagged.slice(at * ITEMS_PER_FILE, (at + 1) * ITEMS_PER_FILE);
        const path = `s/${batchId}-${at}.br`;
        await store.putFile(path, encodePoolFile(part));
        await store.fileAdd(path, part.length, wordsIn(part));
      }
      const every = Math.max(1, Math.ceil(tagged.length / HOT_PER_BATCH));
      await store.hotAdd(tagged.filter((_, at) => at % every === 0));
      collected += tagged.length;
    }
    await store.release(batchId);
    if (heldOut !== null) await store.removeFile(outPath(batchId)).catch(() => undefined);
    collected += rows.length;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'TAGGING_DATABASE')) throw error;
      waiting += 1;
      collectFailed = (error as Error & { failed?: string }).failed ?? 'unknown';
    }
  }

  // What was sent before the files existed moves over, so those rows can go past the row limit without being lost.
  for (let at = 0; at < UNFILED_PER_RUN && now() - startedAt <= COLLECTING_TOO_LONG_MS; at += 1) {
    const part = await store.unfiled(UNFILED_FILE);
    if (part.length === 0) break;
    const path = `b/${digestFor(idOf(part[0]))}.br`;
    await store.putFile(path, encodePoolFile(part));
    await store.fileAdd(path, part.length, wordsIn(part));
    await store.filed(part.map(idOf));
  }

  if (waiting >= MAX_OUT) return { collected, sent: 0, waiting, inputTokens, outputTokens, ...said() };

  const limit = SWEEP_LIMIT_USD - OTHER_JOBS_IN_FLIGHT_USD;
  const spent = await store.spent();
  if (spent >= limit) return { collected, sent: 0, waiting, inputTokens, outputTokens, stopped: 'spending limit', ...said() };
  if (!(await store.room())) return { collected, sent: 0, waiting, inputTokens, outputTokens, stopped: 'database full', ...said() };

  if (now() - startedAt > COLLECTING_TOO_LONG_MS) return { collected, sent: 0, waiting, inputTokens, outputTokens, ...said() };

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
    // Nothing was sent, so the place stays where it was if the limit stopped it.
    if (!heldBack) await saveAll();
    return { collected, sent: 0, waiting, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}), ...said() };
  }

  // Taken before the batch exists, all at once in the database, so the limit holds whatever else is out.
  const reservation = await store.reserve(items.length, worst, limit);
  if (reservation === null) return { collected, sent: 0, waiting, inputTokens, outputTokens, read: counts, stopped: 'spending limit', ...said() };
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
    // What's needed when the answers come back, as a file, not a row each. Descriptions go to Claude and are not kept.
    await store.putFile(outPath(batch.id), encodePoolFile(items.map((item) => ({ platform: item.platform, externalId: item.externalId, host: item.host, kind: item.kind, title: item.title, creator: item.creator, publishedAt: item.publishedAt, tmdbRef: item.tmdbRef, words: [] }))));
  };
  try {
    await mark().catch(mark);
  } catch (error) {
    // A batch nothing remembers would be paid for and never read. If it never got its row, cancelled means nothing's owed, so the row goes rather than
    // holding its worst case for good. If it got one, the next run collects what the cancelled batch cost.
    await client.messages.batches.cancel(batch.id).catch(() => undefined);
    await store.unreserve(reservation).catch(() => undefined);
    throw error;
  }
  // Moved on even past items the limit held back: reading them again would send the rest of this batch twice, and there's more to read than the money can tag.
  await saveAll();
  return { collected, sent: items.length, waiting: waiting + 1, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}), ...said() };
}

const idOf = (row: Pick<PoolFileRow, 'platform' | 'externalId'>) => `${row.platform}:${row.externalId}`;
const outPath = (batchId: string) => `out/${batchId}.br`;

/** The same digest `requestFor` puts in a request's custom id. */
function digestFor(id: string): string {
  return requestFor({ id, kind: 'other', title: '', creator: null, description: null, tags: null }).custom_id;
}

const API_ROWS = 1000;

/** The store, through the lock-checking database functions (supabase/migrations/*_web_pool.sql): no server key needed. */
export function makeSweepStore(db: SupabaseClient, lock: string): SweepStore {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, { p_secret: lock, ...args });
    // Which call and its code, so a failed run's answer says where it stopped. Never the message.
    if (error) throw Object.assign(new Error('TAGGING_DATABASE'), { failed: `${name} ${error.code ?? 'no code'}` });
    return data as T;
  };
  // Supabase Storage, or Cloudflare R2 in front of it once its settings are there (pool-store.ts).
  const files = poolStore({
    // The bucket checks the lock from the header this client was made with (the route's client).
    put: async (path, file) => {
      const { error } = await db.storage.from(POOL_BUCKET).upload(path, file, { upsert: true, contentType: 'application/octet-stream' });
      if (error) throw Object.assign(new Error('TAGGING_DATABASE'), { failed: `put file ${(error as { statusCode?: string }).statusCode ?? 'no code'}` });
    },
    get: async (path) => {
      const { data, error } = await db.storage.from(POOL_BUCKET).download(path);
      if (error) {
        // Only "not found". The storage API answers 400 to everything, so anything else stops the run rather than treating a paid batch as having no rows.
        if ((error as { statusCode?: string }).statusCode === '404') return null;
        throw Object.assign(new Error('TAGGING_DATABASE'), { failed: `get file ${(error as { statusCode?: string }).statusCode ?? 'no code'}` });
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    remove: async (path) => {
      await db.storage.from(POOL_BUCKET).remove([path]);
    },
  });
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
    pending: () => call<string[]>('web_pool_pending', {}),
    putFile: (path, file) => files.put(path, file),
    getFile: (path) => files.get(path),
    removeFile: (path) => files.remove(path),
    fileAdd: async (path, items, words) => {
      await call('web_pool_shard_add', { p_path: path, p_items: items, p_words: [...words] });
    },
    hotAdd: async (rows) => {
      await call('web_pool_hot_add', { p_rows: rows.map((row) => ({ ...row, id: idOf(row) })) });
    },
    unfiled: async (limit) => {
      const rows = await call<{ id: string; platform: string; external_id: string; host: string | null; kind: string; title: string; creator: string | null; published_at: string | null; tmdb_ref: string | null; words: string[] }[]>('web_pool_unfiled', { p_limit: limit });
      return rows.map((row) => ({ platform: row.platform, externalId: row.external_id, host: row.host, kind: row.kind, title: row.title, creator: row.creator, publishedAt: row.published_at, tmdbRef: row.tmdb_ref, words: row.words }));
    },
    filed: async (ids) => {
      await call('web_pool_filed', { p_ids: [...ids] });
    },
    // Likewise, a page at a time, for a batch bigger than one answer.
    outIn: async (batchId) => {
      const out: string[] = [];
      for (let start = 0; start < MAX_BATCH_IN_ROWS; start += API_ROWS) {
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
