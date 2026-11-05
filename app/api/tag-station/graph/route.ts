import { stationGraph } from '../../../lib/tag-station/graph-cache';
import { getTagRepository } from '../../../lib/tag-station/repository';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { SIGNED_OUT_REFUSAL, webSignedIn } from '../../../lib/web/web-session';

/**
 * TAG STATION's map (SPEC-tag-station.md):
 *
 *   GET /api/tag-station/graph  ->  { tags, items }
 *
 * Signed-in people only: the session first, before anything is read. `web_item_tags` can only be read with a session, so the
 * reader's own token does the reading, and the built map is kept in the server's memory for an hour (graph-cache.ts). Reads
 * only: nothing here writes to the database. Never kept by Vercel's edge, where a copy could reach the signed-out.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const perAddress = makeRateLimiter(30, 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!(await webSignedIn(request))) return json({ error: SIGNED_OUT_REFUSAL }, 401);
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  try {
    const repository = getTagRepository(token);
    const graph = await stationGraph(() => repository.rows(), Date.now(), () => repository.limitReached());
    return json(graph, 200);
  } catch {
    return json({ error: 'The map could not be built. Try again in a minute.' }, 503);
  }
}
