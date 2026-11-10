'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { closeLetter, letterIdFromSearch, letterWindowState, openLetter, subscribeToLetterWindow } from '../lib/letters/letter-window';
import { shuffleLetter, updateLetter, useLetter } from '../lib/letters/store';
import type { LetterItem } from '../lib/letters/types';
import { PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import LetterCanvas from './LetterCanvas';
import LetterItemPopout from './LetterItemPopout';
import LetterLinkForm from './LetterLinkForm';
import LetterSettings from './LetterSettings';
import { nameInkStyle } from './NameColourWindow';

/**
 * One letter, in a window over whatever page it was opened from (SPEC-letters.md). Its name at the top in its own colour,
 * with the cog (settings) and the lock (public or private) beside it for the owner, then the canvas. Drawn once in
 * `layout.tsx`; `?letter=<id>` on any page opens it.
 */
export default function LetterWindow() {
  const state = useSyncExternalStore(subscribeToLetterWindow, letterWindowState, letterWindowState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = search.toString();

  useEffect(() => {
    const named = letterIdFromSearch(asked);
    if (named !== null) openLetter(named);
  }, [asked]);

  const close = useCallback(() => {
    closeLetter();
    if (letterIdFromSearch(asked) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  if (!state.open || state.letterId === null) return null;
  return <LetterWindowBody key={state.letterId} letterId={state.letterId} onClose={close} />;
}

function LetterWindowBody({ letterId, onClose }: { letterId: string; onClose: () => void }) {
  const { user } = useAuth();
  const { letter, items } = useLetter(letterId);
  const [opened, setOpened] = useState<LetterItem | null>(null);
  const [settings, setSettings] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const value = letter.value;
  const owner = value !== null && user !== null && user.id === value.owner;
  const held = items.value ?? [];

  const flipLock = async () => {
    if (!value) return;
    setFault(null);
    try {
      await updateLetter(value.id, { isPublic: !value.isPublic });
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The letter could not be saved.');
    }
  };

  const shuffle = async () => {
    setFault(null);
    try {
      await shuffleLetter(letterId);
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The cards could not all be moved.');
    }
  };

  return (
    <DockWindow id="letter" title="LETTER" onClose={onClose} defaultSize={{ w: 560, h: 520 }} minSize={{ w: 300, h: 300 }}>
      <div className="flex h-full flex-col gap-2 overflow-auto bg-sun-pale p-2">
        {value === null ? (
          <p className="p-2 text-label text-ink">{letter.loading ? 'READING THE LETTER...' : (letter.error ?? 'THIS LETTER IS PRIVATE, OR IT HAS BEEN DELETED.')}</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 break-words text-title">
                <span className={value.textColour ? 'name-ink' : 'text-ink'} style={value.textColour ? nameInkStyle(value.textColour) : undefined}>
                  {value.name}
                </span>
              </h2>
              {owner ? (
                <>
                  <button type="button" onClick={() => setSettings(true)} aria-label="Letter settings" title="SETTINGS" className={PLATE}>
                    [ ⚙ ]
                  </button>
                  <button
                    type="button"
                    onClick={() => void flipLock()}
                    aria-pressed={!value.isPublic}
                    aria-label={value.isPublic ? 'Public: anyone can see this letter. Press to make it private.' : 'Private: only you can see this letter. Press to make it public.'}
                    title={value.isPublic ? 'PUBLIC' : 'PRIVATE'}
                    className={PLATE}
                  >
                    {value.isPublic ? '[ 🔓 PUBLIC ]' : '[ 🔒 PRIVATE ]'}
                  </button>
                  <button type="button" onClick={() => void shuffle()} className={PLATE} disabled={held.length < 2}>
                    [ SHUFFLE ]
                  </button>
                </>
              ) : null}
            </header>
            {value.description ? (
              <p className="break-words text-label">
                <span className={value.textColour ? 'name-ink' : 'text-ink'} style={value.textColour ? nameInkStyle(value.textColour) : undefined}>
                  {value.description}
                </span>
              </p>
            ) : null}
            {items.loading && items.value === null ? <p className="text-label text-ink">READING...</p> : <LetterCanvas letter={value} items={held} onOpen={setOpened} />}
            {owner ? <LetterLinkForm letterId={value.id} /> : null}
            {fault ? (
              <p role="status" className="bg-bubble-pale px-2 py-1 text-label text-ink-bar">
                {fault}
              </p>
            ) : null}
            {opened ? <LetterItemPopout item={opened} owner={owner} onClose={() => setOpened(null)} /> : null}
            {settings ? <LetterSettings letter={value} items={held} onClose={() => setSettings(false)} /> : null}
          </>
        )}
      </div>
    </DockWindow>
  );
}
