'use client';

import type { NewsRow } from '../lib/forum/news-feed';
import CommentRow from './CommentRow';

/** Seconds of crawl per item, so a long wire does not scroll any faster than a short one. */
const SECONDS_PER_ITEM = 6;

/** The floor, so a wire of two items is not a blur. */
const SECONDS_FLOOR = 24;

type NewsCrawlProps = {
  items: NewsRow[];
  /**
   * The strip's own classes, and the only thing the caller has to decide about its looks:
   * it needs `overflow-hidden` to clip, and it is **transparent** unless the caller gives
   * it a background - both the board's ticker and a profile's wire are transparent, so the
   * surface they sit on shows through.
   */
  className?: string;
  /** Shown instead of nothing when the wire is empty. */
  emptyLabel?: string;
};

/**
 * The wire's crawl: one line of rows going past, held twice so the loop has no seam.
 *
 * Both places the site shows a wire use this - the board's ticker and a profile's feed -
 * because they are the same thing seen from two pages, and the rows are the site's one
 * comment row in its compact shape: the little picture, the name, `[ POST ]` or `[ REPLY ]`,
 * the time, and the words. Each row links to wherever it came from.
 *
 * A *pinned* row - the post a moderator has lifted - is drawn as a highlight: a plate of its own
 * around the row, the `PINNED` label a reader can see going past, and the row is at the front of
 * the run, because the crawl is what makes a pin visible in the first place.
 *
 * The second copy is hidden from assistive tech: it is there to make the loop seamless, not
 * to say everything twice. A reader who has asked their system for less motion gets a still
 * line that can be scrolled by hand, which is the `crawl` rule in app/globals.css doing it,
 * not this component.
 */
export default function NewsCrawl({ items, className = '', emptyLabel }: NewsCrawlProps) {
  if (items.length === 0) {
    return emptyLabel === undefined ? null : (
      <p className="text-[10px] font-bold text-ink">{emptyLabel}</p>
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
                  tag: item.tag,
                }}
                variant="compact"
                {...(item.href === undefined ? {} : { href: item.href, hrefTitle: item.hrefTitle })}
                {...(item.pinLabel === undefined ? {} : { pinnedLabel: item.pinLabel })}
              />
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
