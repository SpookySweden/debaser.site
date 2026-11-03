import type { AudioTrack } from '../audio/tracks';
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

/** A site path a song may live at: one leading slash, never two (`//host` is another site). */
export function isSitePath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

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
export function songMatches(shelf: readonly AudioTrack[], words: string, limit = 30): AudioTrack[] {
  const wanted = words.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (wanted.length === 0) return [];
  const seen = new Set<string>();
  const found: AudioTrack[] = [];
  for (const track of shelf) {
    if (track.shelf === 'web' || seen.has(track.src)) continue;
    const text = `${track.title} ${track.credit}`.toLowerCase();
    if (!wanted.every((word) => text.includes(word))) continue;
    seen.add(track.src);
    found.push(track);
    if (found.length >= limit) break;
  }
  return found;
}
