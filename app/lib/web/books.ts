/**
 * Books for the reader and a book's page (SPEC-books.md, Luke 2026-11-10; SPEC-reader.md, 2026-11-11). SERVER ONLY: fetches
 * through `safe-fetch`.
 *
 * The book: a Project Gutenberg book's EPUB edition, pictures included, from gutenberg.org's own file address for it, passed
 * through to the reader as it streams and never kept: the route asks it with `cache: 'no-store'` and answers
 * `private, no-store`, as subtitles are (Luke's OK for this exception, SPEC-reader.md, widening SPEC-books.md's for the
 * plain text: free books only, never stored). Only Gutenberg: its books are free to read, and this is the one place the site
 * handles a book's words.
 *
 * And an Internet Archive book (Luke, 2026-11-11: "options 2 for epubs and 1 for eveyrthing else"): when the item offers
 * its own EPUB to everyone (listed, not private, not the Archive's LCP lending copy), that file passes through the same way,
 * never kept; when it has none, the reader shows the Archive's own viewer instead (`archive.org/embed/<id>`, played from
 * the Archive). Lending-library items are never opened: MEDIA leaves them out and the metadata is checked again here.
 *
 * The details for a book's page: Open Library's search answer for one work, LibriVox's for one book, or the Archive's
 * metadata for one item: title, authors, year, cover, and whether the reader can open it. No counts or ratings are asked for.
 */
import { bookParts, BOOKS_SEARCH_HOSTS, toBookItem } from './search/providers/books';
import { AUDIOBOOKS_SEARCH_HOSTS, toAudiobookItem } from './search/providers/audiobooks';
import { toWebItem as toArchiveItem, IA_ALLOWED_HOSTS } from './adapters/internet-archive';
import { SafeFetchError, safeFetchJson, safeFetchStream, type FetchLike } from './safe-fetch';
import { buildUrl, isSafeIdentifier } from './urls';
import type { WebItem } from './types';

export const GUTENBERG_HOST = 'www.gutenberg.org';

/**
 * A book's address on the site: `/media/book/books:OL85892W-pg345`, `/media/book/audiobooks:271`, and an Internet Archive
 * book, `/read/internet_archive:<identifier>`.
 */
export const BOOK_REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|audiobooks:[1-9][0-9]{0,8}|internet_archive:[A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;

/** The Archive's file servers a download is sent on to (`ia800300.us.archive.org`, `dn721905.ca.archive.org`). */
const IA_FILE_SERVER = /^(?:ia|dn)\d{1,8}\.(?:[a-z]{2}\.)?archive\.org$/;
/** An Archive item's metadata can list thousands of files. */
const IA_METADATA_MAX_BYTES = 8 * 1024 * 1024;

type ArchiveBook = { metadata: Record<string, unknown>; epub: { name: string; size: number | null } | null };

/**
 * An Archive item as a book: its metadata, and the EPUB anyone may read when it has one. Null when it isn't a book the
 * site may open: not a text, dark, or a lending-library (access-restricted) item.
 */
export function archiveBookOf(body: unknown): ArchiveBook | null {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!root || root.is_dark === true || !Array.isArray(root.files)) return null;
  const metadata = root.metadata && typeof root.metadata === 'object' ? (root.metadata as Record<string, unknown>) : {};
  const flag = (value: unknown) => String(Array.isArray(value) ? value[0] : value ?? '').trim().toLowerCase();
  if (flag(metadata['access-restricted-item']) === 'true') return null;
  if (flag(metadata.mediatype) !== 'texts') return null;
  const epubs = root.files.flatMap((raw) => {
    const file = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!file || typeof file.name !== 'string' || flag(file.private) === 'true') return [];
    const name = file.name;
    // The book itself only: not the Archive's LCP lending copy (`_lcp.epub`), and a path inside the item, nothing odd.
    if (!/\.epub$/i.test(name) || /_lcp\.epub$/i.test(name) || name.length > 300) return [];
    if (name.split('/').some((part) => part === '' || part === '.' || part === '..')) return [];
    const size = Number(file.size);
    return [{ name, size: Number.isFinite(size) && size > 0 ? size : null }];
  });
  const fitting = epubs.filter((file) => file.size === null || file.size <= EPUB_MAX_BYTES);
  return { metadata, epub: fitting.sort((a, b) => a.name.length - b.name.length)[0] ?? null };
}

async function readArchiveBook(id: string, fetchImpl: FetchLike | undefined): Promise<ArchiveBook | null> {
  const body = await safeFetchJson(buildUrl('archive.org', ['metadata', id]), { allowedHosts: IA_ALLOWED_HOSTS, fetchImpl, maxBytes: IA_METADATA_MAX_BYTES });
  return archiveBookOf(body);
}

/**
 * The reader's book (SPEC-reader.md, Luke's OK 2026-11-11): Project Gutenberg's EPUB edition, pictures included, passed through
 * and never kept. The editions, best first: EPUB 3 with pictures, EPUB 2 with pictures, and the one
 * without pictures, for a book whose pictured edition is missing or bigger than `EPUB_PICTURES_MAX_BYTES`.
 */
export const EPUB_MAX_BYTES = 40 * 1024 * 1024;
/** The most a pictured edition may weigh before the reader takes the one without pictures. */
export const EPUB_PICTURES_MAX_BYTES = 40 * 1024 * 1024;
const EPUB_TIMEOUT_MS = 30_000;

export function gutenbergEpubUrls(number: string): string[] {
  return [`pg${number}-images-3.epub`, `pg${number}-images.epub`, `pg${number}.epub`].map((file) => buildUrl(GUTENBERG_HOST, ['cache', 'epub', number, file]));
}

/**
 * A Gutenberg book's EPUB as a stream, or null for a ref the reader can't open. Throws `SafeFetchError` when no edition
 * answers. Nothing is held: each edition is asked in turn and the first that answers within its cap is handed on unread.
 */
export async function openBookEpub(ref: string, epubFetch: FetchLike): Promise<{ body: ReadableStream<Uint8Array>; length: number | null } | 'viewer' | null> {
  if (!BOOK_REF.test(ref)) return null;
  if (ref.startsWith('internet_archive:')) return openArchiveEpub(ref.slice('internet_archive:'.length), epubFetch);
  if (!ref.startsWith('books:')) return null;
  const parts = bookParts(ref.slice('books:'.length));
  if (!parts?.gutenberg) return null;
  const urls = gutenbergEpubUrls(parts.gutenberg);
  let last: unknown = null;
  for (const [index, url] of urls.entries()) {
    const pictured = index < urls.length - 1;
    try {
      const opened = await safeFetchStream(url, {
        allowedHosts: [GUTENBERG_HOST],
        fetchImpl: epubFetch,
        maxBytes: pictured ? EPUB_PICTURES_MAX_BYTES : EPUB_MAX_BYTES,
        timeoutMs: EPUB_TIMEOUT_MS,
        accept: 'application/epub+zip',
      });
      return { body: opened.body, length: opened.length };
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof SafeFetchError ? last : new SafeFetchError('no edition answered');
}

/**
 * An Archive book's EPUB as a stream, `'viewer'` when the item has no EPUB anyone may read (the reader shows the Archive's
 * own viewer), or null when it isn't a book the site may open. The item's metadata is asked fresh each time, and the file
 * is fetched from archive.org (and the file server it sends the download on to) and handed on unread.
 */
async function openArchiveEpub(id: string, epubFetch: FetchLike): Promise<{ body: ReadableStream<Uint8Array>; length: number | null } | 'viewer' | null> {
  if (!isSafeIdentifier(id, 101)) return null;
  const book = await readArchiveBook(id, epubFetch);
  if (book === null) return null;
  if (book.epub === null) return 'viewer';
  const opened = await safeFetchStream(buildUrl('archive.org', ['download', id, ...book.epub.name.split('/')]), {
    allowedHosts: IA_ALLOWED_HOSTS,
    redirectHosts: IA_FILE_SERVER,
    fetchImpl: epubFetch,
    maxBytes: EPUB_MAX_BYTES,
    timeoutMs: EPUB_TIMEOUT_MS,
    accept: 'application/epub+zip',
  });
  return { body: opened.body, length: opened.length };
}

/** One book's row (title, authors, year, cover, readable or not), read again from its catalogue; null when it's gone. */
export async function readBookInfo(ref: string, fetchImpl?: FetchLike, now: Date = new Date()): Promise<WebItem | null> {
  if (!BOOK_REF.test(ref)) return null;
  const fetchedAt = now.toISOString();
  if (ref.startsWith('books:')) {
    const parts = bookParts(ref.slice('books:'.length));
    if (!parts) return null;
    const url = buildUrl('openlibrary.org', ['search.json'], [
      ['q', `key:/works/${parts.work}`],
      ['fields', 'key,title,author_name,first_publish_year,cover_i,ebook_access,id_project_gutenberg'],
      ['limit', '1'],
    ]);
    const body = await safeFetchJson(url, { allowedHosts: BOOKS_SEARCH_HOSTS, fetchImpl });
    const docs = body && typeof body === 'object' ? (body as Record<string, unknown>).docs : undefined;
    return Array.isArray(docs) && docs.length > 0 ? toBookItem(docs[0], fetchedAt) : null;
  }
  if (ref.startsWith('internet_archive:')) {
    const id = ref.slice('internet_archive:'.length);
    if (!isSafeIdentifier(id, 101)) return null;
    const book = await readArchiveBook(id, fetchImpl);
    return book ? toArchiveItem({ ...book.metadata, identifier: id }, fetchedAt) : null;
  }
  const number = ref.slice('audiobooks:'.length);
  const url = buildUrl('librivox.org', ['api', 'feed', 'audiobooks'], [
    ['id', number],
    ['format', 'json'],
    ['fields', '{id,title,description,url_librivox,url_iarchive,copyright_year,totaltimesecs,authors,language}'],
  ]);
  const body = await safeFetchJson(url, { allowedHosts: AUDIOBOOKS_SEARCH_HOSTS, fetchImpl });
  const books = body && typeof body === 'object' ? (body as Record<string, unknown>).books : undefined;
  return Array.isArray(books) && books.length > 0 ? toAudiobookItem(books[0], fetchedAt) : null;
}
