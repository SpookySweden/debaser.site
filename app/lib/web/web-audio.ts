import type { AudioTrack } from '../audio/tracks';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from './types';
import { isSafeIdentifier } from './urls';

/**
 * WEB audio in the site's music bar (Luke's OK, 2026-10-31). Pure, so the page may import it; the
 * server half that finds the files is `audio-files.ts`.
 *
 * **Still never re-hosted.** A web track's `src` is a site address,
 * `/api/web/audio/<platform>/<id>/<n>`, which answers with a redirect to the platform's own file: the
 * listener's browser streams it from the Internet Archive, the podcast's host or Openverse's source, and
 * no byte of audio passes through this site. The site address is what makes it a track like any other:
 * one stable key a broadcast, a like or a playlist can point at, which says which item it came from.
 */

/** The platforms whose audio items have a file the bar can play. */
export const BAR_AUDIO_PLATFORMS = ['internet_archive', 'podcast', 'openverse', 'audiobooks'] as const;
export type BarAudioPlatform = (typeof BAR_AUDIO_PLATFORMS)[number];

const ROUTE = '/api/web/audio';
/** The most files one item hands the bar (a long audiobook's chapters). */
export const MAX_WEB_FILES = 300;

export function isBarAudioPlatform(value: unknown): value is BarAudioPlatform {
  return typeof value === 'string' && (BAR_AUDIO_PLATFORMS as readonly string[]).includes(value);
}

/** True when PLAY on this row sends it to the music bar rather than opening the platform's player. */
export function playsInBar(item: Pick<WebItem, 'kind' | 'platform' | 'externalId'>): boolean {
  return item.kind === 'audio' && isBarAudioPlatform(item.platform) && isSafeIdentifier(item.externalId);
}

/** Where the page asks for an item's files. */
export function webAudioListPath(platform: BarAudioPlatform, externalId: string): string {
  return `${ROUTE}/${platform}/${encodeURIComponent(externalId)}`;
}

/** One file's site address: the track's `src`. */
export function webAudioFilePath(platform: BarAudioPlatform, externalId: string, index: number): string {
  return `${webAudioListPath(platform, externalId)}/${index}`;
}

/** The item a web track's `src` came from, or null for any other address. */
export function parseWebAudioSrc(src: string): { platform: BarAudioPlatform; externalId: string; index: number } | null {
  const match = src.match(/^\/api\/web\/audio\/([a-z_]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(0|[1-9]\d{0,2})$/);
  if (!match || !isBarAudioPlatform(match[1]) || !isSafeIdentifier(match[2])) return null;
  const index = Number(match[3]);
  return index < MAX_WEB_FILES ? { platform: match[1], externalId: match[2], index } : null;
}

export function isWebAudioSrc(src: string): boolean {
  return parseWebAudioSrc(src) !== null;
}

/**
 * A web track's id: `web:<platform>:<id>:<n>`. It is what a like or a playlist stores (they key by id,
 * where a broadcast, a BARR and RADI-OH key by `src`), so it too says which item and file it came from.
 */
export function webTrackId(platform: BarAudioPlatform, externalId: string, index: number): string {
  return `web:${platform}:${externalId}:${index}`;
}

/** The item a web track id came from, or null for any other id (an archive file's path, a post's link). */
export function parseWebTrackId(id: string): { platform: BarAudioPlatform; externalId: string; index: number } | null {
  const match = id.match(/^web:([a-z_]+):([A-Za-z0-9][A-Za-z0-9._-]*):(0|[1-9]\d{0,2})$/);
  if (!match || !isBarAudioPlatform(match[1]) || !isSafeIdentifier(match[2])) return null;
  const index = Number(match[3]);
  return index < MAX_WEB_FILES ? { platform: match[1], externalId: match[2], index } : null;
}

/** The id that goes with a web track's `src`, or null when the address is not a web track's. */
export function webTrackIdFromSrc(src: string): string | null {
  const parsed = parseWebAudioSrc(src);
  return parsed ? webTrackId(parsed.platform, parsed.externalId, parsed.index) : null;
}

/** What the list route answers: the item's own words, and one entry per file in playing order. */
export type WebAudioAnswer = {
  title: string;
  creator: string;
  files: { title: string; seconds: number | null }[];
};

/** A running time as the player's lists write it (`m:ss`, or `h:mm:ss`), or `--:--` when unknown. */
export function lengthFromSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The answer as the bar's tracks. A single file takes the item's title; a book's chapters keep theirs. */
export function webTracks(platform: BarAudioPlatform, externalId: string, answer: WebAudioAnswer): AudioTrack[] {
  const single = answer.files.length === 1;
  return answer.files.slice(0, MAX_WEB_FILES).map((file, index) => ({
    id: webTrackId(platform, externalId, index),
    title: single ? answer.title : file.title || `${answer.title} (${index + 1})`,
    credit: answer.creator,
    kind: PLATFORM_LABELS[platform as WebPlatform],
    src: webAudioFilePath(platform, externalId, index),
    length: lengthFromSeconds(file.seconds),
    tags: [],
    folderPath: null,
    shelf: 'web',
  }));
}

/** A list answer read defensively: anything off-shape is null, and the row falls back to the platform's player. */
export function readWebAudioAnswer(body: unknown): WebAudioAnswer | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.title !== 'string' || typeof record.creator !== 'string' || !Array.isArray(record.files)) return null;
  const files = record.files
    .filter((file): file is Record<string, unknown> => !!file && typeof file === 'object')
    .map((file) => ({
      title: typeof file.title === 'string' ? file.title : '',
      seconds: typeof file.seconds === 'number' && Number.isFinite(file.seconds) ? file.seconds : null,
    }));
  return files.length > 0 ? { title: record.title, creator: record.creator, files } : null;
}
