import { findWorks, matchesOf, searchWords, searchWorks, WORK_REF, type WorkMatch } from './copies';

/**
 * The READ module's own files (Luke, 2026-11-13: "upload pdfs to be read, which will then automatically hook to the correct
 * book and all its variants"). A reader's PDF or EPUB never leaves their device: this works out which book it is, in the
 * browser, so its place and highlights count as that book's in every copy (copies.ts); and `own-library.ts` keeps the file
 * in this browser's own storage so it stays on the shelf.
 *
 * Which book, strongest first:
 * 0. The Internet Archive item it was downloaded from, when it names one (an Archive PDF's Keywords say
 *    `archive.org/details/<id>`): the item's own metadata names its Open Library work.
 * 1. The ISBN printed inside it (an EPUB's identifiers; the words of a PDF's first and last pages): an exact edition, asked
 *    of Open Library's search by that number, which answers with the edition's work.
 * 2. The title and author written inside it, unless they are a word processor's leftovers ("Microsoft Word - x.docx").
 * 3. The words of its file name, with the usual clutter taken out. Only searched with: never saved, shown or posted.
 * Only those words or numbers go to Open Library (CORS `*`, checked 2026-11-13); the file itself goes nowhere.
 */

/** How a file's book was found, as its card says it. */
export type MatchHow = 'saved' | 'chosen' | 'archive' | 'isbn' | 'inside' | 'name';

export const HOW_LINE: Record<MatchHow, string> = {
  saved: 'YOU MATCHED THIS FILE BEFORE',
  chosen: 'CHOSEN BY YOU',
  archive: 'FOUND BY THE INTERNET ARCHIVE ADDRESS INSIDE',
  isbn: 'FOUND BY THE ISBN PRINTED INSIDE',
  inside: 'FOUND BY THE TITLE WRITTEN INSIDE',
  name: 'FOUND BY THE FILE NAME',
};

// ---------- ISBNs ----------

/** An ISBN-10's check digit holds (the last may be X, ten). */
export function isbn10Valid(digits: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) sum += (digits[index] === 'X' ? 10 : Number(digits[index])) * (10 - index);
  return sum % 11 === 0;
}

/** An ISBN-13's check digit holds, and it is a book's (978 or 979). */
export function isbn13Valid(digits: string): boolean {
  if (!/^97[89][0-9]{10}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 13; index += 1) sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

/** An ISBN-10 written as its ISBN-13, so the same book found both ways is one. */
export function isbn13Of(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/**
 * The ISBNs in some text, as ISBN-13s, first found first, at most `max`. A 13-digit run starting 978 or 979 counts anywhere
 * its check digit holds; a 10-digit one only just after the word ISBN (a random number passes its check one time in eleven),
 * or anywhere when `labelled` (the text is an identifier field already).
 */
export function isbnsIn(text: string, { labelled = false, max = 5 }: { labelled?: boolean; max?: number } = {}): string[] {
  const found: string[] = [];
  // Digits with at most one space or hyphen between them, ending in a digit or X.
  const runs = /(?<![0-9Xx])([0-9](?:[ ‐‑‒–-]?[0-9]){8,11}[ ‐‑‒–-]?[0-9Xx])(?![0-9Xx])/g;
  for (const hit of text.matchAll(runs)) {
    const digits = hit[1].replace(/[^0-9Xx]/g, '').toUpperCase();
    const before = text.slice(Math.max(0, (hit.index ?? 0) - 24), hit.index ?? 0);
    let isbn: string | null = null;
    if (digits.length === 13 && isbn13Valid(digits)) isbn = digits;
    else if (digits.length === 10 && isbn10Valid(digits) && (labelled || /ISBN/i.test(before))) isbn = isbn13Of(digits);
    if (isbn && !found.includes(isbn)) found.push(isbn);
    if (found.length >= max) break;
  }
  return found;
}

// ---------- an Internet Archive item ----------

/** The Internet Archive item some text names (`archive.org/details/<id>`), or null. */
export function archiveIdIn(text: string): string | null {
  return /archive\.org\/details\/([A-Za-z0-9][A-Za-z0-9._-]{0,100})/.exec(text)?.[1] ?? null;
}

/** An Archive item's Open Library work, title and creator, from archive.org's public metadata API (CORS `*`). */
export async function workByArchive(id: string, fetchImpl: typeof fetch = fetch): Promise<WorkMatch | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(id)) return null;
  try {
    const response = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}/metadata`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const meta = ((await response.json()) as { result?: Record<string, unknown> }).result ?? {};
    const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
    const workId = first(meta.openlibrary_work);
    const work = typeof workId === 'string' ? `books:${workId}` : '';
    if (!WORK_REF.test(work)) return null;
    const title = first(meta.title);
    const creator = first(meta.creator);
    return {
      work,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 300) : 'THE MATCHED BOOK',
      author: typeof creator === 'string' ? cleanAuthor(creator) : '',
      cover: null,
    };
  } catch {
    return null;
  }
}

// ---------- the words inside a file, and its name ----------

/** An author as a catalogue writes them ("Carroll, Lewis, 1832-1898"): their life dates taken off. */
export function cleanAuthor(value: string): string {
  return value
    .replace(/,?\s*\(?\d{3,4}\s*-\s*(\d{3,4})?\)?\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** The titles to try for a title written inside: all of it, then the part before a subtitle or a second book. */
export function titleTries(title: string): string[] {
  const main = title.split(/\s+[:;/]\s*|\s*[;:]\s+|\s+\(|\s+-\s+/)[0].trim();
  return main && main !== title && /\p{L}{3,}/u.test(main) ? [title, main] : [title];
}

/** A title written inside a file, unless it is a word processor's or scanner's leftover. */
export function usableTitle(value: string): string {
  const title = value
    .replace(/^\s*Microsoft (Word|PowerPoint) - /i, '')
    .replace(/\.(docx?|odt|rtf|pdf|epub|indd|tex|txt)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\p{L}/u.test(title) || title.length < 2) return '';
  if (/^(untitled|document|title|unknown|none|null|book|scan|scanned|image|print|pdf|epub|ebook|cover)[\s\d_-]*$/i.test(title)) return '';
  // A title that is only a file name or a long run of letters and digits (a scanner's numbering, a hash).
  if (/^[\w-]+\.\w{2,4}$/.test(title) || /^[A-Za-z0-9_-]{20,}$/.test(title)) return '';
  return title;
}

/** Clutter that file names carry and a book's name never does. */
const NAME_CLUTTER =
  /\b(z-?lib(rary)?(\.org)?|libgen(\.\w+)?|anna'?s archive|b-?ok\.\w+|pdfdrive|oceanofpdf|epub|mobi|azw3?|pdf|retail|ebook|e-book|scan(ned)?|ocr|v\d+|final|copy|draft|img|dsc|dcim|untitled|document\d*|www\.\S+|\S+\.(com|org|net))\b/gi;

/** The words of a file's name worth searching for its book, or '' when none are. */
export function nameWords(fileName: string): string {
  const words = fileName
    .replace(/\.(pdf|epub)$/i, '')
    // Brackets holding a year, a site or a format: "(1911)", "[EPUB]", "(z-lib.org)". Others (an author) stay.
    .replace(/[([{][^)\]}]*(\d{3,}|z-?lib|libgen|epub|pdf|retail|\.org|\.com)[^)\]}]*[)\]}]/gi, ' ')
    .replace(/[_+.]+/g, ' ')
    .replace(NAME_CLUTTER, ' ')
    // A long run of digits (a scanner's numbering, an ISBN already tried) isn't a name.
    .replace(/\b\d{5,}\b/g, ' ')
    // A year isn't a name either.
    .replace(/\b(1[4-9]|20)\d\d\b/g, ' ');
  const clean = searchWords(words);
  // At least one real word of three letters or more.
  return clean.split(' ').some((word) => /^\p{L}{3,}$/u.test(word)) ? clean : '';
}

// ---------- reading a file ----------

/** What a file says about itself: its ISBNs, the title and author written inside it, and its name. */
export type FileIdentity = { isbns: string[]; title: string; author: string; name: string; archive?: string | null };

/** Every string inside an identifier field (a string, a list, or `{ value }` objects). */
function stringsIn(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((each) => stringsIn(each, depth + 1));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap((each) => stringsIn(each, depth + 1));
  return [];
}

/** The engine's book, as far as this reads it. */
export type ReadableBook = {
  metadata?: { title?: unknown; author?: unknown; identifier?: unknown; altIdentifier?: unknown; keywords?: unknown; description?: unknown; source?: unknown } | null;
  sections?: readonly { createDocument?: () => Promise<Document> }[];
  pageText?: (index: number) => Promise<string>;
};

/** How many of a PDF's first pages, and last, are read for an ISBN (the copyright page is in the first few, or the back). */
const FRONT_PAGES = 12;
const BACK_PAGES = 2;
const EPUB_SECTIONS = 6;

/** The words of the pages where a book prints its ISBN, read without drawing anything. Never sent anywhere. */
export async function pagesText(book: ReadableBook): Promise<string> {
  const total = book.sections?.length ?? 0;
  const parts: string[] = [];
  if (book.pageText) {
    const pages = [...Array(Math.min(total, FRONT_PAGES)).keys()];
    for (let index = Math.max(FRONT_PAGES, total - BACK_PAGES); index < total; index += 1) pages.push(index);
    for (const index of pages) parts.push(await book.pageText(index).catch(() => ''));
  } else {
    for (const section of (book.sections ?? []).slice(0, EPUB_SECTIONS)) {
      const doc = await section.createDocument?.().catch(() => null);
      parts.push(doc?.body?.textContent ?? '');
    }
  }
  return parts.join('\n');
}

/** A file's identity from the engine's book (opened in the browser), with its name kept for the last resort. */
export async function identify(book: ReadableBook, fileName: string, text: (value: unknown) => string): Promise<FileIdentity> {
  const fields = [...stringsIn(book.metadata?.identifier), ...stringsIn(book.metadata?.altIdentifier)];
  const isbns = isbnsIn(fields.join('\n'), { labelled: true });
  const pages = await pagesText(book);
  for (const isbn of isbnsIn(pages)) if (!isbns.includes(isbn)) isbns.push(isbn);
  const named = [...fields, ...stringsIn(book.metadata?.keywords), ...stringsIn(book.metadata?.description), ...stringsIn(book.metadata?.source)].join('\n');
  return {
    isbns: isbns.slice(0, 5),
    title: usableTitle(text(book.metadata?.title)),
    author: cleanAuthor(text(book.metadata?.author)),
    name: fileName,
    archive: archiveIdIn(named) ?? archiveIdIn(pages),
  };
}

/** Asks Open Library for the work an ISBN's edition belongs to. */
export async function workByIsbn(isbn: string, fetchImpl: typeof fetch = fetch): Promise<WorkMatch | null> {
  if (!isbn13Valid(isbn)) return null;
  const params = new URLSearchParams({ isbn, fields: 'key,title,author_name,cover_i,edition_count', limit: '1' });
  try {
    const response = await fetchImpl(`https://openlibrary.org/search.json?${params.toString()}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    return response.ok ? (matchesOf(await response.json(), 1)[0] ?? null) : null;
  } catch {
    return null;
  }
}

/** The book a file is, strongest way first (above), and how it was found; null when none of them finds one. */
export async function matchFile(identity: FileIdentity, fetchImpl: typeof fetch = fetch): Promise<{ match: WorkMatch; how: MatchHow } | null> {
  if (identity.archive) {
    const match = await workByArchive(identity.archive, fetchImpl);
    if (match) return { match, how: 'archive' };
  }
  for (const isbn of identity.isbns.slice(0, 3)) {
    const match = await workByIsbn(isbn, fetchImpl);
    if (match) return { match, how: 'isbn' };
  }
  // All of the title, then the part before a subtitle or a second book ("X : and, Y").
  for (const title of identity.title ? titleTries(identity.title) : []) {
    const match = (await findWorks(title, identity.author, fetchImpl))[0];
    if (match) return { match, how: 'inside' };
  }
  const words = nameWords(identity.name);
  if (words) {
    const match = (await searchWorks(words, fetchImpl))[0];
    if (match) return { match, how: 'name' };
  }
  return null;
}

/** A work's cover from Open Library, hotlinked like every cover on the site. */
export function workCover(cover: number | null | undefined, size: 'S' | 'M' = 'M'): string | null {
  return typeof cover === 'number' && Number.isInteger(cover) && cover > 0 ? `https://covers.openlibrary.org/b/id/${cover}-${size}.jpg` : null;
}

/** A file's size as a row says it. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
