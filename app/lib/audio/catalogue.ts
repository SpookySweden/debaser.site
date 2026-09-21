/**
 * What the music shelf accepts, in one place.
 *
 * The rules are the same shape as the picture catalogue's (`avatar-catalogue.ts`):
 * the browser checks a file first and says so in plain text, and the bucket's own
 * limit mirrors the constant here, so Supabase Storage only ever sees a file the site
 * has already accepted. Keep the two in step - supabase/schema.sql sets the bucket's
 * `file_size_limit` and `allowed_mime_types` from these numbers.
 */

/** The bucket the tracks live in - the one the site's own player reads. */
export const MUSIC_BUCKET = 'mp3';

/** Where the archive's own audio lives, relative to the project root. */
export const MUSIC_UPLOAD_DIRECTORY = 'assets/audio';

/** How long a track may be: a rough mix, not a master. */
export const MAX_TRACK_BYTES = 20 * 1024 * 1024;

/** What the file picker offers. */
export const MUSIC_ACCEPT = 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,.mp3,.m4a,.ogg,.wav,.flac';

/** The types the bucket is opened to, in the same order as the accept list. */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
};

/** Extensions that are accepted when the browser hands over a vague content type. */
const EXTENSION_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

/**
 * The suffix to file a track under.
 *
 * Some browsers report an m4a as `audio/mp4` and some as nothing at all, so the
 * content type is tried first and the file's own extension second. Undefined means
 * the file is not one the shelf takes.
 */
export function extensionForTrack(file: File): string | undefined {
  const fromType = CONTENT_TYPE_EXTENSIONS[file.type.toLowerCase()];
  if (fromType !== undefined) return fromType;

  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');

  return dot === -1 ? undefined : EXTENSION_TYPES[name.slice(dot)];
}

/** The rules the form keeps, so a refusal reads the same wherever it comes from. */
export function validateTrackFile(file: File): string | undefined {
  if (extensionForTrack(file) === undefined) {
    return 'ONLY MP3, M4A, OGG, WAV AND FLAC TRACKS ARE ACCEPTED.';
  }

  if (file.size > MAX_TRACK_BYTES) {
    return `TRACKS MUST BE ${Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB OR SMALLER.`;
  }

  return undefined;
}

/** A readable stem for a path: `Some Mix (rough).mp3` -> `some-mix-rough`. */
export function slugFromFileName(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug.length === 0 ? 'track' : slug;
}

/**
 * Where an uploaded track goes inside the bucket: `<user id>/<slug>-<stamp><ext>`.
 *
 * The owner's id is the first segment because that is what the bucket's policies read
 * to keep one account out of another account's folder - the same rule the avatars
 * bucket keeps (see `avatarStoragePath`).
 */
export function trackStoragePath(userId: string, fileName: string, extension: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

  return `${safeUserId}/${slugFromFileName(fileName)}-${stamp}${extension}`;
}
