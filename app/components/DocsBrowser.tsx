'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_ORDER } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocAccess, type DocFolder, type DocSummary, type DocViewer } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_MAIN, DOC_KEY_ON } from '../lib/docs/ui';
import { FIELD_TIGHT, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DocMoveWindow from './DocMoveWindow';
import { DocRow, FolderRow } from './DocRows';
import DocsScale, { DocsSizeKeys } from './DocsScale';
import NewDocFolderWindow from './NewDocFolderWindow';
import NewDocWindow from './NewDocWindow';

/**
 * Where the browser is: RECENT (everything this reader can open, newest first), MY DOCUMENTS, everything
 * else shared with them, the shared folders' top, or one folder (its id).
 */
type Place = 'recent' | 'mine' | 'others' | 'shared' | string;

/** How many rows RECENT shows before [ SHOW ALL ]. */
const RECENT_ROWS = 30;

function placeHref(place: Place): string {
  return place === 'recent' ? '/docs' : `/docs?folder=${encodeURIComponent(place)}`;
}

/**
 * DOCS' front page (Luke, 2026-11-13: laid out like Google Docs' home, for someone who does not use
 * computers much): one big [ + NEW DOCUMENT ] key, four big keys for where to look, and every document
 * and folder as a large row that opens when pressed.
 *
 * MY DOCUMENTS is each person's own (with their own folders inside it); FOLDERS are the shared ones, seen
 * by every account (LORE by everyone); SHARED WITH ME is every other document this reader may open,
 * wherever its owner filed it. What a reader may see is the database's decision (Row Level Security):
 * this page only arranges what it is given.
 */
export default function DocsBrowser() {
  const { user, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const viewer = useMemo<DocViewer | null>(() => (user === null ? null : { id: user.id, name: user.displayName }), [user]);
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  /** When the rows were read, so every row says its age against the same clock. */
  const [readAt, setReadAt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [making, setMaking] = useState<'doc' | 'folder' | null>(null);
  const [moving, setMoving] = useState<DocSummary | null>(null);
  /** The folder whose settings are folded open (its id), so walking to another folder finds them shut. */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const signedIn = viewer !== null;
  const viewerId = viewer?.id ?? null;
  const place: Place = params.get('folder') ?? 'recent';

  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    // Each place asks for its own documents, so a folder never loses its older ones behind 500 newer elsewhere.
    const scope =
      place === 'mine' ? { ownerId: viewerId ?? '', folderId: null } : place === 'recent' || place === 'others' || place === 'shared' ? {} : { folderId: place };
    Promise.all([repository.listFolders(), place === 'shared' ? Promise.resolve([]) : repository.listDocs(scope)])
      .then(([folderRows, docRows]) => {
        if (cancelled) return;
        setFolders(folderRows);
        setDocs(docRows);
        setReadAt(Date.now());
        setError(null);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'DOCUMENTS DID NOT LOAD.');
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, place, repository, status, viewerId]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const seen = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const folderNames = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders]);
  const folder = folders.find((candidate) => candidate.id === place) ?? null;
  const childrenOf = (parentId: string | null, kind: 'home' | 'shared') =>
    folders
      .filter((candidate) => candidate.parentId === parentId && candidate.kind === kind)
      .sort((left, right) => (left.id === LORE_FOLDER_ID ? -1 : right.id === LORE_FOLDER_ID ? 1 : left.name.localeCompare(right.name)));

  const inPlace = docs.filter((doc) => {
    if (place === 'recent') return true;
    if (place === 'mine') return doc.ownerId === viewer?.id && doc.folderId === null;
    if (place === 'others') return doc.ownerId !== viewer?.id && (doc.folderId === null || !seen.has(doc.folderId));
    if (place === 'shared') return false;
    return doc.folderId === place;
  });
  const shown = place === 'recent' && !showAll ? inPlace.slice(0, RECENT_ROWS) : inPlace;

  const subfolders =
    place === 'mine' ? childrenOf(null, 'home') : place === 'shared' ? childrenOf(null, 'shared') : folder === null ? [] : childrenOf(folder.id, folder.kind);

  const placeName =
    place === 'recent'
      ? signedIn
        ? 'RECENT DOCUMENTS'
        : 'PUBLIC DOCUMENTS'
      : place === 'mine'
        ? 'MY DOCUMENTS'
        : place === 'shared'
          ? 'FOLDERS'
          : place === 'others'
            ? 'SHARED WITH ME'
            : (folder?.name ?? 'FOLDER');

  // The big key the reader is standing on: a folder counts as the place it lives under.
  const tab: Place = folder === null ? place : folder.kind === 'shared' ? 'shared' : 'mine';
  const tabs: { place: Place; label: string }[] = signedIn
    ? [
        { place: 'recent', label: 'RECENT' },
        { place: 'mine', label: 'MY DOCUMENTS' },
        { place: 'others', label: 'SHARED WITH ME' },
        { place: 'shared', label: 'FOLDERS' },
      ]
    : [
        { place: 'recent', label: 'PUBLIC DOCUMENTS' },
        { place: 'shared', label: 'FOLDERS' },
      ];

  // One step back out of a folder: its parent, or the place it lives under.
  const parent = folder === null ? null : (folders.find((candidate) => candidate.id === folder.parentId) ?? null);
  const back =
    folder === null
      ? null
      : parent !== null
        ? { href: placeHref(parent.id), label: parent.name }
        : folder.kind === 'shared'
          ? { href: placeHref('shared'), label: 'FOLDERS' }
          : { href: placeHref('mine'), label: 'MY DOCUMENTS' };

  // Where a document can be moved by its owner: MY DOCUMENTS, their own folders, any shared folder.
  const moveTargets = folders.filter((candidate) => candidate.kind === 'shared' || candidate.ownerId === viewer?.id);

  // A new document is filed where the reader is standing when that is a folder, and in MY DOCUMENTS otherwise.
  const canMakeFolder = signedIn && (place === 'mine' || place === 'shared' || folder !== null);
  const ownsFolder = folder !== null && folder.ownerId === viewer?.id && folder.id !== LORE_FOLDER_ID;
  const lore = folder?.id === LORE_FOLDER_ID;
  const settings = folder !== null && settingsFor === folder.id;

  async function run(work: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await work();
      refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT CHANGED.');
    }
  }

  return (
    <DocsScale>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
        {signedIn ? (
          <button type="button" className={DOC_KEY_MAIN} onClick={() => setMaking('doc')}>
            {lore ? '[ + NEW LORE PAGE ]' : '[ + NEW DOCUMENT ]'}
          </button>
        ) : status === 'loading' ? null : (
          <p className="docs-key text-ink">
            <Link href="/account" className={DOC_KEY}>
              [ LOG IN ]
            </Link>{' '}
            TO MAKE DOCUMENTS
          </p>
        )}
        {canMakeFolder ? (
          <button type="button" className={DOC_KEY} onClick={() => setMaking('folder')}>
            [ + NEW FOLDER ]
          </button>
        ) : null}
        <span className="ml-auto">
          <DocsSizeKeys />
        </span>
      </div>

      <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3" aria-label="Where to look">
        {tabs.map((entry) => (
          <Link key={entry.place} href={placeHref(entry.place)} className={tab === entry.place ? DOC_KEY_ON : DOC_KEY} aria-current={place === entry.place ? 'page' : undefined}>
            [ {entry.label} ]
          </Link>
        ))}
      </nav>

      <section>
        <div className={TITLE_BAR}>
          <h2 className="docs-key truncate">{placeName}</h2>
        </div>

        {back === null ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2">
            <Link href={back.href} className={DOC_KEY}>
              [ &lt; {back.label} ]
            </Link>
            {ownsFolder ? (
              <button type="button" className={settings ? DOC_KEY_ON : DOC_KEY} aria-expanded={settings} onClick={() => {
                  setSettingsFor(settings ? null : folder.id);
                  setRenaming(null);
                  setRemoving(false);
                }}>
                [ FOLDER SETTINGS ]
              </button>
            ) : null}
          </div>
        )}

        {settings && ownsFolder && folder !== null ? (
          <div className="docs-meta space-y-3 py-3 text-ink">
            <div className="flex flex-wrap items-center gap-2">
              {renaming === null ? (
                <button type="button" className={DOC_KEY} onClick={() => setRenaming(folder.name)}>
                  [ RENAME THE FOLDER ]
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
                    className={`${FIELD_TIGHT} docs-key min-h-tap min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    className={DOC_KEY}
                    disabled={renaming.trim().length === 0}
                    onClick={() => {
                      const name = renaming;
                      setRenaming(null);
                      void run(() => repository.updateFolder(folder.id, { name }));
                    }}
                  >
                    [ SAVE NAME ]
                  </button>
                  <button type="button" className={DOC_KEY} onClick={() => setRenaming(null)}>
                    [ CANCEL ]
                  </button>
                </>
              )}
            </div>
            <label className="flex flex-wrap items-center gap-2">
              WHO CAN OPEN A NEW DOCUMENT MADE HERE
              <select
                value={folder.defaultAccess ?? ''}
                onChange={(event) =>
                  void run(() => repository.updateFolder(folder.id, { defaultAccess: event.target.value === '' ? null : (event.target.value as DocAccess) }))
                }
                className="docs-meta min-h-tap bg-paper text-ink"
              >
                <option value="">{DOC_ACCESS_LABELS.private}</option>
                {DOC_ACCESS_ORDER.filter((level) => level !== 'private').map((level) => (
                  <option key={level} value={level}>
                    {DOC_ACCESS_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {removing ? (
                <>
                  <button
                    type="button"
                    className={DOC_KEY}
                    onClick={() => {
                      setRemoving(false);
                      setSettingsFor(null);
                      void run(async () => {
                        await repository.deleteFolder(folder.id);
                        router.push(folder.kind === 'shared' ? placeHref('shared') : placeHref('mine'));
                      });
                    }}
                  >
                    [ REALLY REMOVE IT? ITS DOCUMENTS GO BACK TO THEIR OWNERS ]
                  </button>
                  <button type="button" className={DOC_KEY} onClick={() => setRemoving(false)}>
                    [ KEEP IT ]
                  </button>
                </>
              ) : (
                <button type="button" className={DOC_KEY} onClick={() => setRemoving(true)}>
                  [ REMOVE THE FOLDER ]
                </button>
              )}
            </div>
          </div>
        ) : null}

        {error === null ? null : <p className={`${DOC_FAULT} my-2`}>{error}</p>}

        {!ready ? (
          <p className="docs-key py-3 text-ink">READING...</p>
        ) : subfolders.length === 0 && inPlace.length === 0 ? (
          <p className="docs-key py-3 text-ink">{place === 'shared' ? 'NO FOLDERS YET.' : 'NO DOCUMENTS YET.'}</p>
        ) : (
          <ul>
            {subfolders.map((row) => (
              <FolderRow key={row.id} folder={row} href={placeHref(row.id)} />
            ))}
            {shown.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                viewerId={viewerId}
                now={readAt}
                folderName={place === 'recent' && doc.folderId !== null ? (folderNames.get(doc.folderId) ?? null) : null}
                action={
                  doc.ownerId !== null && doc.ownerId === viewer?.id && doc.slug === null ? (
                    <button type="button" className={DOC_KEY} onClick={() => setMoving(doc)} aria-label={`Move ${doc.title}`}>
                      [ MOVE ]
                    </button>
                  ) : null
                }
              />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          {shown.length < inPlace.length ? (
            <button type="button" className={DOC_KEY} onClick={() => setShowAll(true)}>
              [ SHOW ALL {inPlace.length} ]
            </button>
          ) : null}
          <button type="button" className={DOC_KEY} onClick={refresh}>
            [ ↻ CHECK FOR NEW ONES ]
          </button>
        </div>
      </section>

      {making === 'doc' && viewer !== null ? <NewDocWindow viewer={viewer} folder={folder} onClose={() => setMaking(null)} /> : null}
      {making === 'folder' && viewer !== null ? (
        <NewDocFolderWindow
          viewer={viewer}
          parent={folder}
          kind={place === 'shared' ? 'shared' : 'home'}
          onMade={(made) => {
            setMaking(null);
            refresh();
            router.push(placeHref(made.id));
          }}
          onClose={() => setMaking(null)}
        />
      ) : null}
      {moving === null ? null : (
        <DocMoveWindow
          doc={moving}
          folders={moveTargets}
          onMove={async (folderId) => {
            await repository.updateDoc(moving.id, { folderId });
            refresh();
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </DocsScale>
  );
}
