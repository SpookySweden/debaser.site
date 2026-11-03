import type { PlaylistItem } from '../audio/library';
import { isSongLink, songLink } from './songs';
import { ROOM_QUIET_SECONDS, playOrder, roomAgeSeconds, roomIsLive, upcoming } from './rules';
import type { LiveRoom, WatchLink, WatchQueueEntry, WatchRoom, WatchRoomRead } from './types';

/**
 * Music rooms (SPEC-music-queues.md): a music broadcast is a stream room whose queue plays songs. Pure.
 *
 * GO PUBLIC opens your one music room, kept for good, from what your player has on and your up-next;
 * switching it off leaves the room's queue as your up-next. The QUEUES tab lists every live room, music
 * and video alike.
 */

/** A public music room drops off the QUEUES list once its host has been quiet this long; it is kept. */
export const MUSIC_ROOM_GONE_SECONDS = 30 * 60;

/** What a QUEUES row says about its host, from the room alone. */
export type RoomRowState = 'live' | 'paused' | 'silent';

export function roomRowState(room: Pick<WatchRoom, 'updatedAt' | 'isPlaying'>, now: number): RoomRowState {
  if (roomAgeSeconds(room, now) > ROOM_QUIET_SECONDS) return 'silent';
  return room.isPlaying ? 'live' : 'paused';
}

/**
 * The rooms the QUEUES tab lists: live video streams, and public music rooms whose host wrote in the last
 * half hour. Live first, then paused, then silent, each newest-started first, so a row does not jump about
 * on every heartbeat.
 */
export function listedRooms(rooms: readonly LiveRoom[], now: number): LiveRoom[] {
  const rank: Record<RoomRowState, number> = { live: 0, paused: 1, silent: 2 };
  return rooms
    .filter(({ room }) =>
      room.endedAt !== null
        ? false
        : room.origin === 'music'
          ? room.isPublic && roomAgeSeconds(room, now) <= MUSIC_ROOM_GONE_SECONDS
          : roomIsLive(room, now),
    )
    .sort(
      (a, b) =>
        rank[roomRowState(a.room, now)] - rank[roomRowState(b.room, now)] ||
        b.room.startedAt.localeCompare(a.room.startedAt) ||
        a.room.id.localeCompare(b.room.id),
    );
}

/**
 * What GO PUBLIC writes into a kept room: the song your player has on, slotted in as playing unless the room
 * is already on that song; then your up-next, onto the end, leaving out what already waits in the queue.
 * Nothing is taken out: the kept queue, additions and crowns stay as they were.
 */
export function goPublicPlan(
  queue: readonly WatchQueueEntry[],
  currentEntry: WatchQueueEntry | undefined,
  playing: WatchLink | null,
  upNext: readonly WatchLink[],
): { slot: WatchLink | null; append: WatchLink[] } {
  const onAlready = playing !== null && currentEntry?.link?.url === playing.url;
  const waiting = new Set(upcoming([...queue]).flatMap((entry) => (entry.link === null ? [] : [entry.link.url])));
  const append: WatchLink[] = [];
  for (const link of upNext) {
    if (waiting.has(link.url)) continue;
    waiting.add(link.url);
    append.push(link);
  }
  return { slot: playing === null || onAlready ? null : playing, append };
}

/** Switching public off: the room's songs still to play, in order, become your up-next (videos stay in the room). */
export function upNextFromRoom(queue: readonly WatchQueueEntry[]): WatchLink[] {
  return upcoming([...queue]).flatMap((entry) => (isSongLink(entry.link) ? [entry.link] : []));
}

/* --- off-queue plays (step 3) --------------------------------------------------------------------- */

/**
 * PLAY NEXT into a room: a place ahead of everything still queued. Places only order what is still to play, so
 * one below the lowest is enough (they may go below zero).
 */
export function frontPosition(queue: readonly WatchQueueEntry[]): number {
  const waiting = upcoming([...queue]);
  return waiting.length === 0 ? 0 : Math.min(...waiting.map((entry) => entry.position)) - 1;
}

/* --- store and start blank (step 3) ----------------------------------------------------------------- */

/** What the queue window shows as played: every play since STORE AND START BLANK, and always what is on now. */
export function playedSinceCleared(read: Pick<WatchRoomRead, 'room' | 'queue'>): WatchQueueEntry[] {
  const cleared = read.room.clearedAt;
  return playOrder([...read.queue]).filter(
    (entry) => cleared === null || entry.id === read.room.currentEntryId || (entry.playedAt !== null && entry.playedAt > cleared),
  );
}

/** The saved list's name: the day and time it was stored, as a list name is short (40 characters). */
export function storedListName(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `ROOM ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

/**
 * The shared queue as a saved list: what played since it was last cleared, what is on, then what is still to play,
 * each kept whole (`link`), so a song the shelf no longer holds and a video both come back. `trackIdOf` names a
 * song by the id a playlist keys it on (the shelf's), where the shelf holds it.
 */
export function storedListItems(read: Pick<WatchRoomRead, 'room' | 'queue'>, trackIdOf: (link: WatchLink) => string | null, at: string): PlaylistItem[] {
  const rows = [...playedSinceCleared(read), ...upcoming([...read.queue])];
  return rows.flatMap((entry) => {
    if (entry.link === null) return [];
    const link = entry.link;
    return [{ trackId: (isSongLink(link) ? trackIdOf(link) : null) ?? `link:${link.url}`, addedAt: at, link }];
  });
}

/** A saved list loaded back as the shared queue: each item's own link, or its song from the shelf by id. */
export function listLinks(items: readonly PlaylistItem[], trackById: (id: string) => { src: string; title: string } | undefined): WatchLink[] {
  return items.flatMap((item) => {
    if (item.link !== undefined) return [item.link];
    const track = trackById(item.trackId);
    return track === undefined ? [] : [songLink(track)];
  });
}
