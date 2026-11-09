import { gridStepsPerBeat, partsPerStep, patternAtBar, stepsPerBar, type ChannelData, type SongData } from "../engine/songData";
import type { NoteRange } from "./gridView";

/** The most pixels the map has across and down. Past these, one pixel stands for more steps or more notes, so it always fits its room. */
export const MAP_MOST_COLUMNS = 32;
export const MAP_MOST_ROWS = 13;

/** How the whole song folds into the map's pixels. */
export interface MapShape {
  readonly columns: number;
  readonly rows: number;
  /** How many of the grid's steps one pixel across stands for. */
  readonly stepsPerColumn: number;
  /** How many of the grid's notes one pixel down stands for. */
  readonly notesPerRow: number;
  readonly stepsPerBar: number;
  readonly barCount: number;
  /** How many notes the grid has, top to bottom. */
  readonly totalRows: number;
}

/** What the grid is looking at: one bar, and the rows and steps of it in view. */
export interface MapView {
  readonly bar: number;
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}

/** A place on the map, in pixels, ends included. */
export interface MapBox {
  readonly column: number;
  readonly lastColumn: number;
  readonly row: number;
  readonly lastRow: number;
}

/**
 * One pixel a beat at most. A longer song gives each pixel more beats, in steps that keep the bars' edges on pixel edges:
 * part of a bar while that fits, then whole bars.
 */
export function mapShape(song: SongData, range: NoteRange): MapShape {
  const barSteps = stepsPerBar(song);
  const beatSteps = gridStepsPerBeat(song);
  const barCount = Math.max(1, song.barCount);
  const totalSteps = barCount * barSteps;
  const beats = Math.max(1, Math.round(barSteps / beatSteps));
  const choices: number[] = [];
  for (let share = 1; share <= beats; share += 1) if (beats % share === 0) choices.push(share * beatSteps);
  let stepsPerColumn = choices.find((steps) => Math.ceil(totalSteps / steps) <= MAP_MOST_COLUMNS);
  if (stepsPerColumn === undefined) stepsPerColumn = Math.ceil(barCount / MAP_MOST_COLUMNS) * barSteps;
  const totalRows = Math.max(1, range.high - range.low + 1);
  const notesPerRow = Math.ceil(totalRows / MAP_MOST_ROWS);
  return {
    columns: Math.ceil(totalSteps / stepsPerColumn),
    rows: Math.ceil(totalRows / notesPerRow),
    stepsPerColumn,
    notesPerRow,
    stepsPerBar: barSteps,
    barCount,
    totalRows,
  };
}

/** The pixels with a note in them, as "column,row". A pixel standing for several steps or notes lights if any one of them has a note, so none goes missing. */
export function litPixels(song: SongData, channel: ChannelData, range: NoteRange, shape: MapShape): Set<string> {
  const lit = new Set<string>();
  const stepParts = partsPerStep(song);
  for (let bar = 0; bar < shape.barCount; bar += 1) {
    const pattern = patternAtBar(channel, bar);
    if (!pattern) continue;
    for (const note of pattern.notes) {
      const firstStep = Math.max(0, Math.floor(note.start / stepParts));
      const lastStep = Math.min(shape.stepsPerBar - 1, Math.max(firstStep, Math.ceil(note.end / stepParts) - 1));
      const firstColumn = Math.floor((bar * shape.stepsPerBar + firstStep) / shape.stepsPerColumn);
      const lastColumn = Math.floor((bar * shape.stepsPerBar + lastStep) / shape.stepsPerColumn);
      for (const pitch of note.pitches) {
        if (pitch < range.low || pitch > range.high) continue;
        const row = Math.floor((range.high - pitch) / shape.notesPerRow);
        for (let column = firstColumn; column <= lastColumn; column += 1) lit.add(`${column},${row}`);
      }
    }
  }
  return lit;
}

/** The pixel column a bar and step of it falls in. */
export function columnOf(shape: MapShape, bar: number, step: number): number {
  return Math.max(0, Math.min(shape.columns - 1, Math.floor((bar * shape.stepsPerBar + step) / shape.stepsPerColumn)));
}

/** The pixels a bar takes, ends included. Several bars to a pixel share it. */
export function barColumns(shape: MapShape, bar: number): { column: number; lastColumn: number } {
  return { column: columnOf(shape, bar, 0), lastColumn: columnOf(shape, bar, shape.stepsPerBar - 1) };
}

/** The box round what the grid is looking at. */
export function viewBox(shape: MapShape, view: MapView): MapBox {
  const row = (gridRow: number) => Math.max(0, Math.min(shape.rows - 1, Math.floor(gridRow / shape.notesPerRow)));
  return {
    column: columnOf(shape, view.bar, view.firstColumn),
    lastColumn: columnOf(shape, view.bar, Math.max(view.firstColumn, view.lastColumn)),
    row: row(view.firstRow),
    lastRow: row(Math.max(view.firstRow, view.lastRow)),
  };
}

/** Where a press on the map goes: the bar, and the step and grid row at the middle of the pixel pressed. `across` and `down` run 0 to 1 over the map. */
export function spotAt(shape: MapShape, across: number, down: number): { bar: number; step: number; row: number } {
  const column = Math.max(0, Math.min(shape.columns - 1, Math.floor(across * shape.columns)));
  const pixelRow = Math.max(0, Math.min(shape.rows - 1, Math.floor(down * shape.rows)));
  const middleStep = Math.min(shape.barCount * shape.stepsPerBar - 1, column * shape.stepsPerColumn + Math.floor(shape.stepsPerColumn / 2));
  const bar = Math.max(0, Math.min(shape.barCount - 1, Math.floor(middleStep / shape.stepsPerBar)));
  const row = Math.min(shape.totalRows - 1, pixelRow * shape.notesPerRow + Math.floor(shape.notesPerRow / 2));
  return { bar, step: middleStep - bar * shape.stepsPerBar, row };
}

/** The rows and steps the grid has in view, without the bar. */
export type GridInView = Omit<MapView, "bar">;

/** Where the grid is looking, kept apart from the page so a scroll redraws the map and nothing else. */
export interface ViewStore {
  subscribe(listener: () => void): () => void;
  get(): GridInView | null;
  set(view: GridInView): void;
}

export function createViewStore(): ViewStore {
  let now: GridInView | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => now,
    set(view) {
      if (now && now.firstRow === view.firstRow && now.lastRow === view.lastRow && now.firstColumn === view.firstColumn && now.lastColumn === view.lastColumn) return;
      now = view;
      for (const listener of listeners) listener();
    },
  };
}
