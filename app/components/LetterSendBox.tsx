'use client';

import { useState } from 'react';
import type { Letter, LetterItem } from '../lib/letters/types';
import { letterNote, sendLetterTo, sentLine } from '../lib/recommendations/send-letter';
import { RECOMMENDATION_MESSAGE_MAX, RECOMMENDATION_PEOPLE_MAX } from '../lib/recommendations/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
import LetterStamp from './LetterStamp';
import PopoutWindow from './PopoutWindow';
import ProfileName from './ProfileName';

/**
 * SEND TO, from an opened letter (SPEC-letter-drag.md; Luke, 2026-11-14, Q4: "SEND TO in letter"): the way to recommend a
 * whole letter without dragging it. Pick one or more people (the names can be searched), add a line if you like, SEND.
 * It is the keyboard's way, the way to add a note, and the way to reach someone who isn't in the side panel's short list.
 * The people are the ones every list on the site shows, less yourself and the letter's own owner.
 */
export default function LetterSendBox({
  letter,
  items,
  me,
  onClose,
  onSent,
}: {
  letter: Letter;
  items: readonly LetterItem[];
  me: string;
  onClose: () => void;
  onSent: (said: string) => void;
}) {
  const { accounts, allAccounts } = useComms();
  const [find, setFind] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  // A public letter of somebody else's is passed on under their name; your own carries only what you write.
  const ownerName = letter.owner === me ? null : (allAccounts.find((account) => account.id === letter.owner)?.displayName ?? '');
  const noteRoom = RECOMMENDATION_MESSAGE_MAX - letterNote('', ownerName).length - (ownerName === null ? 0 : 2);
  const wanted = find.trim().toLowerCase();
  const people = accounts.filter((account) => account.id !== me && account.id !== letter.owner);
  const shown = wanted.length === 0 ? people : people.filter((account) => account.displayName.toLowerCase().includes(wanted) || to.includes(account.id));

  const send = async () => {
    if (to.length === 0 || busy) return;
    setBusy(true);
    setFault(null);
    try {
      const sender = { id: me, name: allAccounts.find((account) => account.id === me)?.displayName ?? '' };
      const sent = await sendLetterTo({ letter, items, to, note, ownerName, sender });
      const names = to.map((id) => people.find((account) => account.id === id)?.displayName ?? 'SOMEONE');
      onSent(sentLine(letter.name, names, sent.left));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The letter could not be sent.');
      setBusy(false);
    }
  };

  return (
    <PopoutWindow
      title="SEND TO"
      onClose={onClose}
      maxWidth="max-w-md"
      centred
      actions={
        <>
          <button type="button" onClick={onClose} className={PLATE} disabled={busy}>
            [ CANCEL ]
          </button>
          <button type="button" onClick={() => void send()} className={PLATE_MAIN} disabled={busy || to.length === 0}>
            SEND
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <p className="flex items-center gap-1.5 text-label text-ink">
          <LetterStamp letter={letter} />
          <span className="min-w-0 break-words">{letter.name}</span>
        </p>
        <input
          type="search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="FIND A PERSON"
          aria-label="Find a person"
          className={FIELD_TIGHT}
        />
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" aria-label="People">
          {shown.length === 0 ? <li className="text-label text-ink">NOBODY BY THAT NAME.</li> : null}
          {shown.map((person) => {
            const picked = to.includes(person.id);
            return (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-2 text-label max-sm:min-h-tap">
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={!picked && to.length >= RECOMMENDATION_PEOPLE_MAX}
                    onChange={() => setTo((held) => (picked ? held.filter((id) => id !== person.id) : [...held, person.id]))}
                  />
                  <ProfileName author={{ id: person.id, displayName: person.displayName }} />
                </label>
              </li>
            );
          })}
        </ul>
        <input
          type="text"
          value={note}
          maxLength={Math.max(0, noteRoom)}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="A NOTE (OPTIONAL)"
          aria-label="A note to go with it"
          className={FIELD_TIGHT}
        />
        {ownerName !== null ? <p className="text-label text-ink-quiet">{letterNote('', ownerName)}</p> : null}
        {fault ? (
          <p role="status" className="bg-bubble-pale px-2 py-1 text-label text-ink-bar">
            {fault}
          </p>
        ) : null}
      </div>
    </PopoutWindow>
  );
}
