'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { lorePagePath } from '../lib/lore/pages';
import { getLoreRepository } from '../lib/lore/repository';
import type { LorePageSummary } from '../lib/lore/types';
import { PANEL, PLATE, PLATE_LINK, TITLE_BAR } from '../lib/ui/controls';
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
        <span>PAGES</span>
      </div>

      {/* One row of keys. A guest is told once, in one line, what an account would add; the sentence
          that used to sit beside the keys is the new page key's tip (SPEC-efficiency.md). */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink px-3 py-2">
        {signedIn ? (
          <button
            type="button"
            onClick={() => setOpening(true)}
            title="Any account may open a page :: pages are written together, as they are typed"
            className={PLATE}
          >
            [ NEW PAGE ]
          </button>
        ) : (
          <p className="text-label text-ink">
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO OPEN A PAGE
          </p>
        )}

        <button
          type="button"
          onClick={refresh}
          title="Read the shelf again"
          aria-label="Read the shelf again"
          className={PLATE}
        >
          [ ↻ ]
        </button>
      </div>

      {error === null ? null : <p className="mx-3 my-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      {!ready ? (
        <p className="px-3 py-2 text-label font-bold text-ink">READING THE SHELF...</p>
      ) : pages.length === 0 ? (
        <p className="px-3 py-2 text-label font-bold text-ink">
          NOTHING IS FILED YET. THE FIRST PAGE IS ONE BUTTON AWAY.
        </p>
      ) : (
        <ol>
          {pages.map((page, position) => (
            <li
              key={page.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-ink px-3 py-2 text-ink last:border-b-0"
            >
              <span className="w-4 shrink-0 text-right text-label font-bold text-ink">{position + 1}.</span>

              <Link href={lorePagePath(page.slug)} className="text-key font-bold underline hover:bg-ice-pale">
                {page.title}
              </Link>

              {/* A page with no summary draws nothing here, rather than a line saying so. */}
              <span className="min-w-0 flex-1 text-label font-bold">{page.summary}</span>

              <span className="text-label text-ink">
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
