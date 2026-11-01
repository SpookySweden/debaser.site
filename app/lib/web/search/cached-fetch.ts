import type { FetchLike } from '../safe-fetch';

/**
 * Search answers are kept in Next's server-side fetch cache for a day (SPEC-web-search.md), so the same
 * search asked again costs no platform quota (YouTube allows about 100 searches a day). Only 200 answers are
 * stored. The cache lives on the server: nothing here reaches the browser.
 */
export const SEARCH_CACHE_SECONDS = 24 * 60 * 60;

export const cachedFetch: FetchLike = (input, init) =>
  fetch(input, { ...init, cache: 'force-cache', next: { revalidate: SEARCH_CACHE_SECONDS } });
