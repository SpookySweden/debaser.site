import { appendPiece, bearer, dropUpload, finishUpload, IS_MOCK, isAdminToken } from '../../../lib/comic/server';
import { PAGE_MAX_BYTES, PAGE_TYPES, UPLOAD_CHUNK_BYTES } from '../../../lib/comic/rules';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';

/**
 * POST /api/comic/upload: one piece of a comic page, from Luke's studio (SPEC-comic.md, "Page files").
 *
 * A page goes up in pieces of UPLOAD_CHUNK_BYTES (Cloudflare refuses a request over 100 MB, and Luke's pages are bigger than
 * 30 MB), in order, each a raw body with these headers:
 *   x-comic-upload  a fresh id for this upload        x-comic-page     the page's id
 *   x-comic-version the page's file version            x-comic-type     the file's type (PNG, JPEG, WEBP or TIFF)
 *   x-comic-size    the whole file's bytes             x-comic-index / x-comic-count   which piece of how many
 * The last piece answers `{ ok, page }`: the copies made, the panels guessed, the files stored. The browser then files the
 * page's row itself, under the same session (the database's policies check it).
 *
 * Who may: the house account only, checked from the session token before the body is read (`is_admin()` decides). On the
 * mock store (a local dev server with no database) there is no session to check, as with the avatar route's mock path, and
 * the files land in `.comic-mock/` on this computer.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const piecesPerAddress = makeRateLimiter(600, 60_000);
const ID = /^[A-Za-z0-9-]{8,64}$/;

function answer(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function whole(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,12}$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
}

export async function POST(request: Request): Promise<Response> {
  if (!piecesPerAddress.allow(clientAddress(request.headers))) return answer({ error: 'TOO MANY PIECES AT ONCE: WAIT A MINUTE.' }, 429);
  if (IS_MOCK && process.env.NODE_ENV === 'production') return answer({ error: 'ONLY THE HOUSE ACCOUNT CAN ADD PAGES.' }, 403);
  if (!IS_MOCK && !(await isAdminToken(bearer(request)))) return answer({ error: 'ONLY THE HOUSE ACCOUNT CAN ADD PAGES.' }, 403);

  const uploadId = request.headers.get('x-comic-upload') ?? '';
  const pageId = request.headers.get('x-comic-page') ?? '';
  const type = request.headers.get('x-comic-type') ?? '';
  const version = whole(request.headers.get('x-comic-version'), 100000);
  const size = whole(request.headers.get('x-comic-size'), PAGE_MAX_BYTES);
  const count = whole(request.headers.get('x-comic-count'), Math.ceil(PAGE_MAX_BYTES / UPLOAD_CHUNK_BYTES));
  const index = whole(request.headers.get('x-comic-index'), 100000);

  if (!ID.test(uploadId) || !ID.test(pageId)) return answer({ error: 'THAT UPLOAD IS MISSING ITS IDS.' }, 400);
  if (PAGE_TYPES[type] === undefined) return answer({ error: 'THAT FILE TYPE CAN\'T BE A PAGE: USE PNG, JPEG, WEBP OR TIFF.' }, 415);
  if (size === null) return answer({ error: 'THAT PAGE IS OVER 500 MB.' }, 413);
  if (version === null || version < 1 || count === null || index === null || index >= count) {
    return answer({ error: 'THAT UPLOAD\'S PIECES DON\'T ADD UP.' }, 400);
  }
  if (count !== Math.max(1, Math.ceil(size / UPLOAD_CHUNK_BYTES))) return answer({ error: 'THAT UPLOAD\'S PIECES DON\'T ADD UP.' }, 400);

  const piece = new Uint8Array(await request.arrayBuffer());
  const last = index === count - 1;
  const expected = last ? size - index * UPLOAD_CHUNK_BYTES : UPLOAD_CHUNK_BYTES;
  if (piece.byteLength !== expected) {
    await dropUpload(uploadId);
    return answer({ error: 'A PIECE OF THAT PAGE ARRIVED THE WRONG SIZE: TRY IT AGAIN.' }, 400);
  }

  try {
    const held = await appendPiece(uploadId, index, UPLOAD_CHUNK_BYTES, piece);
    if (!last) return answer({ ok: true, held }, 200);
    const page = await finishUpload({ uploadId, pageId, version, type, token: bearer(request) });
    return answer({ ok: true, page }, 200);
  } catch (caught) {
    await dropUpload(uploadId);
    const message = caught instanceof Error && /^[A-Z0-9 ,.:'!?-]+$/.test(caught.message) ? caught.message : 'THAT PAGE COULD NOT BE READ OR STORED.';
    return answer({ error: message }, 400);
  }
}
