import { createClient } from '@supabase/supabase-js';

/**
 * The weekly email's unsubscribe (SPEC-notifications.md, 10A). Two callers, one answer:
 *   - the /unsubscribe page, as it opens in a browser (`POST ?t=<code>`), or its `[ TURN IT BACK ON ]` (`&on=1`);
 *   - Gmail's and Outlook's own Unsubscribe button, the standard one-click post (RFC 8058) to the address in the email's
 *     List-Unsubscribe header.
 * It changes WEEKLY EMAIL only, for the one person whose random code it is (notify_unsubscribe, in the database).
 * A bare GET changes nothing, so mail scanners that open links ahead of the reader can't unsubscribe anybody.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !publicKey) return json({ error: 'Not set up on this server.' }, 503);

  const params = new URL(request.url).searchParams;
  const code = params.get('t') ?? '';
  if (!UUID.test(code)) return json({ error: 'That link is not a whole unsubscribe link.' }, 400);
  const on = params.get('on') === '1';

  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('notify_unsubscribe', { p_code: code, p_on: on });
  if (error !== null) return json({ error: 'That did not go through. Try again.' }, 500);
  if (data !== true) return json({ error: 'That link belongs to nobody any more.' }, 404);

  return json({ weeklyEmail: on }, 200);
}
