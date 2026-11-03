'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PLATE, PLATE_LINK } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { getWatchRepository } from '../lib/watch/repository';
import { hasCrown, nextQueuePosition, roomIsLive } from '../lib/watch/rules';
import { applyLocalChange, useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { useAuth } from './AuthProvider';

/** Where GO LIVE is (SPEC-cytube.md): the only place a room is started. */
export const CYTUBE_HREF = '/cytube';

/**
 * A catalogue video's stream key (SPEC-cytube.md). GO LIVE is only on the CYTUBE page now, so this key never
 * starts a room: while you host a live room (or hold a crown in one) it adds the video straight to that room's
 * queue, `[ + QUEUE ]`; otherwise it points you to CYTUBE to go live. Signed-in people only (the caller asks).
 */
export default function StreamAddKey({ mediaItemId, title }: { mediaItemId: string; title: string }) {
  const { user } = useAuth();
  const watching = useWatching(user?.id ?? null);
  const roomId = watching?.roomId ?? null;
  const { read } = useWatchRoom(roomId, { follow: false });
  const now = useNow(5000);
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'refused'>('idle');
  const crowned = user !== null && read !== undefined && read !== null && roomIsLive(read.room, now) && (read.room.hostId === user.id || hasCrown(read.crowns, user.id));

  if (!crowned || roomId === null || read === undefined || read === null || user === null) {
    return (
      <Link href={CYTUBE_HREF} className={PLATE_LINK} title="Go live on CYTUBE, then add this to your room" aria-label={`Stream "${title}": go live on CYTUBE first`}>
        [ ▶ CYTUBE ]
      </Link>
    );
  }

  async function add() {
    if (user === null || roomId === null || read === undefined || read === null) return;
    setState('busy');
    try {
      const entry = await getWatchRepository().addToQueue({ roomId, mediaItemId, addedBy: user.id, position: nextQueuePosition(read.queue), inQueue: true });
      applyLocalChange(roomId, { kind: 'entry', entry });
      setState('queued');
    } catch {
      setState('refused');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={state === 'busy' || state === 'queued'}
      className={PLATE}
      aria-label={`Add "${title}" to the queue of the room you are in`}
      data-stream-add={state}
    >
      {state === 'queued' ? '[ QUEUED ]' : state === 'refused' ? '[ NOT ADDED - AGAIN? ]' : '[ + QUEUE ]'}
    </button>
  );
}
