import { ipfsCid } from './ipfs';

/**
 * Book highlights, bookmarks and reading places (SPEC-books.md, Luke 2026-11-10; SPEC-reader.md, 2026-11-11). A book is
 * named by its MEDIA ref (`books:OL85892W-pg345`). A spot in it is an EPUB CFI (`epubcfi(/6/14!/4/2/10,/1:0,/1:45)`), the
 * standard address of a place in an e-book, since the reader shows Project Gutenberg's EPUB. Highlights made in the old
 * plain-text reader kept a paragraph number instead (`place`, `startAt`, `endAt`); those fields stay, at 0 for a CFI one.
 */

/** The five highlight colours, picked when highlighting (SPEC-reader.md). Each is a token in `app/lib/ui/themes.ts`. */
export const HIGHLIGHT_COLOURS = ['yellow', 'pink', 'green', 'blue', 'red'] as const;
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number];

export function isHighlightColour(value: unknown): value is HighlightColour {
  return typeof value === 'string' && (HIGHLIGHT_COLOURS as readonly string[]).includes(value);
}

export type BookHighlight = {
  id: string;
  person: string;
  bookRef: string;
  bookTitle: string;
  /** Where it is: a CFI, or null for one made in the old plain-text reader. */
  cfi: string | null;
  /** The old reader's paragraph, and the characters within it (0 for a CFI highlight). */
  place: number;
  startAt: number;
  endAt: number;
  quote: string;
  comment: string;
  colour: HighlightColour;
  isLocked: boolean;
  forumCommentId: string | null;
  createdAt: string;
  /** The Open Library work the copy it was made in is (`books:OL85892W`), or null (copies.ts). */
  workRef: string | null;
};

/**
 * A new highlight. A PDF's keeps its page in `cfi` (the page's short address, `epubcfi(/6/24)`) and the characters within
 * the page's words in `startAt` and `endAt`; an EPUB's CFI says it all.
 */
export type NewHighlight = Pick<BookHighlight, 'bookRef' | 'bookTitle' | 'cfi' | 'quote' | 'comment' | 'colour' | 'isLocked'> &
  Partial<Pick<BookHighlight, 'startAt' | 'endAt' | 'workRef'>>;

export type BookBookmark = { id: string; person: string; bookRef: string; cfi: string; label: string; createdAt: string };

/** Someone with public highlights in a book, for its page. Null person and name for a visitor (ANON). */
export type BookReader = { person: string | null; displayName: string | null; highlights: number; latest: string };

export const QUOTE_MAX = 300;
export const COMMENT_MAX = 1000;
export const BOOKMARK_LABEL_MAX = 120;
export const HIGHLIGHTS_PER_BOOK_MAX = 500;
export const BOOKMARKS_PER_BOOK_MAX = 200;
export const CFI_MAX = 600;

/** A CFI the tables take: `epubcfi(...)`, 10 to 600 characters (the database's own check says the same). */
export function isCfi(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= CFI_MAX && value.startsWith('epubcfi(') && value.endsWith(')');
}

/**
 * Where a person is in one book (SPEC-reading-places.md, Luke 2026-11-13): its place (a CFI; for a PDF or a scanned book's
 * pictures also the page, from 1, else 0), the title the reader showed, how far through (0 to 100), when it was finished (or
 * null), and when it was last read. A reader's own file is `own:<SHA-256 of its bytes>`: the file itself is never stored.
 */
export type BookPlace = {
  bookRef: string;
  cfi: string | null;
  page: number;
  title: string;
  progress: number;
  finishedAt: string | null;
  updatedAt: string;
  /** The work this copy is (`books:OL85892W`), `none` for your own file you said is NOT LISTED, or null (copies.ts). */
  workRef?: string | null;
};

/** What the reader saves on a page turn. A blank title leaves the saved one as it was; a missing work leaves the saved one. */
export type PlaceSave = Pick<BookPlace, 'cfi' | 'page' | 'title' | 'progress' | 'finishedAt'> & { workRef?: string | null };

export const PLACE_TITLE_MAX = 300;
export const PLACES_LISTED_MAX = 200;

/** A reader's own file as a book ref: `own:` and the 64 hex characters of its SHA-256. */
export function ownRef(hash: string): string | null {
  return /^[0-9a-f]{64}$/.test(hash) ? `own:${hash}` : null;
}

/** The fingerprint in an own-file ref, or null for any other ref. */
export function ownHash(bookRef: string): string | null {
  return /^own:([0-9a-f]{64})$/.exec(bookRef)?.[1] ?? null;
}

/** A place as the tables take it: the CFI checked, the page a whole number, the title cut to 300, the percent 0 to 100. */
export function cleanPlace(place: PlaceSave): PlaceSave {
  const page = Number.isFinite(place.page) ? Math.min(1_000_000, Math.max(0, Math.floor(place.page))) : 0;
  const progress = Number.isFinite(place.progress) ? Math.min(100, Math.max(0, Math.floor(place.progress))) : 0;
  return {
    cfi: isCfi(place.cfi) ? place.cfi : null,
    page,
    title: place.title.replace(/\s+/g, ' ').trim().slice(0, PLACE_TITLE_MAX),
    progress,
    finishedAt: place.finishedAt && !Number.isNaN(Date.parse(place.finishedAt)) ? place.finishedAt : null,
    // A work, `none` (your own file, NOT LISTED), or left out (the saved one stays).
    ...(typeof place.workRef === 'string' && /^(books:OL[1-9][0-9]{0,11}W|none)$/.test(place.workRef) ? { workRef: place.workRef } : {}),
  };
}

export type BooksRepository = {
  /** This reader's own highlights in a book, in the order they were made. */
  mine(person: string, bookRef: string): Promise<BookHighlight[]>;
  add(person: string, highlight: NewHighlight): Promise<BookHighlight>;
  update(id: string, patch: Partial<Pick<BookHighlight, 'comment' | 'isLocked' | 'forumCommentId' | 'colour'>>): Promise<void>;
  remove(id: string): Promise<void>;
  /** One highlight, if this reader may see it (a letter's or a recommendation's card, a `?h=` link). */
  get(id: string): Promise<BookHighlight | null>;
  readers(bookRef: string): Promise<BookReader[]>;
  /** Where this reader left off in a book, how far through, and whether they finished it. */
  place(person: string, bookRef: string): Promise<BookPlace | null>;
  savePlace(person: string, bookRef: string, place: PlaceSave): Promise<void>;
  /** Every book this reader has a place in, newest first (CONTINUE READING and READ on /read). */
  places(person: string): Promise<BookPlace[]>;
  /** `[ NOT FINISHED ]`: the book goes back to CONTINUE READING. */
  unfinish(person: string, bookRef: string): Promise<void>;
  /**
   * Every highlight in any copy of this book this reader may see (Luke, 2026-11-13): their own, locked or not, and other
   * readers' public ones; the copy's own, and, when its work is known, every other copy's of the same work.
   */
  acrossCopies(person: string, bookRef: string, work: string | null): Promise<BookHighlight[]>;
  /** This reader's places in every copy of a work (to offer `CONTINUE FROM 42% (READ IN ANOTHER COPY)`). */
  placesOfWork(person: string, work: string): Promise<BookPlace[]>;
  /** Ties a copy (your own file) to its work, or `none` for NOT LISTED; the place, if any, stays as it was. */
  setWork(person: string, bookRef: string, work: string): Promise<void>;
  bookmarks(person: string, bookRef: string): Promise<BookBookmark[]>;
  addBookmark(person: string, bookmark: Pick<BookBookmark, 'bookRef' | 'cfi' | 'label'>): Promise<BookBookmark>;
  removeBookmark(id: string): Promise<void>;
  /** This person's reader look settings, as saved (checked by `readerSettingsFrom` before use), or null. */
  readerSettings(person: string): Promise<unknown>;
  saveReaderSettings(person: string, settings: Record<string, unknown>): Promise<void>;
};

/** A book's forum thread for one person: one per person and book, found by its anchor (as a stream's is). */
export function bookThreadAnchor(person: string, bookRef: string, label: string): { kind: 'board'; id: string; label: string } {
  return { kind: 'board', id: `book:${person}:${bookRef}`, label: label.slice(0, 200) };
}

/** "[NAME] READING [BOOK]": the thread's title (SPEC-books.md). */
export function bookThreadTitle(name: string, bookTitle: string): string {
  return `${name.toUpperCase()} READING ${bookTitle.toUpperCase()}`.slice(0, 200);
}

const BOOK_ITEM = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|internet_archive:[A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;
const ARCHIVE_BOOK = /^internet_archive:([A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;

/**
 * A book the reader can open: a Gutenberg one (its MEDIA ref carries a Gutenberg number), an Internet Archive book
 * (Luke, 2026-11-11), read in the site's reader when it has its own EPUB and in the Archive's viewer when it hasn't, or a
 * book on IPFS by its CID (`ipfs:<CID>`, Luke 2026-11-11), fetched by the reader's own browser from a gateway (`ipfs.ts`).
 */
export function isReadable(bookRef: string): boolean {
  return /^books:OL[1-9][0-9]{0,11}W-pg[1-9][0-9]{0,6}$/.test(bookRef) || ARCHIVE_BOOK.test(bookRef) || ipfsCid(bookRef) !== null;
}

/** An Internet Archive book's identifier, or null for any other ref. */
export function archiveBookId(bookRef: string): string | null {
  return ARCHIVE_BOOK.exec(bookRef)?.[1] ?? null;
}

/** The Archive's own viewer for one of its books, for one with no EPUB: played from archive.org, nothing passes through us. */
export function archiveViewerUrl(bookRef: string): string | null {
  const id = archiveBookId(bookRef);
  return id === null ? null : `https://archive.org/embed/${id}`;
}

/** A CFI as an address's `at=`: the characters a query keeps as they are (`/`, `:`, `,`, `!`) left readable. */
export function cfiParam(cfi: string): string {
  return encodeURIComponent(cfi).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',');
}

/** The reader's address for a book, at a spot (a CFI) or a highlight (its id, looked up when the page opens). */
export function readHref(bookRef: string, spot: { cfi?: string | null; highlight?: string } = {}): string {
  const base = `/read/${bookRef}`;
  if (spot.highlight) return `${base}?h=${encodeURIComponent(spot.highlight)}`;
  if (spot.cfi) return `${base}?at=${cfiParam(spot.cfi)}`;
  return base;
}

/** A highlight's post in that thread: the quote, the comment, and the way back to that spot. Plain text. */
export function highlightPost(highlight: Pick<BookHighlight, 'quote' | 'comment' | 'bookRef' | 'cfi'>, backLink?: string): string {
  // A reader's own file has no address anyone else can open: its post points at the book's page instead (copies.ts).
  const back = backLink ?? readHref(highlight.bookRef, { cfi: highlight.cfi });
  return [`"${highlight.quote}"`, highlight.comment.trim(), `READ IT THERE: ${back}`].filter(Boolean).join('\n\n');
}

/** A highlight as a letter's or a recommendation's item: `<book>|<paragraph>|<highlight id>`, so its card knows where to go. */
export function highlightRef(highlight: Pick<BookHighlight, 'bookRef' | 'place' | 'id'>): string {
  return `${highlight.bookRef}|${highlight.place}|${highlight.id}`;
}

/** Where a highlight item goes: the reader at that highlight (or the book, for an old item without an id), or null. */
export function highlightHref(ref: string): string | null {
  const [bookRef, place, id] = ref.split('|');
  if (!BOOK_ITEM.test(bookRef ?? '') || !/^[0-9]{1,7}$/.test(place ?? '')) return null;
  return /^[A-Za-z0-9-]{1,64}$/.test(id ?? '') ? readHref(bookRef, { highlight: id }) : readHref(bookRef);
}
