// Tailwind classes shared by the controls. Colours and sizes all come from theme/tokens.css.
// Keys follow the site: `[ LABEL ]` in capitals, instant colour swaps, and a press is a small drop
// and a pink flash.

export const focusOnly =
  "focus:outline-(length:--focus-width) focus:outline-offset-(length:--focus-width) focus:outline-bb-daffodil";

const pressed = "active:translate-y-(--press-drop) active:bg-bb-pink active:text-bb-black";
const keyCore = `bb-key cursor-pointer text-bb-large font-bold uppercase ${focusOnly} ${pressed}`;
const keyShape = `${keyCore} px-bb-gutter`;

// A key that's on is filled, and its label says so too, so colour isn't the only sign.
const bracketKey = "text-bb-daffodil hover:bg-bb-daffodil hover:text-bb-nigrosine";
const onKey = "bg-bb-emerald text-bb-black";

/** A normal key, at least the size a finger needs. */
export function smallKey(on = false): string {
  return `min-h-bb-target-min min-w-bb-target-min ${keyShape} ${on ? onKey : bracketKey}`;
}

/** A key that matters more, twice the size. */
export function bigKey(on = false): string {
  return `min-h-bb-target-large min-w-bb-target-large ${keyShape} ${on ? onKey : bracketKey}`;
}

/** The one main action on the screen. */
export const mainKey = `min-h-bb-target-large min-w-bb-target-large bg-bb-daffodil text-bb-black hover:bg-bb-emerald ${keyShape}`;

/** A key on the slim bar over the grid: big words, little padding. */
export function barKey(on = false): string {
  return `min-h-bb-target-bar min-w-bb-target-min px-2 ${keyCore} ${on ? onKey : bracketKey}`;
}

/** The bar's one main key, filled so the eye lands on it first. */
export const barMainKey = `min-h-bb-target-bar min-w-bb-target-min px-2 bg-bb-daffodil text-bb-black hover:bg-bb-emerald ${keyCore}`;

/** A key on the strip of bars or the row under the grid. */
export function stripKey(on = false): string {
  return `min-h-bb-target-min min-w-bb-target-min px-1 cursor-pointer text-display font-bold uppercase whitespace-nowrap bb-key ${focusOnly} ${pressed} ${on ? onKey : bracketKey}`;
}

/** A beat on the ruler under the grid: a bare number, filled while that beat is on screen. */
export function rulerKey(on = false): string {
  return `min-h-bb-target-min min-w-11 cursor-pointer text-display font-bold ${focusOnly} ${pressed} ${on ? onKey : bracketKey}`;
}

/** A section's title, set between two rules. */
export const titleLine = "bb-title-line text-bb-large font-bold wrap-anywhere text-bb-daffodil uppercase";
