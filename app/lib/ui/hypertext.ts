/**
 * The site's link language, in one place.
 *
 * A web 1.0 page asked for things with text and nothing else: blue, underlined, and the
 * pointer changing over it. Windows 95 pop-up chrome is for the things that are windows -
 * the comment box, the customiser, the player. Asking to *do* something is a link, and
 * putting the two together is what made the profile read as a stack of grey buttons
 * instead of a page.
 *
 * So: a control is blue underlined text, a choice made from a run of them is the same text
 * inside a border just distinct enough to group the run, and the one in force is marked
 * with an arrow rather than a plate.
 */

/** Text that does something when it is pressed. */
export const HYPER_TEXT =
  'cursor-pointer text-[11px] font-bold leading-none text-ena underline underline-offset-2 hover:bg-sun hover:text-ink';

/** The same colours for text that is a link in prose rather than a control to the right of one. */
export const HYPER_LINK = 'font-bold text-ena underline underline-offset-2 hover:bg-sun hover:text-ink';

/**
 * A small arrow: the least a fold can be shown with and still be noticed.
 *
 * It carries the count with it (`▸ 3`), which is what makes the folded thread worth
 * folding - the number says whether there is anything behind it before it is opened.
 */
export const HYPER_ARROW = 'cursor-pointer px-1 text-[11px] font-bold leading-none text-ena hover:bg-sun hover:text-ink';

/** The run of choices: one thin border, so a group of links reads as one question. */
export const HYPER_STRIP =
  'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border border-ink bg-paper px-2 py-1';

/** The arrow drawn in front of the choice that is in force. */
export const HYPER_MARK = 'text-ena';

/** The small label a run of choices is introduced with (`ABOUT:`, `MIX:`). */
export const HYPER_LABEL = 'text-[10px] font-bold text-ink';
