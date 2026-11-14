'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clipForNews } from '../lib/forum/news-feed';
import { PROFILE_COMMENTS_ANCHOR, PROFILE_PIN_LABEL } from '../lib/profile/feed';
import type { ProfileComment } from '../lib/profile/types';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import CommentRow, { commentRowData } from './CommentRow';

/**
 * The comments left on a profile, as a newswire you can drive (Luke, 2026-11-14: "make the profile comments section
 * into a newswire style slider too").
 *
 * One slim line of the site's own compact comment rows (the little picture, the name, when, the words), going past
 * like the board's NEWSWIRE, with three things a wire that only crawls does not have, because a line that cannot be
 * stopped or stepped is not readable by somebody who needs a moment longer with it:
 *
 *   - `[ ◀ ]` and `[ ▶ ]` step to the comment before and the comment after, at once (no glide: the site's feedback is
 *     instant), and the line then holds still for a few seconds so the comment stepped to can be read;
 *   - `[ HOLD ]` stops it for as long as you like (it stays down, as a switch that is on does), and a second press
 *     lets it go again. They are the site's bracket keys, full size: a pair of small arrows is no use to poor eyesight;
 *   - it also holds its breath while the pointer is on it and while the keyboard is inside it.
 *
 * Pressing a comment's words opens the full list at that comment (`onOpen`), which is where pinning and everything
 * else a row can do still lives.
 *
 * **Reduced motion:** nothing moves by itself. One comment is shown, whole and wrapped, and the two arrows step
 * through them: a slider rather than a wire. That is also what the server draws, so a page is never moving before
 * the browser has said whether it may.
 *
 * The moving line is driven from here (a frame at a time, in whole pixels) rather than by the stylesheet's `crawl`,
 * because a stylesheet's animation cannot be stepped to a comment. The second copy of the rows is only there to make
 * the loop seamless: it is hidden from assistive tech and skipped by the Tab key.
 */

/** How fast the line goes past, in pixels a second: slow enough to read a row as it crosses. */
const PIXELS_PER_SECOND = 60;

/** How long the line stays put after a step, so the comment stepped to can be read. */
const HOLD_AFTER_STEP_MS = 8000;

/** A comment's words on the line: short enough that a row stepped to fits in the strip. */
const WORDS_ON_THE_LINE = 80;

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeReduced(change: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => true;

type CommentSliderProps = {
  /** The comments this reader may see, in the order the full list shows them. */
  comments: ProfileComment[];
  /** A comment's words were pressed: open the full list at it. */
  onOpen: (commentId: string) => void;
};

export default function CommentSlider({ comments, onOpen }: CommentSliderProps) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const [stopped, setStopped] = useState(false);
  /** Which comment the still slider shows (reduced motion). */
  const [shown, setShown] = useState(0);

  const strip = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  /** How far the line has gone, in pixels, and what is holding it still: read by the loop, never rendered. */
  const offset = useRef(0);
  const pointerOn = useRef(false);
  const keyboardIn = useRef(false);
  const holdUntil = useRef(0);
  const stoppedNow = useRef(false);

  const moving = !reduced && comments.length > 1;

  const place = useCallback(() => {
    if (track.current !== null) track.current.style.transform = `translateX(${-Math.round(offset.current)}px)`;
  }, []);

  // The loop: one frame at a time, the line moves on unless something is holding it. A tab in the background gets no
  // frames, so it costs nothing there.
  useEffect(() => {
    if (!moving) return;
    let frame = 0;
    let last = 0;

    const tick = (now: number) => {
      const line = track.current;
      const elapsed = last === 0 ? 0 : Math.min(now - last, 100);
      last = now;

      if (line !== null) {
        const loop = line.scrollWidth / 2;
        const held = stoppedNow.current || pointerOn.current || keyboardIn.current || now < holdUntil.current;
        if (!held && loop > 0) {
          offset.current = (offset.current + (PIXELS_PER_SECOND * elapsed) / 1000) % loop;
          place();
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [moving, place]);

  // The copy that only makes the loop seamless is not a second set of things to tab through.
  useLayoutEffect(() => {
    const line = track.current;
    if (line === null) return;
    for (const control of line.querySelectorAll<HTMLElement>('[data-slider-copy="1"] a, [data-slider-copy="1"] button')) {
      control.tabIndex = -1;
    }
  }, [comments, moving]);

  /** Where each row of the first copy starts along the line. */
  const rowStarts = useCallback((): number[] => {
    const first = track.current?.querySelector('[data-slider-copy="0"]');
    if (first === null || first === undefined) return [];
    return Array.from(first.children, (row) => (row as HTMLElement).offsetLeft);
  }, []);

  const step = useCallback(
    (by: 1 | -1) => {
      if (!moving) {
        setShown((current) => (current + by + comments.length) % comments.length);
        return;
      }

      const starts = rowStarts();
      if (starts.length === 0) return;
      let at = 0;
      for (let index = 0; index < starts.length; index += 1) {
        if (starts[index] <= offset.current + 2) at = index;
      }
      // Back, from part-way through a row, goes to that row's own start first: the comment being read, from the top.
      const next = by === 1 ? (at + 1) % starts.length : offset.current - starts[at] > 8 ? at : (at - 1 + starts.length) % starts.length;

      offset.current = starts[next];
      holdUntil.current = window.performance.now() + HOLD_AFTER_STEP_MS;
      place();
    },
    [moving, comments.length, rowStarts, place],
  );

  const toggleStopped = useCallback(() => {
    const next = !stoppedNow.current;
    stoppedNow.current = next;
    // Starting it again means now, not when a step's hold runs out.
    if (!next) holdUntil.current = 0;
    setStopped(next);
  }, []);

  /** The keyboard arriving on a row: the line stops, and that row is brought to the front of the strip. */
  const handleFocus = useCallback(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches(':focus-visible')) return;
    keyboardIn.current = true;
    // A browser scrolls a clipped box to show what was focused, which would shift the line under its own maths.
    if (strip.current !== null) strip.current.scrollLeft = 0;
    const row = focused.closest('li');
    if (moving && row instanceof HTMLElement) {
      // The line is the rows' positioned parent (`relative`), so a row's own left edge is its place along it.
      offset.current = row.offsetLeft;
      place();
    }
  }, [moving, place]);

  if (comments.length === 0) return null;

  const row = (comment: ProfileComment, copy: number) => (
    <CommentRow
      key={`${copy}-${comment.id}`}
      data={{ ...commentRowData(comment), body: clipForNews(comment.body, WORDS_ON_THE_LINE) }}
      variant="compact"
      // The words are a real link to the comments section; the press opens the full list at this comment instead.
      href={`#${PROFILE_COMMENTS_ANCHOR}`}
      hrefTitle="Open the comments at this one"
      onHrefClick={(event) => {
        event.preventDefault();
        onOpen(comment.id);
      }}
      {...(comment.pinned === true ? { pinnedLabel: PROFILE_PIN_LABEL } : {})}
    />
  );

  const one = comments[Math.min(shown, comments.length - 1)];

  return (
    <div
      className="flex items-center gap-1 px-2 py-1"
      data-comment-slider={moving ? 'moving' : 'still'}
      onPointerEnter={() => {
        pointerOn.current = true;
      }}
      onPointerLeave={() => {
        pointerOn.current = false;
      }}
    >
      {comments.length < 2 ? null : (
        <div role="group" aria-label="Step through the comments" className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label="Previous comment" title="Previous comment" className={PLATE}>
            [ ◀ ]
          </button>
          {moving ? (
            <button
              type="button"
              onClick={toggleStopped}
              aria-pressed={stopped}
              aria-label="Hold the comments still"
              title={stopped ? 'Let the comments move again' : 'Hold the comments still'}
              className={stopped ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
            >
              {stopped ? 'HOLD' : '[ HOLD ]'}
            </button>
          ) : null}
          <button type="button" onClick={() => step(1)} aria-label="Next comment" title="Next comment" className={PLATE}>
            [ ▶ ]
          </button>
        </div>
      )}

      <div
        ref={strip}
        className="min-w-0 flex-1 overflow-hidden"
        onFocus={handleFocus}
        onBlur={() => {
          keyboardIn.current = false;
        }}
      >
        {moving ? (
          <div ref={track} className="relative flex w-max items-center">
            {[0, 1].map((copy) => (
              <ul key={copy} data-slider-copy={copy} className="flex items-center" aria-hidden={copy === 1 ? 'true' : undefined}>
                {comments.map((comment) => row(comment, copy))}
              </ul>
            ))}
          </div>
        ) : (
          // Still: one comment, whole. `aria-live` so a step is read out; a moving line is never announced.
          <ul aria-live="polite">{row(one, 0)}</ul>
        )}
      </div>
    </div>
  );
}
