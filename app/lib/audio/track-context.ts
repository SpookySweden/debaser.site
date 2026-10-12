import type { FolderPath } from './archive-tree';

/**
 * The facts a track's details line is built from: who uploaded it, and what larger thing it was heard
 * as part of. Shared by RADI-OH's details strip and the player bar, so the two say the same thing the
 * same way.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The account that uploaded a file, read from its address.
 *
 * Every upload is filed under its uploader's own folder (`mp3/<account id>/<name>.mp3`, see
 * `trackStoragePath`) - the storage policy insists on it - so the address already says whose it is and
 * no lookup is needed. A file that came with the site has no account in its address and answers null;
 * the details line then shows the site's own default picture.
 */
export function uploaderIdFromSrc(src: string): string | null {
  const match = src.match(UUID);

  return match === null ? null : match[0].toLowerCase();
}

/**
 * What larger thing a track was heard as part of, as the details line's first words - or '' for nothing.
 *
 * The *recorded* context wins - a live queue, a playlist, a profile - because it is what the reader
 * pressed play inside. Only when nothing was recorded does the file's own folder speak, which is where an
 * album or a project lives (`HEXHAM / GRIDLOCK`). A file at the root of the archive has neither, and the
 * line simply starts with the song.
 */
export function trackContext(recorded: string | undefined | null, folderPath?: FolderPath | null): string {
  if (recorded !== undefined && recorded !== null && recorded.trim().length > 0) return recorded.trim();

  if (folderPath === undefined || folderPath === null || folderPath.length === 0) return '';

  return folderPath.split('/').filter((part) => part.length > 0).join(' / ');
}

/** The context a play from somebody's queue records. */
export function queueContext(name: string): string {
  return `${name.toUpperCase()}'S QUEUE`;
}

/** The context a play from somebody's profile records. */
export function profileContext(name: string): string {
  return `${name.toUpperCase()}'S PROFILE`;
}

/** The context a play from one of your playlists records. */
export function playlistContext(name: string): string {
  return `PLAYLIST :: ${name.toUpperCase()}`;
}

/**
 * A running time as the list files it (`5:12`, `1:02:03`) in seconds, or NaN when it cannot be read -
 * which is how a RADI-OH entry knows a track's length without loading the file.
 */
export function lengthSeconds(length: string | undefined): number {
  if (length === undefined) return Number.NaN;

  const parts = length.trim().split(':').map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) return Number.NaN;

  return parts.reduce((total, part) => total * 60 + part, 0);
}
