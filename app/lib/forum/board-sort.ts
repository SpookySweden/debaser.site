import { countTagHits } from './board-query';
import { displayTitle, postCredit } from './site-author';
import type { ForumAuthor, ForumThread } from './types';

/**
 * The board's sorts (SPEC-forum-search.md, part 1): HOT, NEW, TOP with a time frame, MOST REPLIES,
 * TITLE A-Z, and BY TAG while tags are picked.
 *
 * Pure, and time is passed in, so the checks ask the same question the board does. Pins are not
 * decided here: the board lifts them after sorting (`sortThreadsPinnedFirst` in ./pins.ts), so a
 * pinned post leads whatever the sort.
 *
 * The board has no upvotes (Luke chose not to add them), so "how much a post is wanted" is read from
 * the replies, and only from other people's: a poster answering themselves raises nothing.
 */

export type BoardSort = 'hot' | 'new' | 'top' | 'replies' | 'title' | 'tags';

/** TOP's time frames: Reddit's list, by the words its addresses use (`?t=week`). */
export type TopFrame = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export const DEFAULT_SORT: BoardSort = 'hot';
export const DEFAULT_TOP_FRAME: TopFrame = 'week';

/** The sorts as the menu offers them. BY TAG is drawn only while tags are picked. */
export const BOARD_SORTS: { value: BoardSort; label: string }[] = [
  { value: 'hot', label: 'HOT' },
  { value: 'new', label: 'NEW' },
  { value: 'top', label: 'TOP' },
  { value: 'replies', label: 'MOST REPLIES' },
  { value: 'title', label: 'TITLE A-Z' },
  { value: 'tags', label: 'BY TAG' },
];

const HOUR_MS = 3600_000;

export const TOP_FRAMES: { value: TopFrame; label: string; ms: number | null }[] = [
  { value: 'hour', label: 'PAST HOUR', ms: HOUR_MS },
  { value: 'day', label: 'TODAY', ms: 24 * HOUR_MS },
  { value: 'week', label: 'THIS WEEK', ms: 7 * 24 * HOUR_MS },
  { value: 'month', label: 'THIS MONTH', ms: 30 * 24 * HOUR_MS },
  { value: 'year', label: 'THIS YEAR', ms: 365 * 24 * HOUR_MS },
  { value: 'all', label: 'ALL TIME', ms: null },
];

export type SortChoice = { sort: BoardSort; frame: TopFrame };

/**
 * How many seconds of age one step of activity is worth: Reddit's 45000 (12.5 hours). Ten times the
 * activity buys a post 12.5 hours; a hundred times, 25.
 */
const HOT_SECONDS_PER_STEP = 45000;

export function isBoardSort(value: unknown): value is BoardSort {
  return BOARD_SORTS.some((option) => option.value === value);
}

export function isTopFrame(value: unknown): value is TopFrame {
  return TOP_FRAMES.some((option) => option.value === value);
}

export function sortLabel(sort: BoardSort): string {
  return BOARD_SORTS.find((option) => option.value === sort)?.label ?? 'HOT';
}

export function frameLabel(frame: TopFrame): string {
  return TOP_FRAMES.find((option) => option.value === frame)?.label ?? 'THIS WEEK';
}

/** One account, by id when both sides have one, else by name. */
function sameAccount(left: ForumAuthor, right: ForumAuthor): boolean {
  if (left.id !== null && right.id !== null) return left.id === right.id;

  return left.displayName.trim().toLowerCase() === right.displayName.trim().toLowerCase();
}

function accountKey(author: ForumAuthor): string {
  return author.id ?? `name:${author.displayName.trim().toLowerCase()}`;
}

/** The replies by anybody but the person the post is credited to, filed at or after `since`. */
function otherReplies(thread: ForumThread, since: number | null) {
  const owner = postCredit(thread);

  return thread.comments.filter(
    (comment) =>
      !sameAccount(comment.author, owner) && (since === null || Date.parse(comment.createdAt) >= since),
  );
}

function distinctAuthors(comments: ForumThread['comments']): number {
  return new Set(comments.map((comment) => accountKey(comment.author))).size;
}

/**
 * HOT: `log10(max(1, otherReplies + 2 * distinctRepliers)) + createdAtSeconds / 45000`.
 *
 * Reddit's shape with replies standing in for votes: activity on a log scale, plus a bonus for being
 * new, so a post that draws people rises and then fades as newer posts arrive. Different people count
 * double, so a crowd beats one long back-and-forth; replies by the post's own author count for nothing.
 * Age works only through the creation time, as on Reddit, so no clock is needed.
 */
export function hotScore(thread: ForumThread): number {
  const others = otherReplies(thread, null);
  const activity = others.length + 2 * distinctAuthors(others);

  return Math.log10(Math.max(1, activity)) + Date.parse(thread.createdAt) / 1000 / HOT_SECONDS_PER_STEP;
}

/** TOP's measure: how many different people (not the author) replied inside the frame. */
export function topRepliers(thread: ForumThread, since: number | null): number {
  return distinctAuthors(otherReplies(thread, since));
}

/** The start of a TOP frame, or null for ALL TIME. */
export function frameStart(frame: TopFrame, now: number): number | null {
  const ms = TOP_FRAMES.find((option) => option.value === frame)?.ms ?? null;

  return ms === null ? null : now - ms;
}

/** Numbers before letters, case ignored, `2` before `10`. */
const TITLE_ORDER = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const newestFirst = (left: ForumThread, right: ForumThread) => Date.parse(right.createdAt) - Date.parse(left.createdAt);

export type SortOptions = {
  sort: BoardSort;
  /** TOP's frame; ignored by every other sort. */
  frame?: TopFrame;
  now?: number;
  /** The picked tags, for BY TAG. */
  tagKeys?: string[];
};

/**
 * The threads in the chosen order. TOP also narrows: like Reddit, it lists only posts *created*
 * inside the frame.
 */
export function sortBoard(threads: ForumThread[], options: SortOptions): ForumThread[] {
  const now = options.now ?? Date.now();
  const list = [...threads];

  switch (options.sort) {
    case 'hot': {
      const scores = new Map(list.map((thread) => [thread.id, hotScore(thread)]));
      return list.sort((left, right) => (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0) || newestFirst(left, right));
    }
    case 'top': {
      const since = frameStart(options.frame ?? DEFAULT_TOP_FRAME, now);
      const inFrame = since === null ? list : list.filter((thread) => Date.parse(thread.createdAt) >= since);
      const repliesInFrame = (thread: ForumThread) =>
        since === null ? thread.comments.length : thread.comments.filter((comment) => Date.parse(comment.createdAt) >= since).length;

      return inFrame.sort(
        (left, right) =>
          topRepliers(right, since) - topRepliers(left, since) ||
          repliesInFrame(right) - repliesInFrame(left) ||
          newestFirst(left, right),
      );
    }
    case 'replies':
      return list.sort((left, right) => right.comments.length - left.comments.length || newestFirst(left, right));
    case 'title':
      return list.sort((left, right) => TITLE_ORDER.compare(displayTitle(left), displayTitle(right)) || newestFirst(left, right));
    case 'tags': {
      const keys = options.tagKeys ?? [];
      return list.sort((left, right) => countTagHits(right, keys) - countTagHits(left, keys) || newestFirst(left, right));
    }
    case 'new':
    default:
      return list.sort(newestFirst);
  }
}

/**
 * The sort an address asks for (`?sort=top&t=week`), or null when it names none (or names junk).
 * A TOP without a usable `t` is THIS WEEK.
 */
export function readSortParams(params: URLSearchParams): SortChoice | null {
  const sort = params.get('sort');
  if (!isBoardSort(sort)) return null;

  const frame = params.get('t');

  return { sort, frame: isTopFrame(frame) ? frame : DEFAULT_TOP_FRAME };
}

/** Writes the choice into the address's params, leaving every other param (`arcade=1` ...) alone. */
export function writeSortParams(params: URLSearchParams, choice: SortChoice): URLSearchParams {
  params.set('sort', choice.sort);

  if (choice.sort === 'top') params.set('t', choice.frame);
  else params.delete('t');

  return params;
}

/** Where the choice is remembered in this browser. */
export const SORT_STORAGE_KEY = 'debaser.forum.sort';

/** The remembered choice, or null for nothing (or something that no longer reads). */
export function parseStoredSort(raw: string | null): SortChoice | null {
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;

    const { sort, frame } = value as { sort?: unknown; frame?: unknown };
    if (!isBoardSort(sort)) return null;

    return { sort, frame: isTopFrame(frame) ? frame : DEFAULT_TOP_FRAME };
  } catch {
    return null;
  }
}
