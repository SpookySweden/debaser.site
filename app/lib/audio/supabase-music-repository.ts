import { getSupabaseBrowserClient } from '../supabase/client';
import { normaliseFolderPath } from './archive-tree';
import { MUSIC_BUCKET, extensionForTrack, trackStoragePath, validateTrackFile } from './catalogue';
import type { CreateFolderInput, MusicFolder, MusicRepository, UploadTrackInput } from './repository';
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
/** The folders anybody signed in has made - see supabase/schema.sql section 14b. */
const FOLDERS_TABLE = 'music_folders';
/** The columns a track row is read with. `folder_path` is added where the column exists. */
const TRACK_COLUMNS = 'title, credit, kind, src, length, tags';

/** One listing is enough for a shelf of demos; the folder pass is one level deep. */
const LIST_LIMIT = 200;

type TrackRow = {
  title: string;
  credit: string;
  kind: string;
  src: string;
  length?: string | null;
  tags?: string[] | null;
  /** The folder the file is filed in; null for a file at the root of the archive. */
  folder_path?: string | null;
};

/** One folder row, as `music_folders` has it. */
type FolderRow = {
  path: string;
  created_by: string | null;
  created_by_label: string;
  created_at: string;
};

function toFolder(row: FolderRow): MusicFolder {
  return {
    path: row.path,
    createdBy: row.created_by,
    createdByLabel: row.created_by_label,
    createdAt: row.created_at,
  };
}

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

  /**
   * The shelf's rows, or null when the table cannot be read at all.
   *
   * `folder_path` is asked for along with the rest where it is there. On a project that has not run
   * supabase/migrations/20260928_music_folders.sql the whole select would fail with the missing
   * column, taking every title and tag on the shelf down to file names - so the plain columns are
   * asked for instead, and the files simply have no folder until the column exists.
   */
  private async readRows(): Promise<TrackRow[] | null> {
    const read = async (columns: string): Promise<TrackRow[] | null> => {
      const { data, error } = await this.client()
        .from(TRACKS_TABLE)
        .select(columns)
        .order('created_at', { ascending: true });

      return error === null ? (data as unknown as TrackRow[]) : null;
    };

    const withFolders = await read(`${TRACK_COLUMNS}, folder_path`);
    if (withFolders !== null) return withFolders;

    const plain = await read(TRACK_COLUMNS);
    if (plain !== null) return plain;

    console.warn(`[music] ${TRACKS_TABLE} could not be read - titles fall back to file names.`);

    return null;
  }

  /** What the shelf has been told about those files. */
  private async listRows(): Promise<DescribedAudio[]> {
    try {
      const rows = await this.readRows();
      if (rows === null) return [];

      return rows.map((row) => ({
        src: row.src,
        title: row.title,
        credit: row.credit,
        kind: row.kind,
        ...(row.length === null || row.length === undefined || row.length.length === 0 ? {} : { length: row.length }),
        ...(row.tags === null || row.tags === undefined ? {} : { tags: row.tags }),
        folderPath: row.folder_path ?? null,
      }));
    } catch {
      return [];
    }
  }

  async listTracks(): Promise<AudioTrack[]> {
    const [files, rows] = await Promise.all([this.listBucketFiles(), this.listRows()]);

    return tracksFromStorage(files, rows);
  }

  /**
   * The folders anybody has made.
   *
   * Never throws, for the same reason the shelf does not: a page that lists the catalogue's own
   * releases is a working page, and an unreadable folder table costs the folders people added
   * rather than the whole directory.
   */
  async listFolders(): Promise<MusicFolder[]> {
    try {
      const { data, error } = await this.client()
        .from(FOLDERS_TABLE)
        .select('path, created_by, created_by_label, created_at')
        .order('path', { ascending: true });

      if (error !== null) {
        console.warn(`[music] ${FOLDERS_TABLE} could not be read: ${error.message} - the catalogue's own folders stand.`);

        return [];
      }

      return ((data ?? []) as FolderRow[]).map(toFolder);
    } catch {
      return [];
    }
  }

  /**
   * Makes a folder, or hands back the one that is already there.
   *
   * The insert is told to ignore a duplicate path rather than to fail: two people filing into
   * `HEXHAM` are asking for the same folder, and the table's own policy already keeps one
   * account from claiming another's row. What comes back is what the page needs to draw - the
   * list is read again afterwards for the rest.
   */
  async createFolder(input: CreateFolderInput): Promise<MusicFolder> {
    const path = normaliseFolderPath(input.path);
    if (path === null) throw new Error('A FOLDER NEEDS A NAME.');

    const { error } = await this.client()
      .from(FOLDERS_TABLE)
      .upsert(
        { path, created_by: input.creatorId, created_by_label: input.creatorName },
        { onConflict: 'path', ignoreDuplicates: true },
      );

    if (error !== null) {
      throw new Error(`${error.message.toUpperCase()} - THE FOLDER COULD NOT BE MADE.`);
    }

    return { path, createdBy: input.creatorId, createdByLabel: input.creatorName, createdAt: new Date().toISOString() };
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
      folder_path: normaliseFolderPath(input.folderPath),
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

    return {
      id: path,
      title,
      credit,
      kind,
      src,
      length: input.length ?? '--:--',
      tags,
      folderPath: normaliseFolderPath(input.folderPath),
      shelf: 'bucket',
    };
  }
}

let supabaseMusicRepository: MusicRepository | null = null;

export function getSupabaseMusicRepository(): MusicRepository {
  if (supabaseMusicRepository === null) supabaseMusicRepository = new SupabaseMusicRepository();

  return supabaseMusicRepository;
}
