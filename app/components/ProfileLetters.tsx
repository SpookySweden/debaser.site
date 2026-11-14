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
 * its name in the letter's own text colour. The owner sees all of theirs and can start a new one; anyone else
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
      {/* Slim (Luke, 2026-11-14: "far less bulky and more simplistic regarding the outline and text ans size of the letter
          itself. more slim"): each letter is one short line, a small envelope and its name, and they sit side by side for as
          many as the width holds. The description shows on the opened letter and as the key's hint, not here; the owner's
          lock shows only on a letter nobody else can see. */}
      <ul className="flex flex-wrap items-start gap-x-3 px-2 py-1">
        {letters.map((letter) => (
          <li key={letter.id} className="min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => openLetter(letter.id)}
              title={letter.description || undefined}
              className="flex max-w-full cursor-pointer items-center gap-1.5 px-1 py-1 text-left hover:outline hover:outline-1 hover:outline-dotted hover:outline-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink max-sm:min-h-tap"
            >
              <LetterStamp letter={letter} />
              <span
                className={`min-w-0 break-words text-label ${letter.textColour ? 'name-ink' : 'text-ink'}`}
                style={letter.textColour ? nameInkStyle(letter.textColour) : undefined}
              >
                {letter.name}
              </span>
              {owner && !letter.isPublic ? (
                <span className="text-label text-ink-quiet" title="PRIVATE: ONLY YOU SEE IT">
                  <span aria-hidden="true">🔒</span>
                  <span className="sr-only">, private</span>
                </span>
              ) : null}
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
        className={`${FIELD_TIGHT} min-w-0 max-w-xs flex-1 basis-40`}
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
