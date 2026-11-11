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
 * The details for a book's page: Open Library's search answer for one work, or LibriVox's for one book: title, authors,
 * year, cover, and whether the reader can open it. No counts or ratings are asked for.
 */
import { bookParts, BOOKS_SEARCH_HOSTS, toBookItem } from './search/providers/books';
import { AUDIOBOOKS_SEARCH_HOSTS, toAudiobookItem } from './search/providers/audiobooks';
import { SafeFetchError, safeFetchJson, safeFetchStream, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import type { WebItem } from './types';

export const GUTENBERG_HOST = 'www.gutenberg.org';

/** A book's address on the site: `/media/book/books:OL85892W-pg345`, `/media/book/audiobooks:271`. */
export const BOOK_REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|audiobooks:[1-9][0-9]{0,8})$/;

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
export async function openBookEpub(ref: string, epubFetch: FetchLike): Promise<{ body: ReadableStream<Uint8Array>; length: number | null } | null> {
  if (!BOOK_REF.test(ref) || !ref.startsWith('books:')) return null;
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
