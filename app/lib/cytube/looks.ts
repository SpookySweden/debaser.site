/**
 * Broadcaster looks (SPEC-cytube.md, "Look presets"; Luke OK'd all five, 2026-11-03). Pure and client-safe;
 * `scripts/check-cytube.cjs` holds it.
 *
 * A look colours one room: the stream bar's strip, its words and keys, the screen's frame, the LED's words and
 * the queue window's frame and title. Its colours are in `app/theme/tokens.css` (the `.look-<id>` blocks), so
 * this file holds only the names: which looks exist, what each is called, and which one a viewer sees.
 */

export const LOOK_IDS = ['nigrosine', 'royal', 'blood', 'jungle', 'orchid'] as const;

export type LookId = (typeof LOOK_IDS)[number];

export type Look = { id: LookId; label: string; note: string };

/** The picker's order, quiet first. Notes are the spec's plain-English lines, cut to a phrase. */
export const LOOKS: readonly Look[] = [
  { id: 'nigrosine', label: 'NIGROSINE', note: 'WHITE OUTLINES, YELLOW KEYS. THE QUIET ONE.' },
  { id: 'royal', label: 'ROYAL', note: 'A BRIGHT BLUE BAR, YELLOW OUTLINES AND KEYS.' },
  { id: 'blood', label: 'BLOOD', note: 'A DARK RED BAR, ROSY-RED OUTLINES, A RED READOUT.' },
  { id: 'jungle', label: 'JUNGLE', note: 'A DARK GREEN BAR, GREEN OUTLINES, LIME KEYS.' },
  { id: 'orchid', label: 'ORCHID', note: 'ALL BLACK, PURPLE OUTLINES, PINK WORDS, LIME KEYS.' },
];

/** A stored value as a look, or null for none (a word from an older page, or nothing chosen). */
export function readLook(value: unknown): LookId | null {
  return typeof value === 'string' && (LOOK_IDS as readonly string[]).includes(value) ? (value as LookId) : null;
}

/** The class that puts a look on an element (`.look-<id>` in tokens.css); none: the site's own theme. */
export function lookClass(look: LookId | null): string {
  return look === null ? '' : `look-${look}`;
}

/**
 * One person's choices: the look they broadcast in (null: never picked) and whether, in somebody else's room,
 * they see the host's look (the default) or keep their own.
 */
export type LookChoice = { look: LookId | null; showHostLook: boolean };

export const NO_CHOICE: LookChoice = { look: null, showHostLook: true };

/**
 * The look a viewer sees in a room. Their own room always wears their own look. In somebody else's: the host's
 * look (SHOW THE HOST'S LOOK, the default) or their own (KEEP MY OWN LOOK). A look that is null is the site's
 * current theme (a host who never picked one).
 */
export function lookForRoom(hostLook: LookId | null, mine: LookChoice, viewerIsHost: boolean): LookId | null {
  if (viewerIsHost) return mine.look;
  return mine.showHostLook ? hostLook : mine.look;
}
