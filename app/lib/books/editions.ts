import { sanitiseText } from '../web/sanitise';

/**
 * Every edition of every book (SPEC-book-editions.md, Luke 2026-11-11): one Open Library edition as the book's page lists it,
 * and the pure rules for the list (reading an edition, how detailed it is, the order and the filters, and the ways to read
 * it). No fetching here, so the page may import it; the server's reading is `app/lib/web/book-editions.ts`.
 *
 * Only these fields of an edition are read: title, subtitle, edition_name, publishers, publish_date, number_of_pages,
 * pagination, physical_format, isbn_10, isbn_13, covers, contributions, contributors (Open Library's newer name for the same
 * people, with their role), by_statement, notes, table_of_contents, ocaid, works, languages. Every one is plain text after
 * `sanitiseText`. No counts or ratings exist in an edition, and none are asked for.
 */

/** An Open Library edition key: `OL7247530M`. */
export const EDITION_KEY = /^OL[1-9][0-9]{0,11}M$/;
/** An Open Library work key: `OL85892W`. */
export const WORK_KEY_ID = /^OL[1-9][0-9]{0,11}W$/;
/** An Internet Archive identifier as Open Library names a scan (`ocaid`). */
const OCAID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
/** About fifty editions to a page of the list (SPEC-book-editions.md). */
export const EDITIONS_PAGE_SIZE = 50;

export type EditionFormat = 'PAPERBACK' | 'HARDCOVER' | 'EBOOK' | 'AUDIO' | string;

export type Edition = {
  /** `OL7247530M`. */
  key: string;
  title: string;
  subtitle: string;
  /** `Norton Critical Edition`. */
  editionName: string;
  publishers: string[];
  /** The date as printed (`October 1, 2003`), and its year when one can be read from it. */
  publishDate: string;
  year: number | null;
  pages: number | null;
  /** PAPERBACK, HARDCOVER, EBOOK, AUDIO, or Open Library's own word in capitals. */
  format: EditionFormat;
  /** ISBN-13 when it has one, else ISBN-10. */
  isbn: string;
  /** An Open Library cover number. */
  cover: number | null;
  /** Who else is in it: `Introduction by …`, `Notes by …`. */
  contributors: string[];
  byStatement: string;
  notes: string;
  contents: string[];
  /** Its Internet Archive scan, when Open Library names one. */
  ocaid: string | null;
  /** Its work, `OL85892W`. */
  work: string | null;
  /** Language codes, `ENG`. */
  languages: string[];
};

/** Whether an edition's Archive scan is free to read here, a lending-library copy, or not known (no scan, or not found). */
export type ScanAccess = 'free' | 'lent' | null;

/** An edition as the list sends it: the edition, and what the Archive says about its scan. */
export type ListedEdition = Edition & { scan: ScanAccess };

export type EditionsShow = 'all' | 'readable' | 'details';
export type EditionsOrder = 'details' | 'newest' | 'oldest';
export const EDITIONS_SHOWS: readonly EditionsShow[] = ['all', 'readable', 'details'];
export const EDITIONS_ORDERS: readonly EditionsOrder[] = ['details', 'newest', 'oldest'];

function strings(value: unknown, max: number, each = 300): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.flatMap((entry) => {
    const text = sanitiseText(entry, each);
    return text ? [text] : [];
  }).slice(0, max);
}

/** Open Library's text values come as a string or as `{ type: '/type/text', value }`. */
function textValue(value: unknown, max: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return sanitiseText((value as Record<string, unknown>).value, max);
  return sanitiseText(value, max);
}

/** The first plausible year in a printed date (`October 1, 2003`, `1897?`, `c1965`), or null. */
export function yearOf(date: string, now: Date = new Date()): number | null {
  const match = /(?:^|[^0-9])([0-9]{4})(?![0-9])/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= now.getUTCFullYear() + 1 ? year : null;
}

/** Open Library's free-text format as one of the four the page names, or its own word in capitals. */
export function formatOf(value: unknown): EditionFormat {
  const text = sanitiseText(value, 60);
  if (!text) return '';
  const lower = text.toLowerCase();
  if (/audio|cassette|\bcd\b|mp3|sound/.test(lower)) return 'AUDIO';
  if (/e-?book|electronic|kindle|epub|digital|online/.test(lower)) return 'EBOOK';
  if (/hard|cloth|library binding/.test(lower)) return 'HARDCOVER';
  if (/paper|soft|mass market|trade/.test(lower)) return 'PAPERBACK';
  return text.toUpperCase().slice(0, 40);
}

const ISBN_13 = /^97[89][0-9]{10}$/;
const ISBN_10 = /^[0-9]{9}[0-9X]$/;

/** An ISBN as typed (`978-0-14-143984-6`, `0 14 143984 6`, `isbn 0141439846`): its digits, or null when it isn't one. */
export function isbnOf(text: string): string | null {
  const bare = text.trim().replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (ISBN_13.test(bare)) {
    const sum = [...bare].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return sum % 10 === 0 ? bare : null;
  }
  if (ISBN_10.test(bare)) {
    const sum = [...bare].reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0 ? bare : null;
  }
  return null;
}

function keyOf(value: unknown, pattern: RegExp, prefix: string): string | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return pattern.test(id) ? id : null;
}

/** One contributor as a line: `Introduction by A. N. Other`, from `contributions` (`A. N. Other (Introduction)`) or `contributors` (`{ role, name }`). */
function contributorLines(record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const entry of strings(record.contributions, 20, 200)) {
    const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(entry);
    lines.push(match && match[1] ? `${match[2]} by ${match[1]}` : entry);
  }
  if (Array.isArray(record.contributors)) {
    for (const raw of record.contributors.slice(0, 20)) {
      const person = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const name = sanitiseText(person?.name, 200);
      if (!name) continue;
      // Some roles already end in "by" (`Notes by`): not said twice.
      const role = sanitiseText(person?.role, 60).replace(/\s+by$/i, '');
      lines.push(role ? `${role} by ${name}` : name);
    }
  }
  return [...new Set(lines)].slice(0, 20);
}

/** One edition from Open Library's answer, or null when it has no edition key or no title. */
export function parseEdition(raw: unknown, now: Date = new Date()): Edition | null {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!record) return null;
  const key = keyOf(record.key, EDITION_KEY, '/books/');
  if (!key) return null;
  const title = sanitiseText(record.title, 300);
  if (!title) return null;
  const publishDate = sanitiseText(record.publish_date, 60);
  const pages = typeof record.number_of_pages === 'number' && Number.isInteger(record.number_of_pages) && record.number_of_pages > 0 && record.number_of_pages < 100_000
    ? record.number_of_pages
    : (() => {
        // `pagination` is free text (`xii, 418 p.`): its largest number is the page count.
        const numbers = (sanitiseText(record.pagination, 100).match(/[0-9]{1,5}/g) ?? []).map(Number).filter((n) => n > 0);
        return numbers.length > 0 ? Math.max(...numbers) : null;
      })();
  const isbn13 = strings(record.isbn_13, 5, 20).map((value) => value.replace(/-/g, '')).find((value) => ISBN_13.test(value));
  const isbn10 = strings(record.isbn_10, 5, 20).map((value) => value.replace(/-/g, '').toUpperCase()).find((value) => ISBN_10.test(value));
  const cover = Array.isArray(record.covers) ? record.covers.find((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0) ?? null : null;
  const ocaid = typeof record.ocaid === 'string' && OCAID.test(record.ocaid) ? record.ocaid : null;
  const works = Array.isArray(record.works) ? record.works : [];
  const work = works.map((entry) => keyOf(entry && typeof entry === 'object' ? (entry as Record<string, unknown>).key : null, WORK_KEY_ID, '/works/')).find((id) => id !== null) ?? null;
  const languages = (Array.isArray(record.languages) ? record.languages : [])
    .map((entry) => keyOf(entry && typeof entry === 'object' ? (entry as Record<string, unknown>).key : null, /^[a-z]{3}$/, '/languages/'))
    .filter((code): code is string => code !== null)
    .map((code) => code.toUpperCase())
    .slice(0, 5);
  const contents = (Array.isArray(record.table_of_contents) ? record.table_of_contents : [])
    .slice(0, 200)
    .map((entry) => {
      if (typeof entry === 'string') return sanitiseText(entry, 200);
      const part = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return [sanitiseText(part.label, 40), sanitiseText(part.title, 200)].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .slice(0, 100);
  return {
    key,
    title,
    subtitle: sanitiseText(record.subtitle, 300),
    editionName: sanitiseText(record.edition_name, 120),
    publishers: strings(record.publishers, 3, 200),
    publishDate,
    year: yearOf(publishDate, now),
    pages,
    format: formatOf(record.physical_format),
    isbn: isbn13 ?? isbn10 ?? '',
    cover,
    contributors: contributorLines(record),
    byStatement: sanitiseText(record.by_statement, 400),
    notes: textValue(record.notes, 1000),
    contents,
    ocaid,
    work,
    languages,
  };
}

/** Contributors, a statement of who made it, notes or a contents list: what HAS DETAILS keeps. */
export function hasDetails(edition: Edition): boolean {
  return edition.contributors.length > 0 || edition.byStatement !== '' || edition.notes !== '' || edition.contents.length > 0;
}

/**
 * How much an edition tells: who else is in it, notes and contents count most, then an edition name, a scan, a cover, and
 * the plain facts. A bare print-on-demand reprint (title, publisher, ISBN, date) scores low and sinks.
 */
export function detailScore(edition: Edition): number {
  return (
    (edition.contributors.length > 0 ? 4 : 0) +
    (edition.byStatement ? 2 : 0) +
    (edition.notes ? 3 : 0) +
    (edition.contents.length > 0 ? 4 : 0) +
    (edition.editionName ? 3 : 0) +
    (edition.ocaid ? 2 : 0) +
    (edition.cover !== null ? 2 : 0) +
    (edition.subtitle ? 1 : 0) +
    (edition.pages !== null ? 1 : 0) +
    (edition.format ? 1 : 0) +
    (edition.publishers.length > 0 ? 1 : 0) +
    (edition.isbn ? 1 : 0) +
    (edition.year !== null ? 1 : 0)
  );
}

/** The list in an order: most details first (newer first among equals), newest, or oldest; an edition with no year goes last. */
export function sortEditions<T extends Edition>(editions: readonly T[], order: EditionsOrder): T[] {
  const byKey = (a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const newer = (a: T, b: T) => (a.year === b.year ? 0 : a.year === null ? 1 : b.year === null ? -1 : b.year - a.year);
  const older = (a: T, b: T) => (a.year === b.year ? 0 : a.year === null ? 1 : b.year === null ? -1 : a.year - b.year);
  const compare =
    order === 'newest'
      ? (a: T, b: T) => newer(a, b) || byKey(a, b)
      : order === 'oldest'
        ? (a: T, b: T) => older(a, b) || byKey(a, b)
        : (a: T, b: T) => detailScore(b) - detailScore(a) || newer(a, b) || byKey(a, b);
  return [...editions].sort(compare);
}

/** ALL, CAN BE READ HERE (its own scan is free to read here), or HAS DETAILS. */
export function filterEditions<T extends ListedEdition>(editions: readonly T[], show: EditionsShow): T[] {
  if (show === 'readable') return editions.filter((edition) => edition.scan === 'free');
  if (show === 'details') return editions.filter(hasDetails);
  return [...editions];
}

/** One way to read an edition, as its row's key. */
export type WayToRead =
  | { kind: 'scan'; href: string }
  | { kind: 'borrow'; href: string }
  | { kind: 'archive'; href: string }
  | { kind: 'gutenberg'; href: string }
  | { kind: 'ipfs'; href: string }
  | { kind: 'none'; href: string };

/**
 * Every legal way to read an edition that a source covers (SPEC-book-editions.md; Luke, 2026-11-13: "any book can be read
 * in the ereader"): every way opens inside the site's reader. A free scan reads its EPUB or PDF a slice at a time; a
 * lending-library scan opens the Archive's own viewer at `/read/internet_archive:<ocaid>`, which carries the Archive's
 * borrow flow with nothing passing through our server; a scan the Archive's search didn't find opens the same way, since
 * the reader's route asks the Archive's metadata again and falls through to the viewer when needed. The work's Project
 * Gutenberg copy and its IPFS copy read in the reader. With none, NO FREE COPY opens the reader on the work, which
 * shows a page with a link to Open Library (libraries and shops are listed there) inside its own frame.
 */
export function waysToRead(edition: ListedEdition, work: { gutenbergRef: string | null; ipfsCid: string | null; key?: string }): WayToRead[] {
  const ways: WayToRead[] = [];
  if (edition.ocaid && edition.scan === 'free') ways.push({ kind: 'scan', href: `/read/internet_archive:${edition.ocaid}` });
  if (edition.ocaid && edition.scan === 'lent') ways.push({ kind: 'borrow', href: `/read/internet_archive:${edition.ocaid}` });
  if (edition.ocaid && edition.scan === null) ways.push({ kind: 'archive', href: `/read/internet_archive:${edition.ocaid}` });
  if (work.gutenbergRef) ways.push({ kind: 'gutenberg', href: `/read/${work.gutenbergRef}` });
  if (work.ipfsCid) ways.push({ kind: 'ipfs', href: `/read/ipfs:${work.ipfsCid}` });
  if (ways.length === 0) {
    const workKey = edition.work;
    ways.push({ kind: 'none', href: workKey ? `/read/books:${workKey}` : `https://openlibrary.org/books/${edition.key}` });
  }
  return ways;
}

/** A cover's address on Open Library's cover server: `S` small, `M` medium. */
export function coverUrl(cover: number, size: 'S' | 'M' = 'S'): string {
  return `https://covers.openlibrary.org/b/id/${cover}-${size}.jpg`;
}

/** `1,920 EDITIONS`, `1 EDITION`. */
export function editionCount(count: number): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? 'EDITION' : 'EDITIONS'}`;
}

/** The list's answer from `/api/web/book/editions`. */
export type EditionsAnswer = {
  /** How many editions the work has in all, as Open Library counts them. */
  size: number;
  /** How many were read (at most `EDITIONS_READ_MAX`), and how many of those this filter keeps. */
  read: number;
  matching: number;
  editions: ListedEdition[];
  next: number | null;
  /** The edition the page was opened at, when asked for (`at=`), wherever it falls in the list. */
  at: ListedEdition | null;
  gutenbergRef: string | null;
  ipfsCid: string | null;
};
