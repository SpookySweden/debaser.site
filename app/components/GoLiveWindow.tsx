'use client';

import { useState } from 'react';
import type { AccountUser } from '../lib/auth/types';
import type { ForumAnchor } from '../lib/forum/types';
import { PLATE_MAIN } from '../lib/ui/controls';
import { goLiveEmpty } from '../lib/watch/go-live';
import type { RoomPrivacy } from '../lib/watch/types';
import PopoutWindow from './PopoutWindow';
import RoomPrivacyPicker from './RoomPrivacyPicker';

/**
 * GO LIVE's two presses (SPEC-privacy-phase-2.md): the key opens this, with PRIVATE already picked, and `[ START ]` starts the room.
 * The choice has to be made here because the room does not exist until START.
 */
export default function GoLiveWindow({
  user,
  createThread,
  onClose,
}: {
  user: AccountUser;
  createThread: (input: { title: string; body: string; anchor: ForumAnchor }) => Promise<{ id: string }>;
  onClose: () => void;
}) {
  const [privacy, setPrivacy] = useState<RoomPrivacy>('private');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const waiting = privacy === 'password' && password.length === 0;

  async function start() {
    setBusy(true);
    setFault(null);
    try {
      await goLiveEmpty(user, createThread, { privacy, ...(privacy === 'password' ? { password } : {}) });
      onClose();
    } catch (failure) {
      setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT START.');
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="GO LIVE" onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3 p-2 text-label text-ink"
        onSubmit={(event) => {
          event.preventDefault();
          if (!waiting && !busy) void start();
        }}
        data-go-live-window
      >
        <RoomPrivacyPicker value={privacy} onChange={setPrivacy} password={password} onPassword={setPassword} autoFocus />
        <p>
          {privacy === 'open'
            ? 'ANYONE CAN WATCH AND TALK. IT IS LISTED AND GETS A THREAD ON THE BOARD.'
            : privacy === 'password'
              ? 'PEOPLE NEED THE ROOM LINK AND THE PASSWORD. NOT LISTED, AND NOTHING ON THE BOARD.'
              : 'PEOPLE NEED THE ROOM LINK. NOT LISTED, AND NOTHING ON THE BOARD.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={PLATE_MAIN} disabled={waiting || busy} data-go-live-start>
            {busy ? '[ GOING LIVE... ]' : '[ START ]'}
          </button>
          {fault === null ? null : (
            <span className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
              {fault}
            </span>
          )}
        </div>
      </form>
    </PopoutWindow>
  );
}
