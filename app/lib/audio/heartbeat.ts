import { QUEUE_STALE_SECONDS } from './broadcast';

/**
 * How often a broadcasting host tells the database where they are.
 *
 * **The number is the contract.** `queueState` calls a queue `silent` once its row has not moved for
 * `QUEUE_STALE_SECONDS`, so a heartbeat slower than that would make a *working* broadcast read as dead -
 * which is the exact lie this module exists to prevent. Half the window leaves room for one dropped
 * write, a slow network and a background tab throttling timers, and still lands inside it.
 *
 * A backgrounded tab is the case that decides it: every browser throttles `setInterval` in a tab nobody
 * is looking at, to roughly once a minute, and a broadcast that goes quiet when its owner reads another
 * page is not a broadcast. So the interval is derived rather than chosen, and a change to
 * `QUEUE_STALE_SECONDS` moves it here too.
 */
export const QUEUE_HEARTBEAT_MS = Math.floor((QUEUE_STALE_SECONDS * 1000) / 2);

/**
 * Whether a write is worth making.
 *
 * Two reasons it might not be, and they are different:
 *
 *   - **the row has not moved.** `positionSeconds` is whole seconds, so a write every three seconds of a
 *     track that is playing always carries a new number - but a *paused* listener's does not, and writing
 *     the same value on a timer forever is a table full of updates nobody reads. A heartbeat with no
 *     progress is still wanted, though, because it is what keeps the row from going stale, so the
 *     position is compared and the *time* is what the write is for.
 *   - **nothing is on.** There is nothing to broadcast, and a queue pointing at no track would draw a row
 *     with no title in it.
 *
 * So the answer is not "has the position changed" - it is "is there anything to say at all", which is
 * true whenever a track is loaded, playing or not.
 */
export function shouldPublish(position: number, lastPublished: number, playing: boolean): boolean {
  if (!Number.isFinite(position)) return false;

  // Always say something while audio is running: the row's *age* is what keeps a listener's lamp green.
  if (playing) return true;

  // Paused: a write only when the number actually moved, which happens on a seek.
  return Math.abs(position - lastPublished) >= 1;
}

/**
 * Where to publish from, given what the player is showing.
 *
 * Separate from the publishing so the arithmetic can be read on its own, and it is one line of meaning
 * worth stating: the value written is where the host is *now*, and the `updated_at` the database stamps
 * is when that was true. The pair is the whole protocol (`broadcast.ts`).
 */
export function publishablePosition(elapsed: number, playing: boolean, rate: number): number {
  if (!Number.isFinite(elapsed)) return 0;

  // A catch-up runs the element faster than the track really goes, so the displayed clock is ahead of
  // the file's own position - but a *broadcast* is where you are in the track, and playing at 2x does not
  // move you twice as far through it. Dividing the elapsed clock by the rate gives the real position.
  const real = playing && rate > 0 ? elapsed / rate : elapsed;

  return Math.max(0, real);
}
