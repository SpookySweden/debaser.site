'use client';

import { getWatchRepository } from './repository';
import { streamAnchor, streamThreadTitle } from './rules';
import { primeRoom } from './use-watch-room';
import { openWatch } from './watch-window';
import type { ForumAnchor } from '../forum/types';

/**
 * GO LIVE, from the CYTUBE page only (SPEC-cytube.md): the host's room opens **empty**, no file needed, its
 * screen black with the three keys. The forum record is filed as it starts, as GO LIVE always did; a room that
 * could not be filed is still a room (it says NOT ON THE BOARD). The room window opens over the page.
 *
 * Returns the room's id. Throws with a sentence fit to show.
 */
export async function goLiveEmpty(
  host: { id: string; displayName: string },
  createThread: (input: { title: string; body: string; anchor: ForumAnchor }) => Promise<{ id: string }>,
): Promise<string> {
  const id = crypto.randomUUID();
  const repository = getWatchRepository();
  const read = await repository.openRoom({ id, host: { id: host.id, label: host.displayName }, mediaItemId: null });
  primeRoom(read);

  try {
    const thread = await createThread({ title: streamThreadTitle(host.displayName, read.room.startedAt), body: '', anchor: streamAnchor(id) });
    await repository.attachThread(id, thread.id);
    // Into the shared copy at once, so the room does not say NOT ON THE BOARD until the echo arrives.
    primeRoom({ ...read, room: { ...read.room, forumThreadId: thread.id } });
  } catch {
    // Said by the room's own line (NOT ON THE BOARD).
  }

  openWatch({ kind: 'room', roomId: id });
  return id;
}
