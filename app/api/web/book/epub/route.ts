import { ipfsCid } from '../../../../lib/books/ipfs';
import { BOOK_REF, openArchivePdfSlice, openBookEpub } from '../../../../lib/web/books';
import { IPFS_PASS_MAX_BYTES, openIpfsBook } from '../../../../lib/web/ipfs-pass';
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
 *
 * `?ref=ipfs:<CID>` (Luke, 2026-11-11): a book on IPFS, asked for only when every gateway refused the reader's browser, passed
 * through as it streams and never kept, and only when its first bytes are an EPUB or a PDF (`lib/web/ipfs-pass.ts`).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const booksPerAddress = makeRateLimiter(20, 60_000);
/** A PDF is read in many small slices: a page of a scan can take several. */
const slicesPerAddress = makeRateLimiter(900, 60_000);
/** IPFS books through the server: a few a minute, enough for a reader, too few to make the route a free relay. */
const ipfsPerAddress = makeRateLimiter(6, 60_000);
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
  const address = clientAddress(request.headers);

  // Luke, 2026-11-14: a shadow copy (`shadow:<md5>`) is now sourced from the home proxy's cache.
  // When not yet cached, we POST /download to kick the Playwright worker and return 202 with the
  // proxy URLs so the reader can poll /status and fetch /file directly (cross-origin, both CORS'd).
  if (ref.startsWith('shadow:')) {
    const md5 = ref.slice('shadow:'.length).toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(md5)) return refuse('bad md5', 400);
    const proxyUrl = (process.env.SHADOW_PROXY_URL ?? '').trim().replace(/\/+$/, '');
    const proxyToken = (process.env.SHADOW_PROXY_TOKEN ?? '').trim();
    if (!proxyUrl || !proxyToken) return refuse('THE HOME SHADOW PROXY IS NOT CONFIGURED.', 503);
    try {
      const statusRes = await fetch(`${proxyUrl}/status/${md5}?token=${encodeURIComponent(proxyToken)}`, { cache: 'no-store' });
      const status = statusRes.ok ? ((await statusRes.json()) as { state?: string; progress?: number; note?: string; error?: string }) : null;
      if (status?.state === 'ready') {
        return answer({ ready: true, fileUrl: `${proxyUrl}/file/${md5}`, md5 }, 200);
      }
      // Not ready — queue it (idempotent on the proxy side).
      const queue = await fetch(`${proxyUrl}/download?token=${encodeURIComponent(proxyToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5 }),
        cache: 'no-store',
      });
      const queued = queue.ok ? ((await queue.json()) as { state?: string; progress?: number; note?: string; error?: string }) : null;
      return answer(
        {
          preparing: true,
          md5,
          state: queued?.state ?? status?.state ?? 'queued',
          progress: queued?.progress ?? status?.progress ?? 0,
          note: queued?.note ?? status?.note ?? 'waiting for the home proxy',
          statusUrl: `${proxyUrl}/status/${md5}`,
          fileUrl: `${proxyUrl}/file/${md5}`,
        },
        202,
      );
    } catch {
      return refuse('THE HOME SHADOW PROXY DID NOT ANSWER.', 502);
    }
  }

  const cid = ipfsCid(ref);
  if (cid !== null) {
    if (!ipfsPerAddress.allow(address)) return refuse('Too many books at once. Wait a minute.', 429);
    try {
      const passed = await openIpfsBook(cid, freshFetch);
      if (passed === 'missing') return refuse('NO COPY FOUND ON IPFS.', 404);
      if (passed === 'not-a-book') return refuse('THIS BOOK COULD NOT BE OPENED.', 415);
      if (passed === 'too-big') return refuse(`TOO BIG TO READ HERE. THE LIMIT IS ${IPFS_PASS_MAX_BYTES / (1024 * 1024)} MB.`, 413);
      if (passed === null) return refuse('SOURCE NOT ANSWERING. TRY AGAIN.', 502);
      // No Content-Length: a gateway's own is the compressed size when it compressed the book, and fetch hands on the
      // book unpacked, so it could be wrong. The stream ends when the book does.
      return new Response(passed.body, { status: 200, headers: { ...NEVER_KEPT, 'Content-Type': passed.type, 'Content-Disposition': 'inline' } });
    } catch {
      return refuse('SOURCE NOT ANSWERING. TRY AGAIN.', 502);
    }
  }

  if (!BOOK_REF.test(ref)) return refuse('Ask for a book.', 400);

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
    // A bare Open Library work (Luke, 2026-11-13): the reader is told where its copy is, and reopens at that ref.
    if ('redirect' in opened) return answer({ redirect: `/read/${opened.redirect}` });
    // A work with no copy at all: the reader shows a page with the title and a link to Open Library inside its frame.
    if ('noFreeCopy' in opened) {
      const debug = params.get('debug') === '1';
      // Temporary: `?debug=1` returns the shadow trace so Dune's failure mode on Vercel can be diagnosed.
      const { readLastShadowTrace } = await import('../../../../lib/web/shadow-books');
      const extra = debug ? { shadow: readLastShadowTrace() } : {};
      return answer({ noFreeCopy: opened.noFreeCopy, ...extra }, 404);
    }
    // One with a PDF: the reader asks for it a slice at a time (above).
    if ('pdf' in opened) return answer({ pdf: { size: opened.pdf.size } });
    // A shadow copy from LibGen (Luke, 2026-11-13): passed through from its mirror as it streams, never kept. The
    // extension decides the type; the reader opens an EPUB directly and a PDF the same way as an own-file PDF.
    const shadowExtension = 'shadow' in opened ? opened.shadow?.extension : undefined;
    const contentType =
      shadowExtension === 'pdf'
        ? 'application/pdf'
        : shadowExtension === 'epub'
          ? 'application/epub+zip'
          : 'application/epub+zip';
    const headers: Record<string, string> = { ...NEVER_KEPT, 'Content-Type': contentType, 'Content-Disposition': 'inline' };
    if (opened.length !== null) headers['Content-Length'] = String(opened.length);
    return new Response(opened.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof SafeFetchError) {
      const source = ref.startsWith('internet_archive:')
        ? 'THE INTERNET ARCHIVE'
        : ref.startsWith('shadow:')
          ? 'THE SHADOW MIRROR'
          : 'PROJECT GUTENBERG';
      // Temporary: the SafeFetchError's message (what actually went wrong — timeout, host blocked, HTTP code) is sent
      // back in the JSON so drive-shadow.cjs can tell libgen reachability from title-ranker misses. Remove once working.
      const detail = (error as Error).message || 'unknown';
      return new Response(JSON.stringify({ error: `${source} DID NOT ANSWER.`, detail }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    return refuse('THIS BOOK CAN\'T BE READ HERE.', 404);
  }
}
