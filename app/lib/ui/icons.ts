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

/**
 * The queue window: a loop, because that is what it holds.
 *
 * The glyph rather than a drawing, like every other mark here - and it is the right one twice over: a
 * loop is a place you return to, and the window's two halves are both about returning (to where you
 * were, and to what somebody else is playing).
 */
export const ICON_LOOP = '↻';

/**
 * The six mass shapes, as glyphs.
 *
 * **A 2D stand-in for a 3D vocabulary, and it is glyphs rather than drawings.** The asset rules forbid code-drawn
 * artwork, and a shape picker is the one control where a picture is genuinely wanted - so this is the same answer
 * `icons.ts` gives for every other key: a character off the font. The glyph face this site loads renders them as
 * whole blocks, which is exactly the right register next to the six-shape grid.
 *
 * **Read from `MASS_SHAPE_IDS` rather than declared as a parallel list**, so a shape added to the vocabulary
 * without a glyph is a missing mark in a grid rather than a control that silently cannot be drawn - and
 * `Temp/check-character-shapes.cjs` fails on the gap either way.
 *
 * The box characters are chosen to be *distinguishable at 10px* first and descriptive second: `█` for a filled
 * box, `●` for a sphere, `▲` for a cone's taper, `▮` for an even cylinder, `⬭` for a capsule's rounded end, and
 * `◣` for a wedge's single slope. A reader learns them in one pass of the grid.
 */
export const MASS_SHAPE_GLYPHS: Record<string, string> = {
  box: '█',
  sphere: '●',
  cone: '▲',
  cylinder: '▮',
  capsule: '⬭',
  wedge: '◣',
  prism: '△',
};
export const ICON_LEGEND: { key: string; mark: string; meaning: string }[] = [
  { key: 'music', mark: ICON_MUSIC, meaning: 'THE SOUNDTRACK ARCHIVE' },
  { key: 'games', mark: ICON_ARCADE, meaning: 'THE ARCADE FLOOR' },
  { key: 'users', mark: ICON_USERS, meaning: 'EVERY ACCOUNT ON THE SITE' },
  { key: 'comms', mark: ICON_COMMS, meaning: 'DIRECT MESSAGES' },
  { key: 'account', mark: ICON_ACCOUNT, meaning: 'YOUR OWN CABINET' },
  { key: 'queues', mark: ICON_LOOP, meaning: 'WHERE YOU WERE, AND WHO IS LISTENING' },
];
