import { readSeries, readSeriesCounts } from '../../../lib/web/series-files';
import { SafeFetchError } from '../../../lib/web/safe-fetch';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { isSafeIdentifier } from '../../../lib/web/urls';

/**
 * Series for the stream room (SPEC-stream-series.md):
 *
 *   GET /api/web/series?ia=<archive item>       -> { title, episodes: [{ title, url, kind, seconds }], partial }
 *   GET /api/web/series?list=<youtube playlist> -> the same
 *   GET /api/web/series?counts=<item>,<item>... -> { counts: { <item>: n }, subs: { <item>: ['en', 'ja:auto'] } }
 *                                                  (counts: Archive items with 2+ videos; subs: items with subtitles, SPEC-subtitles.md)
 *
 * The episode lists come from each platform's own listing, read on the server (app/lib/web/series-files.ts) and
 * cached there for a day; the page checks every answer again (app/lib/watch/series.ts) before a row is written.
 * Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts): the queue window and /web are where these are asked. The YouTube
 * key is read here and never leaves the server.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A long playlist reads for up to 20s (`PLAYLIST_DEADLINE_MS`). */
export const maxDuration = 30;

/** Items asked in one count: a page of /web or of search results. */
const MAX_COUNTS = 30;
// A count asks the Archive once per item it has not read today; a page of results is one count.
const perAddress = makeRateLimiter(90, 60_000);

function json(body: Record<string, unknown>, status: number): Response {
  // Never kept by Vercel's edge; the reader's own browser may keep one a few minutes.
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute.' }, 429);

  const params = new URL(request.url).searchParams;
  const deps = { fetch: cachedFetch, env: { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY } };

  const counts = params.get('counts');
  if (counts !== null) {
    const ids = [...new Set(counts.split(',').filter((id) => isSafeIdentifier(id)))].slice(0, MAX_COUNTS);
    return json(await readSeriesCounts(ids, deps), 200);
  }

  const ia = params.get('ia');
  const list = params.get('list');
  const target = ia !== null ? { source: 'internet_archive' as const, id: ia } : list !== null ? { source: 'youtube' as const, list } : null;
  if (target === null) return json({ error: 'Ask for an item or a playlist.' }, 400);

  try {
    const read = await readSeries(target, deps);
    if (read === null) return json({ error: 'NOTHING HERE PLAYS IN A ROOM.' }, 404);
    return json({ title: read.title, episodes: read.episodes, partial: read.partial }, 200);
  } catch (error) {
    if (error instanceof SafeFetchError) return json({ error: 'THE PLATFORM DID NOT ANSWER.' }, 502);
    return json({ error: 'NOTHING HERE PLAYS IN A ROOM.' }, 404);
  }
}
