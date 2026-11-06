import { createClient } from '@supabase/supabase-js';
import { readYouTubeMine, YouTubeTokenError } from '../../../../lib/web/youtube-mine';

/**
 * A signed-in person's own YouTube uploads and likes (lib/web/youtube-mine.ts). Their session proves who they are; their
 * Google token, sent by their own browser, reads their own account for this one request. Neither is stored or logged,
 * and neither comes back in an answer.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !publicKey) return json({ error: 'Linking YouTube is not set up on this server.' }, 503);

  const session = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(session);
  if (error || !data.user || data.user.is_anonymous === true) return json({ error: 'Sign in first.' }, 401);

  try {
    return json({ items: await readYouTubeMine(request.headers.get('x-google-token') ?? '') }, 200);
  } catch (failure) {
    if (failure instanceof YouTubeTokenError) return json({ error: 'YOUTUBE NEEDS LINKING AGAIN.' }, 403);
    return json({ error: 'YOUTUBE COULD NOT BE READ.' }, 502);
  }
}
