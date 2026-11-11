import { BOOK_REF, readBookText } from '../../../../lib/web/books';
import { SafeFetchError } from '../../../../lib/web/safe-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * GET /api/web/book/text?ref=books:OL85892W-pg345: a Project Gutenberg book's plain text for the site's reader (SPEC-books.md,
 * Luke's OK 2026-11-10). Passed through, never kept: asked with `cache: 'no-store'`, answered `private, no-store`, nothing
 * written anywhere. Only a book with a Gutenberg number; anything else is refused. Open to visitors, as MEDIA is.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const booksPerAddress = makeRateLimiter(20, 60_000);
const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

function refuse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  if (!BOOK_REF.test(ref)) return refuse('Ask for a book.', 400);
  if (!booksPerAddress.allow(clientAddress(request.headers))) return refuse('Too many books at once. Wait a minute.', 429);
  try {
    const text = await readBookText(ref, freshFetch);
    if (text === null) return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    if (error instanceof SafeFetchError) return refuse('PROJECT GUTENBERG DID NOT ANSWER.', 502);
    return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
  }
}
