import { isSupabaseConfigured } from '../supabase/client';
import type { FolderPath } from './archive-tree';
import type { BroadcastQueue } from './broadcast';
import type { LikedTrack, Playlist, PlaylistItem } from './library';
import { getMockMusicRepository } from './mock-music-repository';
import { getSupabaseMusicRepository } from './supabase-music-repository';
import type { AudioTrack } from './tracks';

/**
 * The switch that decides where the music shelf keeps its uploads.
 *
 * Supabase means the `mp3` bucket (files survive a deploy and work on a read-only
 * host); the mock means the project's own assets folder, through
 * `app/api/music/upload`. Default is the mock, exactly like the other stores, so the
 * site runs with no backend at all. To move it over, set this in `.env.local`:
 *
 *   NEXT_PUBLIC_MUSIC_DATA_SOURCE=supabase
 *
 * The bucket is read either way: a track dropped in by hand is found by listing it,
 * which is what makes the player play what the shelf actually holds rather than what
 * a list in the code says it should.
 */
export type MusicDataSource = 'mock' | 'supabase';

export const MUSIC_DATA_SOURCE: MusicDataSource =
  process.env.NEXT_PUBLIC_MUSIC_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export type UploadTrackInput = {
  uploaderId: string;
  /** The uploader's name at the time of filing, kept for the shelf's row. */
  uploaderName: string;
  /** The file's name, as the archive spells it (`TITLE - ALBUM - ARTIST`). */
  title: string;
  /** Who the track is credited to; empty means the uploader. */
  credit: string;
  /** Audio tags for the file: how it sounds, as filed. */
  tags?: string[];
  /** Running time as it reads in a list, when the caller has measured the file. */
  length?: string;
  /** The folder it is filed in; `null` files it at the root of the archive. */
  folderPath?: FolderPath | null;
  file: File;
};

/** A folder somebody made in the archive. A path is the whole of it: `HEXHAM`, `HEXHAM/GRIDLOCK`. */
export type MusicFolder = {
  path: FolderPath;
  /** The account that made it, when one is known. */
  createdBy: string | null;
  createdByLabel: string;
  createdAt: string;
};

export type CreateFolderInput = {
  path: FolderPath;
  creatorId: string;
  creatorName: string;
};

/**
 * A read of the reader's own music, which says whether it actually answered.
 *
 * `listTracks` and `listFolders` return a bare array, and for the *archive* that is right: an unreadable
 * shelf is a short queue, not a broken page, so the store swallows the reason and the page works. That is
 * wrong for a personal screen, and this is the difference made explicit.
 *
 * The distinction is not academic. "You have liked nothing" and "the database did not answer" draw the
 * same empty panel, and the second one is a bug the reader cannot report because they cannot see it. So
 * the read hands back both: the rows it has, and whether that is all of them.
 */
export type LibraryRead<T> = {
  items: T[];
  /**
   * True when the read answered in full. False when it could not be read at all - a table that is not
   * there yet, a policy that refused, a network that gave up - in which case `items` is empty and the
   * screen says so rather than pretending the reader has nothing.
   */
  answered: boolean;
};

/** Thrown by writes, which *do* throw: a press that failed must be told, not shown as done. */
export class LibraryWriteError extends Error {}

export type MusicRepository = {
  readonly source: MusicDataSource;
  /**
   * Everything the shelf holds. Never throws: the player falls back to the archive's
   * own hand-filed tracks, so a shelf that cannot be read is a short queue rather
   * than a broken page.
   */
  listTracks(): Promise<AudioTrack[]>;
  /** Files one track and hands back the row the player queues. */
  uploadTrack(input: UploadTrackInput): Promise<AudioTrack>;
  /**
   * The folders anybody has made. Never throws, and an unreadable folder table is an empty
   * one: the archive still lists the folders its own catalogue implies, so the page works
   * before the schema is there.
   */
  listFolders(): Promise<MusicFolder[]>;
  /**
   * Makes a folder. A path that already exists is not an error - two people filing into
   * `HEXHAM` are asking for the same folder - so this hands back what is there.
   */
  createFolder(input: CreateFolderInput): Promise<MusicFolder>;
  /** Mock-only helper so local uploads can be forgotten. */
  clearLocalTracks?(): Promise<void>;

  /* ---------------------------------------------------------------------------------------------
   * The reader's own music.
   *
   * Everything above is the *shelf*, which belongs to nobody. These four are per-account, and the
   * account is passed in rather than read from a session inside the store - the same way the forum
   * repository takes an author rather than asking who is signed in. That keeps the store testable
   * and keeps the "who may write this" question in the database's hands, where the row-level
   * security policy answers it rather than this interface pretending to.
   * ------------------------------------------------------------------------------------------- */

  /**
   * What this account liked, newest first.
   *
   * Never throws, and the *empty* answer is meaningful: a like table that has not been migrated yet
   * reads as "nothing liked", which is what the screen draws before the schema is pasted in. The second
   * return value says whether the read actually answered - see `LibraryRead`.
   */
  listLikes(userId: string): Promise<LibraryRead<LikedTrack>>;
  /**
   * Hearts or un-hearts, and hands back the state it settled on.
   *
   * One call rather than `like`/`unlike` because the caller is a switch: it does not know which of
   * the two it is doing, and asking it to know is how a heart ends up out of step with the row.
   */
  toggleLike(userId: string, trackId: string): Promise<{ liked: boolean }>;
  /**
   * This account's lists, oldest first. Never throws, for the same reason `listLikes` does not.
   */
  listPlaylists(userId: string): Promise<LibraryRead<Playlist>>;
  /**
   * Creates a list, or replaces the one with the same derived id.
   *
   * Upsetting a name is an edit rather than an error, because the id is derived from the name: a
   * second `LATE NIGHT` is the same list, not a duplicate of it.
   */
  savePlaylist(input: { ownerId: string; name: string; items?: PlaylistItem[] }): Promise<Playlist>;
  /** Adds a track to a list, or removes it if it is already there. Hands back the list as it stands. */
  togglePlaylistTrack(input: { ownerId: string; playlistId: string; trackId: string }): Promise<Playlist>;
  /** Takes a list away. Only its owner may, which the policy enforces rather than this code. */
  removePlaylist(ownerId: string, playlistId: string): Promise<void>;

  /* ---------------------------------------------------------------------------------------------
   * Broadcast queues.
   *
   * The queue somebody is listening to, published so others can follow it. Two reads and two writes,
   * and the account is passed in for the reason the library methods give: "who may write this" is the
   * database's question, answered by the policy on `music_queues`, not this interface's.
   * ------------------------------------------------------------------------------------------- */

  /**
   * The queues anybody may see - the public ones, most recently moved first.
   *
   * Never throws, and an empty answer is meaningful: a table that has not been migrated reads as
   * "nobody is broadcasting", which is what the tab draws before the schema is there. A *failure* is
   * different and is reported by the caller, which is why the Supabase implementation distinguishes
   * the two rather than swallowing both into an empty array.
   */
  listQueues(): Promise<BroadcastQueue[]>;
  /** This account's own queue, public or not, or null when it has never published one. */
  readOwnQueue(): Promise<OwnQueue | null>;
  /**
   * Publishes, retracts or moves this account's queue along.
   *
   * One method rather than three, because every one of them is the same upsert: a person is listening
   * to one thing at a time, so the row is keyed by the account and "go public", "change track" and
   * "stop broadcasting" differ only in the values written. That also means the row cannot be duplicated
   * by two presses racing, which three methods could.
   */
  publishQueue(input: PublishQueueInput): Promise<void>;
  /** Forgets this account's queue entirely, which is more than going private - the row is gone. */
  clearQueue(userId: string): Promise<void>;
  /**
   * Tells the caller when a queue moves, until the returned function is called.
   *
   * A subscription rather than a poll, so somebody going public or changing track appears on the list
   * without a reload. The mock store cannot reach another browser and subscribes to its own writes, so
   * on the mock the list only moves when *this* browser changes something - the honest limit every mock
   * store in this project has.
   */
  subscribeToQueues(onChange: () => void): () => void;
};

/**
 * A queue's row, plus the one field only its owner may see.
 *
 * `isPublic` is deliberately *not* on `BroadcastQueue`: a list of public queues has no use for the flag,
 * because everything on it is public by definition - and putting it there would invite a screen to draw
 * a broadcast that is not one. It is its own type because only `readOwnQueue` may return it, and the
 * switch that shows it is the only thing that reads it.
 */
export type OwnQueue = BroadcastQueue & { isPublic: boolean };

/** What a queue write needs: the whole state, because every write is an upsert of it. */
export type PublishQueueInput = {
  /** The account publishing. Passed in rather than read from a session, like every other write here. */
  userId: string;
  trackId: string;
  trackIndex: number;
  trackTotal: number;
  positionSeconds: number;
  isPublic: boolean;
};

let mockRepository: MusicRepository | null = null;
let supabaseRepository: MusicRepository | null = null;

export function getMusicRepository(): MusicRepository {
  if (MUSIC_DATA_SOURCE === 'supabase') {
    if (supabaseRepository === null) supabaseRepository = getSupabaseMusicRepository();
    return supabaseRepository;
  }

  if (mockRepository === null) mockRepository = getMockMusicRepository();
  return mockRepository;
}
