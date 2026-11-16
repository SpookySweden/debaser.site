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

function askBrief(): Promise<BriefRow[]> {
  if (WEB_DATA_SOURCE === 'mock') return Promise.resolve(mockBrief(Date.now()));
  once ??= fetch('/api/web/brief')
    .then((response) => (response.ok ? response.json() : { rows: [] }))
    .then((body: { rows?: unknown }) =>
      Array.isArray(body.rows)
        ? body.rows.filter((row): row is BriefRow => typeof row === 'object' && row !== null && isReadingKind((row as BriefRow).kind) && typeof (row as BriefRow).item?.id === 'string')
        : [],
    )
    .catch(() => {
      // Asked again next page load.
      once = null;
      return [];
    });
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
