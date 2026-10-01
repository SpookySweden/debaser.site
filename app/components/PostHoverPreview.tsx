'use client';

import type { ForumComment } from '../lib/forum/types';
import PostReplyReel from './PostReplyReel';

type PostHoverPreviewProps = {
  /** The post's own words: empty for a thread an item's comment box opened. */
  body: string;
  /** Replies, oldest first: the reel shows them in the order they were filed. */
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

       **The keyboard half is `:focus-visible`, and `:focus-within` was the bug.** `:focus-within`
       matches for *any* focus inside the `<details>`, and a mouse click leaves focus behind: a real
       click on a `<summary>` puts `document.activeElement` on it, `:focus` matches and `:focus-visible`
       does not. So the reader's own sequence - open a post, read it, click the row again to put it
       away, move the pointer off the list - ended with the panel still over the rows below, because
       the click that collapsed the row had focused it. Measured on the deployed board, with the
       pointer already away: `:focus-within` true, `:focus-visible` false, panel `display: flex`.
       `:focus-within` is right for a text field and wrong for a reveal: a keyboard reader does not
       hover, so the reveal must answer a keyboard focus and only a keyboard focus - which is exactly
       what `:focus-visible` asks, and the same click reports it false.

       `data-reveal` is how `Temp/check-reveals.cjs` knows this one is allowed. */
    <div
      data-reveal="reserved"
      className="pointer-events-none absolute top-0 right-0 z-10 hidden w-full flex-col gap-1 border border-black bg-paper p-2 group-hover:flex group-has-[:focus-visible]:flex"
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

        {/* The reel of replies, which is its own component because the narrow board draws the same
            one under the credit strip of a collapsed row (see ./PostReplyReel.tsx). */}
        <PostReplyReel comments={comments} className="shrink-0" />
      </div>
  );
}
