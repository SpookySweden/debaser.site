'use client';

import { useEffect, useState } from 'react';
import { getWatchRepository } from './repository';
import type { PrivateFold } from './types';

/** Every row asking in one tick shares one read: a page of videos is one question, not one each. */
let waiting = new Set<string>();
let answers: Promise<Map<string, PrivateFold>> | null = null;

function ask(mediaId: string): Promise<Map<string, PrivateFold>> {
  waiting.add(mediaId);
  if (answers === null) {
    answers = new Promise((resolve) => {
      queueMicrotask(() => {
        const ids = [...waiting];
        waiting = new Set();
        answers = null;
        void getWatchRepository()
          .listPrivateFolds(ids)
          .then((folds) => resolve(new Map(folds.map((fold) => [fold.mediaItemId, fold]))))
          .catch(() => resolve(new Map()));
      });
    });
  }
  return answers;
}

/** The private streams that played this file and that this reader isn't in: `1 PRIVATE STREAM`, in bars. Null when there are none. */
export function usePrivateFold(mediaId: string): PrivateFold | null {
  const [fold, setFold] = useState<PrivateFold | null>(null);

  useEffect(() => {
    if (mediaId.length === 0) return;
    let alive = true;
    void ask(mediaId).then((found) => {
      if (alive) setFold(found.get(mediaId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [mediaId]);

  return fold;
}
