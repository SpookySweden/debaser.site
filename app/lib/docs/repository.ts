import { isSupabaseConfigured } from '../supabase/client';
import { getMockDocsRepository } from './mock-docs-repository';
import { getSupabaseDocsRepository } from './supabase-docs-repository';
import type { DocsDataSource, DocsRepository } from './types';

/**
 * Where DOCS live: the database, or this browser (the mock store).
 *
 *   NEXT_PUBLIC_DOCS_DATA_SOURCE=supabase
 *
 * The lore pages' old switch (`NEXT_PUBLIC_LORE_DATA_SOURCE`) counts too, since the lore pages are documents now.
 */
export const DOCS_DATA_SOURCE: DocsDataSource =
  (process.env.NEXT_PUBLIC_DOCS_DATA_SOURCE === 'supabase' || process.env.NEXT_PUBLIC_LORE_DATA_SOURCE === 'supabase') &&
  isSupabaseConfigured
    ? 'supabase'
    : 'mock';

/** The Supabase project address, for telling our own pictures from anybody else's. Empty for the mock store. */
export const DOCS_PICTURE_BASE = DOCS_DATA_SOURCE === 'supabase' ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : '';

/**
 * The store, told who is reading. The database knows from the session; the mock store is told here,
 * so its own copy of the rules answers for the right person.
 */
export function getDocsRepository(viewerId: string | null = null): DocsRepository {
  if (DOCS_DATA_SOURCE === 'supabase') return getSupabaseDocsRepository();

  const mock = getMockDocsRepository();
  mock.setViewer(viewerId);
  return mock;
}
