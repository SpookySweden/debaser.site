'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AudioTrack } from '../audio/tracks';
import { webTrackNow } from '../web/web-track-lookup';
import { upNextFromRoom } from './music-rooms';
import { getWatchRepository } from './repository';
import { songLink, trackForSong } from './songs';
import { showMusicOnBar } from './stream-bar';
import type { LiveRoom, RoomOrigin, WatchRoom, WatchRoomRead } from './types';
import { askToSaveCanvas } from './use-room-canvas';
import { primeRoom } from './use-watch-room';
import { closeWatch, collapseWatch, openWatch, watchWindowState } from './watch-window';

/**
 * Music rooms in the browser (SPEC-music-queues.md): going public, switching off, joining a room, and the QUEUES
 * list. The rules are in music-rooms.ts; this is the glue to the player and the room window.
 */

/** The parts of the music player these need (`useMusicPlayer()`). */
type Player = {
  track: AudioTrack | undefined;
  queue: AudioTrack[];
  upNext: AudioTrack[];
  elapsed: number;
  playing: boolean;
  replaceUpNext: (tracks: AudioTrack[]) => void;
};

/**
 * Joining a room. A music room opens folded with the bar on the music (following stays light; the TV key turns
 * the bar to the stream view); a video stream opens as the `[ TV ]` key opens it.
 */
export function enterRoom(roomId: string, origin: RoomOrigin): void {
  openWatch({ kind: 'room', roomId });
  if (origin !== 'music') return;
  collapseWatch();
  showMusicOnBar(roomId);
}

/** Switching off: the room is kept, its songs still to play are your up-next again, and you leave its window. */
export async function switchMusicRoomOff(read: WatchRoomRead, player: Pick<Player, 'queue' | 'replaceUpNext'>): Promise<void> {
  await getWatchRepository().setRoomPublic(read.room.id, false);
  const tracks = upNextFromRoom(read.queue).map((link) => trackForSong(link, player.queue, webTrackNow(link.url)));
  player.replaceUpNext(tracks);
  const open = watchWindowState();
  if (open.focus?.kind === 'room' && open.focus.roomId === read.room.id) closeWatch();
}

/** The GO PUBLIC switch: this account's music room, and the two presses. */
export function useMusicRoomSwitch(user: { id: string; displayName: string } | null, player: Player) {
  const repository = getWatchRepository();
  const userId = user?.id ?? null;
  const [room, setRoom] = useState<WatchRoom | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const read = useCallback(() => {
    if (userId === null) return;
    void repository.findMusicRoom(userId).then(setRoom, () => setRoom(null));
  }, [repository, userId]);

  useEffect(() => {
    read();
    return repository.subscribeLiveRooms(read);
  }, [read, repository]);

  async function goPublic() {
    if (user === null) return;
    if (player.track === undefined) {
      setMessage('PLAY SOMETHING FIRST.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const opened = await repository.openMusicRoom({
        id: crypto.randomUUID(),
        host: { id: user.id, label: user.displayName },
        playing: songLink(player.track),
        positionSeconds: player.elapsed,
        isPlaying: player.playing,
        upNext: player.upNext.map(songLink),
      });
      primeRoom(opened);
      // Your up-next is the room's queue now.
      player.replaceUpNext([]);
      setRoom(opened.room);
      enterRoom(opened.room.id, 'music');
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'THAT DID NOT SAVE.');
    } finally {
      setBusy(false);
    }
  }

  async function goPrivate() {
    if (room === null || room === undefined) return;
    setBusy(true);
    setMessage(null);
    try {
      // Public off ends the canvas session too: a changed canvas nobody saved asks first (SPEC-stream-art.md).
      if (user !== null) await askToSaveCanvas(room.id, { ending: true, hostId: user.id });
      const kept = await repository.readRoom(room.id);
      if (kept !== null) await switchMusicRoomOff(kept, player);
      read();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'THAT DID NOT SAVE.');
    } finally {
      setBusy(false);
    }
  }

  return { isPublic: room !== null && room !== undefined && room.isPublic, busy, message, goPublic, goPrivate };
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
