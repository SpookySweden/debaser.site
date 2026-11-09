import { relatedFor } from '../../../lib/web/related';
import { searchText } from '../../../lib/web/search';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';

/**
 * "Did you mean" and related topics for a /web search (lib/web/related.ts):
 *
 *   GET /api/web/related?q=<words>[&kino=1]  ->  { suggestion: string | null, topics: [{ label, query, keyword? }] }
 *
 * Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts). Only the words of the search go anywhere (`searchText`); answers from
 * Wikipedia, Wikidata and TMDB are cached on the server for a day. Anything that fails is simply nothing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// One per search; the same allowance as the search route's per-address limit, shared by nobody else.
const perAddress = makeRateLimiter(30, 60_000);

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many searches. Wait a minute and try again.' }, 429);
  const params = new URL(request.url).searchParams;
  const words = searchText((params.get('q') ?? '').slice(0, 600));
  if (words === null) return json({ suggestion: null, topics: [] }, 200);
  const answer = await relatedFor(words, { fetch: cachedFetch, kino: params.get('kino') === '1', tmdbToken: process.env.TMDB_READ_TOKEN });
  return json(answer, 200);
}
