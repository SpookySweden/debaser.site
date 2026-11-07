// Works out how the note grid sits in the room it's given. It's a canvas: the whole bar and every note exist at once, the view moves
// over them, and only what's near the view is drawn, so a press stays quick however big the canvas is.

/**
 * The size of the canvas. The whole bar fits across whenever a step can stay at least STEP_SHARE of a tap target wide; past that the
 * steps stop shrinking and the view scrolls. Rows stay a tap target tall at the least and share out what's left, so whole rows show.
 */
export interface CanvasFit {
  /** How many whole rows fit in the view, at most. */
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly headHeight: number;
  readonly nameWidth: number;
  /** The whole canvas, with its headings. */
  readonly width: number;
  readonly height: number;
}

// How far rows may shrink below a tap target's height if that lets every row show with no scrolling.
const ROW_SQUEEZE = 0.9;
const HEAD_SHARE = 0.75;
const NAME_SHARE = 1.35;
const STEP_SHARE = 0.6;

export function fitCanvas(viewWidth: number, viewHeight: number, target: number, totalColumns: number, totalRows: number): CanvasFit {
  const headHeight = Math.round(target * HEAD_SHARE);
  const nameWidth = Math.round(target * NAME_SHARE);
  const cellWidth = Math.max(Math.round(target * STEP_SHARE), Math.floor((viewWidth - nameWidth) / totalColumns));
  const room = viewHeight - headHeight;
  const everyRowFits = totalRows * target * ROW_SQUEEZE <= room;
  const rows = everyRowFits ? totalRows : Math.min(totalRows, Math.max(1, Math.floor(room / target)));
  const cellHeight = everyRowFits ? Math.floor(room / rows) : Math.max(target, Math.floor(room / rows));
  return {
    rows,
    cellWidth,
    cellHeight,
    headHeight,
    nameWidth,
    width: nameWidth + cellWidth * totalColumns,
    height: headHeight + cellHeight * totalRows,
  };
}

/** The whole rows or columns showing, for a view that's `view` long after its heading, scrolled `scrolled` along. */
export function showing(scrolled: number, cell: number, view: number, total: number): { first: number; last: number } {
  const first = Math.max(0, Math.min(total - 1, Math.ceil(scrolled / cell - 0.01)));
  const last = Math.max(first, Math.min(total - 1, Math.floor((scrolled + view) / cell + 0.01) - 1));
  return { first, last };
}

/** How far to scroll to bring a row or column into a view that's `view` long, moving no further than it must. */
export function scrollToShow(scrolled: number, cell: number, view: number, index: number): number {
  const start = index * cell;
  const end = start + cell;
  if (start < scrolled) return start;
  if (end > scrolled + view) return Math.max(0, Math.min(start, end - view));
  return scrolled;
}

/** How many notes the grid shows: whole octaves and one more, so a scale ends on its root, and the 49 of a 49-key MIDI keyboard. 85 is all of them. */
export type GridSize = 13 | 25 | 37 | 49 | 85;

/** One octave to start with: every note in view with nothing to scroll, the smallest that still holds a whole scale. */
export const STARTING_GRID_SIZE: GridSize = 13;
export const ALL_NOTES: GridSize = 85;
export const MIDI_KEYBOARD: GridSize = 49;

export const GRID_SIZES: readonly { readonly size: GridSize; readonly label: string; readonly words: string }[] = [
  { size: 13, label: "13", words: "13 notes, one octave" },
  { size: 25, label: "25", words: "25 notes, two octaves" },
  { size: 37, label: "37", words: "37 notes, three octaves" },
  { size: 49, label: "49", words: "49 notes, a 49-key MIDI keyboard, C2 to C6" },
  { size: 85, label: "All", words: "All 85 notes" },
];

const HIGHEST_PITCH = 84;
const OCTAVE = 12;
// A 49-key keyboard's lowest key at its own default octave, as a MIDI note: C2, with middle C (60) as C4.
const MIDI_KEYBOARD_LOWEST = 36;
const BEEPBOX_PITCH_0_AS_MIDI = 12;

export interface NoteRange {
  /** The lowest and highest pitch on the grid. */
  readonly low: number;
  readonly high: number;
  /** The song's notes go past what was chosen, so it's grown to fit them. */
  readonly widened: boolean;
}

/** The lowest and highest notes a channel has anywhere in its patterns, or null with none. */
export function notesExtent(patterns: readonly { readonly notes: readonly { readonly pitches: readonly number[] }[] }[]): { lowest: number; highest: number } | null {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const pattern of patterns) {
    for (const note of pattern.notes) {
      for (const pitch of note.pitches) {
        if (pitch < lowest) lowest = pitch;
        if (pitch > highest) highest = pitch;
      }
    }
  }
  return lowest === Infinity ? null : { lowest, highest };
}

/**
 * Which notes the grid shows. A small one sits on the octave it's been moved to; the 49 sits where a 49-key keyboard's keys land, whatever
 * key the song's in. It's never narrower than the song's own notes: it grows by whole octaves to take them in, so none is ever out of sight.
 */
export function noteRange(size: GridSize, baseOctave: number, songKey: number, extent: { lowest: number; highest: number } | null): NoteRange {
  let low = 0;
  if (size === MIDI_KEYBOARD) low = MIDI_KEYBOARD_LOWEST - BEEPBOX_PITCH_0_AS_MIDI - songKey;
  else if (size !== ALL_NOTES) low = Math.max(0, Math.min(HIGHEST_PITCH - (size - 1), baseOctave * OCTAVE));
  let high = low + size - 1;
  let widened = false;
  if (extent && extent.lowest < low) {
    low = Math.floor(extent.lowest / OCTAVE) * OCTAVE;
    widened = true;
  }
  if (extent && extent.highest > high) {
    high = Math.min(HIGHEST_PITCH, Math.ceil(extent.highest / OCTAVE) * OCTAVE);
    widened = true;
  }
  return { low, high, widened };
}

/** Whether a small grid can go up or down an octave from here. */
export function canMoveRange(size: GridSize, baseOctave: number, direction: 1 | -1): boolean {
  if (size === MIDI_KEYBOARD || size === ALL_NOTES) return false;
  const low = (baseOctave + direction) * OCTAVE;
  return low >= 0 && low + size - 1 <= HIGHEST_PITCH;
}

export interface GridCursor {
  readonly row: number;
  readonly column: number;
}

export type GridMove =
  | "up"
  | "down"
  | "left"
  | "right"
  | "row-start"
  | "row-end"
  | "grid-start"
  | "grid-end"
  | "page-up"
  | "page-down";

export function moveCursor(
  cursor: GridCursor,
  move: GridMove,
  totalRows: number,
  totalColumns: number,
  rowCount: number,
): GridCursor {
  const lastRow = totalRows - 1;
  const lastColumn = totalColumns - 1;
  switch (move) {
    case "up":
      return { ...cursor, row: Math.max(0, cursor.row - 1) };
    case "down":
      return { ...cursor, row: Math.min(lastRow, cursor.row + 1) };
    case "left":
      return { ...cursor, column: Math.max(0, cursor.column - 1) };
    case "right":
      return { ...cursor, column: Math.min(lastColumn, cursor.column + 1) };
    case "row-start":
      return { ...cursor, column: 0 };
    case "row-end":
      return { ...cursor, column: lastColumn };
    case "grid-start":
      return { row: 0, column: 0 };
    case "grid-end":
      return { row: lastRow, column: lastColumn };
    case "page-up":
      return { ...cursor, row: Math.max(0, cursor.row - rowCount) };
    case "page-down":
      return { ...cursor, row: Math.min(lastRow, cursor.row + rowCount) };
  }
}
