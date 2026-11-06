'use client';

import { useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  gridStepsPerBeat,
  partsPerBar,
  partsPerStep,
  patternAtBar,
  pitchCount,
  pitchName,
  stepsPerBar,
  type NoteData,
  type SongData,
} from "../engine/songData";
import type { Transport } from "./app";
import { channelName, noteShapeStyle } from "./channelLooks";
import {
  columnWindowStart,
  fitGrid,
  moveCursor,
  rowWindowStart,
  type CellSize,
  type GridCursor,
  type GridMove,
} from "./gridView";
import { rulerKey, stripKey } from "./looks";
import { deleteNoteAt, noteAt, stretchNote, toggleNote } from "./noteEdit";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead, type HitNote } from "./Playhead";
import { barsUsingPattern } from "./songEdit";
import { useElementSize } from "./useElementSize";

const CELL_VAR: Record<CellSize, string> = {
  s: "var(--cell-s)",
  m: "var(--cell-m)",
  l: "var(--cell-l)",
  xl: "var(--cell-xl)",
};
const CELL_TEXT: Record<CellSize, string> = {
  s: "text-bb-cell-s",
  m: "text-bb-cell-m",
  l: "text-bb-cell-l",
  xl: "text-bb-cell-xl",
};

const KEY_MOVES: Record<string, GridMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "row-start",
  End: "row-end",
  PageUp: "page-up",
  PageDown: "page-down",
};

function stepLabel(step: number, stepsPerBeat: number): string {
  return `${Math.floor(step / stepsPerBeat) + 1}.${(step % stepsPerBeat) + 1}`;
}

function spokenStep(step: number, stepsPerBeat: number): string {
  return `beat ${Math.floor(step / stepsPerBeat) + 1} step ${(step % stepsPerBeat) + 1}`;
}

export interface NoteGridHandle {
  focus: (options?: FocusOptions) => void;
}

export interface NoteGridProps {
  ref?: Ref<NoteGridHandle>;
  song: SongData;
  channelIndex: number;
  bar: number;
  size: CellSize;
  transport: Transport;
  /** Grid cells give only the note and on or off, not the whole position. */
  shortCellNames: boolean;
  /** More keys for the row under the grid. */
  footKeys?: ReactNode;
  art: BeatBoxArt;
  showArtSlots: boolean;
  /** Moves to the next or previous bar, if there is one. */
  onBarStep: (direction: 1 | -1) => boolean;
  onNotesChange: (notes: readonly NoteData[]) => void;
  /** A note was turned on or off. */
  onToggled: (pitch: number, on: boolean) => void;
  /** The cursor moved to a row. */
  onCursorMoved: (pitch: number) => void;
  onAnnounce: (message: string) => void;
}

export function NoteGrid({
  ref,
  song,
  channelIndex,
  bar,
  size,
  transport,
  shortCellNames,
  footKeys,
  art,
  showArtSlots,
  onBarStep,
  onNotesChange,
  onToggled,
  onCursorMoved,
  onAnnounce,
}: NoteGridProps) {
  const channel = song.channels[channelIndex];
  if (!channel) throw new Error(`The song has no channel ${channelIndex}.`);

  const totalRows = pitchCount(channel);
  const totalColumns = stepsPerBar(song);
  const stepsPerBeat = gridStepsPerBeat(song);
  const stepParts = partsPerStep(song);
  const notes = patternAtBar(channel, bar)?.notes ?? [];
  const patternNumber = channel.bars[bar] ?? 0;
  const sharedBars = barsUsingPattern(channel, patternNumber);

  const [frame, gridWidth, gridHeight] = useElementSize();
  const startRow = totalRows - 1 - (channel.isDrum ? 0 : channel.octave * 12);
  const [cursor, setCursor] = useState<GridCursor>({ row: startRow, column: 0 });
  // Null until the cursor first moves: it starts on the bottom row, so the notes above it are in view.
  const [firstRow, setFirstRow] = useState<number | null>(null);
  const activeCell = useRef<HTMLDivElement>(null);
  const moveFocusToCell = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);
  const [cellWidth, setCellWidth] = useState(64);

  useImperativeHandle(ref, () => ({ focus: (options) => activeCell.current?.focus(options) }), []);

  // The size comes from a theme token, so ask the browser how wide it really is.
  useLayoutEffect(() => {
    setCellWidth(cellProbe.current?.getBoundingClientRect().width || 64);
  }, [size, gridWidth]);

  const fit = fitGrid(gridWidth, gridHeight, cellWidth, stepsPerBeat, totalColumns, totalRows);
  const rowCount = fit.rows;
  const columnCount = fit.columns;
  const firstColumn = columnWindowStart(cursor.column, columnCount);
  const visibleFirstRow = rowWindowStart(firstRow ?? startRow - rowCount + 1, cursor.row, rowCount, totalRows);

  useLayoutEffect(() => {
    if (moveFocusToCell.current) activeCell.current?.focus();
    moveFocusToCell.current = false;
  });

  function goTo(next: GridCursor) {
    moveFocusToCell.current = true;
    setCursor(next);
    setFirstRow(rowWindowStart(visibleFirstRow, next.row, rowCount, totalRows));
    if (next.row !== cursor.row) onCursorMoved(pitchOfRow(next.row));
  }

  function pitchOfRow(row: number): number {
    return totalRows - 1 - row;
  }

  function nameOf(pitch: number): string {
    return pitchName(song, channel!, pitch);
  }

  function toggleAt(row: number, column: number) {
    const pitch = pitchOfRow(row);
    const start = column * stepParts;
    const result = toggleNote(notes, pitch, start, start + stepParts);
    if (result.change === "chord-full") {
      onAnnounce(`${nameOf(pitch)} not added. A chord can hold 4 notes.`);
      return;
    }
    onNotesChange(result.notes);
    onToggled(pitch, result.change === "added");
    onAnnounce(`${nameOf(pitch)} ${result.change === "added" ? "on" : "off"}, ${spokenStep(column, stepsPerBeat)}.`);
  }

  function stretch(byParts: number) {
    const pitch = pitchOfRow(cursor.row);
    const part = cursor.column * stepParts;
    const stretched = stretchNote(notes, pitch, part, byParts, partsPerBar(song));
    if (!stretched) {
      onAnnounce("That note can't stretch that way.");
      return;
    }
    onNotesChange(stretched);
    const note = noteAt(stretched, part, part + 1);
    if (note) onAnnounce(`${nameOf(pitch)} is now ${(note.end - note.start) / stepParts} steps long.`);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.metaKey) return;
    if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      stretch(event.key === "ArrowRight" ? stepParts : -stepParts);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      toggleAt(cursor.row, cursor.column);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const start = cursor.column * stepParts;
      const kept = deleteNoteAt(notes, start, start + stepParts);
      if (kept !== notes) {
        onNotesChange(kept);
        onAnnounce(`Note deleted, ${spokenStep(cursor.column, stepsPerBeat)}.`);
      }
      return;
    }
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !event.shiftKey) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      // Ctrl and an arrow jumps a whole beat. Off either end of the bar, the cursor carries on into the next one.
      const column = cursor.column + direction * (event.ctrlKey ? stepsPerBeat : 1);
      if (column >= totalColumns || column < 0) {
        if (onBarStep(direction)) goTo({ ...cursor, column: direction === 1 ? 0 : totalColumns - 1 });
      } else {
        goTo({ ...cursor, column });
      }
      return;
    }
    const ctrl = event.ctrlKey && (event.key === "Home" || event.key === "End");
    const move: GridMove | undefined = ctrl ? (event.key === "Home" ? "grid-start" : "grid-end") : KEY_MOVES[event.key];
    if (move && (ctrl || !event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      goTo(moveCursor(cursor, move, totalRows, totalColumns, rowCount));
    }
  }

  /** A screenful of steps. Past either end of the bar it goes on to the next bar. */
  function pageColumns(direction: 1 | -1) {
    const column = firstColumn + direction * columnCount;
    if (column >= totalColumns || column < 0) {
      if (onBarStep(direction)) {
        const lastPage = Math.floor((totalColumns - 1) / columnCount) * columnCount;
        setCursor({ ...cursor, column: direction === 1 ? 0 : lastPage });
      }
      return;
    }
    setCursor({ ...cursor, column });
  }

  function pageRows(direction: 1 | -1) {
    const next = moveCursor(cursor, direction === 1 ? "page-down" : "page-up", totalRows, totalColumns, rowCount);
    setCursor(next);
    setFirstRow(rowWindowStart(visibleFirstRow, next.row, rowCount, totalRows));
  }

  const rows = Array.from({ length: rowCount }, (_, index) => visibleFirstRow + index);
  const columns = Array.from({ length: columnCount }, (_, index) => firstColumn + index);
  const gridStyle = {
    "--cell": CELL_VAR[size],
    "--cell-w": `${fit.cellWidth}px`,
    "--cell-h": `${fit.cellHeight}px`,
    "--head-h": `${fit.headHeight}px`,
    "--name-w": `${fit.nameWidth}px`,
    minHeight: "calc(var(--cell) * 4.7)",
  } as CSSProperties;
  const cellBox = { width: "var(--cell-w)", height: "var(--cell-h)" };
  const headBox = { width: "var(--cell-w)", height: "var(--head-h)" };
  const nameBox = { width: "var(--name-w)", height: "var(--cell-h)" };
  const cornerBox = { width: "var(--name-w)", height: "var(--head-h)" };

  return (
    <section aria-label="Note grid" className="relative flex min-h-0 w-full flex-1 flex-col">
      <h2 className="sr-only">
        {channelName(song, channelIndex)}, bar {bar + 1}
        {patternNumber === 0 ? ", silent" : `, pattern ${patternNumber}`}
        {sharedBars > 1 ? `, on ${sharedBars} bars` : ""}
        {patternNumber !== 0 && notes.length === 0 ? ", empty" : ""}
      </h2>
      <p className="sr-only">
        Steps {firstColumn + 1} to {firstColumn + columnCount} of {totalColumns}. {nameOf(pitchOfRow(visibleFirstRow + rowCount - 1))}{" "}
        to {nameOf(pitchOfRow(visibleFirstRow))}.
      </p>

      {notes.length === 0 && (
        <div className="pointer-events-none z-30 flex flex-none flex-wrap items-center gap-bb-gutter bg-bb-nigrosine p-2 text-display font-bold uppercase md:absolute md:top-1/2 md:left-1/2 md:w-max md:max-w-full md:-translate-x-1/2 md:-translate-y-1/2 md:flex-nowrap md:p-bb-gutter md:text-bb-large">
          <PixelSlot name="empty-state" size="scene" src={art.emptyState} showEmpty={showArtSlots} />
          <p>
            Click a square to put a note.
            <br />
            Or arrows and Enter.
            <br />
            Ctrl+arrow jumps a beat.
          </p>
        </div>
      )}

      <div ref={frame} className="relative min-h-0 w-full flex-1 overflow-hidden" style={gridStyle}>
        <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
        <div
          role="grid"
          aria-label={`Notes, ${channelName(song, channelIndex)}, bar ${bar + 1}`}
          aria-rowcount={totalRows + 1}
          aria-colcount={totalColumns + 1}
          onKeyDown={keyDown}
          className={`relative w-fit select-none ${CELL_TEXT[size]}`}
        >
          <div role="row" aria-rowindex={1} className="flex">
            <div
              role="columnheader"
              aria-colindex={1}
              className="flex flex-none items-center justify-center font-bold"
              style={cornerBox}
            >
              Note
            </div>
            {columns.map((column) => (
              <div
                key={column}
                role="columnheader"
                aria-colindex={column + 2}
                aria-label={spokenStep(column, stepsPerBeat)}
                className="flex flex-none items-center justify-center font-bold"
                style={headBox}
              >
                {size === "s" && column % stepsPerBeat !== 0 ? "" : stepLabel(column, stepsPerBeat)}
              </div>
            ))}
          </div>

          {rows.map((row) => {
            const pitch = pitchOfRow(row);
            const name = nameOf(pitch);
            const sharp = name.includes("#");
            return (
              <div key={row} role="row" aria-rowindex={row + 2} className="flex">
                <div
                  role="rowheader"
                  aria-colindex={1}
                  className={`flex flex-none items-center justify-center overflow-hidden text-center leading-none font-bold ${sharp ? "bg-bb-black" : "bg-bb-royal-blue"}`}
                  style={nameBox}
                >
                  {name}
                </div>
                {columns.map((column) => {
                  const start = column * stepParts;
                  const end = start + stepParts;
                  const covering = noteAt(notes, start, end);
                  const on = covering?.pitches.includes(pitch) ?? false;
                  const isNoteStart = on && covering !== null && covering.start >= start;
                  const isNoteEnd = on && covering !== null && covering.end <= end;
                  const showName = isNoteStart || (on && column === firstColumn);
                  const active = row === cursor.row && column === cursor.column;
                  const beatLine = column % stepsPerBeat === 0;
                  return (
                    <div
                      key={column}
                      ref={active ? activeCell : undefined}
                      role="gridcell"
                      aria-colindex={column + 2}
                      aria-selected={on}
                      aria-label={
                        shortCellNames
                          ? `${name} ${on ? "on" : "off"}`
                          : `Bar ${bar + 1}, ${spokenStep(column, stepsPerBeat)}, ${name}, ${on ? "on" : "off"}`
                      }
                      tabIndex={active ? 0 : -1}
                      onClick={() => {
                        goTo({ row, column });
                        toggleAt(row, column);
                      }}
                      className={`relative flex-none cursor-pointer focus:outline-none bb-sinks bb-note-cell ${on && !isNoteEnd ? "bb-note-runs-on" : ""} ${beatLine ? "bb-beat-line" : ""} ${sharp ? "bg-bb-black" : "bg-bb-nigrosine"} ${active ? "z-10 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`}
                      style={cellBox}
                    >
                      {on && (
                        <div
                          className="absolute inset-0 flex items-center justify-center overflow-hidden bg-bb-pink text-center leading-none font-bold wrap-anywhere text-bb-black bb-note"
                          style={noteShapeStyle(song, channelIndex, isNoteStart, isNoteEnd)}
                        >
                          {showName ? name : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <Playhead
            transport={transport}
            headerCells={1}
            columnOf={(spot) => {
              if (spot.bar !== bar) return null;
              const column = spot.step - firstColumn;
              return column >= 0 && column < columnCount ? column : null;
            }}
            hitsAt={(spot): HitNote[] => {
              if (spot.bar !== bar) return [];
              const start = spot.step * stepParts;
              const note = noteAt(notes, start, start + stepParts);
              if (!note) return [];
              return note.pitches
                .map((pitch) => ({ row: totalRows - 1 - pitch - visibleFirstRow, name: nameOf(pitch) }))
                .filter((hit) => hit.row >= 0 && hit.row < rowCount);
            }}
          />
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 p-1">
        <div role="group" aria-label="Move along the bar" className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label="Earlier" title="Earlier steps" onClick={() => pageColumns(-1)} className={stripKey()}>
            &lt;
          </button>
          {/* Every beat of the bar, with the ones on screen filled: this is what says there's more than is showing. */}
          {Array.from({ length: Math.ceil(totalColumns / stepsPerBeat) }, (_, beat) => {
            const step = beat * stepsPerBeat;
            const showing = step >= firstColumn && step < firstColumn + columnCount;
            return (
              <button
                key={beat}
                type="button"
                tabIndex={-1}
                aria-label={`Go to beat ${beat + 1}`}
                aria-current={showing ? "true" : undefined}
                title={`Beat ${beat + 1} (Ctrl+arrow moves a beat)`}
                onClick={() => goTo({ ...cursor, column: step })}
                className={rulerKey(showing)}
              >
                {beat + 1}
              </button>
            );
          })}
          <button type="button" aria-label="Later" title="Later steps" onClick={() => pageColumns(1)} className={stripKey()}>
            &gt;
          </button>
        </div>
        <div role="group" aria-label="Move up and down the notes" className="flex flex-wrap gap-1">
          <button type="button" aria-label="Higher" title="Higher notes (Page Up)" onClick={() => pageRows(-1)} className={stripKey()}>
            Up
          </button>
          <button type="button" aria-label="Lower" title="Lower notes (Page Down)" onClick={() => pageRows(1)} className={stripKey()}>
            Down
          </button>
        </div>
        {footKeys}
      </div>
    </section>
  );
}
