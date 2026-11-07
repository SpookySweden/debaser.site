// The keyboard keys a person can change, what they start as, and the rules for changing them. Kept in this browser.
import { isNoteKeyCode } from "../input/computerKeys";

export type KeyAction =
  | "playPause"
  | "stop"
  | "loop"
  | "slower"
  | "faster"
  | "follow"
  | "undo"
  | "redo"
  | "record"
  | "capture"
  | "recordMode"
  | "countIn"
  | "metronome"
  | "quantise"
  | "windowSounds"
  | "windowRecorder"
  | "windowPlaying"
  | "windowSong"
  | "windowSettings"
  | "help"
  | "bars"
  | "sidePanel"
  | "audioMode"
  | "focusView"
  | "contrast"
  | "hand"
  | "gridSize"
  | "gridUp"
  | "gridDown";

export interface KeyActionInfo {
  readonly id: KeyAction;
  readonly label: string;
  /** The key it starts as. */
  readonly starts: string;
  /** Another key that also does it, for as long as the key above hasn't been changed. */
  readonly also?: string;
}

export interface KeyActionGroup {
  readonly title: string;
  readonly actions: readonly KeyActionInfo[];
}

export const KEY_GROUPS: readonly KeyActionGroup[] = [
  {
    title: "Playing the song",
    actions: [
      { id: "playPause", label: "Play or pause", starts: "Space" },
      { id: "stop", label: "Stop, and go back to the picked bar", starts: "Escape" },
      { id: "loop", label: "Loop on or off", starts: "Shift+KeyL" },
      { id: "slower", label: "Slower", starts: "[" },
      { id: "faster", label: "Faster", starts: "]" },
      { id: "follow", label: "Notes follow the playing bar", starts: "KeyB" },
    ],
  },
  {
    title: "Changing the song",
    actions: [
      { id: "undo", label: "Undo. A recorded pass is one undo", starts: "Ctrl+KeyZ" },
      { id: "redo", label: "Redo", starts: "Ctrl+KeyY", also: "Ctrl+Shift+KeyZ" },
    ],
  },
  {
    title: "Recorder",
    actions: [
      { id: "record", label: "Record, or stop recording and keep playing", starts: "KeyR" },
      { id: "capture", label: "Capture: keep the last pass you played without recording", starts: "KeyC" },
      { id: "recordMode", label: "Overdub or Replace", starts: "KeyV" },
      { id: "countIn", label: "Count-in: off, 1 bar, 2 bars", starts: "KeyN" },
      { id: "metronome", label: "Metronome: off, count-in only, always", starts: "KeyM" },
      { id: "quantise", label: "Quantise. This also moves the last pass to match", starts: "KeyQ" },
    ],
  },
  {
    title: "Windows",
    actions: [
      { id: "windowSounds", label: "Open or close Sounds", starts: "Shift+KeyS" },
      { id: "windowRecorder", label: "Open or close Recorder", starts: "Shift+KeyR" },
      { id: "windowPlaying", label: "Open or close Playing", starts: "Shift+KeyP" },
      { id: "windowSong", label: "Open or close Song", starts: "Shift+KeyO" },
      { id: "windowSettings", label: "Open or close Settings", starts: "/" },
      { id: "help", label: "All the keys, on one page to read or print", starts: "?" },
      { id: "bars", label: "Show or hide the bars", starts: "'" },
      { id: "sidePanel", label: "Bring back or fold away the side panel", starts: "\\" },
    ],
  },
  {
    title: "Seeing and hearing",
    actions: [
      { id: "audioMode", label: "Change audio mode: Practice, Sonify, Perform", starts: "KeyI" },
      { id: "focusView", label: "Focus view: the notes and little else, on or off", starts: "." },
      { id: "contrast", label: "High contrast, on or off", starts: "," },
      { id: "hand", label: "Hand: dragging moves the view, not the notes", starts: "Shift+KeyH" },
      { id: "gridSize", label: "How many notes on the grid: 13, 25, 37, 49 or all", starts: "Shift+KeyG" },
      { id: "gridUp", label: "The grid up an octave", starts: "Shift+KeyU" },
      { id: "gridDown", label: "The grid down an octave", starts: "Shift+KeyD" },
    ],
  },
];

const ALL_ACTIONS: readonly KeyActionInfo[] = KEY_GROUPS.flatMap((group) => group.actions);

export type Bindings = Readonly<Record<KeyAction, string>>;

export const STARTING_KEYS = Object.fromEntries(ALL_ACTIONS.map(({ id, starts }) => [id, starts])) as Bindings;

export interface KeyStroke {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * A key press as one piece of text, or null for a modifier held by itself. Letters go by their place on the keyboard, as the
 * piano keys do, so they work on any layout. Other printed characters go by what they print, which already says Shift or not.
 */
export function strokeOf({ key, code, ctrlKey, shiftKey }: KeyStroke): string | null {
  if (["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified"].includes(key)) return null;
  const ctrl = ctrlKey ? "Ctrl+" : "";
  if (/^Key[A-Z]$/.test(code)) return `${ctrl}${shiftKey ? "Shift+" : ""}${code}`;
  if (key === " ") return `${ctrl}${shiftKey ? "Shift+" : ""}Space`;
  if (key.length === 1) return `${ctrl}${key}`;
  return `${ctrl}${shiftKey ? "Shift+" : ""}${key}`;
}

/** A stroke in the words a person knows it by. */
export function keyWords(stroke: string): string {
  return stroke.replace(/Key([A-Z])$/, "$1").replace(/Escape$/, "Esc");
}

/** Which action a key press means, if any. */
export function actionFor(bindings: Bindings, stroke: string): KeyAction | null {
  for (const { id } of ALL_ACTIONS) {
    if (bindings[id] === stroke) return id;
  }
  for (const { id, starts, also } of ALL_ACTIONS) {
    if (also === stroke && bindings[id] === starts) return id;
  }
  return null;
}

export function actionLabel(action: KeyAction): string {
  return ALL_ACTIONS.find(({ id }) => id === action)?.label ?? action;
}

const MOVING_KEYS = new Set(["Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Delete", "Backspace"]);
const BROWSER_KEYS = new Set(["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]);
// The letters that do something in a browser with Ctrl held, some of which a page can't even stop.
const BROWSER_CTRL_LETTERS = new Set(["A", "C", "D", "F", "H", "J", "K", "L", "N", "O", "P", "R", "S", "T", "U", "V", "W", "X"]);

/** Why a key can't be given a job, in words for the person pressing it. Null if it can. */
export function whyNot(stroke: string, code = ""): string | null {
  const base = stroke.replace(/^(Ctrl\+)?(Shift\+)?/, "");
  const ctrl = stroke.startsWith("Ctrl+");
  const shift = stroke.includes("Shift+");
  const words = keyWords(stroke);
  if (MOVING_KEYS.has(base)) return `${words} works the notes and bars, so it can't be changed.`;
  if (BROWSER_KEYS.has(base)) return `${words} belongs to your browser.`;
  if (ctrl) {
    const letter = /^Key([A-Z])$/.exec(base)?.[1];
    if (shift ? stroke !== "Ctrl+Shift+KeyZ" : letter === undefined || BROWSER_CTRL_LETTERS.has(letter)) return `${words} belongs to your browser.`;
    return null;
  }
  if (!shift && (isNoteKeyCode(base) || isNoteKeyCode(code) || base === ";")) return `${words} plays notes, so it can't be changed.`;
  if (/^[0-9]$/.test(base)) return `In the bars, ${words} sets the pattern, so it can't be changed.`;
  return null;
}

/** Which other action already has this key. */
export function clashWith(bindings: Bindings, action: KeyAction, stroke: string): KeyAction | null {
  const other = actionFor(bindings, stroke);
  return other === action ? null : other;
}

/** Gives an action a key. If another action had that key, the two swap. */
export function bind(bindings: Bindings, action: KeyAction, stroke: string): Bindings {
  const other = clashWith(bindings, action, stroke);
  return { ...bindings, ...(other ? { [other]: bindings[action] } : {}), [action]: stroke };
}

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "debaser.beatbox.keys.v1";

/** The keys this browser remembers. Anything it can't use goes back to where it started. */
export function loadBindings(storage: KeyStorage | null): Bindings {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<KeyAction, unknown>>;
    let bindings = STARTING_KEYS;
    for (const { id } of ALL_ACTIONS) {
      const stroke = saved[id];
      if (typeof stroke === "string" && stroke !== bindings[id] && (stroke === "Escape" || whyNot(stroke) === null)) {
        bindings = bind(bindings, id, stroke);
      }
    }
    return bindings;
  } catch {
    return STARTING_KEYS;
  }
}

export function saveBindings(storage: KeyStorage | null, bindings: Bindings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // A browser that won't keep them only forgets them next time.
  }
}
