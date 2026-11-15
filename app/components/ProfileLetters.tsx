'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { letterDraggable } from '../lib/letters/letter-drag';
import { openLetter } from '../lib/letters/letter-window';
import { closeNewLetter, newLetterWindowOpen, openNewLetter, subscribeToNewLetterWindow } from '../lib/letters/new-letter-window';
import { createLetter, useLettersOf } from '../lib/letters/store';
import { LETTER_NAME_MAX } from '../lib/letters/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import LetterDragLayer from './LetterDragLayer';
import LetterStamp from './LetterStamp';
import { nameInkStyle } from './NameColourWindow';
import PopoutWindow from './PopoutWindow';

/**
 * LETTERS on a profile (SPEC-letters.md): each letter as a small envelope with its round stamp picture, and beside it
 * its name in the letter's own text colour. The owner sees all of theirs and can start a new one; anyone else
 * sees the public ones, and a profile with none shows nothing at all to them.
 */
export default function ProfileLetters({ userId, owner }: { userId: string; owner: boolean }) {
  const { value, loading, error } = useLettersOf(userId);
  const { user } = useAuth();
  /** What the last carried letter came to: SENT "MIXTAPE" TO NAME, or why not (SPEC-letter-drag.md). */
  const [said, setSaid] = useState<string | null>(null);
  const letters = value ?? [];
  if (!owner && letters.length === 0) return null;
  const me = user?.id ?? null;

  return (
    <section aria-labelledby="profile-letters" className="mt-4">
      {/* The owner's way to a new letter is one small key at the end of the title line, which opens a window
          (Luke, 2026-11-15); the field that stood open under the list is gone. */}
      <div className="title-line text-accent-ink">
        <h2 id="profile-letters">LETTERS</h2>
        {owner ? <NewLetterKey owner={userId} /> : null}
      </div>
      {/* Someone signed in can carry a letter to a person: the side panel's rows and the characters on screen light up, and
          letting go on one sends it at once (Luke, 2026-11-14). The layer draws the carried envelope and does the sending. */}
      {me !== null ? <LetterDragLayer me={me} onSaid={setSaid} /> : null}
      {said ? (
        <p role="status" className="px-2 pt-1 text-label text-ink">
          {said}
        </p>
      ) : null}
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
              {...letterDraggable(() => (me === null ? null : { letter, barred: [me, letter.owner] }))}
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
    </section>
  );
}

const closedOnServer = () => false;

/**
 * `[ + NEW LETTER ]`: the one key that starts a letter, and the window it opens (Luke, 2026-11-15: "turn the part
 * where you make a new leetter on the profile page into a simple expandable add button which then opens a window").
 *
 * The key says a window is what it opens and whether that window is open (`aria-haspopup`, `aria-expanded`: the site's
 * one "this is open" look, and what the top bar's undo arrows step). The window's state is in its own small store, so
 * opening it redraws this key and the window and nothing else on the profile. Leaving the page shuts it.
 */
function NewLetterKey({ owner }: { owner: string }) {
  const open = useSyncExternalStore(subscribeToNewLetterWindow, newLetterWindowOpen, closedOnServer);
  useEffect(() => closeNewLetter, []);
  return (
    <>
      <button
        type="button"
        onClick={() => (open ? closeNewLetter() : openNewLetter())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={PLATE}
        data-new-letter-key
      >
        [ + NEW LETTER ]
      </button>
      {open ? <NewLetterWindow owner={owner} /> : null}
    </>
  );
}

/**
 * The NEW LETTER window: a name, and one key that makes the letter and opens it, exactly as the field on the page did.
 * What a letter is and how it is saved are untouched (`createLetter`). ESC, the `×` and a press outside it put it away
 * with nothing made.
 */
function NewLetterWindow({ owner }: { owner: string }) {
  const [name, setName] = useState('');
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <PopoutWindow title="NEW LETTER" onClose={closeNewLetter} maxWidth="max-w-md" centred>
      <form
        className="flex flex-col gap-2 text-ink"
        data-new-letter-window
        onSubmit={(event) => {
          event.preventDefault();
          const named = name.trim();
          if (named.length === 0 || busy) return;
          setBusy(true);
          setFault(null);
          createLetter(owner, named).then(
            (letter) => {
              closeNewLetter();
              openLetter(letter.id);
            },
            (failure: unknown) => {
              setFault(failure instanceof Error ? failure.message : 'The letter could not be made.');
              setBusy(false);
            },
          );
        }}
      >
        <label htmlFor="new-letter-name" className="text-label font-bold">
          NAME
        </label>
        <input
          id="new-letter-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={LETTER_NAME_MAX}
          autoComplete="off"
          autoFocus
          className={`${FIELD_TIGHT} w-full min-w-0`}
        />
        {fault ? (
          <p role="status" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
            {fault}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button type="submit" className={PLATE_MAIN} disabled={busy || name.trim().length === 0}>
            MAKE LETTER
          </button>
        </div>
      </form>
    </PopoutWindow>
  );
}
