import type { WatchOffer } from './kino';
import type { MediaDetails } from './media-titles';
import { buildUrl, SafeFetchError, safeFetchJson, type FetchLike } from './safe-fetch';
import { sanitiseText } from './sanitise';
import { normaliseLanguage } from './language';

/**
 * TMDB's details for a media-server title (SPEC-media-servers.md decision 7). Server only: the hourly WEB update
 * calls it, never the page.
 *
 * One GET per title to TMDB's official API (`/3/movie/{id}` or `/3/tv/{id}`), through `safe-fetch` on
 * api.themoviedb.org only. The key is Luke's server-only `TMDB_READ_TOKEN` (the "API Read Access Token"), sent
 * as a Bearer header by a wrapper around fetch; it is never put in an address, a log, an answer or an error.
 * Without it, nothing is asked and titles show their list's own words.
 *
 * Kept: title, date, overview, poster file, runtime, genres, and a show's seasons with their episode counts.
 * Never kept or shown: vote_average, vote_count, popularity, or anything else that rates a title. The one use of a
 * rating (Luke, 2026-11-02, SPEC-web-sort.md): KINO's POPULAR order reads `vote_average` and `vote_count` from a
 * search answer (`toRatedHits`) to order titles on the server; they never leave search/providers/kino.ts.
 */

export const TMDB_API_HOST = 'api.themoviedb.org';

/** Distinguishes "TMDB does not know this number" (null) from a failure (thrown). */
export class TmdbError extends Error {}

const GENRES_MAX = 6;
const POSTER = /^\/[A-Za-z0-9]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const SEASONS_MAX = 100;

/** The fetch the update uses: the token as a header on every request, and nothing else changed. */
export function withTmdbToken(token: string, fetchImpl: FetchLike = fetch): FetchLike {
  return (input, init) =>
    fetchImpl(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
}

function whole(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function dateOf(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}(-\d{2}-\d{2})?$/.test(value) ? value : undefined;
}

/** TMDB's answer for one title, cut down to the fields we keep. Pure, so the check holds it. */
export function toDetails(doc: unknown, type: 'movie' | 'tv'): MediaDetails | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const d = doc as Record<string, unknown>;
  const title = sanitiseText(type === 'movie' ? d.title : d.name, 300);
  if (!title) return null;
  const details: MediaDetails = {
    title,
    genres: (Array.isArray(d.genres) ? d.genres : [])
      .map((genre) => sanitiseText((genre as Record<string, unknown> | null)?.name, 40))
      .filter((name) => name.length > 0)
      .slice(0, GENRES_MAX),
  };
  const date = dateOf(type === 'movie' ? d.release_date : d.first_air_date);
  if (date) details.date = date;
  const overview = sanitiseText(d.overview, 1000);
  if (overview) details.overview = overview;
  const language = normaliseLanguage(d.original_language);
  if (language) details.language = language;
  if (typeof d.poster_path === 'string' && POSTER.test(d.poster_path)) details.posterPath = d.poster_path;
  const runtime = type === 'movie' ? whole(d.runtime, 1, 6000) : whole(Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : undefined, 1, 6000);
  if (runtime !== undefined) details.runtimeMinutes = runtime;
  // A film's series (TMDB collection): its number, name and poster, so the servers' films of one series are one row.
  const series = type === 'movie' && typeof d.belongs_to_collection === 'object' && d.belongs_to_collection !== null ? (d.belongs_to_collection as Record<string, unknown>) : null;
  const seriesId = series ? whole(series.id, 1, 999_999_999) : undefined;
  const seriesName = series ? sanitiseText(series.name, 300) : '';
  if (seriesId !== undefined && seriesName) {
    details.collection = { id: seriesId, name: seriesName };
    if (typeof series?.poster_path === 'string' && POSTER.test(series.poster_path)) details.collection.posterPath = series.poster_path;
  }
  if (type === 'tv' && Array.isArray(d.seasons)) {
    details.seasons = d.seasons
      .flatMap((season) => {
        const s = season as Record<string, unknown> | null;
        const n = whole(s?.season_number, 0, 999);
        const episodes = whole(s?.episode_count, 0, 9999);
        return n === undefined || episodes === undefined ? [] : [{ season: n, episodes }];
      })
      .slice(0, SEASONS_MAX);
  }
  return details;
}

/** The address for one title: fixed path parts and a checked number only. */
export function detailsUrl(type: 'movie' | 'tv', tmdbId: number): string {
  if (!Number.isInteger(tmdbId) || tmdbId < 1 || tmdbId > 999_999_999) throw new TmdbError('bad number');
  return buildUrl(TMDB_API_HOST, ['3', type, String(tmdbId)], [['language', 'en-US']]);
}

/** One title's details and, in the same answer, where it can be watched in every country (`toWatchOffer`). */
export function detailsWithWatchUrl(type: 'movie' | 'tv', tmdbId: number): string {
  const url = new URL(detailsUrl(type, tmdbId));
  url.searchParams.set('append_to_response', 'watch/providers');
  return url.toString();
}

const WATCH_NAMES_MAX = 12;

/**
 * One country's where-to-watch from a `detailsWithWatchUrl` answer, or null when it lists nothing there. Service names
 * only, in TMDB's own order: no logo, no address. Pure.
 */
export function toWatchOffer(doc: unknown, country: string): WatchOffer | null {
  const root = typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : {};
  const block = root['watch/providers'];
  const results = typeof block === 'object' && block !== null ? (block as Record<string, unknown>).results : undefined;
  const here = typeof results === 'object' && results !== null ? (results as Record<string, unknown>)[country] : undefined;
  if (typeof here !== 'object' || here === null) return null;
  const names = (field: string): string[] => {
    const list = (here as Record<string, unknown>)[field];
    if (!Array.isArray(list)) return [];
    const ordered = list
      .flatMap((raw) => {
        const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        const name = sanitiseText(entry.provider_name, 60);
        return name ? [{ name, at: typeof entry.display_priority === 'number' ? entry.display_priority : 9999 }] : [];
      })
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.name);
    return [...new Set(ordered)].slice(0, WATCH_NAMES_MAX);
  };
  const offer: WatchOffer = { country, stream: names('flatrate'), free: names('free'), ads: names('ads'), rent: names('rent'), buy: names('buy') };
  return [offer.stream, offer.free, offer.ads, offer.rent, offer.buy].some((list) => list.length > 0) ? offer : null;
}

/** One film or show from TMDB's search: its number, title, year and poster only. */
/** `language`: TMDB's `original_language` (`normaliseLanguage`), for the row's language flag. */
export type TmdbHit = { type: 'movie' | 'tv'; tmdbId: number; title: string; date?: string; posterPath?: string; language?: string };

const SEARCH_HITS_MAX = 20;

/** TMDB's search across films and shows for the words of a search (`searchText`: letters and digits only). */
export function searchUrl(words: string, page = 1): string {
  return buildUrl(TMDB_API_HOST, ['3', 'search', 'multi'], [
    ['query', words],
    ['include_adult', 'false'],
    ['language', 'en-US'],
    ['page', String(page)],
  ]);
}

/** The deepest page KINO asks for (20 titles a page). */
export const TMDB_MAX_PAGE = 10;

/** How many pages TMDB says an answer has, within `TMDB_MAX_PAGE` (or `cap`). Pure. */
export function totalPages(body: unknown, cap = TMDB_MAX_PAGE): number {
  const total = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).total_pages : undefined;
  return typeof total === 'number' && Number.isInteger(total) && total >= 0 ? Math.min(total, cap) : 0;
}

/** What a discover list is narrowed by: TMDB keyword and genre numbers, and a first and last date. */
export type TmdbDiscover = { keywords?: readonly number[]; genres?: readonly number[]; from?: string; to?: string };

const WHOLE_ID = (id: number) => Number.isInteger(id) && id > 0 && id < 1_000_000_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * TMDB's discover list of films or shows (`/3/discover/movie|tv`): keywords are either one (`|`), genres all of them
 * (`,`). Only checked numbers and dates go in. TMDB's own order is kept; it is never shown or stored.
 */
export function discoverUrl(type: 'movie' | 'tv', narrow: TmdbDiscover, page = 1): string {
  const params: [string, string][] = [
    ['include_adult', 'false'],
    ['language', 'en-US'],
    ['page', String(page)],
  ];
  const keywords = (narrow.keywords ?? []).filter(WHOLE_ID).slice(0, 8);
  const genres = (narrow.genres ?? []).filter(WHOLE_ID).slice(0, 4);
  if (keywords.length > 0) params.push(['with_keywords', keywords.join('|')]);
  if (genres.length > 0) params.push(['with_genres', genres.join(',')]);
  const field = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (narrow.from !== undefined && ISO_DAY.test(narrow.from)) params.push([`${field}.gte`, narrow.from]);
  if (narrow.to !== undefined && ISO_DAY.test(narrow.to)) params.push([`${field}.lte`, narrow.to]);
  return buildUrl(TMDB_API_HOST, ['3', 'discover', type], params);
}

/** TMDB's keyword search (the tags its editors give titles, "dalek", "time travel"), for one word or phrase. */
export function keywordSearchUrl(words: string): string {
  return buildUrl(TMDB_API_HOST, ['3', 'search', 'keyword'], [['query', words], ['page', '1']]);
}

/** TMDB's keywords for a keyword search: number and name, best first. Pure. */
export function toKeywords(body: unknown): { id: number; name: string }[] {
  const results = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) return [];
  return results
    .flatMap((raw) => {
      const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      const id = whole(d.id, 1, 999_999_999);
      const name = sanitiseText(d.name, 100);
      return id === undefined || !name ? [] : [{ id, name }];
    })
    .slice(0, 10);
}

/** One TMDB read through `safe-fetch` on TMDB's API host only. Throws TmdbError with nothing of the answer in it. */
export async function tmdbJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  try {
    return await safeFetchJson(url, { allowedHosts: [TMDB_API_HOST], fetchImpl, timeoutMs: 8_000, maxBytes: 512 * 1024 });
  } catch (error) {
    throw new TmdbError(error instanceof SafeFetchError && error.status !== undefined ? `HTTP ${error.status}` : 'no answer');
  }
}

/**
 * TMDB's search answer, cut down to films and shows and the fields we keep. Pure. `type`: the answer is all one kind
 * (a discover list, whose results carry no `media_type`).
 */
export function toHits(body: unknown, type?: 'movie' | 'tv'): TmdbHit[] {
  return toRatedHits(body, type).map((rated) => rated.hit);
}

/**
 * A hit with TMDB's average rating and how many votes it rests on: for KINO's POPULAR order only, on the server
 * (search/providers/kino.ts). Never put on an item, kept, logged or sent anywhere. Pure.
 */
export type RatedHit = { hit: TmdbHit; rating: number; votes: number };

export function toRatedHits(body: unknown, type?: 'movie' | 'tv'): RatedHit[] {
  const results = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) return [];
  const forced = type;
  return results
    .flatMap((raw): RatedHit[] => {
      const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      const type = forced ?? (d.media_type === 'movie' || d.media_type === 'tv' ? d.media_type : null);
      const tmdbId = whole(d.id, 1, 999_999_999);
      if (type === null || tmdbId === undefined) return [];
      const title = sanitiseText(type === 'movie' ? d.title : d.name, 300);
      if (!title) return [];
      const hit: TmdbHit = { type, tmdbId, title };
      const date = dateOf(type === 'movie' ? d.release_date : d.first_air_date);
      if (date) hit.date = date;
      if (typeof d.poster_path === 'string' && POSTER.test(d.poster_path)) hit.posterPath = d.poster_path;
      const language = normaliseLanguage(d.original_language);
      if (language) hit.language = language;
      const rating = typeof d.vote_average === 'number' && Number.isFinite(d.vote_average) ? d.vote_average : 0;
      return [{ hit, rating, votes: whole(d.vote_count, 0, 1_000_000_000) ?? 0 }];
    })
    .slice(0, SEARCH_HITS_MAX);
}

/** TMDB's films and shows for some words. Throws TmdbError on any failure, with nothing of TMDB's answer in it. */
export async function searchTitles(words: string, fetchImpl: FetchLike): Promise<TmdbHit[]> {
  try {
    return toHits(await safeFetchJson(searchUrl(words), { allowedHosts: [TMDB_API_HOST], fetchImpl, timeoutMs: 8_000, maxBytes: 512 * 1024 }));
  } catch (error) {
    throw new TmdbError(error instanceof SafeFetchError && error.status !== undefined ? `HTTP ${error.status}` : 'no answer');
  }
}

/** TMDB's details, or null when TMDB does not know the number (404). Throws TmdbError on any other failure. */
export async function fetchDetails(type: 'movie' | 'tv', tmdbId: number, fetchImpl: FetchLike): Promise<MediaDetails | null> {
  try {
    const body = await safeFetchJson(detailsUrl(type, tmdbId), { allowedHosts: [TMDB_API_HOST], fetchImpl, timeoutMs: 8_000, maxBytes: 512 * 1024 });
    return toDetails(body, type);
  } catch (error) {
    if (error instanceof SafeFetchError && error.status === 404) return null;
    // Nothing of TMDB's answer (or of the request, which carries the key in a header) goes into the error.
    throw new TmdbError(error instanceof SafeFetchError && error.status !== undefined ? `HTTP ${error.status}` : 'no answer');
  }
}
