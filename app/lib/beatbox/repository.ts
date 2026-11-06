import { getSupabaseBrowserClient } from '../supabase/client';
import { createMockSongRepository } from './mock-song-repository';
import { createSupabaseSongRepository } from './supabase-song-repository';
import type { BeatBoxSongRepository } from './types';

let repository: BeatBoxSongRepository | null = null;

/** Where saved songs live: the table when `NEXT_PUBLIC_BEATBOX_DATA_SOURCE=supabase`, otherwise in memory. */
export function getBeatBoxSongRepository(): BeatBoxSongRepository {
  if (repository) return repository;
  const client = process.env.NEXT_PUBLIC_BEATBOX_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseSongRepository(client) : createMockSongRepository();
  return repository;
}
