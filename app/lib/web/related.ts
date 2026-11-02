import { searchText } from './search';
import { safeFetchJson, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { keywordSearchUrl, tmdbJson, toKeywords, withTmdbToken } from './tmdb';
import { buildUrl } from './urls';

/**
 * "Did you mean" and related topics for a /web search (Luke, 2026-11-02: "searching dalek would list a bunch of videos
 * about daleks but then if you scroll long enough you also get related videos about doctor who even if they dont say
 * dalek anywhere explicitly"). SERVER ONLY; read by `/api/web/related`. The parsers are pure, so
 * `scripts/check-web-related.cjs` holds them with recorded answers.
 *
 * - **Did you mean:** Wikipedia's own spelling suggestion for the words (`list=search&srinfo=suggestion`), keyless,
 *   offered only when the words as typed are rare on Wikipedia (`SUGGEST_BELOW_HITS`): checked live 2026-11-02, it
 *   "corrects" dalek to dale (1,889 hits) and cosy to cody (3,373), but rightly dalak (549), blade runer (731), doctr who (4).
 * - **Related topics:** Wikidata, the open database behind Wikipedia, keyless. The words' best matching entry, then
 *   the series, fictional universe, franchise or larger work it belongs to (Dalek -> Doctor Who). At most two, each a
 *   plain label that the page searches like typed words, under its own heading.
 * - **KINO:** TMDB's keyword for the words too (the tag its editors give titles), for the titles tagged with it.
 *
 * Only the words of the search go out (`searchText`: letters and digits), every fetch through `safe-fetch` to fixed
 * hosts, answers cached a day by the route. Every label that comes back is cut to letters, digits and spaces before
 * it is shown or searched. Nothing here ever fails a search: a source that does not answer simply adds nothing.
 */

export const WIKIPEDIA_HOST = 'en.wikipedia.org';
export const WIKIDATA_HOST = 'www.wikidata.org';
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 256 * 1024;
export const MAX_TOPICS = 2;

/**
 * The Wikidata properties that lead from a thing to the bigger thing it belongs to, best first: part of the series,
 * present in work, media franchise, from narrative universe, part of, based on (Dalek: Doctor Who before the Whoniverse).
 */
export const BELONGS_TO = ['P179', 'P1441', 'P8345', 'P1080', 'P361', 'P144'] as const;

/** Words with at least this many Wikipedia hits as typed are taken as meant: no DID YOU MEAN. */
export const SUGGEST_BELOW_HITS = 1_000;

export type RelatedTopic = { label: string; query: string; keyword?: number };
export type RelatedAnswer = { suggestion: string | null; topics: RelatedTopic[] };

const QID = /^Q[1-9][0-9]{0,11}$/;

/** A label as page words: letters, digits and single spaces, at most 60 characters; null when nothing is left. */
export function cleanLabel(value: unknown): string | null {
  const text = sanitiseText(value, 120)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return text.length > 0 ? text : null;
}

export function suggestionUrl(words: string): string {
  return buildUrl(WIKIPEDIA_HOST, ['w', 'api.php'], [
    ['action', 'query'],
    ['list', 'search'],
    ['srsearch', words],
    ['srinfo', 'suggestion|totalhits'],
    ['srlimit', '1'],
    ['srprop', ''],
    ['format', 'json'],
  ]);
}

/** Wikipedia's suggestion, as search words, or null when it has none, it is the same words, or the words are common. Pure. */
export function readSuggestion(body: unknown, words: string): string | null {
  const info = (body as { query?: { searchinfo?: { suggestion?: unknown; totalhits?: unknown } } } | null)?.query?.searchinfo;
  if (typeof info?.totalhits === 'number' && info.totalhits >= SUGGEST_BELOW_HITS) return null;
  const suggestion = searchText(typeof info?.suggestion === 'string' ? info.suggestion : '');
  const squash = (text: string | null) => (text ?? '').replace(/ /g, '');
  // The same letters with a space put in ("cybermen" -> "cyber men") is no correction.
  return suggestion === null || squash(suggestion) === squash(searchText(words)) ? null : suggestion;
}

export function entitySearchUrl(words: string): string {
  return buildUrl(WIKIDATA_HOST, ['w', 'api.php'], [
    ['action', 'wbsearchentities'],
    ['search', words],
    ['language', 'en'],
    ['type', 'item'],
    ['limit', '5'],
    ['format', 'json'],
  ]);
}

/** The entry the words most likely mean: one whose label is exactly the words (plural or not), else the first. Pure. */
export function pickEntity(body: unknown, words: string): string | null {
  return pickEntityExactly(body, words) ?? firstEntity(body);
}

function entriesOf(body: unknown): { id: string; label: string | null }[] {
  const results = (body as { search?: unknown } | null)?.search;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return typeof d.id === 'string' && QID.test(d.id) ? [{ id: d.id, label: searchText(typeof d.label === 'string' ? d.label : '') }] : [];
  });
}

function firstEntity(body: unknown): string | null {
  return entriesOf(body)[0]?.id ?? null;
}

/** Only an entry whose label is exactly the words (plural or not); null otherwise. Pure. */
export function pickEntityExactly(body: unknown, words: string): string | null {
  const wanted = searchText(words);
  const same = (label: string | null) => label !== null && wanted !== null && (label === wanted || label === `${wanted}s` || `${label}s` === wanted);
  return entriesOf(body).find((entry) => same(entry.label))?.id ?? null;
}

export function entitiesUrl(ids: readonly string[], props: 'claims' | 'labels'): string {
  return buildUrl(WIKIDATA_HOST, ['w', 'api.php'], [
    ['action', 'wbgetentities'],
    ['ids', ids.filter((id) => QID.test(id)).slice(0, 10).join('|')],
    ['props', props],
    ...(props === 'labels' ? ([['languages', 'en']] as [string, string][]) : []),
    ['format', 'json'],
  ]);
}

/** The bigger things an entry belongs to (`BELONGS_TO`, in that order), as Wikidata ids. Pure. */
export function belongsTo(body: unknown, id: string): string[] {
  const claims = (body as { entities?: Record<string, { claims?: Record<string, unknown> }> } | null)?.entities?.[id]?.claims;
  if (claims === undefined || claims === null || typeof claims !== 'object') return [];
  const found: string[] = [];
  for (const property of BELONGS_TO) {
    const list = claims[property];
    if (!Array.isArray(list)) continue;
    for (const claim of list) {
      const value = (claim as { mainsnak?: { datavalue?: { value?: { id?: unknown } } } } | null)?.mainsnak?.datavalue?.value?.id;
      if (typeof value === 'string' && QID.test(value) && value !== id && !found.includes(value)) found.push(value);
    }
  }
  return found.slice(0, 4);
}

/** English labels for Wikidata ids, in the order asked, cleaned (`cleanLabel`); ids without one are left out. Pure. */
export function readLabels(body: unknown, ids: readonly string[]): string[] {
  const entities = (body as { entities?: Record<string, { labels?: { en?: { value?: unknown } } }> } | null)?.entities ?? {};
  return ids.flatMap((id) => {
    const label = cleanLabel(entities[id]?.labels?.en?.value);
    return label === null ? [] : [label];
  });
}

/** Topics from labels: not the search itself, no repeats, at most `MAX_TOPICS`. Pure. */
export function toTopics(labels: readonly string[], words: string): RelatedTopic[] {
  const wanted = searchText(words);
  const topics: RelatedTopic[] = [];
  for (const label of labels) {
    const query = searchText(label);
    if (query === null || query === wanted || topics.some((topic) => topic.query === query)) continue;
    topics.push({ label: label.toUpperCase(), query });
    if (topics.length === MAX_TOPICS) break;
  }
  return topics;
}

const options = (host: string, fetchImpl: FetchLike) => ({ allowedHosts: [host], fetchImpl, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });

/** Wikidata's related topics for some words; empty on any failure. */
export async function wikidataTopics(words: string, fetchImpl: FetchLike): Promise<RelatedTopic[]> {
  try {
    const first = await safeFetchJson(entitySearchUrl(words), options(WIKIDATA_HOST, fetchImpl));
    let id = pickEntityExactly(first, words);
    // Wikidata matches labels from their start, so "daleks" misses "Dalek": the last word without its s is asked once,
    // before settling for the first entry of the plural.
    const single = words.replace(/(\p{L}{3,})s$/u, '$1');
    if (id === null && single !== words) id = pickEntityExactly(await safeFetchJson(entitySearchUrl(single), options(WIKIDATA_HOST, fetchImpl)), single);
    id ??= firstEntity(first);
    if (id === null) return [];
    const parents = belongsTo(await safeFetchJson(entitiesUrl([id], 'claims'), options(WIKIDATA_HOST, fetchImpl)), id);
    if (parents.length === 0) return [];
    return toTopics(readLabels(await safeFetchJson(entitiesUrl(parents, 'labels'), options(WIKIDATA_HOST, fetchImpl)), parents), words);
  } catch {
    return [];
  }
}

/** TMDB's keyword for the words, as a KINO topic ("TAGGED: DALEK"); null when TMDB has no such tag or no token. */
export async function tmdbKeywordTopic(words: string, token: string | undefined, fetchImpl: FetchLike): Promise<RelatedTopic | null> {
  if (!token || token.trim().length === 0) return null;
  try {
    const keywords = toKeywords(await tmdbJson(keywordSearchUrl(words), withTmdbToken(token.trim(), fetchImpl)));
    const exact = keywords.find((keyword) => searchText(keyword.name) === searchText(words)) ?? null;
    const label = exact === null ? null : cleanLabel(exact.name);
    return exact === null || label === null ? null : { label: `TAGGED: ${label.toUpperCase()}`, query: searchText(label) ?? words, keyword: exact.id };
  } catch {
    return null;
  }
}

/**
 * Everything for one search: the suggestion, then topics for the suggested words when there is one (a misspelled
 * "dalak" still leads to Doctor Who), with KINO's keyword topic first.
 */
export async function relatedFor(words: string, deps: { fetch: FetchLike; kino: boolean; tmdbToken?: string }): Promise<RelatedAnswer> {
  const suggestion = await safeFetchJson(suggestionUrl(words), options(WIKIPEDIA_HOST, deps.fetch)).then(
    (body) => readSuggestion(body, words),
    () => null,
  );
  // The corrected words first; when they lead nowhere ("cyber men"), the words as typed.
  const topicsOf = async (about: string) => {
    const [topics, keyword] = await Promise.all([wikidataTopics(about, deps.fetch), deps.kino ? tmdbKeywordTopic(about, deps.tmdbToken, deps.fetch) : Promise.resolve(null)]);
    return { topics, keyword };
  };
  let { topics, keyword } = await topicsOf(suggestion ?? words);
  if (suggestion !== null && topics.length === 0 && keyword === null) ({ topics, keyword } = await topicsOf(words));
  return { suggestion, topics: keyword === null ? topics : [keyword, ...topics].slice(0, MAX_TOPICS + 1) };
}
