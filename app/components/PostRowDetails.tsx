'use client';

import type { ForumComment } from '../lib/forum/types';
import PostReplyReel from './PostReplyReel';

type PostRowDetailsProps = {
  /** The post's own words: empty for a thread an item's comment box opened. */
  body: string;
  /** The thread's replies, oldest first as the thread keeps them: the wire under the words sorts them. */
  comments: ForumComment[];
};

/**
 * How much of the post the band is handed before it stops being worth drawing.
 *
 * Not the clipping limit - the box clips, and the fade marks where - but a ceiling on the DOM: a
 * 20,000-character post painted into every row of the board, three lines of which can be seen, is a
 * board rendering its own writing many times over to hide all but the top of it.
 */
const BODY_LIMIT = 900;

/**
 * The right-hand band of a collapsed row: the post's own words, and the wire of its replies.
 *
 * The right two fifths of a collapsed row were reserved and then left empty until a pointer arrived:
 * this component was `PostHoverPreview`, it revealed itself on hover, and on the way it was found to
 * be answering `:focus-within` as well - so the click that collapsed a post left the panel lying over
 * the rows below. **Both of those are gone now: the band is filled in both states, and hovering a row
 * is only a highlight.** There is nothing left to reveal, so there is nothing left to dismiss, and a
 * row cannot be taller pointed at than it is at rest.
 *
 * What it carries is as much of the post as the row's own height allows - the box is `absolute
 * inset-0` inside the column its caller reserved, whose height is set by the title, the credit strip
 * and the tags beside it, so the words are clipped by the row rather than the row by the words - and
 * under them the thread's replies, drawn as the site's newswire rows (./PostReplyReel.tsx). The words
 * lose their opacity as they run into the bottom of the box, and a small `[ EXPAND ]` sits over where
 * they go: the rest of the post is one click away, and the plate says where to click.
 *
 * It is a reading aid, not a control: `pointer-events-none`, so the whole band still belongs to the
 * `<summary>` beneath it, and `aria-hidden`, because every word of it - and every reply - is on the
 * expanded card already. `data-reveal="reserved"` is the declaration the reveal rule asks for (it
 * fills a box the caller laid out in both states), and it is the handle the browser probes read the
 * band by.
 */
export default function PostRowDetails({ body, comments }: PostRowDetailsProps) {
  const words = body.trim();
  const shown = words.length > BODY_LIMIT ? `${words.slice(0, BODY_LIMIT).trimEnd()}...` : words;

  return (
    <div
      data-reveal="reserved"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex flex-col gap-1 overflow-hidden p-1"
    >
      {shown.length === 0 ? null : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* The fade is a mask on the words rather than a plate painted over them, and that is the
              difference between this and an overlay: what fades is the text's own opacity, so it reads
              the same on a quiet row and on the row a pointer has just brightened. An overlay would
              have to be the colour of whatever is under it, and that changes with both. */}
          <p className="whitespace-pre-line text-xs leading-snug text-ink [mask-image:linear-gradient(to_bottom,black_58%,transparent_100%)]">
            {shown}
          </p>
          <p className="absolute right-0 bottom-0 border border-black bg-paper px-1 text-[9px] font-bold text-ink">
            [ EXPAND ]
          </p>
        </div>
      )}

      {/* The thread's replies, which are their own component because the narrow board draws the same
          strip under the credit strip of a collapsed row (see ./PostReplyReel.tsx). */}
      <PostReplyReel comments={comments} className="shrink-0" />
    </div>
  );
}
