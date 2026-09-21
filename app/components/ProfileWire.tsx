'use client';

import { buildNewsFeed } from '../lib/forum/news-feed';
import { useForum } from './ForumProvider';
import NewsCrawl from './NewsCrawl';

/**
 * The wire, on a profile: what the board is saying, going past under the track.
 *
 * The board's ticker is a display - black, boxed, the loudest thing on that page. This is the
 * same wire drawn the way the crawl under a comment on the board is drawn: **transparent**,
 * no box of its own, so it reads as a line running across the surface the profile is already
 * made of rather than as another panel stacked on it. It is meant to fill the empty room a
 * profile has to the right of the drawing, under the track and its remarks, and to reach the
 * full width of that space instead of sitting in a column.
 *
 * The rows are the board's own (`./NewsCrawl`), each linking to the thread it came from, so
 * a reader who sees something worth reading on a friend's profile can open it where it lives.
 */
export default function ProfileWire() {
  const forum = useForum();
  const items = buildNewsFeed(forum.threads);

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[10px] font-bold text-gray-700">
        <span>NEWSWIRE :: WHAT THE BOARD IS SAYING</span>
        <span>{items.length === 0 ? 'NOTHING YET' : `${items.length} ITEMS`}</span>
      </div>

      {/* A dashed rule, the way the crawl under a comment is separated from what is above it. */}
      <NewsCrawl
        items={items}
        className="mt-1 overflow-hidden border-t border-dashed border-gray-400 pt-1"
        emptyLabel="NOTHING ON THE WIRE YET - A POST OR A REPLY APPEARS HERE AS SOON AS IT IS FILED."
      />
    </div>
  );
}
