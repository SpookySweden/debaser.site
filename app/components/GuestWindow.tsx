'use client';

import { useState } from 'react';
import { FIELD_TIGHT, PLATE_MAIN } from '../lib/ui/controls';
import { GUEST_NAME_MAX, guestNameLooksRight } from '../lib/watch/rules';
import type { RoomGuest } from '../lib/watch/types';
import { nameRoomGuest } from '../lib/watch/use-room-guest';
import AccountForms from './AccountForms';
import PopoutWindow from './PopoutWindow';

/**
 * What opens the first time somebody without an account does something that needs a name (SPEC-guests.md, Luke 2026-11-06): on the left, log in or create
 * an account; on the right, a name for a temporary guest. The database has the last word on a name. Logging in closes this from outside, once the
 * account has landed; a phone stacks the two, left side first.
 */
export default function GuestWindow({ onNamed, onClose }: { onNamed: (guest: RoomGuest) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  async function pick() {
    if (!guestNameLooksRight(name)) {
      setFault(`A NAME IS 2 TO ${GUEST_NAME_MAX} LETTERS OR NUMBERS. SPACES, - AND _ ARE FINE.`);
      return;
    }
    setBusy(true);
    setFault(null);
    try {
      const { answer, guest } = await nameRoomGuest(name);
      if (answer === 'named' && guest !== null) {
        onNamed(guest);
        return;
      }
      setFault(answer === 'taken' ? 'SOMEBODY ALREADY HAS THAT NAME.' : answer === 'bad' ? 'THAT NAME IS NOT ALLOWED. TRY ANOTHER.' : 'THAT DID NOT WORK.');
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THAT DID NOT WORK.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="WHO IS SPEAKING?" onClose={onClose} maxWidth="max-w-4xl">
      <div className="grid gap-3 p-2 text-label text-ink sm:grid-cols-2" data-guest-window>
        <section className="min-w-0" data-guest-window-account>
          <h2 className="text-title font-bold">LOG IN OR CREATE AN ACCOUNT</h2>
          <AccountForms stacked />
        </section>
        <section className="flex min-w-0 flex-col gap-2" data-guest-window-guest>
          <h2 className="text-title font-bold">OR BE A GUEST</h2>
          <p>
            A TEMPORARY NAME FOR THIS BROWSER. IT SHOWS WITH [GUEST] AFTER IT. GUESTS CAN TALK IN STREAMS. GOING LIVE, THE QUEUE AND DRAWING NEED AN ACCOUNT.
          </p>
          <form
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void pick();
            }}
          >
            <label className="flex min-w-0 flex-col gap-1 font-bold">
              YOUR NAME
              <input
                value={name}
                maxLength={GUEST_NAME_MAX}
                autoComplete="off"
                autoFocus
                onChange={(event) => setName(event.target.value)}
                className={`${FIELD_TIGHT} min-w-0 font-normal`}
                data-guest-name
              />
            </label>
            <div>
              <button type="submit" className={PLATE_MAIN} disabled={busy || name.trim().length === 0} data-guest-name-save>
                {busy ? '[ JUST A MOMENT... ]' : '[ SPEAK AS A GUEST ]'}
              </button>
            </div>
            {fault === null ? null : (
              <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert" data-guest-name-fault>
                {fault}
              </p>
            )}
          </form>
        </section>
      </div>
    </PopoutWindow>
  );
}
