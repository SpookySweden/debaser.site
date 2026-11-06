// Steps 5 to 7 of the plan: pairs notes up and keeps each pass as a raw, unquantised take.
// No screen, no sound, no clock: it is told positions, in parts since the start of pass 1.

export interface RawNote {
  readonly pitch: number;
  /** 0 to 127. */
  readonly velocity: number;
  /** Parts from the loop start. Not rounded. */
  readonly start: number;
  readonly end: number;
  /** It was already sounding when this pass began, held over the loop end. */
  readonly continued: boolean;
  /** It was still sounding when this pass ended. */
  readonly heldOver: boolean;
}

export interface Take {
  /** 1 is the first pass. */
  readonly passNumber: number;
  readonly loopParts: number;
  /** The span of the loop this pass went through. */
  readonly crossedFrom: number;
  readonly crossedTo: number;
  readonly notes: readonly RawNote[];
}

// A note played just before the loop starts is the player arriving early on the first beat.
// Half a beat, as nothing else could be meant by a note that close during a count-in.
const EARLY_GRACE_PARTS = 12;
// A pass stays open just past its end, as the last note played may still be on its way.
const LATE_GRACE_PARTS = 4;

export interface LoopRecorder {
  noteOn(pitch: number, velocity: number, part: number): void;
  noteOff(pitch: number, part: number): void;
  /** Says where the song has got to. Returns any passes that have now ended. */
  advance(part: number): readonly Take[];
  /** Ends the pass in progress here. Returns it, after any others that had ended unreported. */
  finish(part: number): readonly Take[];
}

export function createLoopRecorder({ loopParts, fromPart }: { loopParts: number; fromPart: number }): LoopRecorder {
  let passIndex = Math.max(0, Math.floor(fromPart / loopParts));
  let crossedFrom = fromPart < 0 ? 0 : fromPart - passIndex * loopParts;
  let notes: RawNote[] = [];
  const open = new Map<number, { velocity: number; start: number; continued: boolean }>();
  const ended: Take[] = [];

  function passStart(): number {
    return passIndex * loopParts;
  }

  function toLoop(part: number): number {
    return Math.max(0, Math.min(loopParts, part - passStart()));
  }

  function closeNote(pitch: number, end: number, heldOver: boolean) {
    const note = open.get(pitch);
    if (!note) return;
    open.delete(pitch);
    notes.push({ pitch, velocity: note.velocity, start: note.start, end, continued: note.continued, heldOver });
  }

  function endPass(crossedTo: number): Take {
    for (const pitch of [...open.keys()]) closeNote(pitch, crossedTo, true);
    return {
      passNumber: passIndex + 1,
      loopParts,
      crossedFrom,
      crossedTo,
      notes: [...notes].sort((a, b) => a.start - b.start),
    };
  }

  function rollOverTo(part: number) {
    while (part >= passStart() + loopParts) {
      const held = [...open.entries()].map(([pitch, note]) => ({ pitch, velocity: note.velocity }));
      ended.push(endPass(loopParts));
      passIndex++;
      crossedFrom = 0;
      notes = [];
      // Step 6: a note held over the loop end carries on from the loop start.
      for (const { pitch, velocity } of held) open.set(pitch, { velocity, start: 0, continued: true });
    }
  }

  return {
    noteOn(pitch, velocity, part) {
      if (part < -EARLY_GRACE_PARTS) return;
      rollOverTo(part);
      closeNote(pitch, toLoop(part), false);
      open.set(pitch, { velocity, start: toLoop(part), continued: false });
    },
    noteOff(pitch, part) {
      rollOverTo(part);
      closeNote(pitch, toLoop(part), false);
    },
    advance(part) {
      rollOverTo(part - LATE_GRACE_PARTS);
      return ended.splice(0);
    },
    finish(part) {
      rollOverTo(part);
      const take = endPass(toLoop(part));
      passIndex++;
      crossedFrom = 0;
      notes = [];
      if (take.crossedTo > take.crossedFrom) ended.push(take);
      return ended.splice(0);
    },
  };
}
