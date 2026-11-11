import { BOOK_REF, openArchivePdfSlice, openBookEpub } from '../../../../lib/web/books';
import { SafeFetchError } from '../../../../lib/web/safe-fetch';
import { clientAddress, makeRateLimiter } from '../../../../lib/web/search/rate-limit';

/**
 * GET /api/web/book/epub?ref=books:OL85892W-pg345: a Project Gutenberg book's EPUB, pictures included, for the site's reader
 * (SPEC-reader.md, Luke's OK 2026-11-11, widening SPEC-books.md's for the text). Passed through as it streams, never kept:
 * asked with `cache: 'no-store'`, answered `private, no-store`, nothing written to disk, the database or the fetch cache, and
 * Vercel's edge told not to keep it either. Only a book with a Gutenberg number, from www.gutenberg.org, or an Internet
 * Archive book's own files (Luke, 2026-11-11), from archive.org and its file servers; anything else is refused.
 *
 * An Archive book with no EPUB but a PDF answers `{ pdf: { size } }`, and the reader then asks
 * `?ref=...&format=pdf` with a `Range: bytes=a-b` header for each slice it needs (half a megabyte at a time), answered 206
 * and never kept, so even a scan of hundreds of megabytes reads page by page. One with neither answers `{ viewer: true }`,
 * and the reader shows the Archive's own viewer. Open to visitors, as MEDIA is.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const booksPerAddress = makeRateLimiter(20, 60_000);
/** A PDF is read in many small slices: a page of a scan can take several. */
const slicesPerAddress = makeRateLimiter(900, 60_000);
const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

const NEVER_KEPT = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function refuse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const ref = params.get('ref') ?? '';
  if (!BOOK_REF.test(ref)) return refuse('Ask for a book.', 400);
  const address = clientAddress(request.headers);

  if (params.get('format') === 'pdf') {
    if (!slicesPerAddress.allow(address)) return refuse('Too many pages at once. Wait a minute.', 429);
    try {
      const slice = await openArchivePdfSlice(ref, request.headers.get('range'), freshFetch);
      if (slice === null) return refuse('THAT PART OF THE BOOK CAN\'T BE READ HERE.', 416);
      return new Response(slice.body, {
        status: 206,
        headers: {
          ...NEVER_KEPT,
          'Content-Type': 'application/pdf',
          'Content-Range': `bytes ${slice.start}-${slice.end}/${slice.size}`,
          'Content-Length': String(slice.end - slice.start + 1),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (error) {
      if (error instanceof SafeFetchError) return refuse('THE INTERNET ARCHIVE DID NOT ANSWER.', 502);
      return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
    }
  }

  if (!booksPerAddress.allow(address)) return refuse('Too many books at once. Wait a minute.', 429);
  try {
    const opened = await openBookEpub(ref, freshFetch);
    if (opened === null) return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
    // An Internet Archive book with neither an EPUB nor a PDF: the reader shows the Archive's own viewer instead.
    if (opened === 'viewer') return answer({ error: 'NO EPUB', viewer: true }, 404);
    // One with a PDF: the reader asks for it a slice at a time (above).
    if ('pdf' in opened) return answer({ pdf: { size: opened.pdf.size } });
    const headers: Record<string, string> = { ...NEVER_KEPT, 'Content-Type': 'application/epub+zip', 'Content-Disposition': 'inline' };
    if (opened.length !== null) headers['Content-Length'] = String(opened.length);
    return new Response(opened.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof SafeFetchError) return refuse(ref.startsWith('internet_archive:') ? 'THE INTERNET ARCHIVE DID NOT ANSWER.' : 'PROJECT GUTENBERG DID NOT ANSWER.', 502);
    return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
  }
}
