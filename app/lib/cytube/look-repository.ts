import { isSupabaseConfigured } from '../supabase/client';
import type { LookChoice } from './looks';
import { getMockLookRepository } from './mock-look-repository';
import { getSupabaseLookRepository } from './supabase-look-repository';

/**
 * Where each person's broadcaster look and SHOW THE HOST'S LOOK switch are kept (SPEC-cytube.md, "Data").
 *
 * Supabase: `cytube_looks` (supabase/migrations/*_cytube.sql), one row per person, readable by signed-in
 * people (a viewer reads the host's look), written only by its owner (Row Level Security). The mock keeps the
 * same rules by hand in this browser. It follows the stream rooms' switch, since a look belongs to a room:
 *
 *   NEXT_PUBLIC_WATCH_DATA_SOURCE=supabase
 */
export type LookRepository = {
  /** The person's choices, or null when they have never saved any. Throws when the store could not be read. */
  load(userId: string): Promise<LookChoice | null>;
  /** Writes `by`'s own choices; anybody else's is refused. */
  save(by: string, choice: LookChoice): Promise<void>;
};

export const LOOK_DATA_SOURCE: 'mock' | 'supabase' =
  process.env.NEXT_PUBLIC_WATCH_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getLookRepository(): LookRepository {
  return LOOK_DATA_SOURCE === 'supabase' ? getSupabaseLookRepository() : getMockLookRepository();
}
