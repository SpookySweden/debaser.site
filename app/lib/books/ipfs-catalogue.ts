import { isCid } from './ipfs';

/**
 * IPFS books, step 4 (Luke, 2026-11-11): the books on IPFS that BOOKS search lists, each read in the site's reader at
 * `/read/ipfs:<CID>`. Any CID still opens by its address; this list is only what search can find, because there is no
 * catalogue of IPFS books to ask: the big ones are copies made without their rights holders' leave (LibGen, Anna's
 * Archive), and those are not sources (SPEC-books.md). So a book shows in search once it's named here.
 *
 * To add one: its CID (the file itself, not a folder), its title and author as they should read, the year it came out,
 * and, if there is one, the CID of a cover picture. A file only stays reachable while someone keeps it pinned on IPFS.
 * `Temp/check-ipfs-search.cjs` refuses an entry with a CID that isn't one, an empty title or a year out of range.
 *
 * Empty on 2026-11-11: no public-domain EPUB could be found live on IPFS (those tried were blocked or no longer held).
 */
export type IpfsBook = {
  cid: string;
  title: string;
  author: string;
  year: number;
  coverCid?: string;
};

export const IPFS_BOOKS: readonly IpfsBook[] = [];

/** An entry search may list: a real CID (and cover CID), a title, an author, and a year from 1 to next year. */
export function usableIpfsBook(book: IpfsBook, now = new Date()): boolean {
  return (
    isCid(book.cid) &&
    (book.coverCid === undefined || isCid(book.coverCid)) &&
    book.title.trim().length > 0 &&
    book.title.length <= 300 &&
    book.author.length <= 200 &&
    Number.isInteger(book.year) &&
    book.year >= 1 &&
    book.year <= now.getUTCFullYear() + 1
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

/**
 * The entries a BOOKS search finds: every word of the search in the title or the author, and every word of a `from:` author
 * in the author. Nothing for an empty search.
 */
export function findIpfsBooks(words: string, author = '', books: readonly IpfsBook[] = IPFS_BOOKS): IpfsBook[] {
  const asked = wordsOf(words);
  const by = wordsOf(author);
  if (asked.length === 0 && by.length === 0) return [];
  return books.filter((book) => {
    if (!usableIpfsBook(book)) return false;
    const all = new Set([...wordsOf(book.title), ...wordsOf(book.author)]);
    const authors = new Set(wordsOf(book.author));
    return asked.every((word) => all.has(word)) && by.every((word) => authors.has(word));
  });
}
