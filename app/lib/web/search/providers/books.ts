/**
 * BOOKS (SPEC-books.md, Luke 2026-11-10): Open Library's search API (openlibrary.org/search.json, keyless, JSON), asked only
 * when BOOKS is the SOURCE. Every book in Open Library's catalogue is found (SPEC-book-editions.md, Luke 2026-11-11: "each
 * copy of every book appears"), not only the ones the site's reader opens, as it was earlier that day: one row per work,
 * its editions on the book's page (`[ EDITIONS ]`). The works the reader opens come first in what BOOKS answers: those
 * with a Project Gutenberg copy (READ opens it at /read), then the Archive's library scans, then works with a free scan of
 * an edition (READ opens the book's page at the editions it can read). Asked for: key, title, author names, first
 * publication year, cover number, ebook access, Gutenberg numbers and how many editions the work has; no counts of people
 * or ratings exist in the request. An ISBN typed as the search finds that one edition's book (`/isbn/{isbn}.json`).
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
import { findNamedWorks, type NamedWork } from '../../../books/book-sources';
import { isbnOf } from '../../../books/editions';
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
const EDITION_PATH = /^\/books\/(OL[1-9][0-9]{0,11}M)$/;
const PG_NUMBER = /^[1-9][0-9]{0,6}$/;
const BOOK_ID = /^(OL[1-9][0-9]{0,11}W)(?:-pg([1-9][0-9]{0,6}))?$/;
/** What a work's row asks of Open Library's search (and the book's page, for one work). */
export const BOOKS_FIELDS = 'key,title,author_name,first_publish_year,cover_i,ebook_access,id_project_gutenberg,edition_count';
const FIELDS = BOOKS_FIELDS;

/** A BOOKS item's two halves: its Open Library work, and its Project Gutenberg number when there is one. */
export function bookParts(externalId: string): { work: string; gutenberg: string | null } | null {
  const match = BOOK_ID.exec(externalId);
  return match ? { work: match[1], gutenberg: match[2] ?? null } : null;
}

export function booksSearchUrl(words: string, page: number, author = '', order: 'relevance' | 'newest' | 'oldest' = 'relevance'): string {
  return buildUrl(API_HOST, ['search.json'], [
    ...(words.length > 0 ? ([['q', words]] as const) : []),
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
  const editions = typeof record.edition_count === 'number' && Number.isInteger(record.edition_count) && record.edition_count >= 0 ? record.edition_count : 0;
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
    // How many editions, and whether one is a free scan (Open Library's `ebook_access: public`), for the row's keys.
    book: { editions, ...(record.ebook_access === 'public' ? { scan: true } : {}) },
  };
}

/**
 * How well a work's title matches the search words: 2 when the title IS one of the search words (an exact one-word title
 * hit, so "dune" finds Dune the novel first, not "The road to Dune"), 1 when every word of the title is in the search, 0
 * otherwise. Added 2026-11-13 ("i cant see frank herburt dune when searching it now at all"): Open Library's own
 * relevance order for "dune frank herbert" bumps Dune-adjacent books above Dune itself, because many hits match "frank
 * herbert" and the title+author ranker spreads the signal; a plain title-match preference restores the obvious result.
 */
function titleMatchScore(title: string, words: string): number {
  const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0);
  const searchWords = new Set(words.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0));
  if (titleWords.length === 0 || searchWords.size === 0) return 0;
  // One-word title that is one of the search words: an exact hit for a short title like "Dune".
  if (titleWords.length === 1 && searchWords.has(titleWords[0])) return 2;
  // Every word of the title appears in the search (the search may have extra words like an author's name).
  if (titleWords.every((word) => searchWords.has(word))) return 1;
  return 0;
}

/**
 * An ISBN's book (SPEC-book-editions.md): Open Library's edition for it (its `/isbn/` address answers with a redirect to the
 * edition on the same host, the only host allowed), then its work's row, carrying the edition so the row's EDITIONS opens
 * the page at it. Null when Open Library has no such ISBN or its edition names no work.
 */
export async function isbnRow(isbn: string, deps: Pick<SearchDeps, 'fetch'>, fetchedAt: string): Promise<WebItem | null> {
  const edition = await safeFetchJson(buildUrl(API_HOST, ['isbn', `${isbn}.json`]), { allowedHosts: BOOKS_SEARCH_HOSTS, fetchImpl: deps.fetch }).catch(() => null);
  const record = edition && typeof edition === 'object' ? (edition as Record<string, unknown>) : null;
  const key = typeof record?.key === 'string' ? EDITION_PATH.exec(record.key)?.[1] : undefined;
  const works = Array.isArray(record?.works) ? record.works : [];
  const workKey = works[0] && typeof works[0] === 'object' ? (works[0] as Record<string, unknown>).key : undefined;
  const work = typeof workKey === 'string' ? WORK_KEY.exec(workKey)?.[1] : undefined;
  if (!key || !work) return null;
  const body = await safeFetchJson(buildUrl(API_HOST, ['search.json'], [['q', `key:/works/${work}`], ['fields', FIELDS], ['limit', '1']]), {
    allowedHosts: BOOKS_SEARCH_HOSTS,
    fetchImpl: deps.fetch,
  }).catch(() => null);
  const docs = body && typeof body === 'object' ? (body as Record<string, unknown>).docs : undefined;
  const item = Array.isArray(docs) && docs.length > 0 ? toBookItem(docs[0], fetchedAt) : null;
  return item ? { ...item, book: { ...(item.book ?? { editions: 0 }), edition: key } } : null;
}

/**
 * An Open Library work named by hand in `book-sources.ts` as a row (Luke, 2026-11-11): `books:<work>`, the same shape as one
 * Open Library's own search returns, so the row's page and READ behave the same. Its edition count isn't known until the
 * book's page reads it live, so the row names none.
 */
export function toNamedWorkItem(work: NamedWork, fetchedAt: string): WebItem {
  const page = buildUrl(API_HOST, ['works', work.work]);
  return {
    id: `books:${work.work}`,
    platform: 'books',
    externalId: work.work,
    kind: 'text',
    url: page,
    canonicalUrl: page,
    title: sanitiseText(work.title, 300),
    creator: sanitiseText(work.author, 200) || undefined,
    publishedAt: new Date(Date.UTC(work.year, 0, 1)).toISOString(),
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
    // An ISBN finds that one edition's book; one Open Library doesn't know is searched as words.
    const isbn = at === 1 && author.length === 0 ? isbnOf(words) : null;
    if (isbn !== null) {
      const found = await isbnRow(isbn, deps, fetchedAt);
      if (found) return { items: [found], next: null };
    }
    // The books named in the site's own lists come first, on the first page only: read here, nothing is asked. The IPFS
    // copies, then the Open Library works named by hand (a work Open Library's own answer also returns is left to that row).
    const fromIpfs = at === 1 ? findIpfsBooks(words, author).map((book) => toIpfsItem(book, fetchedAt)) : [];
    const namedWorks = at === 1 ? findNamedWorks(words, author).map((work) => toNamedWorkItem(work, fetchedAt)) : [];
    // Both sources at once: Open Library's works, and the Archive's library scans.
    const [gutenberg, scans] = await Promise.allSettled([
      safeFetchJson(booksSearchUrl(words, at, author, order), { allowedHosts: BOOKS_SEARCH_HOSTS, fetchImpl: deps.fetch }),
      safeFetchJson(iaSearchUrl(libraryScanQuery(words, author), at, order), { allowedHosts: IA_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: IA_SEARCH_TIMEOUT_MS }),
    ]);
    if (gutenberg.status === 'rejected' && scans.status === 'rejected' && fromIpfs.length === 0 && namedWorks.length === 0) throw new SearchProblemError('NO ANSWER');
    let works: WebItem[] = [];
    let libraryScans: WebItem[] = [];
    let more = false;
    if (gutenberg.status === 'fulfilled') {
      const record = gutenberg.value && typeof gutenberg.value === 'object' ? (gutenberg.value as Record<string, unknown>) : {};
      const docs = Array.isArray(record.docs) ? record.docs : [];
      // Every work found, in Open Library's own order, with a title-match bump (so "dune" finds Dune the novel first).
      works = docs
        .map((doc) => toBookItem(doc, fetchedAt))
        .filter((item): item is WebItem => item !== null)
        .map((item, index) => ({ item, index, score: titleMatchScore(item.title, words) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ item }) => item);
      const found = typeof record.numFound === 'number' ? record.numFound : 0;
      more = at * BOOKS_PAGE_SIZE < found;
    }
    if (scans.status === 'fulfilled') {
      try {
        const scanned = parseIaSearch(scans.value, at, fetchedAt);
        // Texts only (the query asks so; `toWebItem` has already dropped any lending-library item).
        libraryScans = scanned.items.filter((item) => item.kind === 'text');
        more = more || scanned.next !== null;
      } catch {
        // An answer of the wrong shape is no rows, as a failed request is.
      }
    }
    // The IPFS copies and the named works lead (nothing from Open Library is asked for them); then Open Library's own
    // relevance order, with the Archive's library scans at the end as a catalogue tail. A work both named here and
    // returned by Open Library shows once, in the named place, carrying Open Library's cover and edition count.
    const workOf = (item: WebItem) => bookParts(item.externalId)?.work ?? item.externalId;
    const fromOpenLibrary = new Map(works.map((item) => [workOf(item), item]));
    const named = namedWorks.map((item) => fromOpenLibrary.get(item.externalId) ?? item);
    const namedKeys = new Set(namedWorks.map((item) => item.externalId));
    const rest = works.filter((item) => !namedKeys.has(workOf(item)));
    const items = [...fromIpfs, ...named, ...rest, ...libraryScans];
    return { items, next: at < MAX_PAGE && more ? at + 1 : null };
  },
  // A BOOKS row is never saved into the stream: its book page reads it again from Open Library when it's opened.
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
