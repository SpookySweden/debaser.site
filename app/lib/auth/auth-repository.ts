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
 *
 * One account exists on both backends - the house account debaser.site (see
 * `./builtin-account.ts`). The mock seeds it into the browser; Supabase wants it
 * created in the dashboard (Users -> Add user, address `admin1212@debaser.site`,
 * the password under "Auto Confirm User"), because Supabase Auth is what signs in
 * with a real address. Typing the identifier `ADMIN1212` keeps working either way:
 * `resolveSignInAddress` maps it to that address before sign-in.
 */
export const AUTH_BACKEND: AuthBackend =
  process.env.NEXT_PUBLIC_AUTH_BACKEND === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export const USING_MOCK_AUTH = AUTH_BACKEND === 'mock';

/** Supabase emails a confirmation link before the first sign-in; the mock does not. */
export const REQUIRES_EMAIL_CONFIRMATION = AUTH_BACKEND === 'supabase';

export function getAuthRepository(): AuthRepository {
  return AUTH_BACKEND === 'supabase' ? getSupabaseAuthRepository() : getMockAuthRepository();
}
