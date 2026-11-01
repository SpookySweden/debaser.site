'use client';

import { useEffect, useState } from 'react';
import { getWebRepository } from './repository';
import type { WebItem } from './types';

/**
 * One WEB item, read once per tab for every forum thread filed under it (app/lib/web/bridges.ts).
 *
 * `undefined` while reading, or when the read failed (a thread must not call an item gone because the
 * network did); null when the stream answered and the item was not in it (hidden or deleted).
 */

const reads = new Map<string, Promise<WebItem | null | undefined>>();

function readItem(itemId: string): Promise<WebItem | null | undefined> {
  let read = reads.get(itemId);
  if (read === undefined) {
    read = getWebRepository()
      .getItem(itemId)
      .catch(() => {
        // Not kept, so the next thread to ask tries again.
        reads.delete(itemId);
        return undefined;
      });
    reads.set(itemId, read);
  }
  return read;
}

export function useWebItem(itemId: string | null): WebItem | null | undefined {
  const [result, setResult] = useState<{ id: string; item: WebItem | null | undefined } | null>(null);

  useEffect(() => {
    if (itemId === null) return;
    let current = true;
    void readItem(itemId).then((item) => {
      if (current) setResult({ id: itemId, item });
    });
    return () => {
      current = false;
    };
  }, [itemId]);

  return result !== null && result.id === itemId ? result.item : undefined;
}
