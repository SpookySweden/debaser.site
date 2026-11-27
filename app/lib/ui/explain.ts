/**
 * EXPLAIN (Luke, 2026-11-27: "for mysake make it so that hovering over any buttons gives a detailed explaination of the function and
 * purpose so i can continue to work on the readability and functionality of the ui"). Every key carries its own explanation in the
 * code, beside the key, and the one box (`ExplainLayer.tsx`) shows it when the pointer rests on the key or the keyboard lands on it,
 * while the reader's `[ EXPLAIN ]` switch is on (`./explain-mode.ts`). Nothing is drawn beside a key on screen: the words only ever
 * show in the box.
 *
 * A key carries `{...explain(what, why, note)}`:
 * - `what`: what a press does, in a sentence or two.
 * - `why`: what it is for, when you'd use it.
 * - `note`: only when it applies, the thing to know before pressing (one of `NOTE` below, or its own words).
 *
 * `Temp/check-explain.cjs` lists every key on the site with no explanation, and fails. Pure and free of imports, so a server
 * component, a list of modules or a check can use it.
 */

export type ExplainProps = {
  'data-explain': string;
  'data-explain-why'?: string;
  'data-explain-note'?: string;
};

/** The words a key carries, as attributes the box reads. */
export function explain(what: string, why?: string, note?: string): ExplainProps {
  const props: ExplainProps = { 'data-explain': what };
  if (why !== undefined && why !== '') props['data-explain-why'] = why;
  if (note !== undefined && note !== '') props['data-explain-note'] = note;
  return props;
}

/** An explanation kept in a list (a module, a theme), turned into the key's attributes. */
export type Explanation = { what: string; why?: string; note?: string };

export function explainFrom(words: Explanation): ExplainProps {
  return explain(words.what, words.why, words.note);
}

/** The cautions that come up again and again, said the same way everywhere. */
export const NOTE = {
  undo: "CAN'T BE UNDONE.",
  others: 'OTHER PEOPLE SEE THIS.',
  account: 'NEEDS AN ACCOUNT: SIGNED OUT, IT ASKS YOU TO LOG IN.',
  leaves: 'OPENS ANOTHER SITE IN A NEW TAB.',
  asks: 'ASKS YOU FIRST BEFORE ANYTHING IS LOST.',
  moderators: 'ONLY MODERATORS SEE THIS KEY.',
} as const;

/** What the box is called on the page, for `aria-describedby`. */
export const EXPLAIN_BOX_ID = 'explain-box';

/** The room between the key and the box, and between the box and the screen's edge. */
const GAP = 6;
const EDGE = 8;

/**
 * Where the box goes for a key: under it, else over it, else beside it, always inside the screen. Pure, so a check can hold it.
 * `key` and `box` are the two rectangles; `width` and `height` the screen's.
 */
export function placeExplainBox(
  key: { left: number; top: number; right: number; bottom: number },
  box: { width: number; height: number },
  width: number,
  height: number,
): { left: number; top: number } {
  const clampLeft = (left: number) => Math.max(EDGE, Math.min(left, width - EDGE - box.width));
  const clampTop = (top: number) => Math.max(EDGE, Math.min(top, height - EDGE - box.height));
  if (key.bottom + GAP + box.height <= height - EDGE) return { left: clampLeft(key.left), top: key.bottom + GAP };
  if (key.top - GAP - box.height >= EDGE) return { left: clampLeft(key.left), top: key.top - GAP - box.height };
  // A key too tall for the box above or below it (a whole row): beside it, on whichever side has room.
  const right = key.right + GAP;
  const left = right + box.width <= width - EDGE ? right : Math.max(EDGE, key.left - GAP - box.width);
  return { left, top: clampTop(key.top) };
}

