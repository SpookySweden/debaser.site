'use client';

import { useState, type FormEvent } from 'react';
import { addThing } from '../lib/letters/store';
import { isWebAddress } from '../lib/letters/things';
import { LETTER_TITLE_MAX } from '../lib/letters/types';
import { FIELD_TIGHT, PLATE } from '../lib/ui/controls';

/**
 * Any web address, pasted into a letter (SPEC-letters.md): a plain link card with the title the person gives it, or the
 * address's own site name. Nothing is read from the page itself (CLAUDE.md: never parse HTML pages).
 */
export default function LetterLinkForm({ letterId }: { letterId: string }) {
  const [address, setAddress] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ref = address.trim();
    if (!isWebAddress(ref)) {
      setNote('THAT ISN\'T A WEB ADDRESS. IT STARTS WITH https://');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const named = title.trim() || new URL(ref).hostname;
      const added = await addThing(letterId, { kind: 'link', ref, title: named.slice(0, LETTER_TITLE_MAX) });
      setNote(added === 'already' ? 'THAT LINK IS ALREADY ON THIS LETTER.' : 'ADDED.');
      if (added !== 'already') {
        setAddress('');
        setTitle('');
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-1" aria-label="Add a link to this letter">
      <input
        type="url"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="PASTE A LINK"
        aria-label="Link address"
        maxLength={500}
        className={`${FIELD_TIGHT} min-w-0 flex-1 basis-40`}
      />
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="ITS TITLE (OPTIONAL)"
        aria-label="Link title"
        maxLength={LETTER_TITLE_MAX}
        className={`${FIELD_TIGHT} min-w-0 flex-1 basis-32`}
      />
      <button type="submit" className={PLATE} disabled={busy}>
        [ + ADD LINK ]
      </button>
      {note ? (
        <span role="status" className="w-full text-label text-ink">
          {note}
        </span>
      ) : null}
    </form>
  );
}
