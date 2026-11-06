import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, supabaseAuthStorageKey } from '../supabase/client';

/**
 * The connection a stream room talks to the database through (SPEC-guests.md).
 *
 * A guest's session is kept apart from the site's own, under its own name in the browser, and only the room stores ever use it. To the rest of the
 * site a guest is simply signed out: the board, the top bar and every other page read as a visitor. An account always wins over a guest in the same browser.
 */

const GUEST_SESSION_KEY = 'debaser-guest-session';

let guest: SupabaseClient | null = null;

function stored(key: string | null): boolean {
  if (key === null || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Whether this browser holds a guest. Nothing is made for somebody who is only looking. */
export function hasStoredGuest(): boolean {
  return stored(GUEST_SESSION_KEY);
}

/** The guest's own connection, made on first asking. Null when the project isn't set up. */
export function guestClient(): SupabaseClient | null {
  if (guest !== null) return guest;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (url.length === 0 || key.length === 0) return null;
  guest = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: GUEST_SESSION_KEY, detectSessionInUrl: false } });
  return guest;
}

export function roomClient(): SupabaseClient | null {
  const site = getSupabaseBrowserClient();
  if (stored(supabaseAuthStorageKey()) || !hasStoredGuest()) return site;
  return guestClient() ?? site;
}
