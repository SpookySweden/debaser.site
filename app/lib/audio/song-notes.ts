import { mediaExtension, validateMediaFile } from '../media/rules';

/**
 * A site song's cover card notes (SPEC-music-queues.md step 4): the picture and short description its uploader
 * added, shown on a room's screen while the song plays. Pure.
 *
 * Only a song in the `mp3` bucket has an uploader: its track id is its storage path, and the first folder of that
 * path is the uploader's account (the bucket's own rule). The database checks the same (`music_song_notes`).
 */

export type SongNote = {
  /** The song's bucket path, the shelf's id for it. */
  trackId: string;
  ownerId: string;
  /** The picture's address to draw, or null for none. */
  pictureSrc: string | null;
  /** Where it is stored (`images` bucket path, or the mock's own address). */
  picturePath: string | null;
  description: string | null;
  updatedAt: string;
};

/** The database holds the same limit. */
export const SONG_NOTE_MAX = 600;

/** A save: `picture` a new file, null to take it off, 'keep' to leave it. */
export type SaveSongNoteInput = { trackId: string; ownerId: string; picture: File | null | 'keep'; description: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whose song a bucket track is, from its id (`<account id>/...`); null for a hand-filed or root file. */
export function songOwner(trackId: string): string | null {
  const first = trackId.split('/')[0] ?? '';
  return trackId.includes('/') && UUID.test(first) ? first.toLowerCase() : null;
}

/** The description as it is kept: spaces tidied, cut to the limit, null for nothing. */
export function cleanNote(text: string): string | null {
  const tidy = text.replace(/\s+/g, ' ').trim().slice(0, SONG_NOTE_MAX).trim();
  return tidy.length === 0 ? null : tidy;
}

/** Why a picture is refused (the catalogue's image rules: type and size), or undefined. */
export function pictureRefusal(file: File): string | undefined {
  return validateMediaFile('image', file);
}

/** `<owner>/song-cover-<stamp>.<ext>`: under the owner's own folder, which the `images` bucket's rule reads. */
export function songPicturePath(ownerId: string, file: Pick<File, 'type' | 'name'>, at: Date): string {
  const stamp = at.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${ownerId}/song-cover-${stamp}${mediaExtension('image', file) ?? '.png'}`;
}
