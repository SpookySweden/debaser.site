'use client';

import { buildReplyNews } from '../lib/forum/news-feed';
import type { ForumComment } from '../lib/forum/types';
import NewsCrawl from './NewsCrawl';

type PostReplyReelProps = {
  /** The thread's own replies, oldest first as the thread keeps them: the wire sorts them. */
  comments: ForumComment[];
  /** The strip's own classes: the caller decides where it sits and how wide it is. */
  className?: string;
};

/**
 * A post's replies, crawling past, like the information bar along the foot of a news channel.
 *
 * **It is the board's own newswire, narrowed to one post.** The rows come from `buildReplyNews`
 * (`app/lib/forum/news-feed.ts`), which is the wire's row shape - the little picture, the name,
 * `[ REPLY ]`, the stamp and the words - so a reply met beside a post reads exactly as the same
 * reply does on the newswire at the top of the board. The crawl, the seam and the still state are
 * `NewsCrawl`'s, which both wires use.
 *
 * **It is drawn in two places, and that is why it is its own component.** The wide board shows it
 * in the reserved right column of a collapsed row (./PostRowDetails.tsx), and the narrow board -
 * below `sm`, where that column is `hidden` and nothing at all can reach it - shows it under the
 * credit strip of the collapsed row instead (./ForumThreadCard.tsx). One component means one strip:
 * the labelling, the rows and the still state cannot drift between the two.
 *
 * It is a reading aid, not a control: `aria-hidden` because every word of it is on the expanded card
 * already, and the rows carry no link for the same reason.
 */
export default function PostReplyReel({ comments, className = '' }: PostReplyReelProps) {
  const rows = buildReplyNews(comments);

  if (rows.length === 0) return null;

  return (
    <div className={className} aria-hidden="true">
      {/* The strip is labelled, because a line of quoted fragments sliding past on its own reads as
          stray text: `LATEST REPLIES` says what is going past before the first name arrives. */}
      <p className="text-[9px] font-bold text-ink">LATEST REPLIES</p>
      <NewsCrawl items={rows} className="overflow-hidden" />
    </div>
  );
}
