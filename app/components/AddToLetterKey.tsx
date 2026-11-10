'use client';

import { useState } from 'react';
import { addThing, createLetter, useLettersOf } from '../lib/letters/store';
import { LETTER_NAME_MAX, LETTER_TITLE_MAX, type LetterThing } from '../lib/letters/types';
import { FIELD_TIGHT, PLATE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import LetterStamp from './LetterStamp';
import PopoutWindow from './PopoutWindow';

/**
 * ADD TO LETTER (SPEC-letters.md): on anything on the site, like adding a song to a playlist. Opens a short list of your
 * letters with + NEW LETTER at the top; a press adds the thing to that letter at a random spot. Signed-in people only
 * (a letter is saved to an account); a stream guest has no letters.
 */
export default function AddToLetterKey({ thing, className = PLATE }: { thing: LetterThing; className?: string }) {
  const { user, status } = useAuth();
  const [open, setOpen] = useState(false);
  if (user === null || status !== 'signed-in') return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label={`Add "${thing.title}" to a letter`}>
        [ + LETTER ]
      </button>
      {open ? <LetterPicker owner={user.id} thing={thing} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function LetterPicker({ owner, thing, onClose }: { owner: string; thing: LetterThing; onClose: () => void }) {
  const { value, loading, error } = useLettersOf(owner);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean: LetterThing = { ...thing, title: thing.title.slice(0, LETTER_TITLE_MAX) };

  const addTo = async (letterId: string, letterName: string) => {
    setBusy(true);
    setNote(null);
    try {
      const added = await addThing(letterId, clean);
      setNote(added === 'already' ? `ALREADY IN "${letterName}".` : `ADDED TO "${letterName}".`);
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'That could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    const named = name.trim();
    if (named.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const letter = await createLetter(owner, named);
      setName('');
      await addTo(letter.id, letter.name);
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'The letter could not be made.');
      setBusy(false);
    }
  };

  return (
    <PopoutWindow title="ADD TO LETTER" onClose={onClose} maxWidth="max-w-md" centred>
      <div className="flex flex-col gap-2 p-3">
        <p className="break-words text-label text-ink">{clean.title}</p>
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void startNew();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LETTER_NAME_MAX}
            placeholder="NEW LETTER'S NAME"
            aria-label="New letter's name"
            className={`${FIELD_TIGHT} min-w-0 flex-1 basis-40`}
          />
          <button type="submit" className={PLATE} disabled={busy || name.trim().length === 0}>
            [ + NEW LETTER ]
          </button>
        </form>
        {loading && value === null ? <p className="text-label text-ink">READING YOUR LETTERS...</p> : null}
        {error ? <p className="text-label text-ink">{error}</p> : null}
        <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
          {(value ?? []).map((letter) => (
            <li key={letter.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void addTo(letter.id, letter.name)}
                className="flex w-full cursor-pointer items-center gap-2 p-1 text-left text-label text-ink hover:outline hover:outline-1 hover:outline-dotted hover:outline-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink disabled:cursor-wait"
              >
                <LetterStamp letter={letter} />
                <span className="min-w-0 flex-1 break-words">{letter.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {note ? (
          <p role="status" className="bg-bubble-pale px-2 py-1 text-label text-ink-bar">
            {note}
          </p>
        ) : null}
      </div>
    </PopoutWindow>
  );
}
