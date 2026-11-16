import { playedSinceCleared } from './music-rooms';
import { openWatch } from './watch-window';
import { createWindowSlot } from '../ui/window-slot';
import type { WatchQueueEntry, WatchRoomRead } from './types';

/**
 * Going back in a room (ROOMSYNC, Luke 2026-11-16: "make it so you can click on a previous thing in the queue to play it
 * again, and the back arrow on the bottom player to go back to it and the loop button to loop it").
 *
 * The queue draws what played in the order it played. Playing an earlier row again moves the room's pointer back onto
 * that row, where it stands in the list: nothing is copied and nothing is re-ordered, so the record stays what played.
 * When it ends, the room carries on with what is still queued, as it always does.
 */

/**
 * What the host's back arrow starts: the row played just before what is on now, in the list as the queue draws it. On a
 * black screen, the last thing that played. Null when nothing played before it: then what is on starts from the top.
 */
export function previousPlay(read: Pick<WatchRoomRead, 'room' | 'queue'>): WatchQueueEntry | null {
  const played = playedSinceCleared(read);
  const current = read.room.currentEntryId;
  if (current === null) return played[played.length - 1] ?? null;
  const at = played.findIndex((entry) => entry.id === current);
  return at > 0 ? played[at - 1] : null;
}

/* --- a press on a row in the queue window ------------------------------------------------------------------------ */

/** The room's own way to play a row again, while its window is drawn and you host it (`WatchRoom.tsx`). */
type HostReplay = { roomId: string; replay: (entryId: string) => void };
const slot = createWindowSlot<HostReplay | null>(null);
export const roomReplayState = slot.state;
export const subscribeToRoomReplay = slot.subscribe;
export const serverRoomReplay = (): HostReplay | null => null;

/** A press made while the room's window was not drawn: played once the room has opened and says it can. */
let pending: { roomId: string; entryId: string; at: number } | null = null;
/** A press older than this is forgotten rather than played long after (the room never opened for it). */
const PENDING_MS = 20_000;

/** Set by the room's window while you host it; returns the way to take it back. Plays a press that was waiting for it. */
export function registerRoomReplay(roomId: string, replay: (entryId: string) => void): () => void {
  const mine: HostReplay = { roomId, replay };
  slot.set(mine);
  if (pending !== null && pending.roomId === roomId) {
    const waiting = pending;
    pending = null;
    if (Date.now() - waiting.at < PENDING_MS) replay(waiting.entryId);
  }
  return () => {
    if (slot.state() === mine) slot.set(null);
  };
}

/**
 * Plays `entryId` again in `roomId`: at once when its window is drawn, otherwise the window is opened (your own room, from
 * the queue window's UP NEXT) and it plays as soon as the room is read.
 */
export function replayInRoom(roomId: string, entryId: string): void {
  const host = slot.state();
  if (host !== null && host.roomId === roomId) {
    host.replay(entryId);
    return;
  }
  pending = { roomId, entryId, at: Date.now() };
  openWatch({ kind: 'room', roomId });
}
