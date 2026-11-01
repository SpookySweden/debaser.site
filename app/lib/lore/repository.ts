import { isSupabaseConfigured } from '../supabase/client';
import { getMockLoreRepository } from './mock-lore-repository';
import { getSupabaseLoreRepository } from './supabase-lore-repository';
import type { LoreDataSource, LoreRepository } from './types';

/**
 * The switch that decides where the lore pages live.
 *
 * Supabase means the `lore_pages` table (a page anybody may read and any account may write, with
 * the merges happening over a Realtime channel); the mock means localStorage beside the board's
 * rows and a `BroadcastChannel` between the tabs on this machine. Default is the mock, exactly
 * like the other stores, so the shelf works with no backend at all. To move it over, set this in
 * `.env.local`:
 *
 *   NEXT_PUBLIC_LORE_DATA_SOURCE=supabase
 *
 * Nothing about the editor changes when the switch flips: the repository answers with a room
 * either way, and the handshake over it is the same code (see ./session.ts).
 */
export const LORE_DATA_SOURCE: LoreDataSource =
  process.env.NEXT_PUBLIC_LORE_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

let mockRepository: LoreRepository | null = null;
let supabaseRepository: LoreRepository | null = null;

export function getLoreRepository(): LoreRepository {
  if (LORE_DATA_SOURCE === 'supabase') {
    if (supabaseRepository === null) supabaseRepository = getSupabaseLoreRepository();
    return supabaseRepository;
  }

  if (mockRepository === null) mockRepository = getMockLoreRepository();
  return mockRepository;
}
