import { getSupabaseBrowserClient } from '../supabase/client';
import { MUSIC_BUCKET, extensionForTrack, trackStoragePath, validateTrackFile } from './catalogue';
import type { MusicRepository, UploadTrackInput } from './repository';
import { normaliseAudioTags } from './tags';
import type { AudioTrack, DescribedAudio, StoredAudio } from './tracks';
import { tracksFromStorage } from './tracks';

/**
 * The music shelf in Supabase - the production implementation of `MusicRepository`.
 *
 * Tables and storage it expects (created by supabase/schema.sql, section 14, or by
 * supabase/migrations/20260921_music_and_profile_songs.sql):
 *
 *   music_tracks   id, title, credit, kind, src, uploaded_by, uploaded_by_label, created_at
 *   mp3 bucket     public read, authenticated insert into the uploader's own folder
 *
 * Two rules this file keeps, both learned the hard way on this site:
 *
 *   1. the shelf is read by *listing the bucket*, not by reading a table. A track
 *      dropped straight into the `mp3` bucket by hand is on the shelf the moment it
 *      lands, and `music_tracks` only adds the title and the credit to whatever is
 *      actually there. A table-only listing would hide the very file somebody put
 *      there without telling anybody;
 *   2. a listing that cannot be read does not throw: it is reported and the player
 *      falls back to the archive's own hand-filed tracks, because an unreadable shelf
 *      is a short queue, not a broken page. Uploads *do* throw, with the reason.
 */

const TRACKS_TABLE = 'music_tracks';

/** One listing is enough for a shelf of demos; the folder pass is one level deep. */
const LIST_LIMIT = 200;

type TrackRow = {
  title: string;
  credit: string;
  kind: string;
  src: string;
  length?: string | null;
  tags?: string[] | null;
};

type StorageEntry = {
  name: string;
  /** Null marks a folder rather than a file. */
  id: string | null;
};

class SupabaseMusicRepository implements MusicRepository {
  readonly source = 'supabase' as const;

  private client() {
    const client = getSupabaseBrowserClient();

    if (client === null) {
      throw new Error('THE SHELF IS NOT AVAILABLE.');
    }

    return client;
  }

  /** Every file the bucket holds: the root, then one level down for account folders. */
  private async listBucketFiles(): Promise<StoredAudio[]> {
    try {
      const storage = this.client().storage.from(MUSIC_BUCKET);
      const root = await storage.list('', { limit: LIST_LIMIT, sortBy: { column: 'name', order: 'asc' } });

      if (root.error !== null) {
        console.warn(
          `[music] the ${MUSIC_BUCKET} bucket could not be listed: ${root.error.message}. ` +
            'The shelf falls back to the archive tracks - see supabase/migrations/20260921_music_and_profile_songs.sql.',
        );
        return [];
      }

      const entries = (root.data ?? []) as StorageEntry[];
      const paths: string[] = [];

      for (const entry of entries) {
        if (entry.id === null) {
          const nested = await storage.list(entry.name, {
            limit: LIST_LIMIT,
            sortBy: { column: 'name', order: 'asc' },
          });

          for (const child of (nested.data ?? []) as StorageEntry[]) {
            if (child.id !== null) paths.push(`${entry.name}/${child.name}`);
          }

          continue;
        }

        paths.push(entry.name);
      }

      return paths.map((path) => ({ path, src: storage.getPublicUrl(path).data.publicUrl }));
    } catch (caught) {
      console.warn(`[music] the shelf could not be listed: ${caught instanceof Error ? caught.message : 'unknown'}`);

      return [];
    }
  }

  /** What the shelf has been told about those files. */
  private async listRows(): Promise<DescribedAudio[]> {
    try {
      const { data, error } = await this.client()
        .from(TRACKS_TABLE)
        .select('title, credit, kind, src, length, tags')
        .order('created_at', { ascending: true });

      if (error !== null) {
        console.warn(`[music] ${TRACKS_TABLE} could not be read: ${error.message} - titles fall back to file names.`);

        return [];
      }

      return ((data ?? []) as TrackRow[]).map((row) => ({
        src: row.src,
        title: row.title,
        credit: row.credit,
        kind: row.kind,
        ...(row.length === null || row.length === undefined || row.length.length === 0 ? {} : { length: row.length }),
        ...(row.tags === null || row.tags === undefined ? {} : { tags: row.tags }),
      }));
    } catch {
      return [];
    }
  }

  async listTracks(): Promise<AudioTrack[]> {
    const [files, rows] = await Promise.all([this.listBucketFiles(), this.listRows()]);

    return tracksFromStorage(files, rows);
  }

  async uploadTrack(input: UploadTrackInput): Promise<AudioTrack> {
    const title = input.title.trim();
    if (title.length === 0) throw new Error('A TRACK NEEDS A TITLE.');

    const problem = validateTrackFile(input.file);
    if (problem !== undefined) throw new Error(problem);

    const extension = extensionForTrack(input.file);
    if (extension === undefined) throw new Error('ONLY MP3, M4A, OGG, WAV AND FLAC TRACKS ARE ACCEPTED.');

    const client = this.client();
    const path = trackStoragePath(input.uploaderId, input.file.name, extension);

    const { error } = await client.storage.from(MUSIC_BUCKET).upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type.length === 0 ? 'audio/mpeg' : input.file.type,
    });

    if (error !== null) {
      throw new Error(
        `${error.message.toUpperCase()} - THE TRACK COULD NOT BE SAVED TO THE SHELF.`,
      );
    }

    const src = client.storage.from(MUSIC_BUCKET).getPublicUrl(path).data.publicUrl;
    const credit = input.credit.trim().length === 0 ? input.uploaderName : input.credit.trim();
    const kind = 'UPLOADED TO THE SHELF';
    const tags = normaliseAudioTags(input.tags ?? []);

    const { error: rowError } = await client.from(TRACKS_TABLE).insert({
      title,
      credit,
      kind,
      src,
      tags,
      length: input.length ?? '',
      uploaded_by: input.uploaderId,
      uploaded_by_label: input.uploaderName,
    });

    // The audio is safely in the bucket either way, so this says exactly that rather
    // than pretending the whole upload failed: the file plays, its title is missing.
    if (rowError !== null) {
      throw new Error(
        `THE TRACK WAS SAVED, BUT ITS TITLE COULD NOT BE RECORDED: ${rowError.message.toUpperCase()}.`,
      );
    }

    return { id: path, title, credit, kind, src, length: input.length ?? '--:--', tags, shelf: 'bucket' };
  }
}

let supabaseMusicRepository: MusicRepository | null = null;

export function getSupabaseMusicRepository(): MusicRepository {
  if (supabaseMusicRepository === null) supabaseMusicRepository = new SupabaseMusicRepository();

  return supabaseMusicRepository;
}
