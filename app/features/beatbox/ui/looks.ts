// Tailwind classes shared by the controls. Colours and sizes all come from theme/tokens.css.
// Keys follow the site: `[ LABEL ]` in capitals, instant colour swaps, and a press is a small drop
// and a pink flash.

// Only for the keyboard: a key pressed with the mouse has no need of a ring round it afterwards.
export const focusOnly =
  "focus-visible:outline-(length:--focus-width) focus-visible:outline-offset-(length:--focus-width) focus-visible:outline-bb-daffodil";

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

// The slim bar holds a lot on a small screen: its words grow on a big one.
const barKeyCore = `bb-key-tight min-h-bb-target-bar min-w-bb-target-min cursor-pointer px-1 text-display font-bold uppercase whitespace-nowrap 2xl:px-2 2xl:text-bb-large ${focusOnly} ${pressed}`;

/** A key on the slim bar over the grid. */
export function barKey(on = false): string {
  return `${barKeyCore} ${on ? onKey : bracketKey}`;
}

/** The bar's one main key, filled so the eye lands on it first. */
export const barMainKey = `${barKeyCore} bg-bb-daffodil text-bb-black hover:bg-bb-emerald`;

/** A key on the strip of bars or the row under the grid. */
export function stripKey(on = false): string {
  return `min-h-bb-target-min min-w-bb-target-min px-1 cursor-pointer text-display font-bold uppercase whitespace-nowrap bb-key ${focusOnly} ${pressed} ${on ? onKey : bracketKey}`;
}

/** A beat on the ruler under the grid: a bare number, filled while that beat is on screen. */
export function rulerKey(on = false): string {
  return `min-h-bb-target-min min-w-11 cursor-pointer text-display font-bold ${focusOnly} ${pressed} ${on ? onKey : bracketKey}`;
}

// A key that's a glyph needs no brackets or words: see docs/design.md. Its name is in its label and its hint.
const glyphCore = `flex cursor-pointer items-center justify-center leading-none text-bb-glyph aria-disabled:cursor-not-allowed ${focusOnly} ${pressed}`;

/** A key that's one glyph, the size a finger needs. */
export function glyphKey(on = false): string {
  return `min-h-bb-target-min min-w-bb-target-min ${glyphCore} ${on ? onKey : bracketKey}`;
}

/** A glyph key on the slim bar over the grid. */
export function barGlyph(on = false): string {
  return `min-h-bb-target-bar min-w-bb-target-bar flex-col ${glyphCore} ${on ? onKey : bracketKey}`;
}

/** The bar's one main key, filled so the eye lands on it first. */
export const barMainGlyph = `min-h-bb-target-bar min-w-bb-target-large flex-col ${glyphCore} bg-bb-daffodil text-bb-black hover:bg-bb-emerald`;

/** A row in a list of things to pick from: words, flat, the whole row a target. */
export function listRow(on = false): string {
  return `relative flex min-h-bb-target-min w-full cursor-pointer items-center px-2 text-left text-display font-bold wrap-anywhere focus-visible:z-10 focus-visible:outline-(length:--focus-width) focus-visible:outline-bb-daffodil ${pressed} ${on ? onKey : "hover:bg-bb-daffodil hover:text-bb-nigrosine"}`;
}

/** A section's title, set between two rules. */
export const titleLine = "bb-title-line text-bb-large font-bold wrap-anywhere text-bb-daffodil uppercase";

/** The close key on a window's title line, which is a light colour. */
export const windowCloseKey = `flex min-h-bb-target-min min-w-bb-target-min flex-none cursor-pointer items-center justify-center text-bb-black text-bb-glyph leading-none hover:bg-bb-nigrosine hover:text-bb-white focus-visible:outline-(length:--focus-width) focus-visible:outline-bb-pink ${pressed}`;
