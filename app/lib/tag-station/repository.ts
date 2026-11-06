import { createClient } from '@supabase/supabase-js';
import type { PoolAsk, PoolStep, StationRow, SweptCounts } from './types';
import type { WordFact } from './word-facts';
import { getMockTagRepository } from './mock-tag-repository';
import { createSupabaseTagRepository } from './supabase-tag-repository';

/**
 * Where TAG STATION reads its items and words, by MEDIA's own switch (`NEXT_PUBLIC_WEB_DATA_SOURCE`): the mock unless the
 * site is reading the live stream. SERVER ONLY: the route calls it with the session token it has already checked.
 */
export type TagStationRepository = {
  readonly source: 'mock' | 'supabase';
  rows(): Promise<readonly StationRow[]>;
  /** What the word pass has said so far. Empty, never an error, when it can't be read: the map just goes without. */
  wordFacts(): Promise<readonly WordFact[]>;
  /** The sweep's rows to list and its word counts. Empty, never an error, when they can't be read. */
  pool(): Promise<{ rows: readonly StationRow[]; swept: SweptCounts; incomplete?: boolean }>;
  /** One step of digging through the pool's compressed files. Throws when the files can't be read, so a reader's [ MORE ] can try the same step again. */
  poolFiles(ask: PoolAsk): Promise<PoolStep>;
  /** Which of these words the tagged items carry at all. */
  poolWords(words: readonly string[]): Promise<readonly string[]>;
  /** Whether the $60 tagging limit has been reached. */
  limitReached(): Promise<boolean>;
};

const USES_SUPABASE =
  process.env.NEXT_PUBLIC_WEB_DATA_SOURCE === 'supabase' && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export function getTagRepository(token: string | null): TagStationRepository {
  if (!USES_SUPABASE || token === null) return getMockTagRepository();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return createSupabaseTagRepository(client);
}
