import { buildUrl, isSafeIdentifier } from '../web/urls';
import { LINK_TITLE_MAX, youtubeId, youtubeWatchUrl } from './links';
import type { WatchLink } from './types';

/**
 * Series in a stream room (SPEC-stream-series.md): an Internet Archive item holding two or more videos, or a
 * YouTube playlist. Client-safe and pure: which pasted addresses name one, and the checks on what our own route
 * (`/api/web/series`) answers, which is treated like any third-party row. The reading itself is server-side
 * (app/lib/web/series-files.ts), through `safe-fetch`.
 *
 * An Archive episode is its video file's https address on archive.org (`download/{item}/{file}`), played in the
 * room's own `<video>`, in step for everybody, straight from the Archive; a YouTube episode is a plain watch
 * address for the room's YouTube player. Nothing is downloaded, copied or re-hosted.
 */

export type SeriesTarget = { source: 'internet_archive'; id: string } | { source: 'youtube'; list: string };

export type SeriesEpisode = { title: string; url: string; kind: 'file' | 'youtube'; seconds: number | null };

export type SeriesRead = {
  title: string;
  target: SeriesTarget;
  /** In the platform's order; one or none means it is not a series. */
  episodes: SeriesEpisode[];
  /** A very long playlist read only in part (the time a read may take ran out): the episodes are its start. */
  partial: boolean;
};

/** A YouTube playlist's id. Mixes (`RD...`) are endless and made per viewer, so they are not series. */
const PLAYLIST_ID = /^(?!RD)[A-Za-z0-9_-]{10,64}$/;
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'];
const ARCHIVE_HOSTS = ['archive.org', 'www.archive.org'];

/**
 * The series a pasted address names, or null: an archive.org `details` page (the item; a file path after it
 * still means the item), or a YouTube `playlist?list=` page. A watch address with a list in it stays a video.
 */
export function seriesTargetOf(text: string): SeriesTarget | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname.toLowerCase();
  if (ARCHIVE_HOSTS.includes(host)) {
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    return parts[0] === 'details' && isSafeIdentifier(parts[1]) ? { source: 'internet_archive', id: parts[1] } : null;
  }
  if (YOUTUBE_HOSTS.includes(host) && url.pathname === '/playlist') {
    const list = url.searchParams.get('list') ?? '';
    return PLAYLIST_ID.test(list) ? { source: 'youtube', list } : null;
  }
  return null;
}

/** The query our route takes for a target: `ia=<item>` or `list=<playlist>`. */
export function seriesQuery(target: SeriesTarget): string {
  return target.source === 'internet_archive' ? `ia=${encodeURIComponent(target.id)}` : `list=${encodeURIComponent(target.list)}`;
}

/** Where an Archive item's files are fetched by the viewer's browser: every episode's address starts here. */
export function archiveDownloadPrefix(id: string): string {
  return `${buildUrl('archive.org', ['download', id])}/`;
}

/** One title as the room keeps it: plain words, one line, at most a link title's length. */
function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LINK_TITLE_MAX).trim() : '';
}

/**
 * Whether an episode may go in a room: an Archive one only as an https file inside its own item on archive.org,
 * a YouTube one only as the canonical watch address. Re-asked on everything the route answers.
 */
export function episodeAllowed(target: SeriesTarget, episode: SeriesEpisode): boolean {
  if (typeof episode.url !== 'string' || episode.url.length > 2048) return false;
  if (target.source === 'internet_archive') {
    if (episode.kind !== 'file') return false;
    const prefix = archiveDownloadPrefix(target.id);
    try {
      // Read as the browser will fetch it: a `..` in the address would climb out of the item.
      const url = new URL(episode.url);
      return url.href === episode.url && url.href.startsWith(prefix) && url.href.length > prefix.length && url.search === '' && url.hash === '';
    } catch {
      return false;
    }
  }
  if (episode.kind !== 'youtube') return false;
  try {
    const id = youtubeId(new URL(episode.url));
    return id !== null && youtubeWatchUrl(id) === episode.url;
  } catch {
    return false;
  }
}

/** The route's answer, checked: only episodes that may go in a room, titles as plain text. Null for anything malformed. */
export function readSeriesAnswer(target: SeriesTarget, body: unknown): SeriesRead | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as { title?: unknown; episodes?: unknown; partial?: unknown };
  if (!Array.isArray(record.episodes)) return null;
  const episodes: SeriesEpisode[] = [];
  for (const raw of record.episodes) {
    if (!raw || typeof raw !== 'object') continue;
    const value = raw as Record<string, unknown>;
    if (value.kind !== 'file' && value.kind !== 'youtube') continue;
    const episode: SeriesEpisode = {
      title: cleanTitle(value.title),
      url: typeof value.url === 'string' ? value.url : '',
      kind: value.kind,
      seconds: typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds > 0 ? value.seconds : null,
    };
    if (episode.title.length === 0) episode.title = `EPISODE ${episodes.length + 1}`;
    if (episodeAllowed(target, episode)) episodes.push(episode);
  }
  const fallback = target.source === 'internet_archive' ? target.id : 'YOUTUBE PLAYLIST';
  return { title: cleanTitle(record.title) || fallback, target, episodes, partial: record.partial === true };
}

/** An episode as the link a queue row keeps. */
export function episodeLink(episode: SeriesEpisode): WatchLink {
  return { url: episode.url, kind: episode.kind, title: episode.title };
}

/** `SERIES :: 13 EPISODES`: the mark beside a series' platform in search, and on /web rows. */
export function seriesMark(count: number): string {
  return `SERIES :: ${count} EPISODE${count === 1 ? '' : 'S'}`;
}
