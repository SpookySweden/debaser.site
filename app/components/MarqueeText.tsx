'use client';

import { useEffect, useRef, useState } from 'react';

type MarqueeTextProps = {
  text: string;
  /** Seconds for the text to travel its own width. Longer lines can be given longer. */
  durationSeconds?: number;
  /** Classes for the box itself: the shape, not the text. */
  className?: string;
};

/**
 * A ticker for a line that will not fit.
 *
 * A track title is the one label on the site that is regularly longer than the space it is read in,
 * and the Web 1.0 answer to that was a marquee rather than an ellipsis: the words travel past and
 * come round again. This is that, modernised - two copies of the text travelling exactly one copy's
 * width, so the loop has no seam, and the animation only exists when the text really is too long for
 * the box (measured, not guessed). A short title sits still, which is the part a `<marquee>` never
 * managed.
 *
 * The pointer resting on it pauses it, so a title can be read and a link within it aimed at; a
 * reader who has asked their system for less motion gets a plain line they can select instead (see
 * the reduced-motion rule in app/globals.css).
 */
export default function MarqueeText({ text, durationSeconds = 16, className }: MarqueeTextProps) {
  const box = useRef<HTMLSpanElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;

    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();

    // A window that changes width changes the answer, so the measurement is not taken once.
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={box}
      className={`block overflow-hidden whitespace-nowrap ${className ?? ''}`}
      title={overflows ? text : undefined}
    >
      {overflows ? (
        <span
          className="inline-flex animate-marquee hover:[animation-play-state:paused]"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          <span className="pr-10">{text}</span>
          <span className="pr-10" aria-hidden="true">
            {text}
          </span>
        </span>
      ) : (
        text
      )}
    </span>
  );
}
