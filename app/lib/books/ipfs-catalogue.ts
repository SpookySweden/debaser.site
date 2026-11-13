/**
 * The books on IPFS that BOOKS search lists now live in `book-sources.ts`, beside the Open Library works named by hand:
 * both lists are written by the Book Source Patcher, one file with a marked block for each. This file keeps the old names,
 * so every place that already reads them (`search/providers/books.ts`, `book-editions.ts`, the checks) is unchanged.
 */
export {
  IPFS_BOOKS,
  findIpfsBooks,
  usableIpfsBook,
  type IpfsBook,
} from './book-sources';
