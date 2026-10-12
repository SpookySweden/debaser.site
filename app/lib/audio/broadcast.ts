import type { AudioTrack } from './tracks';

/**
 * A queue somebody is broadcasting: what they are playing, and where they were when they said so.
 *
 * **This is synced playback, not streaming.** No audio leaves the host's machine. Every track already
 * lives at a public URL in the `mp3` bucket, so a broadcast is a *pointer* - a track, a position and a
 * moment - and every listener's own browser fetches the same file and seeks to roughly the same place.
 * That is what makes it possible with no media server, no WebRTC and no `getUserMedia`.
 *
 * The position is stored as a pair (`positionSeconds` + `updatedAt`) rather than as one absolute
 * instant so that **two machines never have to agree on the time**. A listener works out where the host
 * *should* be now from the pair, and the arithmetic is right even when the two clocks disagree about
 * the hour - which they will.
 */
export type BroadcastQueue = {
  /** The account broadcasting, and the key every screen already uses for a person. */
  userId: string;
  /** The track's `src`: the same key the player queues on and a like points at. */
  trackId: string;
  /** Which file in the host's own queue this is, so a listener can be told "3 of 12". */
  trackIndex: number;
  trackTotal: number;
  /** Where in the track the host was, in seconds. */
  positionSeconds: number;
  /** When that was true. See `livePositionSeconds` for how the two are read together. */
  updatedAt: string;
  startedAt: string;
};

/** A queue nobody has touched for this long is not live any more, whatever the row says. */
export const QUEUE_STALE_SECONDS = 90;

/**
 * How long a row may sit unwritten before the host is read as *paused* rather than playing.
 *
 * A playing host writes every `QUEUE_HEARTBEAT_MS` (a few seconds) and writes once more the moment
 * they pause, so a row that has gone quiet for longer than a couple of beats is a host who stopped the
 * tape. Without this the arithmetic would happily walk a paused host's position forward for the full
 * ninety seconds before calling it silent, and a follower would play on into music the host is not
 * hearing. `heartbeat.ts` holds its interval to well under this.
 */
export const QUEUE_PAUSED_SECONDS = 10;

/**
 * A row this old is not shown at all.
 *
 * `SILENT` is for somebody who stopped a minute ago and may be back; a row from last week is a
 * broadcast that was never switched off, and listing it beside the live ones is how the list came to
 * carry a queue from 26 September reading NOT PLAYING. It is still the owner's row - only the list
 * stops drawing it.
 */
export const QUEUE_GONE_SECONDS = 30 * 60;

/**
 * What a host is doing, as the list draws it - judged from the host's own row and nothing else.
 *
 * **This is about the host, not about you.** The old lamp measured the distance between the host and
 * *whatever this player happened to be on*, so a reader who had never followed anybody was told they
 * were 4095 seconds behind and catching up at 4x. How far behind *you* are only means something for
 * the one queue you are following, and that is `followStep`'s business (`follow.ts`).
 */
export type HostState = 'live' | 'paused' | 'silent';

/**
 * How far this device's clock runs ahead of the database's, in milliseconds - as best it can be told.
 *
 * `updated_at` is stamped by the database's clock and read against this device's, so a device a dozen
 * seconds fast would see every live host as PAUSED (the pause window is ten seconds). Each time a change
 * arrives by realtime, the newest row in it was written a moment ago, so `now - updated_at` is the skew
 * plus a little network delay; the smallest of the recent readings is the best estimate. Zero until
 * the first reading, which is the old behaviour.
 */
const skewReadings: number[] = [];

export function calibrateClock(queues: BroadcastQueue[], now: number): void {
  const newest = Math.max(...queues.map((queue) => Date.parse(queue.updatedAt)).filter((at) => !Number.isNaN(at)));
  if (!Number.isFinite(newest)) return;

  const reading = now - newest;

  // A change that was a delete leaves an older row as the newest, which would read as a huge skew. Real
  // clocks are seldom two minutes out; a reading past that is the wrong row, not the clock.
  if (Math.abs(reading) > 120000) return;

  skewReadings.push(reading);
  if (skewReadings.length > 12) skewReadings.shift();
}

/** The estimate, once there are two readings to take the smaller of - one alone could be a stale row. */
export function clockSkewMs(): number {
  return skewReadings.length < 2 ? 0 : Math.min(...skewReadings);
}

/** Forgets the readings - for the checks, which run several clocks in one process. */
export function resetClockSkew(): void {
  skewReadings.length = 0;
}

/** Seconds since the host last wrote their row, on the database's clock; zero for an unreadable stamp. */
export function queueAgeSeconds(queue: BroadcastQueue, now: number): number {
  const written = Date.parse(queue.updatedAt);

  return Number.isNaN(written) ? 0 : Math.max(0, (now - clockSkewMs() - written) / 1000);
}

export function hostState(queue: BroadcastQueue, now: number): HostState {
  const age = queueAgeSeconds(queue, now);

  if (age > QUEUE_STALE_SECONDS) return 'silent';
  if (age > QUEUE_PAUSED_SECONDS) return 'paused';

  return 'live';
}

/**
 * Where the host *should* be now, in seconds.
 *
 * The whole reason the position is a pair. `positionSeconds` was true at `updatedAt`, so adding the
 * seconds since then gives where they are now - and it needs no agreement between the two clocks,
 * because only the *age* of `updatedAt` is used. A listener whose own clock is an hour out still gets
 * the right answer, which is not true of any scheme that compares absolute instants.
 *
 * Clamped at zero: a row written a moment in the future (a clock a second ahead, a network hop) would
 * otherwise give a negative position and the audio would be asked to seek before the start.
 */
export function livePositionSeconds(queue: BroadcastQueue, now: number): number {
  return Math.max(0, queue.positionSeconds + queueAgeSeconds(queue, now));
}

/**
 * Where the host is, allowing for a pause: walked forward while they are live, held where they
 * stopped once the row has gone quiet. A paused host's last write is the moment they paused
 * (`BroadcastHeartbeat` writes on the pause itself), so the stored position is exactly right.
 */
export function hostPositionSeconds(queue: BroadcastQueue, now: number): number {
  return hostState(queue, now) === 'live' ? livePositionSeconds(queue, now) : Math.max(0, queue.positionSeconds);
}

/**
 * The rows worth listing: anything written in the last half hour, live ones first.
 *
 * Sorted here rather than trusted from the database's `updated_at` order, because two live hosts
 * swap places every heartbeat under that order and a list that reshuffles every four seconds is a list
 * nobody can press a row on.
 */
export function visibleQueues(queues: BroadcastQueue[], now: number): BroadcastQueue[] {
  const rank: Record<HostState, number> = { live: 0, paused: 1, silent: 2 };

  return queues
    .filter((queue) => queueAgeSeconds(queue, now) <= QUEUE_GONE_SECONDS)
    .sort((a, b) => rank[hostState(a, now)] - rank[hostState(b, now)] || a.userId.localeCompare(b.userId));
}

/** The host's state in the list's own words. */
export function hostStateLabel(state: HostState): string {
  switch (state) {
    case 'live':
      return 'LIVE';
    case 'paused':
      return 'PAUSED';
    case 'silent':
      return 'SILENT';
  }
}

/** What a listener is told about a track: "3 / 12" rather than an index nobody can read. */
export function queueTrackBadge(queue: BroadcastQueue): string {
  return `${queue.trackIndex + 1} / ${queue.trackTotal}`;
}

/**
 * The track a broadcast points at, or undefined when the shelf no longer holds it.
 *
 * A broadcast stores the track's `src` and not a copy of it, for the reason `music_likes.track_id`
 * does: a file that is re-titled is not a stale name in somebody's queue, and a file that is deleted
 * leaves a pointer the app cannot resolve rather than a row that lies about what it is. The caller
 * decides what to draw for a queue it cannot place - which is what `unresolvedTrackTitle` is for.
 */
export function resolveQueueTrack(queue: BroadcastQueue, shelf: AudioTrack[]): AudioTrack | undefined {
  return shelf.find((track) => track.src === queue.trackId);
}

/** What to say about a track the shelf does not hold, so the row is never half-drawn. */
export function unresolvedTrackTitle(queue: BroadcastQueue): string {
  return `A FILE THE SHELF DOES NOT HOLD (${queue.trackId.split('/').pop() ?? queue.trackId})`;
}
