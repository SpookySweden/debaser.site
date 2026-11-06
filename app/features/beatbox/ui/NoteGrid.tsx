'use client';

import { useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { ChoiceGroup } from "./ChoiceGroup";
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
  CELL_SIZES,
  columnWindowStart,
  moveCursor,
  rowsThatFit,
  rowWindowStart,
  visibleColumnCount,
  visibleRowCount,
  type CellSize,
  type GridCursor,
  type GridMove,
} from "./gridView";
import { smallKey, titleLine } from "./looks";
import { deleteNoteAt, noteAt, stretchNote, toggleNote } from "./noteEdit";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead, type HitNote } from "./Playhead";
import { barsUsingPattern } from "./songEdit";
import { useElementWidth } from "./useElementWidth";

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

const FOCUS_BUTTONS_HEIGHT = 80;

function stepLabel(step: number, stepsPerBeat: number): string {
  return `${Math.floor(step / stepsPerBeat) + 1}.${(step % stepsPerBeat) + 1}`;
}

function spokenStep(step: number, stepsPerBeat: number): string {
  return `beat ${Math.floor(step / stepsPerBeat) + 1} step ${(step % stepsPerBeat) + 1}`;
}

export interface NoteGridHandle {
  focus: () => void;
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
  /** Focus view: use all the height there is. */
  fillHeight: boolean;
  art: BeatBoxArt;
  showArtSlots: boolean;
  onSizeChange: (size: CellSize) => void;
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
  fillHeight,
  art,
  showArtSlots,
  onSizeChange,
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

  const [frame, gridWidth] = useElementWidth();
  const startRow = totalRows - 1 - (channel.isDrum ? 0 : channel.octave * 12);
  const [cursor, setCursor] = useState<GridCursor>({ row: startRow, column: 0 });
  const [firstRow, setFirstRow] = useState(() =>
    // Start with the cursor on the bottom row, so the notes above it are in view.
    rowWindowStart(startRow - visibleRowCount(size, totalRows) + 1, startRow, visibleRowCount(size, totalRows), totalRows),
  );
  const activeCell = useRef<HTMLDivElement>(null);
  const moveFocusToCell = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);
  const [cellWidth, setCellWidth] = useState(64);

  useImperativeHandle(ref, () => ({ focus: () => activeCell.current?.focus() }), []);

  // The size comes from a theme token, so ask the browser how wide it really is.
  useLayoutEffect(() => {
    setCellWidth(cellProbe.current?.getBoundingClientRect().width || 64);
  }, [size, gridWidth]);

  // Focus view: from the top of the grid to the bottom of the screen, less the paging buttons.
  const [roomBelowGrid, setRoomBelowGrid] = useState(0);
  useLayoutEffect(() => {
    if (!fillHeight) return;
    const measure = () => {
      const top = frame.current?.offsetTop ?? 0;
      setRoomBelowGrid(window.innerHeight - top - FOCUS_BUTTONS_HEIGHT);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fillHeight, frame]);

  const rowCount = fillHeight
    ? rowsThatFit(roomBelowGrid, cellWidth, totalRows)
    : visibleRowCount(size, totalRows);
  const columnCount = visibleColumnCount(gridWidth, cellWidth, stepsPerBeat, totalColumns);
  const firstColumn = columnWindowStart(cursor.column, columnCount);
  const visibleFirstRow = rowWindowStart(firstRow, cursor.row, rowCount, totalRows);

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
    const ctrl = event.ctrlKey && (event.key === "Home" || event.key === "End");
    const move: GridMove | undefined = ctrl ? (event.key === "Home" ? "grid-start" : "grid-end") : KEY_MOVES[event.key];
    if (move && (ctrl || !event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      goTo(moveCursor(cursor, move, totalRows, totalColumns, rowCount));
    }
  }

  function pageColumns(direction: 1 | -1) {
    const column = Math.max(0, Math.min(totalColumns - 1, firstColumn + direction * columnCount));
    setCursor({ ...cursor, column });
  }

  function pageRows(direction: 1 | -1) {
    const next = moveCursor(cursor, direction === 1 ? "page-down" : "page-up", totalRows, totalColumns, rowCount);
    setCursor(next);
    setFirstRow(rowWindowStart(visibleFirstRow, next.row, rowCount, totalRows));
  }

  const rows = Array.from({ length: rowCount }, (_, index) => visibleFirstRow + index);
  const columns = Array.from({ length: columnCount }, (_, index) => firstColumn + index);
  const gridStyle = { "--cell": CELL_VAR[size] } as CSSProperties;
  const cellBox = { width: "var(--cell)", height: "var(--cell)" };

  return (
    <section aria-label="Note grid" className="flex w-full flex-col gap-bb-gutter">
      <ChoiceGroup
        label="Grid size"
        keyName="- ="
        value={size}
        options={CELL_SIZES.map((option) => ({ value: option, label: option.toUpperCase() }))}
        onChange={onSizeChange}
      />

      <h2 className={titleLine}>
        <span>
          {channelName(song, channelIndex)}, bar {bar + 1}
          {patternNumber === 0 ? ", silent" : `, pattern ${patternNumber}`}
          {sharedBars > 1 ? `, on ${sharedBars} bars` : ""}
          {patternNumber !== 0 && notes.length === 0 ? ", empty" : ""}
        </span>
      </h2>
      {notes.length === 0 && (
        <PixelSlot name="empty-state" size="scene" src={art.emptyState} showEmpty={showArtSlots} />
      )}
      <p className="text-bb-large wrap-anywhere">
        Steps {firstColumn + 1} to {firstColumn + columnCount} of {totalColumns}. {nameOf(pitchOfRow(visibleFirstRow + rowCount - 1))}{" "}
        to {nameOf(pitchOfRow(visibleFirstRow))}.
      </p>

      <div ref={frame} className="w-full" style={gridStyle}>
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
              style={cellBox}
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
                style={cellBox}
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
                  className={`flex flex-none items-center justify-center overflow-hidden text-center leading-none font-bold wrap-anywhere ${sharp ? "bg-bb-black" : "bg-bb-royal-blue"}`}
                  style={cellBox}
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

      <div className="flex flex-wrap gap-bb-gutter">
        <button type="button" onClick={() => pageColumns(-1)} className={smallKey()}>
          Earlier
        </button>
        <button type="button" onClick={() => pageColumns(1)} className={smallKey()}>
          Later
        </button>
        <button type="button" onClick={() => pageRows(-1)} className={smallKey()}>
          Higher
        </button>
        <button type="button" onClick={() => pageRows(1)} className={smallKey()}>
          Lower
        </button>
      </div>
    </section>
  );
}
