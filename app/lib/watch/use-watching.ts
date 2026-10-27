'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getWatchRepository } from './repository';
import type { WatchingEntry, WatchingMap } from './types';

/**
 * Who is in a live room, site-wide: what the directory's `[ TV ]` key reads (decision 4).
 *
 * One subscription for the whole tab however many rows ask, opened by the first row and closed after
 * the last; each row reads its own account's line, so a change re-renders only the rows it touches.
 */

let snapshot: WatchingMap | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (unsubscribe === null) {
    unsubscribe = getWatchRepository().subscribeWatching((next) => {
      snapshot = next;
      for (const each of listeners) each();
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
      snapshot = null;
    }
  };
}

/** What this account is watching, or null. */
export function useWatching(userId: string | null): WatchingEntry | null {
  const read = useCallback(() => (userId === null || snapshot === null ? null : (snapshot[userId] ?? null)), [userId]);

  return useSyncExternalStore(subscribe, read, () => null);
}
