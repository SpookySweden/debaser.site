'use client';

import { useMemo, useRef, useState } from 'react';
import {
  archiveDisplayName,
  folderLabel,
  normaliseArchiveName,
  normaliseFolderPath,
  type FolderPath,
} from '../lib/audio/archive-tree';
import { measureTrackLength } from '../lib/audio/attach';
import { MAX_TRACK_BYTES, MUSIC_ACCEPT } from '../lib/audio/catalogue';
import { getMusicRepository, type MusicFolder } from '../lib/audio/repository';
import type { AudioTrack } from '../lib/audio/tracks';
import type { ForumAuthor } from '../lib/forum/types';
import { FIELD, FIELD_TIGHT, PLATE_LARGE } from '../lib/ui/controls';
import AudioTagChooser from './AudioTagChooser';
import PopoutWindow from './PopoutWindow';

type NewArchiveFileWindowProps = {
  /** The folder the button was pressed in; the file is filed here unless another is chosen. */
  parent: FolderPath | null;
  /** The folders that exist, so a file can be filed into one that is already there. */
  folders: { path: FolderPath }[];
  author: ForumAuthor;
  /** Makes the folder a file is going into, if one was named. */
  createFolder: (path: FolderPath, creator: { id: string; displayName: string }) => Promise<MusicFolder>;
  /** The file that was filed, so the page can open it. */
  onCreated: (track: AudioTrack) => void;
  onClose: () => void;
};

/**
 * NEW FILE: filing a track into the archive, from the browser itself.
 *
 * Where it goes is what this window is really about. A file's name in this archive *is* where it
 * is - `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]` - so the window offers the folders that
 * exist, takes a new one typed in their place, and prints the name the file will carry before
 * anything is sent. The audio goes to the store the shelf has always used, so nothing about the
 * player changes, and the page opens the file afterwards.
 */
export default function NewArchiveFileWindow({
  parent,
  folders,
  author,
  createFolder,
  onCreated,
  onClose,
}: NewArchiveFileWindowProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [credit, setCredit] = useState('');
  const [where, setWhere] = useState<FolderPath | ''>(parent ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The folder the file is going into: the one chosen, plus a new one typed under it. */
  const chosen = useMemo(() => {
    const base = normaliseFolderPath(where);
    const typed = normaliseFolderPath(newFolder);
    const parts = [...(base === null ? [] : [base]), ...(typed === null ? [] : [typed])];

    return parts.length === 0 ? null : parts.join('/');
  }, [where, newFolder]);

  const named = normaliseArchiveName(title);
  const fileName = archiveDisplayName(named.length === 0 ? 'UNTITLED' : named, chosen);

  async function fileIt() {
    if (author.id === null) {
      setError('FILING A FILE TAKES AN ACCOUNT.');
      return;
    }

    if (file === null) {
      setError('CHOOSE AN AUDIO FILE FIRST.');
      return;
    }

    if (named.length === 0) {
      setError('A FILE NEEDS A NAME.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // A folder named here is made first, so the file is never filed into a path that is not
      // there yet - and a path that already is, is simply used.
      if (normaliseFolderPath(newFolder) !== null && chosen !== null) {
        await createFolder(chosen, { id: author.id, displayName: author.displayName });
      }

      const length = await measureTrackLength(file);

      const track = await getMusicRepository().uploadTrack({
        uploaderId: author.id,
        uploaderName: author.displayName,
        title: fileName,
        credit,
        tags,
        ...(length === undefined ? {} : { length }),
        folderPath: chosen,
        file,
      });

      onCreated(track);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE FILE WAS REFUSED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow
      title={`NEW FILE :: ${folderLabel(parent)}`}
      badge="[ FILE ]"
      onClose={onClose}
      maxWidth="max-w-2xl"
      actions={
        <button type="button" onClick={() => void fileIt()} disabled={busy} className={PLATE_LARGE}>
          {busy ? '[ FILING... ]' : '[ FILE IT ]'}
        </button>
      }
    >
      <label htmlFor="new-file-title" className="block text-[10px] font-bold text-black">
        FILE NAME
      </label>
      <input
        id="new-file-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. GLASS CORRIDOR"
        className={FIELD}
      />

      <p className="mt-1 text-[10px] font-bold text-black">FILES AS: {fileName}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="new-file-folder" className="block text-[10px] font-bold text-black">
            FOLDER
          </label>
          <select
            id="new-file-folder"
            value={where}
            onChange={(event) => setWhere(event.target.value)}
            className={`${FIELD_TIGHT} mt-1 w-full`}
          >
            <option value="">{folderLabel(null)}</option>
            {folders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {folderLabel(folder.path)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="new-file-new-folder" className="block text-[10px] font-bold text-black">
            OR A NEW ONE BELOW IT
          </label>
          <input
            id="new-file-new-folder"
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder="e.g. TAPE DECK SUMMER"
            className={FIELD}
          />
        </div>
      </div>

      <p className="mt-1 text-[10px] font-bold text-gray-700">GOES TO: {folderLabel(chosen)}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="new-file-credit" className="block text-[10px] font-bold text-black">
            CREDITED TO
          </label>
          <input
            id="new-file-credit"
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
            placeholder={author.displayName}
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="new-file-upload" className="block text-[10px] font-bold text-black">
            THE AUDIO FILE (MP3, M4A, OGG, WAV, FLAC - {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB MAX)
          </label>
          <input
            id="new-file-upload"
            ref={fileInput}
            type="file"
            accept={MUSIC_ACCEPT}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full cursor-pointer rounded-none border border-gray-500 bg-white p-1 text-[10px] font-bold text-black"
          />
        </div>
      </div>

      <AudioTagChooser id="new-file" value={tags} onChange={setTags} />

      {error === null ? null : <p className="mt-2 text-[10px] font-bold text-[#800000]">{error}</p>}
    </PopoutWindow>
  );
}
