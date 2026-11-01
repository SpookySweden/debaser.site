import { isMediaServerId, MEDIA_SERVERS } from './media-servers';
import { titleToItem, type MediaCopy, type MediaDetails, type MediaTitle, type MediaType } from './media-titles';
import { canonicalIso } from './rows';
import type { WebItem } from './types';
import { isSafeIdentifier } from './urls';

/**
 * The `web_media_titles` / `web_media_copies` rows (supabase/migrations/*_web_media.sql) and their mapping to a
 * stream row. Client-safe: the Supabase repository reads with it in the browser. Signed-in readers only: Row
 * Level Security returns nothing to a visitor.
 *
 * Every value is checked again on the way in, as the stream's own rows are: a copy on a server no longer in
 * media-servers.ts is dropped (and a title with no copy left is no row), episodes must be pairs of whole
 * numbers, and TMDB's details must have the shape the update writes. The column list is the whole of what is
 * ever selected: no rating, vote count or popularity exists to select.
 */

export const WEB_MEDIA_TITLES_TABLE = 'web_media_titles';

export const WEB_MEDIA_COLUMNS =
  'id, media_type, tmdb_id, title, creator, description, thumbnail_url, duration_seconds, released_at, details, collection_id, published_at, fetched_at, web_media_copies!inner(server, local_id, episodes)';

export type WebMediaRow = {
  id: string;
  media_type: string;
  tmdb_id: number | null;
  title: string;
  creator: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  released_at: string | null;
  details: unknown;
  /** The film's TMDB collection, copied out of `details` by the database so a collection's films can be read together. */
  collection_id?: number | null;
  published_at: string;
  fetched_at: string;
  web_media_copies: { server: string; local_id: string | null; episodes: unknown }[] | null;
};

const MEDIA_ID = /^media:([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/;
const TYPES: readonly MediaType[] = ['movie', 'tv', 'other'];
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined);

function readEpisodes(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((pair): [number, number][] =>
    Array.isArray(pair) && pair.length === 2 && isWhole(pair[0], 0, 999) && isWhole(pair[1], 0, 9999) ? [[pair[0], pair[1]]] : [],
  );
}

/** TMDB's details as the update saved them, or undefined when the shape is not that. */
export function readDetails(value: unknown): MediaDetails | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const d = value as Record<string, unknown>;
  const title = text(d.title, 300);
  if (title === undefined) return undefined;
  const details: MediaDetails = {
    title,
    genres: (Array.isArray(d.genres) ? d.genres : []).flatMap((genre) => (typeof genre === 'string' && genre.length > 0 ? [genre.slice(0, 40)] : [])).slice(0, 6),
  };
  if (typeof d.date === 'string' && /^\d{4}(-\d{2}-\d{2})?$/.test(d.date)) details.date = d.date;
  const overview = text(d.overview, 1000);
  if (overview) details.overview = overview;
  if (typeof d.posterPath === 'string') details.posterPath = d.posterPath;
  if (isWhole(d.runtimeMinutes, 1, 6000)) details.runtimeMinutes = d.runtimeMinutes;
  const c = typeof d.collection === 'object' && d.collection !== null ? (d.collection as Record<string, unknown>) : null;
  const cName = c ? text(c.name, 300) : undefined;
  if (c && isWhole(c.id, 1, 999_999_999) && cName) {
    details.collection = { id: c.id as number, name: cName };
    if (typeof c.posterPath === 'string') details.collection.posterPath = c.posterPath;
  }
  if (Array.isArray(d.seasons)) {
    details.seasons = d.seasons.flatMap((season) => {
      const s = season as Record<string, unknown> | null;
      return isWhole(s?.season, 0, 999) && isWhole(s?.episodes, 0, 9999) ? [{ season: s.season as number, episodes: s.episodes as number }] : [];
    });
  }
  return details;
}

/** One stream row, or null when nothing playable is left (no copy on a listed server) or the row is malformed. */
export function mediaRowToItem(row: WebMediaRow): WebItem | null {
  const key = MEDIA_ID.exec(row.id)?.[1];
  const title = text(row.title, 300);
  if (key === undefined || title === undefined) return null;
  const type = TYPES.includes(row.media_type as MediaType) ? (row.media_type as MediaType) : 'other';
  const order = (server: string) => MEDIA_SERVERS.findIndex((candidate) => candidate.id === server);
  const copies: MediaCopy[] = (row.web_media_copies ?? [])
    .filter((copy) => isMediaServerId(copy.server))
    .sort((a, b) => order(a.server) - order(b.server))
    .map((copy) => {
      const out: MediaCopy = { server: copy.server as MediaCopy['server'] };
      if (isSafeIdentifier(copy.local_id, 100)) out.localId = copy.local_id;
      if (type === 'tv') {
        out.episodes = readEpisodes(copy.episodes) ?? [];
        // A show's copy with no episodes can only come from a whole-show entry in the list (media-titles.ts).
        if (out.episodes.length === 0) out.series = true;
      }
      return out;
    });
  if (copies.length === 0) return null;

  const media: MediaTitle = { id: row.id, key, type, title, copies };
  if (isWhole(row.tmdb_id, 1, 999_999_999)) media.tmdbId = row.tmdb_id;
  const creator = text(row.creator, 200);
  if (creator) media.creator = creator;
  const description = text(row.description, 1000);
  if (description) media.description = description;
  if (isWhole(row.duration_seconds, 1, 360_000)) media.durationSeconds = row.duration_seconds;
  // A list's own picture: the page checks it again against the server's host (row-addresses.ts) before drawing.
  const thumbnail = text(row.thumbnail_url, 600);
  if (thumbnail) media.thumbnailUrl = thumbnail;
  return titleToItem(media, { publishedAt: canonicalIso(row.published_at), fetchedAt: canonicalIso(row.fetched_at) }, readDetails(row.details));
}
