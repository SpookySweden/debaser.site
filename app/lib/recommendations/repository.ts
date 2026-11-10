import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { createMockRecommendationsRepository } from './mock-recommendations-repository';
import { createSupabaseRecommendationsRepository } from './supabase-recommendations-repository';
import type { RecommendationsRepository } from './types';

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/** The tables when `NEXT_PUBLIC_RECOMMENDATIONS_DATA_SOURCE=supabase`, or, with that unset, when profiles are on Supabase. */
const REQUESTED = readSource(process.env.NEXT_PUBLIC_RECOMMENDATIONS_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);

export const RECOMMENDATIONS_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

/** Who the mock store is talking to: set by the page from the signed-in account (the Supabase one asks the session). */
let viewer: { id: string; name: string } | null = null;
export function setRecommendationsViewer(next: { id: string; name: string } | null): void {
  viewer = next;
}

let repository: RecommendationsRepository | null = null;

export function getRecommendationsRepository(): RecommendationsRepository {
  if (repository) return repository;
  const client = RECOMMENDATIONS_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseRecommendationsRepository(client) : createMockRecommendationsRepository(() => viewer);
  return repository;
}
