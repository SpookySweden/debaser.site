import { createClient } from '@supabase/supabase-js';
import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';

/**
 * MEDIA (/media, WEB in the code) is open to signed-out visitors since 2026-11-09 (Luke: "remove the need to be signed
 * in to access the media tab", then "Everything"; SPEC-media-servers.md decision 4 as changed). Its routes answer anyone,
 * and the page asks them with `webReaderHeaders`: the session when there is one, nothing when there isn't.
 *
 * `webSessionHeaders` and `webSignedIn` stay for what still needs an account (picture search, DISCOVER's links, a stream
 * room's pictures), in the avatar route's pattern: the page presents its session token, the route checks it with
 * `auth.getUser` before anything else. With the mock accounts (no auth backend) there is no session to present or
 * check, so both let the request through.
 */

/** The page's side, for account-only routes: headers carrying the session, `{}` on the mock accounts, null when signed out. */
export async function webSessionHeaders(): Promise<Record<string, string> | null> {
  if (USING_MOCK_AUTH) return {};
  const client = getSupabaseBrowserClient();
  if (client === null) return null;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token ?? null;
  return token === null ? null : { Authorization: `Bearer ${token}` };
}

/**
 * The page's side, for MEDIA's open routes: the session's headers when signed in to an account, none when signed out or a
 * stream-room guest (SPEC-guests.md: the rest of the site treats a guest as signed out). Never null.
 */
export async function webReaderHeaders(): Promise<Record<string, string>> {
  if (USING_MOCK_AUTH) return {};
  const client = getSupabaseBrowserClient();
  if (client === null) return {};
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (session === null || session.user.is_anonymous === true) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/** What an account-only route sends a visitor with no session. */
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
  const token = bearerOf(request);
  if (token.length === 0 || token.length > 4000) return false;
  return check(token);
}

function bearerOf(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

/**
 * For an open route that reads the database as the reader: the session token when it is a live account's (not a stream-room
 * guest's, which the WEB tables keep out), else null, read as a visitor. A stale or made-up token is read as a visitor too.
 */
export async function readerToken(request: Request, check: CheckToken = checkWithSupabase): Promise<string | null> {
  const token = bearerOf(request);
  if (token.length === 0 || token.length > 4000) return null;
  return (await check(token)) ? token : null;
}
