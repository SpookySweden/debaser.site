'use client';

import { useEffect, useState } from 'react';
import { getWatchRepository } from './repository';
import { showMusicOnBar } from './stream-bar';
import type { LiveRoom, RoomOrigin } from './types';
import { openWatch } from './watch-window';

/**
 * Rooms in the browser: joining one, and the list of live ones. GO PUBLIC and its switch are gone
 * (SPEC-rooms-queues.md): a person's own room is never public, and going live always makes a new stream room.
 */

/**
 * Joining a room: it opens as a window, every kind (SPEC-rooms-your-room.md, part 2; Luke, 2026-11-16: "dont do pip
 * by default have the room open by default"). A music room used to open folded away; it still opens with the bar on
 * the music (the TV key turns the bar to the stream view), and its window's `[ _ ]` is there for whoever wants it small.
 */
export function enterRoom(roomId: string, origin: RoomOrigin): void {
  openWatch({ kind: 'room', roomId });
  if (origin === 'music') showMusicOnBar(roomId);
}

/** Every room not ended, with what is on in each, kept current; null until the first answer. */
export function useLiveRooms(): { rooms: LiveRoom[] | null; error: string | null } {
  const repository = getWatchRepository();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void repository.listLiveRooms().then(
        (found) => {
          if (!alive) return;
          setRooms(found);
          setError(null);
        },
        (failure: unknown) => {
          if (!alive) return;
          setRooms((was) => was ?? []);
          setError(failure instanceof Error ? failure.message : 'THE ROOMS COULD NOT BE READ.');
        },
      );
    read();
    const off = repository.subscribeLiveRooms(read);
    return () => {
      alive = false;
      off();
    };
  }, [repository]);

  return { rooms, error };
}
