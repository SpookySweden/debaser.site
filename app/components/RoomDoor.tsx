'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FIELD_TIGHT, PLATE, PLATE_MAIN } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { getWatchRepository } from '../lib/watch/repository';
import { ROOM_PASSWORD_MAX } from '../lib/watch/rules';
import type { JoinAnswer, RoomDoor as Door } from '../lib/watch/types';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { useAuth } from './AuthProvider';

const line = 'text-label font-bold text-ink';

/**
 * What somebody sees who opens the link of a room they cannot read yet (SPEC-privacy-phase-2.md): `JOIN <ROOM NAME>?`, and the
 * password if it has one. Pressing JOIN is what makes them a member. The database answers all of it (`watch_room_door`, `watch_join`).
 */
export default function RoomDoor({ roomId }: { roomId: string }) {
  const { user, status } = useAuth();
  const userId = user?.id ?? null;
  const [door, setDoor] = useState<Door | null>(null);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [answer, setAnswer] = useState<JoinAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(30000);

  useEffect(() => {
    if (status === 'loading') return;
    let alive = true;
    void getWatchRepository()
      .readDoor(roomId)
      .then((read) => {
        if (alive) setDoor(read);
      })
      .catch(() => {
        if (alive) setDoor({ found: false, live: false, privacy: null, title: null, member: false, removed: false, lockedUntil: null });
      });
    return () => {
      alive = false;
    };
  }, [roomId, status, userId]);

  async function join() {
    setBusy(true);
    try {
      const said = await getWatchRepository().enterRoom(roomId, door?.privacy === 'password' ? password : null);
      setAnswer(said);
      setPassword('');
      // In: the room reads again, and now answers. Anything else: the door says why.
      if (said === 'joined') applyLocalChange(roomId, { kind: 'refresh' });
      else setDoor(await getWatchRepository().readDoor(roomId));
    } catch {
      setAnswer('refused');
    } finally {
      setBusy(false);
    }
  }

  if (door === null) return <p className={line}>READING THE STREAM...</p>;
  if (!door.found) return <p className={line}>NO SUCH STREAM.</p>;
  if (door.removed || answer === 'removed') return <p className={line} data-room-door="removed">YOU WERE REMOVED FROM THIS STREAM.</p>;
  if (!door.live) return <p className={line} data-room-door="ended">THIS STREAM HAS ENDED.</p>;
  if (userId === null) {
    return (
      <p className={line} data-room-door="signed-out">
        THIS STREAM IS PRIVATE.{' '}
        <Link href="/account" className="key px-1 py-1 text-label">
          [ LOG IN ]
        </Link>{' '}
        TO JOIN
      </p>
    );
  }
  if (door.lockedUntil !== null) {
    const minutes = Math.max(1, Math.ceil((Date.parse(door.lockedUntil) - now) / 60000));
    return (
      <p className={line} role="alert" data-room-door="locked">
        TOO MANY WRONG TRIES. TRY AGAIN IN {minutes} {minutes === 1 ? 'MINUTE' : 'MINUTES'}.
      </p>
    );
  }

  const needsPassword = door.privacy === 'password';

  return (
    <form
      noValidate
      className="flex max-w-prose flex-col gap-2 text-label text-ink"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && (!needsPassword || password.length > 0)) void join();
      }}
      data-room-door={door.privacy ?? ''}
    >
      <p className="text-title font-bold">JOIN {(door.title ?? 'THIS ROOM').toUpperCase()}?</p>
      {needsPassword ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 font-bold">
            PASSWORD
            <input
              type={shown ? 'text' : 'password'}
              value={password}
              maxLength={ROOM_PASSWORD_MAX}
              autoComplete="off"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              className={`${FIELD_TIGHT} min-w-0 font-normal`}
              data-room-door-password
            />
          </label>
          <button type="button" className={`${PLATE} max-sm:min-h-tap`} aria-pressed={shown} onClick={() => setShown((was) => !was)}>
            {shown ? '[ HIDE ]' : '[ SHOW ]'}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={PLATE_MAIN} disabled={busy || (needsPassword && password.length === 0)} data-room-door-join>
          {busy ? '[ JOINING... ]' : '[ JOIN ]'}
        </button>
        {answer === 'wrong' ? (
          <span className="bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
            WRONG PASSWORD.
          </span>
        ) : answer === 'refused' ? (
          <span className="bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
            THAT DID NOT WORK.
          </span>
        ) : null}
      </div>
    </form>
  );
}
