'use client';

import { closeFloating, type RoomSource } from '../ui/floating-player';
import { noteCarried, noteCarriedSong, type Carry } from './go-live-carry';
import { getWatchRepository } from './repository';
import { noteRoomStart } from './room-start';
import { ROOM_NAME_MAX, ROOM_TOPIC_MAX, cleanRoomWords, nextPlayIndex, nextQueuePosition, streamAnchor, streamThreadTitle } from './rules';
import { primeRoom } from './use-watch-room';
import { openWatch } from './watch-window';
import type { ForumAnchor } from '../forum/types';
import type { RoomAddMode, RoomPrivacy, WatchLink, WatchQueueEntry } from './types';

/** A show's episodes going into a room as one block (ALL, server-picks.ts); `note` says when there were more than fit. */
export type RoomSeries = { title: string; links: WatchLink[]; note: string | null };

/** `[ WATCH IN ROOM ]` (SPEC-floating-player.md, part 3): the room's words, and the video it starts with. */
export type RoomStart = {
  name: string;
  topic: string;
  addMode: RoomAddMode;
  first: RoomSource;
  /** ALL: the whole block goes in instead of `first` (its first episode). */
  series?: RoomSeries;
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
 * With `carry` (SPEC-rooms-queues.md, phase 3; go-live-carry.ts) what you were playing and your own queue go in too:
 * every GO LIVE key passes it, so the room you start always holds your queue, and END STREAM can bring back what is left.
 *
 * Returns the room's id. Throws with a sentence fit to show.
 */
export async function goLiveEmpty(
  host: { id: string; displayName: string },
  createThread: (input: { title: string; body: string; anchor: ForumAnchor }) => Promise<{ id: string }>,
  choice: { privacy: RoomPrivacy; password?: string; start?: RoomStart; carry?: Carry },
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
      if (start.series !== undefined) {
        queue.push(...(await repository.addSeriesToQueue({ roomId: id, addedBy: host.id, position: 0, inQueue: true, seriesTitle: start.series.title, links: start.series.links })));
      } else {
        const entry = await repository.addToQueue({ roomId: id, addedBy: host.id, position: 0, inQueue: true, ...start.first });
        noteRoomStart(entry.id, start.place);
        queue.push(entry);
      }
    } catch {
      // A black screen with its three keys, as any new room.
    }
    closeFloating();
    primeRoom({ ...read, room, queue });
  }

  // What you were playing and your queue come with you (SPEC-rooms-queues.md, phase 3; go-live-carry.ts). A failure
  // here never stops the room: it opens with whatever got in, and the rest is still on your own queue. Each part is
  // tried by itself, and only a queue that really went in is ever brought home again at END STREAM (`noteCarried`):
  // a write that failed here must not be how a queue is lost.
  const carry = choice.carry;
  if (carry !== undefined) {
    try {
      if (carry.song !== null) {
        // Filed as already playing, then pointed at where the bar has got to: the bar's one player plays on with no gap.
        const entry = await repository.playNow({ roomId: id, by: host.id, link: carry.song.link, position: nextQueuePosition(queue), playIndex: nextPlayIndex(queue) });
        queue.push(entry);
        noteCarriedSong(entry.id);
        room = { ...room, currentEntryId: entry.id, positionSeconds: 0, isPlaying: true, updatedAt: new Date().toISOString() };
        await repository.writePlayback(id, { currentEntryId: entry.id, positionSeconds: carry.song.place, isPlaying: carry.song.playing });
        room = { ...room, positionSeconds: carry.song.place, isPlaying: carry.song.playing, updatedAt: new Date().toISOString() };
      } else if (carry.video !== null) {
        const entry = await repository.addToQueue({ roomId: id, addedBy: host.id, position: nextQueuePosition(queue), inQueue: true, ...carry.video.source });
        noteRoomStart(entry.id, carry.video.place);
        queue.push(entry);
        closeFloating();
      }
    } catch {
      // The room opens without it; whatever was on plays on outside the room, or is started again by hand.
    }
    try {
      if (carry.waiting.length > 0) {
        const at = new Date().toISOString();
        let position = nextQueuePosition(queue);
        const rows: WatchQueueEntry[] = carry.waiting.map((thing) => ({
          id: crypto.randomUUID(),
          roomId: id,
          position: position++,
          inQueue: true,
          mediaItemId: thing.mediaItemId ?? null,
          link: thing.link ?? null,
          series: null,
          addedBy: host.id,
          addedAt: at,
          playedAt: null,
          playIndex: null,
        }));
        await repository.addOwnEntries(id, host.id, rows);
        queue.push(...rows);
      }
      noteCarried(id);
    } catch {
      // The room opens with an empty queue, and your own queue is where it was: END STREAM will not touch it.
    }
    primeRoom({ ...read, room, queue });
  }

  openWatch({ kind: 'room', roomId: id });
  return id;
}
