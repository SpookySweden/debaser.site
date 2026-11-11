import { EDITION_KEY, EDITIONS_ORDERS, EDITIONS_SHOWS, type EditionsOrder, type EditionsShow } from '../../../../lib/books/editions';
import { listEditions } from '../../../../lib/web/book-editions';
import { SafeFetchError } from '../../../../lib/web/safe-fetch';
import { cachedFetch } from '../../../../lib/web/search/cached-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * GET /api/web/book/editions?ref=books:OL…W&offset=0&show=all|readable|details&order=details|newest|oldest&at=OL…M
 * (SPEC-book-editions.md, Luke 2026-11-11): a book's editions, fifty at a time, read live from Open Library (and whether
 * each edition's Archive scan is free or lent, from the Archive's search). Open to visitors, as MEDIA is. Catalogue details
 * only, never a book's text; Open Library's answers stay in the fetch cache a day, as searches do.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A work with thousands of editions is read in up to ten requests, three at a time, the first time it's asked.
export const maxDuration = 30;

const perAddress = makeRateLimiter(60, 60_000);
const REF = /^books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?$/;

function answer(body: unknown, status: number, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ref = params.get('ref') ?? '';
  if (!REF.test(ref)) return answer({ error: 'Ask for a book.' }, 400);
  const offsetText = params.get('offset') ?? '0';
  const offset = /^[0-9]{1,5}$/.test(offsetText) ? Number(offsetText) : -1;
  if (offset < 0) return answer({ error: 'Ask for a page.' }, 400);
  const show = EDITIONS_SHOWS.find((value) => value === params.get('show')) ?? ('all' as EditionsShow);
  const order = EDITIONS_ORDERS.find((value) => value === params.get('order')) ?? ('details' as EditionsOrder);
  const atText = params.get('at');
  const at = atText !== null && EDITION_KEY.test(atText) ? atText : null;
  if (!perAddress.allow(clientAddress(request.headers))) return answer({ error: 'Too many requests. Wait a minute.' }, 429);
  try {
    const list = await listEditions({ ref, offset, show, order, at }, cachedFetch);
    if (list === null) return answer({ error: 'NO SUCH BOOK.' }, 404);
    return answer(list, 200, 'public, max-age=600, s-maxage=3600');
  } catch (error) {
    // Open Library not answering is the usual reason; anything else is said the same way, with no detail.
    return answer({ error: error instanceof SafeFetchError ? 'THE CATALOGUE DID NOT ANSWER.' : 'THE LIST COULD NOT BE READ.' }, 502);
  }
}
