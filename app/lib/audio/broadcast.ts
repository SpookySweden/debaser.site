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

/** How close a listener has to be to count as live, in seconds. */
export const LIVE_WINDOW_SECONDS = 8;

/**
 * How far behind a listener may fall before the list calls it DELAY. A little wider than the live
 * window, so the label does not flicker between the two on the boundary - a lamp that changes colour
 * every second is a lamp nobody trusts.
 */
export const DELAY_WINDOW_SECONDS = 15;

/** The fastest catch-up will play. Past this it stops being "catching up" and starts being a chipmunk. */
export const MAX_CATCH_UP_RATE = 4;

/** A queue nobody has touched for this long is not live any more, whatever the row says. */
export const QUEUE_STALE_SECONDS = 90;

/**
 * A queue's state, as the Queues tab draws it.
 *
 * `live` is the state a listener wants and the one the tab counts; `delayed` is the one with something
 * to do about it (`catchUpRate`); `silent` is a queue that is up but has not moved in long enough that
 * it is no longer playing - somebody closed their laptop.
 */
export type QueueState = 'live' | 'delayed' | 'silent';

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
  const written = Date.parse(queue.updatedAt);
  if (Number.isNaN(written)) return Math.max(0, queue.positionSeconds);

  const ageSeconds = Math.max(0, (now - written) / 1000);

  return Math.max(0, queue.positionSeconds + ageSeconds);
}

/** How far one listener is from a host, in seconds. Negative means they are *ahead*. */
export function distanceSeconds(queue: BroadcastQueue, listenerSeconds: number, now: number): number {
  return livePositionSeconds(queue, now) - listenerSeconds;
}

/**
 * Which of the three states a queue is in, judged on the clock.
 *
 * `ageSeconds` is how long since the host last moved. A queue that has not moved in
 * `QUEUE_STALE_SECONDS` is `silent` however live its position looks: the arithmetic would happily walk
 * the position forward for as long as the row existed, so something has to stop it, and that something
 * is the age of the write rather than the position it carries.
 *
 * The two windows overlap deliberately - between `LIVE_WINDOW_SECONDS` and `DELAY_WINDOW_SECONDS` a
 * listener still reads as live, so the label does not flicker on the boundary.
 */
export function queueState(distance: number, ageSeconds: number): QueueState {
  if (ageSeconds > QUEUE_STALE_SECONDS) return 'silent';
  if (Math.abs(distance) <= DELAY_WINDOW_SECONDS) return 'live';

  return 'delayed';
}

/**
 * The speed to play at while catching up: 1 when there is nothing to do, up to `MAX_CATCH_UP_RATE`.
 *
 * Proportional rather than stepped, because the brief asks for a catch-up that is *organic* - the
 * further behind you are the faster it goes, and it eases back to normal as it closes. A fixed 2x would
 * overshoot a two-second gap and crawl through a two-minute one.
 *
 * Only ever *forward*. A listener who is ahead of the host is not slowed down (a rate below 1 sounds
 * broken and stretches the track); they simply wait, which happens on its own because the host's
 * position keeps moving forward too.
 */
export function catchUpRate(distance: number): number {
  if (!Number.isFinite(distance) || distance <= LIVE_WINDOW_SECONDS) return 1;

  // One second of gap buys a tenth of a rate step, so a 30-second gap is about 3x and a long one caps.
  const rate = 1 + (distance - LIVE_WINDOW_SECONDS) / 10;

  return Math.min(MAX_CATCH_UP_RATE, rate);
}

/** The queue's own words, for the row and the pop-out: the site says what is true, not "loading". */
export function queueStateLabel(state: QueueState): string {
  switch (state) {
    case 'live':
      return 'LIVE';
    case 'delayed':
      return 'DELAY';
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
