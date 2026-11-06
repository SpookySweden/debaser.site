'use client';

import { closeFloating, type RoomSource } from '../ui/floating-player';
import { getWatchRepository } from './repository';
import { noteRoomStart } from './room-start';
import { ROOM_NAME_MAX, ROOM_TOPIC_MAX, cleanRoomWords, streamAnchor, streamThreadTitle } from './rules';
import { primeRoom } from './use-watch-room';
import { openWatch } from './watch-window';
import type { ForumAnchor } from '../forum/types';
import type { RoomAddMode, RoomPrivacy, WatchQueueEntry } from './types';

/** `[ WATCH IN ROOM ]` (SPEC-floating-player.md, part 3): the room's words, and the video it starts with. */
export type RoomStart = {
  name: string;
  topic: string;
  addMode: RoomAddMode;
  first: RoomSource;
  /** Where the viewer had got to, when the player can tell. */
  place: number | null;
};

/**
 * GO LIVE, from the window behind the CYTUBE page's and the side panel's keys (SPEC-cytube.md; SPEC-privacy-phase-2.md): the
 * host's room opens **empty**, no file needed, its screen black with the three keys. Its forum record is filed as it starts; a room
 * that could not be filed is still a room (it says NOT ON THE BOARD). A private room's record is its members' (the database
 * stamps the thread), and everybody else gets it in bars. The room window opens over the page.
 *
 * With `start` (`[ WATCH IN ROOM ]`) it goes in the queue as the room opens, so the host's room starts it. The video the
 * viewer was watching stops here: the room's player is a new one, and it starts from where that one had got to. Words or a
 * video that fail to file leave an ordinary room, as a thread that fails to file does.
 *
 * Returns the room's id. Throws with a sentence fit to show.
 */
export async function goLiveEmpty(
  host: { id: string; displayName: string },
  createThread: (input: { title: string; body: string; anchor: ForumAnchor }) => Promise<{ id: string }>,
  choice: { privacy: RoomPrivacy; password?: string; start?: RoomStart },
): Promise<string> {
  const id = crypto.randomUUID();
  const repository = getWatchRepository();
  const read = await repository.openRoom({ id, host: { id: host.id, label: host.displayName }, mediaItemId: null, privacy: choice.privacy, ...(choice.password === undefined ? {} : { password: choice.password }) });
  primeRoom(read);
  let room = read.room;
  const queue: WatchQueueEntry[] = [];

  try {
    const thread = await createThread({ title: streamThreadTitle(host.displayName, read.room.startedAt), body: '', anchor: streamAnchor(id) });
    await repository.attachThread(id, thread.id);
    // Into the shared copy at once, so the room does not say NOT ON THE BOARD until the echo arrives.
    room = { ...room, forumThreadId: thread.id };
    primeRoom({ ...read, room });
  } catch {
    // Said by the room's own line (NOT ON THE BOARD).
  }

  const start = choice.start;
  if (start !== undefined) {
    const name = cleanRoomWords(start.name, ROOM_NAME_MAX);
    const topic = cleanRoomWords(start.topic, ROOM_TOPIC_MAX);
    if (name !== null || topic !== null || start.addMode !== room.addMode) {
      try {
        await repository.saveRoomSettings({ roomId: id, by: host.id, name: start.name, topic: start.topic, addMode: start.addMode });
        room = { ...room, name, topic, addMode: start.addMode };
      } catch {
        // The room's cog can say them again.
      }
    }
    try {
      const entry = await repository.addToQueue({ roomId: id, addedBy: host.id, position: 0, inQueue: true, ...start.first });
      noteRoomStart(entry.id, start.place);
      queue.push(entry);
    } catch {
      // A black screen with its three keys, as any new room.
    }
    closeFloating();
    primeRoom({ ...read, room, queue });
  }

  openWatch({ kind: 'room', roomId: id });
  return id;
}
