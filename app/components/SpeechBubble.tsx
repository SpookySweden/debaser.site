'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PROFILE_COMMENTS_ANCHOR } from '../lib/profile/feed';
import { pagesOf, pausesAfter, SPEECH_PACE, type SpeechLine } from '../lib/speech/script';

type SpeechBubbleProps = {
  /** What is being said: one person's own words. */
  line: SpeechLine;
  /** Who is saying it, as the bubble names them. */
  name: string;
  /** The speaker's box in the room: its left edge, width and height, in the room's own pixels. */
  at: { x: number; w: number; h: number };
  /** The room's width: the bubble is kept inside it. */
  within: number;
  /** Shown whole and left there (reduced motion): nothing types and nothing ends by itself. */
  whole?: boolean;
  /** The last page has been up for its time. */
  onDone?: () => void;
  /** Pressed, and what was said is a comment on this very profile: open the comments here at it. */
  onOpenHere: (commentId: string) => void;
  /** A letter has just appeared (the voice's hook). */
  onLetter?: (letter: string) => void;
};

/** The gap between the top of a figure's box and its bubble, where the bubble's `▼` sits. */
const TAIL = 14;

/**
 * What a character is saying, in a bubble over its head (SPEC-character-speech.md; Luke, 2026-11-14: "Bubble over
 * head", "pixelated urr urr urr undertale looking text").
 *
 * The words appear a letter at a time, about 25 a second, with a short stop after `, . ! ?`. A long line is shown two
 * lines at a time: each page stays a moment after its last letter, then the next takes its place, and after the last
 * `onDone` is called. The rest of a page is drawn invisibly from the first letter, so the box is its final size at once
 * and never grows under the reader's eye.
 *
 * It is a real link, and pressing it goes to what was said (Luke: "clicking the bubble goes to the post"): a comment
 * on this profile opens the comments here at that comment, anything else opens the board on that exact post or reply.
 * A screen reader is given the whole line as the link's name, once, rather than a letter at a time.
 *
 * No drawn art: a box, an outline, and a `▼` text mark. Third-party words are plain text.
 */
export default function SpeechBubble({ line, name, at, within, whole = false, onDone, onOpenHere, onLetter }: SpeechBubbleProps) {
  const pages = useMemo(() => pagesOf(line.text), [line.text]);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const box = useRef<HTMLAnchorElement | null>(null);
  const [width, setWidth] = useState(0);

  const rows = pages[Math.min(page, pages.length - 1)] ?? [];
  const letters = rows.join('');
  const shown = whole ? letters.length : Math.min(count, letters.length);

  // The handlers are read when a timer fires, so a parent's redraw never restarts the typing.
  const done = useRef(onDone);
  const letter = useRef(onLetter);
  useEffect(() => {
    done.current = onDone;
    letter.current = onLetter;
  });

  useEffect(() => {
    if (whole) return;

    if (count < letters.length) {
      const stop = count > 0 && pausesAfter(letters[count - 1]) ? SPEECH_PACE.pauseMs : 0;
      const timer = window.setTimeout(() => {
        letter.current?.(letters[count]);
        setCount(count + 1);
      }, SPEECH_PACE.letterMs + stop);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      if (page + 1 < pages.length) {
        setPage(page + 1);
        setCount(0);
      } else {
        done.current?.();
      }
    }, SPEECH_PACE.pageMs);
    return () => window.clearTimeout(timer);
  }, [whole, count, letters, page, pages.length]);

  // Measured before it is painted, and again for each page: where it sits depends on how wide it is.
  useLayoutEffect(() => {
    if (box.current !== null) setWidth(box.current.offsetWidth);
  }, [page, line.id, name]);

  // Centred over the speaker, and kept inside the room.
  const centre = at.x + at.w / 2;
  const left = Math.max(2, Math.min(centre - width / 2, within - width - 2));

  const here = line.target.kind === 'here' ? line.target.commentId : null;
  /** How many letters come before each row of the page. */
  const starts = rows.map((_row, index) => rows.slice(0, index).reduce((sum, earlier) => sum + earlier.length, 0));

  return (
    <Link
      ref={box}
      href={line.target.kind === 'board' ? line.target.href : `#${PROFILE_COMMENTS_ANCHOR}`}
      onClick={(event) => {
        if (here === null) return;
        event.preventDefault();
        onOpenHere(here);
      }}
      aria-label={`${name.toUpperCase()} SAID: ${line.text}`}
      title="GO TO WHAT WAS SAID"
      data-speech-bubble={line.id}
      data-speech-page={`${Math.min(page, Math.max(0, pages.length - 1)) + 1}/${pages.length}`}
      className="absolute z-10 block border-line border-ink-bar bg-ena-deep px-2 py-1 font-speech text-heading leading-tight whitespace-nowrap text-ink-bar hover:border-acid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid"
      style={{ left: left - at.x, bottom: at.h + TAIL, visibility: width === 0 ? 'hidden' : 'visible' }}
    >
      <span aria-hidden="true" className="block text-acid">
        {name}:
      </span>
      {rows.map((row, index) => {
        const typed = Math.max(0, Math.min(row.length, shown - starts[index]));
        return (
          <span key={`${page}-${index}`} aria-hidden="true" className="block">
            <span data-speech-typed="">{row.slice(0, typed)}</span>
            <span className="invisible">{row.slice(typed)}</span>
          </span>
        );
      })}
      {/* The tail: a text mark under the box, over the middle of whoever is speaking. */}
      <span aria-hidden="true" className="absolute top-full text-label leading-none text-ink-bar" style={{ left: Math.max(4, centre - left - 6) }}>
        ▼
      </span>
    </Link>
  );
}

/** How much taller a room is drawn so a bubble fits over its tallest figure: a name, two lines, the box and its tail. */
export const SPEECH_HEADROOM = 108;
