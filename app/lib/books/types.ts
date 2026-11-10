/**
 * Book highlights and reading places (SPEC-books.md, Luke 2026-11-10). A book is named by its MEDIA ref
 * (`books:OL85892W-pg345`); a place is a paragraph number in its text; a highlight is a few words of one paragraph.
 */

export type BookHighlight = {
  id: string;
  person: string;
  bookRef: string;
  bookTitle: string;
  /** The paragraph, and the characters within it. */
  place: number;
  startAt: number;
  endAt: number;
  quote: string;
  comment: string;
  isLocked: boolean;
  forumCommentId: string | null;
  createdAt: string;
};

export type NewHighlight = Pick<BookHighlight, 'bookRef' | 'bookTitle' | 'place' | 'startAt' | 'endAt' | 'quote' | 'comment' | 'isLocked'>;

/** Someone with public highlights in a book, for its page. Null person and name for a visitor (ANON). */
export type BookReader = { person: string | null; displayName: string | null; highlights: number; latest: string };

export const QUOTE_MAX = 300;
export const COMMENT_MAX = 1000;
export const HIGHLIGHTS_PER_BOOK_MAX = 500;

export type BooksRepository = {
  /** This reader's own highlights in a book, in reading order. */
  mine(person: string, bookRef: string): Promise<BookHighlight[]>;
  add(person: string, highlight: NewHighlight): Promise<BookHighlight>;
  update(id: string, patch: Partial<Pick<BookHighlight, 'comment' | 'isLocked' | 'forumCommentId'>>): Promise<void>;
  remove(id: string): Promise<void>;
  /** One highlight, if this reader may see it (a letter's or a recommendation's card). */
  get(id: string): Promise<BookHighlight | null>;
  readers(bookRef: string): Promise<BookReader[]>;
  place(person: string, bookRef: string): Promise<number | null>;
  savePlace(person: string, bookRef: string, place: number): Promise<void>;
};

/** A book's forum thread for one person: one per person and book, found by its anchor (as a stream's is). */
export function bookThreadAnchor(person: string, bookRef: string, label: string): { kind: 'board'; id: string; label: string } {
  return { kind: 'board', id: `book:${person}:${bookRef}`, label: label.slice(0, 200) };
}

/** "[NAME] READING [BOOK]": the thread's title (SPEC-books.md). */
export function bookThreadTitle(name: string, bookTitle: string): string {
  return `${name.toUpperCase()} READING ${bookTitle.toUpperCase()}`.slice(0, 200);
}

/** A highlight's post in that thread: the quote, the comment, and the way back to that spot. Plain text. */
export function highlightPost(highlight: Pick<BookHighlight, 'quote' | 'comment' | 'bookRef' | 'place'>): string {
  const back = `/media/book/${highlight.bookRef}?at=${highlight.place}`;
  return [`"${highlight.quote}"`, highlight.comment.trim(), `READ IT THERE: ${back}`].filter(Boolean).join('\n\n');
}

/** The address of a spot in a book, for a highlight's card in a letter or a recommendation. */
export function bookSpotHref(bookRef: string, place: number): string {
  return `/media/book/${bookRef}?at=${place}`;
}

/** A highlight as a letter's or a recommendation's item: `<book>|<paragraph>|<highlight id>`, so its card knows where to go. */
export function highlightRef(highlight: Pick<BookHighlight, 'bookRef' | 'place' | 'id'>): string {
  return `${highlight.bookRef}|${highlight.place}|${highlight.id}`;
}

/** Where a highlight item goes: its spot in its book, or null for a ref that isn't one. */
export function highlightHref(ref: string): string | null {
  const [bookRef, place] = ref.split('|');
  return /^books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?$/.test(bookRef ?? '') && /^[0-9]{1,7}$/.test(place ?? '') ? bookSpotHref(bookRef, Number(place)) : null;
}
