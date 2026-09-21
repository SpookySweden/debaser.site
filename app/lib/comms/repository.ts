import { getMockCommsRepository } from './mock-comms-repository';
import type { CommsDataSource, CommsRepository } from './types';

/**
 * The single switch that decides where conversations live.
 *
 * Today there is one implementation: the mock store in localStorage. Supabase
 * comms (comms_threads / comms_messages / comms_reads, with the RLS rules listed
 * on `CommsRepository` in ./types.ts) lands with the rest of the schema, at which
 * point this gains a `supabase-comms-repository.ts` and reads:
 *
 *   NEXT_PUBLIC_COMMS_DATA_SOURCE=supabase
 *
 * Nothing in the UI changes when it does: the console, the notification window
 * and the provider all talk to the CommsRepository interface.
 */
export const COMMS_DATA_SOURCE: CommsDataSource = 'mock';

export function getCommsRepository(): CommsRepository {
  return getMockCommsRepository();
}
