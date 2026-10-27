'use client';

import { useEffect, useState } from 'react';
import { getWatchRepository } from './repository';
import type { StreamFold } from './types';

/** A burst of chat redraws the folds once, not once a line. */
const REREAD_DELAY_MS = 1500;

/**
 * The streams that played each of these files, with what was said over them (decision 8): one read
 * for the whole archive page, read again when a file plays somewhere or somebody says something.
 */
const NONE: Record<string, StreamFold[]> = {};

export function useStreamFolds(mediaItemIds: string[]): Record<string, StreamFold[]> {
  const [folds, setFolds] = useState<Record<string, StreamFold[]>>({});
  const key = [...mediaItemIds].sort().join(',');

  useEffect(() => {
    if (key.length === 0) return;
    const ids = key.split(',');

    const repository = getWatchRepository();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const read = () =>
      void repository
        .listStreamFolds(ids)
        .then((next) => {
          if (!cancelled) setFolds(next);
        })
        .catch(() => {
          // An unreadable chat history is not shown rather than shown empty; the next change tries again.
        });

    read();
    const unsubscribe = repository.subscribeStreamActivity(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(read, REREAD_DELAY_MS);
    });

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [key]);

  return key.length === 0 ? NONE : folds;
}
