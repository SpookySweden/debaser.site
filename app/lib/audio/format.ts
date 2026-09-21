/**
 * The player's arithmetic, kept away from the audio element so it can be read (and
 * checked) on its own: clocks, the volume scale, and what "next" and "previous" mean
 * at the ends of the queue.
 */

/**
 * `m:ss` - how a running time reads in the display.
 *
 * An unknown or broken duration reads as `--:--` rather than `NaN:NaN`, which is what
 * a track still being fetched looks like.
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';

  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** The same clock for a value that may not exist yet (no media loaded). */
export function formatClockOrNothing(seconds: number | undefined): string {
  return seconds === undefined ? '--:--' : formatClock(seconds);
}

/** Somebody else's idea of a running time (`3:41`) as a track-list string. */
export function formatTrackLength(seconds: number): string {
  return Number.isFinite(seconds) && seconds > 0 ? formatClock(seconds) : '--:--';
}

/** Volume as the player holds it: a fraction, never outside 0..1. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * The next track, wrapping round at the end.
 *
 * Wrapping is deliberate rather than a side effect of the loop switch: a shelf of
 * three tracks should keep playing through the night, and the loop switch is about
 * repeating *one* track, not about what happens at the end of the queue.
 */
export function nextIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return (index + 1) % length;
}

/** The previous track, wrapping backwards - a skip back from the top is the last one. */
export function previousIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return (index - 1 + length) % length;
}

/**
 * Which track the player opens on.
 *
 * The bucket is what somebody just put there, so a track from it is preferred over the
 * archive's own theme; with nothing in the bucket the theme plays instead. An empty
 * queue answers 0, which the provider reads as "nothing to play".
 */
export function startIndexFor(queue: { id: string; shelf: string }[]): number {
  if (queue.length === 0) return 0;

  const fromBucket = queue.findIndex((track) => track.shelf === 'bucket');
  return fromBucket === -1 ? 0 : fromBucket;
}
