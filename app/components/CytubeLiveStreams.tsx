'use client';

import { useMemo } from 'react';
import { useCatalogue } from '../lib/media/catalogue';
import { useNow } from '../lib/ui/use-now';
import { listedRooms } from '../lib/watch/music-rooms';
import { withSeries } from '../lib/watch/rules';
import type { LiveRoom, RoomOrigin, WatchQueueEntry } from '../lib/watch/types';
import { useLiveRooms } from '../lib/watch/use-music-room';

/** One live room on the CYTUBE page's LIVE tab. */
export type LiveStreamRow = { roomId: string; hostId: string; hostName: string; title: string; kind: RoomOrigin };

/**
 * The live rooms, for the LIVE tab (SPEC-cytube.md: "the same list as the QUEUES tab: one source, not a copy"):
 * `useLiveRooms` and `listedRooms`, exactly what QUEUES reads (SPEC-music-queues.md), so music rooms and video
 * streams alike, in its order. Null until the first answer.
 */
export function useLiveStreams(): LiveStreamRow[] | null {
  const { rooms } = useLiveRooms();
  const catalogue = useCatalogue();
  const now = useNow(5000);
  const titles = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item.title])), [catalogue.items]);
  if (rooms === null) return null;
  return liveRows(listedRooms(rooms, now), titles);
}

function titleOf(entry: WatchQueueEntry | null, titles: Map<string, string>): string {
  if (entry === null) return '';
  return entry.link !== null ? withSeries(entry, entry.link.title) : (titles.get(entry.mediaItemId ?? '') ?? 'A FILE');
}

export function liveRows(rooms: readonly LiveRoom[], titles: Map<string, string>): LiveStreamRow[] {
  return rooms.map(({ room, current }) => ({
    roomId: room.id,
    hostId: room.hostId,
    hostName: room.originalHostLabel,
    title: titleOf(current, titles),
    kind: room.origin,
  }));
}
