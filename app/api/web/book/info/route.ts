import { BOOK_REF, readBookInfo } from '../../../../lib/web/books';
import { SafeFetchError } from '../../../../lib/web/safe-fetch';
import { cachedFetch } from '../../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * GET /api/web/book/info?ref=…: one book's MEDIA row (title, authors, year, cover, readable here or not) for its page and
 * the reader's title (SPEC-books.md), read from Open Library or LibriVox. Details only, no text; kept a day like searches.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const perAddress = makeRateLimiter(120, 60_000);

function answer(body: unknown, status: number, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
}

export async function GET(request: Request): Promise<Response> {
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  if (!BOOK_REF.test(ref)) return answer({ error: 'Ask for a book.' }, 400);
  if (!perAddress.allow(clientAddress(request.headers))) return answer({ error: 'Too many requests. Wait a minute.' }, 429);
  try {
    const item = await readBookInfo(ref, cachedFetch);
    if (item === null) return answer({ error: 'NO SUCH BOOK.' }, 404);
    return answer({ item }, 200, 'public, max-age=3600, s-maxage=86400');
  } catch (error) {
    if (error instanceof SafeFetchError) return answer({ error: 'THE CATALOGUE DID NOT ANSWER.' }, 502);
    return answer({ error: 'NO SUCH BOOK.' }, 404);
  }
}
