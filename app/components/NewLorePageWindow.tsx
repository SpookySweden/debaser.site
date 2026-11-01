'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { isLoreSlug, lorePagePath, loreSlug } from '../lib/lore/pages';
import { getLoreRepository } from '../lib/lore/repository';
import { FIELD, PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';

type NewLorePageWindowProps = {
  onClose: () => void;
  /** Told to read the shelf again: a page nobody can see is a page nobody knows was opened. */
  onOpened: () => void;
};

/**
 * Opening a page: a title, a line about it, and the address the title makes.
 *
 * The address is printed as the title is typed rather than hidden behind a second field, because
 * it is the one thing here that cannot be changed afterwards - it is what every link to the page
 * will say, so it is worth seeing before it is filed. The window is the same shape as the music
 * archive's `[ NEW FOLDER ]` (./NewArchiveFolderWindow.tsx): one small form, the thing it is about
 * to make on screen, and the store's own words if it refuses.
 */
export default function NewLorePageWindow({ onClose, onOpened }: NewLorePageWindowProps) {
  const { user } = useAuth();
  const router = useRouter();
  const repository = useMemo(() => getLoreRepository(), []);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = loreSlug(title);
  const usable = isLoreSlug(slug);

  async function open(): Promise<void> {
    if (user === null) {
      setError('SIGN IN FIRST.');
      return;
    }

    if (!usable) {
      setError('TITLE NEEDS A LETTER OR DIGIT.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const page = await repository.createPage({
        title,
        summary,
        creatorId: user.id,
        creatorName: user.displayName,
      });

      onOpened();
      router.push(lorePagePath(page.slug));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'COULD NOT CREATE THE PAGE.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow
      title="NEW LORE PAGE"
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <label className="block text-label font-bold text-ink" htmlFor="lore-new-title">
        TITLE
      </label>
      <input
        id="lore-new-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="THE GLASS CORRIDOR"
        className={FIELD}
      />

      <label className="mt-2 block text-label font-bold text-ink" htmlFor="lore-new-summary">
        SUMMARY (OPTIONAL)
      </label>
      <input
        id="lore-new-summary"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="one line"
        className={FIELD}
      />

      <p className="mt-2 text-label font-bold text-ink">
        LIVES AT:{' '}
        <span className="text-accent-ink">
          {usable ? lorePagePath(slug) : 'NEEDS A LETTER OR DIGIT'}
        </span>
      </p>

      {error === null ? null : <p className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void open()} disabled={busy || !usable} className={PLATE_MAIN}>
          {busy ? '[ CREATING... ]' : '[ CREATE ]'}
        </button>
        <button type="button" onClick={onClose} className={PLATE_LARGE}>
          [ CANCEL ]
        </button>
      </div>
    </PopoutWindow>
  );
}
