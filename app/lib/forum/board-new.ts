import { onMainBoard } from './board-query';
import { accountOf, instantOf, postIsRead, replyIsRead, type ReadMarks } from './read-state';
import type { ForumThread } from './types';

/** How far back something still counts as new: older than this, "new" says nothing. */
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Past this the tab says `9+`: the count is a nudge, not a ledger. */
export const NEW_COUNT_CAP = 9;

/**
 * How many posts on the feed have something this reader has not seen (SPEC-forum-v2.md, Luke's 9B: `[ FEED · 3 NEW ]`).
 *
 * The board's own read marks decide it (`./read-state.ts`): a post never opened, or one opened before a reply that came
 * since. Only the last week counts, and never the reader's own writing. A reader with no marks at all (a first visit, or a
 * new browser) gets no count: every post would be "new", which says nothing. Counts posts, not anybody's engagement.
 * Pure, so a check can drive it with a fixed clock.
 */
export function countNewPosts(threads: ForumThread[], marks: ReadMarks, readerAccount: string, now: number): number {
  if (Object.keys(marks).length === 0) return 0;
  const since = now - NEW_WINDOW_MS;
  const recent = (iso: string) => {
    const at = instantOf(iso);
    return at !== null && at >= since && at <= now + 60000;
  };
  const mine = (author: ForumThread['author']) => author.id !== null && accountOf(author) === readerAccount;

  let count = 0;
  for (const thread of threads) {
    if (!onMainBoard(thread)) continue;
    const unseenPost = !postIsRead(marks, thread.id) && !mine(thread.author) && recent(thread.createdAt);
    const unseenReply = thread.comments.some(
      (comment) => !mine(comment.author) && recent(comment.createdAt) && !replyIsRead(marks, thread.id, comment.createdAt),
    );
    if (unseenPost || unseenReply) count += 1;
  }
  return count;
}

/** The tab's words for a count: nothing, `3 NEW`, `9+ NEW`. */
export function newLabel(count: number): string {
  if (count <= 0) return '';
  return count > NEW_COUNT_CAP ? `${NEW_COUNT_CAP}+ NEW` : `${count} NEW`;
}
