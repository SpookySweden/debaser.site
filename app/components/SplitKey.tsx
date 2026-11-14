'use client';

import type { ReactNode } from 'react';
import { KEY_FOCUS, PLATE, PLATE_PRESSED } from '../lib/ui/controls';

/**
 * **One key, two halves** (Luke's list, 2026-11-14: M6 "play/ watch in room, two halves of the same button", M9 "another
 * dual button of +letter/playlist", M10 "with dual buttons each half glows a different colour when hovered").
 *
 * `[ ▶ PLAY │ + QUEUE ]`: one pair of brackets round two presses. Each half is its own button with its own name for a
 * screen reader, and under the pointer each fills a different dye at once (`.split-first` / `.split-second` in
 * app/globals.css): the first half the "go" green, the second Brilliant Pink, Black words on both, nothing moving. With
 * no second half it is an ordinary key, `[ ▶ PLAY ]`.
 *
 * A half is either drawn here from its words and its press, or drawn by a key component of its own (`draw`), which is
 * handed the half's class and its words with the bracket on (AddToLetterKey and AddToPlaylistKey take both).
 *
 * Shared on purpose: any part of the site may use it once it is on main.
 */

export type Half = {
  /** The words, without brackets: `▶ PLAY`, `+ QUEUE`. */
  words: string;
  /** Its name for a screen reader; the visible words lead it, so a voice command for what is on screen works. */
  label?: string;
  press?: () => void;
  disabled?: boolean;
  /** Drawn as the filled pill of a key that is down (a player that is open). */
  on?: boolean;
  /** A key that folds something open in place, or opens a window. */
  expanded?: boolean;
  haspopup?: boolean;
  pressed?: boolean;
  busy?: boolean;
  /** A hook for the checks and drives: `data-split-half`. */
  data?: string;
  /** Draws the half itself: a key component with a window of its own. */
  draw?: (className: string, text: string) => ReactNode;
  /** What follows the key: a status line, a window. */
  after?: ReactNode;
};

/** The parts a half shares with `PLATE`, less its side padding, which the halves split between them. */
const HALF = `key cursor-pointer py-1 text-label ${KEY_FOCUS} active:animate-flash active:translate-y-press active:text-ink-plate disabled:cursor-not-allowed max-sm:min-h-tap max-sm:py-2 max-sm:text-sm`;
/** The first half: green under the pointer, and the pink flash when pressed. */
export const SPLIT_FIRST = `${HALF} split-first px-1 active:bg-bubble max-sm:px-1`;
/** The second half: pink under the pointer, so its press flashes Daffodil instead. */
export const SPLIT_SECOND = `${HALF} split-second px-1 active:bg-sun max-sm:px-1`;
/** A half that is down: the pill of `PLATE_PRESSED`, in the same box. */
const SPLIT_ON = `key key-fill key-on cursor-pointer [--key-fill:var(--color-ink)] py-0.5 text-label text-paper ${KEY_FOCUS} max-sm:min-h-tap max-sm:py-1.5 max-sm:text-sm`;

function drawHalf(half: Half, className: string, text: string): ReactNode {
  if (half.draw) return half.draw(className, text);
  return (
    <button
      type="button"
      onClick={half.press}
      disabled={half.disabled}
      aria-label={half.label}
      aria-expanded={half.expanded}
      aria-haspopup={half.haspopup ? 'dialog' : undefined}
      aria-pressed={half.pressed}
      aria-busy={half.busy}
      className={className}
      data-split-half={half.data}
    >
      {text}
    </button>
  );
}

export default function SplitKey({ label, first, second }: { label: string; first: Half; second: Half | null }) {
  if (second === null) {
    return (
      <>
        {drawHalf(first, first.on ? PLATE_PRESSED : PLATE, `[ ${first.words} ]`)}
        {first.after}
      </>
    );
  }
  return (
    <>
      <span role="group" aria-label={label} className="inline-flex items-stretch" data-split-key>
        {drawHalf(first, first.on ? `${SPLIT_ON} px-0.5` : SPLIT_FIRST, `[ ${first.words}`)}
        {/* The seam between the halves: one character, the key's own ink, never pressed. */}
        <span aria-hidden="true" className="flex items-center text-label text-accent-ink max-sm:text-sm">
          │
        </span>
        {drawHalf(second, second.on ? `${SPLIT_ON} px-0.5` : SPLIT_SECOND, `${second.words} ]`)}
      </span>
      {first.after}
      {second.after}
    </>
  );
}
