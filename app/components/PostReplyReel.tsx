'use client';

import type { ForumComment } from '../lib/forum/types';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileName from './ProfileName';

/** Longest slice of one reply the reel prints. */
const COMMENT_SLICE = 90;
/** Seconds of reel per reply, so a long thread does not scroll any faster. */
const SECONDS_PER_REPLY = 7;
/** The floor, so a thread of one reply is a drift rather than a blur. */
const SECONDS_FLOOR = 24;

type PostReplyReelProps = {
  /** Replies, oldest first: the reel shows them in the order they were filed. */
  comments: ForumComment[];
  /** The strip's own classes: it needs `overflow-hidden` to clip, and the width is the caller's. */
  className?: string;
};

/**
 * A post's replies as a reel, like the information bar along the foot of a news channel.
 *
 * Each item is the account's little picture, their name in the colour they chose, and what they said,
 * in quotes; the list runs twice through the track so the slide has no seam.
 *
 * **It is drawn in two places now, and that is why it is its own component.** The wide board shows it
 * in the reserved right column of a pointed-at row (./PostHoverPreview.tsx), and the narrow board -
 * below `sm`, where that column is `hidden` and no reveal can reach it - shows it under the credit
 * strip of the collapsed row instead (./ForumThreadCard.tsx). One component means one reel: the
 * labelling, the seam, the slice and the reduced-motion behaviour cannot drift between the two.
 *
 * It is a reading aid, not a control: `pointer-events-none` on the wide panel is the panel's business,
 * and the reel is marked `aria-hidden` because every word of it is on the expanded card already.
 */
export default function PostReplyReel({ comments, className = '' }: PostReplyReelProps) {
  if (comments.length === 0) return null;

  return (
    <div className={`overflow-hidden ${className}`} aria-hidden="true">
      {/* The reel is labelled, because a line of quoted fragments sliding past on its own reads as
          stray text: `LATEST REPLIES` says what the strip is before the first name arrives. */}
      <p className="text-[9px] font-bold text-ink">LATEST REPLIES</p>
      {/* **The `motion-reduce` variants are what a still reel needs to be readable.** The site rule is
          that everything moving goes quiet under `prefers-reduced-motion: reduce`, and the `crawl` rule
          in app/globals.css does that with `animation: none` - which leaves a single clipped line of a
          1500px track that can be read to its first reply and no further, and scrolled by nobody,
          because the reel is not a control. A crawl nobody can scroll is not a reduced-motion
          alternative, it is a truncation: so in that one setting the duplicate copy goes, the track
          stops being one long line, and the replies wrap into the width they have - the same words,
          still, and legible. */}
      <div
        className="crawl flex w-max motion-reduce:w-full motion-reduce:flex-wrap"
        style={{ animationDuration: `${Math.max(SECONDS_FLOOR, comments.length * SECONDS_PER_REPLY)}s` }}
      >
        {[0, 1].map((copy) => (
          <ul key={copy} className={`flex items-center${copy === 1 ? ' motion-reduce:hidden' : ''}`}>
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="flex items-center gap-1 whitespace-nowrap pr-4 text-[10px] motion-reduce:whitespace-normal"
              >
                <ProfileAvatarLink author={comment.author} size={20} showName={false} variant="plain" />
                <ProfileName author={comment.author} className="font-bold" />
                <span className="text-ink">
                  &quot;{comment.body.replace(/\s+/g, ' ').trim().slice(0, COMMENT_SLICE)}&quot;
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
