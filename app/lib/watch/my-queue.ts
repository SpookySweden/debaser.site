import { ownRoomState } from './own-room-client';
import { soloRefusal } from './own-screen';
import { getWatchRepository } from './repository';
import { nextQueuePosition, queueRights, roomIsLive } from './rules';
import type { WatchLink } from './types';
import { applyLocalChange } from './use-watch-room';
import { watchWindowState } from './watch-window';

/**
 * **The one place that says what "+ QUEUE" means** (SPEC-rooms-queues.md, Luke's answer 7A: a MEDIA row's key reads
 * PLAY / + QUEUE).
 *
 * A thing goes onto the queue of the room you are in, when you are in a live one and may add there (what ADD TO ROOM
 * did, by the crown rule: with a crown straight into the queue, otherwise onto your own list). Everywhere else it
 * goes onto your own room's queue: kept on your account, or in this browser for a signed-out visitor. Songs and
 * videos alike; nothing is fetched or copied, only the link (or the site's own file) is filed.
 */

/** Something that can be queued: a checked link (`watchLinkForItem`, `songLink`), or one of the site's own files. */
/** `webRef`: the MEDIA or KINO result it came from, kept on a room's queue item for its DISCUSS page (SPEC-room-chat-discuss.md). */
export type QueueThing = { title: string; link: WatchLink; mediaItemId?: undefined; webRef?: string } | { title: string; mediaItemId: string; link?: undefined; webRef?: undefined };

/** Where it went: `queued` into a queue, `listed` onto your own list in somebody's room (a crown pulls it in). */
export type QueuedAs = { as: 'queued' | 'listed'; where: 'own' | 'room'; roomId: string };

export const NO_ROOM_YET = 'YOUR ROOM IS NOT READY YET. TRY AGAIN IN A MOMENT.';

/** The live room this tab is in and this person may add to, or null. */
async function roomToAddTo(userId: string | null): Promise<{ roomId: string; inQueue: boolean; position: number } | null> {
  const focus = watchWindowState().focus;
  if (userId === null || focus === null || focus.kind !== 'room') return null;
  const own = ownRoomState();
  if (focus.roomId === own.roomId) return null;
  const fresh = await getWatchRepository().readRoom(focus.roomId);
  if (fresh === null || fresh.room.origin !== 'stream' || !roomIsLive(fresh.room, Date.now())) return null;
  const rights = queueRights(fresh.room, fresh.crowns, userId, true);
  if (!rights.add) return null;
  return { roomId: focus.roomId, inQueue: rights.addsTo === 'queue', position: nextQueuePosition(fresh.queue) };
}

/**
 * Adds a thing to the end of the queue. `userId` is the signed-in account, or null for a visitor. Throws an Error whose
 * message is fit to show (a full queue, a kind that only plays in a live room).
 */
export async function addToMyQueue(thing: QueueThing, userId: string | null): Promise<QueuedAs> {
  const room = await roomToAddTo(userId).catch(() => null);
  if (room !== null && userId !== null) {
    const what = thing.link !== undefined ? { link: thing.link, ...(thing.webRef === undefined ? {} : { webRef: thing.webRef }) } : { mediaItemId: thing.mediaItemId };
    const entry = await getWatchRepository().addToQueue({ roomId: room.roomId, addedBy: userId, position: room.position, inQueue: room.inQueue, ...what });
    applyLocalChange(room.roomId, { kind: 'entry', entry });
    return { as: room.inQueue ? 'queued' : 'listed', where: 'room', roomId: room.roomId };
  }

  const { session, roomId } = ownRoomState();
  if (session === null || roomId === null) throw new Error(NO_ROOM_YET);
  if (thing.link !== undefined) {
    const refusal = soloRefusal(thing.link);
    if (refusal !== null) throw new Error(refusal);
    session.enqueue(thing.link, 'end');
  } else {
    session.enqueueFile(thing.mediaItemId, 'end');
  }
  return { as: 'queued', where: 'own', roomId };
}

/** Whether "+ QUEUE" would go to a live room right now (the key's tip says which queue it means). */
export function queueIsALiveRoom(): boolean {
  const focus = watchWindowState().focus;
  return focus !== null && focus.kind === 'room' && focus.roomId !== ownRoomState().roomId;
}
