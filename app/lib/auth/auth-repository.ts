import { isSupabaseConfigured } from '../supabase/client';
import { getMockAuthRepository } from './mock-auth';
import { getSupabaseAuthRepository } from './supabase-auth';
import type { AuthBackend, AuthRepository } from './types';

/**
 * The switch that decides where accounts live.
 *
 * Default is the mock backend (accounts in this browser only) because Supabase
 * Auth is not switched on yet. To go live, enable email/password auth in the
 * Supabase dashboard and add this to `.env.local`, then restart:
 *
 *   NEXT_PUBLIC_AUTH_BACKEND=supabase
 *
 * Nothing else changes: the account page, the session plumbing and the forum's
 * author attribution all talk to the AuthRepository interface.
 */
export const AUTH_BACKEND: AuthBackend =
  process.env.NEXT_PUBLIC_AUTH_BACKEND === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export const USING_MOCK_AUTH = AUTH_BACKEND === 'mock';

/** Supabase emails a confirmation link before the first sign-in; the mock does not. */
export const REQUIRES_EMAIL_CONFIRMATION = AUTH_BACKEND === 'supabase';

export function getAuthRepository(): AuthRepository {
  return AUTH_BACKEND === 'supabase' ? getSupabaseAuthRepository() : getMockAuthRepository();
}
