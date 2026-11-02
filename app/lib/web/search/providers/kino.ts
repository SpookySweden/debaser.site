import { kinoItem } from '../../kino';
import type { MediaDetails } from '../../media-titles';
import { splitYear, vibePlan, yearOfDate } from '../../search-intent';
import type { FetchLike } from '../../safe-fetch';
import { detailsUrl, discoverUrl, keywordSearchUrl, searchUrl, TMDB_API_HOST, TMDB_MAX_PAGE, tmdbJson, toDetails, toKeywords, toRatedHits, totalPages, withTmdbToken, type RatedHit, type TmdbDiscover, type TmdbHit } from '../../tmdb';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchOrder, type SearchPage, type SearchProvider } from '../types';

/**
 * KINO (Luke, 2026-11-02: "include a tmdb search parameter but call it kino, when using kino search it only lists
 * stuff through the tmdb search"). SERVER ONLY. Asked only when the SOURCE is KINO (web-filters.ts).
 *
 * TMDB's official API through `safe-fetch` on api.themoviedb.org, with Luke's server-only `TMDB_READ_TOKEN` as a
 * Bearer header (tmdb.ts); without it KINO says NOT SET UP. Every answer goes through the route's day-long cache.
 *
 * - **Plain words:** TMDB's search of films and shows. A year in the words (search-intent.ts `splitYear`) is asked
 *   both ways: the words without it, keeping titles made that year, then the words as typed; one list.
 * - **VIBE:** the words become genres, a decade and TMDB keywords (`vibePlan`), and TMDB's discover lists of films
 *   and shows are asked; words that name nothing fall back to the plain search.
 * - **A related keyword** (`deps.keyword`, from /api/web/related): the films and shows TMDB tags with it.
 *
 * Each title's details (overview, genres, a show's seasons) are read too, so a KINO row has every season and its
 * episode count. A title whose details fail still shows, from the search's own fields.
 *
 * Sorted (SPEC-web-sort.md; TMDB's search cannot sort): every page of the search, up to 25 (500 titles), is read at
 * once on the server and ordered here; LOAD MORE then pages through that order. POPULAR is TMDB's average rating,
 * with titles resting on fewer than 50 votes after the rest (a 10/10 from one vote is noise). DATE is the release
 * date the row shows. The rating decides the order and goes nowhere else: never onto an item, an answer or a log.
 * A search with more than 500 matches says "KINO: SORTED THE FIRST 500 MATCHES".
 */

export const KINO_TIMEOUT_MS = 9_000;
/** A sorted search reads up to 25 pages at once (each answers in well under a second), then one page's details. */
export const KINO_SORTED_TIMEOUT_MS = 20_000;
export const KINO_SORT_PAGES = 25;
export const KINO_PAGE_SIZE = 20;
/** Fewer votes than this and a title's rating says little: it goes after every title with more. */
export const KINO_VOTE_FLOOR = 50;

function pageNumber(page: ProviderPage | null, last = TMDB_MAX_PAGE): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= last ? page : 1;
}

type Found = { hits: RatedHit[]; pages: number };

async function plainSearch(words: string, page: number, fetchImpl: FetchLike, now: Date, cap = TMDB_MAX_PAGE): Promise<Found> {
  const { words: rest, year } = splitYear(words, now);
  if (year === null) {
    const body = await tmdbJson(searchUrl(words, page), fetchImpl);
    return { hits: toRatedHits(body), pages: totalPages(body, cap) };
  }
  // The year as a date first (titles made that year), then as a word (a title with the number in it).
  const [asDate, asWord] = await Promise.all([tmdbJson(searchUrl(rest, page), fetchImpl), tmdbJson(searchUrl(words, page), fetchImpl).catch(() => null)]);
  const dated = toRatedHits(asDate).filter((rated) => yearOfDate(rated.hit.date) === year);
  return { hits: [...dated, ...(asWord === null ? [] : toRatedHits(asWord))], pages: Math.max(totalPages(asDate, cap), asWord === null ? 0 : totalPages(asWord, cap)) };
}

async function discoverBoth(narrow: { movie: TmdbDiscover | null; tv: TmdbDiscover | null }, page: number, fetchImpl: FetchLike, cap = TMDB_MAX_PAGE): Promise<Found> {
  const ask = async (type: 'movie' | 'tv', with_: TmdbDiscover | null) => {
    if (with_ === null) return { hits: [] as RatedHit[], pages: 0 };
    const body = await tmdbJson(discoverUrl(type, with_, page), fetchImpl);
    return { hits: toRatedHits(body, type), pages: totalPages(body, cap) };
  };
  const [movies, shows] = await Promise.all([ask('movie', narrow.movie), ask('tv', narrow.tv)]);
  // Films and shows taken in turn, so neither crowds the other off the page.
  const hits: RatedHit[] = [];
  for (let index = 0; index < Math.max(movies.hits.length, shows.hits.length); index += 1) {
    if (movies.hits[index]) hits.push(movies.hits[index]);
    if (shows.hits[index]) hits.push(shows.hits[index]);
  }
  return { hits, pages: Math.max(movies.pages, shows.pages) };
}

async function vibeSearch(words: string, page: number, fetchImpl: FetchLike, now: Date, cap = TMDB_MAX_PAGE): Promise<Found> {
  const plan = vibePlan(words, now);
  if (plan.empty) return plainSearch(words, page, fetchImpl, now, cap);
  // One TMDB keyword per leftover word: its best match.
  const keywords = (
    await Promise.all(plan.keywords.map((word) => tmdbJson(keywordSearchUrl(word), fetchImpl).then((body) => toKeywords(body)[0]?.id, () => undefined)))
  ).filter((id): id is number => id !== undefined);
  // Words that were meant as tags but TMDB has none of, with no genre or decade either: the plain search.
  if (keywords.length === 0 && plan.movieGenres.length === 0 && plan.tvGenres.length === 0 && plan.from === undefined) return plainSearch(words, page, fetchImpl, now, cap);
  const dates = { ...(plan.from ? { from: plan.from } : {}), ...(plan.to ? { to: plan.to } : {}) };
  return discoverBoth(
    {
      movie: plan.skipMovies ? null : { keywords, genres: plan.movieGenres, ...dates },
      tv: plan.skipTv ? null : { keywords, genres: plan.tvGenres, ...dates },
    },
    page,
    fetchImpl,
    cap,
  );
}

/** Each hit's details, read at once; a failure leaves that one without. */
async function withDetails(hits: readonly TmdbHit[], fetchImpl: FetchLike): Promise<(MediaDetails | undefined)[]> {
  return Promise.all(hits.map((hit) => tmdbJson(detailsUrl(hit.type, hit.tmdbId), fetchImpl).then((body) => toDetails(body, hit.type) ?? undefined, () => undefined)));
}

/** Each title once (a year search asks twice), in the order found. */
function once(hits: readonly RatedHit[]): RatedHit[] {
  const seen = new Set<string>();
  return hits.filter(({ hit }) => {
    const key = `${hit.type}-${hit.tmdbId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The order of a sorted KINO search. Pure, so `scripts/check-web-sort.cjs` holds it. POPULAR: the rating, highest
 * first, every title under the vote floor after every title over it; DATE: the release date the row will show. A
 * title with no release date has no place in a date order, so DATE leaves it out (it would otherwise show as read
 * today, at the top); BEST MATCH and POPULAR still list it. Ties keep TMDB's own order.
 */
export function orderKino(hits: readonly RatedHit[], order: Exclude<SearchOrder, 'relevance'>, fetchedAt: string): TmdbHit[] {
  const placed = order === 'popular' ? hits : hits.filter((rated) => rated.hit.date !== undefined);
  const ranked = placed.map((rated, index) => ({ rated, index, key: kinoItem(rated.hit, undefined, fetchedAt).publishedAt }));
  ranked.sort((a, b) => {
    if (order === 'popular') {
      const floor = Number(b.rated.votes >= KINO_VOTE_FLOOR) - Number(a.rated.votes >= KINO_VOTE_FLOOR);
      return floor || b.rated.rating - a.rated.rating || a.index - b.index;
    }
    if (a.key !== b.key) return (a.key < b.key ? -1 : 1) * (order === 'newest' ? -1 : 1);
    return a.index - b.index;
  });
  return ranked.map((entry) => entry.rated.hit);
}

/** Every page of a search (up to 25) at once. Any page failing fails the search: a partial order would be a wrong one. */
async function readAll(readPage: (page: number) => Promise<Found>): Promise<{ hits: RatedHit[]; more: boolean }> {
  const first = await readPage(1);
  const last = Math.min(first.pages, KINO_SORT_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(0, last - 1) }, (_, index) => readPage(index + 2)));
  return { hits: [first, ...rest].flatMap((found) => found.hits), more: first.pages > KINO_SORT_PAGES };
}

/** A sorted search: every page read and ordered (`orderKino`), then the asked page of that order with its details. */
async function sortedSearch(words: string, page: ProviderPage | null, deps: SearchDeps, order: Exclude<SearchOrder, 'relevance'>, now: Date, fetchImpl: FetchLike): Promise<SearchPage> {
  const at = pageNumber(page, KINO_SORT_PAGES);
  // One more than the pages read, so a search with more than 500 matches is known to have more.
  const cap = KINO_SORT_PAGES + 1;
  let all: { hits: RatedHit[]; more: boolean };
  try {
    const keyword = deps.keyword;
    if (keyword !== undefined) all = await readAll((n) => discoverBoth({ movie: { keywords: [keyword] }, tv: { keywords: [keyword] } }, n, fetchImpl, cap));
    else if (words.length === 0) return { items: [], next: null };
    else all = await readAll((n) => (deps.vibe ? vibeSearch(words, n, fetchImpl, now, cap) : plainSearch(words, n, fetchImpl, now, cap)));
  } catch {
    // Nothing of TMDB's answer, or of the request (it carries the token), goes any further.
    throw new SearchProblemError('NO ANSWER');
  }
  const fetchedAt = now.toISOString();
  const ordered = orderKino(once(all.hits), order, fetchedAt);
  const hits = ordered.slice((at - 1) * KINO_PAGE_SIZE, at * KINO_PAGE_SIZE);
  const details = await withDetails(hits, fetchImpl);
  // The row is dated as it was ordered (the search's release date), even where the details say otherwise.
  const items = hits.map((hit, index) => {
    const own = details[index];
    return kinoItem(hit, own && hit.date ? { ...own, date: hit.date } : own, fetchedAt);
  });
  const note = all.more && at === 1 ? { note: 'SORTED THE FIRST 500 MATCHES' as const } : {};
  return { items, next: at * KINO_PAGE_SIZE < ordered.length ? at + 1 : null, ...note };
}

export const kinoSearch: SearchProvider = {
  platform: 'kino',
  allowedHosts: [TMDB_API_HOST],
  timeoutMs: KINO_TIMEOUT_MS,
  sortedTimeoutMs: KINO_SORTED_TIMEOUT_MS,
  orders: ['popular', 'newest', 'oldest'],
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, _author?: string, kind?: SearchKind): Promise<SearchPage> {
    const token = (deps.env?.TMDB_READ_TOKEN ?? '').trim();
    if (token.length === 0) throw new SearchProblemError('NOT SET UP');
    // Films and shows are video; any other TYPE finds nothing here.
    if (kind !== undefined && kind !== 'video') return { items: [], next: null };
    const now = deps.now?.() ?? new Date();
    const fetchImpl = withTmdbToken(token, deps.fetch);
    if (deps.order !== undefined && deps.order !== 'relevance') return sortedSearch(words, page, deps, deps.order, now, fetchImpl);
    const at = pageNumber(page);
    let found: Found;
    try {
      if (deps.keyword !== undefined) found = await discoverBoth({ movie: { keywords: [deps.keyword] }, tv: { keywords: [deps.keyword] } }, at, fetchImpl);
      else if (words.length === 0) return { items: [], next: null };
      else found = deps.vibe ? await vibeSearch(words, at, fetchImpl, now) : await plainSearch(words, at, fetchImpl, now);
    } catch {
      // Nothing of TMDB's answer, or of the request (it carries the token), goes any further.
      throw new SearchProblemError('NO ANSWER');
    }
    const hits = once(found.hits).map((rated) => rated.hit);
    const details = await withDetails(hits, fetchImpl);
    const fetchedAt = now.toISOString();
    const items: WebItem[] = hits.map((hit, index) => kinoItem(hit, details[index], fetchedAt));
    return { items, next: at < found.pages ? at + 1 : null };
  },
  // A KINO row is never saved into the stream (it has nothing to play).
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
