import { IPFS_BOOKS } from './book-sources';
import { archiveBookId, ownHash, type BookHighlight } from './types';

/**
 * Every copy of a book counts as that book (Luke, 2026-11-13). One book can be read from many copies: Project Gutenberg's
 * EPUB, an Internet Archive EPUB, PDF or scan, a book on IPFS, or a reader's own PDF or EPUB. Each copy keeps its own ref;
 * the Open Library work it is a copy of (`books:OL85892W`) gathers them: your place, your highlights, the book page's
 * READERS and your "[NAME] READING [BOOK]" thread count every copy of the work.
 *
 * - A Gutenberg ref names its work in itself (`books:OL85892W-pg345`).
 * - An Archive book names its work in its own metadata (`openlibrary_work`), read by the browser from archive.org's public
 *   metadata API (sent with `Access-Control-Allow-Origin: *`, checked 2026-11-13).
 * - A book on IPFS names it in `book-sources.ts`, when it has one.
 * - Your own file is matched from the title and author written inside it, by Open Library's public search API (same CORS,
 *   checked the same day): `THIS IS: <TITLE> BY <AUTHOR>`, with [ CHANGE ] and [ NOT LISTED ]. The match saves to the account
 *   (`book_places.work_ref`), so the same file on another device finds it.
 */

export const WORK_REF = /^books:OL[1-9][0-9]{0,11}W$/;
/** Your own file that you said is [ NOT LISTED ]. */
export const NOT_LISTED = 'none';

/** The work a ref names in itself, or null (an Archive, IPFS or own ref needs asking). */
export function workOf(bookRef: string): string | null {
  return /^(books:OL[1-9][0-9]{0,11}W)(?:-pg[1-9][0-9]{0,6})?$/.exec(bookRef)?.[1] ?? null;
}

/** A work ref as the tables take it, or null. */
export function cleanWork(value: unknown): string | null {
  return typeof value === 'string' && WORK_REF.test(value) ? value : null;
}

/** The forum thread a person's highlights in a book go to: one for the work when the copy is matched, else the copy's own. */
export function threadKeyOf(bookRef: string, work: string | null): string {
  return work ?? bookRef;
}

/** Where a highlight's post sends people back to: the copy in the reader, or the book's page for a copy nobody else holds. */
export function backLinkOf(bookRef: string, work: string | null): string {
  const hash = ownHash(bookRef);
  if (hash) return work ? `/media/book/${work}` : '/read';
  return `/read/${bookRef}`;
}

/** The work an IPFS book is a copy of, from the hand-made list. */
export function ipfsWork(cid: string): string | null {
  const work = IPFS_BOOKS.find((book) => book.cid === cid)?.work;
  return work ? `books:${work}` : null;
}

/** This browser's match for your own file (a visitor's, and a copy of the account's): `debaser-reader-work:<fingerprint>`. */
export const workKey = (bookRef: string) => `debaser-reader-work:${bookRef}`;

const archiveWorks = new Map<string, Promise<string | null>>();

/** The work an Archive book is a copy of, from archive.org's own metadata, read in the browser. Null when it names none. */
export function archiveWork(bookRef: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const held = archiveWorks.get(bookRef);
  if (held) return held;
  const asked = askArchiveWork(bookRef, fetchImpl);
  archiveWorks.set(bookRef, asked);
  return asked;
}

async function askArchiveWork(bookRef: string, fetchImpl: typeof fetch): Promise<string | null> {
  const id = archiveBookId(bookRef);
  if (!id) return null;
  try {
    const response = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}/metadata/openlibrary_work`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: unknown };
    const result = Array.isArray(body.result) ? body.result[0] : body.result;
    return typeof result === 'string' && /^OL[1-9][0-9]{0,11}W$/.test(result) ? `books:${result}` : null;
  } catch {
    return null;
  }
}

/** A work Open Library's search offered for your own file: its ref, title and first author, and a cover number. */
export type WorkMatch = { work: string; title: string; author: string; cover: number | null; editions?: number | null };

/** Open Library's search answer as matches: works only, plain text, at most `limit`. */
export function matchesOf(body: unknown, limit = 8): WorkMatch[] {
  const docs = body && typeof body === 'object' ? (body as { docs?: unknown }).docs : null;
  if (!Array.isArray(docs)) return [];
  const found: WorkMatch[] = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const { key, title, author_name: authors, cover_i: cover, edition_count: editions } = doc as Record<string, unknown>;
    const id = typeof key === 'string' ? /^\/works\/(OL[1-9][0-9]{0,11}W)$/.exec(key)?.[1] : undefined;
    if (!id || typeof title !== 'string' || !title.trim()) continue;
    const author = Array.isArray(authors) && typeof authors[0] === 'string' ? authors[0] : '';
    found.push({ work: `books:${id}`, title: title.trim().slice(0, 300), author: author.trim().slice(0, 200), cover: typeof cover === 'number' && Number.isInteger(cover) && cover > 0 ? cover : null,
      editions: typeof editions === 'number' && Number.isInteger(editions) && editions > 0 ? editions : null,
    });
    if (found.length >= limit) break;
  }
  return found;
}

/** The words a search sends: letters, digits and spaces only, at most 12 words. */
export function searchWords(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
}

/** Asks Open Library for works by a title (and an author, when the file names one). Nothing else is sent. */
export async function findWorks(title: string, author: string, fetchImpl: typeof fetch = fetch): Promise<WorkMatch[]> {
  const words = searchWords(title);
  if (!words) return [];
  const params = new URLSearchParams({ title: words, fields: 'key,title,author_name,cover_i,edition_count', limit: '8' });
  const by = searchWords(author);
  if (by) params.set('author', by);
  try {
    const response = await fetchImpl(`https://openlibrary.org/search.json?${params.toString()}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return [];
    const found = matchesOf(await response.json());
    // A file's author may be written oddly ("Stoker, Bram"): asked again by title alone when nothing came.
    if (found.length === 0 && by) return findWorks(title, '', fetchImpl);
    return found;
  } catch {
    return [];
  }
}

/** Asks Open Library for works by any words (the [ CHANGE ] search). */
export async function searchWorks(query: string, fetchImpl: typeof fetch = fetch): Promise<WorkMatch[]> {
  const words = searchWords(query);
  if (!words) return [];
  const params = new URLSearchParams({ q: words, fields: 'key,title,author_name,cover_i,edition_count', limit: '8' });
  try {
    const response = await fetchImpl(`https://openlibrary.org/search.json?${params.toString()}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    return response.ok ? matchesOf(await response.json()) : [];
  } catch {
    return [];
  }
}

/** How a match reads: `THIS IS: DRACULA BY BRAM STOKER`. */
export function matchLine(match: Pick<WorkMatch, 'title' | 'author'>): string {
  return `THIS IS: ${match.title.toUpperCase()}${match.author ? ` BY ${match.author.toUpperCase()}` : ''}`;
}

// ---------- a highlight made in another copy ----------

/** Which copy a highlight was made in, as its row in the highlights list says it. */
export function copyName(bookRef: string): string {
  if (ownHash(bookRef)) return "A READER'S OWN FILE";
  if (bookRef.startsWith('books:')) return "PROJECT GUTENBERG'S COPY";
  if (bookRef.startsWith('internet_archive:')) return 'AN INTERNET ARCHIVE COPY';
  if (bookRef.startsWith('ipfs:')) return 'A COPY ON IPFS';
  return 'ANOTHER COPY';
}

/** A highlight made in another copy of the same work (yours or another reader's public one). */
export function fromAnotherCopy(highlight: Pick<BookHighlight, 'bookRef'>, bookRef: string): boolean {
  return highlight.bookRef !== bookRef;
}

/**
 * What to search for to find a quote in another copy: its longest run of plain words, at most 80 characters, cut at a word.
 * Punctuation and spacing differ between copies, and a long phrase is enough to be sure.
 */
export function quoteProbe(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  const runs = flat.split(/[“”"‘’'«»—–\-()[\]{};:!?]+/).map((run) => run.trim()).filter((run) => run.length >= 12);
  const best = runs.sort((a, b) => b.length - a.length)[0] ?? flat;
  if (best.length <= 80) return best;
  const cut = best.slice(0, 80);
  return cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 80).trim();
}

// ---------- a PDF's highlights: a page and the characters within its words ----------

/** A page of a fixed-layout book as its short address (`epubcfi(/6/24)` is page 12), as the engine makes them. */
export function pageCfi(index: number): string {
  return `epubcfi(/6/${(index + 1) * 2})`;
}

/** The page index a fixed page's short address names, or null for any other CFI. */
export function pageOfCfi(cfi: string | null): number | null {
  const step = /^epubcfi\(\/6\/([1-9][0-9]{0,6})\)$/.exec(cfi ?? '')?.[1];
  if (!step) return null;
  const number = Number(step);
  return number % 2 === 0 ? number / 2 - 1 : null;
}

/** Characters before a point in a page's words: how a PDF highlight's start and end are kept. */
export function offsetIn(root: Node, node: Node, offset: number): number {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let count = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node) return count + offset;
    count += text.textContent?.length ?? 0;
  }
  // The point is on an element, not in a text: the characters of the text nodes before its child at `offset`.
  if (node.nodeType === 1) {
    const before = doc.createRange();
    before.setStart(root, 0);
    try {
      before.setEnd(node, offset);
      return before.toString().length;
    } catch {
      return count;
    }
  }
  return count;
}

/** The range of a page's words from character `start` to `end`, or null when the words are shorter (not drawn yet). */
export function rangeIn(root: Node, start: number, end: number): Range | null {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4);
  const range = doc.createRange();
  let count = 0;
  let started = false;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = text.textContent?.length ?? 0;
    if (!started && start <= count + length) {
      range.setStart(text, Math.max(0, start - count));
      started = true;
    }
    if (started && end <= count + length) {
      range.setEnd(text, Math.max(0, end - count));
      return range;
    }
    count += length;
  }
  return null;
}
