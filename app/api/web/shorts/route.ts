import { askShorts } from '../../../lib/web/search/shorts-check';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';

/**
 * Which of these YouTube videos are Shorts (Luke, 2026-11-14: "i want them exluded from the results entirely"):
 *
 *   GET /api/web/shorts?ids=<id>,<id>,...   (up to 60 eleven-character video ids)
 *     -> { shorts: [the ids YouTube confirms are Shorts] }
 *
 * For the rows the browser reads itself (the saved stream, FOR YOU, the picks): a browser cannot ask YouTube's /shorts/
 * page (it answers no cross-origin reads), so it asks here, and this asks YouTube (shorts-check.ts). Only the ids travel;
 * nothing is stored but this server's memory of the answers. An id it could not be sure of is simply not in the list, so
 * that video stays. Open to visitors, as all of MEDIA is, and limited per address. The browser may keep an answer a day.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_IDS = 60;
const perAddress = makeRateLimiter(30, 60_000);

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) {
    return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
    .slice(0, MAX_IDS);
  if (ids.length === 0) return Response.json({ shorts: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const answers = await askShorts(ids);
  const shorts = ids.filter((id) => answers.get(id) === true);
  return Response.json({ shorts }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
}
