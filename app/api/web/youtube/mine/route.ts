import { createClient } from '@supabase/supabase-js';
import { preferredChannels, readYouTubeMine, YouTubeTokenError } from '../../../../lib/web/youtube-mine';
import { dropShorts } from '../../../../lib/web/search/shorts-check';

/**
 * A signed-in person's own YouTube: their channels' uploads, their likes, and what those say they like (lib/web/youtube-mine.ts). Their session proves who they are; their
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

  // The browser's hint: YouTube ids of channels this person watches on the site, so their new videos are read first.
  // Only ids shaped like YouTube's are used, and they are sent to YouTube alone.
  const hint = (await request.json().catch(() => null)) as { prefer?: unknown } | null;

  try {
    // The videos, and the channels, topics and playlist names that teach the page's order (youtube-mine.ts).
    // No Shorts among them (search/shorts-check.ts; Luke, 2026-11-14): the uploads list already has none, a liked Short goes here.
    const mine = await readYouTubeMine(request.headers.get('x-google-token') ?? '', fetch, new Date(), preferredChannels(hint?.prefer));
    const liked = await dropShorts(mine.liked).catch(() => mine.liked);
    const stays = new Set([...mine.uploads, ...liked].map((item) => item.id));
    return json({ ...mine, liked, items: mine.items.filter((item) => stays.has(item.id)) }, 200);
  } catch (failure) {
    if (failure instanceof YouTubeTokenError) return json({ error: 'YOUTUBE NEEDS LINKING AGAIN.' }, 403);
    return json({ error: 'YOUTUBE COULD NOT BE READ.' }, 502);
  }
}
