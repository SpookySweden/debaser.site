/**
 * BOOKS (SPEC-books.md, Luke 2026-11-10): Open Library's search API (openlibrary.org/search.json, keyless, JSON), asked only
 * when BOOKS is the SOURCE. Only works with a Project Gutenberg copy are asked for (`id_project_gutenberg:*` added to the
 * query; Luke, 2026-11-11: "make sure that any books searched for are opened within the sites own ereader"), so every row
 * opens in the site's own reader at /read (SPEC-reader.md). Open Library's borrowable books are in copyright and lent by
 * Open Library alone, so they may not be copied into the reader, and BOOKS leaves them out rather than link away. Asked
 * for: key, title, author names, first publication year, cover number, ebook access and Gutenberg numbers; no counts or
 * ratings exist in the request.
 *
 * And the Internet Archive's library scans (Luke, 2026-11-11: "currently only two books show when searching by the books
 * filter"): public-domain books scanned by libraries (`LIBRARY_COLLECTIONS`: the American and Toronto libraries, the
 * California Digital Library, the Library of Congress, Europe's libraries, the Universal Library), texts only, never a
 * lending-library item. The site's reader opens each (its EPUB, else its PDF a slice at a time). They come after the
 * Gutenberg works, as INTERNET ARCHIVE rows (`internet_archive:<identifier>`, the Archive's own adapter's items), asked
 * at the same time; one source failing leaves the other's rows. The Archive's own Gutenberg mirror is left out: those
 * books are Open Library's Gutenberg rows already.
 *
 * Checked live 2026-11-10: `sort=new` and `sort=old` order by first publication, which is the date shown; there is no
 * popularity order asked for (Luke: counts decide order only, and Open Library's isn't needed). Anna's Archive and every
 * other copy of a book made without its rights holders' leave are not sources (SPEC-books.md).
 *
 * Addresses: page https://openlibrary.org/works/OL…W, cover https://covers.openlibrary.org/b/id/{n}-M.jpg. An item's
 * external id is the work's key, with `-pg{n}` when Project Gutenberg has it: `OL85892W-pg345`.
 */
import { findIpfsBooks, type IpfsBook } from '../../../books/ipfs-catalogue';
import { gatewayUrl, IPFS_GATEWAYS } from '../../../books/ipfs';
import { safeFetchJson } from '../../safe-fetch';
import { iaSearchQuery, iaSearchUrl, IA_SEARCH_HOSTS, IA_SEARCH_TIMEOUT_MS, parseIaSearch } from './internet-archive';
import { sanitiseText } from '../../sanitise';
import { buildUrl } from '../../urls';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

const API_HOST = 'openlibrary.org';
const COVER_HOST = 'covers.openlibrary.org';
export const BOOKS_SEARCH_HOSTS = [API_HOST] as const;
/** The Archive's collections of library-scanned books (public domain, free to read), BOOKS's second source. */
export const LIBRARY_COLLECTIONS = ['americana', 'toronto', 'cdl', 'library_of_congress', 'europeanlibraries', 'universallibrary'] as const;

/** The Archive search for BOOKS: the words in the title, the author as creator, library-scanned texts only. */
export function libraryScanQuery(words: string, author = ''): string {
  return `${iaSearchQuery(words, author, 'text')} AND collection:(${LIBRARY_COLLECTIONS.join(' OR ')})`;
}
export const BOOKS_PAGE_SIZE = 20;
const MAX_PAGE = 25;
const WORK_KEY = /^\/works\/(OL[1-9][0-9]{0,11}W)$/;
const PG_NUMBER = /^[1-9][0-9]{0,6}$/;
const BOOK_ID = /^(OL[1-9][0-9]{0,11}W)(?:-pg([1-9][0-9]{0,6}))?$/;
const FIELDS = 'key,title,author_name,first_publish_year,cover_i,ebook_access,id_project_gutenberg';

/** A BOOKS item's two halves: its Open Library work, and its Project Gutenberg number when there is one. */
export function bookParts(externalId: string): { work: string; gutenberg: string | null } | null {
  const match = BOOK_ID.exec(externalId);
  return match ? { work: match[1], gutenberg: match[2] ?? null } : null;
}

/** The filter that keeps only works with a Project Gutenberg copy: the ones the site's reader can open. */
export const GUTENBERG_ONLY = 'id_project_gutenberg:*';

export function booksSearchUrl(words: string, page: number, author = '', order: 'relevance' | 'newest' | 'oldest' = 'relevance'): string {
  return buildUrl(API_HOST, ['search.json'], [
    ['q', words.length > 0 ? `${words} ${GUTENBERG_ONLY}` : GUTENBERG_ONLY],
    ...(author.length > 0 ? ([['author', author]] as const) : []),
    ['fields', FIELDS],
    ['limit', String(BOOKS_PAGE_SIZE)],
    ['page', String(page)],
    ...(order === 'newest' ? ([['sort', 'new']] as const) : order === 'oldest' ? ([['sort', 'old']] as const) : []),
  ]);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : [];
}

/** One Open Library search document as a MEDIA row, or null (no work key, no title, no usable year). */
export function toBookItem(doc: unknown, fetchedAt: string): WebItem | null {
  if (!doc || typeof doc !== 'object') return null;
  const record = doc as Record<string, unknown>;
  const work = typeof record.key === 'string' ? WORK_KEY.exec(record.key)?.[1] : undefined;
  if (!work) return null;
  const title = sanitiseText(record.title, 300);
  if (!title) return null;
  const year = typeof record.first_publish_year === 'number' && Number.isInteger(record.first_publish_year) ? record.first_publish_year : null;
  if (year === null || year < 1 || year > new Date(fetchedAt).getUTCFullYear() + 1) return null;
  const gutenberg = strings(record.id_project_gutenberg).find((number) => PG_NUMBER.test(number)) ?? null;
  const cover = typeof record.cover_i === 'number' && Number.isInteger(record.cover_i) && record.cover_i > 0 ? record.cover_i : null;
  const page = buildUrl(API_HOST, ['works', work]);
  const externalId = gutenberg ? `${work}-pg${gutenberg}` : work;
  return {
    id: `books:${externalId}`,
    platform: 'books',
    externalId,
    kind: 'text',
    url: page,
    canonicalUrl: page,
    title,
    creator: sanitiseText(strings(record.author_name).slice(0, 3).join(', '), 200) || undefined,
    // No line of its own (Luke, 2026-11-11: the "free to read" line is gone): the row's date is the year it came out.
    thumbnailUrl: cover ? `https://${COVER_HOST}/b/id/${cover}-M.jpg` : undefined,
    publishedAt: new Date(Date.UTC(year, 0, 1)).toISOString(),
    fetchedAt,
  };
}

/**
 * A book on IPFS named in `ipfs-catalogue.ts` as a row (Luke, 2026-11-11): `ipfs:<CID>`, the reader's own name for it, so
 * the row's READ opens it at /read. Its page and cover are the first gateway's addresses for the CIDs.
 */
export function toIpfsItem(book: IpfsBook, fetchedAt: string): WebItem {
  const page = gatewayUrl(IPFS_GATEWAYS[0].host, book.cid);
  return {
    id: `ipfs:${book.cid}`,
    platform: 'ipfs',
    externalId: book.cid,
    kind: 'text',
    url: page,
    canonicalUrl: page,
    title: sanitiseText(book.title, 300),
    creator: sanitiseText(book.author, 200) || undefined,
    thumbnailUrl: book.coverCid ? gatewayUrl(IPFS_GATEWAYS[0].host, book.coverCid) : undefined,
    publishedAt: new Date(Date.UTC(book.year, 0, 1)).toISOString(),
    fetchedAt,
  };
}

function pageNumber(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

export const booksSearch: SearchProvider = {
  platform: 'books',
  allowedHosts: [...BOOKS_SEARCH_HOSTS, ...IA_SEARCH_HOSTS],
  // The library scans keep their own source's name: INTERNET ARCHIVE rows (run.ts would drop them otherwise). And the books on
  // IPFS named in `ipfs-catalogue.ts`, as IPFS rows (Luke, 2026-11-11).
  alsoAnswersFor: ['internet_archive', 'ipfs'],
  timeoutMs: 12_000,
  orders: ['newest', 'oldest'],
  byAuthor: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, author = '', kind?: SearchKind): Promise<SearchPage> {
    if (kind !== undefined && kind !== 'text') return { items: [], next: null };
    if (words.length === 0 && author.length === 0) return { items: [], next: null };
    const at = pageNumber(page);
    const order = deps.order === 'newest' || deps.order === 'oldest' ? deps.order : 'relevance';
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    // The books on IPFS named in the site's own list come first, on the first page only: read here, nothing is asked.
    const fromIpfs = at === 1 ? findIpfsBooks(words, author).map((book) => toIpfsItem(book, fetchedAt)) : [];
    // Both sources at once: Open Library's Gutenberg works, and the Archive's library scans.
    const [gutenberg, scans] = await Promise.allSettled([
      safeFetchJson(booksSearchUrl(words, at, author, order), { allowedHosts: BOOKS_SEARCH_HOSTS, fetchImpl: deps.fetch }),
      safeFetchJson(iaSearchUrl(libraryScanQuery(words, author), at, order), { allowedHosts: IA_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: IA_SEARCH_TIMEOUT_MS }),
    ]);
    if (gutenberg.status === 'rejected' && scans.status === 'rejected' && fromIpfs.length === 0) throw new SearchProblemError('NO ANSWER');
    let items: WebItem[] = [...fromIpfs];
    let more = false;
    if (gutenberg.status === 'fulfilled') {
      const record = gutenberg.value && typeof gutenberg.value === 'object' ? (gutenberg.value as Record<string, unknown>) : {};
      const docs = Array.isArray(record.docs) ? record.docs : [];
      // Asked for Gutenberg works only; anything that still comes back without a copy is dropped, so every row reads here.
      items = [...items, ...docs.map((doc) => toBookItem(doc, fetchedAt)).filter((item): item is WebItem => item !== null && bookParts(item.externalId)?.gutenberg != null)];
      const found = typeof record.numFound === 'number' ? record.numFound : 0;
      more = at * BOOKS_PAGE_SIZE < found;
    }
    if (scans.status === 'fulfilled') {
      try {
        const scanned = parseIaSearch(scans.value, at, fetchedAt);
        // Texts only (the query asks so; `toWebItem` has already dropped any lending-library item).
        items = [...items, ...scanned.items.filter((item) => item.kind === 'text')];
        more = more || scanned.next !== null;
      } catch {
        // An answer of the wrong shape is no rows, as a failed request is.
      }
    }
    return { items, next: at < MAX_PAGE && more ? at + 1 : null };
  },
  // A BOOKS row is never saved into the stream: its book page reads it again from Open Library when it's opened.
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
