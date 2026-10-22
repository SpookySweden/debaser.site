/**
 * The keys, and the fields that sit beside them, in one place.
 *
 * Every control on this site is the same outlined key (`.key` in app/globals.css): a 2px line in the
 * key's own ink whose corners step in one pixel, the way the buttons in *(the) Gnorp Apologue* are
 * drawn. It replaced the Win95 plate (SPEC-readability.md, 2026-10-22) - a Daffodil face with a
 * white-and-black bevel - which read as a wall of yellow and put every label on a moving surface.
 *
 * The sizes are named for the job rather than the numbers, so the choice is read off the
 * page: `PLATE` for a control in a row of text, `PLATE_LARGE` for one that is the only
 * thing on its line, `PLATE_MEDIUM` for a label-sized control on a panel, `PLATE_TAP` for
 * a phone, `PLATE_LINK` for the same plate drawn as a link, `PLATE_PRESSED` for a control
 * that is already down (the tab you are standing on), and `PLATE_MAIN` for the one action a
 * screen exists for (post, send, save, log in).
 *
 * **Three looks, and nothing in between.** At rest a key is outlined on the window's own fill. The
 * one main action is filled Daffodil with Black words. A key that is already down - a tab, a switch -
 * is a filled pill in the field ink. Hover is an instant colour swap (the words and the outline turn
 * the accent ink); nothing wobbles, because a label that moves is a label that cannot be read. The
 * press is the one movement left: a 1px drop and the Brilliant Pink flash, with no easing.
 */

/** The focus ring every key draws for the keyboard: dotted Brilliant Pink, one pixel off the outline. */
const KEY_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble';
/** The press: the key drops a pixel and flashes Brilliant Pink, with the plate ink on it. */
const KEY_PRESS = 'active:animate-flash active:translate-y-[1px] active:bg-bubble active:text-ink-plate';
/** A key that cannot be pressed: the outline turns dotted (`.key:disabled`) and the words go quiet. */
const KEY_DISABLED = 'disabled:cursor-not-allowed disabled:text-ink-quiet disabled:hover:text-ink-quiet';

/** The outline every frame and key wears; the bevel is gone, the names stay for the components that ask. */
export const BEVEL_OUT = 'frame';
export const BEVEL_IN = 'frame';
/** The press, for a control that is not a key: the same 1px drop. */
export const PRESSED = 'active:translate-y-[1px]';

/** A control in a row of text: `[ SHOW ]`, `[ ▶ PLAY ]`, `[ DELETE ]`. */
export const PLATE =
  `key cursor-pointer bg-sun-pale px-2 py-[2px] text-[13px] text-ink hover:text-accent-ink ${KEY_FOCUS} ${KEY_PRESS} ${KEY_DISABLED} max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** The largest: a control that has its line to itself. */
export const PLATE_LARGE =
  `key cursor-pointer bg-sun-pale px-3 py-1 text-[14px] text-ink hover:text-accent-ink ${KEY_FOCUS} ${KEY_PRESS} ${KEY_DISABLED} max-sm:min-h-11 max-sm:px-4 max-sm:py-2 max-sm:text-base`;

/**
 * The one action a screen exists for: `[ POST ]`, `[ SEND ]`, `[ SAVE ]`, `[ LOG IN ]`.
 *
 * Filled Daffodil with Black words, and only one per screen, so the eye lands on it first. Its fill
 * is `--key-fill` (`.key-fill`): Emerald under the pointer - a "go" - and the Brilliant Pink flash when it
 * is pressed. Its outline is the plate ink rather than the fill, because Daffodil on the bright theme's
 * Flavine window is 1.05:1 - without a Black edge the pill would vanish there. On the dark field the
 * Black edge melts into Nigrosine and the pill reads as filled.
 */
export const PLATE_MAIN =
  `key key-fill cursor-pointer [--key-fill:var(--color-sun)] [--frame-line:var(--color-ink-plate)] px-3 py-1 text-[14px] text-ink-plate hover:[--key-fill:var(--color-acid)] ${KEY_FOCUS} active:translate-y-[1px] active:[--key-fill:var(--color-bubble)] disabled:cursor-not-allowed disabled:[--key-fill:var(--color-chrome-dark)] disabled:text-ink max-sm:min-h-11 max-sm:px-4 max-sm:py-2 max-sm:text-base`;

/** The middle size: a panel control whose label needs the extra room. */
export const PLATE_MEDIUM =
  `key cursor-pointer bg-sun-pale px-3 py-1 text-[13px] text-ink hover:text-accent-ink ${KEY_FOCUS} ${KEY_PRESS} ${KEY_DISABLED} max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** Thumb-sized, for the phone's player: a plate has to be pressable with a thumb. */
export const PLATE_TAP =
  `key cursor-pointer bg-sun-pale px-3 py-2 text-sm text-ink hover:text-accent-ink ${KEY_FOCUS} ${KEY_PRESS} ${KEY_DISABLED}`;

/**
 * The deck's own controls: the transport keys on the docked player.
 *
 * Bigger than any plate in a row of text, with the label always written out - `[ ▶ PLAY ]` rather than
 * a triangle - because a row of icon-only keys is a puzzle. They are also the one place the site
 * allows a black face: a transport key on a physical deck is not the same surface as the panel it is
 * bolted to, so these are black with an Emerald label and outline, Daffodil under the pointer, and a
 * press turns them magenta.
 */
export const PLATE_HARDWARE =
  `key cursor-pointer bg-hardware px-3 py-2 text-[14px] text-acid hover:text-sun ${KEY_FOCUS} ${KEY_PRESS} disabled:cursor-not-allowed max-sm:min-h-11 max-sm:px-4 max-sm:text-sm`;

/** A key already down: the tab you are standing on, the switch that is on. A filled pill in the field ink. */
export const PLATE_PRESSED = `key key-fill key-on [--key-fill:var(--color-ink)] px-2 py-[2px] text-[13px] text-paper max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** The plate drawn as a link: no pointer or disabled hints, because an anchor has neither. */
export const PLATE_LINK =
  `key bg-sun-pale px-3 py-1 text-[13px] text-ink hover:text-accent-ink active:translate-y-[1px] active:bg-bubble active:text-ink-plate max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

/** A field: the paper you write on, inside the same notched outline, with the room it needs under its label. */
export const FIELD =
  'frame mt-1 w-full bg-paper p-[6px] font-mono text-[15px] text-ink outline-none focus:bg-sun-pale focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-bubble max-sm:p-3';

/** The same field where the row already carries its own spacing (the tag input). */
export const FIELD_TIGHT =
  'frame bg-paper p-1 text-[14px] text-ink outline-none focus:bg-sun-pale focus:outline-2 focus:outline-offset-1 focus:outline-dotted focus:outline-bubble max-sm:p-2';

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
 * The site draws no artwork of its own (CLAUDE.md, Asset Rules), so a slot like this is the space
 * *for* artwork: an empty room with the right size and the right floor, waiting for a file.
 */
export const SPRITE_SLOT = 'sprite-slot overflow-hidden rounded-none border border-black';

/* The chrome: title lines, panels and status lines, in one place. ------------------
   Every window and panel on the site wears the same notched outline (`.frame` in globals.css) and the
   same title line, `——— TITLE ———`, so a title is a title whatever it sits on top of. There are no bars
   any more (SPEC-readability.md): the Win95 navy strip became a rule with the name set into it. */

/** A panel's title line: the name between two rules, in the accent ink of the thing being worked in. */
export const TITLE_BAR = 'title-line text-accent-ink';

/**
 * The same line, in the field ink of a panel that is not the one being worked in.
 *
 * Two title lines, one meaning each: the accent ink (Daffodil on the dark theme, Royal Blue on the
 * bright one) is the window you are in, the field ink is the furniture around it - the legend, the
 * roster, the tray, anything that is there to be read rather than typed into. Only the colour of the
 * words and their rules differs, which is how Gnorp tells its windows apart too.
 */
export const TITLE_BAR_INACTIVE = 'title-line text-ink';

/** A window's title line: the same line, with a little more room for the OS frame. */
export const WINDOW_TITLE_BAR = 'title-line title-window px-3 py-[6px] text-accent-ink';

/** The frame's own title line when its window has been put aside. */
export const WINDOW_TITLE_BAR_INACTIVE = 'title-line title-window px-3 py-[6px] text-ink';

/** A panel: the window's fill inside the notched outline. */
export const PANEL = 'frame bg-sun-pale';

/**
 * The small white chip a shelf is linked with: the project strip across a page, and the same list on
 * the landing page. Two places, one chip - and a thumb-sized one, because on a phone the strip is
 * how anybody moves between shelves.
 */
export const SHELF_CHIP =
  'key cursor-pointer bg-sun-pale px-2 py-[2px] text-ink hover:text-accent-ink max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:px-3 max-sm:text-sm';

/** A well inside a panel - a page, a board: the same notched outline, filled by the caller. */
export const PANEL_INSET = 'frame';

/** A key small enough to sit at the end of a title line: `[ × ]`, `[ ⇲ ]`. */
export const TITLE_BAR_BUTTON =
  'key cursor-pointer bg-sun-pale px-2 py-[1px] text-[13px] leading-none text-ink hover:text-accent-ink active:animate-flash active:bg-bubble active:text-ink-plate max-sm:px-3 max-sm:py-[4px] max-sm:text-sm';

/**
 * A control whose face is a glyph rather than a word.
 *
 * The marks in `lib/ui/icons.ts` are one character wide, which is fine for a pointer and useless for a
 * thumb: a `13px` glyph with no padding is a target around 18px, and the platform guidance both Apple
 * and Material land on is 44. So on a phone the box grows and the glyph with it, while the desktop
 * keeps the small square that fits a title bar.
 *
 * It is a token rather than a rule in each component because the shell had drifted: `ProfileControl`,
 * `SiteNav` and the taskbar tray were each drawing their own small control, and none of the three had
 * a phone branch - which is how a site whose `StartMenu` rows are a careful 44px ends up with a row of
 * 18px glyphs directly above them.
 *
 * `-mx-1` at phone width is deliberate: the box grows, so the *gap* between two of these has to shrink
 * or a row of them stops fitting across the screen. It pulls the extra width back out of the margin
 * rather than out of the tap area.
 */
export const GLYPH_BUTTON =
  'key inline-flex cursor-pointer items-center justify-center bg-sun-pale text-ink hover:text-accent-ink active:bg-bubble active:text-ink-plate max-sm:-mx-1 max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2 max-sm:text-base';

/**
 * A space that a reveal is allowed to fill, because it is already there either way.
 *
 * The rule (CLAUDE.md, "Reveals take their space in both states"): pointing at something must not move
 * it, and must not move anything beside it. A hover reveal therefore has two honest shapes - out of
 * flow, or a box laid out in *both* states that merely swaps what is inside it. This is the second.
 *
 * The important part is what this does **not** say: there is no `hidden` and no `group-hover:flex` on
 * the box, because a box that only exists on hover is the bug. The box is always laid out at the width
 * its reveal will need; `REVEAL_CONTENTS` is what hides the contents, and the caller's own width class
 * is where the reserved width goes. So a caller writes `${REVEAL_SLOT} w-14` for a 56px picture and
 * puts the picture inside a `REVEAL_CONTENTS`.
 *
 * `empty:hidden` lets a slot with nothing in it collapse for real - which is fine, because nothing
 * arrives there later, so there is no second state to jump between.
 */
export const REVEAL_SLOT = 'shrink-0 empty:hidden';

/**
 * The contents of a `REVEAL_SLOT`: hidden until the row is pointed at or one of its controls is
 * focused, and laid out the rest of the time. `focus-within` as well as `group-hover`, because a
 * keyboard reader never hovers and a reveal that only appears for a pointer is half a control.
 */
export const REVEAL_CONTENTS = 'hidden group-hover:flex group-focus-within:flex';

/**
 * The two fills a row of the board wears, depending on whether the reader has read it.
 *
 * A forum's oldest reading habit, kept in this site's own two colours rather than a grey: a row that
 * has been read goes quiet in the surface the furniture is made of (`chrome-dark`, the same fill an
 * inactive title bar and a disabled plate wear - "this one is dealt with"), and a row with something
 * new in it stays on the field (`paper`, the plain white a visitor arrives to). The pair is the one
 * the dark theme can also hold, which is the point of it being these two tokens and not a new one:
 * Flavine carries Black ink at 19:1 and the dark theme's Royal Blue carries White at 9.34:1, so a
 * read row is readable in either theme without a second ink.
 *
 * Both posts and replies ask for them, and independently: a post the reader has opened can still
 * carry replies filed since, so a quiet post with a white reply in it is the ordinary state of a
 * thread that has been answered while nobody was looking (`app/lib/forum/read-state.ts`).
 */
export const ROW_READ = 'bg-chrome-dark text-ink';

/** The same row, with something in it this reader has not read yet. */
export const ROW_UNREAD = 'bg-paper text-ink';

/**
 * The plate that carries a verb onto the board: the one magenta face on the site.
 *
 * `[ INJECT TO POST ]` in the music archive is what this is for, and it is the one plate that is not
 * the yellow of the furniture. That is deliberate: every other control in that row acts on the archive
 * (play this, filter by that), and the one that acts on *the board* has to be findable at a glance
 * from across a list. Magenta rather than the blood red of a warning, because nothing is wrong - it is
 * the same thing the `♪ MP3` badge on a post is: this file belongs to a thread. A filled pill, Daffodil
 * under the pointer and Emerald when pressed, so it never flashes the pink it already is.
 */
export const PLATE_ACCENT =
  `key key-fill cursor-pointer [--key-fill:var(--color-bubble)] [--frame-line:var(--color-ink-plate)] px-2 py-[2px] text-[13px] text-ink-plate hover:[--key-fill:var(--color-sun)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acid active:translate-y-[1px] active:[--key-fill:var(--color-acid)] disabled:cursor-not-allowed disabled:[--key-fill:var(--color-chrome-dark)] disabled:text-ink max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm`;

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
 * The status line along the foot of a window: a rule in the field ink, and the quiet caption ink under it.
 */
export const STATUS_BAR =
  'flex flex-wrap items-center justify-between gap-2 border-t-2 border-ink px-2 py-[4px] text-[13px] leading-none text-ink-quiet';

