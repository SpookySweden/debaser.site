'use client';

import { useState, type ReactNode } from 'react';
import { PLATE, PLATE_PRESSED } from '../lib/ui/controls';
import { explain } from '../lib/ui/explain';
import { placeOf, type RoomSource } from '../lib/ui/floating-player';
import { useNow } from '../lib/ui/use-now';
import type { RoomSeries } from '../lib/watch/go-live';
import { goLiveInMainRoom, playInMainRoom } from '../lib/watch/main-room-play';
import { ownRoomState } from '../lib/watch/own-room-client';
import { getWatchRepository } from '../lib/watch/repository';
import { nextQueuePosition, queueRights, roomIsLive } from '../lib/watch/rules';
import { applyLocalChange, useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { openWatch } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import GoLiveKey from './GoLiveKey';

/**
 * A video's way into a room (SPEC-floating-player.md, part 3): one key, which reads for the situation. It replaced `[ WATCH ]`
 * and `[ ▶ STREAM ]`.
 *
 * - Not in a room you can add to: `[ WATCH IN ROOM ]`. One press puts it on in your own always-on room, from where you had
 *   got to, and opens that room on WHO CAN JOIN (PRIVATE picked), as `[ GO LIVE ]` does (SPEC-rooms-perpetual.md, list 3):
 *   START there announces the room, CANCEL keeps it private, so a stray press posts nothing. No separate room is made.
 * - In one you can add to: `[ ADD TO ROOM ]`. One press puts it at the back: of the queue with a crown, or of your own list without.
 *
 * Accounts only. The caller draws it only for a video that can play in a room, so there is never a dead key.
 *
 * On the floating player (`live`) the first reading is `[ GO LIVE ]` instead (SPEC-rooms-queues.md, phase 3): the same
 * key as the bar's, which takes the video on the screen and your queue into the room it starts.
 */

type AddState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'loading' } | { kind: 'added'; roomId: string; listed: boolean; note: string | null } | { kind: 'refused'; roomId: string; reason: string };

/** How long the key says it worked, before it can add the video again. */
const ADDED_MS = 5000;

/**
 * What the key reads and does, without drawing it: the same key as `WatchInRoomKey`, for a caller that draws it as half of
 * a key of two halves (QueueHalf.tsx, MEDIA's PLAY / + QUEUE). `after` is what follows the key: the room's settings window,
 * OPEN ROOM, a note or a refusal. Null for a visitor, or with no `source`.
 */
export type RoomKey = {
  mode: 'start' | 'add';
  /** The key's words, without brackets. */
  words: string;
  label: string;
  press: () => void;
  disabled: boolean;
  /** The room's settings window is open (start only). */
  open: boolean;
  /** `data-watch-in-room`: start, add, queued or listed. */
  data: string;
  after: ReactNode;
};

export default function WatchInRoomKey(props: { source: RoomSource; series?: RoomSeries; playId: string; title: string; onPress?: () => void; live?: boolean }) {
  const key = useRoomKey(props);
  if (key === null) return null;
  // The floating player's key (`live`): outside a room it is GO LIVE, which carries this video in as what is on.
  if (key.mode === 'start' && props.live === true) return <GoLiveKey screenFirst />;
  if (key.mode === 'start') {
    return (
      <>
        <button type="button" onClick={key.press} aria-haspopup="dialog" aria-expanded={key.open} aria-label={key.label} {...explain(key.mode === 'start' ? 'Puts this on in your room and asks who can join.' : 'Adds this to the room you are in.', key.mode === 'start' ? 'Your room plays it for you, and for whoever you let in. Nothing is shared until you choose who can join.' : 'It goes in the room\'s queue; everyone in the room sees it there.')} className={key.open ? PLATE_PRESSED : PLATE} data-watch-in-room={key.data}>
          {`[ ${key.words} ]`}
        </button>
        {key.after}
      </>
    );
  }
  return (
    <>
      <button type="button" onClick={key.press} disabled={key.disabled} aria-label={key.label} {...explain(key.mode === 'start' ? 'Puts this on in your room.' : 'Adds this to the room you are in.', key.mode === 'start' ? 'Your room plays it for you, and for whoever you let in.' : 'It goes in the room\'s queue, where everyone in the room sees it.', key.mode === 'start' ? undefined : 'OTHERS IN THE ROOM SEE IT.')} className={PLATE} data-watch-in-room={key.data}>
        {`[ ${key.words} ]`}
      </button>
      {key.after}
    </>
  );
}

export function useRoomKey({ source, series, playId, title, onPress }: { source: RoomSource | undefined; series?: RoomSeries; playId: string; title: string; onPress?: () => void }): RoomKey | null {
  const { user } = useAuth();
  const watching = useWatching(user?.id ?? null);
  const roomId = watching?.roomId ?? null;
  const { read, error } = useWatchRoom(roomId, { follow: false });
  const now = useNow(5000);
  const [state, setState] = useState<AddState>({ kind: 'idle' });

  if (user === null || source === undefined) return null;
  const known: RoomSource = source;

  /** A room's answer isn't here yet: the key waits rather than offering to start a second room. */
  const waiting = roomId !== null && read === undefined && error === null;
  const adds = waiting || (roomId !== null && read !== undefined && read !== null && queueRights(read.room, read.crowns, user.id, roomIsLive(read.room, now)).add);

  /**
   * Into your own always-on room (SPEC-rooms-perpetual.md): this video on now, from where you had got to, and the room opened
   * on WHO CAN JOIN. ALL (server-picks.ts) puts its first episode on and the rest at the end of your queue.
   */
  function watchInOwnRoom() {
    const [first, ...rest] = series === undefined ? [] : series.links;
    const on: RoomSource = first === undefined ? known : { link: first };
    const went = playInMainRoom(on.link !== undefined ? { link: on.link } : { mediaItemId: on.mediaItemId }, title, placeOf(playId));
    if (went === 'none') {
      setState({ kind: 'loading' });
      window.setTimeout(() => setState({ kind: 'idle' }), ADDED_MS);
      return;
    }
    // Somebody else's room is open: its small ask decides (Q2 A); WHO CAN JOIN is for your own room only.
    if (went !== 'room') return;
    if (rest.length > 0) ownRoomState().session?.enqueueAll(rest);
    goLiveInMainRoom();
  }

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
      else await repository.addToQueue({ roomId, addedBy: user.id, position: nextQueuePosition(fresh.queue), inQueue, ...known });
      applyLocalChange(roomId, { kind: 'refresh' });
      setState({ kind: 'added', roomId, listed: !inQueue, note: series?.note ?? null });
      // A short ALL (more episodes than fit at once) keeps saying so for longer.
      window.setTimeout(() => setState({ kind: 'idle' }), series?.note ? ADDED_MS * 4 : ADDED_MS);
    } catch (failure) {
      setState({ kind: 'refused', roomId, reason: failure instanceof Error ? failure.message : 'IT COULD NOT BE ADDED.' });
    }
  }

  if (!adds) {
    return {
      mode: 'start',
      words: 'WATCH IN ROOM',
      label: `Watch "${title}" in your room: puts it on there and asks who can join`,
      press: () => {
        onPress?.();
        watchInOwnRoom();
      },
      disabled: false,
      open: false,
      data: 'start',
      after:
        state.kind === 'loading' ? (
          <span role="status" className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
            YOUR ROOM IS STILL BEING READ. TRY AGAIN IN A MOMENT.
          </span>
        ) : null,
    };
  }

  const added = state.kind === 'added' && state.roomId === roomId;
  return {
    mode: 'add',
    words: state.kind === 'busy' ? 'ADDING...' : added ? (state.listed ? 'ON YOUR LIST' : 'QUEUED') : 'ADD TO ROOM',
    label: `Add "${title}" to the room you are in`,
    press: () => {
      onPress?.();
      void add();
    },
    disabled: waiting || state.kind === 'busy' || added,
    open: false,
    data: added ? (state.listed ? 'listed' : 'queued') : 'add',
    after: (
    <>
      {added ? (
        <button type="button" onClick={() => openWatch({ kind: 'room', roomId: state.roomId })} className={PLATE} {...explain('Opens the room you just added this to.', 'To see it in the queue and watch along.')}>
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
    ),
  };
}
