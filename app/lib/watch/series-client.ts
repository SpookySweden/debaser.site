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
/** The subtitle languages each Archive item holds (`en`, `ja:auto`), from the same answer (SPEC-subtitles.md). */
const subtitleLanguages = new Map<string, string[]>();
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
    const body = (await response.json().catch(() => null)) as { counts?: Record<string, unknown>; subs?: Record<string, unknown> } | null;
    if (!response.ok || body === null) return;
    for (const id of ids) {
      const value = body.counts?.[id];
      counts.set(id, typeof value === 'number' && Number.isInteger(value) && value >= 2 ? value : 0);
      const languages = body.subs?.[id];
      subtitleLanguages.set(id, Array.isArray(languages) ? languages.filter((tag): tag is string => typeof tag === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?(:auto)?$/.test(tag)).slice(0, 40) : []);
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
  const id = useArchiveRead(item);
  const known = id === null ? undefined : counts.get(id);
  return known !== undefined && known >= 2 ? known : null;
}

/** The subtitle languages a WEB row's Archive item holds (`en`, `ja:auto`), from the SERIES mark's own read; empty until known. */
export function useArchiveRowSubtitles(item: Pick<WebItem, 'platform' | 'kind' | 'externalId'>): readonly string[] {
  const id = useArchiveRead(item);
  return (id === null ? undefined : subtitleLanguages.get(id)) ?? NO_LANGUAGES;
}

const NO_LANGUAGES: readonly string[] = [];

/** Asks for a row's Archive read (batched with the rows drawn beside it) and redraws when it lands; its item id, or null. */
function useArchiveRead(item: Pick<WebItem, 'platform' | 'kind' | 'externalId'>): string | null {
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
  return id;
}
