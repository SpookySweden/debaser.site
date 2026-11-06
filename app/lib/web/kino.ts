import { MEDIA_ID_PREFIX, posterUrl, type MediaDetails } from './media-titles';
import type { WebItem } from './types';

/** A TMDB search hit (tmdb.ts `TmdbHit`, the same shape; not imported, so browser code never reaches the server-only reader). */
type KinoHit = { type: 'movie' | 'tv'; tmdbId: number; title: string; date?: string; posterPath?: string; language?: string };

/**
 * KINO (Luke, 2026-11-02): the /web SOURCE that asks TMDB alone, a finder for films and shows. Pure and client-safe;
 * the search itself is the server-only provider (search/providers/kino.ts). `scripts/check-web-kino.cjs` holds it.
 *
 * A KINO row is TMDB's details only: title, year, overview, poster (hotlinked from TMDB's image host), runtime,
 * genres and a show's seasons with their episode counts, plus a link out to the title's TMDB page. It has no player:
 * a title one of the media servers holds plays from that server's own row, which takes this row's place when the
 * stream has it (the same id, live-merge.ts). Never a rating, vote count or popularity.
 */

export const KINO_PAGE_HOST = 'www.themoviedb.org';
export const KINO_PAGE_PATH = /^\/(?:movie|tv)\/[1-9][0-9]{0,9}$/;

/** A TMDB hit (and its details, where read) as a KINO row. Its id is the media-server title's id, on purpose. */
export function kinoItem(hit: KinoHit, details: MediaDetails | undefined, fetchedAt: string): WebItem {
  const key = `tmdb-${hit.type}-${hit.tmdbId}`;
  const page = `https://${KINO_PAGE_HOST}/${hit.type}/${hit.tmdbId}`;
  const date = details?.date ?? hit.date;
  const shown: MediaDetails = details ?? { title: hit.title, genres: [], ...(hit.date ? { date: hit.date } : {}), ...(hit.posterPath ? { posterPath: hit.posterPath } : {}) };
  const item: WebItem = {
    id: `${MEDIA_ID_PREFIX}${key}`,
    platform: 'kino',
    externalId: key,
    kind: 'video',
    url: page,
    canonicalUrl: page,
    title: shown.title || hit.title,
    // In release order with everything else (newest first); a title with no date, as found.
    publishedAt: date ? new Date(`${date.length === 4 ? `${date}-01-01` : date}T00:00:00.000Z`).toISOString() : fetchedAt,
    fetchedAt,
    media: { type: hit.type, tmdbId: hit.tmdbId, copies: [], details: shown },
  };
  if (shown.overview) item.description = shown.overview;
  const language = hit.language ?? details?.language;
  if (language) item.language = language;
  const thumbnail = posterUrl(shown.posterPath ?? hit.posterPath);
  if (thumbnail) item.thumbnailUrl = thumbnail;
  if (shown.runtimeMinutes !== undefined) item.durationSeconds = shown.runtimeMinutes * 60;
  if (shown.genres.length > 0) item.tags = shown.genres.map((genre) => genre.toLowerCase());
  return item;
}

/** A show's seasons in words: `3 SEASONS · 30 EPISODES`, specials (season 0) not counted; null for a film or unknown. */
export function seasonsLine(details: MediaDetails | undefined): string | null {
  const seasons = (details?.seasons ?? []).filter((season) => season.season >= 1);
  if (seasons.length === 0) return null;
  const episodes = seasons.reduce((sum, season) => sum + season.episodes, 0);
  return `${seasons.length} SEASON${seasons.length === 1 ? '' : 'S'} · ${episodes} EPISODE${episodes === 1 ? '' : 'S'}`;
}

/**
 * Where a KINO title can be watched, beyond this site (SPEC-kino-sources.md). Client-safe shapes; the reading is
 * server-only (kino-sources.ts) and reaches the page through /api/web/kino/sources.
 */
export type KinoTitle = { type: 'movie' | 'tv'; tmdbId: number };

/** The services with a title free in the viewer's country, from TMDB (the data is JustWatch's: every place it shows must credit them). Service names only. */
export type WatchOffer = { free: string[]; ads: string[] };

/**
 * A free copy on the platform's own player (kino-sources.ts). `publicDomain`: Wikidata says so, the one thing that earns the label.
 * `label` (the Archive item's title, the YouTube channel) and `seconds` are what tell one copy from another when choosing.
 */
export type FreeCopy = { platform: 'internet_archive' | 'youtube'; id: string; publicDomain: boolean; label?: string; seconds?: number };

export type KinoSources = { watch: WatchOffer | null; free: FreeCopy[] };

export const KINO_SOURCES_MAX = 20;
const TITLE_KEY = /^(movie|tv)-([1-9][0-9]{0,8})$/;

export function kinoTitleKey(title: KinoTitle): string {
  return `${title.type}-${title.tmdbId}`;
}

export function parseKinoTitleKey(value: string): KinoTitle | null {
  const match = TITLE_KEY.exec(value);
  return match ? { type: match[1] as KinoTitle['type'], tmdbId: Number(match[2]) } : null;
}

/** A free copy's player address, unchecked: `officialEmbedUrl` checks it before anything is framed. */
export function freeCopyEmbed(copy: Pick<FreeCopy, 'platform' | 'id'>): string {
  return copy.platform === 'youtube' ? `https://www.youtube-nocookie.com/embed/${copy.id}` : `https://archive.org/embed/${copy.id}`;
}
