/**
 * AUDIOBOOKS (SPEC-books.md, Luke 2026-11-10): LibriVox's own catalogue API (librivox.org/api/feed/audiobooks, keyless,
 * JSON), asked only when AUDIOBOOKS is the SOURCE. LibriVox's volunteers read books whose copyright has run out; every
 * recording is kept on archive.org, and the site's music bar plays its chapters from there (audio-files.ts
 * `parseLibrivoxFeed`, from the book's own RSS feed).
 *
 * Checked live 2026-11-10: `title` finds a whole title, or the start of one with `^`; `author` finds a last name. So a
 * search asks the start of a title first, then the whole title, then the last word as an author, and stops at the first
 * that finds anything (at most three requests). LibriVox has no order of its own: for DATE the provider reads up to 200
 * matches and orders them itself by the year the book was first published (the date it shows), as KINO does.
 *
 * Asked for: id, title, description, the book's page, the archive.org identifier (for its picture), first publication
 * year, running time, authors, language. No counts exist in it. Page https://librivox.org/{slug}/, picture
 * https://archive.org/services/img/{identifier}. An item's external id is LibriVox's own book number.
 */
import { safeFetchJson, SafeFetchError } from '../../safe-fetch';
import { sanitiseText } from '../../sanitise';
import { buildUrl, isSafeIdentifier } from '../../urls';
import type { WebItem } from '../../types';
import { SearchProblemError, type ProviderPage, type SearchDeps, type SearchKind, type SearchPage, type SearchProvider } from '../types';

const API_HOST = 'librivox.org';
export const AUDIOBOOKS_SEARCH_HOSTS = [API_HOST] as const;
export const AUDIOBOOKS_PAGE_SIZE = 20;
const SORT_READ = 200;
const MAX_OFFSET = 1000;
const BOOK_NUMBER = /^[1-9][0-9]{0,8}$/;
const PAGE_ADDRESS = /^https:\/\/librivox\.org\/([a-z0-9][a-z0-9-]{0,200})\/$/;
const ARCHIVE_ADDRESS = /^https?:\/\/(?:www\.)?archive\.org\/details\/([A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;
const FIELDS = '{id,title,description,url_librivox,url_iarchive,copyright_year,totaltimesecs,authors,language}';

type Ask = { field: 'title' | 'author'; value: string };

export function audiobooksSearchUrl(ask: Ask, offset: number, limit = AUDIOBOOKS_PAGE_SIZE): string {
  return buildUrl(API_HOST, ['api', 'feed', 'audiobooks'], [
    [ask.field, ask.value],
    ['format', 'json'],
    ['limit', String(limit)],
    ['offset', String(offset)],
    ['fields', FIELDS],
  ]);
}

/** What a search asks LibriVox, in turn, until one finds something. */
export function asksFor(words: string, author: string): Ask[] {
  const asks: Ask[] = [];
  if (words.length > 0) asks.push({ field: 'title', value: `^${words}` }, { field: 'title', value: words });
  const last = (author.length > 0 ? author : words).split(' ').filter(Boolean).pop();
  if (last) asks.push({ field: 'author', value: last });
  return asks;
}

/** One LibriVox book as a MEDIA row, or null (bad number, no title, no page, no usable year). */
export function toAudiobookItem(book: unknown, fetchedAt: string): WebItem | null {
  if (!book || typeof book !== 'object') return null;
  const record = book as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : typeof record.id === 'number' ? String(record.id) : '';
  if (!BOOK_NUMBER.test(id)) return null;
  const title = sanitiseText(record.title, 300);
  const page = typeof record.url_librivox === 'string' ? PAGE_ADDRESS.exec(record.url_librivox.trim()) : null;
  if (!title || !page) return null;
  const year = typeof record.copyright_year === 'string' && /^[0-9]{1,4}$/.test(record.copyright_year) ? Number(record.copyright_year) : null;
  if (year === null || year < 1 || year > new Date(fetchedAt).getUTCFullYear()) return null;
  const archive = typeof record.url_iarchive === 'string' ? ARCHIVE_ADDRESS.exec(record.url_iarchive.trim())?.[1] : undefined;
  const authors = Array.isArray(record.authors)
    ? record.authors
        .map((author) => (author && typeof author === 'object' ? `${(author as Record<string, unknown>).first_name ?? ''} ${(author as Record<string, unknown>).last_name ?? ''}` : ''))
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
    : '';
  const seconds = typeof record.totaltimesecs === 'number' && record.totaltimesecs > 0 && record.totaltimesecs < 1_000_000 ? record.totaltimesecs : undefined;
  const url = `https://${API_HOST}/${page[1]}/`;
  return {
    id: `audiobooks:${id}`,
    platform: 'audiobooks',
    externalId: id,
    kind: 'audio',
    url,
    canonicalUrl: url,
    title,
    creator: sanitiseText(authors, 200) || undefined,
    description: sanitiseText(record.description, 1000) || undefined,
    thumbnailUrl: archive && isSafeIdentifier(archive) ? `https://archive.org/services/img/${archive}` : undefined,
    durationSeconds: seconds,
    publishedAt: new Date(Date.UTC(year, 0, 1)).toISOString(),
    fetchedAt,
  };
}

function offsetOf(page: ProviderPage | null): number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 0 && page <= MAX_OFFSET && page % AUDIOBOOKS_PAGE_SIZE === 0 ? page : 0;
}

/** LibriVox answers 404 with an error when nothing matches: that is "nothing", not a failure. */
async function ask(url: string, deps: SearchDeps): Promise<unknown[]> {
  try {
    const body = await safeFetchJson(url, { allowedHosts: AUDIOBOOKS_SEARCH_HOSTS, fetchImpl: deps.fetch, timeoutMs: 15_000 });
    const books = body && typeof body === 'object' ? (body as Record<string, unknown>).books : undefined;
    return Array.isArray(books) ? books : [];
  } catch (error) {
    if (error instanceof SafeFetchError && error.status === 404) return [];
    throw new SearchProblemError('NO ANSWER');
  }
}

export const audiobooksSearch: SearchProvider = {
  platform: 'audiobooks',
  allowedHosts: AUDIOBOOKS_SEARCH_HOSTS,
  timeoutMs: 20_000,
  sortedTimeoutMs: 25_000,
  orders: ['newest', 'oldest'],
  byAuthor: true,
  async search(words: string, page: ProviderPage | null, deps: SearchDeps, author = '', kind?: SearchKind): Promise<SearchPage> {
    if (kind !== undefined && kind !== 'audio') return { items: [], next: null };
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    const dated = deps.order === 'newest' || deps.order === 'oldest';
    const offset = dated ? 0 : offsetOf(page);
    for (const each of asksFor(words, author)) {
      const books = await ask(audiobooksSearchUrl(each, offset, dated ? SORT_READ : AUDIOBOOKS_PAGE_SIZE), deps);
      if (books.length === 0) continue;
      const items = books.map((book) => toAudiobookItem(book, fetchedAt)).filter((item): item is WebItem => item !== null);
      if (dated) {
        items.sort((a, b) => (deps.order === 'newest' ? b.publishedAt.localeCompare(a.publishedAt) : a.publishedAt.localeCompare(b.publishedAt)) || a.id.localeCompare(b.id));
        return { items, next: null };
      }
      const next = books.length === AUDIOBOOKS_PAGE_SIZE && offset + AUDIOBOOKS_PAGE_SIZE <= MAX_OFFSET ? offset + AUDIOBOOKS_PAGE_SIZE : null;
      return { items, next };
    }
    return { items: [], next: null };
  },
  // An AUDIOBOOKS row is never saved into the stream; its chapters are read from LibriVox's feed when played.
  async fetchOne(): Promise<WebItem | null> {
    return null;
  },
};
