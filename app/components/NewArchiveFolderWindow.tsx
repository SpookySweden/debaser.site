'use client';

import { useState } from 'react';
import { childFolderPath, folderLabel, normaliseArchiveName, type FolderPath } from '../lib/audio/archive-tree';
import type { MusicFolder } from '../lib/audio/repository';
import type { ForumAuthor } from '../lib/forum/types';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';

type NewArchiveFolderWindowProps = {
  /** The folder it is made inside; `null` makes it at the root of the archive. */
  parent: FolderPath | null;
  /** Who is making it - a folder is only ever made by an account. */
  author: ForumAuthor;
  /** Makes the folder, through the same store the browser reads its folders from. */
  create: (path: FolderPath, creator: { id: string; displayName: string }) => Promise<MusicFolder>;
  onCreated: (folder: MusicFolder) => void;
  onClose: () => void;
};

/**
 * NEW FOLDER: one name, and where it lands.
 *
 * A folder in this archive *is* a release or an artist - a file's name is read off the folders
 * it sits in - so this says what it is about to become (`MUSIC / HEXHAM / GRIDLOCK`) before
 * anything is written. A path that is already there is handed back rather than refused: two
 * people filing into the same artist are asking for the same folder.
 */
export default function NewArchiveFolderWindow({ parent, author, create, onCreated, onClose }: NewArchiveFolderWindowProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = childFolderPath(parent, name);
  const named = normaliseArchiveName(name).length > 0;

  async function make() {
    if (author.id === null) {
      setError('MAKING A FOLDER TAKES AN ACCOUNT.');
      return;
    }

    if (!named) {
      setError('A FOLDER NEEDS A NAME.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const created = await create(path, { id: author.id, displayName: author.displayName });

      onCreated(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE FOLDER COULD NOT BE MADE.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow
      title={`NEW FOLDER :: ${folderLabel(parent)}`}
      badge="[ FOLDER ]"
      onClose={onClose}
      maxWidth="max-w-md"
      actions={
        <button type="button" onClick={() => void make()} disabled={busy} className={PLATE_LARGE}>
          {busy ? '[ MAKING... ]' : '[ MAKE FOLDER ]'}
        </button>
      }
    >
      <p className="text-[10px] font-bold text-ink">IN: {folderLabel(parent)}</p>

      <label htmlFor="new-folder-name" className="mt-2 block text-[10px] font-bold text-ink">
        NAME
      </label>
      <input
        id="new-folder-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void make();
        }}
        placeholder="e.g. GRIDLOCK"
        className={FIELD}
      />

      <p className="mt-2 text-[10px] font-bold text-ink">BECOMES: {named ? path : '...'}</p>

      {error === null ? null : <p className="mt-2 text-[10px] font-bold text-bubble-pale">{error}</p>}
    </PopoutWindow>
  );
}
