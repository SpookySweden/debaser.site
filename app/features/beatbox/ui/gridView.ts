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

const HEAD_SHARE = 0.75;
const NAME_SHARE = 1.35;
const STEP_SHARE = 0.6;

export function fitCanvas(viewWidth: number, viewHeight: number, target: number, totalColumns: number, totalRows: number): CanvasFit {
  const headHeight = Math.round(target * HEAD_SHARE);
  const nameWidth = Math.round(target * NAME_SHARE);
  const cellWidth = Math.max(Math.round(target * STEP_SHARE), Math.floor((viewWidth - nameWidth) / totalColumns));
  const rows = Math.min(totalRows, Math.max(1, Math.floor((viewHeight - headHeight) / target)));
  const cellHeight = Math.max(target, Math.floor((viewHeight - headHeight) / rows));
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
