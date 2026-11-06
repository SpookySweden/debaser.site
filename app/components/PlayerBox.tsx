'use client';

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { floatingState, registerBox, setFloatAsked, subscribeToFloating, togglePlayerFullscreen } from '../lib/ui/floating-player';

/**
 * What a row draws for its video (SPEC-floating-player.md): a reserved box, and the `[ PIP ]` key. The video itself is in
 * the one layer in `layout.tsx` (`FloatingPlayer.tsx`), which sits exactly over this box while it is on screen. The box
 * keeps its size whether the video is in it or floating, so nothing on the page moves.
 */

/** This row's video is the one playing. Rows ask this and re-render only when the answer changes. */
export function usePlayingHere(id: string): boolean {
  const here = () => floatingState().entry?.id === id;
  return useSyncExternalStore(subscribeToFloating, here, here);
}

function useFloatingFrom(id: string): boolean {
  const here = () => {
    const state = floatingState();
    return state.entry?.id === id && state.floating;
  };
  return useSyncExternalStore(subscribeToFloating, here, here);
}

function useAskedHere(id: string): boolean {
  const here = () => {
    const state = floatingState();
    return state.entry?.id === id && state.asked;
  };
  return useSyncExternalStore(subscribeToFloating, here, here);
}

export default function PlayerBox({ id, title, className }: { id: string; title: string; className: string }) {
  const box = useRef<HTMLDivElement>(null);
  const floating = useFloatingFrom(id);

  // In a layout effect, so the layer finds the box before the first frame: a video never shows in a corner first.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    return registerBox(id, element);
  }, [id]);

  return (
    <div ref={box} data-player-box={id} className={`flex items-center justify-center ${className}`}>
      {floating ? (
        <button type="button" onClick={() => setFloatAsked(false)} aria-label={`Back here: "${title}"`} className={PLATE}>
          [ ▲ BACK HERE ]
        </button>
      ) : null}
    </div>
  );
}

/** Beside a playing video's CLOSE: floats it or brings it back, and fullscreen for a keyboard or a player with no way of its own. */
export function PipKey({ id, title }: { id: string; title: string }) {
  const asked = useAskedHere(id);
  return (
    <>
      <button
        type="button"
        onClick={() => setFloatAsked(!asked)}
        aria-pressed={asked}
        aria-label={`PIP: "${title}" floats over the site`}
        title="Floats over the site, even on other pages"
        className={asked ? PLATE_PRESSED : PLATE}
      >
        [ PIP ]
      </button>
      <button type="button" onClick={togglePlayerFullscreen} aria-label={`Fullscreen: "${title}"`} className={PLATE}>
        [ FULL ]
      </button>
    </>
  );
}
