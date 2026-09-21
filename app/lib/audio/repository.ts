import { isSupabaseConfigured } from '../supabase/client';
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
  title: string;
  /** Who the track is credited to; empty means the uploader. */
  credit: string;
  file: File;
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
