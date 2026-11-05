import { resolveStationLink } from '../../../lib/tag-station/link-words';
import { MAX_LINK_LENGTH } from '../../../lib/web/link-shape';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { peertubeHosts } from '../../../lib/web/search/peertube-index';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { SIGNED_OUT_REFUSAL, webSignedIn } from '../../../lib/web/web-session';

/**
 * A pasted link on TAG STATION (SPEC-tag-station.md):
 *
 *   GET /api/tag-station/link?url=<a pasted address>  ->  { outcome, item, card, words }
 *
 * Signed-in people only. The address itself is never fetched (link-words.ts), nothing is saved and nothing goes to the batch
 * tagger. Platform answers are cached on the server for a day, so asking again costs no one any quota.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LINK_TIMEOUT_MS = 20_000;
const perAddress = makeRateLimiter(20, 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!(await webSignedIn(request))) return json({ error: SIGNED_OUT_REFUSAL }, 401);
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many links. Wait a minute and try again.' }, 429);
  const url = new URL(request.url).searchParams.get('url') ?? '';
  if (url.length > MAX_LINK_LENGTH) return json({ error: 'That link is too long.' }, 400);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hosts = await peertubeHosts(cachedFetch);
    const answer = await Promise.race([
      resolveStationLink(url, hosts, {
        fetch: cachedFetch,
        search: { env: { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY, TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN } },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('slow')), LINK_TIMEOUT_MS);
      }),
    ]);
    return json(answer, 200);
  } catch {
    // A failure says only that nobody answered; nothing of the error is passed on.
    return json({ outcome: 'no-answer', item: null, card: null, words: [] }, 200);
  } finally {
    clearTimeout(timer);
  }
}
