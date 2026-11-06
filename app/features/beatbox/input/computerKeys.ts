// The computer keyboard as a piano. The middle letter row is the white notes, and the row
// above is the black notes. Keys are read by position, so this works on any keyboard layout.
import type { NoteListener } from "./noteEvents";

const KEY_NOTES: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
};

export const NOTE_KEY_LABELS = "A W S E D F T G Y H U J K O L P ;";

/** Is this key one of the piano's, by its place on the keyboard? Z and X are, for the octave. */
export function isNoteKeyCode(code: string): boolean {
  return code === "KeyZ" || code === "KeyX" || KEY_NOTES[code] !== undefined;
}

const COMPUTER_KEY_VELOCITY = 100;
const LOWEST_OCTAVE = 0;
const HIGHEST_OCTAVE = 7;

export interface KeyPress {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly timeStamp: number;
}

export interface ComputerKeys {
  /** Returns true if the key was used, so it shouldn't do anything else. */
  keyDown(press: KeyPress): boolean;
  keyUp(press: Pick<KeyPress, "code" | "timeStamp">): void;
  /** Lets go of everything, such as when the window loses focus. */
  releaseAll(time: number): void;
  getOctave(): number;
  shiftOctave(by: number): number;
  /** MIDI note for a semitone above C in the current octave. */
  noteInOctave(semitone: number): number;
}

export function createComputerKeys(emit: NoteListener, startOctave = 4): ComputerKeys {
  let octave = startOctave;
  const held = new Map<string, number>();

  function noteInOctave(semitone: number): number {
    return (octave + 1) * 12 + semitone;
  }

  function shiftOctave(by: number): number {
    octave = Math.max(LOWEST_OCTAVE, Math.min(HIGHEST_OCTAVE, octave + by));
    return octave;
  }

  function release(code: string, time: number) {
    const note = held.get(code);
    if (note === undefined) return;
    held.delete(code);
    emit({ type: "off", note, velocity: 0, time, source: "keys" });
  }

  return {
    keyDown(press) {
      if (press.ctrlKey || press.altKey || press.metaKey) return false;
      if (press.code === "KeyZ" || press.code === "KeyX") {
        if (!press.repeat) shiftOctave(press.code === "KeyZ" ? -1 : 1);
        return true;
      }
      const semitone = KEY_NOTES[press.code];
      if (semitone === undefined) return false;
      if (press.repeat || held.has(press.code)) return true;
      const note = noteInOctave(semitone);
      held.set(press.code, note);
      emit({ type: "on", note, velocity: COMPUTER_KEY_VELOCITY, time: press.timeStamp, source: "keys" });
      return true;
    },
    keyUp(press) {
      release(press.code, press.timeStamp);
    },
    releaseAll(time) {
      for (const code of [...held.keys()]) release(code, time);
    },
    getOctave: () => octave,
    shiftOctave,
    noteInOctave,
  };
}
