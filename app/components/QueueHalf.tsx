'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoomSource } from '../lib/ui/floating-player';
import type { RoomSeries } from '../lib/watch/go-live';
import type { BarAudioPlatform } from '../lib/web/web-audio';
import { loadWebItem } from '../lib/web/web-track-lookup';
import { useMusicPlayer } from './MusicPlayerProvider';
import type { Half } from './SplitKey';
import { useRoomKey } from './WatchInRoomKey';

/**
 * **The second half of MEDIA's PLAY key, in one place** (Luke's list, 2026-11-14, M6; his ROOMS answer 7A: "MEDIA's key
 * reads PLAY / + QUEUE"). The ROOMS rework re-points this function and every row follows.
 *
 * Until then it does the honest thing in each case, in this order:
 * - **In a room you can add to:** `+ QUEUE` puts it at the back of that room's queue (or your own list there without a crown),
 *   as ADD TO ROOM did.
 * - **Something the music bar plays** (`bar`): `+ QUEUE` puts its files at the end of the bar's UP NEXT.
 * - **A video outside a room:** there is no queue for it yet, so the half keeps `WATCH IN ROOM` and what it does (the room's
 *   settings window, then a room).
 * - Otherwise (a visitor's video, a picture, a book): null, and PLAY is a key of its own.
 */

/** How long the half says it worked. */
const QUEUED_MS = 4000;

export function useQueueHalf({
  bar,
  room,
  series,
  playId,
  title,
  onPress,
}: {
  /** The item, when the music bar can play it. */
  bar: { platform: BarAudioPlatform; externalId: string } | null;
  /** How it plays in a room, when it can. */
  room: RoomSource | undefined;
  series?: RoomSeries;
  playId: string;
  title: string;
  /** Told on a press (a search result asks to be saved; save-opened.ts). */
  onPress?: () => void;
}): Half | null {
  const roomKey = useRoomKey({ source: room, series, playId, title, onPress });
  const player = useMusicPlayer();
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'none'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (roomKey !== null && roomKey.mode === 'add') {
    return {
      words: roomKey.words === 'ADD TO ROOM' ? '+ QUEUE' : roomKey.words,
      label: `Add "${title}" to the queue of the room you are in`,
      press: roomKey.press,
      disabled: roomKey.disabled,
      data: `room-${roomKey.data}`,
      after: roomKey.after,
    };
  }

  if (bar !== null) {
    const queue = async () => {
      if (state === 'busy') return;
      onPress?.();
      setState('busy');
      const tracks = await loadWebItem(bar.platform, bar.externalId);
      if (tracks === null || tracks.length === 0) {
        setState('none');
        return;
      }
      for (const track of tracks) player.enqueue(track, 'end');
      setState('queued');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState('idle'), QUEUED_MS);
    };
    return {
      words: state === 'busy' ? '… ADDING' : state === 'queued' ? '✓ QUEUED' : '+ QUEUE',
      label: `Add "${title}" to the music player's up next`,
      press: () => void queue(),
      disabled: state === 'busy',
      busy: state === 'busy',
      data: state === 'queued' ? 'bar-queued' : 'bar',
      after:
        state === 'none' ? (
          <span role="status" className="text-label font-bold text-ink">
            NO PLAYABLE FILE
          </span>
        ) : null,
    };
  }

  if (roomKey !== null) {
    return {
      words: roomKey.words,
      label: roomKey.label,
      press: roomKey.press,
      expanded: roomKey.open,
      haspopup: true,
      on: roomKey.open,
      data: 'room-start',
      after: roomKey.after,
    };
  }
  return null;
}
