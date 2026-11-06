import { createClient } from '@supabase/supabase-js';
import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';

/**
 * WEB is for signed-in people only (SPEC-media-servers.md decision 4, Luke 2026-11-01): signed out, /web shows
 * a sign-in prompt and the WEB search routes refuse. These are the two halves of that, in the avatar route's
 * pattern: the page presents its session token, the route checks it with `auth.getUser` before anything else.
 *
 * With the mock accounts (no auth backend) there is no session to present or check, so both halves let the
 * request through; the page's own gate still shows the prompt to a signed-out visitor.
 */

/** The page's side: headers carrying the session, `{}` on the mock accounts, null when signed out. */
export async function webSessionHeaders(): Promise<Record<string, string> | null> {
  if (USING_MOCK_AUTH) return {};
  const client = getSupabaseBrowserClient();
  if (client === null) return null;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token ?? null;
  return token === null ? null : { Authorization: `Bearer ${token}` };
}

/** What a route sends a visitor with no session. */
export const SIGNED_OUT_REFUSAL = 'Sign in to use media.';

export type CheckToken = (token: string) => Promise<boolean>;

/** Asks Supabase whether the token is a live session (server only: the routes call it). */
const checkWithSupabase: CheckToken = async (token) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !key) return false;
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    // A guest is signed in only as far as stream rooms go (SPEC-guests.md).
    return error === null && Boolean(data.user?.id) && data.user?.is_anonymous !== true;
  } catch {
    return false;
  }
};

/**
 * The route's side: true when the request carries a live session (or the accounts are the mock ones).
 * `mockAuth` and `check` are there for `scripts/check-web-signed-in.cjs`.
 */
export async function webSignedIn(request: Request, mockAuth = USING_MOCK_AUTH, check: CheckToken = checkWithSupabase): Promise<boolean> {
  if (mockAuth) return true;
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (token.length === 0 || token.length > 4000) return false;
  return check(token);
}
