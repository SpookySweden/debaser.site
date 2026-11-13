/**
 * Every edition of every book (SPEC-book-editions.md, Luke 2026-11-11). SERVER ONLY: fetches through `safe-fetch`.
 *
 * Read live from Open Library when a book's page opens; nothing is stored (no table, no repository: there is nothing to
 * save until "marked as read" and reviews come, each with Luke's OK). Asked of `openlibrary.org` only:
 * - a work's editions, `/works/{OL…W}/editions.json?limit=500&offset=n`. Open Library lists them most recently edited
 *   first, so Dracula's first pages are bare reprints catalogued in 2026 and its detailed editions sit at the end: the list
 *   is read whole (500 at a time, up to `EDITIONS_READ_MAX`), then ordered here. Each answer stays in the fetch cache a
 *   day (metadata only, about 300 KB each), so paging with MORE, a filter or another order asks nothing new;
 * - one edition, `/books/{OL…M}.json` (an ISBN is looked up by BOOKS search: `isbnRow` in its provider);
 * - the work's own row, `search.json` (as the book's page already asks), for its Project Gutenberg number.
 *
 * Whether an edition's Archive scan is free or lent: the Archive's search for the work's scans by identifier, a hundred at
 * a time, reading only `access-restricted-item` (a lending-library copy when true, as the reader's route decides). One
 * request for Dracula's 75 scans, where its metadata would be one each; the reader's route still asks an item's metadata
 * before it opens anything, so a scan wrongly called free here is refused there.
 */
import { IPFS_BOOKS, usableIpfsBook } from '../books/ipfs-catalogue';
import {
  EDITION_KEY,
  EDITIONS_PAGE_SIZE,
  filterEditions,
  parseEdition,
  sortEditions,
  WORK_KEY_ID,
  type Edition,
  type EditionsAnswer,
  type EditionsOrder,
  type EditionsShow,
  type ListedEdition,
  type ScanAccess,
} from '../books/editions';
import { safeFetchJson, type FetchLike } from './safe-fetch';
import { bookParts, BOOKS_FIELDS, BOOKS_SEARCH_HOSTS, toBookItem } from './search/providers/books';
import { IA_SEARCH_HOSTS, IA_SEARCH_TIMEOUT_MS } from './search/providers/internet-archive';
import { buildUrl } from './urls';
import type { WebItem } from './types';

const OL_HOST = 'openlibrary.org';
/** Editions asked of Open Library at a time. */
export const EDITIONS_ASK = 500;
/** The most editions read for one work (ten requests): Dracula has 1,920, Pride and Prejudice 4,042. */
export const EDITIONS_READ_MAX = 5000;
/** Requests to Open Library at once for one list. */
const EDITIONS_AT_ONCE = 3;
/** Scans asked of the Archive at a time, and the most asked for one work. */
const SCANS_ASK = 100;
const SCANS_MAX = 300;
/** An answer of 500 editions is about 300 KB; a few carry long contents lists. */
const EDITIONS_MAX_BYTES = 3 * 1024 * 1024;

export function editionsUrl(work: string, offset: number): string {
  return buildUrl(OL_HOST, ['works', work, 'editions.json'], [
    ['limit', String(EDITIONS_ASK)],
    ['offset', String(offset)],
  ]);
}

export function editionUrl(key: string): string {
  return buildUrl(OL_HOST, ['books', `${key}.json`]);
}

/** The Archive search for a set of scans: their identifiers, and only whether each is a lending-library copy. */
export function scansUrl(ocaids: readonly string[]): string {
  return buildUrl('archive.org', ['advancedsearch.php'], [
    ['q', `identifier:(${ocaids.join(' OR ')})`],
    ['fl[]', 'identifier'],
    ['fl[]', 'access-restricted-item'],
    ['rows', String(SCANS_ASK)],
    ['output', 'json'],
  ]);
}

function entriesOf(body: unknown): { size: number; entries: unknown[] } {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const size = typeof record.size === 'number' && Number.isInteger(record.size) && record.size >= 0 ? record.size : 0;
  return { size, entries: Array.isArray(record.entries) ? record.entries : [] };
}

/** A work's editions, read whole up to `EDITIONS_READ_MAX`, and how many it has in all. Throws when the first page fails. */
export async function readWorkEditions(work: string, fetchImpl: FetchLike | undefined, now: Date = new Date()): Promise<{ size: number; editions: Edition[] }> {
  if (!WORK_KEY_ID.test(work)) return { size: 0, editions: [] };
  const ask = (offset: number) => safeFetchJson(editionsUrl(work, offset), { allowedHosts: [OL_HOST], fetchImpl, maxBytes: EDITIONS_MAX_BYTES, timeoutMs: 15_000 });
  const first = entriesOf(await ask(0));
  const offsets: number[] = [];
  for (let offset = EDITIONS_ASK; offset < Math.min(first.size, EDITIONS_READ_MAX); offset += EDITIONS_ASK) offsets.push(offset);
  // The rest, a few at a time; a page that fails is left out rather than failing the list.
  const rest: unknown[][] = [];
  for (let index = 0; index < offsets.length; index += EDITIONS_AT_ONCE) {
    const answers = await Promise.allSettled(offsets.slice(index, index + EDITIONS_AT_ONCE).map((offset) => ask(offset)));
    for (const page of answers) if (page.status === 'fulfilled') rest.push(entriesOf(page.value).entries);
  }
  const raw = [...first.entries, ...rest.flat()];
  const seen = new Set<string>();
  const editions: Edition[] = [];
  for (const entry of raw) {
    const edition = parseEdition(entry, now);
    if (!edition || seen.has(edition.key) || (edition.work !== null && edition.work !== work)) continue;
    seen.add(edition.key);
    editions.push(edition);
  }
  return { size: Math.max(first.size, editions.length), editions };
}

/** Whether each scan is free or lent, from the Archive's search; a scan the search doesn't find is left unknown. */
export async function readScanAccess(ocaids: readonly string[], fetchImpl: FetchLike | undefined): Promise<Map<string, ScanAccess>> {
  const wanted = [...new Set(ocaids)].sort().slice(0, SCANS_MAX);
  const batches: string[][] = [];
  for (let index = 0; index < wanted.length; index += SCANS_ASK) batches.push(wanted.slice(index, index + SCANS_ASK));
  const answers = await Promise.allSettled(
    batches.map((batch) => safeFetchJson(scansUrl(batch), { allowedHosts: IA_SEARCH_HOSTS, fetchImpl, timeoutMs: IA_SEARCH_TIMEOUT_MS })),
  );
  const access = new Map<string, ScanAccess>();
  const asked = new Set(wanted);
  for (const answer of answers) {
    if (answer.status !== 'fulfilled') continue;
    const response = answer.value && typeof answer.value === 'object' ? (answer.value as Record<string, unknown>).response : null;
    const docs = response && typeof response === 'object' ? (response as Record<string, unknown>).docs : null;
    for (const raw of Array.isArray(docs) ? docs : []) {
      const doc = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const id = typeof doc.identifier === 'string' ? doc.identifier : '';
      if (!asked.has(id)) continue;
      const flag = String(Array.isArray(doc['access-restricted-item']) ? doc['access-restricted-item'][0] : doc['access-restricted-item'] ?? '').toLowerCase();
      // The Archive's LCP lending copies are lent whatever the flag says, as the reader's route refuses them.
      access.set(id, flag === 'true' || /_lcp$/i.test(id) ? 'lent' : 'free');
    }
  }
  return access;
}

/** One edition, read from Open Library; null when it isn't there. */
export async function readEdition(key: string, fetchImpl: FetchLike | undefined, now: Date = new Date()): Promise<Edition | null> {
  if (!EDITION_KEY.test(key)) return null;
  return parseEdition(await safeFetchJson(editionUrl(key), { allowedHosts: [OL_HOST], fetchImpl }), now);
}

/** A work's own row (title, authors, year, cover, its Gutenberg number), as the book's page reads it. */
export async function readWorkRow(work: string, fetchImpl: FetchLike | undefined, now: Date = new Date()): Promise<WebItem | null> {
  if (!WORK_KEY_ID.test(work)) return null;
  const url = buildUrl(OL_HOST, ['search.json'], [
    ['q', `key:/works/${work}`],
    ['fields', BOOKS_FIELDS],
    ['limit', '1'],
  ]);
  const body = await safeFetchJson(url, { allowedHosts: BOOKS_SEARCH_HOSTS, fetchImpl });
  const docs = body && typeof body === 'object' ? (body as Record<string, unknown>).docs : undefined;
  return Array.isArray(docs) && docs.length > 0 ? toBookItem(docs[0], now.toISOString()) : null;
}

/** The work's copy on IPFS, when `ipfs-catalogue.ts` names one for it. */
export function ipfsCopyOf(work: string): string | null {
  return IPFS_BOOKS.find((book) => book.work === work && usableIpfsBook(book))?.cid ?? null;
}

/**
 * The best copy of a work to open in the reader (Luke, 2026-11-13: "any book can be read in the ereader"): Project
 * Gutenberg's copy first (its EPUB passes through our server, pictures included); then a free Archive scan; else, when a
 * lending-library scan exists, that scan's identifier as `borrowOnArchive` so the reader's no-free-copy page can offer
 * `[ BORROW ON ARCHIVE ↗ ]` beside `[ OPEN LIBRARY ↗ ]` (Luke, 2026-11-13: the Archive's own embed for a borrow-only
 * copyrighted book renders a black viewer until the reader borrows, and the reader can't borrow inside an iframe, so
 * sending them to archive.org for the borrow is kinder than a blank page). One page of editions is read (500 at a time
 * is already the catalogue's own page), which is enough for every work checked live. Open to visitors.
 */
export async function resolveWorkCopy(
  work: string,
  fetchImpl: FetchLike | undefined,
  now: Date = new Date(),
): Promise<{ ref: string } | { borrowOnArchive: string } | null> {
  if (!WORK_KEY_ID.test(work)) return null;
  const [row, firstPage] = await Promise.all([
    readWorkRow(work, fetchImpl, now).catch(() => null),
    safeFetchJson(editionsUrl(work, 0), { allowedHosts: [OL_HOST], fetchImpl, maxBytes: EDITIONS_MAX_BYTES, timeoutMs: 15_000 }).catch(() => null),
  ]);
  const rowParts = row ? bookParts(row.externalId) : null;
  if (rowParts?.gutenberg) return { ref: `books:${rowParts.work}-pg${rowParts.gutenberg}` };
  const ipfs = ipfsCopyOf(work);
  if (ipfs) return { ref: `ipfs:${ipfs}` };
  const entries = entriesOf(firstPage).entries;
  const parsed = entries
    .map((entry) => parseEdition(entry, now))
    .filter((edition): edition is NonNullable<typeof edition> => edition !== null && edition.work === work && edition.ocaid !== null);
  if (parsed.length === 0) return null;
  const ocaids = parsed.flatMap((edition) => (edition.ocaid ? [edition.ocaid] : []));
  const access = await readScanAccess(ocaids, fetchImpl);
  const free = parsed.find((edition) => edition.ocaid && access.get(edition.ocaid) === 'free');
  if (free?.ocaid) return { ref: `internet_archive:${free.ocaid}` };
  // No free scan: the first lending scan the Archive confirms is lent (free-of-charge to borrow for an hour). An
  // unknown-access scan is never offered as a borrow, since the reader has no way to find out it's actually there.
  const lent = parsed.find((edition) => edition.ocaid && access.get(edition.ocaid) === 'lent');
  return lent?.ocaid ? { borrowOnArchive: lent.ocaid } : null;
}

/** The book's page's list: its editions in an order, filtered, fifty from `offset`, and the one it was opened at. */
export async function listEditions(
  ask: { ref: string; offset: number; show: EditionsShow; order: EditionsOrder; at: string | null },
  fetchImpl: FetchLike | undefined,
  now: Date = new Date(),
): Promise<EditionsAnswer | null> {
  const parts = ask.ref.startsWith('books:') ? bookParts(ask.ref.slice('books:'.length)) : null;
  if (!parts) return null;
  const [all, row] = await Promise.all([
    readWorkEditions(parts.work, fetchImpl, now),
    // The Gutenberg number comes from Open Library, never from the address the browser sent.
    readWorkRow(parts.work, fetchImpl, now).catch(() => null),
  ]);
  let atEdition: Edition | null = null;
  if (ask.at !== null && EDITION_KEY.test(ask.at)) {
    atEdition = all.editions.find((edition) => edition.key === ask.at) ?? (await readEdition(ask.at, fetchImpl, now).catch(() => null));
    if (atEdition && atEdition.work !== parts.work) atEdition = null;
  }
  const ocaids = [...all.editions, ...(atEdition ? [atEdition] : [])].flatMap((edition) => (edition.ocaid ? [edition.ocaid] : []));
  const access = ocaids.length > 0 ? await readScanAccess(ocaids, fetchImpl) : new Map<string, ScanAccess>();
  const listed = (edition: Edition): ListedEdition => ({ ...edition, scan: edition.ocaid ? access.get(edition.ocaid) ?? null : null });
  const matching = filterEditions(sortEditions(all.editions.map(listed), ask.order), ask.show);
  const offset = Number.isInteger(ask.offset) && ask.offset >= 0 ? ask.offset : 0;
  const page = matching.slice(offset, offset + EDITIONS_PAGE_SIZE);
  const rowParts = row ? bookParts(row.externalId) : null;
  return {
    size: all.size,
    read: all.editions.length,
    matching: matching.length,
    editions: page,
    next: offset + EDITIONS_PAGE_SIZE < matching.length ? offset + EDITIONS_PAGE_SIZE : null,
    at: atEdition ? listed(atEdition) : null,
    gutenbergRef: rowParts?.gutenberg ? `books:${rowParts.work}-pg${rowParts.gutenberg}` : null,
    ipfsCid: ipfsCopyOf(parts.work),
  };
}
