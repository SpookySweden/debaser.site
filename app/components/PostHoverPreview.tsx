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

/** Past a couple of lines the tail of the writing waits for the expanded card. */
const BODY_SLICE = 320;
/** Longest slice of one reply the crawl prints. */
const COMMENT_SLICE = 90;
/** Seconds of crawl per reply, so a long thread does not scroll any faster. */
const SECONDS_PER_REPLY = 7;

/**
 * What a collapsed row shows when it is pointed at.
 *
 * The right half of a collapsed row is empty, and this fills it: the body of the
 * post, clipped to the space that is there, and - when the thread has replies - a
 * crawl of the conversation underneath, like the information bar along the foot
 * of a news channel. Each item is the account's little picture, their name in the
 * colour they chose, and what they said, in quotes; the list runs twice through
 * the track so the slide has no seam.
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
       is filled, so pointing at a row never reflows the list. What is inside is what the pointer
       reveals - and `focus-within` matches, because a keyboard reader does not hover.

       `data-reveal` is how `Temp/check-reveals.cjs` knows this one is allowed: an element that fills a
       space somebody else reserved is the legal shape, and the attribute is the declaration of it
       rather than something a regex has to guess from the surrounding markup. */
    <div
      data-reveal="reserved"
      className="hidden min-h-0 w-full flex-col gap-1 overflow-hidden border-l border-dashed border-ink pl-3 group-hover:flex group-focus-within:flex"
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
