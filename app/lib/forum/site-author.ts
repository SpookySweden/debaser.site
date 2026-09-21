import { DEFAULT_AVATAR_SRC } from '../profile/avatar-catalogue';
import type { ForumAuthor } from './types';

/**
 * Who an item-owned post is credited to.
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
