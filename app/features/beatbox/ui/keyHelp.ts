// Every key, for the help panel. When a key is added or changed, change it here too.
import { NOTE_KEY_LABELS } from "../input/computerKeys";

export interface KeyGroup {
  readonly title: string;
  readonly keys: readonly (readonly [keys: string, action: string])[];
}

export const KEY_HELP: readonly KeyGroup[] = [
  {
    title: "Anywhere",
    keys: [
      ["?", "Open this help"],
      ["Space", "Play or stop, unless a button has the focus"],
      ["Esc", "Stop"],
      ["R", "Record, or stop recording and keep playing"],
      ["Ctrl+Z", "Undo. A recorded pass is one undo"],
      ["Ctrl+Y or Ctrl+Shift+Z", "Redo"],
      ["[ and ]", "Slower and faster"],
      ["B", "Notes follow the playing bar, on or off"],
      ["I", "Change audio mode: Practice, Sonify, Perform"],
      [".", "Focus view: only the notes, on or off"],
      [",", "High contrast, on or off"],
      ["- and =", "Smaller and bigger grid"],
    ],
  },
  {
    title: "Playing notes",
    keys: [
      [NOTE_KEY_LABELS, "Play notes, from low to high"],
      ["Z and X", "Octave down and up"],
      ["Tab to a pad, then Enter or Space", "Play that pad for as long as you hold it"],
    ],
  },
  {
    title: "Loop recorder",
    keys: [
      ["V", "Overdub or Replace"],
      ["N", "Count-in: off, 1 bar, 2 bars"],
      ["M", "Metronome: off, count-in only, always"],
      ["Q", "Quantise. This also moves the last pass to match"],
      ["C", "Capture: keep the last pass you played without recording"],
    ],
  },
  {
    title: "In the bars",
    keys: [
      ["Arrow keys", "Move"],
      ["Home and End", "First and last bar"],
      ["Ctrl+Home and Ctrl+End", "First and last bar of all channels"],
      ["Shift+Left and Shift+Right", "Pick several bars"],
      ["L", "Loop the picked bars"],
      ["0 to 9", "Set the pattern. 0 is silent"],
      ["+ and -", "Next and previous pattern"],
      ["Enter", "Go to the notes"],
    ],
  },
  {
    title: "In the notes",
    keys: [
      ["Arrow keys", "Move"],
      ["Enter", "Turn a note on or off"],
      ["Shift+Left and Shift+Right", "Make a note shorter or longer"],
      ["Delete", "Delete a whole note or chord"],
      ["Home and End", "Start and end of the row"],
      ["Ctrl+Home and Ctrl+End", "First and last cell"],
      ["Page Up and Page Down", "Up and down a screenful"],
    ],
  },
  {
    title: "Opening and saving",
    keys: [
      ["Enter, in the link box", "Open that song"],
      ["Tab to a Save button, then Enter", "Save a .mid, .wav or song file, or copy a share link"],
    ],
  },
  {
    title: "In a set of choices, such as Mode or Size",
    keys: [["Arrow keys", "Change the choice"]],
  },
];
