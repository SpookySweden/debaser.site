import { isCid } from './ipfs';

/**
 * Book sources added by hand (Luke, 2026-11-11), the two lists the Book Source Patcher writes. BOOKS search lists both,
 * first, on the first page: the books on IPFS, then the Open Library works named here. Each reads in the site's reader or
 * on its own book page. There is no catalogue of IPFS books to ask, and an Open Library work named here is one to keep
 * findable even when Open Library's own search doesn't surface it, so a book shows in search once it's named here.
 *
 * The patcher (`G:\arc raiders fix\book-source-patcher`) is the way to add one: it writes only the lines between the two
 * markers below, one entry a line, and checks each the way `usableIpfsBook` and `usableWork` do; search checks every entry
 * again with those two, so a bad one never shows. A file only stays reachable on IPFS while someone keeps it pinned.
 * Only public-domain books and Luke's own work belong here. LibGen, Anna's Archive, Z-Library and every other copy made
 * without its rights holders' leave are not sources (SPEC-books.md): never name one, and never import a catalogue of them.
 *
 * Empty on 2026-11-11: no public-domain EPUB could be found live on IPFS (those tried were blocked or no longer held).
 */

/** A book on IPFS: its file's CID (not a folder), its title and author as they should read, the year, and, if there is one, a cover's CID and its Open Library work. */
export type IpfsBook = {
  cid: string;
  title: string;
  author: string;
  year: number;
  coverCid?: string;
  /**
   * Its Open Library work (`OL85892W`), when it is a copy of one: every edition on that book's page then offers this copy
   * in the reader (SPEC-book-editions.md).
   */
  work?: string;
};

/** An Open Library work named by hand: its work number (`OL85892W`), and the title, author and year search matches on. */
export type NamedWork = {
  work: string;
  title: string;
  author: string;
  year: number;
};

/** An Open Library work number, `OL85892W`. */
export const WORK_ID = /^OL[1-9][0-9]{0,11}W$/;

export const IPFS_BOOKS: readonly IpfsBook[] = [
  // IPFS-START
  // IPFS-END
];

export const NAMED_WORKS: readonly NamedWork[] = [
  // WORKS-START
  // WORKS-END
];

/** An entry search may list: a real CID (and cover CID), a title, an author, and a year from 1 to next year. */
export function usableIpfsBook(book: IpfsBook, now = new Date()): boolean {
  return (
    isCid(book.cid) &&
    (book.coverCid === undefined || isCid(book.coverCid)) &&
    (book.work === undefined || WORK_ID.test(book.work)) &&
    book.title.trim().length > 0 &&
    book.title.length <= 300 &&
    book.author.length <= 200 &&
    Number.isInteger(book.year) &&
    book.year >= 1 &&
    book.year <= now.getUTCFullYear() + 1
  );
}

/** A named work search may list: a real work number, a title, an author, and a year from 1 to next year. */
export function usableWork(work: NamedWork, now = new Date()): boolean {
  return (
    WORK_ID.test(work.work) &&
    work.title.trim().length > 0 &&
    work.title.length <= 300 &&
    work.author.length <= 200 &&
    Number.isInteger(work.year) &&
    work.year >= 1 &&
    work.year <= now.getUTCFullYear() + 1
  );
}

/** Lower-case letters and digits, as words: how a search's words and an entry's title and author are compared. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Whether every asked word is among these, and every `from:` word among the author's. */
function wordsMatch(title: string, author: string, asked: string[], by: string[]): boolean {
  const all = new Set([...wordsOf(title), ...wordsOf(author)]);
  const authors = new Set(wordsOf(author));
  return asked.every((word) => all.has(word)) && by.every((word) => authors.has(word));
}

/**
 * The IPFS entries a BOOKS search finds: every word of the search in the title or the author, and every word of a `from:`
 * author in the author. Nothing for an empty search.
 */
export function findIpfsBooks(words: string, author = '', books: readonly IpfsBook[] = IPFS_BOOKS): IpfsBook[] {
  const asked = wordsOf(words);
  const by = wordsOf(author);
  if (asked.length === 0 && by.length === 0) return [];
  return books.filter((book) => usableIpfsBook(book) && wordsMatch(book.title, book.author, asked, by));
}

/** The Open Library works named here that a BOOKS search finds, by the same words. Nothing for an empty search. */
export function findNamedWorks(words: string, author = '', works: readonly NamedWork[] = NAMED_WORKS): NamedWork[] {
  const asked = wordsOf(words);
  const by = wordsOf(author);
  if (asked.length === 0 && by.length === 0) return [];
  return works.filter((work) => usableWork(work) && wordsMatch(work.title, work.author, asked, by));
}
