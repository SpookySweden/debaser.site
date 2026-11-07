/**
 * A TMDB title to find a source for in a room (SPEC-media-servers.md; Luke, 2026-11-07): the media tab's FIND IN ROOM,
 * for a title no media server holds. As the room opens (or at once, when it is already open), it opens its queue with
 * this title searched — FIND TO PLAY — so a real, playable source can be queued. No database: nothing unplayable is
 * ever stored. Memory only, consumed once by the room it names.
 */

type Pending = { roomId: string; title: string };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

/** Ask the room `roomId`, as it next reads, to open its queue searching for `title`. */
export function noteFindInRoom(roomId: string, title: string): void {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (clean.length === 0) return;
  pending = { roomId, title: clean };
  for (const listener of listeners) listener();
}

/** The title to find in `roomId`, if one is waiting; taking it clears it, so it opens the queue once. */
export function takeFindInRoom(roomId: string): string | null {
  if (pending === null || pending.roomId !== roomId) return null;
  const { title } = pending;
  pending = null;
  return title;
}

/** Called whenever a find is noted, so an already-open room can act on it. Returns an unsubscribe. */
export function subscribeFindInRoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
