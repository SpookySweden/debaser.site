import { createClient } from '@supabase/supabase-js';
import { cachedFetch } from '../../../../lib/web/search/cached-fetch';
import { youtubeSearch } from '../../../../lib/web/search/providers/youtube';
import { clientAddress, makeDailyBudgets, makeRateLimiter } from '../../../../lib/web/search/rate-limit';
import { relatedFor, seedsFrom } from '../../../../lib/web/youtube-next';

/**
 * YouTube's "watch next" for a few of a signed-in person's own videos (lib/web/youtube-next.ts; Luke, 2026-11-14):
 *
 *   POST /api/web/youtube/related  { seeds: [{ id, title, creator }], topics?: [words] }
 *     -> { related: [{ seed, via: 'next' | 'search' | 'none', items }] }
 *
 * The seeds are videos they liked on YouTube or played on this site; only each one's id, title and channel name is
 * sent, and nothing about the person goes to YouTube: the question is the video alone, asked from the server.
 * Metadata only comes back (no counts are read, youtube-next.ts). Nothing is stored or logged here. YouTube's answers
 * sit in the server's fetch cache for a day, by video, so the same video asked about again costs nothing.
 *
 * Signed-in people only, and limited: a few seeds a request, so many a day a person and so many a minute an address
 * (in memory, so per warm server instance, like the search routes; the browser keeps its own day's count too,
 * youtube-related.ts). When InnerTube fails the fallback is a title-word search, which may spend the official Data
 * API's daily budget, shared with search.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Seeds one request may ask about. */
const MOST_SEEDS = 6;
/** Seeds one person may ask about in a day. */
const perPerson = makeRateLimiter(48, 24 * 60 * 60 * 1000);
const perAddress = makeRateLimiter(20, 60_000);
const dailyBudgets = makeDailyBudgets([youtubeSearch]);

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !publicKey) return json({ error: 'YouTube suggestions are not set up on this server.' }, 503);

  const session = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return json({ error: 'Sign in first.' }, 401);
  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(session);
  if (error || !data.user || data.user.is_anonymous === true) return json({ error: 'Sign in first.' }, 401);

  const address = clientAddress(request.headers);
  if (!perAddress.allow(address)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);

  const body = (await request.json().catch(() => null)) as { seeds?: unknown; topics?: unknown } | null;
  const person = data.user.id;
  // Each seed spends one of the person's day; the ones over it are simply not asked about.
  const seeds = seedsFrom(body?.seeds, MOST_SEEDS).filter(() => perPerson.allow(person));
  const topics = (Array.isArray(body?.topics) ? body.topics : []).filter((word): word is string => typeof word === 'string').slice(0, 3).map((word) => word.slice(0, 60));
  if (seeds.length === 0) return json({ related: [] }, 200);

  const fetchedAt = new Date().toISOString();
  const spendBudget = dailyBudgets(person);
  const search = async (words: string) =>
    (await youtubeSearch.search(words, null, { fetch: cachedFetch, env: { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY }, spendBudget })).items;
  const related = await Promise.all(seeds.map((seed) => relatedFor(seed, { fetch: cachedFetch, fetchedAt, topics, search })));
  return json({ related }, 200);
}
