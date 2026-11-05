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
 * Message Batches API, and counted. Run by /api/web/sweep every three hours. SERVER ONLY. Most items are then dropped: what stays is each
 * word's count and closest words, and the newest 100,000 rows that can be offered to people.
 *
 * **Nothing from TMDB goes to Claude.** TMDB's terms exclude AI use, so this file reads only the five sources below; a film's facts come from
 * Wikidata (CC0), a show's from TVmaze (CC BY-SA), and a plot from Wikipedia (CC BY-SA), which goes to Claude and is never stored or shown.
 * A title's TMDB number may be kept, because it comes from Wikidata and is only a number.
 *
 * Every source is read gently: a fixed agent naming this project and no person, a pause between calls, and a 429 stops that source for the run.
 */

export const SWEEP_SOURCES = ['internet_archive', 'peertube', 'openverse', 'wikidata', 'tvmaze'] as const;
export type SweepSource = (typeof SWEEP_SOURCES)[number];

/** Luke's split of the $60: the sweep stops here, so what people really see in MEDIA keeps getting tagged. */
export const SWEEP_LIMIT_USD = 50;
/** The most one batch holds, which `web_pool_out` must be able to return. */
const MAX_BATCH = 5500;
/** How long a run spends reading, so the batch still goes out inside the route's minute. */
const READ_BUDGET_MS = 25_000;
const AGENT = 'DebaserSiteSweep/1.0 (+https://github.com/SpookySweden/debaser.site)';

/** Named collections only (Luke, 2026-11-05): the open upload areas can hold adult or copied material, and these rows get offered to people. */
export const ARCHIVE_COLLECTIONS = ['librivoxaudio', 'prelinger', 'feature_films', 'etree', 'oldtimeradio', 'classic_tv', 'animationandcartoons', 'silent_films'] as const;
const ARCHIVE_ROWS = 1000;
const ARCHIVE_CALLS = 4;
const PEERTUBE_ROWS = 100;
const PEERTUBE_CALLS = 10;
const OPENVERSE_CALLS = 3;
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
  let cursor = typeof state.cursor === 'string' ? state.cursor : null;
  const q = `collection:(${ARCHIVE_COLLECTIONS.join(' OR ')})`;
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(ARCHIVE_CALLS, deadline, deps, 1000, async () => {
    const query: [string, string][] = [['q', q], ['fields', ARCHIVE_FIELDS.join(',')], ['count', String(ARCHIVE_ROWS)]];
    if (cursor) query.push(['cursor', cursor]);
    const answer = (await getJson(buildUrl('archive.org', ['services', 'search', 'v1', 'scrape'], query), ['archive.org'], deps)) as { items?: unknown[]; cursor?: unknown };
    for (const doc of answer.items ?? []) {
      const item = archiveItem(doc, fetchedAt);
      if (item === null) continue;
      const subject = (doc as { subject?: unknown }).subject;
      const tags = (Array.isArray(subject) ? subject : typeof subject === 'string' ? subject.split(';') : []).filter((one): one is string => typeof one === 'string').slice(0, 20);
      items.push({ ...fromWebItem(item, 'internet_archive', null), tags });
    }
    cursor = typeof answer.cursor === 'string' ? answer.cursor : null;
    return cursor !== null;
  });
  return { items, state: { cursor } };
}

/** PeerTube through Sepia Search, newest first, safe-for-work only, on instances in the public index. */
export async function readPeertube(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  let start = typeof state.start === 'number' ? state.start : 0;
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(PEERTUBE_CALLS, deadline, deps, 500, async () => {
    const url = buildUrl('sepiasearch.org', ['api', 'v1', 'search', 'videos'], [['count', String(PEERTUBE_ROWS)], ['start', String(start)], ['sort', '-publishedAt'], ['nsfw', 'false']]);
    const answer = (await getJson(url, ['sepiasearch.org'], deps)) as { data?: unknown[] };
    const docs = answer.data ?? [];
    for (const doc of docs) {
      const item = peertubeItem(doc, deps.peertubeHosts, fetchedAt);
      if (item !== null) items.push(fromWebItem(item, 'peertube', new URL(item.url).hostname));
    }
    start += docs.length;
    if (docs.length === 0) start = 0;
    return docs.length > 0;
  });
  return { items, state: { start } };
}

/** Openverse states 200 requests a day without a key, which MEDIA's searches share, so a few pages a run. */
export async function readOpenverse(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  let page = typeof state.page === 'number' ? state.page : 1;
  let media: 'audio' | 'images' = state.media === 'images' ? 'images' : 'audio';
  const fetchedAt = new Date((deps.now ?? Date.now)()).toISOString();
  await each(OPENVERSE_CALLS, deadline, deps, 3000, async () => {
    const url = buildUrl('api.openverse.org', ['v1', media, ''], [['page_size', '20'], ['page', String(page)]]);
    let docs: unknown[] = [];
    try {
      docs = ((await getJson(url, ['api.openverse.org'], deps)) as { results?: unknown[] }).results ?? [];
    } catch (error) {
      // Past the last page it may read: start the other kind from the top next time. A 429 stops here.
      if (error instanceof SafeFetchError && error.status === 429) return false;
      media = media === 'audio' ? 'images' : 'audio';
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
  return { items, state: { page, media } };
}

type Binding = Record<string, { value?: string } | undefined>;
const text = (row: Binding, name: string): string => row[name]?.value ?? '';
const list = (row: Binding, name: string, most: number): string[] => text(row, name).split('|').map((one) => one.trim()).filter(Boolean).slice(0, most);

/** Films and shows that Wikidata lists a TMDB number for: their facts from Wikidata, a plot from Wikipedia to give Claude something to read. */
export async function readWikidata(state: Record<string, unknown>, deadline: number, deps: SweepDeps): Promise<Read> {
  const items: PoolCandidate[] = [];
  const property = state.property === 'P4983' ? 'P4983' : 'P4947';
  let offset = typeof state.offset === 'number' ? state.offset : 0;
  const hosts = ['query.wikidata.org'];
  const ask = (sparql: string) => getJson(buildUrl('query.wikidata.org', ['sparql'], [['query', sparql], ['format', 'json']]), hosts, deps, 'application/sparql-results+json') as Promise<{ results?: { bindings?: Binding[] } }>;

  let listed: { qid: string; tmdb: string }[] = [];
  try {
    const answer = await ask(`SELECT ?item ?tmdb WHERE { ?item wdt:${property} ?tmdb . } LIMIT ${WIKIDATA_FILMS} OFFSET ${offset}`);
    listed = (answer.results?.bindings ?? [])
      .map((row) => ({ qid: text(row, 'item').split('/').pop() ?? '', tmdb: text(row, 'tmdb') }))
      .filter((row) => /^Q[0-9]{1,12}$/.test(row.qid) && /^[0-9]{1,12}$/.test(row.tmdb));
  } catch {
    return { items, state: { property, offset } };
  }
  if (listed.length === 0) {
    // The end of films: on to shows, and round again.
    return { items, state: { property: property === 'P4947' ? 'P4983' : 'P4947', offset: 0 } };
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
      if (article.startsWith('https://en.wikipedia.org/wiki/')) articles.set(qid, decodeURIComponent(article.slice('https://en.wikipedia.org/wiki/'.length)));
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
  let page = typeof state.page === 'number' ? state.page : 0;
  await each(1, deadline, deps, 0, async () => {
    let shows: unknown[];
    try {
      shows = (await getJson(buildUrl('api.tvmaze.com', ['shows'], [['page', String(page)]]), ['api.tvmaze.com'], deps)) as unknown[];
    } catch (error) {
      // A 404 is the end of the index: round again next run. Anything else is tried again.
      if (error instanceof SafeFetchError && error.status === 404) page = 0;
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
  return { items, state: { page } };
}

const READERS: Record<SweepSource, (state: Record<string, unknown>, deadline: number, deps: SweepDeps) => Promise<Read>> = {
  internet_archive: readArchive,
  peertube: readPeertube,
  openverse: readOpenverse,
  wikidata: readWikidata,
  tvmaze: readTvmaze,
};

/** Reads every source at once, each stopping at the deadline. One source failing costs only its own rows. */
export async function readSources(state: SweepState, deps: SweepDeps): Promise<{ items: PoolCandidate[]; state: SweepState }> {
  const deadline = (deps.now ?? Date.now)() + READ_BUDGET_MS;
  const reads = await Promise.all(
    SWEEP_SOURCES.map(async (source) => {
      try {
        return { source, read: await READERS[source](state[source] ?? {}, deadline, deps) };
      } catch {
        return { source, read: { items: [], state: state[source] ?? {} } };
      }
    }),
  );
  return { items: reads.flatMap(({ read }) => read.items), state: Object.fromEntries(reads.map(({ source, read }) => [source, read.state])) };
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
  room(): Promise<boolean>;
  state(): Promise<SweepState>;
  saveState(source: string, state: Record<string, unknown>): Promise<void>;
  unknown(ids: readonly string[]): Promise<string[]>;
  sent(batchId: string, rows: readonly PoolCandidate[]): Promise<void>;
  pending(): Promise<string[]>;
  outIn(batchId: string): Promise<string[]>;
  /** One chunk of answers and their counts, together, so nothing can be counted twice. */
  collect(batchId: string, rows: readonly { id: string; words: string[] }[], stats: readonly WordCount[]): Promise<void>;
  /** What a finished batch left without words stops being out. Past 100,000 rows, the oldest go. */
  release(batchId: string): Promise<void>;
};

export type SweepResult = { collected: number; sent: number; waiting: number; inputTokens: number; outputTokens: number; read?: Partial<Record<SweepSource, number>>; stopped?: 'spending limit' | 'database full' };

const COLLECT_CHUNK = 400;

/** One run: collect what has finished, then read and send the next items, unless a batch is still out. */
export async function runSweep(client: Pick<Anthropic, 'messages'>, store: SweepStore, read: (state: SweepState) => Promise<{ items: PoolCandidate[]; state: SweepState }>): Promise<SweepResult> {
  let collected = 0;
  let waiting = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const batchId of await store.pending()) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status !== 'ended') {
      waiting += 1;
      continue;
    }
    // Only what's still out, so a run that stopped halfway carries on rather than counting anything twice.
    const idFor = new Map((await store.outIn(batchId)).map((id) => [digestFor(id), id]));
    const rows: { id: string; words: string[] }[] = [];
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
      if (words !== null && id !== undefined) rows.push({ id, words });
    }
    inputTokens += batchInput;
    outputTokens += batchOutput;
    await store.recordSpend(batchId, batchInput, batchOutput, batchCost(batchInput, batchOutput));
    for (let start = 0; start < rows.length; start += COLLECT_CHUNK) {
      const chunk = rows.slice(start, start + COLLECT_CHUNK);
      await store.collect(batchId, chunk, countWords(chunk));
    }
    await store.release(batchId);
    collected += rows.length;
  }

  if (waiting > 0) return { collected, sent: 0, waiting, inputTokens, outputTokens };

  const spent = await store.spent();
  if (spent >= SWEEP_LIMIT_USD) return { collected, sent: 0, waiting: 0, inputTokens, outputTokens, stopped: 'spending limit' };
  if (!(await store.room())) return { collected, sent: 0, waiting: 0, inputTokens, outputTokens, stopped: 'database full' };

  const found = await read(await store.state());
  // Once each, however many sources or pages it came from, and nothing the site already holds.
  const unique = [...new Map(found.items.map((item) => [item.id, item])).values()].slice(0, MAX_BATCH);
  const fresh = new Set(unique.length === 0 ? [] : await store.unknown(unique.map((item) => item.id)));
  const items: PoolCandidate[] = [];
  let worst = spent;
  let heldBack = false;
  for (const item of unique) {
    if (!fresh.has(item.id)) continue;
    worst += worstCaseCost(item);
    if (worst > SWEEP_LIMIT_USD) {
      heldBack = true;
      break;
    }
    items.push(item);
  }
  const counts: Partial<Record<SweepSource, number>> = {};
  for (const item of items) counts[item.platform] = (counts[item.platform] ?? 0) + 1;

  const saveAll = async () => {
    for (const [source, state] of Object.entries(found.state)) await store.saveState(source, state);
  };
  if (items.length === 0) {
    await saveAll();
    return { collected, sent: 0, waiting: 0, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}) };
  }

  const batch = await client.messages.batches.create({ requests: items.map(requestFor) });
  const mark = () => store.sent(batch.id, items);
  try {
    await mark().catch(mark);
  } catch (error) {
    // A batch nothing remembers would be paid for and never read.
    await client.messages.batches.cancel(batch.id).catch(() => undefined);
    throw error;
  }
  await saveAll();
  return { collected, sent: items.length, waiting: 1, inputTokens, outputTokens, read: counts, ...(heldBack ? { stopped: 'spending limit' as const } : {}) };
}

/** The same digest `requestFor` puts in a request's custom id. */
function digestFor(id: string): string {
  return requestFor({ id, kind: 'other', title: '', creator: null, description: null, tags: null }).custom_id;
}

const SENT_CHUNK = 1000;

/** The store, through the lock-checking database functions (supabase/migrations/*_web_pool.sql): no server key needed. */
export function makeSweepStore(db: SupabaseClient, lock: string): SweepStore {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, { p_secret: lock, ...args });
    if (error) throw new Error('TAGGING_DATABASE');
    return data as T;
  };
  return {
    spent: async () => Number(await call<number | string>('web_tag_spent', {})),
    recordSpend: async (batchId, inputTokens, outputTokens, usd) => {
      await call('web_tag_spend_add', { p_batch: batchId, p_input: inputTokens, p_output: outputTokens, p_usd: usd });
    },
    room: () => call<boolean>('web_pool_room', {}),
    state: async () => {
      const rows = await call<{ source: string; state: Record<string, unknown> }[]>('web_sweep_state_read', {});
      return Object.fromEntries(rows.map((row) => [row.source, row.state]));
    },
    saveState: async (source, state) => {
      await call('web_sweep_state_write', { p_source: source, p_state: state });
    },
    unknown: (ids) => call<string[]>('web_pool_unknown', { p_ids: [...ids] }),
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
    outIn: (batchId) => call<string[]>('web_pool_out', { p_batch: batchId }),
    collect: async (batchId, rows, stats) => {
      await call('web_pool_collect', { p_batch: batchId, p_rows: rows, p_stats: stats });
    },
    release: async (batchId) => {
      await call('web_pool_release', { p_batch: batchId });
    },
  };
}
