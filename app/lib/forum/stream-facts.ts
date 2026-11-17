import { playOrder, roomIsLive } from '../watch/rules';
import type { WatchRoomRead } from '../watch/types';

/**
 * What a closed stream record's row says about the stream (SPEC-forum-v2.md, Luke's 3A: the row said only
 * `STREAM :: HOST :: DATE`): how many videos played and for how long, and whether it is on now. Drawn from the room the
 * row already reads for its LIVE marker (one read per room, shared: `app/lib/watch/use-watch-room.ts`), so it costs no
 * request of its own. Pure, so the words can be checked without a browser.
 */
export type StreamFacts = { videos: string; length: string; live: boolean };

/** `40 MIN`, `1 H 5 MIN`, `UNDER A MINUTE`. */
export function streamLength(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'UNDER A MINUTE';
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} H` : `${hours} H ${rest} MIN`;
}

export function streamFacts(read: WatchRoomRead, now: number): StreamFacts {
  const plays = playOrder(read.queue).length;
  const live = roomIsLive(read.room, now);
  // A live stream runs until now; an ended one until it ended; one left open by everybody, until its last heartbeat.
  const until = live ? now : Date.parse(read.room.endedAt ?? read.room.updatedAt);
  const seconds = (until - Date.parse(read.room.startedAt)) / 1000;

  return {
    videos: plays === 0 ? 'NOTHING PLAYED' : plays === 1 ? '1 VIDEO' : `${plays} VIDEOS`,
    length: Number.isFinite(seconds) ? streamLength(seconds) : '',
    live,
  };
}
