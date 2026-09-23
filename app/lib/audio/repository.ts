import { isSupabaseConfigured } from '../supabase/client';
import type { FolderPath } from './archive-tree';
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
