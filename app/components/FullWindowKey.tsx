'use client';

import { chosenFill, setChosenFill } from '../lib/ui/site-fill';

// Four corners, as on a video player: out to fill the screen, in to come back. Text characters, not a drawing.
const OUT = ['⌜', '⌝', '⌞', '⌟'];
const IN = ['⌟', '⌞', '⌝', '⌜'];

/**
 * The key at the top right of the site window. It's drawn in one of two places, the title bar and the band of modules, whichever is the top of
 * the window at the time, so the cursor is put back on it after a press. A full tap target, its extra height invisible, as a key on a phone is.
 */
export default function FullWindowKey({ on }: { on: boolean }) {
  const words = on ? 'Back to the normal window' : 'Fill the window';
  return (
    <button
      type="button"
      data-full-window-key=""
      aria-label={words}
      aria-pressed={on}
      title={words}
      onClick={() => {
        setChosenFill(!chosenFill());
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-full-window-key]')?.focus());
      }}
      className="key -my-3 hidden min-h-tap min-w-tap shrink-0 cursor-pointer items-center justify-center md:flex"
    >
      <span aria-hidden="true" className={`grid grid-cols-2 text-title leading-none ${on ? 'gap-1' : ''}`}>
        {(on ? IN : OUT).map((corner) => (
          <span key={corner}>{corner}</span>
        ))}
      </span>
    </button>
  );
}
