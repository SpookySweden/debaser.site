// Every key, for the help panel and the Settings window. The keys a person can change live in keyBindings.ts; the ones that
// stay as they are live here. When a key is added or changed, change it there or here too.
import { NOTE_KEY_LABELS } from "../input/computerKeys";
import { KEY_GROUPS, keyWords, type Bindings } from "./keyBindings";

export interface KeyGroup {
  readonly title: string;
  readonly keys: readonly (readonly [keys: string, action: string])[];
}

// Text glyphs, not drawings. The end of each stops the browser swapping in a coloured emoji.
const TEXT = "\uFE0E";
export const GLYPHS = {
  play: `\u25B6${TEXT}`,
  pause: "\u275A\u275A",
  stop: `\u25A0${TEXT}`,
  loop: `\u21BB${TEXT}`,
  record: `\u25CF${TEXT}`,
  undo: `\u21B6${TEXT}`,
  redo: `\u21B7${TEXT}`,
  sounds: `\u223F${TEXT}`,
  recorder: `\u25C9${TEXT}`,
  playing: `\u2328${TEXT}`,
  song: `\u266B${TEXT}`,
  settings: `\u2699${TEXT}`,
  bars: `\u25E7${TEXT}`,
  hand: `\u2725${TEXT}`,
  fill: `\u21CA${TEXT}`,
  close: `\u2715${TEXT}`,
  up: `\u25B2${TEXT}`,
  down: `\u25BC${TEXT}`,
  left: `\u25C0${TEXT}`,
  right: `\u25B6${TEXT}`,
  barBack: `\u25C1${TEXT}`,
  barOn: `\u25B7${TEXT}`,
  beat: `\u2669${TEXT}`,
} as const;

/** What the small keys mean, for anyone who'd rather read it than point at each one. */
export const KEY_FACES: KeyGroup = {
  title: "What the small keys are",
  keys: [
    [GLYPHS.play, "Play"],
    [GLYPHS.pause, "Pause"],
    [GLYPHS.stop, "Stop"],
    [GLYPHS.loop, "Loop on or off"],
    [GLYPHS.record, "Record"],
    [GLYPHS.undo, "Undo"],
    [GLYPHS.redo, "Redo"],
    [GLYPHS.beat, "The speed, in beats a minute"],
    [GLYPHS.sounds, "Sounds"],
    [GLYPHS.recorder, "Recorder"],
    [GLYPHS.playing, "Playing"],
    [GLYPHS.song, "Song"],
    [GLYPHS.settings, "Settings"],
    [GLYPHS.bars, "Show or hide the bars"],
    [GLYPHS.hand, "Hand: dragging moves the view"],
    ["13 25 37 49 All", "How many notes on the grid. 49 is a 49-key MIDI keyboard, C2 to C6. A song's own notes always show: the grid grows to fit them, and says so with a +"],
    [GLYPHS.fill, "This bar's pattern on the whole loop"],
    [`${GLYPHS.barBack} ${GLYPHS.barOn}`, "Previous and next bar"],
    [`${GLYPHS.up} ${GLYPHS.down} ${GLYPHS.left} ${GLYPHS.right}`, "Move the view. Hold to keep going"],
  ],
};

export const FIXED_KEYS: readonly KeyGroup[] = [
  {
    title: "Anywhere",
    keys: [["Esc", "Close the window in front. With none open, stop"]],
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
    title: "In the bars",
    keys: [
      ["Up and Down", "Earlier and later bar"],
      ["Left and Right", "Another channel"],
      ["Home and End", "First and last bar"],
      ["Ctrl+Home and Ctrl+End", "First and last bar of all channels"],
      ["Shift+Up and Shift+Down, or Shift+click", "Pick several bars"],
      ["L", "Set the loop to the picked bars"],
      ["F", "Put this bar's pattern on the whole loop"],
      ["Up and Down, on an end of the loop", "Move that end of the loop"],
      ["0 to 9", "Set the pattern. 0 is silent"],
      ["+ and -", "Next and previous pattern"],
      ["Enter", "Go to the notes"],
    ],
  },
  {
    title: "In the notes",
    keys: [
      ["Arrow keys", "Move. Off the end of a bar, on to the next"],
      ["Ctrl+Left and Ctrl+Right", "Jump a beat"],
      ["Enter", "Turn a note on or off"],
      ["Shift+Left and Shift+Right", "Make a note shorter or longer"],
      ["Delete or Backspace", "Delete a whole note or chord"],
      ["Home and End", "Start and end of the row"],
      ["Ctrl+Home and Ctrl+End", "First and last cell"],
      ["Page Up and Page Down", "Up and down a screenful"],
    ],
  },
  {
    title: "In a window",
    keys: [
      ["Arrow keys, on its title", "Move the window"],
      ["Enter, on a key", "Press that key. Space plays and pauses wherever you are, unless you've changed it"],
      ["Enter, in the link box", "Open that song"],
      ["Arrow keys, in a set of choices such as Mode", "Change the choice"],
    ],
  },
  {
    title: "With the mouse",
    keys: [
      ["Press a square", "Put a note, there and then. Keep holding and drag to make it longer or change its pitch"],
      ["Press a note and let go", "Take it away"],
      ["Press a note and drag", "Move it. Drag its right-hand end to change its length"],
      ["Drag the bar numbers", "Set the loop: the nearer end moves. Outside the loop, the whole loop moves there"],
      ["Drag a note name or a beat number, or drag with the right or middle button", "Move around the grid"],
      ["Ctrl and +", "Your browser's zoom makes everything bigger. The arrows take you around"],
    ],
  },
];

/** Every key as it is right now, the ones that have been changed included. */
export function keyHelp(bindings: Bindings): readonly KeyGroup[] {
  return [
    ...KEY_GROUPS.map(({ title, actions }) => ({
      title,
      keys: actions.map(({ id, label }): readonly [string, string] => [keyWords(bindings[id]), label]),
    })),
    ...FIXED_KEYS,
    KEY_FACES,
  ];
}
