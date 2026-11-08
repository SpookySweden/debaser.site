'use client';

import { useState } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import type { RoomSource } from '../lib/ui/floating-player';
import { useNow } from '../lib/ui/use-now';
import type { RoomSeries } from '../lib/watch/go-live';
import { getWatchRepository } from '../lib/watch/repository';
import { nextQueuePosition, queueRights, roomIsLive } from '../lib/watch/rules';
import { applyLocalChange, useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { openWatch } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';

/**
 * A video's way into a room (SPEC-floating-player.md, part 3): one key, which reads for the situation. It replaced `[ WATCH ]`
 * and `[ ▶ STREAM ]`.
 *
 * - Not in a room you can add to: `[ WATCH IN ROOM ]`. One press opens the menu (WHO CAN JOIN, with PRIVATE picked), and START
 *   there makes the room, so a stray press posts nothing.
 * - In one you can add to: `[ ADD TO ROOM ]`. One press puts it at the back: of the queue with a crown, or of your own list without.
 *
 * Accounts only. The caller draws it only for a video that can play in a room, so there is never a dead key.
 */

type AddState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'added'; roomId: string; listed: boolean; note: string | null } | { kind: 'refused'; roomId: string; reason: string };

/** How long the key says it worked, before it can add the video again. */
const ADDED_MS = 5000;

export default function WatchInRoomKey({ source, series, playId, title, onPress }: { source: RoomSource; series?: RoomSeries; playId: string; title: string; onPress?: () => void }) {
  const { user } = useAuth();
  const forum = useForum();
  const watching = useWatching(user?.id ?? null);
  const roomId = watching?.roomId ?? null;
  const { read, error } = useWatchRoom(roomId, { follow: false });
  const now = useNow(5000);
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<AddState>({ kind: 'idle' });

  if (user === null) return null;

  /** A room's answer isn't here yet: the key waits rather than offering to start a second room. */
  const waiting = roomId !== null && read === undefined && error === null;
  const adds = waiting || (roomId !== null && read !== undefined && read !== null && queueRights(read.room, read.crowns, user.id, roomIsLive(read.room, now)).add);

  async function add() {
    if (user === null || roomId === null) return;
    setState({ kind: 'busy' });
    try {
      const repository = getWatchRepository();
      const fresh = await repository.readRoom(roomId);
      if (fresh === null || !roomIsLive(fresh.room, Date.now())) {
        setState({ kind: 'refused', roomId, reason: 'THAT ROOM IS NOT LIVE ANY MORE.' });
        return;
      }
      const rights = queueRights(fresh.room, fresh.crowns, user.id, true);
      if (!rights.add) {
        setState({ kind: 'refused', roomId, reason: 'ONLY A CROWN ADDS TO THAT ROOM.' });
        return;
      }
      const inQueue = rights.addsTo === 'queue';
      // ALL (server-picks.ts): every episode as one block, in one write, so nothing is ever half added.
      if (series !== undefined) await repository.addSeriesToQueue({ roomId, addedBy: user.id, position: nextQueuePosition(fresh.queue), inQueue, seriesTitle: series.title, links: series.links });
      else await repository.addToQueue({ roomId, addedBy: user.id, position: nextQueuePosition(fresh.queue), inQueue, ...source });
      applyLocalChange(roomId, { kind: 'refresh' });
      setState({ kind: 'added', roomId, listed: !inQueue, note: series?.note ?? null });
      // A short ALL (more episodes than fit at once) keeps saying so for longer.
      window.setTimeout(() => setState({ kind: 'idle' }), series?.note ? ADDED_MS * 4 : ADDED_MS);
    } catch (failure) {
      setState({ kind: 'refused', roomId, reason: failure instanceof Error ? failure.message : 'IT COULD NOT BE ADDED.' });
    }
  }

  if (!adds) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            onPress?.();
            setAsking(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={asking}
          aria-label={`Watch "${title}" in a room: opens the room's settings`}
          className={asking ? PLATE_PRESSED : PLATE}
          data-watch-in-room="start"
        >
          [ WATCH IN ROOM ]
        </button>
        {asking ? <GoLiveWindow user={user} createThread={forum.createThread} first={{ source, playId, title, ...(series === undefined ? {} : { series }) }} onClose={() => setAsking(false)} /> : null}
      </>
    );
  }

  const added = state.kind === 'added' && state.roomId === roomId;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onPress?.();
          void add();
        }}
        disabled={waiting || state.kind === 'busy' || added}
        aria-label={`Add "${title}" to the room you are in`}
        className={PLATE}
        data-watch-in-room={added ? (state.listed ? 'listed' : 'queued') : 'add'}
      >
        {state.kind === 'busy' ? '[ ADDING... ]' : added ? (state.listed ? '[ ON YOUR LIST ]' : '[ QUEUED ]') : '[ ADD TO ROOM ]'}
      </button>
      {added ? (
        <button type="button" onClick={() => openWatch({ kind: 'room', roomId: state.roomId })} className={PLATE}>
          [ OPEN ROOM ]
        </button>
      ) : null}
      {added && state.note !== null ? (
        <span role="status" className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" data-watch-in-room-note>
          {state.note}
        </span>
      ) : null}
      {state.kind === 'refused' && state.roomId === roomId ? (
        <span role="alert" className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
          {state.reason}
        </span>
      ) : null}
    </>
  );
}
