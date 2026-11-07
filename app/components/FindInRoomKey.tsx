'use client';

import { useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { noteFindInRoom } from '../lib/watch/find-in-room';
import { roomIsLive } from '../lib/watch/rules';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { openWatch } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';

/**
 * A TMDB title no media server holds (SPEC-media-servers.md; Luke, 2026-11-07): find a source for it in a room. It
 * can't be queued on its own — there is nothing to play yet — so instead of a dead queue entry it gets you to FIND TO
 * PLAY. In a room already, it opens that room's queue searched for the title; otherwise it opens GO LIVE to start one,
 * which then does the same as the room comes up (find-in-room.ts). Accounts only.
 */
export default function FindInRoomKey({ title }: { title: string }) {
  const { user } = useAuth();
  const forum = useForum();
  const watching = useWatching(user?.id ?? null);
  const roomId = watching?.roomId ?? null;
  const { read, error } = useWatchRoom(roomId, { follow: false });
  const now = useNow(5000);
  const [asking, setAsking] = useState(false);

  if (user === null) return null;

  /** A room's answer isn't here yet: wait rather than offer to start a second room. */
  const waiting = roomId !== null && read === undefined && error === null;
  const inRoom = waiting || (roomId !== null && read !== undefined && read !== null && roomIsLive(read.room, now));

  if (inRoom && roomId !== null) {
    return (
      <button
        type="button"
        className={PLATE}
        disabled={waiting}
        onClick={() => {
          noteFindInRoom(roomId, title);
          openWatch({ kind: 'room', roomId });
        }}
        aria-label={`Find a source for "${title}" in the room you are in`}
        data-find-in-room="add"
      >
        [ FIND IN ROOM ]
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={PLATE}
        aria-haspopup="dialog"
        aria-expanded={asking}
        onClick={() => setAsking(true)}
        aria-label={`Find "${title}" in a room: opens the room's settings`}
        data-find-in-room="start"
      >
        [ FIND IN ROOM ]
      </button>
      {asking ? <GoLiveWindow user={user} createThread={forum.createThread} findToPlay={title} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
