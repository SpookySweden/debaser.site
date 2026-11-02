/**
 * Search everywhere: Openverse, through the same keyless anonymous API as the stream's adapter
 * (`../../adapters/openverse.ts`), whose `toWebItem` turns each result into an item: the same addresses
 * built from the id, the same skipping of sensitive works, a link and never an embed.
 *
 * Images only: one request a search, because every Openverse request WEB makes - the stream's sources and
 * these searches - shares one anonymous budget of 200 a day (and 20 a minute). Repeats cost nothing (the
 * day-long fetch cache); a 429 shows as "OPENVERSE: DAILY LIMIT REACHED". A search waits 8s; one item for
 * the ingest waits 20s like the stream's reads: the API was slow all week.
 *
 * DATE (SPEC-web-sort.md) is the API's `unstable__sort_by=indexed_on` with `unstable__sort_dir`: found in its own
 * published description (api.openverse.org/v1/schema/) on 2026-11-02, while the API itself timed out. `indexed_on`
 * is the date every Openverse item is shown with, so the order and the dates agree. The names say "unstable": if
 * an answer ever comes back out of date order, the page says "OPENVERSE: CAN'T SORT BY DATE" instead of showing it.
 * No popularity order exists, so POPULAR never asks Openverse (Luke).
 */
import { OV_FETCH_TIMEOUT_MS, OV_PAGE_SIZE, toWebItem } from '../../adapters/openverse';
import { SafeFetchError, safeFetchJson } from '../../safe-fetch';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchOrder, type SearchPage, type SearchProvider } from '../types';

const API_HOST = 'api.openverse.org';
export const OV_SEARCH_HOSTS = [API_HOST] as const;
/**
 * A live search waits 8s, not the stream's 20s (Luke, 2026-10-31): Openverse rarely answered in time this
 * week, and a reader should not watch a "still asking" line for 20s. fetchOne (the hourly ingest) keeps 20s.
 */
export const OV_SEARCH_TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Anonymous use sees at most 240 results; five pages is plenty and spends the shared budget slowly. */
const MAX_PAGE = 5;

/** `author`: a `from:` creator for the API's own `creator` filter; `words` may then be empty and is left out. */
export function ovSearchUrl(words: string, page: number, author = '', order: SearchOrder = 'relevance'): string {
  const dated = order === 'newest' || order === 'oldest';
  // The trailing '' gives the API's own trailing slash, which saves a redirect.
  return buildUrl(API_HOST, ['v1', 'images', ''], [
    ...(words === '' ? [] : [['q', words] as const]),
    ...(author === '' ? [] : [['creator', author] as const]),
    ['page_size', String(OV_PAGE_SIZE)],
    ['page', String(page)],
    ['mature', 'false'],
    ...(dated ? ([['unstable__sort_by', 'indexed_on'], ['unstable__sort_dir', order === 'newest' ? 'desc' : 'asc']] as const) : []),
  ]);
}

/** A dated answer whose items are not in the order asked: the sort is not honoured, so nothing of it is shown. */
export function inDateOrder(items: readonly WebItem[], order: SearchOrder): boolean {
  if (order !== 'newest' && order !== 'oldest') return true;
  return items.every((item, index) => index === 0 || (order === 'newest' ? items[index - 1].publishedAt >= item.publishedAt : items[index - 1].publishedAt <= item.publishedAt));
}

export function ovItemUrl(id: string): string {
  return buildUrl(API_HOST, ['v1', 'images', id, '']);
}

function pageNumber(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** The items and the next page out of a search answer; a thrown error when the shape is wrong. */
export function parseOvSearch(body: unknown, page: number, fetchedAt: string): SearchPage {
  const root = body as { results?: unknown; page_count?: unknown } | null;
  if (!root || !Array.isArray(root.results)) throw new Error('unexpected response shape');
  const items: WebItem[] = [];
  for (const doc of root.results) {
    const item = toWebItem(doc, 'image', fetchedAt);
    if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
  }
  const pages = typeof root.page_count === 'number' ? root.page_count : 0;
  return { items, next: pages > page && page < MAX_PAGE ? page + 1 : null };
}

export const openverseSearch: SearchProvider = {
  platform: 'openverse',
  allowedHosts: OV_SEARCH_HOSTS,
  timeoutMs: OV_SEARCH_TIMEOUT_MS,
  orders: ['newest', 'oldest'],
  // 200 anonymous requests a day, shared with the stream's Openverse sources.
  dailyBudget: { perAddress: 20, perInstance: 120 },
  byAuthor: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, author?: string): Promise<SearchPage> {
    const at = pageNumber(page);
    const body = await safeFetchJson(ovSearchUrl(words, at, author, deps.order), { allowedHosts: OV_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: OV_SEARCH_TIMEOUT_MS });
    const found = parseOvSearch(body, at, (deps.now?.() ?? new Date()).toISOString());
    if (!inDateOrder(found.items, deps.order ?? 'relevance')) throw new SearchProblemError("CAN'T SORT BY DATE");
    return found;
  },
  async fetchOne(externalId: string, deps: SearchDeps): Promise<WebItem | null> {
    if (!UUID.test(externalId)) return null;
    let body: unknown;
    try {
      body = await safeFetchJson(ovItemUrl(externalId), { allowedHosts: OV_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: OV_FETCH_TIMEOUT_MS });
    } catch (error) {
      // Gone from Openverse: nothing to save. Any other failure is tried again next run.
      if (error instanceof SafeFetchError && error.status === 404) return null;
      throw error;
    }
    const item = toWebItem(body, 'image', (deps.now?.() ?? new Date()).toISOString());
    return item && item.externalId === externalId ? item : null;
  },
};
