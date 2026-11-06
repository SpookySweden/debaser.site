import { stationFacts, stationGraph } from '../../../lib/tag-station/graph-cache';
import { moreItems, spellingsOf } from '../../../lib/tag-station/pool-more';
import { getTagRepository } from '../../../lib/tag-station/repository';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { SIGNED_OUT_REFUSAL, webSignedIn } from '../../../lib/web/web-session';

/**
 * Swept items for a few words, from the pool's compressed files (SPEC-discover.md):
 *
 *   GET /api/tag-station/more?word=jazz&word=trains&seed=abc  ->  { items }
 *
 * Signed-in people only: the session first, before anything is read, and the reader's own token does the reading. Reads only. Never kept by Vercel's
 * edge, where a copy could reach the signed-out.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_WORDS = 12;
const MAX_WORD_LENGTH = 60;
const perAddress = makeRateLimiter(60, 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!(await webSignedIn(request))) return json({ error: SIGNED_OUT_REFUSAL }, 401);
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const params = new URL(request.url).searchParams;
  const words = params.getAll('word').filter((word) => word.length > 0 && word.length <= MAX_WORD_LENGTH).slice(0, MAX_WORDS);
  if (words.length === 0) return json({ items: [] }, 200);
  const seed = (params.get('seed') ?? '').slice(0, 40);
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  try {
    const repository = getTagRepository(token);
    const graph = await stationGraph(() => repository.rows(), Date.now(), () => repository.limitReached(), () => repository.wordFacts(), () => repository.pool());
    const rows = await repository.poolFiles(spellingsOf(words, graph), seed);
    return json({ items: moreItems(rows, stationFacts(), graph) }, 200);
  } catch {
    return json({ error: 'That could not be read. Try again in a minute.' }, 503);
  }
}
