import { getMockProfileRepository } from './mock-profile-repository';
import type { ProfileDataSource, ProfileRepository } from './types';

/**
 * The single switch that decides where profiles live.
 *
 * Today there is one implementation: the mock profile store in localStorage.
 * Supabase profiles (profiles / profile_avatar_versions / profile_tags /
 * profile_comments, with the RLS rules listed on ProfileRepository in
 * ./types.ts) land with the rest of the schema in build order step 3, at which
 * point this gains a `supabase-profile-repository.ts` and reads:
 *
 *   NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase
 *
 * Nothing in the UI changes when it does: every screen talks to the
 * ProfileRepository interface.
 */
export const PROFILE_DATA_SOURCE: ProfileDataSource = 'mock';

export function getProfileRepository(): ProfileRepository {
  return getMockProfileRepository();
}
