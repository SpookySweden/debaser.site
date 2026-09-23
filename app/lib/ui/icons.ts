/**
 * The chrome's marks, in one place.
 *
 * A key the reader meets on every page - the arcade, the archive, the directory, the bell - cannot
 * live on a word alone: words are the same shape as the prose around them, and a row of them reads
 * as a paragraph with borders rather than as a row of hardware. Web 1.0 answered this the only way
 * it could, with a glyph off a character set: `♪`, `■`, `☻`, drawn by the font at the size the font
 * draws everything.
 *
 * That is exactly what these are, and the distinction matters: they are *characters*, not pictures.
 * Nothing here draws a joystick in CSS or in SVG - the asset rules (AGENTS.md) forbid code-drawn
 * artwork, and a line of box-drawing and dingbat glyphs is text, which the pixel face this site
 * loads renders as blocks in whole pixels anyway. When somebody wants a real hand-drawn icon, it
 * goes in `assets/icons/` and the component points a `<SpriteSlot>` at it (see
 * assets/icons/README.txt); until then a glyph is what a text-mode machine had.
 *
 * Every mark is paired with a word in `aria-label` at the point of use, because a glyph read aloud
 * is either its Unicode name ("eighth note") or nothing at all - and neither is what the key does.
 */

/** The archive: a cassette, or the note that came off one. */
export const ICON_MUSIC = '♪';

/** The arcade: a cabinet's screen and its two buttons, in as few cells as a glyph will spare. */
export const ICON_ARCADE = '◄►';

/** Where the reading happens. A house, because HOME is a house on every desktop ever drawn. */
export const ICON_HOME = '⌂';

/** The board: a ruled page. */
export const ICON_FORUM = '▤';

/** The directory: a person, seen from the front. */
export const ICON_USERS = '☻';

/** Comms: an envelope's flap, which is the one part of an envelope that reads at 10px. */
export const ICON_COMMS = '✉';

/** The account: a key, because that is what an account is here. */
export const ICON_ACCOUNT = '⚿';

/** A notice waiting. */
export const ICON_BELL = '☼';

/** What a mark means, so a page can print the legend once rather than beside every key. */
export const ICON_LEGEND: { key: string; mark: string; meaning: string }[] = [
  { key: 'music', mark: ICON_MUSIC, meaning: 'THE SOUNDTRACK ARCHIVE' },
  { key: 'games', mark: ICON_ARCADE, meaning: 'THE ARCADE FLOOR' },
  { key: 'users', mark: ICON_USERS, meaning: 'EVERY ACCOUNT ON THE SITE' },
  { key: 'comms', mark: ICON_COMMS, meaning: 'DIRECT MESSAGES' },
  { key: 'account', mark: ICON_ACCOUNT, meaning: 'YOUR OWN CABINET' },
];
