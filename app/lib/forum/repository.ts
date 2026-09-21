import { isSupabaseConfigured } from '../supabase/client';
import { getMockForumRepository } from './mock-repository';
import { getSupabaseForumRepository } from './supabase-repository';
import type { ForumDataSource, ForumRepository } from './types';

/**
 * The single switch that decides where the board reads and writes.
 *
 * Default is the mock repository, because the Supabase tables and RLS policies
 * do not exist yet. Once they do, add this to `.env.local` and restart:
 *
 *   NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase
 *
 * No component changes are needed: every screen talks to the ForumRepository
 * interface. Realtime comes with it - `subscribe` switches from the mock
 * listener bus to `postgres_changes`.
 */
export const FORUM_DATA_SOURCE: ForumDataSource =
  process.env.NEXT_PUBLIC_FORUM_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getForumRepository(): ForumRepository {
  return FORUM_DATA_SOURCE === 'supabase' ? getSupabaseForumRepository() : getMockForumRepository();
}
