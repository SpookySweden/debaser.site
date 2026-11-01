import { looksLikeLink } from '../../../lib/web/link-shape';
import { compareItems } from '../../../lib/web/paging';
import { authorWords, searchText } from '../../../lib/web/search';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { SEARCH_PROVIDERS } from '../../../lib/web/search/index';
import { parseLink, resolveLink } from '../../../lib/web/search/link';
import { peertubeHosts } from '../../../lib/web/search/peertube-index';
import { clientAddress, makeDailyBudgets, makeRateLimiter } from '../../../lib/web/search/rate-limit';
import { searchEverywhere } from '../../../lib/web/search/run';
import { SEARCH_KINDS } from '../../../lib/web/search/types';
import { PLATFORM_LABELS } from '../../../lib/web/types';
import { SIGNED_OUT_REFUSAL, webSignedIn } from '../../../lib/web/web-session';
import { wildcardSearch } from '../../../lib/web/wildcard-search';

/**
 * WEB search everywhere (SPEC-web-search.md):
 *
 *   GET /api/web/search?q=<words>[&from=<a creator>][&provider=<one platform>][&cursor=<from the last answer>]
 *     -> { items, statuses: [{ platform, label, problem }], nextCursor }
 *
 * The page asks each provider on its own (`provider=youtube`, ...), all at once, so each one's results show
 * the moment they arrive instead of waiting for the slowest. Without `provider` every provider is asked.
 *   GET /api/web/search?q=<a pasted address>
 *     -> { items: [the one item] or [], statuses: [], nextCursor: null, link: 'found' | 'unknown' | 'not-found' | 'no-answer' }
 *
 * Asks every provider at once (lib/web/search/run.ts), each through `safe-fetch` with its own time limit, and
 * answers one list, newest first, with one plain problem per provider that failed. Only the words of the
 * search go anywhere (`searchText`: letters and digits, at most 8 words). Platform answers are cached on the
 * server for a day. Limited per address. A pasted address is never fetched: lib/web/search/link.ts reads the
 * platform and id out of it and asks the platform's own API about that id. The YouTube key is read here, on the server, and is never part
 * of an answer: the provider only ever reports "NOT SET UP" or another fixed phrase.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The slowest provider waits 20s; nothing here outlives that by much. */
export const maxDuration = 30;

/** Longer than any search needs, so a pasted link fits; the words of a search are cut to 100 anyway. */
const MAX_Q_LENGTH = 600;
const LINK_TIMEOUT_MS = 15_000;
// One search is one request per provider (five), so 60 a minute is twelve searches; the platforms' own
// quotas are guarded by the daily budgets below, not by this.
const perAddress = makeRateLimiter(60, 60_000);
const perInstance = makeRateLimiter(600, 60_000);
const dailyBudgets = makeDailyBudgets(SEARCH_PROVIDERS);

function json(body: Record<string, unknown>, status: number, cacheable = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Never kept by Vercel's edge: an answer is for a signed-in reader, and a shared copy would reach the
      // signed-out (SPEC-media-servers.md). The reader's own browser may keep a complete one for a few minutes;
      // the platforms' answers are still cached on the server for a day (cached-fetch.ts).
      'Cache-Control': cacheable ? 'private, max-age=300' : 'no-store',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  // Signed-in people only (SPEC-media-servers.md decision 4): the session first, before anything is read.
  if (!(await webSignedIn(request))) return json({ error: SIGNED_OUT_REFUSAL }, 401);
  const address = clientAddress(request.headers);
  if (!perAddress.allow(address) || !perInstance.allow('all')) {
    return json({ error: 'Too many searches. Wait a minute and try again.' }, 429);
  }

  const params = new URL(request.url).searchParams;
  const q = params.get('q') ?? '';
  const cursor = params.get('cursor');
  const only = params.get('provider');
  const providers = only === null ? SEARCH_PROVIDERS : SEARCH_PROVIDERS.filter((provider) => provider.platform === only);
  if (providers.length === 0) return json({ error: 'There is no such source.' }, 400);
  if (q.length > MAX_Q_LENGTH || (cursor !== null && cursor.length > 1500)) {
    return json({ error: 'That search is too long.' }, 400);
  }
  const deps = { fetch: cachedFetch, env: { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY } };

  if (looksLikeLink(q)) {
    const hosts = await peertubeHosts(cachedFetch);
    const link = parseLink(q, hosts);
    if (link === null) return json({ items: [], statuses: [], nextCursor: null, link: 'unknown' }, 200, true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const item = await Promise.race([
        resolveLink(link, { ...deps, peertubeHosts: hosts }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('slow')), LINK_TIMEOUT_MS);
        }),
      ]);
      return item === null
        ? json({ items: [], statuses: [], nextCursor: null, link: 'not-found' }, 200)
        : json({ items: [item], statuses: [], nextCursor: null, link: 'found' }, 200, true);
    } catch {
      // A failure says only that the platform did not answer; nothing of the error is passed on.
      return json({ items: [], statuses: [], nextCursor: null, link: 'no-answer' }, 200);
    } finally {
      clearTimeout(timer);
    }
  }

  // `from=<a creator>`: only that creator's items (search.ts `authorWords`; one creator per search everywhere).
  const author = authorWords(params.get('from'));
  const words = searchText(q);
  if (words === null && author === null) return json({ error: 'Type a word to search for.' }, 400);

  // `type=<video|audio|image|text>`: a provider that can ask its platform for one kind does; anything else is no filter.
  const type = params.get('type');
  const kind = SEARCH_KINDS.find((value) => value === type);
  // Media servers with no list file (`listPath: '*'`): TMDB's films and shows for the words, one row each with a
  // button per such server (wildcard-search.ts). Only on a first page of plain words, video or any kind, and only
  // with the first provider's answer: the page asks each provider on its own, so this goes out once per search.
  const withWildcard = words !== null && cursor === null && author === null && (kind === undefined || kind === 'video') && providers.includes(SEARCH_PROVIDERS[0]);
  const everywhere = searchEverywhere(words ?? '', cursor, providers, { ...deps, spendBudget: dailyBudgets(address) }, author, kind);
  const [result, wildcard] = await Promise.all([
    everywhere,
    withWildcard ? wildcardSearch(words, { fetch: cachedFetch, token: process.env.TMDB_READ_TOKEN }) : Promise.resolve([]),
  ]);
  const statuses = result.statuses.map((status) => ({ ...status, label: PLATFORM_LABELS[status.platform] }));
  const complete = statuses.every((status) => status.problem === null);
  return json({ items: [...result.items, ...wildcard].sort(compareItems), statuses, nextCursor: result.nextCursor }, 200, complete);
}
