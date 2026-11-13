'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { getDocsRepository } from '../lib/docs/repository';
import { docPath, docSlug, isDocSlug } from '../lib/docs/rules';
import { LORE_FOLDER_ID, type DocFolder, type DocViewer } from '../lib/docs/types';
import { DOC_FAULT, DOC_KEY, DOC_KEY_MAIN } from '../lib/docs/ui';
import { FIELD } from '../lib/ui/controls';
import DocsScale from './DocsScale';
import PopoutWindow from './PopoutWindow';

type NewDocWindowProps = {
  viewer: DocViewer;
  /** Where it is made: a folder, or null for MY DOCUMENTS. */
  folder: DocFolder | null;
  onClose: () => void;
};

/**
 * Making a document: its title, and nothing else (Luke, 2026-11-13: "ask for a title first"). It starts as
 * its folder's default, or ONLY ME; who can open it is changed afterwards with SHARE.
 *
 * Made in LORE it is a lore page: open to EVERYONE, with a `/lore/<slug>` address read off its title and printed
 * as it is typed, since that address is the one thing that cannot change afterwards, and the one line
 * the lore shelf prints under it.
 */
export default function NewDocWindow({ viewer, folder, onClose }: NewDocWindowProps) {
  const router = useRouter();
  const repository = useMemo(() => getDocsRepository(viewer.id), [viewer.id]);
  const lore = folder?.id === LORE_FOLDER_ID;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = docSlug(title);
  const usable = title.trim().length > 0 && (!lore || isDocSlug(slug));

  async function make(): Promise<void> {
    if (!usable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await repository.createDoc({
        title,
        summary: lore ? summary : '',
        folderId: folder?.id ?? null,
        access: lore ? 'public' : (folder?.defaultAccess ?? 'private'),
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
    <PopoutWindow title={lore ? 'NEW LORE PAGE' : 'NEW DOCUMENT'} onClose={onClose} maxWidth="max-w-2xl" centred>
      <DocsScale>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
        >
          <label className="docs-key block text-ink" htmlFor="doc-new-title">
            {lore ? 'NAME THE PAGE' : 'NAME YOUR DOCUMENT'}
          </label>
          <input
            id="doc-new-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder={lore ? 'THE GLASS CORRIDOR' : 'SHOPPING LIST'}
            className={`${FIELD} docs-text`}
            autoComplete="off"
            autoFocus
          />

          {lore ? (
            <>
              <label className="docs-meta mt-3 block text-ink" htmlFor="doc-new-summary">
                ONE LINE ABOUT IT (OPTIONAL)
              </label>
              <input id="doc-new-summary" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={300} className={`${FIELD} docs-meta`} />
              <p className="docs-meta mt-3 text-ink">
                LIVES AT: <span className="text-accent-ink">{isDocSlug(slug) ? `/lore/${slug}` : 'NEEDS A LETTER OR DIGIT'}</span>
              </p>
            </>
          ) : (
            <p className="docs-meta mt-3 text-ink">GOES IN: {folder?.name ?? 'MY DOCUMENTS'}</p>
          )}

          {error === null ? null : <p className={`${DOC_FAULT} mt-3`}>{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !usable} className={DOC_KEY_MAIN}>
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
