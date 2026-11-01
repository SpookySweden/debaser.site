import { QUEUE_PAUSED_SECONDS } from './broadcast';

/**
 * How often a broadcasting host tells the database where they are, while playing.
 *
 * **The number is the contract, and it is set by the pause, not by the staleness window.** A listener
 * reads a row that has gone quiet for `QUEUE_PAUSED_SECONDS` as a host who paused (there is no "paused"
 * column; the silence is the signal). So a playing host has to write comfortably inside that, or a
 * follower would pause along with a host who is still playing. Under half leaves room for a dropped
 * write and a slow network.
 *
 * It used to be half of the ninety-second staleness window, and that was the fault behind followers
 * drifting: a host who paused or skipped went unheard for up to 45 seconds. A tab that is playing audio
 * is not throttled by the browser the way an idle background tab is, so a short interval holds while
 * the host reads another page.
 */
export const QUEUE_HEARTBEAT_MS = Math.min(4000, Math.floor((QUEUE_PAUSED_SECONDS * 1000) / 2));

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
 * The value written is where the host is *now* in the track, and the `updated_at` the database stamps
 * is when that was true. The pair is the whole protocol (`broadcast.ts`).
 *
 * **The rate is not applied, and that is a correction.** This used to divide the clock by the playback
 * rate, on the idea that a catch-up at 2x put the clock ahead of the track. It does not: `elapsed` is
 * the element's `currentTime`, which *is* the position in the file at any speed. Dividing it told every
 * listener a host who was catching up was half as far in as they really were.
 */
export function publishablePosition(elapsed: number): number {
  if (!Number.isFinite(elapsed)) return 0;

  return Math.max(0, elapsed);
}
