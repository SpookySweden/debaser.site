'use client';

import { threadDomId } from '../lib/forum/anchors';
import { buildNewsFeed, newsTag } from '../lib/forum/news-feed';
import CommentRow from './CommentRow';
import { useForum } from './ForumProvider';

/** Seconds of crawl per item, so a long wire does not scroll any faster than a short one. */
const SECONDS_PER_ITEM = 6;

/**
 * The wire: everything filed on the board, crawling across one strip.
 *
 * It is the shape the page had room for. The board's posts are tall rectangles and its
 * threads are lists, but a strip across the width of the window is a line, and a line is
 * what a wire is - so the same material the thread cards are made of goes past in single
 * rows: the little picture, the name, `[ POST ]` or `[ REPLY ]`, the time, and the words.
 * Reading it is a different way of reading the board rather than a different board.
 *
 * Three details make it work rather than annoy: it holds its breath while the pointer is
 * over it (so a row can be read, and a link aimed at), each row links to the thread it
 * came from, and the crawl stops entirely for anybody who has asked their system to reduce
 * motion - in which case the strip is simply a line that can be scrolled by hand.
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

      {items.length === 0 ? (
        <p className="p-2 text-[10px] font-bold text-black">
          NOTHING ON THE WIRE YET - A POST OR A REPLY APPEARS HERE AS SOON AS IT IS FILED.
        </p>
      ) : (
        <>
          {/* The crawl is one line of rows with no height of its own, so the strip never
              moves the page under it. Every item is also a link into its thread. */}
          <div className="overflow-hidden bg-black px-1 py-[3px]">
            <div
              className="crawl flex w-max items-center"
              style={{ animationDuration: `${Math.max(30, items.length * SECONDS_PER_ITEM)}s` }}
            >
              {[0, 1].map((copy) => (
                <ul key={copy} className="flex items-center" aria-hidden={copy === 1 ? 'true' : undefined}>
                  {items.map((item) => (
                    <CommentRow
                      key={`${copy}-${item.id}`}
                      data={{
                        id: item.id,
                        author: item.author,
                        body: item.text,
                        createdAt: item.createdAt,
                        tag: newsTag(item),
                      }}
                      variant="compact"
                      href={`/forum#${threadDomId(item.threadId)}`}
                      hrefTitle={`Open "${item.threadTitle}"`}
                    />
                  ))}
                </ul>
              ))}
            </div>
          </div>

          <p className="px-2 py-1 text-[9px] font-bold text-gray-700">
            POINT AT IT TO STOP THE CRAWL :: A ROW OPENS THE THREAD IT CAME FROM
          </p>
        </>
      )}
    </section>
  );
}
