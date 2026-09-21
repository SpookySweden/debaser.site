import { isAutoFiledBody } from './anchors';
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
 * Everything on this site is authored by the site, so an item-owned post falls
 * back to the house name and the default picture slot below. An ordinary post
 * written straight onto the board keeps naming the account that filed it.
 *
 * The rule itself lives in `isItemOwnedThread` / `postCredit` so the post layout,
 * the board search and the account filter all read the same answer.
 */
export const SITE_AUTHOR: ForumAuthor = {
  id: null,
  displayName: 'debaser.site',
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

