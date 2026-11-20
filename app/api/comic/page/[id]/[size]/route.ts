import { bearer, clientFor, IS_MOCK, mockRead } from '../../../../../lib/comic/server';
import { storagePaths } from '../../../../../lib/comic/rules';

/**
 * GET /api/comic/page/<pageId>/<reading|zoom>?v=<version>: a comic page's reading or zoom copy (SPEC-comic.md, "Serving").
 * Readers never get a storage address, and never Luke's original.
 *
 *   - A visitor (no token) gets the copy only once the page is released: the route asks the database as a visitor, so Row
 *     Level Security decides, and the bucket's own policy says the same. A released copy never changes (a replaced page has a
 *     new version), so it is answered `immutable` for a year and Cloudflare carries most of the load, not the PC.
 *   - The house account previews unreleased pages by sending its session token (the reader fetches those itself):
 *     answered `private, no-store`, never cached anywhere.
 *   - Anything else, and anything unreleased, is a plain 404, the same as a page that doesn't exist.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9-]{8,64}$/;

function missing(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

type PageRow = { reading_path: string | null; zoom_path: string | null; version: number; released_at: string | null };

export async function GET(request: Request, { params }: { params: Promise<{ id: string; size: string }> }): Promise<Response> {
  const { id, size } = await params;
  if (!ID.test(id) || (size !== 'reading' && size !== 'zoom')) return missing();
  const asked = Number(new URL(request.url).searchParams.get('v') ?? '0');
  const token = bearer(request);

  if (IS_MOCK) {
    if (process.env.NODE_ENV === 'production') return missing();
    if (!Number.isInteger(asked) || asked < 1) return missing();
    const paths = storagePaths(id, asked, 'jpg');
    const data = await mockRead(size === 'reading' ? paths.reading : paths.zoom);
    if (data === null) return missing();
    return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
  }

  const client = clientFor(token);
  const { data, error } = await client.from('comic_pages').select('reading_path, zoom_path, version, released_at').eq('id', id).maybeSingle();
  const row = data as PageRow | null;
  if (error || row === null) return missing();
  const where = size === 'reading' ? row.reading_path : row.zoom_path;
  if (where === null) return missing();

  const file = await client.storage.from('comic').download(where);
  if (file.error || !file.data) return missing();

  const released = row.released_at !== null;
  const cache =
    released && token === null && asked === row.version ? 'public, max-age=31536000, immutable' : released && token === null ? 'public, max-age=60' : 'private, no-store';
  return new Response(file.data.stream(), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
  });
}
