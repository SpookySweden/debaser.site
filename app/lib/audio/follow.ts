import { hostPositionSeconds, hostState, type BroadcastQueue } from './broadcast';
import { createWindowSlot } from '../ui/window-slot';

/**
 * Following somebody's queue: your player stays locked to theirs until you take the controls back.
 *
 * **What "following" means here.** Pressing CATCH UP or SKIP AHEAD on a queue does not play one track
 * and leave you there - it hands the player to `QueueFollower`, which keeps reading the host's row and
 * steering: their next track becomes yours, their pause pauses you, a gap opens and you speed up to
 * close it. It ends in exactly three ways, and each one says so on the bar:
 *
 *   - you press something yourself - play, pause, next, a track anywhere on the site (the provider
 *     calls `stopFollowing` from every transport key, so "touch the controls and you are on your own"
 *     is one rule rather than a list of exceptions);
 *   - you press UNFOLLOW;
 *   - the host stops broadcasting, or goes quiet long enough to read as SILENT.
 *
 * The state is a module-level slot for the reason the windows' are (`window-slot.ts`): the bar, the
 * queue list and the follower all read it, and none of them should re-render the page to do so.
 */

export type FollowState = {
  /** The account being followed, or null. */
  hostId: string | null;
  /** Their name as the card showed it, so the bar can say who without a second read. */
  hostName: string;
  /** True while the player is running fast to close a gap - what the bar's `>>` says. */
  catchingUp: boolean;
  /** Why the last follow ended, said once on the bar; null while following or before any. */
  ended: string | null;
};

const IDLE: FollowState = { hostId: null, hostName: '', catchingUp: false, ended: null };

const slot = createWindowSlot<FollowState>(IDLE);

export const followState = slot.state;
export const subscribeToFollow = slot.subscribe;

/** Starts following a host. Replaces whoever was followed before - you listen to one person at once. */
export function startFollowing(hostId: string, hostName: string): void {
  slot.set({ hostId, hostName, catchingUp: false, ended: null });
}

/**
 * Stops following, saying why. A no-op when nobody is followed, so every transport key can call it
 * without first asking - and so the bar is not woken by a press that changed nothing.
 */
export function stopFollowing(reason: string): void {
  const current = slot.state();
  if (current.hostId === null) return;

  slot.set({ ...IDLE, ended: reason });

  // Said for a moment, then gone: a bar still announcing a follow that ended an hour ago is noise.
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (slot.state().hostId === null && slot.state().ended === reason) slot.set(IDLE);
    }, ENDED_NOTICE_MS);
  }
}

/** How long the bar says why a follow ended. */
export const ENDED_NOTICE_MS = 12000;

/** Whether anybody is being followed. Read by the provider's `ended` handler and its transport keys. */
export function isFollowing(): boolean {
  return slot.state().hostId !== null;
}

/** Marks whether the follower is catching up, writing only on a change. */
export function setCatchingUp(catchingUp: boolean): void {
  const current = slot.state();
  if (current.hostId === null || current.catchingUp === catchingUp) return;

  slot.set({ ...current, catchingUp });
}

/**
 * How the follower closes a gap.
 *
 *   - under `CATCH_UP_START_SECONDS` behind: leave it. Two machines reading one row through a network
 *     are never closer than a second or two, and chasing that would wobble the speed for nothing.
 *   - once catching up, keep going until under `CATCH_UP_SETTLE_SECONDS`, so the speed does not flick
 *     between 1x and 1.2x on the boundary.
 *   - past `SEEK_GAP_SECONDS` behind, or more than `AHEAD_GAP_SECONDS` ahead: jump. A minute of music
 *     at 3x is not catching up, it is a chipmunk; and playing *slower* than the host to let them catch
 *     you sounds broken, so being well ahead is fixed by a jump back.
 */
export const CATCH_UP_START_SECONDS = 2.5;
export const CATCH_UP_SETTLE_SECONDS = 0.75;
export const SEEK_GAP_SECONDS = 45;
export const AHEAD_GAP_SECONDS = 4;
export const MAX_CATCH_UP_RATE = 3;

/** How far back CATCH UP starts you, so you hear the last stretch of what they played, sped up. */
export const CATCH_UP_LEAD_SECONDS = 20;

/** The speed for a gap: proportional, so a small gap is a nudge and a big one is a sprint. */
export function paceRate(gapSeconds: number): number {
  if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) return 1;

  // A floor of 1.25x: proportional alone gave 1.1x for the last second or two, and a tail that slow
  // took longer to close than the whole rest of the gap - the bar said CATCHING UP for no audible reason.
  return Math.min(MAX_CATCH_UP_RATE, 1.25 + gapSeconds / 12);
}

/** What the follower's own player is doing, as `followStep` needs it. */
export type Listener = {
  /** The `src` on the display, or null when nothing is loaded. */
  src: string | null;
  /** Where in it, in track seconds - the element's `currentTime`, which a playback rate does not skew. */
  seconds: number;
  /** The file's length, or NaN before it is known. */
  duration?: number;
  /** Whether it is playing now. */
  playing?: boolean;
};

/** True when the follower has reached the end of its file and stopped there. */
function finished(mine: Listener): boolean {
  return (
    mine.playing === false &&
    mine.duration !== undefined &&
    Number.isFinite(mine.duration) &&
    mine.seconds >= mine.duration - 0.75
  );
}

/**
 * One step of following: what the player should do now to stay with the host.
 *
 * `lost` ends the follow. Otherwise `sync` says which track (`load` when it is not the one on the
 * display), where to put the playhead (`at`, or undefined to leave it), how fast, and whether it should
 * be playing at all - a host who paused is a follower who pauses.
 *
 * Pure, and the reason it is: every rule above is one line here, and each was worth testing without a
 * browser, two accounts and a stopwatch.
 */
export type FollowStep =
  | { kind: 'lost'; reason: string }
  | { kind: 'sync'; load: boolean; at: number | undefined; rate: number; playing: boolean; catchingUp: boolean };

export function followStep(
  host: BroadcastQueue | null,
  mine: Listener,
  now: number,
  catchingUp: boolean,
): FollowStep {
  if (host === null) return { kind: 'lost', reason: 'THEY STOPPED BROADCASTING' };

  const state = hostState(host, now);
  if (state === 'silent') return { kind: 'lost', reason: 'THEY WENT QUIET' };

  const target = hostPositionSeconds(host, now);
  const playing = state === 'live';

  if (mine.src !== host.trackId) {
    return { kind: 'sync', load: true, at: target, rate: 1, playing, catchingUp: false };
  }

  const gap = target - mine.seconds;

  // Our copy ran out first. The host's next track is a row-write away, so wait for it rather than press
  // play on a finished file - which restarts it from 0:00 and plays a blip of the opening. A host who is
  // clearly back near the start of this same track has looped it, and that one we follow.
  if (finished(mine) && target > mine.seconds - CATCH_UP_LEAD_SECONDS) {
    return { kind: 'sync', load: false, at: undefined, rate: 1, playing: false, catchingUp: false };
  }

  // Paused: hold where they stopped. Only moved when it is visibly off, so a paused player is not
  // nudged by a fraction of a second on every tick.
  if (!playing) {
    return { kind: 'sync', load: false, at: Math.abs(gap) > 1 ? target : undefined, rate: 1, playing, catchingUp: false };
  }

  if (gap > SEEK_GAP_SECONDS || gap < -AHEAD_GAP_SECONDS) {
    return { kind: 'sync', load: false, at: target, rate: 1, playing, catchingUp: false };
  }

  const chasing = catchingUp ? gap > CATCH_UP_SETTLE_SECONDS : gap > CATCH_UP_START_SECONDS;

  return { kind: 'sync', load: false, at: undefined, rate: chasing ? paceRate(gap) : 1, playing, catchingUp: chasing };
}
