'use client';

import { buildNewsFeed } from '../lib/forum/news-feed';
import { pinnedCount } from '../lib/forum/pins';
import { useForum } from './ForumProvider';
import NewsCrawl from './NewsCrawl';

/**
 * The wire: everything filed on the board, crawling across one strip.
 *
 * It is the shape the page had room for. The board's posts are tall rectangles and its
 * threads are lists, but a strip across the width of the window is a line, and a line is what
 * a wire is - so the same material the thread cards are made of goes past in single rows: the
 * little picture, the name, `[ POST ]` or `[ REPLY ]`, the time, and the words.
 *
 * Three details make it work rather than annoy: it holds its breath while the pointer is over
 * it (so a row can be read, and a link aimed at), each row links to the thread it came from,
 * and the crawl stops entirely for anybody who has asked their system to reduce motion - in
 * which case the strip is simply a line that can be scrolled by hand. Those live in
 * ./NewsCrawl, which a profile's own feed uses too.
 *
 * It is drawn as one more panel of the board - the same plate, the same navy title bar as the
 * composer and the list - rather than as a black display of its own: the strip is the board's
 * front page, not a piece of equipment bolted to it, and the two wires on the site should read
 * as the same thing seen from two pages.
 *
 * A post a moderator has pinned comes first and goes past with a `PINNED` plate on it, so the
 * announcement is what a reader sees whichever part of the run they happen to catch.
 */
export default function NewsTicker() {
  const forum = useForum();
  const items = buildNewsFeed(forum.threads, undefined, { pins: forum.pins });
  const pinned = pinnedCount(forum.pins);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-[10px] font-bold text-white">
        <span>NEWSWIRE :: THE BOARD AS IT IS FILED</span>
        <span>
          [ {items.length === 0 ? 'NOTHING YET' : `${items.length} ITEMS`}
          {pinned === 0 ? '' : ` :: ${pinned} PINNED`} ]
        </span>
      </div>

      <NewsCrawl
        items={items}
        className="overflow-hidden px-1 py-[3px]"
        emptyLabel="NOTHING ON THE WIRE YET - A POST OR A REPLY APPEARS HERE AS SOON AS IT IS FILED."
      />

      {items.length === 0 ? null : (
        <p className="px-2 py-1 text-[9px] font-bold text-gray-700">
          {pinned === 0
            ? 'POINT AT IT TO STOP THE CRAWL :: A ROW OPENS THE THREAD IT CAME FROM'
            : 'PINNED POSTS LEAD THE CRAWL :: POINT AT IT TO STOP IT, AND CLICK A ROW TO OPEN THE THREAD'}
        </p>
      )}
    </section>
  );
}
