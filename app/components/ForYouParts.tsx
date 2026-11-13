'use client';

import { useState, type ReactNode } from 'react';
import type { LanePick } from '../lib/recommender/engine';
import { STATION_KEY } from './TagStationParts';

/** FOR YOU's lanes (SPEC-recommender.md): four picks first, four more each [ MORE ], at most this many. */
export const FIRST = 4;
export const MOST = 18;

/** Rows for one lane, its picks drawn by the caller. A lane with nothing honest to offer draws nothing at all. */
export function Lane<T>({ id, title, picks, loading, render }: { id: string; title: string; picks: LanePick<T>[]; loading: boolean; render: (pick: LanePick<T>) => ReactNode }) {
  const [shown, setShown] = useState(FIRST);
  if (!loading && picks.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1" data-for-you-lane={id}>
      <h3 id={id} className="title-line text-ink text-title">
        {title}
      </h3>
      {loading && picks.length === 0 ? (
        <p role="status" className="text-label text-ink-quiet">
          READING...
        </p>
      ) : (
        <ul className="flex flex-col">{picks.slice(0, shown).map(render)}</ul>
      )}
      {picks.length > shown && shown < MOST ? (
        <button type="button" onClick={() => setShown((now) => now + FIRST)} className={`${STATION_KEY} w-fit`}>
          [ MORE ]
        </button>
      ) : null}
    </section>
  );
}

/** The why-line and NOT FOR ME, under every pick. */
export function PickFoot({ why, onHide, title }: { why: string; onHide: () => void; title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <p className="min-w-0 break-words px-1 text-label text-ink-quiet" data-why>
        {why}
      </p>
      <button type="button" onClick={onHide} aria-label={`Not for me: hide ${title}`} className={STATION_KEY}>
        [ NOT FOR ME ]
      </button>
    </div>
  );
}

/** Words to match taste against, out of a title or a line of writing: lower case, four letters or more, once each. */
export function wordsIn(...texts: (string | null | undefined)[]): string[] {
  const words = texts
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3);
  return [...new Set(words)].slice(0, 12);
}
