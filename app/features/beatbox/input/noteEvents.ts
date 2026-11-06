// One stream of note events, whichever way they were played.

export type NoteSource = "midi" | "keys" | "pads";

export interface NoteEvent {
  readonly type: "on" | "off";
  /** MIDI note number. Middle C is 60. */
  readonly note: number;
  /** 0 to 127. */
  readonly velocity: number;
  /** When it happened, on the browser's clock in milliseconds (the same as `performance.now()`). */
  readonly time: number;
  readonly source: NoteSource;
}

export type NoteListener = (event: NoteEvent) => void;

export interface NoteStream {
  emit: NoteListener;
  subscribe(listener: NoteListener): () => void;
}

export function createNoteStream(): NoteStream {
  const listeners = new Set<NoteListener>();
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// General MIDI drum notes, mapped to the drum rows named in engine/songData.ts.
const GENERAL_MIDI_DRUMS: Readonly<Record<number, number>> = {
  35: 0, // kick
  36: 0,
  41: 1, // low toms
  43: 1,
  45: 2, // mid toms
  47: 2,
  38: 3, // snares
  40: 3,
  37: 4, // rim
  39: 5, // clap
  48: 6, // high toms
  50: 6,
  56: 7, // bell
  70: 8, // shaker
  82: 8,
  42: 9, // hats
  44: 9,
  46: 10, // open hat
  49: 11, // crashes
  57: 11,
};

/** Which of the 12 drum rows a note plays. Pads and keys go up the rows in order. */
export function noteToDrumRow(note: number, source: NoteSource): number {
  const standard = source === "midi" ? GENERAL_MIDI_DRUMS[note] : undefined;
  return standard ?? ((note % 12) + 12) % 12;
}
