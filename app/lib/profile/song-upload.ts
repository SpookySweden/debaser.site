import { MUSIC_BUCKET, extensionForTrack, validateTrackFile } from '../audio/catalogue';
import { getSupabaseBrowserClient } from '../supabase/client';
import { PROFILE_DATA_SOURCE } from './repository';

/**
 * Where an account's own track goes.
 *
 * The same two stores, one call, as the pictures use (see ./avatar-upload.ts): with
 * profiles on Supabase the file is uploaded from the browser under the visitor's own
 * session into the `mp3` bucket, whose policies check that session and keep one
 * account out of another's folder. With the mock profile store it goes through the
 * project's own upload route into `assets/audio/`.
 *
 * The path carries the owner's id and the version the track is being filed as
 * (`<user id>/song-v3-....mp3`), which is what the bucket's policies read - and it
 * means the file sits beside the music shelf's own tracks, so the shelf and the
 * profile player can both play it.
 */

export type SongUploadResult =
  | { ok: true; src: string; note: string }
  | { ok: false; error: string };

/** `<user id>/song-v<version>-<stamp>.<ext>`, which is what the policies read. */
export function songStoragePath(userId: string, version: number, extension: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

  return `${safeUserId}/song-v${version}-${stamp}${extension}`;
}

export async function uploadSongFile(input: {
  file: File;
  userId: string;
  /** The version being filed, so the file name says which track it is. */
  version: number;
}): Promise<SongUploadResult> {
  const problem = validateTrackFile(input.file);
  if (problem !== undefined) return { ok: false, error: problem };

  const extension = extensionForTrack(input.file);
  if (extension === undefined) return { ok: false, error: 'ONLY MP3, M4A, OGG, WAV AND FLAC TRACKS ARE ACCEPTED.' };

  if (PROFILE_DATA_SOURCE === 'supabase') {
    const client = getSupabaseBrowserClient();
    if (client === null) return { ok: false, error: 'THE TRACK UPLOAD IS NOT AVAILABLE.' };

    const path = songStoragePath(input.userId, input.version, extension);
    const { error } = await client.storage.from(MUSIC_BUCKET).upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type.length === 0 ? 'audio/mpeg' : input.file.type,
    });

    if (error !== null) {
      return {
        ok: false,
        error: `${error.message.toUpperCase()} - THE TRACK COULD NOT BE SAVED.`,
      };
    }

    const { data } = client.storage.from(MUSIC_BUCKET).getPublicUrl(path);

    return { ok: true, src: data.publicUrl, note: 'TRACK FILED.' };
  }

  try {
    const form = new FormData();
    form.append('file', input.file);

    const response = await fetch('/api/music/upload', { method: 'POST', body: form });
    const payload = (await response.json()) as { ok?: boolean; src?: string; error?: string };

    if (payload.ok !== true || payload.src === undefined) {
      return { ok: false, error: payload.error ?? 'THE UPLOAD WAS REFUSED.' };
    }

    return { ok: true, src: payload.src, note: 'TRACK FILED.' };
  } catch {
    return { ok: false, error: 'UPLOAD FAILED.' };
  }
}
