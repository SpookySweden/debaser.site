// Steps 2 to 5 of the plan: browser time to audio time, audio time to song position, and
// song position folded into the loop.
import { PARTS_PER_BEAT } from "../engine/songData";

export function partsPerSecond(beatsPerMinute: number): number {
  return (beatsPerMinute / 60) * PARTS_PER_BEAT;
}

export interface ClockPair {
  readonly contextTime: number;
  readonly performanceTime: number;
}

/** The moment on the audio clock of what the player was hearing when they played a note. */
export function eventToAudioTime(
  eventMs: number,
  clock: ClockPair,
  outputLatencySeconds: number,
  calibrationSeconds: number,
): number {
  return clock.contextTime + (eventMs - clock.performanceTime) / 1000 - outputLatencySeconds - calibrationSeconds;
}

export interface LoopShape {
  /** Parts from the start of the song to the start of the loop. */
  readonly startPart: number;
  readonly lengthParts: number;
}

export interface ClockAnchor {
  readonly audioTime: number;
  /** Parts from the start of the song. */
  readonly songPart: number;
  /** Parts of count-in still to come. Zero once the song is going. */
  readonly countInParts: number;
  readonly partsPerSecond: number;
}

export interface LoopClock {
  update(anchor: ClockAnchor): void;
  /**
   * Where this audio time falls, in parts since the start of the first pass. It keeps counting
   * up as the loop goes round, so pass 2 of a 384-part loop starts at 384. Null while the song
   * hasn't reached the loop.
   */
  partAt(audioTime: number): number | null;
}

function fold(part: number, length: number): number {
  return ((part % length) + length) % length;
}

export function createLoopClock({ startPart, lengthParts }: LoopShape): LoopClock {
  let known: { audioTime: number; part: number; partsPerSecond: number } | null = null;

  return {
    update({ audioTime, songPart, countInParts, partsPerSecond: rate }) {
      // Each Play can start a new audio clock from zero, and old readings mean nothing to it.
      if (known && audioTime < known.audioTime) known = null;
      let part: number;
      if (countInParts > 0) {
        part = -countInParts;
      } else if (songPart < startPart || songPart >= startPart + lengthParts) {
        known = null;
        return;
      } else {
        const inLoop = songPart - startPart;
        // The time passed says about how far it's come, which tells how many times the loop
        // has gone round, even if the browser has been too busy to report for a while.
        const expected = known ? known.part + (audioTime - known.audioTime) * known.partsPerSecond : inLoop;
        part = inLoop + Math.round((expected - inLoop) / lengthParts) * lengthParts;
      }
      known = { audioTime, part, partsPerSecond: rate };
    },
    partAt(audioTime) {
      if (!known) return null;
      return known.part + (audioTime - known.audioTime) * known.partsPerSecond;
    },
  };
}

/** Where a position lands inside the loop. */
export function foldIntoLoop(part: number, lengthParts: number): number {
  return fold(part, lengthParts);
}
