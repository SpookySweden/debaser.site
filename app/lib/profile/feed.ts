import { clipForNews, type NewsRow } from '../forum/news-feed';
import type { ProfileComment } from './types';

/**
 * A profile's own wire: the comments left on it, and nothing else.
 *
 * This used to be the board's wire, borrowed: the profile page crawled every post and reply in
 * the archive past the drawing, which was a second copy of /forum on a page about one account.
 * What belongs there is the conversation *about this profile* - so the wire is the profile's own
 * comments, newest first, drawn in the same rows and the same crawl, and each row opens the
 * comments panel underneath it.
 *
 * The comment rows carry no `P2` / `M1` tag, because a comment on the profile itself was written
 * about the profile and there is only one of those; the tag says `PROFILE` instead, so the strip
 * still says what you are reading before you read it. Picture and track comments stay in their
 * own threads under those elements - see ./elements on what a comment was written on.
 */

/** How many comments a profile's wire carries. */
export const PROFILE_NEWS_LIMIT = 14;

/** The anchor the comments panel answers to, so a wire row can open it. */
export const PROFILE_COMMENTS_ANCHOR = 'profile-comments';

export function buildProfileNewsFeed(
  comments: ProfileComment[],
  options: { userId: string; limit?: number } = { userId: '' },
): NewsRow[] {
  const rows: NewsRow[] = comments
    // Defensive: the caller is expected to hand over the profile's own comments, and a comment
    // written on a picture or a track is not one of them.
    .filter((comment) => comment.kind === 'profile')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, Math.max(0, options.limit ?? PROFILE_NEWS_LIMIT))
    .map((comment) => ({
      id: `news-comment-${comment.id}`,
      tag: 'PROFILE',
      author: comment.author,
      text: clipForNews(comment.body),
      createdAt: comment.createdAt,
      href: `/profile/${encodeURIComponent(options.userId)}#${PROFILE_COMMENTS_ANCHOR}`,
      hrefTitle: 'Open the comments on this profile',
    }));

  return rows;
}
