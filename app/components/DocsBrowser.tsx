'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_ORDER, docPath } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocAccess, type DocFolder, type DocSummary, type DocViewer } from '../lib/docs/types';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import NewDocFolderWindow from './NewDocFolderWindow';
import NewDocWindow from './NewDocWindow';
import TimeStamp from './TimeStamp';

/** Where the browser is: MY DOCS, the shared folders' top, everything else I can see, or one folder. */
type Place = 'mine' | 'shared' | 'others' | string;

function placeHref(place: Place): string {
  return place === 'mine' ? '/docs' : `/docs?folder=${encodeURIComponent(place)}`;
}

/**
 * DOCS' front page: a file browser.
 *
 * MY DOCS is each person's own (with their own folders inside it); the shared folders are seen by every
 * account (LORE by everyone); SHARED WITH ME is every other document this reader may open, wherever its
 * owner filed it. What a reader may see is the database's decision (Row Level Security): this page
 * only arranges what it is given.
 */
export default function DocsBrowser() {
  const { user, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const viewer = useMemo<DocViewer | null>(() => (user === null ? null : { id: user.id, name: user.displayName }), [user]);
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [making, setMaking] = useState<'doc' | 'folder' | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const signedIn = viewer !== null;
  const asked = params.get('folder');
  const place: Place = asked ?? (signedIn ? 'mine' : LORE_FOLDER_ID);

  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    Promise.all([repository.listFolders(), repository.listDocs()])
      .then(([folderRows, docRows]) => {
        if (cancelled) return;
        setFolders(folderRows);
        setDocs(docRows);
        setError(null);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'DOCS DID NOT LOAD.');
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, repository, status]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const seen = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const folder = folders.find((candidate) => candidate.id === place) ?? null;
  const childrenOf = (parentId: string | null, kind: 'home' | 'shared') =>
    folders
      .filter((candidate) => candidate.parentId === parentId && candidate.kind === kind)
      .sort((left, right) => (left.id === LORE_FOLDER_ID ? -1 : right.id === LORE_FOLDER_ID ? 1 : left.name.localeCompare(right.name)));

  const inPlace = docs.filter((doc) => {
    if (place === 'mine') return doc.ownerId === viewer?.id && doc.folderId === null;
    if (place === 'others') {
      const mineAtHome = doc.ownerId === viewer?.id && doc.folderId === null;
      return !mineAtHome && (doc.folderId === null || !seen.has(doc.folderId));
    }
    if (place === 'shared') return false;
    return doc.folderId === place;
  });

  const subfolders =
    place === 'mine' ? childrenOf(null, 'home') : place === 'shared' ? childrenOf(null, 'shared') : folder === null ? [] : childrenOf(folder.id, folder.kind);

  const placeName =
    place === 'mine' ? 'MY DOCS' : place === 'shared' ? 'SHARED FOLDERS' : place === 'others' ? (signedIn ? 'SHARED WITH ME' : 'PUBLIC DOCS') : (folder?.name ?? 'FOLDER');

  // Where a document can be moved by its owner: MY DOCS, their own folders, any shared folder.
  const moveTargets = folders.filter((candidate) => candidate.kind === 'shared' || candidate.ownerId === viewer?.id);

  const canMakeDoc = signedIn && (place === 'mine' || folder !== null);
  const canMakeFolder = signedIn && place !== 'others';
  const ownsFolder = folder !== null && folder.ownerId === viewer?.id && folder.id !== LORE_FOLDER_ID;

  async function run(work: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await work();
      refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT CHANGED.');
    }
  }

  const renderTree = (parentId: string | null, kind: 'home' | 'shared', depth: number): ReactNode => {
    const rows = childrenOf(parentId, kind);
    if (rows.length === 0) return null;
    return (
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={placeHref(row.id)}
              className={place === row.id ? PLATE_PRESSED : PLATE}
              style={{ marginLeft: `${depth}rem` }}
              aria-current={place === row.id ? 'page' : undefined}
            >
              {row.name}/
            </Link>
            {renderTree(row.id, kind, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="gap-4 md:flex">
      <nav className="mb-3 shrink-0 md:mb-0 md:w-56" aria-label="Folders">
        <div className={TITLE_BAR}>
          <span>FOLDERS</span>
        </div>
        <div className="space-y-1 py-1 text-label">
          {signedIn ? (
            <div>
              <Link href={placeHref('mine')} className={place === 'mine' ? PLATE_PRESSED : PLATE} aria-current={place === 'mine' ? 'page' : undefined}>
                MY DOCS/
              </Link>
              {renderTree(null, 'home', 1)}
            </div>
          ) : null}
          <div>
            {signedIn ? (
              <Link href={placeHref('shared')} className={place === 'shared' ? PLATE_PRESSED : PLATE}>
                SHARED FOLDERS/
              </Link>
            ) : null}
            {renderTree(null, 'shared', signedIn ? 1 : 0)}
          </div>
          <div>
            <Link href={placeHref('others')} className={place === 'others' ? PLATE_PRESSED : PLATE}>
              {signedIn ? 'SHARED WITH ME/' : 'PUBLIC DOCS/'}
            </Link>
          </div>
        </div>
      </nav>

      <section className="min-w-0 flex-1">
        <div className={TITLE_BAR}>
          <span className="truncate">{placeName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 py-2">
          {canMakeDoc ? (
            <button type="button" className={PLATE_MAIN} onClick={() => setMaking('doc')}>
              {folder?.id === LORE_FOLDER_ID ? '[ NEW LORE PAGE ]' : '[ NEW DOC ]'}
            </button>
          ) : null}
          {canMakeFolder ? (
            <button type="button" className={PLATE} onClick={() => setMaking('folder')}>
              [ NEW FOLDER ]
            </button>
          ) : null}
          {!signedIn && status !== 'loading' ? (
            <p className="text-label text-ink">
              <Link href="/account" className={PLATE_LINK}>
                [ LOG IN ]
              </Link>{' '}
              TO MAKE DOCS
            </p>
          ) : null}
          <button type="button" className={PLATE} onClick={refresh} aria-label="Read the folders again" title="Read again">
            [ ↻ ]
          </button>
        </div>

        {ownsFolder && folder !== null ? (
          <div className="flex flex-wrap items-center gap-2 pb-2 text-label text-ink">
            {renaming === null ? (
              <button type="button" className={PLATE} onClick={() => setRenaming(folder.name)}>
                [ RENAME ]
              </button>
            ) : (
              <>
                <label className="sr-only" htmlFor="doc-folder-rename">
                  Folder name
                </label>
                <input
                  id="doc-folder-rename"
                  value={renaming}
                  onChange={(event) => setRenaming(event.target.value)}
                  maxLength={60}
                  className={FIELD_TIGHT}
                />
                <button
                  type="button"
                  className={PLATE}
                  onClick={() => {
                    const name = renaming;
                    setRenaming(null);
                    void run(() => repository.updateFolder(folder.id, { name }));
                  }}
                >
                  [ OK ]
                </button>
              </>
            )}
            <label className="flex items-center gap-1">
              NEW DOCS START AS
              <select
                value={folder.defaultAccess ?? ''}
                onChange={(event) =>
                  void run(() => repository.updateFolder(folder.id, { defaultAccess: event.target.value === '' ? null : (event.target.value as DocAccess) }))
                }
                className="bg-paper text-label text-ink"
              >
                <option value="">PRIVATE</option>
                {DOC_ACCESS_ORDER.filter((level) => level !== 'private').map((level) => (
                  <option key={level} value={level}>
                    {DOC_ACCESS_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            {removing ? (
              <button
                type="button"
                className={PLATE}
                onClick={() => {
                  setRemoving(false);
                  void run(async () => {
                    await repository.deleteFolder(folder.id);
                    router.push(folder.kind === 'shared' ? placeHref('shared') : placeHref('mine'));
                  });
                }}
              >
                [ REALLY REMOVE? ITS DOCS GO BACK TO THEIR OWNERS ]
              </button>
            ) : (
              <button type="button" className={PLATE} onClick={() => setRemoving(true)}>
                [ REMOVE FOLDER ]
              </button>
            )}
          </div>
        ) : null}

        {error === null ? null : <p className="my-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

        {!ready ? (
          <p className="py-2 text-label font-bold text-ink">READING...</p>
        ) : subfolders.length === 0 && inPlace.length === 0 ? (
          <p className="py-2 text-label font-bold text-ink">EMPTY.</p>
        ) : (
          <ul>
            {subfolders.map((row) => (
              <li key={row.id} className="rule-pixel flex flex-wrap items-baseline gap-x-2 py-2 text-ink">
                <Link href={placeHref(row.id)} className="text-key font-bold underline hover:bg-ice-pale">
                  {row.name}/
                </Link>
                <span className="text-label">FOLDER{row.kind === 'shared' && row.ownerLabel.length > 0 ? ` :: BY ${row.ownerLabel}` : ''}</span>
              </li>
            ))}
            {inPlace.map((doc) => (
              <li key={doc.id} className="rule-pixel flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-ink" data-doc-row={doc.id}>
                <Link href={docPath(doc)} className="text-key font-bold underline hover:bg-ice-pale">
                  {doc.title}
                </Link>
                <span className="text-label font-bold">{DOC_ACCESS_LABELS[doc.access]}</span>
                {doc.summary.length === 0 ? null : <span className="min-w-0 flex-1 text-label">{doc.summary}</span>}
                <span className="text-label">
                  {doc.ownerId === viewer?.id ? '' : `${doc.ownerLabel} :: `}
                  <TimeStamp at={doc.updatedAt} />
                </span>
                {doc.ownerId !== null && doc.ownerId === viewer?.id && doc.slug === null ? (
                  <label className="text-label">
                    <span className="sr-only">Move {doc.title}</span>
                    <select
                      value={doc.folderId ?? ''}
                      onChange={(event) => void run(() => repository.updateDoc(doc.id, { folderId: event.target.value === '' ? null : event.target.value }))}
                      className="bg-paper text-label text-ink"
                    >
                      <option value="">MY DOCS</option>
                      {moveTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {making === 'doc' && viewer !== null ? <NewDocWindow viewer={viewer} folder={folder} onClose={() => setMaking(null)} /> : null}
      {making === 'folder' && viewer !== null ? (
        <NewDocFolderWindow
          viewer={viewer}
          parent={folder}
          kind={place === 'mine' ? 'home' : 'shared'}
          onMade={(made) => {
            setMaking(null);
            refresh();
            router.push(placeHref(made.id));
          }}
          onClose={() => setMaking(null)}
        />
      ) : null}
    </div>
  );
}
