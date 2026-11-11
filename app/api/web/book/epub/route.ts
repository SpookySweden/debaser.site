import { BOOK_REF, openBookEpub } from '../../../../lib/web/books';
import { SafeFetchError } from '../../../../lib/web/safe-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * GET /api/web/book/epub?ref=books:OL85892W-pg345: a Project Gutenberg book's EPUB, pictures included, for the site's reader
 * (SPEC-reader.md, Luke's OK 2026-11-11, widening SPEC-books.md's for the text). Passed through as it streams, never kept:
 * asked with `cache: 'no-store'`, answered `private, no-store`, nothing written to disk, the database or the fetch cache, and
 * Vercel's edge told not to keep it either. Only a book with a Gutenberg number, from www.gutenberg.org, or an Internet
 * Archive book's own EPUB (Luke, 2026-11-11), from archive.org and its file servers; anything else is refused. An Archive
 * book with no EPUB answers `{ viewer: true }`, and the reader shows the Archive's own viewer. Open to visitors, as MEDIA is.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const opened = await openBookEpub(ref, freshFetch);
    if (opened === null) return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
    // An Internet Archive book with no EPUB anyone may read: the reader shows the Archive's own viewer instead.
    if (opened === 'viewer') {
      return new Response(JSON.stringify({ error: 'NO EPUB', viewer: true }), { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/epub+zip',
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };
    if (opened.length !== null) headers['Content-Length'] = String(opened.length);
    return new Response(opened.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof SafeFetchError) return refuse('PROJECT GUTENBERG DID NOT ANSWER.', 502);
    return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
  }
}
