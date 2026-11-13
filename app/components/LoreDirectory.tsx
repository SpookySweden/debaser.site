'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { folderPath } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocFolder, type DocSummary, type DocViewer } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_MAIN } from '../lib/docs/ui';
import { PANEL, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { DocRow } from './DocRows';
import DocsScale, { DocsSizeKeys } from './DocsScale';
import NewDocWindow from './NewDocWindow';

/** The LORE folder as NEW PAGE needs it: shared, open to EVERYONE by default. */
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
 * another. The same documents DOCS > FOLDERS > LORE lists (SPEC-live-docs.md): one system, two doors, and
 * the same large rows.
 */
export default function LoreDirectory() {
  const { user, status } = useAuth();
  const viewer = useMemo<DocViewer | null>(() => (user === null ? null : { id: user.id, name: user.displayName }), [user]);
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [pages, setPages] = useState<DocSummary[]>([]);
  /** When the shelf was read, so every row says its age against the same clock. */
  const [readAt, setReadAt] = useState(0);
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
        setReadAt(Date.now());
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
    <DocsScale>
      <section className={PANEL}>
        <div className={TITLE_BAR}>
          <span>PAGES</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
          {viewer !== null ? (
            <button type="button" onClick={() => setOpening(true)} className={DOC_KEY_MAIN}>
              [ NEW PAGE ]
            </button>
          ) : (
            <p className="docs-key text-ink">
              <Link href="/account" className={DOC_KEY}>
                [ LOG IN ]
              </Link>{' '}
              TO OPEN A PAGE
            </p>
          )}

          <Link href={folderPath(LORE_FOLDER_ID)} className={DOC_KEY}>
            [ IN DOCS ]
          </Link>

          <span className="ml-auto">
            <DocsSizeKeys />
          </span>
        </div>

        {error === null ? null : <p className={`${DOC_FAULT} my-2`}>{error}</p>}

        {!ready ? (
          <p className="docs-key py-2 text-ink">READING THE SHELF...</p>
        ) : pages.length === 0 ? (
          <p className="docs-key py-2 text-ink">NO PAGES YET.</p>
        ) : (
          <ol>
            {pages.map((page) => (
              <DocRow key={page.id} doc={page} viewerId={viewer?.id ?? null} now={readAt} />
            ))}
          </ol>
        )}

        <div className="pt-3">
          <button type="button" onClick={refresh} className={DOC_KEY}>
            [ ↻ CHECK FOR NEW ONES ]
          </button>
        </div>

        {opening && viewer !== null ? <NewDocWindow viewer={viewer} folder={LORE_FOLDER} onClose={() => setOpening(false)} /> : null}
      </section>
    </DocsScale>
  );
}
