'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { clampDocsSize, DOCS_SIZE_DEFAULT, DOCS_SIZE_DEFAULT_PHONE } from './ui';

/**
 * The reader's TEXT SIZE step for DOCS (./ui.ts says what the steps are): kept in this browser's storage,
 * read by every DOCS screen and window through one small store, so pressing `[ A+ ]` on the page also
 * grows the window that is open over it.
 */

const SIZE_KEY = 'debaser.docs.size';
const sizeListeners = new Set<() => void>();

/** Worked out once a page load: a screen's own size does not change, and a size that flipped mid-read would redraw every key. */
let starting: number | null = null;

function startingSize(): number {
  if (starting !== null) return starting;
  try {
    const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 700;
    starting = phone ? DOCS_SIZE_DEFAULT_PHONE : DOCS_SIZE_DEFAULT;
  } catch {
    starting = DOCS_SIZE_DEFAULT;
  }
  return starting;
}

/** The size picked on this page, for a browser that refuses storage: the keys still work until the page is left. */
let pickedHere: number | null = null;

function readDocsSize(): number {
  if (pickedHere !== null) return pickedHere;
  try {
    const stored = window.localStorage.getItem(SIZE_KEY);
    if (stored !== null && /^[1-9]$/.test(stored)) return clampDocsSize(Number(stored));
  } catch {
    // A browser that refuses storage still gets a size: the starting one.
  }
  return startingSize();
}

function subscribeDocsSize(listener: () => void): () => void {
  sizeListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    sizeListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function writeDocsSize(size: number): void {
  try {
    window.localStorage.setItem(SIZE_KEY, String(clampDocsSize(size)));
    // Storage has it, so another tab's change (the `storage` event) is read from there too.
    pickedHere = null;
  } catch {
    // Not remembered past this page, then.
    pickedHere = clampDocsSize(size);
  }
  for (const listener of sizeListeners) listener();
}

/** The reader's text size for DOCS, remembered in this browser, and the way to step it. */
export function useDocsSize(): { size: number; step: (by: number) => void } {
  const size = useSyncExternalStore(subscribeDocsSize, readDocsSize, () => DOCS_SIZE_DEFAULT);
  const step = useCallback((by: number) => writeDocsSize(readDocsSize() + by), []);
  return { size, step };
}
