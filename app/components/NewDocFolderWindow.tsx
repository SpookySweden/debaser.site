'use client';

import { useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_ORDER } from '../lib/docs/rules';
import type { DocAccess, DocFolder, DocViewer } from '../lib/docs/types';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';

type NewDocFolderWindowProps = {
  viewer: DocViewer;
  /** Where it goes: inside this folder, or at the top of MY DOCS (`home`) or of the shared folders (`shared`). */
  parent: DocFolder | null;
  kind: 'home' | 'shared';
  onMade: (folder: DocFolder) => void;
  onClose: () => void;
};

/** A folder: a name, and what a new document made in it starts as. Shared ones are seen by everyone signed in. */
export default function NewDocFolderWindow({ viewer, parent, kind, onMade, onClose }: NewDocFolderWindowProps) {
  const repository = useMemo(() => getDocsRepository(viewer.id), [viewer.id]);
  const [name, setName] = useState('');
  const [defaultAccess, setDefaultAccess] = useState<DocAccess | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderKind = parent?.kind ?? kind;

  async function make(): Promise<void> {
    if (name.trim().length === 0) return;
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
    <PopoutWindow title={folderKind === 'shared' ? 'NEW SHARED FOLDER' : 'NEW FOLDER'} onClose={onClose} maxWidth="max-w-xl">
      <label className="block text-label font-bold text-ink" htmlFor="doc-folder-name">
        NAME
      </label>
      <input
        id="doc-folder-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
        placeholder={folderKind === 'shared' ? 'DEBASER' : 'NOTES'}
        className={FIELD}
        autoFocus
      />

      <label className="mt-2 block text-label font-bold text-ink">
        NEW DOCUMENTS IN IT START AS
        <select
          value={defaultAccess}
          onChange={(event) => setDefaultAccess(event.target.value as DocAccess | '')}
          className="mt-1 block bg-paper text-label text-ink"
        >
          <option value="">PRIVATE (NO DEFAULT)</option>
          {DOC_ACCESS_ORDER.filter((level) => level !== 'private').map((level) => (
            <option key={level} value={level}>
              {DOC_ACCESS_LABELS[level]}
            </option>
          ))}
        </select>
      </label>

      {error === null ? null : <p className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void make()} disabled={busy || name.trim().length === 0} className={PLATE_MAIN}>
          {busy ? '[ MAKING... ]' : '[ MAKE ]'}
        </button>
        <button type="button" onClick={onClose} className={PLATE_LARGE}>
          [ CANCEL ]
        </button>
      </div>
    </PopoutWindow>
  );
}
