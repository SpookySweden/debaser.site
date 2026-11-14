'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isShort, shortCandidate, youtubeIdOf } from './shorts';
import { askSoon, knownShort, shortsVersion, subscribeShorts } from './shorts-client';

/**
 * The last net against YouTube Shorts (Luke, 2026-11-14), for a row drawn from anywhere in MEDIA (the picks, the tagged
 * catalogue, YOUR YOUTUBE): true when the row is a Short, marked or confirmed by YouTube (shorts-client.ts), so the row draws
 * nothing. Unsure is false: the row stays, and so does music unless YouTube confirms it.
 */
export function useHiddenShort(item: Parameters<typeof isShort>[0] & { externalId?: string }): boolean {
  const id = youtubeIdOf(item);
  const ask = id !== null && shortCandidate(item) && !isShort(item);
  useSyncExternalStore(subscribeShorts, shortsVersion, () => 0);
  useEffect(() => {
    if (ask && id !== null) askSoon(id);
  }, [ask, id]);
  if (isShort(item)) return true;
  return ask && id !== null && knownShort(id) === true;
}
