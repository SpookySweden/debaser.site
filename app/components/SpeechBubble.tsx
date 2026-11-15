'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PROFILE_COMMENTS_ANCHOR } from '../lib/profile/feed';
import { BUBBLE_LINE, BUBBLE_LINES, pagesOf, pausesAfter, SPEECH_PACE, type SpeechLine } from '../lib/speech/script';

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
  /** Shown whole, but only for this long (a line of chat under reduced motion): then `onDone`. */
  wholeForMs?: number;
  /** Not kept inside anything: simply centred over the speaker (a companion on its strip, which has no room). */
  free?: boolean;
  /** The last page has been up for its time. */
  onDone?: () => void;
  /** Pressed, and what was said is a comment on this very profile: open the comments here at it. */
  onOpenHere: (commentId: string) => void;
  /** A letter has just appeared (the voice's hook). */
  onLetter?: (letter: string) => void;
};

/** The gap between the top of a figure's box and its bubble, where the bubble's `▼` sits. */
const TAIL = 14;
/** The gap between a speaker and a bubble that sits beside it, where that bubble's `◀` sits. */
const SIDE_GAP = 14;
/** The height of one row of the bubble (the name's, or a line of words). */
const NAME_ROW = 24;

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
export default function SpeechBubble({ line, name, at, within, whole = false, wholeForMs, free = false, onDone, onOpenHere, onLetter }: SpeechBubbleProps) {
  /** Where it sits: over its speaker's head, or beside it when there is no room on screen above (a free bubble only). */
  const [beside, setBeside] = useState<'over' | 'right' | 'left'>('over');
  // Beside its speaker (a companion along the top of the screen, on a stream room's window) there is only the height
  // of the companion itself to be read in: one line at a time there, so the window under it never cuts a line off.
  const pages = useMemo(() => pagesOf(line.text, BUBBLE_LINE, beside === 'over' ? BUBBLE_LINES : 1), [line.text, beside]);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const box = useRef<HTMLElement | null>(null);
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

  // Shown whole for a while only (chat under reduced motion): it goes by itself.
  useEffect(() => {
    if (!whole || wholeForMs === undefined) return;
    const timer = window.setTimeout(() => done.current?.(), wholeForMs);
    return () => window.clearTimeout(timer);
  }, [whole, wholeForMs]);

  // Shown whole (reduced motion): one soft blip for the page, in place of one a letter.
  useEffect(() => {
    if (whole && letters.length > 0) letter.current?.(letters[0]);
  }, [whole, letters]);

  // Measured before it is painted, and again whenever its size changes (a new page; the speech face arriving after
  // its stand-in): where it sits depends on how big it is. A free bubble also looks at where its speaker is on the
  // screen: a companion standing along the top of the screen (on a stream room's window) has no room over its head, so
  // the bubble goes beside it instead, where it can be read.
  useLayoutEffect(() => {
    const drawn = box.current;
    if (drawn === null) return;
    const measure = () => {
      setWidth(drawn.offsetWidth);
      if (!free) return;
      const speaker = drawn.offsetParent?.getBoundingClientRect();
      if (speaker === undefined) return;
      setBeside((current) => {
        // What it needs over a head: its height with the name's row and the second line, which a bubble beside its
        // speaker goes without.
        const needed = drawn.offsetHeight + (current === 'over' ? 0 : NAME_ROW * 2) + TAIL;
        if (speaker.top - needed >= 2) return 'over';
        return speaker.right + SIDE_GAP + drawn.offsetWidth + 2 <= window.innerWidth ? 'right' : 'left';
      });
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(drawn);
    return () => sizes.disconnect();
  }, [free, page, line.id, name]);

  // Centred over the speaker, and kept inside the room.
  const centre = at.x + at.w / 2;
  const left = free ? centre - width / 2 : Math.max(2, Math.min(centre - width / 2, within - width - 2));

  const here = line.target.kind === 'here' ? line.target.commentId : null;
  const href = line.target.kind === 'board' ? line.target.href : `#${PROFILE_COMMENTS_ANCHOR}`;
  /** How many letters come before each row of the page. */
  const starts = rows.map((_row, index) => rows.slice(0, index).reduce((sum, earlier) => sum + earlier.length, 0));

  const look =
    'absolute z-10 block border-line border-ink-bar bg-ena-deep px-2 py-1 font-speech text-heading leading-tight whitespace-nowrap text-ink-bar';
  const visibility = width === 0 ? ('hidden' as const) : ('visible' as const);
  const place =
    beside === 'over'
      ? { left: left - at.x, bottom: at.h + TAIL, visibility }
      : beside === 'right'
        ? { left: at.w + SIDE_GAP, top: 0, visibility }
        : { right: at.w + SIDE_GAP, top: 0, visibility };
  const words = (
    <>
      {/* Beside its speaker a bubble goes without the name's row: it is short of room there, and it points at who it is. */}
      {beside === 'over' ? (
        <span aria-hidden="true" className="block text-acid">
          {name}:
        </span>
      ) : null}
      {rows.map((row, index) => {
        const typed = Math.max(0, Math.min(row.length, shown - starts[index]));
        return (
          <span key={`${page}-${index}`} aria-hidden="true" className="block">
            <span data-speech-typed="">{row.slice(0, typed)}</span>
            <span className="invisible">{row.slice(typed)}</span>
          </span>
        );
      })}
      {/* The tail: a text mark under the box, over the middle of whoever is speaking; or at its side, pointing at them. */}
      {beside === 'over' ? (
        <span aria-hidden="true" className="absolute top-full text-label leading-none text-ink-bar" style={{ left: Math.max(4, centre - left - 6) }}>
          ▼
        </span>
      ) : (
        <span aria-hidden="true" className={`absolute top-1 text-label leading-none text-ink-bar ${beside === 'right' ? 'right-full' : 'left-full'}`}>
          {beside === 'right' ? '◀' : '▶'}
        </span>
      )}
    </>
  );
  const pageOf = `${Math.min(page, Math.max(0, pages.length - 1)) + 1}/${pages.length}`;

  // A line that leads nowhere (a stream room's chat): a plain box, hidden from a screen reader, which has the chat itself.
  if (line.target.kind === 'none') {
    return (
      <span
        ref={box as React.RefObject<HTMLSpanElement | null>}
        aria-hidden="true"
        data-speech-bubble={line.id}
        data-speech-page={pageOf}
        className={`${look} pointer-events-none`}
        style={place}
      >
        {words}
      </span>
    );
  }

  return (
    <Link
      ref={box as React.RefObject<HTMLAnchorElement | null>}
      href={href}
      onClick={(event) => {
        if (here === null) return;
        event.preventDefault();
        onOpenHere(here);
      }}
      aria-label={`${name.toUpperCase()} SAID: ${line.text}`}
      title="GO TO WHAT WAS SAID"
      data-speech-bubble={line.id}
      data-speech-page={pageOf}
      className={`${look} hover:border-acid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid`}
      style={place}
    >
      {words}
    </Link>
  );
}

/** How much taller a room is drawn so a bubble fits over its tallest figure: a name, two lines, the box and its tail. */
export const SPEECH_HEADROOM = 108;
