'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { docPath, folderPath } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocFolder, type DocSummary, type DocViewer } from '../lib/docs/types';
import { PANEL, PLATE, PLATE_LINK, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import NewDocWindow from './NewDocWindow';
import TimeStamp from './TimeStamp';

/** The LORE folder as NEW LORE PAGE needs it: shared, PUBLIC by default. */
const LORE_FOLDER: DocFolder = {
  id: LORE_FOLDER_ID,
  name: 'LORE',
  parentId: null,
  kind: 'shared',
  ownerId: null,
  ownerLabel: 'debaser.site',
  defaultAccess: 'public',
  createdAt: '2026-11-13T00:00:00.000Z',
};

/**
 * The lore shelf: every page in DOCS' LORE folder, most recently written in first, and the way to open
 * another. The same documents DOCS > LORE lists (SPEC-live-docs.md): one system, two doors.
 */
export default function LoreDirectory() {
  const { user, status } = useAuth();
  const viewer = useMemo<DocViewer | null>(() => (user === null ? null : { id: user.id, name: user.displayName }), [user]);
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [pages, setPages] = useState<DocSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;

    repository
      .listDocs({ folderId: LORE_FOLDER_ID })
      .then((rows) => {
        if (cancelled) return;
        setPages(rows);
        setError(null);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'LORE DID NOT LOAD.');
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, repository, status]);

  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

  return (
    <section className={PANEL}>
      <div className={TITLE_BAR}>
        <span>PAGES</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {viewer !== null ? (
          <button type="button" onClick={() => setOpening(true)} className={PLATE}>
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

        <Link href={folderPath(LORE_FOLDER_ID)} className={PLATE_LINK}>
          [ IN DOCS ]
        </Link>

        <button type="button" onClick={refresh} title="Read the shelf again" aria-label="Read the shelf again" className={PLATE}>
          [ ↻ ]
        </button>
      </div>

      {error === null ? null : <p className="mx-3 my-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      {!ready ? (
        <p className="px-3 py-2 text-label font-bold text-ink">READING THE SHELF...</p>
      ) : pages.length === 0 ? (
        <p className="px-3 py-2 text-label font-bold text-ink">NO PAGES YET.</p>
      ) : (
        <ol>
          {pages.map((page, position) => (
            <li key={page.id} className="rule-pixel flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-ink">
              <span className="w-4 shrink-0 text-right text-label font-bold text-ink">{position + 1}.</span>
              <Link href={docPath(page)} className="text-key font-bold underline hover:bg-ice-pale">
                {page.title}
              </Link>
              <span className="min-w-0 flex-1 text-label font-bold">{page.summary}</span>
              <span className="text-label text-ink">
                LAST SAVED BY {page.updatedByLabel} <TimeStamp at={page.updatedAt} />
              </span>
            </li>
          ))}
        </ol>
      )}

      {opening && viewer !== null ? <NewDocWindow viewer={viewer} folder={LORE_FOLDER} onClose={() => setOpening(false)} /> : null}
    </section>
  );
}
