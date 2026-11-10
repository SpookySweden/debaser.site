/**
 * Books for the reader and a book's page (SPEC-books.md, Luke 2026-11-10). SERVER ONLY: fetches through `safe-fetch`.
 *
 * The text: a Project Gutenberg book's plain UTF-8 text, from gutenberg.org's own file address for it, passed through to
 * the reader and never kept: the route asks it with `cache: 'no-store'` and answers `private, no-store`, as subtitles are
 * (Luke's OK for this exception, SPEC-books.md: book text, free books only, never stored). Only Gutenberg: its books are
 * free to read, and this is the one place the site handles a book's words.
 *
 * The details for a book's page: Open Library's search answer for one work, or LibriVox's for one book: title, authors,
 * year, cover, and whether the reader can open it. No counts or ratings are asked for.
 */
import { bookParts, BOOKS_SEARCH_HOSTS, toBookItem } from './search/providers/books';
import { AUDIOBOOKS_SEARCH_HOSTS, toAudiobookItem } from './search/providers/audiobooks';
import { safeFetchJson, safeFetchText, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import type { WebItem } from './types';

export const GUTENBERG_HOST = 'www.gutenberg.org';
/** The longest book the reader takes (War and Peace's plain text is about 3.3 MB). */
export const BOOK_MAX_BYTES = 8 * 1024 * 1024;
const BOOK_TIMEOUT_MS = 20_000;

/** A book's address on the site: `/media/book/books:OL85892W-pg345`, `/media/book/audiobooks:271`. */
export const BOOK_REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|audiobooks:[1-9][0-9]{0,8})$/;

export function gutenbergTextUrl(number: string): string {
  return buildUrl(GUTENBERG_HOST, ['cache', 'epub', number, `pg${number}.txt`]);
}

/** A Gutenberg book's text, or null for a ref the reader can't open. Throws `SafeFetchError` on a failed read. */
export async function readBookText(ref: string, textFetch: FetchLike): Promise<string | null> {
  if (!BOOK_REF.test(ref) || !ref.startsWith('books:')) return null;
  const parts = bookParts(ref.slice('books:'.length));
  if (!parts?.gutenberg) return null;
  const text = await safeFetchText(gutenbergTextUrl(parts.gutenberg), {
    allowedHosts: [GUTENBERG_HOST],
    fetchImpl: textFetch,
    maxBytes: BOOK_MAX_BYTES,
    timeoutMs: BOOK_TIMEOUT_MS,
    accept: 'text/plain',
  });
  // Line endings made one kind, and nothing but text: no markup is ever drawn from it (the reader shows plain text).
  return text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
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
