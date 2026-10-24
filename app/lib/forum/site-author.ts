import { autoThreadTitle, isAutoFiledBody, profileAnchorTarget } from './anchors';
import { SITE_ACCOUNT_DISPLAY_NAME, SITE_ACCOUNT_ID } from '../auth/builtin-account';
import { DEFAULT_AVATAR_SRC } from '../profile/avatar-catalogue';
import type { ForumAnchor, ForumAuthor, ForumThread } from './types';

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
 * A profile's own threads (the page, one of its pictures, the track beside it) are
 * the exception: the item *is* an account, so the credit is that account - the page's
 * owner - and never the site. A reader took `debaser.site` over a profile's comments
 * for an empty post the site had made (Luke, 2026-10-24).
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

/**
 * What a thread is called on screen: its own title, or `COMMENTS ON <item>` for an item's own
 * thread whatever an older build stored (`RE: ...`). The card, the tile, the newswire, the search
 * and the pin panel all read this, so an old row is called one thing everywhere.
 */
export function displayTitle(thread: ForumThread): string {
  return isItemOwnedThread(thread) ? autoThreadTitle(thread.anchor) : thread.title;
}

/**
 * The owner of a profile anchor, as the board names them; null for any other anchor.
 *
 * The label spells the name after the subject (`PICTURE v3 // DEMZOU`), upper-cased, so a
 * caller with the owner's profile to hand prefers the name the profile carries.
 */
export function profileOwner(anchor: ForumAnchor): ForumAuthor | null {
  const target = profileAnchorTarget(anchor);
  if (target === null) return null;

  const name = anchor.label.split('//').pop()?.trim() ?? '';

  return { id: target.userId, displayName: name };
}

/**
 * Who the post header credits: the poster for a post; for an item-owned thread, the
 * page's owner when the item is a profile, else the site.
 */
export function postCredit(thread: ForumThread): ForumAuthor {
  if (!isItemOwnedThread(thread)) return thread.author;

  return profileOwner(thread.anchor) ?? SITE_AUTHOR;
}

