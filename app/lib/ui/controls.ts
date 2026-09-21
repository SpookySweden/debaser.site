/**
 * The Win95 plate, and the fields that sit in it, in one place.
 *
 * Every control on this site is the same raised grey rectangle: a light top-left edge, a
 * dark bottom-right one, no radius, and the pointer changing over it. It was declared by
 * hand in sixteen components before this file existed, at four sizes - which is how one
 * raised edge ends up with three different border widths.
 *
 * The sizes are named for the job rather than the numbers, so the choice is read off the
 * page: `PLATE` for a control in a row of text, `PLATE_LARGE` for one that is the only
 * thing on its line, `PLATE_MEDIUM` for a label-sized control on a panel, `PLATE_TAP` for
 * a phone, `PLATE_LINK` for the same plate drawn as a link.
 */

/** A control in a row of text: `[ SHOW ]`, `[ ▶ PLAY ]`, `[ DELETE ]`. */
export const PLATE =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** The largest: a control that has its line to itself, or carries the form's weight. */
export const PLATE_LARGE =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** The middle size: a panel control whose label needs the extra room. */
export const PLATE_MEDIUM =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** Thumb-sized, for the phone's player: a plate has to be pressable with a thumb. */
export const PLATE_TAP =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-2 text-sm font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

/** The plate drawn as a link: no pointer or disabled hints, because an anchor has neither. */
export const PLATE_LINK =
  'rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-gray-300';

/** An inset field: white, monospace, with the room it needs under its label. */
export const FIELD =
  'mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none';

/** The same field where the row already carries its own spacing (the tag input). */
export const FIELD_TIGHT =
  'rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 text-xs text-black outline-none';
