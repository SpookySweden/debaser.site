import type { WebItem, WebPlatform } from './types';

/**
 * The /web search's SORT row (SPEC-web-sort.md; Luke, 2026-11-02: "ways to sort the results ... and a reversable
 * option"). Pure and client-safe: the page, the route and `scripts/check-web-sort.cjs` all read it.
 *
 * - BEST MATCH (the default since Luke's ask, 2026-11-03): each site's own best match, the sites taking turns.
 * - POPULAR: each site's own popularity order (KINO: TMDB's rating), the sites taking turns, so no site's numbers are
 *   ever compared with another's. A site with no popularity order is not asked, and says so.
 * - DATE: one true date order across every site, newest first or (the flip key) oldest first.
 *
 * Counts and ratings decide order on the server only: nothing here, or anywhere in the browser, ever holds one.
 */

export type WebSort = 'best' | 'popular' | 'date';
export type SortDir = 'desc' | 'asc';
export type SortChoice = { sort: WebSort; dir: SortDir };

/** The order a search opens in, and the one an address without `sort` means (Luke, 2026-11-03: best match first). */
export const DEFAULT_SORT: SortChoice = { sort: 'best', dir: 'desc' };

export const SORT_OPTIONS: readonly { value: WebSort; label: string }[] = [
  { value: 'best', label: 'BEST MATCH' },
  { value: 'popular', label: 'POPULAR' },
  { value: 'date', label: 'DATE' },
];

/**
 * The ORDER keys in the filter panel (Luke, 2026-11-13: "much clearer"): DATE's two directions are two plain keys,
 * NEWEST FIRST and OLDEST FIRST, in place of DATE and a flip arrow. The same three orders underneath.
 */
export const ORDER_KEYS: readonly { choice: SortChoice; label: string }[] = [
  { choice: { sort: 'best', dir: 'desc' }, label: 'BEST MATCH' },
  { choice: { sort: 'popular', dir: 'desc' }, label: 'POPULAR' },
  { choice: { sort: 'date', dir: 'desc' }, label: 'NEWEST FIRST' },
  { choice: { sort: 'date', dir: 'asc' }, label: 'OLDEST FIRST' },
];

/** Which ORDER key a choice is. */
export function orderLabel(choice: SortChoice): string {
  return ORDER_KEYS.find((key) => key.choice.sort === choice.sort && key.choice.dir === choice.dir)?.label ?? ORDER_KEYS[0].label;
}

/** The order a search asks each source for (search/types.ts `SearchOrder`). */
export function searchOrder(choice: SortChoice): 'relevance' | 'popular' | 'newest' | 'oldest' {
  if (choice.sort === 'best') return 'relevance';
  if (choice.sort === 'popular') return 'popular';
  return choice.dir === 'asc' ? 'oldest' : 'newest';
}

/** Who a search asks: the saved stream, or a live source. */
export type SortSource = 'stream' | WebPlatform;

/**
 * The sources that cannot give POPULAR (Luke: Commons and Openverse have no such order; the saved stream keeps no
 * counts). Kept equal to the providers' own `orders` by `scripts/check-web-sort.cjs`. Every source can give DATE.
 */
export const NO_POPULAR: readonly SortSource[] = ['wikimedia_commons', 'openverse', 'books', 'audiobooks', 'stream'];

/** Whether a source is asked under a sort; one that is not shows one plain line instead. */
export function canSort(source: SortSource, choice: SortChoice): boolean {
  return choice.sort !== 'popular' || !NO_POPULAR.includes(source);
}

/** Read from the address (`?sort=popular`, `?sort=date&dir=asc`); anything unknown is the default. */
export function readSort(sort: string | null | undefined, dir: string | null | undefined): SortChoice {
  const value = SORT_OPTIONS.find((option) => option.value === sort?.trim().toLowerCase())?.value;
  if (value === undefined) return DEFAULT_SORT;
  return { sort: value, dir: value === 'date' && dir?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc' };
}

/** Date order: newest first (`desc`) or oldest first, ties by id the same way. */
export function compareByDate(dir: SortDir): (a: Pick<WebItem, 'publishedAt' | 'id'>, b: Pick<WebItem, 'publishedAt' | 'id'>) => number {
  return (a, b) => {
    const by = a.publishedAt === b.publishedAt ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.publishedAt < b.publishedAt ? 1 : -1;
    return dir === 'desc' ? by : -by;
  };
}

/** Several sources' lists, one from each in turn, each in its own order (BEST MATCH and POPULAR). Pure. */
export function takeTurns<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) if (index < list.length) out.push(list[index]);
  }
  return out;
}
