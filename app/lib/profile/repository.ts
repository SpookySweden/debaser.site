import { isSupabaseConfigured } from '../supabase/client';
import { getMockProfileRepository } from './mock-profile-repository';
import { getSupabaseProfileRepository } from './supabase-profile-repository';
import type { ProfileDataSource, ProfileRepository } from './types';

/**
 * The single switch that decides where profiles live.
 *
 * Default is the mock store in localStorage, because that needs no schema at all.
 * To move profiles to Supabase, run `supabase/schema.sql` against the project and
 * then add this to `.env.local` (and to the Vercel project) and restart:
 *
 *   NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase
 *
 * Nothing in the UI changes when it does: every screen talks to the
 * ProfileRepository interface, and the Supabase implementation keeps the same
 * validation, the same append-only picture history and the same presence rules.
 */
export const PROFILE_DATA_SOURCE: ProfileDataSource =
  process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getProfileRepository(): ProfileRepository {
  return PROFILE_DATA_SOURCE === 'supabase' ? getSupabaseProfileRepository() : getMockProfileRepository();
}
