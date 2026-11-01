'use client';

import { buildProfileNewsFeed } from '../lib/profile/feed';
import type { ProfileComment } from '../lib/profile/types';
import NewsCrawl from './NewsCrawl';

type ProfileWireProps = {
  /** The account whose page this is: the page's own remarks open its comments panel. */
  userId: string;
  /** Every comment the page carries, as this reader is allowed to see them. */
  comments: ProfileComment[];
};

/**
 * The feed, on a profile: **everything said on the page**, going past.
 *
 * It began as the crawl under the profile picture, carrying only the remarks on that drawing,
 * and it is now the page's whole conversation: a comment on the profile itself, on the picture,
 * or on the track, each row stamped with what it is about (`PROFILE`, `P2`, `M1`) by
 * ../lib/profile/feed. That is what makes it worth the full width - it grew out of a crawl in
 * the narrow column beside the drawing, into the band across the window where the old
 * `NEWSWIRE :: COMMENTS ON THIS PROFILE` caption used to explain the empty space under the
 * track.
 *
 * It is one line and nothing else: **no heading and no placeholder**. A strip of text saying what
 * the line was, before there was a line to read, is what was there before; the crawl says what it
 * is by crawling, and a page nobody has commented on simply has no feed. The element threads keep
 * their folds and their lists and no longer crawl (see ./ElementComments).
 *
 * One row in every three is a comment the owner pinned - on any of the three - drawn with the
 * `PINNED` plate the board's pinned posts wear, so the strip goes past as a run of threes rather
 * than a list (see ../lib/profile/feed on why).
 */
export default function ProfileWire({ userId, comments }: ProfileWireProps) {
  const items = buildProfileNewsFeed(comments, { userId });

  // Nothing said yet, so nothing to draw: an empty crawl with a caption under it would be a
  // placeholder for a conversation, and the panel at the foot of the page is where a reader who
  // wants to leave one goes.
  if (items.length === 0) return null;

  return (
    // The dashed rule spans the whole window, the way the crawl under a comment is separated from
    // what is above it; the crawl itself is clipped to the window's own padding.
    <div className="border-t border-dashed border-ink px-3 py-1">
      <NewsCrawl items={items} className="overflow-hidden" />
    </div>
  );
}
