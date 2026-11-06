// Tailwind classes shared by the controls. Colours and sizes all come from theme/tokens.css.
// Keys follow the site: `[ LABEL ]` in capitals, instant colour swaps, and a press is a small drop
// and a pink flash.

export const focusOnly =
  "focus:outline-(length:--focus-width) focus:outline-offset-(length:--focus-width) focus:outline-bb-daffodil";

const pressed = "active:translate-y-(--press-drop) active:bg-bb-pink active:text-bb-black";
const keyShape = `bb-key cursor-pointer px-bb-gutter text-bb-large font-bold uppercase ${focusOnly} ${pressed}`;

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

/** A section's title, set between two rules. */
export const titleLine = "bb-title-line text-bb-large font-bold wrap-anywhere text-bb-daffodil uppercase";
