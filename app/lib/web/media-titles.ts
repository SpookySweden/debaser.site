import { mediaServer, MEDIA_SERVERS, serverHost, type MediaServer, type MediaServerId } from './media-servers';
import { plausibleIsoDate, sanitiseText } from './sanitise';
import type { WebItem } from './types';
import { isAllowedUrl, isSafeIdentifier } from './urls';

/**
 * Media-server titles (SPEC-media-servers.md): reading a server's list file, folding the same title on several
 * servers into one, and the play address for one server. Pure and client-safe; `scripts/check-web-media.cjs`
 * holds every rule here.
 *
 * **The list file**, in the shape Luke's friend's server writes (sample, 2026-11-01): a JSON array, one entry
 * per film or per episode of a show:
 *
 *   { "title": "Example Movie", "type": "movie", "tmdb_id": "157336", "provider": "friends_server" }
 *   { "title": "Example TV Show", "type": "tv", "tmdb_id": "1399", "season": "1", "episode": "1", ... }
 *
 * Read on top, when a list gives them (spec decision 6, the fields the Internet Archive adapter fills): `id`
 * (the server's own id, for its videos with no TMDB number), `description`, `creator`, `date`, `duration`
 * (seconds) and `thumbnail`. A field the list lacks stays empty. `provider` is never read: which server an entry
 * belongs to is which list it came from, never what the list says about itself.
 *
 * **Addresses from a list** follow the podcast-style exception to "never use a URL from remote data": a
 * picture address is kept only when it is https on that same server's own host, with no query and no `..`;
 * anything else is dropped. Play addresses are never taken from a list at all: they are built from the
 * server's `play` patterns in media-servers.ts with checked numbers and ids only.
 */

export type MediaType = 'movie' | 'tv' | 'other';

/** TMDB's details for a title (spec decision 7). Never a rating, a vote count or a popularity. */
export type MediaDetails = {
  title: string;
  /** `YYYY-MM-DD` or `YYYY`. */
  date?: string;
  overview?: string;
  /** TMDB's poster file, `/abc123.jpg`: drawn from TMDB's image host, never copied. */
  posterPath?: string;
  runtimeMinutes?: number;
  genres: string[];
  /** Shows only: each season and how many episodes TMDB lists for it. */
  seasons?: { season: number; episodes: number }[];
  /** Films only: the TMDB collection (film series) it belongs to, from `belongs_to_collection`. */
  collection?: MediaCollection;
};

/** A TMDB collection: a film series such as all the Star Wars films. */
export type MediaCollection = { id: number; name: string; posterPath?: string };

/**
 * One server's copy of a title. `episodes`: the `[season, episode]` pairs it holds (shows only). `series`: its
 * list says it holds the whole show (an entry with no season and episode).
 */
export type MediaCopy = { server: MediaServerId; localId?: string; episodes?: [number, number][]; series?: boolean };

/** One film of a collection row (media-collections.ts): what the FILM picker offers and plays. */
export type MediaPart = { id: string; title: string; tmdbId?: number; date?: string; copies: MediaCopy[]; details?: MediaDetails };

/** What a media-server title carries on top of a `WebItem` (types.ts `media`). */
export type MediaInfo = {
  type: MediaType;
  tmdbId?: number;
  copies: MediaCopy[];
  details?: MediaDetails;
  /** A collection row only: the collection, and its films on the servers in release order (the row's own film among them). */
  collection?: MediaCollection;
  parts?: MediaPart[];
};

/** One entry of a list file, read and checked. */
export type ListEntry = {
  server: MediaServerId;
  /** The title this entry belongs to (`mediaKey`): TMDB's number, or the server's own id. */
  key: string;
  type: MediaType;
  tmdbId?: number;
  localId?: string;
  title: string;
  creator?: string;
  description?: string;
  date?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  season?: number;
  episode?: number;
  /** A show listed as a whole (no season and episode): the server can play it with its whole-series player. */
  wholeSeries?: boolean;
};

/** A list may hold a whole library; the reader stops here (a show is one entry per episode). */
export const MAX_LIST_ENTRIES = 20_000;
const MAX_TMDB_ID = 999_999_999;
const MAX_SEASON = 999;
const MAX_EPISODE = 9_999;

/** TMDB's poster sizes are fixed; the stream asks for one. */
export const TMDB_IMAGE_HOST = 'image.tmdb.org';
export const TMDB_POSTER_SIZE = 'w342';
export const TMDB_POSTER_FILE = /^\/[A-Za-z0-9]{8,64}\.(?:jpg|jpeg|png|webp)$/;
/** A picture path on a server: plain characters, no `..`, no query (the host check is separate). */
const SERVER_PICTURE_PATH = /^\/(?!.*\.\.)[A-Za-z0-9._~/-]{1,300}$/;

/** Every media item id starts with this: `media:tmdb-movie-157336`, `media:server_1-abc`. */
export const MEDIA_ID_PREFIX = 'media:';

/** A whole number from a number or a digits-only string, within bounds; anything else is undefined. */
function wholeNumber(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,10}\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function readType(value: unknown): MediaType {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (word === 'movie' || word === 'film') return 'movie';
  if (word === 'tv' || word === 'show' || word === 'series' || word === 'episode') return 'tv';
  return 'other';
}

/** A server's picture address, kept only on that server's own host (the podcast-style exception). */
export function serverPicture(value: unknown, server: Pick<MediaServer, 'base'>): string | undefined {
  // `..` is refused as written: the address reader would tidy it away, but a list writing one is not to be trusted.
  if (!isAllowedUrl(value, [serverHost(server)]) || value.includes('..')) return undefined;
  const url = new URL(value);
  return url.search === '' && url.hash === '' && url.port === '' && SERVER_PICTURE_PATH.test(url.pathname) ? url.toString() : undefined;
}

/** The title an entry belongs to: one key across servers for a TMDB number, one server's own id otherwise. */
export function mediaKey(server: MediaServerId, type: MediaType, tmdbId: number | undefined, localId: string | undefined): string | null {
  if (tmdbId !== undefined && type !== 'other') return `tmdb-${type}-${tmdbId}`;
  if (localId !== undefined) return `${server}-${localId}`;
  return null;
}

/** One entry of a list file, or null when it is unusable (no title, a show with no season and episode...). */
export function readEntry(raw: unknown, server: MediaServerId, notAfter: string): ListEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  const title = sanitiseText(doc.title, 300);
  if (title.length === 0) return null;
  const type = readType(doc.type);
  const tmdbId = wholeNumber(doc.tmdb_id, 1, MAX_TMDB_ID);
  const localId = isSafeIdentifier(doc.id, 100) ? doc.id : undefined;
  const season = wholeNumber(doc.season, 0, MAX_SEASON);
  const episode = wholeNumber(doc.episode, 0, MAX_EPISODE);
  // An episode needs both numbers: the pickers and the player are built from them. A show with neither (and a TMDB
  // number) is the whole show, for the server's whole-series player; one number without the other is unusable.
  const wholeSeries = type === 'tv' && season === undefined && episode === undefined && tmdbId !== undefined;
  if (type === 'tv' && !wholeSeries && (season === undefined || episode === undefined)) return null;
  const key = mediaKey(server, type, tmdbId, localId);
  if (key === null) return null;

  const entry: ListEntry = { server, key, type, title };
  if (tmdbId !== undefined && type !== 'other') entry.tmdbId = tmdbId;
  if (localId !== undefined) entry.localId = localId;
  const creator = sanitiseText(doc.creator, 200);
  if (creator) entry.creator = creator;
  const description = sanitiseText(doc.description, 1000);
  if (description) entry.description = description;
  const date = plausibleIsoDate(doc.date, notAfter);
  if (date) entry.date = date;
  const duration = wholeNumber(doc.duration, 1, 100 * 3600);
  if (duration !== undefined) entry.durationSeconds = duration;
  const thumbnail = serverPicture(doc.thumbnail, mediaServer(server));
  if (thumbnail) entry.thumbnailUrl = thumbnail;
  if (wholeSeries) entry.wholeSeries = true;
  else if (type === 'tv') {
    entry.season = season;
    entry.episode = episode;
  }
  return entry;
}

/** A whole list file. Anything that is not an array of entries reads as nothing, never as an error page. */
export function parseList(body: unknown, server: MediaServerId, notAfter: string): ListEntry[] {
  if (!Array.isArray(body)) return [];
  return body.slice(0, MAX_LIST_ENTRIES).flatMap((raw) => {
    const entry = readEntry(raw, server, notAfter);
    return entry === null ? [] : [entry];
  });
}

/** One title as the hourly update saves it: what the lists say, and which servers hold which episodes. */
export type MediaTitle = {
  id: string;
  key: string;
  type: MediaType;
  tmdbId?: number;
  title: string;
  creator?: string;
  description?: string;
  date?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  copies: MediaCopy[];
};

const byPair = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];

/**
 * Every server's entries folded into titles (spec decision 2): one title per TMDB number (a show: all its
 * episodes), whichever servers hold it; a title with no TMDB number only ever within its own server. A title's
 * words come from the first server, in MEDIA_SERVERS order, that lists it; each copy keeps its own episodes.
 */
export function groupTitles(entries: readonly ListEntry[]): MediaTitle[] {
  const order = (server: MediaServerId) => MEDIA_SERVERS.findIndex((candidate) => candidate.id === server);
  const sorted = [...entries].sort((a, b) => order(a.server) - order(b.server));
  const titles = new Map<string, MediaTitle>();
  const episodes = new Map<string, Map<MediaServerId, Set<string>>>();

  for (const entry of sorted) {
    let title = titles.get(entry.key);
    if (title === undefined) {
      title = { id: `${MEDIA_ID_PREFIX}${entry.key}`, key: entry.key, type: entry.type, title: entry.title, copies: [] };
      if (entry.tmdbId !== undefined) title.tmdbId = entry.tmdbId;
      for (const field of ['creator', 'description', 'date', 'durationSeconds', 'thumbnailUrl'] as const) {
        if (entry[field] !== undefined) (title as Record<string, unknown>)[field] = entry[field];
      }
      titles.set(entry.key, title);
      episodes.set(entry.key, new Map());
    }
    if (!title.copies.some((copy) => copy.server === entry.server)) {
      title.copies.push(entry.localId === undefined ? { server: entry.server } : { server: entry.server, localId: entry.localId });
    }
    if (entry.wholeSeries) (title.copies.find((copy) => copy.server === entry.server) as MediaCopy).series = true;
    if (entry.type === 'tv' && entry.season !== undefined && entry.episode !== undefined) {
      const held = episodes.get(entry.key) as Map<MediaServerId, Set<string>>;
      const set = held.get(entry.server) ?? new Set<string>();
      set.add(`${entry.season}:${entry.episode}`);
      held.set(entry.server, set);
    }
  }

  for (const title of titles.values()) {
    if (title.type !== 'tv') continue;
    const held = episodes.get(title.key) as Map<MediaServerId, Set<string>>;
    for (const copy of title.copies) {
      copy.episodes = [...(held.get(copy.server) ?? [])].map((pair) => pair.split(':').map(Number) as [number, number]).sort(byPair);
    }
  }
  return [...titles.values()];
}

/** TMDB's poster on TMDB's own image host, or undefined when the file name is not one TMDB writes. */
export function posterUrl(posterPath: string | undefined): string | undefined {
  return posterPath !== undefined && TMDB_POSTER_FILE.test(posterPath) ? `https://${TMDB_IMAGE_HOST}/t/p/${TMDB_POSTER_SIZE}${posterPath}` : undefined;
}

/**
 * A title as a stream row. TMDB's details, where it has them, win over the list's words; the list's own
 * fields fill in for a title TMDB does not know (spec decision 6). `publishedAt` is when the title first
 * appeared on a server, so it sits in the stream by arrival, not by release date (a 1968 film added today is new).
 */
export function titleToItem(title: MediaTitle, times: { publishedAt: string; fetchedAt: string }, details?: MediaDetails): WebItem {
  const first = title.copies[0]?.server ?? MEDIA_SERVERS[0].id;
  const server = mediaServer(first);
  const runtime = details?.runtimeMinutes;
  const item: WebItem = {
    id: title.id,
    platform: first,
    externalId: title.key,
    kind: 'video',
    // No page of its own: the row draws no link (hosts.ts: pagePath NEVER); its players are per server.
    url: server.base,
    canonicalUrl: server.base,
    title: details?.title || title.title,
    publishedAt: times.publishedAt,
    fetchedAt: times.fetchedAt,
    media: details === undefined ? { type: title.type, copies: title.copies } : { type: title.type, copies: title.copies, details },
  };
  if (title.tmdbId !== undefined) (item.media as MediaInfo).tmdbId = title.tmdbId;
  if (title.creator) item.creator = title.creator;
  const description = details?.overview || title.description;
  if (description) item.description = description;
  const thumbnail = posterUrl(details?.posterPath) ?? title.thumbnailUrl;
  if (thumbnail) item.thumbnailUrl = thumbnail;
  const seconds = runtime !== undefined ? runtime * 60 : title.durationSeconds;
  if (seconds !== undefined) item.durationSeconds = seconds;
  return item;
}

/** What to play: a show's season and episode, or the whole show (`whole`); nothing for a film. */
export type PlayChoice = { season?: number; episode?: number; whole?: boolean };

/**
 * Whether this server's copy holds what is asked for: a film, any copy; an episode, that very episode; the whole
 * show, a copy its list calls whole or that holds any episode of it (the server's series player shows what it has).
 */
export function copyHolds(copy: MediaCopy, choice: PlayChoice): boolean {
  if (choice.whole) return copy.series === true || (copy.episodes ?? []).length > 0;
  if (choice.season === undefined || choice.episode === undefined) return true;
  return (copy.episodes ?? []).some(([season, episode]) => season === choice.season && episode === choice.episode);
}

/**
 * The address of one server's player for this title, built from the server's `play` pattern (media-servers.ts)
 * with checked numbers and ids only, and held to the server's own host. Null when that server cannot play it
 * (no copy, not that episode, no whole-series player, no pattern for a video with no TMDB number).
 */
export function mediaPlayUrl(server: MediaServer, media: Pick<MediaInfo, 'type' | 'tmdbId' | 'copies'>, choice: PlayChoice = {}): string | null {
  const copy = media.copies.find((candidate) => candidate.server === server.id);
  if (copy === undefined || !copyHolds(copy, media.type === 'tv' ? choice : {})) return null;

  let path: string | undefined;
  const fill: Record<string, string> = {};
  if (media.type === 'movie' && media.tmdbId !== undefined) {
    path = server.play.movie;
    fill.tmdb = String(media.tmdbId);
  } else if (media.type === 'tv' && media.tmdbId !== undefined && choice.whole) {
    path = server.play.series;
    fill.tmdb = String(media.tmdbId);
  } else if (media.type === 'tv' && media.tmdbId !== undefined && choice.season !== undefined && choice.episode !== undefined) {
    path = server.play.tv;
    fill.tmdb = String(media.tmdbId);
    fill.season = String(choice.season);
    fill.episode = String(choice.episode);
  } else if (copy.localId !== undefined && isSafeIdentifier(copy.localId, 100)) {
    path = server.play.other;
    fill.id = copy.localId;
  }
  if (path === undefined) return null;
  const filled = path.replace(/\{(tmdb|season|episode|id)\}/g, (_whole, name: string) => encodeURIComponent(fill[name] ?? ''));
  if (/\{|\}/.test(filled) || Object.values(fill).some((value) => value === '')) return null;

  let url: URL;
  try {
    url = new URL(filled, server.base);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.hostname === serverHost(server) && url.port === '' ? url.toString() : null;
}

/** Every season with the episodes any server holds, for the pickers. */
export function heldEpisodes(media: Pick<MediaInfo, 'copies'>): Map<number, number[]> {
  const seasons = new Map<number, Set<number>>();
  for (const copy of media.copies) {
    for (const [season, episode] of copy.episodes ?? []) {
      const set = seasons.get(season) ?? new Set<number>();
      set.add(episode);
      seasons.set(season, set);
    }
  }
  return new Map([...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([season, set]) => [season, [...set].sort((a, b) => a - b)]));
}
