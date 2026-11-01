/**
 * Board paging maths.
 *
 * Kept pure and separate from the React component so the edge cases (filters
 * shrinking the list under your current page, an oversized posts-per-page, a
 * partial last page) can be reasoned about and tested directly.
 */
export type PageSlice<T> = {
  /** The page actually shown: the requested page clamped into range. */
  page: number;
  totalPages: number;
  /** Zero-based index of the first item on this page. */
  start: number;
  items: T[];
};

export function paginate<T>(items: T[], perPage: number, requestedPage: number): PageSlice<T> {
  const size = Math.max(1, Math.floor(perPage));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const start = (page - 1) * size;

  return { page, totalPages, start, items: items.slice(start, start + size) };
}
