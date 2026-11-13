/**
 * ANNA'S ARCHIVE (Luke, 2026-11-13: "annahs archive as a specific search option under where from"): searches Anna's
 * Archive's HTML page for a book title, extracts each hit's md5 and title with one regex, and returns them as book
 * rows with externalId `shadow:<md5>`. The reader opens each as a shadow copy (shadow-books.ts).
 *
 * Reachability: Vercel's DNS refuses the real Anna's Archive hosts (annas-archive.org, annas-archive.se). The shadow
 * agent in shadow-books.ts uses a DoH-based lookup to try to work around this, and an insecure-TLS dispatcher for
 * mirrors whose cert expired. When no mirror is reachable, the provider answers with no items — the panel still lists
 * the source so the reader can pick it, as `SearchProblemError` would put a red line under the search box.
 */
import { ANNAS_HOSTS, extractAnnasMd5, searchAnnasMany, type AnnaHit } from '../../shadow-books';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

export const ANNA_SEARCH_HOSTS = ANNAS_HOSTS;

/** How many Anna's hits are returned on a page. Anna's search returns ~60; we cap at 20 to match BOOKS. */
export const ANNA_PAGE_SIZE = 20;

/** Anna's Archive hit as a MEDIA row. externalId uses the `shadow:` prefix so the reader opens it through the shadow route. */
function toAnnaItem(hit: AnnaHit, fetchedAt: string): WebItem {
  return {
    id: `anna:${hit.md5}`,
    platform: 'anna',
    externalId: `shadow:${hit.md5}`,
    kind: 'text',
    url: `https://${ANNAS_HOSTS[0]}/md5/${hit.md5}`,
    canonicalUrl: `https://${ANNAS_HOSTS[0]}/md5/${hit.md5}`,
    title: hit.title || 'ANNA\'S ARCHIVE BOOK',
    creator: hit.author || undefined,
    publishedAt: hit.year && /^\d{4}$/.test(hit.year)
      ? new Date(Date.UTC(Number(hit.year), 0, 1)).toISOString()
      : fetchedAt,
    fetchedAt,
  };
}

// Keep the regex extractor available to callers that already have the HTML.
void extractAnnasMd5;

export const annaSearch: SearchProvider = {
  platform: 'anna',
  allowedHosts: ANNA_SEARCH_HOSTS,
  timeoutMs: 20_000,
  sortedTimeoutMs: 20_000,
  orders: [],
  byAuthor: true,
  async search(words: string, _page: ProviderPage | null, deps: SearchDeps, author = '', kind?: SearchKind): Promise<SearchPage> {
    if (kind !== undefined && kind !== 'text') return { items: [], next: null };
    if (words.length === 0 && author.length === 0) return { items: [], next: null };
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    const query = author.length > 0 ? `${words} ${author}`.trim() : words;
    try {
      const hits = await searchAnnasMany(query, ANNA_PAGE_SIZE);
      const items = hits.map((hit) => toAnnaItem(hit, fetchedAt));
      return { items, next: null };
    } catch {
      // Any failure (DNS block, Cloudflare challenge, mirror down) is reported so the panel shows the problem line.
      throw new SearchProblemError('NO ANSWER');
    }
  },
  // Anna's Archive rows are never saved into the stream; a book opens through the shadow route when a reader clicks READ.
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
