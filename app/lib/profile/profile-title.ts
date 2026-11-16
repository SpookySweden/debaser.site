import { createClient } from '@supabase/supabase-js';
import { SITE_ACCOUNT_DISPLAY_NAME, SITE_ACCOUNT_ID } from '../auth/builtin-account';

/**
 * The browser tab's words for a profile page (list 4, from a test run Luke passed on: the tab read
 * "Profile 44661640-..."). It names the person by their display name; a hidden test account, an
 * account that is not there, or a lookup that fails gets the plain words, never the id.
 *
 * Read on the server when the page is asked for, with the public key: a profile's name is public, the
 * same row any visitor's browser reads (`is_hidden` too, see 20261021000032_hidden_test_accounts.sql).
 * With the mock accounts, which live in each browser, only the house account has a name to give here.
 */

export const PROFILE_TITLE_FALLBACK = 'DEBASER.SITE - Profile';

const NAME_LIMIT = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titled(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT).trim();
  return clean.length === 0 ? PROFILE_TITLE_FALLBACK : `${PROFILE_TITLE_FALLBACK} :: ${clean}`;
}

async function supabaseName(id: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (url.length === 0 || key.length === 0 || !UUID.test(id)) return null;

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // A slow database must not hold the page up: the tab gets the plain words instead.
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3000) }) },
  });
  try {
    const { data, error } = await db.from('profiles').select('display_name,is_hidden').eq('id', id).maybeSingle();
    if (error !== null || data === null) return null;
    const row = data as { display_name: string | null; is_hidden: boolean | null };
    if (row.is_hidden === true) return null;
    return row.display_name ?? null;
  } catch {
    return null;
  }
}

/** The tab title for the profile at `id`. */
export async function profileTitle(id: string): Promise<string> {
  if (id === SITE_ACCOUNT_ID) return titled(SITE_ACCOUNT_DISPLAY_NAME);
  if (process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE !== 'supabase') return PROFILE_TITLE_FALLBACK;
  const name = await supabaseName(id);
  return name === null ? PROFILE_TITLE_FALLBACK : titled(name);
}
