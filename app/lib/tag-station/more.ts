'use client';

import { useEffect, useMemo, useState } from 'react';
import { webSessionHeaders } from '../web/web-session';
import { buildIndex, type StationIndex } from './query';
import type { StationItem } from './types';

/** One visit's seed: a reader's list stays steady while they look at it, and differs next time. */
const SEED = Math.random().toString(36).slice(2, 12);

const asked = new Map<string, Promise<readonly StationItem[]>>();

/** Items from the pool's files for these words. Nothing, never an error, when they can't be read: the list just goes on without them. */
export function loadMore(words: readonly string[]): Promise<readonly StationItem[]> {
  const key = [...words].sort().join('|');
  const held = asked.get(key);
  if (held) return held;
  const load = (async () => {
    const headers = await webSessionHeaders();
    if (headers === null) return [];
    const query = new URLSearchParams(words.map((word) => ['word', word]));
    query.set('seed', SEED);
    const response = await fetch(`/api/tag-station/more?${query.toString()}`, { headers });
    if (!response.ok) return [];
    return ((await response.json()) as { items?: StationItem[] }).items ?? [];
  })().catch((): readonly StationItem[] => {
    asked.delete(key);
    return [];
  });
  asked.set(key, load);
  return load;
}

/** The map's index with these items added to what can be listed. The map itself doesn't change. */
export function withMore(index: StationIndex, more: readonly StationItem[]): StationIndex {
  const fresh = more.filter((item) => !index.itemById.has(item.id));
  if (fresh.length === 0) return index;
  return { ...buildIndex({ ...index.graph, items: [...index.graph.items, ...fresh] }), total: index.total };
}

/** The index, and the items of these words once they've come. */
export function useMoreItems(index: StationIndex | null, words: readonly string[]): StationIndex | null {
  const key = words.join('|');
  const [found, setFound] = useState<{ key: string; items: readonly StationItem[] }>({ key: '', items: [] });
  useEffect(() => {
    if (index === null || key.length === 0) return;
    let live = true;
    void loadMore(key.split('|')).then((items) => {
      if (live) setFound({ key, items });
    });
    return () => {
      live = false;
    };
  }, [index, key]);
  return useMemo(() => (index === null || found.key !== key ? index : withMore(index, found.items)), [index, found, key]);
}
