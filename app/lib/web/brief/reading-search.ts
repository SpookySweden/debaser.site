import { authorList, matchesAuthor, matchesSearch, searchWords } from '../search';
import type { WebItem } from '../types';
import { compareByDate } from '../web-sort';
import type { BriefRow, ReadingKind } from './feeds';

/**
 * WHERE FROM's READING group (SPEC-media-feed.md, list 3): one kind of the brief, searched and paged in the browser. The
 * brief is already in the page (`use-brief.ts`, asked once a visit), so nothing new is asked of anyone. Pure; held by
 * `Temp/check-media-reading-filter.cjs`.
 *
 * - Only rows of that kind: its papers, articles and Wikipedia rows, and the news videos and lectures served under it.
 * - Words: every word in the title, creator, description or tags (`matchesSearch`, as the stream searches); VIBE's
 *   any-word search too. The outlet counts as a word place (BBC NEWS). No words: the whole kind.
 * - `from:`: the creator, as everywhere.
 * - Order: BEST MATCH keeps the brief's own order (Hacker News's front page, newest first elsewhere); NEWEST and OLDEST
 *   by date. There is no POPULAR: reading keeps no counts (web-sort.ts NO_POPULAR).
 * - Pages: `limit` rows from the offset in `cursor`, and the next offset while any are left.
 */
export function readingPage(
  rows: readonly BriefRow[],
  kind: ReadingKind,
  ask: { query: string; from?: readonly string[]; anyWord?: boolean; order?: 'relevance' | 'newest' | 'oldest'; cursor: string | null; limit: number },
): { items: WebItem[]; nextCursor: string | null } {
  const wanted = searchWords(ask.query);
  const authors = authorList(ask.from ?? []);
  const words = (item: WebItem) => (item.outlet ? { ...item, tags: [...(item.tags ?? []), item.outlet] } : item);
  const fits = (item: WebItem) =>
    (wanted === null || (ask.anyWord ? wanted.some((word) => matchesSearch(words(item), [word])) : matchesSearch(words(item), wanted))) &&
    (authors === null || matchesAuthor(item, authors));
  const found = rows.filter((row) => row.kind === kind && fits(row.item)).map((row) => row.item);
  if (ask.order === 'newest' || ask.order === 'oldest') found.sort(compareByDate(ask.order === 'newest' ? 'desc' : 'asc'));
  const offset = ask.cursor !== null && /^[1-9][0-9]{0,5}$/.test(ask.cursor) ? Number(ask.cursor) : 0;
  const limit = Math.max(1, Math.floor(ask.limit));
  const items = found.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < found.length ? String(offset + limit) : null };
}
