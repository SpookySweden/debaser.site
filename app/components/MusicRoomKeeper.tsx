'use client';

import { useEffect } from 'react';
import { roomAgeSeconds } from '../lib/watch/rules';
import { MUSIC_ROOM_GONE_SECONDS } from '../lib/watch/music-rooms';
import { getWatchRepository } from '../lib/watch/repository';
import { enterRoom } from '../lib/watch/use-music-room';
import { watchWindowState } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';

/**
 * Your music room through a reload (SPEC-music-queues.md). The room's host has to be in it for it to go on (the
 * room window writes where the music is), so a page opened while your room is public opens it again, folded, as
 * GO PUBLIC left it. The browser will not start the sound by itself: the room reads PAUSED until you press play.
 * A room left public and quiet for half an hour is switched off instead, as the QUEUES list has dropped it.
 * Draws nothing.
 */
export default function MusicRoomKeeper() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (userId === null) return;
    let alive = true;
    const repository = getWatchRepository();
    void repository
      .findMusicRoom(userId)
      .then((room) => {
        if (!alive || room === null || !room.isPublic) return;
        if (roomAgeSeconds(room, Date.now()) > MUSIC_ROOM_GONE_SECONDS) {
          void repository.setRoomPublic(room.id, false).catch(() => undefined);
          return;
        }
        // Not over a room this page was opened on (a `?watch=` link).
        if (!watchWindowState().open) enterRoom(room.id, 'music');
      })
      .catch(() => {
        // Unreadable: the QUEUES tab's switch says how it stands when it is opened.
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  return null;
}
