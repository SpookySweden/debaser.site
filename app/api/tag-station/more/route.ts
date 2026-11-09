import { sharedStationMap } from '../../../lib/tag-station/graph-shared';
import { moreItems, searchCandidates, searchTerms, spellingsOf } from '../../../lib/tag-station/pool-more';
import { getTagRepository } from '../../../lib/tag-station/repository';
import { wordKey } from '../../../lib/tag-station/words';
import { clientAddress, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { readerToken } from '../../../lib/web/web-session';

/**
 * One step of digging through the pool's compressed files (SPEC-discover.md): the items of a few words, of a MEDIA search's text, or whatever the files hold.
 *
 *   GET /api/tag-station/more?word=jazz&word=trains&seed=abc&from=6  ->  { items, next, files, tags }
 *   GET /api/tag-station/more?q=film+noir&from=6
 *   GET /api/tag-station/more?browse=1&seed=abc
 *
 * `next` is the `from` of the next step, null when the files have run out. `tags` are asked words the map doesn't show, and how many items each is on.
 *
 * Open to signed-out visitors too, like all of MEDIA since 2026-11-09 (web-session.ts). The reader's own token does the reading when signed in, the public key when not. Reads only. Never kept by Vercel's edge.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_WORDS = 12;
const MAX_WORD_LENGTH = 60;
const MAX_SEARCH_LENGTH = 200;
const NOTHING = { items: [], next: null, files: 0, tags: [] };
const perAddress = makeRateLimiter(60, 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!perAddress.allow(clientAddress(request.headers))) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const params = new URL(request.url).searchParams;
  const words = params.getAll('word').filter((word) => word.length > 0 && word.length <= MAX_WORD_LENGTH).slice(0, MAX_WORDS);
  const search = (params.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH);
  const browse = params.get('browse') === '1';
  if (words.length === 0 && search.trim().length === 0 && !browse) return json(NOTHING, 200);
  const seed = (params.get('seed') ?? '').slice(0, 40);
  const from = Math.max(0, Math.min(1_000_000, Math.floor(Number(params.get('from') ?? 0)) || 0));
  const token = await readerToken(request);
  try {
    const repository = getTagRepository(token);
    const { graph, facts } = await sharedStationMap(repository);
    if (words.length === 0 && !browse) {
      const { terms, inTitle } = searchTerms(search, new Set(await repository.poolWords(searchCandidates(search))));
      if (terms.length === 0) return json(NOTHING, 200);
      const step = await repository.poolFiles({ every: terms.map((term) => spellingsOf([term], facts, graph)), seed, from });
      const rows = step.rows.filter(({ item }) => inTitle.every((word) => item.title.toLowerCase().includes(word)));
      return json({ items: moreItems(rows, graph, terms), next: step.next, files: step.files, tags: [] }, 200);
    }
    const asked = words.map((word) => word.trim().toLowerCase());
    const step = await repository.poolFiles({ words: browse ? [] : spellingsOf(words, facts, graph), seed, from });
    const onMap = new Set(graph.tags.map((tag) => wordKey(tag.name)));
    const known = new Set(Object.keys(graph.aliases ?? {}));
    const tags = step.counted.filter(({ word }) => asked.includes(word) && !onMap.has(wordKey(word)) && !known.has(wordKey(word)));
    return json({ items: moreItems(step.rows, graph, asked), next: step.next, files: step.files, tags }, 200);
  } catch {
    return json({ error: 'That could not be read. Try again in a minute.' }, 503);
  }
}
