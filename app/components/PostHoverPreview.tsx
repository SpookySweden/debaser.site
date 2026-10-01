'use client';

import type { ForumComment } from '../lib/forum/types';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileName from './ProfileName';

type PostHoverPreviewProps = {
  /** The post's own words: empty for a thread an item's comment box opened. */
  body: string;
  /** Replies, oldest first: the crawl shows them in the order they were filed. */
  comments: ForumComment[];
};

/**
 * How much of the post the panel carries before it says the rest is on the card.
 *
 * The panel is as tall as its own content (see the note on the element below), so this is not a
 * clipping limit but a judgement about what a hover should cost: 320 characters is six or seven lines
 * of 12px text in the panel's ~360px measure - a paragraph, not a wall. Anything longer is a post
 * somebody should be reading on the card, where the rest of it is.
 */
const BODY_SLICE = 320;
/** Longest slice of one reply the crawl prints. */
const COMMENT_SLICE = 90;
/** Seconds of crawl per reply, so a long thread does not scroll any faster. */
const SECONDS_PER_REPLY = 7;

/**
 * What a collapsed row shows when it is pointed at.
 *
 * The right half of a collapsed row is empty, and this fills it: the body of the
 * post, expanded to what the space actually holds rather than clipped to a teaser
 * line, and - when the thread has replies - a crawl of the conversation under it,
 * like the information bar along the foot of a news channel. Each item is the
 * account's little picture, their name in the colour they chose, and what they
 * said, in quotes; the list runs twice through the track so the slide has no seam.
 *
 * It is a reading aid, not a control: the whole block is pointer-events-free, so
 * pointing at it still belongs to the row underneath, and it is hidden from
 * assistive tech because every word of it is on the expanded card already.
 */
export default function PostHoverPreview({ body, comments }: PostHoverPreviewProps) {
  const words = body.trim();
  const shown = words.length > BODY_SLICE ? `${words.slice(0, BODY_SLICE).trimEnd()}...` : words;
  const clipped = words.length > BODY_SLICE;

  return (
    /* The caller reserves the box (see ./ForumThreadCard.tsx): the width is held whether or not this
       is filled, so pointing at a row never reflows the list.

       **Out of flow, and that is what makes it a reveal rather than a jump.** It used to fill that box
       in the row's own flow, which meant the row grew to fit it - 66px of title and strip beside a
       187px panel - so pointing at a post pushed everything below it down, and moving the pointer on
       to the next post landed on the row that had just grown underneath instead. The row you pointed
       at stayed open and re-opened every time it closed, which is what "the hover does not collapse"
       looks like from the outside. An absolutely positioned panel cannot push anything (AGENTS.md,
       "Reveals take their space in both states", first of the two legal shapes), so nothing moves but
       the pointer, and the row that is pointed at is the row that answers.

       `pointer-events-none` is the second half of the same fix: the panel hangs over the rows below
       it, and if it took the pointer a reader moving down the list would keep the first row open
       instead of arriving at the second. Passing the pointer through means hovering a row is decided
       by the row it is over - which is also what this component's first version said it was for.

       `focus-within` matches as well, because a keyboard reader does not hover; `data-reveal` is how
       `Temp/check-reveals.cjs` knows this one is allowed. */
    <div
      data-reveal="reserved"
      className="pointer-events-none absolute top-0 right-0 z-10 hidden w-full flex-col gap-1 border border-black bg-paper p-2 group-hover:flex group-focus-within:flex"
    >
        {shown.length === 0 ? null : (
          <>
            <p className="min-h-0 flex-1 overflow-hidden whitespace-pre-line text-xs leading-snug text-ink">
              {shown}
            </p>
            {clipped ? (
              <p className="shrink-0 text-[9px] font-bold text-ink">[ + THE REST WHEN EXPANDED ]</p>
            ) : null}
          </>
        )}

        {comments.length === 0 ? null : (
          <div className="shrink-0 overflow-hidden" aria-hidden="true">
            {/* The reel is labelled, because a line of quoted fragments sliding past on its own reads
                as stray text: `LATEST REPLIES` says what the strip is before the first name arrives. */}
            <p className="text-[9px] font-bold text-ink">LATEST REPLIES</p>
            <div
              className="crawl flex w-max"
              style={{ animationDuration: `${Math.max(24, comments.length * SECONDS_PER_REPLY)}s` }}
            >
              {[0, 1].map((copy) => (
                <ul key={copy} className="flex items-center">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex items-center gap-1 whitespace-nowrap pr-4 text-[10px]">
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
        )}
      </div>
  );
}
