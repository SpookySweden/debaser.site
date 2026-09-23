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
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-sun px-2 py-[2px] text-[10px] font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** The largest: a control that has its line to itself, or carries the form's weight. */
export const PLATE_LARGE =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-sun px-3 py-1 text-xs font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark max-sm:min-h-11 max-sm:px-4 max-sm:py-2 max-sm:text-base`;

/** The middle size: a panel control whose label needs the extra room. */
export const PLATE_MEDIUM =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-sun px-3 py-1 text-[10px] font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** Thumb-sized, for the phone's player: a plate has to be pressable with a thumb. */
export const PLATE_TAP =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-sun px-3 py-2 text-sm font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark`;

/**
 * The deck's own controls: the transport keys on the docked player.
 *
 * Bigger than any plate in a row of text, with the label always written out - `[ ▶ PLAY ]` rather than
 * a triangle - because a row of icon-only keys is a puzzle. They are also the one place the site
 * allows a black face: a transport key on a physical deck is not the same surface as the panel it is
 * bolted to, so these are black with a lime label, and a press turns them magenta.
 */
export const PLATE_HARDWARE =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-ink px-3 py-2 text-[11px] font-bold text-acid hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark max-sm:min-h-11 max-sm:px-4 max-sm:text-sm`;

/** A plate already pressed in: the tab you are standing on, the switch that is on. */
export const PLATE_PRESSED = `rounded-none ${BEVEL_IN} bg-ena px-2 py-[2px] text-[10px] font-bold text-sun`;

/** The plate drawn as a link: no pointer or disabled hints, because an anchor has neither. */
export const PLATE_LINK =
  `rounded-none ${BEVEL_OUT} bg-sun px-3 py-1 text-[10px] font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun active:translate-y-[1px] active:bg-bubble active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** An inset field: white, monospace, with the room it needs under its label. */
export const FIELD =
  'mt-1 w-full rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-[6px] font-mono text-xs text-ink outline-none focus:bg-sun-pale focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-bubble max-sm:p-3';

/** The same field where the row already carries its own spacing (the tag input). */
export const FIELD_TIGHT =
  'rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-1 text-xs text-ink outline-none focus:bg-sun-pale focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-bubble max-sm:p-2';

/**
 * A link in a page of writing: the dashed 3px bar, and the inversion on hover.
 *
 * The dashes are a repeating gradient rather than a border, so the rule under a word is made of
 * pixels like everything else here (see `.link-pixel` in app/globals.css). It is a shared string for
 * the same reason the plates are: a link in a post and a link in the archive should underline the
 * same way, and one of them drifting is how a site stops looking like one site.
 */
export const LINK_PIXEL = 'link-pixel cursor-pointer';

/**
 * The dark dithered field a hand-drawn GIF or walking avatar loops in.
 *
 * The site draws no artwork of its own (AGENTS.md, Asset Rules), so a slot like this is the space
 * *for* artwork: an empty room with the right size and the right floor, waiting for a file.
 */
export const SPRITE_SLOT = 'sprite-slot overflow-hidden rounded-none border border-black';

/* The chrome: title bars, panels and status bars, in one place. ------------------
   Every window and panel on the site wears the same navy title bar and the same
   raised grey plate, so a title bar is a title bar whatever it sits on top of. */

/** A panel's navy title bar: one slim line, the same height everywhere. */
export const TITLE_BAR =
  'flex items-center justify-between gap-2 bg-ena px-2 py-[3px] text-[11px] font-bold leading-none text-sun';

/**
 * The same bar, in the grey of a window that is not the one being worked in.
 *
 * Two title bars, one meaning each: navy is the window you are in, grey is the furniture
 * around it - the legend, the roster, the tray, anything that is there to be read rather
 * than typed into. It is the same distinction a desktop of this era made, and it is the
 * only thing that says which box the keyboard belongs to without a line of explanation.
 */
export const TITLE_BAR_INACTIVE =
  'flex items-center justify-between gap-2 bg-chrome-dark px-2 py-[3px] text-[11px] font-bold leading-none text-ink';

/** A window's navy title bar: the same line, a step up for the OS frame. */
export const WINDOW_TITLE_BAR =
  'flex items-center justify-between gap-2 bg-ena px-3 py-[4px] text-[13px] font-bold leading-none text-sun';

/** The frame's own bar when its window has been put aside: same line, grey. */
export const WINDOW_TITLE_BAR_INACTIVE =
  'flex items-center justify-between gap-2 bg-chrome-dark px-3 py-[4px] text-[13px] font-bold leading-none text-ink';

/** A raised grey plate: light top-left edge, dark bottom-right edge, no radius. */
export const PANEL =
  'rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale';

/**
 * The small white chip a shelf is linked with: the project strip across a page, and the same list on
 * the landing page. Two places, one chip - and a thumb-sized one, because on a phone the strip is
 * how anybody moves between shelves.
 */
export const SHELF_CHIP =
  'cursor-pointer rounded-none border border-ink bg-sun-pale px-2 py-[2px] text-ink hover:animate-bump hover:bg-ice hover:text-ena max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:px-3 max-sm:text-sm';

/** An inset surface pressed into a plate: dark top-left, light bottom-right. */
export const PANEL_INSET =
  'rounded-none border-2 border-t-black border-l-black border-r-white border-b-white';

/** A bevelled button small enough to sit in a navy title bar. */
export const TITLE_BAR_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-sun px-2 py-[1px] text-[10px] font-bold leading-none text-ink hover:bg-ena hover:text-sun active:animate-flash active:bg-bubble active:text-ink max-sm:px-3 max-sm:py-[4px] max-sm:text-sm';

/**
 * The plate that carries a verb onto the board: the one magenta face on the site.
 *
 * `[ INJECT TO POST ]` in the music archive is what this is for, and it is the one plate that is not
 * the yellow of the furniture. That is deliberate: every other control in that row acts on the archive
 * (play this, filter by that), and the one that acts on *the board* has to be findable at a glance
 * from across a list. Magenta rather than the blood red of a warning, because nothing is wrong - it is
 * the same thing the `♪ MP3` badge on a post is: this file belongs to a thread.
 */
export const PLATE_ACCENT =
  `cursor-pointer rounded-none ${BEVEL_OUT} bg-bubble px-2 py-[2px] text-[10px] font-bold text-ink hover:animate-wobble hover:bg-ena hover:text-sun focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid active:animate-flash active:translate-y-[1px] active:bg-acid active:text-ink active:border-t-black active:border-l-black active:border-r-white active:border-b-white disabled:cursor-not-allowed disabled:bg-chrome disabled:text-chrome-dark max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/**
 * Royal Blue, as a value rather than a class.
 *
 * Some CSS takes a colour and not a utility: `accent-color` on a range input is the one on this
 * site, and it is written inline because there is no Tailwind class for it. Rather than four
 * components each spelling `#1d3ca6`, the swatch's own value is named here, where the rest of the
 * vocabulary lives - so the number has exactly one source and it is the same one the `ena` token
 * is declared with in `app/globals.css`.
 */
export const ACCENT_COLOUR = '#1d3ca6';

/**
 * The status bar along the foot of a window: one slim line.
 */
export const STATUS_BAR =
  'flex flex-wrap items-center justify-between gap-2 border-t border-white bg-acid px-2 py-[3px] text-[10px] font-bold leading-none text-ink';

