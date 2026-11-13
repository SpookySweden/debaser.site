'use client';

import { useState } from 'react';
import type { DocFolder, DocSummary } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_ON } from '../lib/docs/ui';
import DocsScale from './DocsScale';
import PopoutWindow from './PopoutWindow';

type DocMoveWindowProps = {
  doc: DocSummary;
  /** Where its owner may file it: their own folders and every shared one. MY DOCUMENTS is always offered. */
  folders: DocFolder[];
  /** Files it (null is MY DOCUMENTS); throws with the reason when it was not moved. */
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
};

/** MOVE: the places a document can be filed, as one big key each. The one it is in now is the filled one. */
export default function DocMoveWindow({ doc, folders, onMove, onClose }: DocMoveWindowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const places: { id: string | null; name: string }[] = [
    { id: null, name: 'MY DOCUMENTS' },
    ...folders.map((folder) => ({ id: folder.id as string | null, name: folder.kind === 'shared' ? `${folder.name} (SHARED FOLDER)` : folder.name })),
  ];

  async function move(folderId: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onMove(folderId);
      onClose();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT MOVED.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="MOVE" onClose={onClose} maxWidth="max-w-2xl" centred>
      <DocsScale>
        <p className="docs-key break-words text-ink">MOVE “{doc.title}” TO:</p>
        {error === null ? null : <p className={`${DOC_FAULT} mt-2`}>{error}</p>}
        <ul className="mt-2">
          {places.map((place) => {
            const here = doc.folderId === place.id;
            return (
              <li key={place.id ?? 'home'} className="py-1">
                <button
                  type="button"
                  className={`${here ? DOC_KEY_ON : DOC_KEY} w-full text-left`}
                  aria-pressed={here}
                  disabled={busy || here}
                  onClick={() => void move(place.id)}
                >
                  [ {place.name}{here ? ' - IT IS HERE NOW' : ''} ]
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3">
          <button type="button" className={DOC_KEY} onClick={onClose}>
            [ CANCEL ]
          </button>
        </div>
      </DocsScale>
    </PopoutWindow>
  );
}
