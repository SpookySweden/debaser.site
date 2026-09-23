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
 * a phone, `PLATE_LINK` for the same plate drawn as a link, `PLATE_PRESSED` for a control
 * that is already down (the tab you are standing on).
 *
 * **Two states, and nothing in between.** Every plate here is `outset` at rest - 2px of
 * `#ffffff` up and left, 2px of `#000000` down and right - and **inverts to `inset`** the
 * moment it is held down, so a press is felt rather than inferred: the same edges swap
 * sides and the label appears to sink into the panel. There is no fade, no lift and no
 * transition of any kind; a state change is binary and immediate, which is what a physical
 * button does and what a modern hover effect does not.
 */

/** The bevel, in the two states a control has. Kept here so no component can invent a third. */
export const BEVEL_OUT = 'border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black';
export const BEVEL_IN = 'border-t-2 border-l-2 border-black border-r-2 border-b-2 border-white';
/** The same inversion as a press: an `active:` variant for any control that is not a plate. */
export const PRESSED =
  'rounded-none active:border-t-2 active:border-l-2 active:border-black active:border-r-2 active:border-b-2 active:border-white';

/** A control in a row of text: `[ SHOW ]`, `[ ▶ PLAY ]`, `[ DELETE ]`. */
export const PLATE =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-[#d4d0c8] active:bg-[#c0c0c0] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080] max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** The largest: a control that has its line to itself, or carries the form's weight. */
export const PLATE_LARGE =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-[#d4d0c8] active:bg-[#c0c0c0] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080] max-sm:min-h-11 max-sm:px-4 max-sm:py-2 max-sm:text-base`;

/** The middle size: a panel control whose label needs the extra room. */
export const PLATE_MEDIUM =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-[#d4d0c8] active:bg-[#c0c0c0] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080] max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** Thumb-sized, for the phone's player: a plate has to be pressable with a thumb. */
export const PLATE_TAP =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-3 py-2 text-sm font-bold text-black hover:bg-[#d4d0c8] active:bg-[#c0c0c0] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080]`;

/**
 * The deck's own controls: the transport keys on the docked player.
 *
 * Bigger than any plate in a row of text, with the label always written out - `[ ▶ PLAY ]`
 * rather than a triangle - because a row of icon-only keys is a puzzle. They are also the
 * one place the site allows a dark face: a transport key on a physical deck is not the same
 * grey as the panel it is bolted to.
 */
export const PLATE_HARDWARE =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-3 py-2 text-[11px] font-bold text-black hover:bg-[#d4d0c8] active:bg-[#808080] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080] max-sm:min-h-11 max-sm:px-4 max-sm:text-sm`;

/** A plate already pressed in: the tab you are standing on, the switch that is on. */
export const PLATE_PRESSED = `rounded-none ${BEVEL_IN} bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black`;

/** The plate drawn as a link: no pointer or disabled hints, because an anchor has neither. */
export const PLATE_LINK =
  `rounded-none ${BEVEL_OUT} bg-[#c0c0c0] px-3 py-1 text-[10px] font-bold text-black hover:bg-[#d4d0c8] active:border-t-black active:border-l-black active:border-r-white active:border-b-white max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** An inset field: white, monospace, with the room it needs under its label. */
export const FIELD =
  'mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-[6px] font-mono text-xs text-black outline-none focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-[#000080] max-sm:p-3';

/** The same field where the row already carries its own spacing (the tag input). */
export const FIELD_TIGHT =
  'rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 text-xs text-black outline-none focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-[#000080] max-sm:p-2';

/* The chrome: title bars, panels and status bars, in one place. ------------------
   Every window and panel on the site wears the same navy title bar and the same
   raised grey plate, so a title bar is a title bar whatever it sits on top of. */

/** A panel's navy title bar: one slim line, the same height everywhere. */
export const TITLE_BAR =
  'flex items-center justify-between gap-2 bg-[#000080] px-2 py-[3px] text-[11px] font-bold leading-none text-white';

/**
 * The same bar, in the grey of a window that is not the one being worked in.
 *
 * Two title bars, one meaning each: navy is the window you are in, grey is the furniture
 * around it - the legend, the roster, the tray, anything that is there to be read rather
 * than typed into. It is the same distinction a desktop of this era made, and it is the
 * only thing that says which box the keyboard belongs to without a line of explanation.
 */
export const TITLE_BAR_INACTIVE =
  'flex items-center justify-between gap-2 bg-[#808080] px-2 py-[3px] text-[11px] font-bold leading-none text-white';

/** A window's navy title bar: the same line, a step up for the OS frame. */
export const WINDOW_TITLE_BAR =
  'flex items-center justify-between gap-2 bg-[#000080] px-3 py-[4px] text-[13px] font-bold leading-none text-white';

/** The frame's own bar when its window has been put aside: same line, grey. */
export const WINDOW_TITLE_BAR_INACTIVE =
  'flex items-center justify-between gap-2 bg-[#808080] px-3 py-[4px] text-[13px] font-bold leading-none text-white';

/** A raised grey plate: light top-left edge, dark bottom-right edge, no radius. */
export const PANEL =
  'rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]';

/**
 * The small white chip a shelf is linked with: the project strip across a page, and the same list on
 * the landing page. Two places, one chip - and a thumb-sized one, because on a phone the strip is
 * how anybody moves between shelves.
 */
export const SHELF_CHIP =
  'cursor-pointer rounded-none border border-gray-500 bg-white px-2 py-[2px] hover:bg-yellow-100 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:px-3 max-sm:text-sm';

/** An inset surface pressed into a plate: dark top-left, light bottom-right. */
export const PANEL_INSET =
  'rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white';

/** A bevelled button small enough to sit in a navy title bar. */
export const TITLE_BAR_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[1px] text-[10px] font-bold leading-none text-black hover:bg-gray-300 max-sm:px-3 max-sm:py-[4px] max-sm:text-sm';

/**
 * The plate that carries a verb onto the board: navy, the colour the site gives a post.
 *
 * `[ INJECT TO POST ]` in the music archive is what this is for, and it is the one plate on the site
 * that is not the grey of the furniture. That is deliberate: every other control in that row acts on
 * the archive (play this, filter by that), and the one that acts on *the board* has to be findable at
 * a glance from across a list. Navy rather than the maroon of a warning, because it is the same thing
 * the `♪ MP3` badge on a post is: this file belongs to a thread.
 */
export const PLATE_ACCENT =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-[#000080] px-2 py-[2px] text-[10px] font-bold text-white hover:bg-[#0000a0] active:bg-[#000080] active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:text-[#808080] max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/**
 * The status bar along the foot of a window: one slim grey line.
 */
export const STATUS_BAR =
  'flex flex-wrap items-center justify-between gap-2 border-t border-white bg-[#c0c0c0] px-2 py-[3px] text-[10px] font-bold leading-none text-black';
