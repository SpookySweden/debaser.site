'use client';

import { useSyncExternalStore } from 'react';

/**
 * A media query, read the moment the page is in the browser (null on the server and in the hydrating render), so the
 * companion never runs one frame on a guess: a phone as a computer, or reduced motion as motion.
 */
function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

/**
 * A device with no mouse or pen at all: a phone or a tablet. The site gives phones the desktop zoomed out (a fixed 1280px
 * layout, `app/layout.tsx`), so the width cannot tell them apart; the pointer can. The companion is off on these unless
 * it is switched on there (SPEC-companion.md, decision 2). Null until it can be read.
 */
export function usePhone(): boolean | null {
  const fine = useMediaQuery('(any-pointer: fine)');
  return fine === null ? null : !fine;
}

/** The reader asked for less motion. Null until it can be read. */
export function useReducedMotion(): boolean | null {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
