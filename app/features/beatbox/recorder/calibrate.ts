// The tap-along calibration: how far ahead or behind the beat someone's taps land,
// which is the audio delay this computer has that the browser can't see.
import { PARTS_PER_BEAT } from "../engine/songData";

const FEWEST_TAPS = 4;

/**
 * The player's usual distance from the nearest beat, in seconds. Later than the beat is
 * positive. Null when there are too few taps to tell.
 */
export function calibrationOffset(tapParts: readonly number[], partsPerSecond: number): number | null {
  if (tapParts.length < FEWEST_TAPS) return null;
  const distances = tapParts
    .map((part) => part - Math.round(part / PARTS_PER_BEAT) * PARTS_PER_BEAT)
    .sort((a, b) => a - b);
  // The middle tap, so one stray tap can't throw it off.
  const middle = distances[Math.floor(distances.length / 2)] as number;
  return middle / partsPerSecond;
}
