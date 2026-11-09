import { KINO_SOURCES_MAX, parseKinoTitleKey, type KinoTitle } from '../../../../lib/web/kino';
import { readKinoSources, viewerCountry } from '../../../../lib/web/kino-sources';
import { cachedFetch } from '../../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * Where KINO titles can be watched (SPEC-kino-sources.md):
 *
 *   GET /api/web/kino/sources?titles=movie-157336,tv-1399   ->  { sources: { 'movie-157336': { watch, free }, ... } }
 *
 * The page asks once per page of rows, after the rows are drawn, so a search is exactly as fast as it was.
 * Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts). The viewer's country is read from Vercel's header to choose what to answer, and is not
 * kept or logged. Answers are never kept at Vercel's edge (they differ by country); what the
 * platforms answer rests in the server's day-long cache (cached-fetch.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const perAddress = makeRateLimiter(60, 60_000);

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);

  const asked = (new URL(request.url).searchParams.get('titles') ?? '').split(',').filter((part) => part.length > 0);
  if (asked.length === 0 || asked.length > KINO_SOURCES_MAX) return json({ error: 'Ask for 1 to 20 titles.' }, 400);
  const titles = asked.map(parseKinoTitleKey);
  if (titles.some((title) => title === null)) return json({ error: 'Those are not titles.' }, 400);

  const sources = await readKinoSources(titles as KinoTitle[], viewerCountry(request.headers), {
    fetch: cachedFetch,
    tmdbToken: process.env.TMDB_READ_TOKEN,
    youtubeKey: process.env.YOUTUBE_API_KEY,
  });
  return json({ sources }, 200);
}
