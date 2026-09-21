'use client';

import { threadDomId } from '../lib/forum/anchors';
import { newsTag, type NewsItem } from '../lib/forum/news-feed';
import CommentRow from './CommentRow';

/** Seconds of crawl per item, so a long wire does not scroll any faster than a short one. */
const SECONDS_PER_ITEM = 6;

/** The floor, so a wire of two items is not a blur. */
const SECONDS_FLOOR = 24;

type NewsCrawlProps = {
  items: NewsItem[];
  /**
   * The strip's own classes, and the only thing the caller has to decide about its looks:
   * it needs `overflow-hidden` to clip, and it is **transparent** unless the caller gives
   * it a background. The profile's wire and the crawl under a comment on the board are
   * transparent, so the surface they sit on shows through; the board's ticker box is black
   * because there it is meant to read as a display.
   */
  className?: string;
  /** Shown instead of nothing when the wire is empty. */
  emptyLabel?: string;
};

/**
 * The wire's crawl: one line of rows going past, held twice so the loop has no seam.
 *
 * Both places the site shows a wire use this - the board's ticker and the profile's feed -
 * because they are the same thing seen from two pages, and the rows are the site's one
 * comment row in its compact shape: the little picture, the name, `[ POST ]` or `[ REPLY ]`,
 * the time, and the words. Each row links to the thread it came from.
 *
 * The second copy is hidden from assistive tech: it is there to make the loop seamless, not
 * to say everything twice. A reader who has asked their system for less motion gets a still
 * line that can be scrolled by hand, which is the `crawl` rule in app/globals.css doing it,
 * not this component.
 */
export default function NewsCrawl({ items, className = '', emptyLabel }: NewsCrawlProps) {
  if (items.length === 0) {
    return emptyLabel === undefined ? null : (
      <p className="text-[10px] font-bold text-gray-700">{emptyLabel}</p>
    );
  }

  return (
    <div className={className}>
      <div
        className="crawl flex w-max items-center"
        style={{ animationDuration: `${Math.max(SECONDS_FLOOR, items.length * SECONDS_PER_ITEM)}s` }}
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
  );
}
