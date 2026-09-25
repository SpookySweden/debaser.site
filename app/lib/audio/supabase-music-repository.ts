import { getSupabaseBrowserClient } from '../supabase/client';
import { normaliseFolderPath } from './archive-tree';
import type { BroadcastQueue } from './broadcast';
import { MUSIC_BUCKET, extensionForTrack, trackStoragePath, validateTrackFile } from './catalogue';
import { playlistId, validatePlaylistName, type LikedTrack, type Playlist, type PlaylistItem } from './library';
import type { CreateFolderInput, LibraryRead, MusicFolder, MusicRepository, OwnQueue, PublishQueueInput, UploadTrackInput } from './repository';
import { normaliseAudioTags } from './tags';
import type { AudioTrack, DescribedAudio, StoredAudio } from './tracks';
import { tracksFromStorage } from './tracks';

/**
 * The music shelf in Supabase - the production implementation of `MusicRepository`.
 *
 * Tables and storage it expects (created by supabase/schema.sql, section 14, or by
 * supabase/migrations/20260921000014_music_and_profile_songs.sql):
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
/** What one account liked - see supabase/migrations/20260930000025_music_library.sql. */
const LIKES_TABLE = 'music_likes';
/** The lists one account made, and their items, in the same migration. */
const PLAYLISTS_TABLE = 'music_playlists';

/**
 * The published queues table, added by `supabase/migrations/20260930000028_music_queues.sql`.
 *
 * A separate table from `music_playlists` on purpose, and the difference is *who reads it*: a playlist
 * is one account's private list, while a queue is a broadcast whose whole reason to exist is that other
 * people may read it. Two visibility rules that opposite cannot share a table without one of them
 * becoming a special case in every policy.
 */
const QUEUES_TABLE = 'music_queues';

/** How many broadcasting queues one read asks for. A server browser, not an archive of every session. */
const QUEUE_LIMIT = 60;

/**
 * Whether a read failed because the table is not there yet, rather than for a real reason.
 *
 * The distinction the whole queue tab rests on. A project that has not run the migration should read as
 * "nobody is broadcasting", which is exactly what the empty list draws - so the failure is *dropped*
 * rather than thrown. Anything else - a refused policy, a dropped connection - is thrown and said out
 * loud, because that is a fault the reader can act on and an empty list would hide it.
 *
 * PostgREST answers `PGRST205` for a table it cannot find, and phrases it "Could not find the table ...
 * in the schema cache". Both spellings are matched because the code has changed across versions and the
 * message is the one that has stayed stable.
 */
function isMissingTable(message: string): boolean {
  return /PGRST205|schema cache|does not exist/i.test(message);
}

/** One row of `music_queues`, in the app's own shape. */
function toBroadcastQueue(row: {
  user_id: string;
  track_id: string;
  track_index: number;
  track_total: number;
  position_seconds: number | string;
  is_public: boolean;
  started_at: string;
  updated_at: string;
}): BroadcastQueue {
  return {
    userId: row.user_id,
    trackId: row.track_id,
    trackIndex: row.track_index,
    trackTotal: row.track_total,
    // `numeric` comes back as a *string* from PostgREST, because Postgres numerics can exceed what a
    // double holds. A position in seconds never will, but the coercion has to happen here or the
    // arithmetic downstream would concatenate instead of adding.
    positionSeconds: Number(row.position_seconds),
    updatedAt: row.updated_at,
    startedAt: row.started_at,
  };
}
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

/** One like, as `music_likes` has it. */
type LikeRow = {
  track_id: string;
  liked_at: string;
};

/**
 * One playlist, as `music_playlists` has it.
 *
 * The items are a `jsonb` column rather than a join table, and that is a deliberate trade: a playlist
 * is short, ordered, and always read whole, so a third table would buy a join and a second round trip
 * for an ordering guarantee that `jsonb` already gives. It is the same call `library.ts` records.
 */
type PlaylistRow = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  items: PlaylistItem[] | null;
};

function toPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    createdAt: row.created_at,
    items: Array.isArray(row.items) ? row.items : [],
  };
}

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
            'The shelf falls back to the archive tracks - see supabase/migrations/20260921000014_music_and_profile_songs.sql.',
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
   * supabase/migrations/20260928000021_music_folders.sql the whole select would fail with the missing
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

  /* The reader's own music: per account, in real tables. --------------------------------------- */

  /**
   * What this account liked.
   *
   * Never throws. An unreadable library reads as an empty one, for the same reason an unreadable shelf
   * does: this is drawn beside the music, and a page that cannot list somebody's favourite songs should
   * still be able to list songs. The reason each read fails the same way is that the alternative - a
   * reader whose likes table has not been migrated yet seeing an error - is worse than seeing none.
   */
  async listLikes(userId: string): Promise<LibraryRead<LikedTrack>> {
    const { data, error } = await this.client()
      .from(LIKES_TABLE)
      .select('track_id, liked_at')
      .eq('user_id', userId)
      .order('liked_at', { ascending: false })
      .limit(LIST_LIMIT);

    // A refusal, a missing table and a dead network all land here. The reader is told, rather than shown
    // an empty list that means "you liked nothing" - which is a different sentence and a different bug.
    if (error !== null) return { items: [], answered: false };

    return {
      items: ((data ?? []) as LikeRow[]).map((row) => ({ trackId: row.track_id, likedAt: row.liked_at })),
      answered: true,
    };
  }

  /**
   * Hearts or un-hearts, and hands back what it settled on.
   *
   * A delete-then-insert would be two round trips and a window where the like is in neither state, so
   * this reads first and writes once. The read is the account's own rows only, which the policy also
   * enforces - the filter is here so a returned count means what it looks like.
   */
  async toggleLike(userId: string, trackId: string): Promise<{ liked: boolean }> {
    const client = this.client();

    const existing = await client
      .from(LIKES_TABLE)
      .select('track_id')
      .eq('user_id', userId)
      .eq('track_id', trackId)
      .maybeSingle();

    if (existing.error !== null) throw new Error(existing.error.message.toUpperCase());

    if (existing.data !== null) {
      const { error } = await client.from(LIKES_TABLE).delete().eq('user_id', userId).eq('track_id', trackId);
      if (error !== null) throw new Error(error.message.toUpperCase());

      return { liked: false };
    }

    const { error } = await client.from(LIKES_TABLE).insert({ user_id: userId, track_id: trackId });
    if (error !== null) throw new Error(error.message.toUpperCase());

    return { liked: true };
  }

  async listPlaylists(userId: string): Promise<LibraryRead<Playlist>> {
    const { data, error } = await this.client()
      .from(PLAYLISTS_TABLE)
      .select('id, owner_id, name, created_at, items')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(LIST_LIMIT);

    if (error !== null) return { items: [], answered: false };

    return { items: ((data ?? []) as PlaylistRow[]).map(toPlaylist), answered: true };
  }

  async savePlaylist(input: { ownerId: string; name: string; items?: PlaylistItem[] }): Promise<Playlist> {
    const problem = validatePlaylistName(input.name);
    if (problem !== undefined) throw new Error(problem);

    const id = playlistId(input.ownerId, input.name);

    // Read first so an edit does not wipe the items it is not touching - the same reasoning the mock
    // store records, and the reason a rename is not a way to lose a list's contents.
    const existing = (await this.listPlaylists(input.ownerId)).items;
    const current = existing.find((list) => list.id === id);

    const { data, error } = await this.client()
      .from(PLAYLISTS_TABLE)
      .upsert(
        {
          id,
          owner_id: input.ownerId,
          name: input.name.trim(),
          items: input.items ?? current?.items ?? [],
        },
        { onConflict: 'id' },
      )
      .select('id, owner_id, name, created_at, items')
      .single();

    if (error !== null) throw new Error(error.message.toUpperCase());

    return toPlaylist(data as PlaylistRow);
  }

  async togglePlaylistTrack(input: { ownerId: string; playlistId: string; trackId: string }): Promise<Playlist> {
    const lists = (await this.listPlaylists(input.ownerId)).items;
    const list = lists.find((entry) => entry.id === input.playlistId);

    if (list === undefined) throw new Error('THERE IS NO PLAYLIST BY THAT NAME.');

    const already = list.items.some((item) => item.trackId === input.trackId);
    const items = already
      ? list.items.filter((item) => item.trackId !== input.trackId)
      : [...list.items, { trackId: input.trackId, addedAt: new Date().toISOString() }];

    // Asked to hand the row back, so a write the policy refused is told rather than shown as done -
    // the same pattern `banAccount` uses: row-level security refuses by touching nothing, which is
    // otherwise silent.
    const { data, error } = await this.client()
      .from(PLAYLISTS_TABLE)
      .update({ items })
      .eq('id', input.playlistId)
      .select('id, owner_id, name, created_at, items');

    if (error !== null) throw new Error(error.message.toUpperCase());
    if ((data ?? []).length === 0) throw new Error('THE DATABASE REFUSED THAT - A PLAYLIST IS ITS OWNER`S.');

    return toPlaylist((data as PlaylistRow[])[0]);
  }

  async removePlaylist(ownerId: string, playlistIdToRemove: string): Promise<void> {
    const { data, error } = await this.client()
      .from(PLAYLISTS_TABLE)
      .delete()
      .eq('id', playlistIdToRemove)
      .eq('owner_id', ownerId)
      .select('id');

    if (error !== null) throw new Error(error.message.toUpperCase());
    if ((data ?? []).length === 0) throw new Error('THE DATABASE REFUSED THAT - A PLAYLIST IS ITS OWNER`S.');
  }

  /* ---------------------------------------------------------------------------------------------
   * Broadcast queues
   * ------------------------------------------------------------------------------------------- */

  /**
   * The public queues, most recently moved first.
   *
   * **A missing table is an empty list; a refused read is a thrown error.** Those are different facts
   * and the tab draws them differently - "nobody is broadcasting" against "the list could not be read"
   * - which is the same distinction `LibraryRead` exists for on the personal music screen. A project
   * that has not run `20260930000028_music_queues.sql` reads as an empty queue list, and the tab says
   * so rather than looking broken.
   */
  async listQueues(): Promise<BroadcastQueue[]> {
    const client = getSupabaseBrowserClient();
    if (client === null) return [];

    const { data, error } = await client
      .from(QUEUES_TABLE)
      .select('user_id, track_id, track_index, track_total, position_seconds, is_public, started_at, updated_at')
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .limit(QUEUE_LIMIT);

    if (error !== null) {
      // The table not being there yet is the one failure that is not a failure: it is a project the
      // migration has not reached, and an empty list is the honest reading of that.
      if (isMissingTable(error.message)) return [];

      throw new Error(error.message.toUpperCase());
    }

    return (data ?? []).map(toBroadcastQueue);
  }

  /** This account's own queue, public or not. Null when it has never published one. */
  async readOwnQueue(): Promise<OwnQueue | null> {
    const client = getSupabaseBrowserClient();
    if (client === null) return null;

    const { data, error } = await client
      .from(QUEUES_TABLE)
      .select('user_id, track_id, track_index, track_total, position_seconds, is_public, started_at, updated_at')
      .maybeSingle();

    if (error !== null) {
      if (isMissingTable(error.message)) return null;

      throw new Error(error.message.toUpperCase());
    }

    if (data === null) return null;

    return { ...toBroadcastQueue(data), isPublic: data.is_public };
  }

  /**
   * Publishes, retracts or moves this account's queue along - one upsert.
   *
   * `user_id` is the conflict target because it is the primary key, so a second press updates the row
   * rather than making a second one. A person is listening to one thing at a time, and two rows for one
   * account would be a list that lies about how many people are broadcasting.
   */
  async publishQueue(input: PublishQueueInput): Promise<void> {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('THE QUEUE COULD NOT BE SAVED - THERE IS NO PROJECT BEHIND THIS SITE.');

    const { error } = await client.from(QUEUES_TABLE).upsert(
      {
        user_id: input.userId,
        track_id: input.trackId,
        track_index: input.trackIndex,
        track_total: Math.max(1, input.trackTotal),
        position_seconds: Math.max(0, input.positionSeconds),
        is_public: input.isPublic,
      },
      { onConflict: 'user_id' },
    );

    if (error !== null) throw new Error(error.message.toUpperCase());
  }

  async clearQueue(userId: string): Promise<void> {
    const client = getSupabaseBrowserClient();
    if (client === null) return;

    const { error } = await client.from(QUEUES_TABLE).delete().eq('user_id', userId);

    if (error !== null) throw new Error(error.message.toUpperCase());
  }

  /**
   * Realtime, so somebody going public or changing track appears without a reload.
   *
   * The table is in the `supabase_realtime` publication (the migration adds it), and that matters more
   * than it looks: a channel bound to a table that is *not* in the publication reports SUBSCRIBED and
   * then silently delivers nothing at all - the failure `supabase/README.md` writes about at length.
   *
   * The subscribe is per-call and so is the unsubscribe, because two screens can ask at once and each
   * wants its own.
   */
  subscribeToQueues(onChange: () => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;

    const channel = client
      .channel('music-queues')
      .on('postgres_changes', { event: '*', schema: 'public', table: QUEUES_TABLE }, () => onChange())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }
}

let supabaseMusicRepository: MusicRepository | null = null;

export function getSupabaseMusicRepository(): MusicRepository {
  if (supabaseMusicRepository === null) supabaseMusicRepository = new SupabaseMusicRepository();

  return supabaseMusicRepository;
}
