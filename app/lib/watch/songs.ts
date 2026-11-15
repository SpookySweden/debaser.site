import type { AudioTrack } from '../audio/tracks';
import { matchesAuthor } from '../web/search';
import type { WatchLink, WatchQueueEntry } from './types';

/**
 * Songs in a room's queue (SPEC-music-queues.md): one mixed queue, where a row is a video or a song. Pure.
 *
 * A song row is a link of kind `audio` whose address is the music bar's own key for the track, its `src`:
 * a site path (`/assets/audio/...`, the archive's `/api/web/audio/...` redirect) or the mp3 bucket's https
 * address. Only that address and the title are kept; the music player plays it the way it plays any track,
 * and nothing is copied (the archive rules in CLAUDE.md hold).
 */

/** The database holds the same limit (`watch_queue_link_title`). */
const SONG_TITLE_MAX = 200;

/** The row's link for a track the music bar can play. */
export function songLink(track: Pick<AudioTrack, 'src' | 'title'>): WatchLink {
  const title = track.title.trim().slice(0, SONG_TITLE_MAX);
  return { url: track.src, kind: 'audio', title: title.length > 0 ? title : (track.src.split('/').pop() ?? 'A SONG') };
}

export function isSongLink(link: WatchLink | null | undefined): link is WatchLink {
  return link !== null && link !== undefined && link.kind === 'audio';
}

export function isSongEntry(entry: Pick<WatchQueueEntry, 'link'> | null | undefined): boolean {
  return isSongLink(entry?.link);
}

/**
 * A site path a song or a picture may live at: an address that a browser, on this site, resolves to this site.
 *
 * Decided the way a browser decides it, never by looking at the first characters (code review, 2026-11-15): a browser
 * reads a backslash as a slash and drops tabs and line breaks, so `/\\host/x`, or a slash, a tab and `/host/x`, start
 * with one slash and still load from another site. Any backslash, space or control character is refused outright,
 * and what is left must resolve to the same origin it was resolved against.
 */
export function isSitePath(url: string): boolean {
  if (typeof url !== 'string' || !url.startsWith('/')) return false;
  for (let at = 0; at < url.length; at += 1) {
    const code = url.charCodeAt(at);
    // A backslash, a space, or any control character (tab, line break, delete).
    if (code === 92 || code <= 32 || code === 127) return false;
  }
  try {
    return new URL(url, SITE_STAND_IN).origin === SITE_STAND_IN;
  } catch {
    return false;
  }
}

/** A stand-in for this site's own address, to resolve a path against: `.invalid` is never a real host. */
const SITE_STAND_IN = 'https://site.invalid';

/**
 * The track a song row plays: the shelf's own when it holds the file (its credit, length, folder), else
 * `lookedUp` (a WEB track put back together from its address), else a plain track from the row itself.
 */
export function trackForSong(link: WatchLink, shelf: readonly AudioTrack[], lookedUp?: AudioTrack | null): AudioTrack {
  const held = shelf.find((track) => track.src === link.url);
  if (held !== undefined) return held;
  if (lookedUp !== undefined && lookedUp !== null) return lookedUp;
  return { id: link.url, title: link.title, credit: '', kind: '', src: link.url, length: '--:--', tags: [], folderPath: null, shelf: 'bucket' };
}

/** The site's own songs whose title or credit has every word in it; no words, none (the shelf is long). */
export function songMatches(
  shelf: readonly AudioTrack[],
  words: string,
  limit = 30,
  /** The queue search's filters: `listAll`, no words lists every song (MUSIC with nothing typed); `anyWord`, VIBE; `authors`, `from:`. */
  filters: { listAll?: boolean; anyWord?: boolean; authors?: readonly (readonly string[])[] | null } = {},
): AudioTrack[] {
  const wanted = words.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  const authors = filters.authors ?? null;
  if (wanted.length === 0 && authors === null && filters.listAll !== true) return [];
  const seen = new Set<string>();
  const found: AudioTrack[] = [];
  for (const track of shelf) {
    if (track.shelf === 'web' || seen.has(track.src)) continue;
    const text = `${track.title} ${track.credit}`.toLowerCase();
    const hit = (word: string) => text.includes(word);
    if (wanted.length > 0 && !(filters.anyWord ? wanted.some(hit) : wanted.every(hit))) continue;
    if (authors !== null && !matchesAuthor({ creator: track.credit }, authors)) continue;
    seen.add(track.src);
    found.push(track);
    if (found.length >= limit) break;
  }
  return found;
}
