import { isAutoFiledBody } from './anchors';
import { SITE_ACCOUNT_DISPLAY_NAME, SITE_ACCOUNT_ID } from '../auth/builtin-account';
import { DEFAULT_AVATAR_SRC } from '../profile/avatar-catalogue';
import type { ForumAuthor, ForumThread } from './types';

/**
 * Who a post is credited to.
 *
 * A thread opened by the [ COMMENT ] control on a concept sheet is not a post
 * somebody wrote: it is that item collecting its comments. So the board names the
 * owner of the item in the post header instead of whoever typed the first
 * comment - the comment itself already carries that account's id, and repeating
 * it above the item reads as if the commenter had drawn the sheet.
 *
 * The site's own posts are signed by a real account rather than a bare label:
 * debaser.site (see app/lib/auth/builtin-account.ts) can be signed into with the
 * credentials in that file, carries the dark blue name its profile seeds, and
 * links through to a public profile page like anybody else. An ordinary post
 * written straight onto the board keeps naming the account that filed it.
 *
 * The rule itself lives in `isItemOwnedThread` / `postCredit` so the post layout,
 * the board search and the account filter all read the same answer.
 */
export const SITE_AUTHOR: ForumAuthor = {
  id: SITE_ACCOUNT_ID,
  displayName: SITE_ACCOUNT_DISPLAY_NAME,
};

/**
 * The default pfp for site-owned posts.
 *
 * Hand-drawn and added by hand like every other drawing: until the file exists,
 * `SheetImage` shows its usual "[ ? ]" notice naming the path, so an empty slot
 * is obvious rather than a broken image.
 */
export const SITE_AUTHOR_PICTURE = DEFAULT_AVATAR_SRC;

/** True when the thread is the item's own: an item's comment box opened it. */
export function isItemOwnedThread(thread: ForumThread): boolean {
  return isAutoFiledBody(thread.body);
}

/** Who the post header credits: the site for an item-owned thread, else the poster. */
export function postCredit(thread: ForumThread): ForumAuthor {
  return isItemOwnedThread(thread) ? SITE_AUTHOR : thread.author;
}

