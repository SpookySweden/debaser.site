// The three audio modes. Speech and music fight for the same ears, so each mode picks a balance.

export type AudioMode = "practice" | "sonify" | "perform";

export interface AudioBehaviour {
  /** Song and live notes, 0 to 1. */
  readonly volume: number;
  /** A screen reader is told about each change on the status line. */
  readonly speaksStatus: boolean;
  /** Moving the cursor in the grid plays that row's pitch. */
  readonly cursorTones: boolean;
  /** Turning a note on or off makes a click, higher for on. */
  readonly toggleClicks: boolean;
  /** Turning a note on plays it. */
  readonly hearsNewNotes: boolean;
  /** Grid cells give only the note and on or off, not the whole position. */
  readonly shortCellNames: boolean;
}

const BEHAVIOURS: Readonly<Record<AudioMode, AudioBehaviour>> = {
  practice: {
    volume: 0.5,
    speaksStatus: true,
    cursorTones: false,
    toggleClicks: false,
    hearsNewNotes: true,
    shortCellNames: false,
  },
  sonify: {
    volume: 1,
    speaksStatus: false,
    cursorTones: true,
    toggleClicks: true,
    hearsNewNotes: false,
    shortCellNames: true,
  },
  perform: {
    volume: 1,
    speaksStatus: false,
    cursorTones: false,
    toggleClicks: false,
    hearsNewNotes: false,
    shortCellNames: true,
  },
};

export function audioBehaviour(mode: AudioMode): AudioBehaviour {
  return BEHAVIOURS[mode];
}

export const AUDIO_MODES: readonly {
  readonly value: AudioMode;
  readonly label: string;
  readonly explanation: string;
}[] = [
  {
    value: "practice",
    label: "Practice",
    explanation: "Practice: music is quieter and every move is spoken, for learning the grid.",
  },
  {
    value: "sonify",
    label: "Sonify",
    explanation: "Sonify: short tones replace most speech. Pitch tells the row and a click tells on or off.",
  },
  {
    value: "perform",
    label: "Perform",
    explanation: "Perform: no speech or interface sounds, and the music is at full volume, for recording.",
  },
];
