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
 * It is drawn the way the crawl under a comment on the board is: **transparent**, no box of its
 * own, so it reads as a line running across the surface the profile is already made of rather than
 * as another panel stacked on it. It is meant to fill the empty room a profile has to the right of
 * the drawing, under the track and its remarks, and to reach the full width of that space instead
 * of sitting in a column.
 */
export default function ProfileWire({ userId, comments }: ProfileWireProps) {
  const items = buildProfileNewsFeed(comments, { userId });

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[10px] font-bold text-gray-700">
        <span>NEWSWIRE :: COMMENTS ON THIS PROFILE</span>
        <span>{items.length === 0 ? 'NOTHING YET' : `${items.length} ITEMS`}</span>
      </div>

      {/* A dashed rule, the way the crawl under a comment is separated from what is above it. */}
      <NewsCrawl
        items={items}
        className="mt-1 overflow-hidden border-t border-dashed border-gray-400 pt-1"
        emptyLabel="NOBODY HAS COMMENTED ON THIS PROFILE YET - WHAT THEY SAY APPEARS HERE AS SOON AS THEY DO."
      />
    </div>
  );
}
