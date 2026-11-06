// Every key, for the help panel and the Settings window. The keys a person can change live in keyBindings.ts; the ones that
// stay as they are live here. When a key is added or changed, change it there or here too.
import { NOTE_KEY_LABELS } from "../input/computerKeys";
import { KEY_GROUPS, keyWords, type Bindings } from "./keyBindings";

export interface KeyGroup {
  readonly title: string;
  readonly keys: readonly (readonly [keys: string, action: string])[];
}

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
      ["Arrow keys, in a set of choices such as Mode or Size", "Change the choice"],
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
  ];
}
