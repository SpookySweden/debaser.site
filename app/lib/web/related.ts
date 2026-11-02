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
 * - **Related topics:** Wikidata, the open database behind Wikipedia, keyless. The entries the words may mean (Wikipedia's
 *   top three pages for them, read in the same request as the suggestion, which know the famous meaning: Batman the
 *   superhero, not the Turkish province Wikidata lists first; and Wikidata's own search, as typed and, for a plural,
 *   in the singular), best first (`rankCandidates`: the exact name, and a film, series,
 *   character or species before a surname, a band or a building); the first of them that links anywhere gives the
 *   series, franchise, work, universe, larger whole, source, prequel, sequel or spin-off it is tied to, one of each
 *   (`relatedIds`: Dalek -> Doctor Who, the Whoniverse; Doctor Who -> Torchwood). At most two topics, each a plain
 *   label the page searches like typed words, under its own heading.
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
/** A big franchise's Wikidata record is about 200 KB (Doctor Who, 2026-11-02), and up to five are read at once. */
const CLAIMS_MAX_BYTES = 3 * 1024 * 1024;
/** How many of the ranked entries are read for their links. */
export const MAX_CANDIDATES = 5;
export const MAX_TOPICS = 2;

/**
 * The Wikidata properties that tie a thing to related things, best first: part of the series, media franchise, present
 * in work, from narrative universe, based on, follows, followed by, has spin-off, derivative work, author, creator, and
 * last part of (a film is "part of" the National Film Registry). One value of each is taken, so one property never
 * fills every topic (Cybermen: Doctor Who, then the Whoniverse, not two comics). Author and creator are for a thing whose
 * other ties lead back to itself (Dracula the novel: Bram Stoker).
 */
export const RELATED_PROPS = ['P179', 'P8345', 'P1441', 'P1080', 'P144', 'P155', 'P156', 'P2512', 'P4969', 'P50', 'P170', 'P361'] as const;

/** Descriptions that say an entry is a story-world thing someone would search for, or one they would not. */
const LIKELY = /\b(fictional|superhero|comics|franchise|series|film|movie|video game|game|character|species|race|universe|novel|comic|television|tv|anime|manga|book|saga|episode|creature|robot|faction|spacecraft|vehicle)\b/i;
const UNLIKELY = /\b(family name|given name|surname|name|building|village|town|city|human settlement|genus|species of|disambiguation|song|album|single|musical group|band|musician|singer|asteroid|gene|protein|company|scholarly article|province|district|region|river|mountain|same term)\b/i;

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

/** Wikipedia's suggestion and hit count, and its top three pages with their Wikidata ids and short descriptions, in one. */
export function suggestionUrl(words: string): string {
  return buildUrl(WIKIPEDIA_HOST, ['w', 'api.php'], [
    ['action', 'query'],
    ['list', 'search'],
    ['srsearch', words],
    ['srinfo', 'suggestion|totalhits'],
    ['srlimit', '1'],
    ['srprop', ''],
    ['generator', 'search'],
    ['gsrsearch', words],
    ['gsrlimit', '3'],
    ['prop', 'pageprops|description'],
    ['ppprop', 'wikibase_item'],
    ['format', 'json'],
  ]);
}

/** Bonus by Wikipedia's rank: its first page is usually the meaning people search for. */
const WIKIPEDIA_BONUS = [4, 2, 1];
const TOP_PAGE_BONUS = WIKIPEDIA_BONUS[0];

/** Wikipedia's top pages as candidates: the Wikidata id, the title without its "(film)" part, the short description. Pure. */
export function readWikipediaCandidates(body: unknown): Candidate[] {
  const pages = (body as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (pages === null || typeof pages !== 'object') return [];
  return Object.values(pages as Record<string, unknown>)
    .flatMap((raw) => {
      const page = (raw ?? {}) as { index?: unknown; title?: unknown; description?: unknown; pageprops?: { wikibase_item?: unknown } };
      const id = page.pageprops?.wikibase_item;
      const index = typeof page.index === 'number' ? page.index : 99;
      if (typeof id !== 'string' || !QID.test(id) || typeof page.title !== 'string') return [];
      return [{ index, candidate: { id, label: searchText(page.title.replace(/\s*\([^)]*\)\s*$/, '')), matched: null, description: sanitiseText(page.description, 200), bonus: WIKIPEDIA_BONUS[index - 1] ?? 0 } }];
    })
    .sort((a, b) => a.index - b.index)
    .map(({ candidate }) => candidate);
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
    ['limit', '7'],
    ['format', 'json'],
  ]);
}

/** One entry a search found: its id, label, the name it matched on (a label or an alias) and its description. */
export type Candidate = { id: string; label: string | null; matched: string | null; description: string; bonus?: number };

/** The entries of a Wikidata search answer. Pure. */
export function readCandidates(body: unknown): Candidate[] {
  const results = (body as { search?: unknown } | null)?.search;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    if (typeof d.id !== 'string' || !QID.test(d.id)) return [];
    const match = (d.match ?? {}) as Record<string, unknown>;
    return [
      {
        id: d.id,
        label: searchText(typeof d.label === 'string' ? d.label : ''),
        matched: searchText(typeof match.text === 'string' ? match.text : ''),
        description: sanitiseText(d.description, 200),
      },
    ];
  });
}

/** The words with the last word's plural `s` taken off ("daleks" -> "dalek"), or the words themselves. */
export function singularOf(words: string): string {
  return words.replace(/(\p{L}{3,})s$/u, '$1');
}

/**
 * The entries best first, as ids, repeats dropped, at most `MAX_CANDIDATES`. An entry named exactly the words (its
 * label or the alias it matched, plural or not) comes before one that is not; a description that sounds like a film,
 * series, character or species before one that sounds like a surname, a band or a building; otherwise Wikidata's own
 * order. Pure.
 */
export function rankCandidates(found: readonly Candidate[], words: string): string[] {
  const forms = new Set<string>();
  for (const form of [searchText(words), searchText(singularOf(words))]) {
    if (form === null) continue;
    forms.add(form);
    forms.add(`${form}s`);
    forms.add(singularOf(form));
  }
  const exact = (name: string | null) => name !== null && forms.has(name);
  const score = (entry: Candidate) =>
    (exact(entry.label) || exact(entry.matched) ? 10 : 0) + (entry.bonus ?? 0) + (LIKELY.test(entry.description) ? 3 : 0) - (UNLIKELY.test(entry.description) ? 6 : 0) - (entry.description === '' ? 1 : 0);
  const seen = new Set<string>();
  // Usable only when it sounds like a story-world thing, or it is Wikipedia's top page for the words: a plain word
  // ("cosy") never leads to whatever Wikidata files under the same letters (a hormone).
  const usable = (entry: Candidate) => ((entry.bonus ?? 0) >= TOP_PAGE_BONUS || LIKELY.test(entry.description)) && !UNLIKELY.test(entry.description);
  return found
    .filter(usable)
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .flatMap(({ entry }) => {
      if (seen.has(entry.id)) return [];
      seen.add(entry.id);
      return [entry.id];
    })
    .slice(0, MAX_CANDIDATES);
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

/** Wikidata's ids for a written work (literary work, novel, book, poem, play, short story). */
const WRITTEN = new Set(['Q7725634', 'Q8261', 'Q571', 'Q5185279', 'Q25379', 'Q49084']);

const valueOf = (claim: unknown) => (claim as { mainsnak?: { datavalue?: { value?: { id?: unknown } } } } | null)?.mainsnak?.datavalue?.value?.id;

/**
 * The things an entry is tied to (`RELATED_PROPS`, in that order, one of each), as Wikidata ids, at most four. For a
 * written work the author comes first and follows / followed by are skipped: for a novel those are the author's
 * previous and next books, not sequels (Frankenstein: Mary Shelley, not her travel diary). Pure.
 */
export function relatedIds(body: unknown, id: string): string[] {
  const claims = (body as { entities?: Record<string, { claims?: Record<string, unknown> }> } | null)?.entities?.[id]?.claims;
  if (claims === undefined || claims === null || typeof claims !== 'object') return [];
  const kinds = Array.isArray(claims.P31) ? claims.P31.map(valueOf) : [];
  const written = kinds.some((kind) => typeof kind === 'string' && WRITTEN.has(kind));
  const order: readonly string[] = written ? ['P50', ...RELATED_PROPS.filter((p) => p !== 'P50' && p !== 'P155' && p !== 'P156')] : RELATED_PROPS;
  const found: string[] = [];
  for (const property of order) {
    const list = claims[property];
    if (!Array.isArray(list)) continue;
    for (const claim of list) {
      const value = valueOf(claim);
      if (typeof value === 'string' && QID.test(value) && value !== id && !found.includes(value)) {
        found.push(value);
        break;
      }
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

/** Reference pages, never a topic: "List of Illumination films", "National Film Registry", "Bram Stoker bibliography". */
const HOUSEKEEPING = /^(?:lists? of|index of|outline of|timeline of)\b|\b(?:at a glance|registry|bibliography|filmography|discography|awards?)$/i;

/** Topics from labels: not the search itself, no lists, no repeats, at most `MAX_TOPICS`. Pure. */
export function toTopics(labels: readonly string[], words: string): RelatedTopic[] {
  const wanted = searchText(words);
  const topics: RelatedTopic[] = [];
  for (const label of labels) {
    const query = searchText(label);
    if (query === null || query === wanted || HOUSEKEEPING.test(label) || topics.some((topic) => topic.query === query)) continue;
    topics.push({ label: label.toUpperCase(), query });
    if (topics.length === MAX_TOPICS) break;
  }
  return topics;
}

const options = (host: string, fetchImpl: FetchLike) => ({ allowedHosts: [host], fetchImpl, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });

/** Wikidata's related topics for some words; empty on any failure. */
export async function wikidataTopics(words: string, fetchImpl: FetchLike, fromWikipedia: readonly Candidate[] = []): Promise<RelatedTopic[]> {
  try {
    // Wikidata matches names from their start, so "daleks" lists "Daleks!" before "Dalek": the singular is asked too.
    const forms = [...new Set([words, singularOf(words)])];
    const answers = await Promise.all(forms.map((form) => safeFetchJson(entitySearchUrl(form), options(WIKIDATA_HOST, fetchImpl))));
    const ranked = rankCandidates([...fromWikipedia, ...answers.flatMap(readCandidates)], words);
    if (ranked.length === 0) return [];
    // Every candidate's links in one read; the first, in rank order, that links anywhere is the one.
    const claims = await safeFetchJson(entitiesUrl(ranked, 'claims'), { ...options(WIKIDATA_HOST, fetchImpl), maxBytes: CLAIMS_MAX_BYTES });
    const related = ranked.map((id) => relatedIds(claims, id)).find((ids) => ids.length > 0) ?? [];
    if (related.length === 0) return [];
    return toTopics(readLabels(await safeFetchJson(entitiesUrl(related, 'labels'), options(WIKIDATA_HOST, fetchImpl)), related), words);
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
  const wikipedia = (about: string) => safeFetchJson(suggestionUrl(about), options(WIKIPEDIA_HOST, deps.fetch)).catch(() => null);
  const asked = await wikipedia(words);
  const suggestion = readSuggestion(asked, words);
  // The corrected words first; when they lead nowhere ("cyber men"), the words as typed.
  const topicsOf = async (about: string) => {
    const pages = readWikipediaCandidates(about === words ? asked : await wikipedia(about));
    const [topics, keyword] = await Promise.all([wikidataTopics(about, deps.fetch, pages), deps.kino ? tmdbKeywordTopic(about, deps.tmdbToken, deps.fetch) : Promise.resolve(null)]);
    return { topics, keyword };
  };
  let { topics, keyword } = await topicsOf(suggestion ?? words);
  if (suggestion !== null && topics.length === 0 && keyword === null) ({ topics, keyword } = await topicsOf(words));
  return { suggestion, topics: keyword === null ? topics : [keyword, ...topics].slice(0, MAX_TOPICS + 1) };
}
