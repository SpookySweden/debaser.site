'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { isLoreSlug, lorePagePath, loreSlug } from '../lib/lore/pages';
import { getLoreRepository } from '../lib/lore/repository';
import { FIELD, PLATE_LARGE } from '../lib/ui/controls';
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
      setError('OPENING A PAGE TAKES AN ACCOUNT - SIGN IN FIRST.');
      return;
    }

    if (!usable) {
      setError('THAT TITLE MAKES NO ADDRESS - GIVE THE PAGE A NAME TO FILE IT UNDER.');
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
      setError(caught instanceof Error ? caught.message : 'THE PAGE COULD NOT BE OPENED.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow
      title="OPEN A LORE PAGE"
      badge="[ NEW ]"
      onClose={onClose}
      maxWidth="max-w-xl"
      status="THE ADDRESS IS READ OFF THE TITLE"
    >
      <label className="block text-[10px] font-bold text-black" htmlFor="lore-new-title">
        TITLE
      </label>
      <input
        id="lore-new-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="THE GLASS CORRIDOR"
        className={FIELD}
      />

      <label className="mt-2 block text-[10px] font-bold text-black" htmlFor="lore-new-summary">
        ONE LINE ABOUT IT (OPTIONAL)
      </label>
      <input
        id="lore-new-summary"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="where the comic opens, and what the corridor is made of"
        className={FIELD}
      />

      <p className="mt-2 text-[10px] font-bold text-black">
        LIVES AT:{' '}
        <span className="text-[#0000ff]">
          {usable ? lorePagePath(slug) : 'AN ADDRESS NEEDS A LETTER OR A DIGIT IN THE TITLE'}
        </span>
      </p>

      <p className="mt-1 text-[10px] font-bold text-gray-700">
        {'THE PAGE IS OPENED EMPTY, AND IT IS WRITTEN TOGETHER: ANY ACCOUNT MAY TYPE ON IT, AND EVERYBODY WITH IT OPEN SEES THE OTHERS\' WORDS AS THEY LAND.'}
      </p>

      {error === null ? null : <p className="mt-2 text-[10px] font-bold text-[#800000]">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void open()} disabled={busy || !usable} className={PLATE_LARGE}>
          {busy ? '[ OPENING... ]' : '[ OPEN THE PAGE ]'}
        </button>
        <button type="button" onClick={onClose} className={PLATE_LARGE}>
          [ CANCEL ]
        </button>
      </div>
    </PopoutWindow>
  );
}
