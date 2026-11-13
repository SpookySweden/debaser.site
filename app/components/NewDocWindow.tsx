'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { DOC_ACCESS_LABELS, DOC_ACCESS_ORDER, docPath, docSlug, isDocSlug } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocAccess, type DocFolder, type DocViewer } from '../lib/docs/types';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import PopoutWindow from './PopoutWindow';

type NewDocWindowProps = {
  viewer: DocViewer;
  /** Where it is made: a folder, or null for MY DOCS. */
  folder: DocFolder | null;
  onClose: () => void;
};

/**
 * Making a document: a title, a line about it, and who can see it (the folder's default to start with).
 *
 * Made in LORE it is a lore page: PUBLIC, with a `/lore/<slug>` address read off its title and printed
 * as it is typed, since that address is the one thing that cannot change afterwards.
 */
export default function NewDocWindow({ viewer, folder, onClose }: NewDocWindowProps) {
  const router = useRouter();
  const repository = useMemo(() => getDocsRepository(viewer.id), [viewer.id]);
  const lore = folder?.id === LORE_FOLDER_ID;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [access, setAccess] = useState<DocAccess>(lore ? 'public' : (folder?.defaultAccess ?? 'private'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = docSlug(title);
  const usable = title.trim().length > 0 && (!lore || isDocSlug(slug));

  async function make(): Promise<void> {
    if (!usable) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await repository.createDoc({
        title,
        summary,
        folderId: folder?.id ?? null,
        access: lore ? 'public' : access,
        slug: lore ? slug : undefined,
        viewer,
      });
      router.push(docPath(doc));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE DOCUMENT WAS NOT MADE.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title={lore ? 'NEW LORE PAGE' : 'NEW DOC'} onClose={onClose} maxWidth="max-w-xl">
      <label className="block text-label font-bold text-ink" htmlFor="doc-new-title">
        TITLE
      </label>
      <input
        id="doc-new-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={120}
        placeholder={lore ? 'THE GLASS CORRIDOR' : 'ISSUE 3 PLAN'}
        className={FIELD}
        autoFocus
      />

      <label className="mt-2 block text-label font-bold text-ink" htmlFor="doc-new-summary">
        ONE LINE ABOUT IT (OPTIONAL)
      </label>
      <input id="doc-new-summary" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={300} className={FIELD} />

      {lore ? (
        <p className="mt-2 text-label font-bold text-ink">
          LIVES AT: <span className="text-accent-ink">{isDocSlug(slug) ? `/lore/${slug}` : 'NEEDS A LETTER OR DIGIT'}</span>
        </p>
      ) : (
        <label className="mt-2 block text-label font-bold text-ink">
          WHO CAN SEE IT
          <select value={access} onChange={(event) => setAccess(event.target.value as DocAccess)} className="mt-1 block bg-paper text-label text-ink">
            {DOC_ACCESS_ORDER.map((level) => (
              <option key={level} value={level}>
                {DOC_ACCESS_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
      )}

      {error === null ? null : <p className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void make()} disabled={busy || !usable} className={PLATE_MAIN}>
          {busy ? '[ MAKING... ]' : '[ MAKE ]'}
        </button>
        <button type="button" onClick={onClose} className={PLATE_LARGE}>
          [ CANCEL ]
        </button>
      </div>
    </PopoutWindow>
  );
}
