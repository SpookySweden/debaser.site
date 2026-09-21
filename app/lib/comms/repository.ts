import { isSupabaseConfigured } from '../supabase/client';
import { getMockCommsRepository } from './mock-comms-repository';
import { getSupabaseCommsRepository } from './supabase-comms-repository';
import type { CommsDataSource, CommsRepository } from './types';

/**
 * The single switch that decides where conversations live.
 *
 * Default is the mock store in localStorage. To move comms to Supabase, run
 * `supabase/schema.sql` against the project and then add this to `.env.local`
 * (and to the Vercel project) and restart:
 *
 *   NEXT_PUBLIC_COMMS_DATA_SOURCE=supabase
 *
 * Nothing in the UI changes when it does: the console, the notification window,
 * the side panel and the provider all talk to the CommsRepository interface - and
 * a message finally crosses machines, which is the whole point of the move.
 */
export const COMMS_DATA_SOURCE: CommsDataSource =
  process.env.NEXT_PUBLIC_COMMS_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export function getCommsRepository(): CommsRepository {
  return COMMS_DATA_SOURCE === 'supabase' ? getSupabaseCommsRepository() : getMockCommsRepository();
}
