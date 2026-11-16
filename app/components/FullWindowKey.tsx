'use client';

import { KEY_FOCUS } from '../lib/ui/controls';
import { chosenFill, setChosenFill } from '../lib/ui/site-fill';
import { setSiteHidden } from '../lib/ui/site-hidden';

/**
 * FILL WINDOW: the key at the far end of the top bar that makes the site window run edge to edge, and brings it back.
 *
 * A bracket key with its action in words (Luke, 2026-11-14: "pretty buggy and not very obvious"). It was four small corner characters
 * that sat in the title line when the window was normal and in this bar when it was filled. Now it is one key in one place, and its
 * words say what a press will do: `[ FILL WINDOW ]`, then `[ SHRINK WINDOW ]`.
 *
 * Both sets of words are drawn and the stylesheet shows the one for the state the window is in (`.fill-key-*`, globals.css, from the
 * same mark on `<html>` that lays the window out), so after a reload the key reads right from the first frame too. A full tap target,
 * its extra height invisible, as a key on a phone is: a phone gets this desktop zoomed out.
 */
export default function FullWindowKey({ on }: { on: boolean }) {
  const words = on ? 'Shrink window' : 'Fill window';
  return (
    <button
      type="button"
      data-full-window-key=""
      aria-label={words}
      aria-pressed={on}
      title={on ? 'Back to the normal window' : 'Make the window fill the screen'}
      onClick={() => setChosenFill(!chosenFill())}
      className={`key ${KEY_FOCUS} -my-2 hidden min-h-tap shrink-0 cursor-pointer items-center px-2 text-label font-bold leading-none whitespace-nowrap active:translate-y-press active:bg-bubble active:text-ink-plate md:inline-flex`}
    >
      <span aria-hidden="true" className="fill-key-off">[ FILL WINDOW ]</span>
      <span aria-hidden="true" className="fill-key-on">[ SHRINK WINDOW ]</span>
    </button>
  );
}

/**
 * HIDE WINDOW, just left of FILL WINDOW (Luke, 2026-11-16: "collapses the main site window, so more of the background shows"). It
 * puts the site window away; `[ ▲ WINDOW ]` above the player brings it back (CornerShelf.tsx). Remembered in this browser
 * (../lib/ui/site-hidden.ts). The window is gone while it is put away, so this key only ever reads one way.
 */
export function HideWindowKey() {
  return (
    <button
      type="button"
      data-hide-window-key=""
      aria-label="Hide window"
      title="Put the window away to see the background"
      onClick={() => setSiteHidden(true)}
      className={`key ${KEY_FOCUS} -my-2 hidden min-h-tap shrink-0 cursor-pointer items-center px-2 text-label font-bold leading-none whitespace-nowrap active:translate-y-press active:bg-bubble active:text-ink-plate md:inline-flex`}
    >
      <span aria-hidden="true">[ HIDE WINDOW ]</span>
    </button>
  );
}
