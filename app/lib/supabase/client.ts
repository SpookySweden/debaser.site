import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client helper.
 *
 * The env vars already exist in `.env.local`
 * (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), so once the
 * `forum_threads` / `forum_comments` tables and their RLS policies are created
 * the only switch that flips the board over is:
 *
 *   NEXT_PUBLIC_FORUM_DATA_SOURCE=supabase
 *
 * (see app/lib/forum/repository.ts).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

let browserClient: SupabaseClient | null = null;

/** Returns null when the project env vars are missing, so callers can fall back. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (browserClient) return browserClient;

  browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return browserClient;
}
