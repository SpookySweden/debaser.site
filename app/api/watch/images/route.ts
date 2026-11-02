import { IMAGE_SEARCH_KINDS, readGiphy, readImgur, type ImageSearchKind } from '../../../lib/watch/chat-images';
import { buildUrl, safeFetchJson, type FetchLike } from '../../../lib/web/safe-fetch';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { webSignedIn } from '../../../lib/web/web-session';

/**
 * The stream chat's picture search (WatchRoom's GIF / IMAGE panel):
 *
 *   GET /api/watch/images?q=<words>&kind=gif|sticker|image  ->  { results: [{ id, title, thumb, url }] }
 *
 * Signed-in people only (guests cannot talk in a room). GIF and sticker search GIPHY (server-only
 * `GIPHY_API_KEY`, results rated PG-13 or milder); image searches Imgur's gallery (server-only
 * `IMGUR_CLIENT_ID`, NSFW posts dropped). Without its key a kind answers 503 and the panel says it is not set
 * up. Only the search words leave the site; the pictures are hotlinked by the browser, never copied.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const perAddress = makeRateLimiter(30, 60_000);
const LIMIT = 24;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!(await webSignedIn(request))) return json({ error: 'LOG IN TO SEARCH.' }, 401);
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'TOO MANY SEARCHES. WAIT A MINUTE.' }, 429);
  const params = new URL(request.url).searchParams;
  const words = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const kind = (IMAGE_SEARCH_KINDS as readonly string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as ImageSearchKind) : 'gif';
  if (words.length === 0) return json({ results: [] }, 200);

  try {
    if (kind === 'image') {
      const clientId = process.env.IMGUR_CLIENT_ID ?? '';
      if (clientId === '') return json({ error: 'IMAGE SEARCH IS NOT SET UP.' }, 503);
      const withId: FetchLike = (input, init) =>
        fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Client-ID ${clientId}` } });
      const answer = await safeFetchJson(buildUrl('api.imgur.com', ['3', 'gallery', 'search', 'top', 'all', '0'], [['q', words]]), {
        allowedHosts: ['api.imgur.com'],
        fetchImpl: withId,
      });
      return json({ results: readImgur(answer).slice(0, LIMIT) }, 200);
    }
    const key = process.env.GIPHY_API_KEY ?? '';
    if (key === '') return json({ error: 'GIF SEARCH IS NOT SET UP.' }, 503);
    const answer = await safeFetchJson(
      buildUrl('api.giphy.com', ['v1', kind === 'sticker' ? 'stickers' : 'gifs', 'search'], [
        ['api_key', key],
        ['q', words],
        ['limit', String(LIMIT)],
        ['rating', 'pg-13'],
      ]),
      { allowedHosts: ['api.giphy.com'] },
    );
    return json({ results: readGiphy(answer) }, 200);
  } catch {
    // The key never reaches an answer, nor does the platform's own error text.
    return json({ error: 'THE SEARCH DID NOT ANSWER. TRY AGAIN.' }, 502);
  }
}
