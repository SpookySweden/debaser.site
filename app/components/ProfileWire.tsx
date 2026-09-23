'use client';

import { buildProfileNewsFeed } from '../lib/profile/feed';
import type { ProfileComment } from '../lib/profile/types';
import NewsCrawl from './NewsCrawl';

type ProfileWireProps = {
  /** The account whose page this is: the wire's rows open its comments. */
  userId: string;
  /** The comments left on this profile, as this reader is allowed to see them. */
  comments: ProfileComment[];
};

/**
 * The wire, on a profile: what people have said *about this profile*, going past.
 *
 * It used to be the board's wire borrowed - every post and reply in the archive crawled past a
 * page about one account, which was a second copy of /forum where the profile's own conversation
 * should be. Now it is this profile's comments and nothing else: the same rows and the same crawl
 * as the board's strip, but the material is the conversation the page is actually about, and a row
 * opens the comments panel underneath it.
 *
 * It is one full-width line and nothing else: **no heading and no placeholder**. A strip of text
 * saying "NEWSWIRE :: COMMENTS ON THIS PROFILE - NOTHING YET" told a reader what the line was
 * before there was a line to read, and stood in the middle of the page doing it; the crawl says
 * what it is by crawling, and a profile nobody has commented on simply has no wire. It ran in the
 * column beside the drawing, which gave it a third of the page to cross - it now spans the window
 * under both columns, since a wire is a line and a line wants the width.
 *
 * One row in every three is a comment the owner pinned, drawn with the `PINNED` plate the board's
 * pinned posts wear, so the strip goes past as a run of threes rather than a list (see
 * ../lib/profile/feed on why).
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
    <div className="border-t border-dashed border-gray-400 px-3 py-1">
      <NewsCrawl items={items} className="overflow-hidden" />
    </div>
  );
}
