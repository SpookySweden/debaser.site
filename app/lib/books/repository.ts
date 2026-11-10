import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { createMockBooksRepository } from './mock-books-repository';
import { createSupabaseBooksRepository } from './supabase-books-repository';
import type { BooksRepository } from './types';

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/** The tables when `NEXT_PUBLIC_BOOKS_DATA_SOURCE=supabase`, or, with that unset, when profiles are on Supabase. */
const REQUESTED = readSource(process.env.NEXT_PUBLIC_BOOKS_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);

export const BOOKS_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

let repository: BooksRepository | null = null;

export function getBooksRepository(): BooksRepository {
  if (repository) return repository;
  const client = BOOKS_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseBooksRepository(client) : createMockBooksRepository();
  return repository;
}
