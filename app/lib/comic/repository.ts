import { getSupabaseBrowserClient } from '../supabase/client';
import { createMockComicRepository } from './mock-comic-repository';
import { COMIC_DATA_SOURCE } from './source';
import { createSupabaseComicRepository } from './supabase-comic-repository';
import type { ComicRepository } from './types';

export { COMIC_DATA_SOURCE };

let repository: ComicRepository | null = null;

export function getComicRepository(): ComicRepository {
  if (repository) return repository;
  const client = COMIC_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseComicRepository(client) : createMockComicRepository();
  return repository;
}
