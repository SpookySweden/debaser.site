'use client';

import { useEffect, useState } from 'react';
import { isReadingKind, type BriefRow } from './brief/feeds';
import { mockBrief } from './brief/mock-brief';
import { WEB_DATA_SOURCE } from './repository';

/**
 * The reading for MEDIA's default feed (SPEC-media-feed.md): `/api/web/brief` asked once a page load and kept for the
 * visit, so the list holds still. The mock site gets invented rows instead (brief/mock-brief.ts), so a local drive needs
 * no internet. null until it answers; an empty list when it fails, and the feed simply has no reading.
 */
let once: Promise<BriefRow[]> | null = null;

/**
 * The last answer is kept in this browser for up to 6 hours (SPEC-media-feed-v2.md, fix 5): the route can take seconds on
 * a cold cache, and a kept answer lets the first screen have its reading at once. Public headlines only, nothing about the
 * reader. A visit that uses the kept answer still asks the route, for the next visit.
 */
const KEPT_KEY = 'debaser.media-brief.v1';
const KEEP_MS = 6 * 3_600_000;

const briefRows = (rows: unknown): BriefRow[] =>
  Array.isArray(rows) ? rows.filter((row): row is BriefRow => typeof row === 'object' && row !== null && isReadingKind((row as BriefRow).kind) && typeof (row as BriefRow).item?.id === 'string') : [];

function keptBrief(): BriefRow[] | null {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEPT_KEY) ?? 'null') as { at?: unknown; rows?: unknown } | null;
    if (kept === null || typeof kept.at !== 'number' || Date.now() - kept.at > KEEP_MS) return null;
    const rows = briefRows(kept.rows);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

function keepBrief(rows: readonly BriefRow[]): void {
  try {
    window.localStorage.setItem(KEPT_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    // Storage full or blocked: the next visit just waits for the route.
  }
}

/** The same one answer, for WHERE FROM's READING group too (WebStream.tsx), so a reading search asks nothing new. */
export function askBrief(): Promise<BriefRow[]> {
  if (WEB_DATA_SOURCE === 'mock') return Promise.resolve(mockBrief(Date.now()));
  if (once === null) {
    const kept = keptBrief();
    const asked = fetch('/api/web/brief')
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((body: { rows?: unknown }) => {
        const rows = briefRows(body.rows);
        if (rows.length > 0) keepBrief(rows);
        return rows;
      })
      .catch((): BriefRow[] => {
        // Asked again next page load.
        if (kept === null) once = null;
        return [];
      });
    once = kept !== null ? Promise.resolve(kept) : asked;
  }
  return once;
}

export function useBrief(on: boolean): readonly BriefRow[] | null {
  const [rows, setRows] = useState<readonly BriefRow[] | null>(null);
  useEffect(() => {
    if (!on || rows !== null) return;
    let live = true;
    void askBrief().then((answer) => {
      if (live) setRows(answer);
    });
    return () => {
      live = false;
    };
  }, [on, rows]);
  return rows;
}
