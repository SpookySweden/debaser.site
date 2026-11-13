'use client';

import { useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_ORDER } from '../lib/docs/rules';
import type { DocAccess, DocFolder, DocViewer } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_MAIN } from '../lib/docs/ui';
import { FIELD } from '../lib/ui/controls';
import DocsScale from './DocsScale';
import PopoutWindow from './PopoutWindow';

type NewDocFolderWindowProps = {
  viewer: DocViewer;
  /** Where it goes: inside this folder, or at the top of MY DOCUMENTS (`home`) or of the shared folders (`shared`). */
  parent: DocFolder | null;
  kind: 'home' | 'shared';
  onMade: (folder: DocFolder) => void;
  onClose: () => void;
};

/** A folder: a name, and who can open a new document made in it. Shared ones are seen by everyone signed in. */
export default function NewDocFolderWindow({ viewer, parent, kind, onMade, onClose }: NewDocFolderWindowProps) {
  const repository = useMemo(() => getDocsRepository(viewer.id), [viewer.id]);
  const [name, setName] = useState('');
  const [defaultAccess, setDefaultAccess] = useState<DocAccess | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderKind = parent?.kind ?? kind;

  async function make(): Promise<void> {
    if (name.trim().length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const folder = await repository.createFolder({
        name,
        parentId: parent?.id ?? null,
        kind: folderKind,
        defaultAccess: defaultAccess === '' ? null : defaultAccess,
        viewer,
      });
      onMade(folder);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE FOLDER WAS NOT MADE.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title={folderKind === 'shared' ? 'NEW SHARED FOLDER' : 'NEW FOLDER'} onClose={onClose} maxWidth="max-w-2xl" centred>
      <DocsScale>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
        >
          <label className="docs-key block text-ink" htmlFor="doc-folder-name">
            NAME THE FOLDER
          </label>
          <input
            id="doc-folder-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder={folderKind === 'shared' ? 'DEBASER' : 'NOTES'}
            className={`${FIELD} docs-text`}
            autoComplete="off"
            autoFocus
          />

          {folderKind === 'shared' ? <p className="docs-meta mt-3 text-ink">EVERYONE SIGNED IN SEES A SHARED FOLDER.</p> : null}

          <label className="docs-meta mt-3 block text-ink" htmlFor="doc-folder-access">
            WHO CAN OPEN A NEW DOCUMENT MADE IN IT
          </label>
          <select
            id="doc-folder-access"
            value={defaultAccess}
            onChange={(event) => setDefaultAccess(event.target.value as DocAccess | '')}
            className="docs-meta mt-1 block min-h-tap bg-paper text-ink"
          >
            <option value="">{DOC_ACCESS_LABELS.private}</option>
            {DOC_ACCESS_ORDER.filter((level) => level !== 'private').map((level) => (
              <option key={level} value={level}>
                {DOC_ACCESS_LABELS[level]}
              </option>
            ))}
          </select>

          {error === null ? null : <p className={`${DOC_FAULT} mt-3`}>{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || name.trim().length === 0} className={DOC_KEY_MAIN}>
              {busy ? '[ CREATING... ]' : '[ CREATE ]'}
            </button>
            <button type="button" onClick={onClose} className={DOC_KEY}>
              [ CANCEL ]
            </button>
          </div>
        </form>
      </DocsScale>
    </PopoutWindow>
  );
}
