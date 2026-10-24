import { MAX_TRACK_BYTES, MUSIC_ACCEPT, MUSIC_BUCKET } from '../audio/catalogue';
import { AVATAR_ACCEPT, MAX_AVATAR_BYTES } from '../profile/avatar-catalogue';
import type { MediaKind } from './types';

/**
 * What the catalogue accepts, per kind, and where it files it.
 *
 * Pictures keep the profile-picture rules (2MB, the four image types) and music keeps the shelf's
 * (20MB, five audio types) - both decided before the catalogue existed and reused so a file refused on
 * one screen is refused with the same sentence on every other. Video is new: MP4 or WebM, 25MB, because
 * the free storage tier is 1GB and forty videos of that size fill it (SPEC-media-catalogue.md, risks).
 *
 * The buckets' own limits (supabase/migrations/20261024021600_media_catalogue.sql) mirror these numbers;
 * the browser refuses first so the bucket only ever sees a file the site has already accepted.
 */

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const VIDEO_ACCEPT = 'video/mp4,video/webm,.mp4,.webm';

/** The kind each bucket holds, and the bucket each kind goes to. */
export const MEDIA_BUCKETS: Record<MediaKind, string> = {
  image: 'images',
  audio: MUSIC_BUCKET,
  video: 'video',
};

export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: MAX_AVATAR_BYTES,
  audio: MAX_TRACK_BYTES,
  video: MAX_VIDEO_BYTES,
};

export const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: AVATAR_ACCEPT,
  audio: MUSIC_ACCEPT,
  video: VIDEO_ACCEPT,
};

/** The project folder the mock store files uploads into, per kind (served by app/assets/[...path]). */
export const MEDIA_UPLOAD_DIRECTORY = 'assets/media';

const EXTENSIONS: Record<MediaKind, Record<string, string>> = {
  image: { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' },
  audio: {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
  },
  video: { 'video/mp4': '.mp4', 'video/webm': '.webm' },
};

/** The kind a file is, from its declared type; undefined for anything the catalogue does not take. */
export function mediaKindOf(file: Pick<File, 'type' | 'name'>): MediaKind | undefined {
  for (const kind of ['image', 'audio', 'video'] as const) {
    if (mediaExtension(kind, file) !== undefined) return kind;
  }

  return undefined;
}

/** The extension the file is stored under, from its type (or its name, when the browser sent none). */
export function mediaExtension(kind: MediaKind, file: Pick<File, 'type' | 'name'>): string | undefined {
  const byType = EXTENSIONS[kind][file.type.toLowerCase()];
  if (byType !== undefined) return byType;

  const dot = file.name.lastIndexOf('.');
  if (dot === -1) return undefined;

  const suffix = file.name.slice(dot).toLowerCase();
  return Object.values(EXTENSIONS[kind]).includes(suffix) ? suffix : undefined;
}

const KIND_WORDS: Record<MediaKind, string> = {
  image: 'ONLY PNG, JPG, WEBP OR GIF PICTURES ARE ACCEPTED.',
  audio: 'ONLY MP3, M4A, OGG, WAV AND FLAC TRACKS ARE ACCEPTED.',
  video: 'ONLY MP4 OR WEBM VIDEO IS ACCEPTED.',
};

/** The refusal, as a sentence fit to show, or undefined for a file the catalogue takes. */
export function validateMediaFile(kind: MediaKind, file: File): string | undefined {
  if (mediaExtension(kind, file) === undefined) return KIND_WORDS[kind];

  if (file.size > MEDIA_LIMITS[kind]) {
    const limit = MEDIA_LIMITS[kind];
    const shown = limit >= 1024 * 1024 ? `${Math.round(limit / (1024 * 1024))}MB` : `${Math.round(limit / 1024)}KB`;
    return `${kind.toUpperCase()} FILES MUST BE ${shown} OR SMALLER.`;
  }

  return undefined;
}

/** `<user id>/<kind>-<slug>-<stamp>.<ext>`: the folder is what the bucket policies read. */
export function mediaStoragePath(kind: MediaKind, userId: string, fileName: string, extension: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const stem = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return `${safeUserId}/${kind}-${stem.length === 0 ? 'file' : stem}-${stamp}${extension}`;
}

/** A size as a list prints it: `812KB`, `4.2MB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** The free tier's ceiling, so the page can say how full the catalogue is (SPEC risks). */
export const STORAGE_CEILING_BYTES = 1024 * 1024 * 1024;

/** Past this share of the ceiling, video uploads are refused first. */
export const STORAGE_REFUSE_VIDEO_AT = 0.8;
