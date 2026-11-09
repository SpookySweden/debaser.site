import { sharedStationMap } from '../../../lib/tag-station/graph-shared';
import { getTagRepository } from '../../../lib/tag-station/repository';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { readerToken } from '../../../lib/web/web-session';

/**
 * TAG STATION's map (SPEC-tag-station.md):
 *
 *   GET /api/tag-station/graph  ->  { tags, items }
 *
 * Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts): MEDIA's DISCOVER and RECOMMENDED lists ask it. The reader's own token does the reading when signed in, the
 * public key when not (the tables are readable by visitors since that day's migration), and the built map is kept for every server to use (graph-shared.ts). Reads
 * only: nothing here writes to the database. Never kept by Vercel's edge.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const perAddress = makeRateLimiter(30, 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const token = await readerToken(request);
  try {
    const { graph } = await sharedStationMap(getTagRepository(token));
    return json(graph, 200);
  } catch {
    return json({ error: 'The map could not be built. Try again in a minute.' }, 503);
  }
}
