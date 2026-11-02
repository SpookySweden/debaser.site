import { IMAGE_SEARCH_KINDS, readCommons, readGiphy, type ImageSearchKind } from '../../../lib/watch/chat-images';
import { buildUrl, safeFetchJson } from '../../../lib/web/safe-fetch';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { webSignedIn } from '../../../lib/web/web-session';

/**
 * The stream chat's picture search (WatchRoom's GIF / IMAGE panel):
 *
 *   GET /api/watch/images?q=<words>&kind=gif|sticker|image  ->  { results: [{ id, title, thumb, url }] }
 *
 * Signed-in people only (guests cannot talk in a room). GIF and sticker search GIPHY (server-only
 * `GIPHY_API_KEY`, results rated PG-13 or milder; without the key they answer 503 and the panel says it is not
 * set up). Image searches Wikimedia Commons with no key (Imgur is blocked in the UK; Openverse hung on every
 * fresh search, 2026-11-02): only files Commons' structured data marks CC0 or public domain, and of those only
 * the ones it says need no credit line. Commons has no mature-content filter. Only the search words leave the site; the pictures are hotlinked by the browser, never copied.
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
      // P275 licence = CC0, or P6216 copyright status = public domain (checked live 2026-11-02: 30 of 30 matched).
      const answer = await safeFetchJson(
        buildUrl('commons.wikimedia.org', ['w', 'api.php'], [
          ['action', 'query'],
          ['format', 'json'],
          ['formatversion', '2'],
          ['generator', 'search'],
          ['gsrnamespace', '6'],
          ['gsrsearch', `${words} filetype:bitmap|drawing haswbstatement:P275=Q6938433|P6216=Q19652`],
          ['gsrlimit', String(LIMIT)],
          ['prop', 'imageinfo'],
          ['iiprop', 'url|extmetadata'],
          ['iiextmetadatafilter', 'AttributionRequired'],
          ['iiurlwidth', '320'],
        ]),
        { allowedHosts: ['commons.wikimedia.org'] },
      );
      return json({ results: readCommons(answer) }, 200);
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
