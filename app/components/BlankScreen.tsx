'use client';

import { useEffect, useState } from 'react';
import { KEY_FOCUS } from '../lib/ui/controls';
import { BLANK_KEYS, type BlankKey } from '../lib/watch/blank-screen';

/** Each key's lit dye (tokens.css: `--color-blank-*`), as the `--blank-lit` the `.blank-key` rules read. */
const LIT: Record<BlankKey, string> = {
  video: '[--blank-lit:var(--color-blank-video)]',
  music: '[--blank-lit:var(--color-blank-music)]',
  books: '[--blank-lit:var(--color-blank-books)]',
};

/** If the press animation never reports its end (animations off some other way), the window opens anyway. */
const PRESS_FALLBACK_MS = 1000;

const TIPS: Record<BlankKey, string> = {
  video: 'Find a video to queue',
  music: 'Find music to queue',
  books: 'Find a book to queue',
};

/**
 * A room's screen with nothing playing (SPEC-cytube.md): black, with three keys in the middle - VIDEO, MUSIC,
 * BOOKS - each opening the queue window with its search filled in. Yellow at rest; under the pointer or keyboard
 * focus VIDEO lights red, MUSIC pink, BOOKS green. Pressed, the key flashes and squishes, then the window opens;
 * with reduced motion only the colour changes and it opens at once. They stack on a narrow screen.
 *
 * Whether they add straight to the queue or to your own list is the queue window's crown rule, unchanged.
 *
 * The canvas (SPEC-stream-art.md): the room's canvas key sits in the screen's corner (WatchRoom's stage) and stays
 * while the screen is black; while the canvas is shown (`hidden`) these keys are gone, keeping their place, and come
 * back when the viewer switches back to the screen.
 */
export default function BlankScreen({ fit, onPick, hidden = false }: { fit: string; onPick: (key: BlankKey) => void; hidden?: boolean }) {
  const [pressed, setPressed] = useState<BlankKey | null>(null);

  function press(key: BlankKey) {
    if (pressed !== null) return;
    const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      onPick(key);
      return;
    }
    setPressed(key);
  }

  useEffect(() => {
    if (pressed === null) return;
    const key = pressed;
    const timer = window.setTimeout(() => {
      setPressed(null);
      onPick(key);
    }, PRESS_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [pressed, onPick]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-3 bg-hardware p-4 sm:flex-row sm:gap-6 ${fit} ${hidden ? 'invisible' : ''}`}
      aria-hidden={hidden}
      data-watch-blank={hidden ? 'hidden' : 'shown'}
    >
      {/* STUB until the room canvas is on main (SPEC-stream-art.md): its switch goes in this corner. Swap this line for
          the stage's CanvasToggle, and pass `hidden` while the viewer has the canvas up. */}
      <span className="absolute right-1 top-1 text-label text-ink-bar" data-canvas-stub>
        CANVAS: COMING SOON
      </span>
      {BLANK_KEYS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          // The window opens once the flash has played (the press animation's own end).
          onAnimationEnd={() => {
            if (pressed !== key) return;
            setPressed(null);
            onPick(key);
          }}
          data-pressed={pressed === key}
          aria-haspopup="dialog"
          title={TIPS[key]}
          className={`blank-key ${LIT[key]} cursor-pointer px-3 py-2 text-display font-bold ${KEY_FOCUS} data-[pressed=true]:animate-blank-press max-sm:min-h-tap`}
          data-blank-key={key}
        >
          [ {label} ]
        </button>
      ))}
    </div>
  );
}
