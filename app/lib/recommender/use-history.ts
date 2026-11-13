'use client';

import { useEffect, useState } from 'react';
import { readHistory, subscribeHistory } from './history';
import type { HistoryRow } from './types';

/**
 * The reader's own FOR YOU history (SPEC-recommender.md), for MEDIA's lists to order by: null until it has been read
 * once (signed out it reads as empty at once), then kept current after NOT FOR ME, ERASE or a forgotten row.
 */
export function useHistoryRows(limit = 1000): HistoryRow[] | null {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      void readHistory(limit)
        .then((found) => live && setRows(found))
        .catch(() => live && setRows([]));
    };
    read();
    const stop = subscribeHistory(read);
    return () => {
      live = false;
      stop();
    };
  }, [limit]);
  return rows;
}
