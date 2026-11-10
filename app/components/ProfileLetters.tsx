'use client';

import { useState } from 'react';
import { openLetter } from '../lib/letters/letter-window';
import { createLetter, useLettersOf } from '../lib/letters/store';
import { LETTER_NAME_MAX } from '../lib/letters/types';
import { FIELD_TIGHT, PLATE } from '../lib/ui/controls';
import LetterStamp from './LetterStamp';
import { nameInkStyle } from './NameColourWindow';

/**
 * LETTERS on a profile (SPEC-letters.md): each letter as a small envelope with its round stamp picture, and beside it
 * NAME : description in the letter's own text colour. The owner sees all of theirs and can start a new one; anyone else
 * sees the public ones, and a profile with none shows nothing at all to them.
 */
export default function ProfileLetters({ userId, owner }: { userId: string; owner: boolean }) {
  const { value, loading, error } = useLettersOf(userId);
  const letters = value ?? [];
  if (!owner && letters.length === 0) return null;

  return (
    <section aria-labelledby="profile-letters" className="mt-4">
      <h2 id="profile-letters" className="title-line text-accent-ink">
        LETTERS
      </h2>
      {loading && value === null ? <p className="p-2 text-label text-ink">READING...</p> : null}
      {error ? <p className="p-2 text-label text-ink">{error}</p> : null}
      <ul className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
        {letters.map((letter) => (
          <li key={letter.id}>
            <button
              type="button"
              onClick={() => openLetter(letter.id)}
              className="flex w-full cursor-pointer items-center gap-2 p-1 text-left hover:outline hover:outline-1 hover:outline-dotted hover:outline-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink"
            >
              <LetterStamp letter={letter} />
              <span className="min-w-0 flex-1 break-words text-label">
                <span className={letter.textColour ? 'name-ink' : 'text-ink'} style={letter.textColour ? nameInkStyle(letter.textColour) : undefined}>
                  {letter.name}
                  {letter.description ? ` : ${letter.description}` : ''}
                </span>
                {owner ? <span className="ml-1 text-ink-quiet">{letter.isPublic ? '🔓' : '🔒'}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {owner ? <NewLetterForm owner={userId} /> : null}
    </section>
  );
}

function NewLetterForm({ owner }: { owner: string }) {
  const [name, setName] = useState('');
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-1 px-2"
      onSubmit={(event) => {
        event.preventDefault();
        const named = name.trim();
        if (named.length === 0) return;
        setBusy(true);
        setFault(null);
        createLetter(owner, named).then(
          (letter) => {
            setName('');
            setBusy(false);
            openLetter(letter.id);
          },
          (failure: unknown) => {
            setFault(failure instanceof Error ? failure.message : 'The letter could not be made.');
            setBusy(false);
          },
        );
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
      {fault ? (
        <span role="status" className="w-full text-label text-ink">
          {fault}
        </span>
      ) : null}
    </form>
  );
}
