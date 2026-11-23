'use client';

import { useSyncExternalStore } from 'react';
import { PAPERS, READER_LOOK_AT_FIRST, TEXT_SIZES, type ReaderLook } from '../../lib/seeing/lenses/lens';

/** READER's paper and text size, kept in this browser. */
const STORAGE_KEY = 'debaser-seeing-reader-v1';

const listeners = new Set<() => void>();
let held: ReaderLook | null = null;

function stored(): ReaderLook {
  if (held !== null) return held;
  held = READER_LOOK_AT_FIRST;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as { paper?: unknown; size?: unknown } | null;
    held = {
      paper: PAPERS.find((paper) => paper === value?.paper) ?? READER_LOOK_AT_FIRST.paper,
      size: TEXT_SIZES.find((size) => size === value?.size) ?? READER_LOOK_AT_FIRST.size,
    };
  } catch {
    // No storage, or nothing readable in it: the starting look.
  }
  return held;
}

function setLook(next: ReaderLook): void {
  held = next;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // It lasts as long as the page.
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useReaderLook(): { look: ReaderLook; setLook: (next: ReaderLook) => void } {
  const look = useSyncExternalStore(subscribe, stored, () => READER_LOOK_AT_FIRST);
  return { look, setLook };
}
