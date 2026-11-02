/**
 * Search everywhere: the whole Internet Archive, through the same keyless Advanced Search API as the stream's
 * adapter (`../../adapters/internet-archive.ts`), whose `toWebItem` turns each document into an item: the same
 * fields, the same skipping of access-restricted items, the same addresses built from the identifier.
 *
 * The words are matched against titles, all of them required (`title:(a AND b)`), and only media the
 * Archive can show (movies, audio, texts, images, concerts). Live-checked 2026-10-31: a whole-text search
 * for "night of the living dead" returned sermons first; the title search returned the film and its copies.
 * Restricted items are left out by the query as well as skipped by `toWebItem`. The platform's own
 * ranking picks each page, unless an order is asked (SPEC-web-sort.md, live-checked 2026-11-02): POPULAR is
 * the Archive's `downloads desc` (the count decides the order and is never read), DATE its `publicdate`, the
 * date every Archive item is shown with, so the order and the dates agree.
 */
import { IA_FIELDS, toWebItem } from '../../adapters/internet-archive';
import { safeFetchJson } from '../../safe-fetch';
import { splitYear } from '../../search-intent';
import { buildUrl, isSafeIdentifier } from '../../urls';
import type { WebItem } from '../../types';
import type { ProviderPage, SearchDeps, SearchKind, SearchOrder, SearchPage, SearchProvider } from '../types';

const HOST = 'archive.org';
export const IA_SEARCH_HOSTS = [HOST] as const;
export const IA_SEARCH_ROWS = 20;
/** The Archive's search took 6-10s on 2026-10-31 (the stream's 10s wait failed some), so a search waits 15s. */
export const IA_SEARCH_TIMEOUT_MS = 15_000;
/** The Archive serves deep pages slowly; nobody pages this far through one search. */
const MAX_PAGE = 50;
const MEDIA = 'mediatype:(movies OR audio OR texts OR image OR etree) AND NOT access-restricted-item:true';
/** A `type:` filter as the Archive's own mediatypes, so a search for audio gets audio, not 20 videos the page drops. */
const KIND_MEDIA: Record<SearchKind, string> = {
  video: 'mediatype:(movies) AND NOT access-restricted-item:true',
  audio: 'mediatype:(audio OR etree) AND NOT access-restricted-item:true',
  image: 'mediatype:(image) AND NOT access-restricted-item:true',
  text: 'mediatype:(texts) AND NOT access-restricted-item:true',
};

/**
 * `words` and `author` are letters and digits only (`searchText`, `authorWords`), so nothing in them is
 * Lucene syntax. Either may be empty, not both.
 */
export function iaSearchQuery(words: string, author = '', kind?: SearchKind, how: { vibe?: boolean; now?: Date } = {}): string {
  const all = (field: string, text: string) => (text === '' ? [] : [`${field}:(${text.split(' ').join(' AND ')})`]);
  const any = (text: string) => text.split(' ').join(' OR ');
  let match = all('title', words);
  if (words !== '' && how.vibe) {
    // VIBE (search-intent.ts): any of the words, in the Archive's subject tags, description or title.
    match = [`(subject:(${any(words)}) OR description:(${any(words)}) OR title:(${any(words)}))`];
  } else if (words !== '') {
    // A year (search-intent.ts `splitYear`): the title with the number in it, or the other words made that year.
    const { words: rest, year } = splitYear(words, how.now);
    if (year !== null) match = [`(${all('title', words)[0]} OR (${all('title', rest)[0]} AND year:${year}))`];
  }
  return [...match, ...all('creator', author), kind === undefined ? MEDIA : KIND_MEDIA[kind]].join(' AND ');
}

/** The Archive's own sort for an order; best match sends none. */
const IA_SORTS: Record<SearchOrder, string | null> = { relevance: null, popular: 'downloads desc', newest: 'publicdate desc', oldest: 'publicdate asc' };

export function iaSearchUrl(query: string, page: number, order: SearchOrder = 'relevance'): string {
  const sort = IA_SORTS[order];
  return buildUrl(HOST, ['advancedsearch.php'], [
    ['q', query],
    ...IA_FIELDS.map((field) => ['fl[]', field] as const),
    ...(sort === null ? [] : [['sort[]', sort] as const]),
    ['rows', String(IA_SEARCH_ROWS)],
    ['page', String(page)],
    ['output', 'json'],
  ]);
}

function pageNumber(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** The items and the next page out of an Advanced Search answer; a thrown error when the shape is wrong. */
export function parseIaSearch(body: unknown, page: number, fetchedAt: string): SearchPage {
  const response = (body as { response?: { docs?: unknown; numFound?: unknown } } | null)?.response;
  if (!response || !Array.isArray(response.docs)) throw new Error('unexpected response shape');
  const items: WebItem[] = [];
  for (const doc of response.docs) {
    const item = toWebItem(doc, fetchedAt);
    if (item && !items.some((seen) => seen.id === item.id)) items.push(item);
  }
  const found = typeof response.numFound === 'number' ? response.numFound : 0;
  return { items, next: found > page * IA_SEARCH_ROWS && page < MAX_PAGE ? page + 1 : null };
}

export const internetArchiveSearch: SearchProvider = {
  platform: 'internet_archive',
  allowedHosts: IA_SEARCH_HOSTS,
  timeoutMs: IA_SEARCH_TIMEOUT_MS,
  orders: ['popular', 'newest', 'oldest'],
  byAuthor: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, author?: string, kind?: SearchKind): Promise<SearchPage> {
    const at = pageNumber(page);
    const body = await safeFetchJson(iaSearchUrl(iaSearchQuery(words, author, kind, { vibe: deps.vibe, now: deps.now?.() }), at, deps.order), { allowedHosts: IA_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: IA_SEARCH_TIMEOUT_MS });
    return parseIaSearch(body, at, (deps.now?.() ?? new Date()).toISOString());
  },
  async fetchOne(externalId: string, deps: SearchDeps): Promise<WebItem | null> {
    if (!isSafeIdentifier(externalId)) return null;
    const body = await safeFetchJson(iaSearchUrl(`identifier:"${externalId}"`, 1), { allowedHosts: IA_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: IA_SEARCH_TIMEOUT_MS });
    const { items } = parseIaSearch(body, 1, (deps.now?.() ?? new Date()).toISOString());
    return items.find((item) => item.externalId === externalId) ?? null;
  },
};
