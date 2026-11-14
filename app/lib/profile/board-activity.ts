import { boardCommentHref, boardThreadHref } from '../forum/anchors';
import { clipForNews } from '../forum/news-feed';
import { displayTitle, isItemOwnedThread } from '../forum/site-author';
import type { ForumThread } from '../forum/types';

/**
 * What a person has done on the board, as the rows of their BOARD ACTIVITY list (Luke, 2026-11-14:
 * "clicking on a comment or any kind of forum or interaction under a users profile, in the list, needs to
 * bring you more directly to the corresponding thread").
 *
 * Two kinds of row, newest first in one list: a post they filed, and a reply they wrote - under anybody's
 * post, on an item's thread, or as a comment on somebody's profile, which the board reads as a thread too
 * (`../forum/profile-threads`). Each row carries the board's own address for exactly that post or reply
 * (`boardThreadHref`, `boardCommentHref`), and the board does the rest: its page, open, in view, marked.
 *
 * Only what this reader's board already holds is listed, so nothing private is read out: a thread the
 * reader may not see is not in `threads` to begin with.
 */
export type BoardActivityRow = {
  /** Unique in the list: `post:<thread>` or `reply:<comment>`. */
  id: string;
  kind: 'post' | 'reply';
  at: string;
  /** The post's title: the one filed, or the one the reply was written under. */
  title: string;
  /** A reply's own words, clipped to a line; absent on a post. */
  words?: string;
  href: string;
};

/** How many rows the list opens with, and how many `[ MORE ]` adds. */
export const BOARD_ACTIVITY_STEP = 8;

/** A reply's words in the list: shorter than the wire's line, because the post's title follows them. */
const REPLY_WORDS = 70;

export function boardActivityRows(threads: ForumThread[], userId: string): BoardActivityRow[] {
  const rows: BoardActivityRow[] = [];

  for (const thread of threads) {
    // A private stream's record has no title and no words of its own to lead to.
    if (thread.privateRecord !== undefined) continue;

    const title = displayTitle(thread);

    // An item's own thread (`COMMENTS ON ...`) is opened by whoever commented first, but it is the item's, and the
    // board credits it to the site: their part in it is the comment, which is listed as a reply below.
    if (thread.author.id === userId && !isItemOwnedThread(thread)) {
      rows.push({ id: `post:${thread.id}`, kind: 'post', at: thread.createdAt, title, href: boardThreadHref(thread.id) });
    }

    for (const comment of thread.comments) {
      if (comment.author.id !== userId) continue;
      rows.push({
        id: `reply:${comment.id}`,
        kind: 'reply',
        at: comment.createdAt,
        title,
        words: clipForNews(comment.body, REPLY_WORDS),
        href: boardCommentHref(comment.id),
      });
    }
  }

  return rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}
