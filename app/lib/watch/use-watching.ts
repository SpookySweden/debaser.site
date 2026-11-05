'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
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

/**
 * Everybody the site-wide channel says is in this room. A queue window opened from outside the room (the ROOM tab, QUEUES)
 * has no room presence of its own, and must not join it just to look, or the looker would count as being there. Read as one
 * string, so a change elsewhere on the site does not redraw the window.
 */
export function useWatchingIn(roomId: string): string[] {
  const read = useCallback(
    () =>
      snapshot === null
        ? ''
        : Object.values(snapshot)
            .filter((entry) => entry.roomId === roomId)
            .map((entry) => entry.userId)
            .sort()
            .join(' '),
    [roomId],
  );
  const ids = useSyncExternalStore(subscribe, read, () => '');

  return useMemo(() => (ids.length === 0 ? [] : ids.split(' ')), [ids]);
}

/** What this account is watching, or null. */
export function useWatching(userId: string | null): WatchingEntry | null {
  const read = useCallback(() => (userId === null || snapshot === null ? null : (snapshot[userId] ?? null)), [userId]);

  return useSyncExternalStore(subscribe, read, () => null);
}
