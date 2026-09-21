'use client';

import { buildNewsFeed } from '../lib/forum/news-feed';
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
 * ./NewsCrawl, which the profile's own feed uses too.
 *
 * It is drawn as a display here - dark, like the LED panel on the player - because beside the
 * board's list it is the loudest thing on the page and should look like equipment. The same
 * wire on a profile is transparent instead (see ./ProfileWire).
 */
export default function NewsTicker() {
  const forum = useForum();
  const items = buildNewsFeed(forum.threads);

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-[10px] font-bold text-white">
        <span>NEWSWIRE :: THE BOARD AS IT IS FILED</span>
        <span>[ {items.length === 0 ? 'NOTHING YET' : `${items.length} ITEMS`} ]</span>
      </div>

      <NewsCrawl
        items={items}
        className="overflow-hidden bg-black px-1 py-[3px]"
        emptyLabel="NOTHING ON THE WIRE YET - A POST OR A REPLY APPEARS HERE AS SOON AS IT IS FILED."
      />

      {items.length === 0 ? null : (
        <p className="px-2 py-1 text-[9px] font-bold text-gray-700">
          POINT AT IT TO STOP THE CRAWL :: A ROW OPENS THE THREAD IT CAME FROM
        </p>
      )}
    </section>
  );
}
