'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { lorePagePath } from '../lib/lore/pages';
import { getLoreRepository } from '../lib/lore/repository';
import type { LorePageSummary } from '../lib/lore/types';
import { PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import NewLorePageWindow from './NewLorePageWindow';
import TimeStamp from './TimeStamp';

/**
 * The lore shelf: every page, most recently written in first, and the way to open another.
 *
 * The list is read from the store rather than from a manifest, because a page is written by
 * whoever is at the keyboard - so the shelf is what the site actually holds, in the order people
 * last touched it. Guest readers get the list and one line explaining what an account would buy
 * them, which is the same shape the music archive keeps (see ./MusicDirectory.tsx).
 */
export default function LoreDirectory() {
  const { user, status } = useAuth();
  const repository = useMemo(() => getLoreRepository(), []);
  const [pages, setPages] = useState<LorePageSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    repository
      .listPages()
      .then((rows) => {
        if (cancelled) return;

        setPages(rows);
        setError(null);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;

        setError(caught instanceof Error ? caught.message : 'THE LORE SHELF DID NOT ANSWER.');
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, repository]);

  const refresh = useCallback(() => setAttempt((current) => current + 1), []);
  const signedIn = status === 'signed-in' && user !== null;

  return (
    <section className={PANEL}>
      <div className={TITLE_BAR}>
        <span>LORE PAGES</span>
        <span>{ready ? `[ ${pages.length} FILED ]` : '[ READING... ]'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-ink px-3 py-2">
        <button
          type="button"
          onClick={() => setOpening(true)}
          disabled={!signedIn}
          title={signedIn ? 'Open a page' : 'Opening a page takes an account'}
          className={PLATE}
        >
          [ NEW PAGE ]
        </button>

        <button type="button" onClick={refresh} className={PLATE}>
          [ READ THE SHELF AGAIN ]
        </button>

        <span className="text-[10px] font-bold text-ink">
          {signedIn
            ? 'ANY ACCOUNT MAY OPEN A PAGE :: THEY ARE WRITTEN TOGETHER, AS THEY ARE TYPED'
            : 'SIGN IN TO OPEN A PAGE :: READING TAKES NOTHING'}
        </span>
      </div>

      {error === null ? null : <p className="px-3 py-2 text-[10px] font-bold text-bubble-pale">{error}</p>}

      {!ready ? (
        <p className="px-3 py-2 text-[10px] font-bold text-ink">READING THE SHELF...</p>
      ) : pages.length === 0 ? (
        <p className="px-3 py-2 text-[10px] font-bold text-ink">
          NOTHING IS FILED YET. THE FIRST PAGE IS ONE BUTTON AWAY.
        </p>
      ) : (
        <ol>
          {pages.map((page, position) => (
            <li
              key={page.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-ink px-3 py-2 text-ink last:border-b-0"
            >
              <span className="w-4 shrink-0 text-right text-[10px] font-bold text-ink">{position + 1}.</span>

              <Link href={lorePagePath(page.slug)} className="text-xs font-bold underline hover:bg-ice-pale">
                {page.title}
              </Link>

              <span className="min-w-0 flex-1 text-[10px] font-bold">
                {page.summary.length === 0 ? 'NO SUMMARY FILED.' : page.summary}
              </span>

              <span className="text-[10px] text-ink">
                LAST FILED BY {page.updatedByLabel} <TimeStamp at={page.updatedAt} />
              </span>
            </li>
          ))}
        </ol>
      )}

      {opening ? <NewLorePageWindow onClose={() => setOpening(false)} onOpened={refresh} /> : null}
    </section>
  );
}
