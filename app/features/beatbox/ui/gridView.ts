// Works out which part of the note grid fits on screen. The grid shows only what fits and moves
// in pages as the cursor does, so nothing ever scrolls sideways, even at 400% browser zoom.

export type CellSize = "s" | "m" | "l" | "xl";

export const CELL_SIZES: readonly CellSize[] = ["s", "m", "l", "xl"];

/** How many rows to show at once, so the controls stay near the grid. */
const ROWS_AT_SIZE: Record<CellSize, number> = { s: 25, m: 18, l: 13, xl: 9 };
const MIN_FOCUS_ROWS = 5;

export function visibleRowCount(size: CellSize, totalRows: number): number {
  return Math.min(ROWS_AT_SIZE[size], totalRows);
}

/** Focus view shows as many rows as the screen has room for, leaving one for the headings. */
export function rowsThatFit(height: number, cellHeight: number, totalRows: number): number {
  const fits = Math.floor(height / cellHeight) - 1;
  return Math.max(MIN_FOCUS_ROWS, Math.min(fits, totalRows));
}

/** Whole beats where they fit, since that's easier to read. At least one column. */
export function visibleColumnCount(
  gridWidth: number,
  cellWidth: number,
  stepsPerBeat: number,
  totalColumns: number,
): number {
  // One more cell's width is taken by the row names.
  const fits = Math.max(1, Math.floor(gridWidth / cellWidth) - 1);
  const wholeBeats = fits - (fits % stepsPerBeat);
  return Math.min(wholeBeats > 0 ? wholeBeats : fits, totalColumns);
}

/** Columns move a page at a time. */
export function columnWindowStart(cursorColumn: number, columnCount: number): number {
  return Math.floor(cursorColumn / columnCount) * columnCount;
}

/** Rows move only as far as needed to keep the cursor showing. */
export function rowWindowStart(current: number, cursorRow: number, rowCount: number, totalRows: number): number {
  let start = current;
  if (cursorRow < start) start = cursorRow;
  if (cursorRow >= start + rowCount) start = cursorRow - rowCount + 1;
  return Math.max(0, Math.min(start, totalRows - rowCount));
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
