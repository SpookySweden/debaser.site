import type { FetchLike } from '../safe-fetch';

/**
 * Live answers (SPEC-live-streams.md): what is on now changes by the minute, so a live search is kept in this server's
 * memory for one minute, not in the day-long fetch cache searches use (cached-fetch.ts). SERVER ONLY. Only a 200 answer
 * is kept, at most `MAX_KEPT` of them, the oldest dropped first. Twitch's token endpoint is never kept: a pass is asked
 * for afresh each time one is needed (twitch.ts keeps the pass itself).
 *
 * Nothing kept here leaves the server; a key that rides in an address (YouTube's fallback) stays in this memory only.
 */

export const LIVE_CACHE_MS = 60_000;
const MAX_KEPT = 300;
const NEVER_KEPT = ['id.twitch.tv'];

type Kept = { at: number; status: number; type: string | null; body: string };

/** A fetch that keeps live answers a minute. `base` and `now` are handed in by the checks. */
export function makeLiveFetch(base: FetchLike = (input, init) => fetch(input, init), now: () => number = Date.now): FetchLike {
  const kept = new Map<string, Kept>();
  const answer = (hit: Kept) => new Response(hit.body, { status: hit.status, headers: hit.type === null ? {} : { 'content-type': hit.type } });
  return async (input, init) => {
    let host = '';
    try {
      host = new URL(input).hostname;
    } catch {
      return base(input, init);
    }
    if (NEVER_KEPT.includes(host)) return base(input, init);
    const key = `${init?.method ?? 'GET'} ${input} ${typeof init?.body === 'string' ? init.body : ''}`;
    const hit = kept.get(key);
    if (hit !== undefined && now() - hit.at < LIVE_CACHE_MS) return answer(hit);
    const response = await base(input, init);
    if (response.status !== 200) return response;
    const fresh: Kept = { at: now(), status: 200, type: response.headers.get('content-type'), body: await response.text() };
    kept.delete(key);
    kept.set(key, fresh);
    while (kept.size > MAX_KEPT) {
      const oldest = kept.keys().next();
      if (oldest.done) break;
      kept.delete(oldest.value);
    }
    return answer(fresh);
  };
}

/** The one the routes use. */
export const liveFetch: FetchLike = makeLiveFetch();
