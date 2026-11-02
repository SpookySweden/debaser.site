import { kinoItem } from '../../kino';
import type { MediaDetails } from '../../media-titles';
import { splitYear, vibePlan, yearOfDate } from '../../search-intent';
import type { FetchLike } from '../../safe-fetch';
import { detailsUrl, discoverUrl, keywordSearchUrl, searchUrl, TMDB_API_HOST, TMDB_MAX_PAGE, tmdbJson, toDetails, toHits, toKeywords, totalPages, withTmdbToken, type TmdbDiscover, type TmdbHit } from '../../tmdb';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

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
 */

export const KINO_TIMEOUT_MS = 9_000;

function pageNumber(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= TMDB_MAX_PAGE ? page : 1;
}

type Found = { hits: TmdbHit[]; pages: number };

async function plainSearch(words: string, page: number, fetchImpl: FetchLike, now: Date): Promise<Found> {
  const { words: rest, year } = splitYear(words, now);
  if (year === null) {
    const body = await tmdbJson(searchUrl(words, page), fetchImpl);
    return { hits: toHits(body), pages: totalPages(body) };
  }
  // The year as a date first (titles made that year), then as a word (a title with the number in it).
  const [asDate, asWord] = await Promise.all([tmdbJson(searchUrl(rest, page), fetchImpl), tmdbJson(searchUrl(words, page), fetchImpl).catch(() => null)]);
  const dated = toHits(asDate).filter((hit) => yearOfDate(hit.date) === year);
  return { hits: [...dated, ...(asWord === null ? [] : toHits(asWord))], pages: Math.max(totalPages(asDate), asWord === null ? 0 : totalPages(asWord)) };
}

async function discoverBoth(narrow: { movie: TmdbDiscover | null; tv: TmdbDiscover | null }, page: number, fetchImpl: FetchLike): Promise<Found> {
  const ask = async (type: 'movie' | 'tv', with_: TmdbDiscover | null) => {
    if (with_ === null) return { hits: [] as TmdbHit[], pages: 0 };
    const body = await tmdbJson(discoverUrl(type, with_, page), fetchImpl);
    return { hits: toHits(body, type), pages: totalPages(body) };
  };
  const [movies, shows] = await Promise.all([ask('movie', narrow.movie), ask('tv', narrow.tv)]);
  // Films and shows taken in turn, so neither crowds the other off the page.
  const hits: TmdbHit[] = [];
  for (let index = 0; index < Math.max(movies.hits.length, shows.hits.length); index += 1) {
    if (movies.hits[index]) hits.push(movies.hits[index]);
    if (shows.hits[index]) hits.push(shows.hits[index]);
  }
  return { hits, pages: Math.max(movies.pages, shows.pages) };
}

async function vibeSearch(words: string, page: number, fetchImpl: FetchLike, now: Date): Promise<Found> {
  const plan = vibePlan(words, now);
  if (plan.empty) return plainSearch(words, page, fetchImpl, now);
  // One TMDB keyword per leftover word: its best match.
  const keywords = (
    await Promise.all(plan.keywords.map((word) => tmdbJson(keywordSearchUrl(word), fetchImpl).then((body) => toKeywords(body)[0]?.id, () => undefined)))
  ).filter((id): id is number => id !== undefined);
  // Words that were meant as tags but TMDB has none of, with no genre or decade either: the plain search.
  if (keywords.length === 0 && plan.movieGenres.length === 0 && plan.tvGenres.length === 0 && plan.from === undefined) return plainSearch(words, page, fetchImpl, now);
  const dates = { ...(plan.from ? { from: plan.from } : {}), ...(plan.to ? { to: plan.to } : {}) };
  return discoverBoth(
    {
      movie: plan.skipMovies ? null : { keywords, genres: plan.movieGenres, ...dates },
      tv: plan.skipTv ? null : { keywords, genres: plan.tvGenres, ...dates },
    },
    page,
    fetchImpl,
  );
}

/** Each hit's details, read at once; a failure leaves that one without. */
async function withDetails(hits: readonly TmdbHit[], fetchImpl: FetchLike): Promise<(MediaDetails | undefined)[]> {
  return Promise.all(hits.map((hit) => tmdbJson(detailsUrl(hit.type, hit.tmdbId), fetchImpl).then((body) => toDetails(body, hit.type) ?? undefined, () => undefined)));
}

export const kinoSearch: SearchProvider = {
  platform: 'kino',
  allowedHosts: [TMDB_API_HOST],
  timeoutMs: KINO_TIMEOUT_MS,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, _author?: string, kind?: SearchKind): Promise<SearchPage> {
    const token = (deps.env?.TMDB_READ_TOKEN ?? '').trim();
    if (token.length === 0) throw new SearchProblemError('NOT SET UP');
    // Films and shows are video; any other TYPE finds nothing here.
    if (kind !== undefined && kind !== 'video') return { items: [], next: null };
    const at = pageNumber(page);
    const now = deps.now?.() ?? new Date();
    const fetchImpl = withTmdbToken(token, deps.fetch);
    let found: Found;
    try {
      if (deps.keyword !== undefined) found = await discoverBoth({ movie: { keywords: [deps.keyword] }, tv: { keywords: [deps.keyword] } }, at, fetchImpl);
      else if (words.length === 0) return { items: [], next: null };
      else found = deps.vibe ? await vibeSearch(words, at, fetchImpl, now) : await plainSearch(words, at, fetchImpl, now);
    } catch {
      // Nothing of TMDB's answer, or of the request (it carries the token), goes any further.
      throw new SearchProblemError('NO ANSWER');
    }
    const seen = new Set<string>();
    const hits = found.hits.filter((hit) => {
      const key = `${hit.type}-${hit.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
