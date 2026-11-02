'use client';

import { useEffect, useState } from 'react';
import type { WebItem } from '../web/types';
import { SIGNED_OUT_REFUSAL, webSessionHeaders } from '../web/web-session';
import { readSeriesAnswer, seriesQuery, type SeriesRead, type SeriesTarget } from './series';

/**
 * The page's side of series (SPEC-stream-series.md): it asks only our own route (`/api/web/series`), never a
 * platform, and checks every answer (`readSeriesAnswer`) before anything is drawn or queued.
 */

/** One series' episodes. Throws with a sentence fit to show. */
export async function fetchSeries(target: SeriesTarget): Promise<SeriesRead> {
  const headers = await webSessionHeaders();
  if (headers === null) throw new Error(SIGNED_OUT_REFUSAL.toUpperCase());
  let response: Response;
  try {
    response = await fetch(`/api/web/series?${seriesQuery(target)}`, { headers });
  } catch {
    throw new Error('THE SERIES COULD NOT BE READ.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const said = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    throw new Error(typeof said === 'string' && said.length < 120 ? said.toUpperCase() : 'THE SERIES COULD NOT BE READ.');
  }
  const read = readSeriesAnswer(target, body);
  if (read === null) throw new Error('THE SERIES COULD NOT BE READ.');
  return read;
}

/* --- how many episodes an Archive row holds: the SERIES mark ----------------------------------------- */

/** Known counts by Archive item (0: not a series); asked once per page load. */
const counts = new Map<string, number>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
const BATCH = 30;

async function askCounts(): Promise<void> {
  timer = null;
  const ids = [...waiting].slice(0, BATCH);
  for (const id of ids) waiting.delete(id);
  if (waiting.size > 0) timer = setTimeout(() => void askCounts(), 0);
  const headers = await webSessionHeaders();
  if (headers === null || ids.length === 0) return;
  try {
    const response = await fetch(`/api/web/series?counts=${ids.map(encodeURIComponent).join(',')}`, { headers });
    const body = (await response.json().catch(() => null)) as { counts?: Record<string, unknown> } | null;
    if (!response.ok || body === null) return;
    for (const id of ids) {
      const value = body.counts?.[id];
      counts.set(id, typeof value === 'number' && Number.isInteger(value) && value >= 2 ? value : 0);
    }
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

function wantCount(id: string): void {
  if (counts.has(id) || waiting.has(id)) return;
  waiting.add(id);
  // Rows drawn together are asked together.
  if (timer === null) timer = setTimeout(() => void askCounts(), 60);
}

/** Whether a WEB row may be a series: an Archive video. YouTube rows are single videos (playlists come pasted). */
export function maySeries(item: Pick<WebItem, 'platform' | 'kind'>): boolean {
  return item.platform === 'internet_archive' && item.kind === 'video';
}

/** How many episodes a WEB row's item holds when it is a series (2 or more), else null. */
export function useSeriesCount(item: Pick<WebItem, 'platform' | 'kind' | 'externalId'>): number | null {
  const id = maySeries(item) ? item.externalId : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (id === null) return;
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    wantCount(id);
    return () => {
      listeners.delete(listener);
    };
  }, [id]);
  const known = id === null ? undefined : counts.get(id);
  return known !== undefined && known >= 2 ? known : null;
}
