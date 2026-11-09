'use client';

import {
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  gridStepsPerBeat,
  makeNote,
  MAX_CHORD_SIZE,
  partsPerBar,
  partsPerStep,
  patternAtBar,
  pitchName,
  stepsPerBar,
  type NoteData,
  type SongData,
} from "../engine/songData";
import type { Transport } from "./app";
import { channelName, noteShapeStyle } from "./channelLooks";
import { fitCanvas, moveCursor, scrollToShow, showing, type GridCursor, type GridMove, type NoteRange } from "./gridView";
import { GLYPHS } from "./keyHelp";
import type { LiveNotes } from "./liveNotes";
import { deleteNoteAt, moveNote, noteAt, setNoteEnd, stretchNote, toggleNote } from "./noteEdit";
import { startPan } from "./panning";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead, type HitNote } from "./Playhead";
import { ScrollRail } from "./ScrollRail";
import { BarKeys } from "./BarKeys";
import type { GridInView } from "./mapPixels";
import { barsUsingPattern } from "./songEdit";
import { useElementSize } from "./useElementSize";

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

// Only what's near the view is drawn, so a press stays quick. A little more than shows, so a drag never meets a gap.
const SPARE_ROWS = 2;
const SPARE_COLUMNS = 8;
const ROWS_PER_ARROW = 3;
// How much of a note's last square is the grip for its length, as bb-note-grip draws it.
const GRIP_SHARE = 0.35;

function spokenStep(step: number, stepsPerBeat: number): string {
  return `beat ${Math.floor(step / stepsPerBeat) + 1} step ${(step % stepsPerBeat) + 1}`;
}

/** Where a pitch's notes are along the bar, in a form that only changes when they do. */
function spansOf(notes: readonly NoteData[], pitch: number): string {
  let spans = "";
  for (const note of notes) {
    if (note.pitches.includes(pitch)) spans += `${note.start}:${note.end};`;
  }
  return spans;
}

/**
 * One square. It only redraws when it changes, so going to another bar costs only the squares that differ. Only the cursor's square says
 * which bar it's in, as that's the one a screen reader lands on; the grid's own name says it for the rest, so a new bar doesn't change them all.
 */
const NoteSquare = memo(function NoteSquare({
  column,
  name,
  on,
  isNoteStart,
  isNoteEnd,
  cursorBar,
  beatLine,
  sharp,
  stepsPerBeat,
  shortCellNames,
  channelIndex,
  song,
}: {
  column: number;
  name: string;
  on: boolean;
  isNoteStart: boolean;
  isNoteEnd: boolean;
  /** The bar, if the cursor's on this square. */
  cursorBar: number | null;
  beatLine: boolean;
  sharp: boolean;
  stepsPerBeat: number;
  shortCellNames: boolean;
  channelIndex: number;
  song: SongData;
}) {
  const active = cursorBar !== null;
  const place = spokenStep(column, stepsPerBeat);
  return (
    <div
      role="gridcell"
      data-column={column}
      aria-colindex={column + 2}
      aria-selected={on}
      aria-label={shortCellNames ? `${name} ${on ? "on" : "off"}` : `${active ? `Bar ${cursorBar + 1}, ` : ""}${place}, ${name}, ${on ? "on" : "off"}`}
      tabIndex={active ? 0 : -1}
      className={`relative flex-none cursor-pointer focus:outline-none bb-sinks bb-note-cell ${on && !isNoteEnd ? "bb-note-runs-on" : ""} ${beatLine ? "bb-beat-line" : ""} ${sharp ? "bg-bb-black" : "bg-bb-nigrosine"} ${active ? "z-10 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`}
      style={{ width: "var(--cell-w)", height: "var(--cell-h)" }}
    >
      {on && (
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-bb-pink bb-note" style={noteShapeStyle(song, channelIndex, isNoteStart, isNoteEnd)}>
          {isNoteEnd && <span className="bb-note-grip" />}
        </div>
      )}
    </div>
  );
});

/**
 * One row of squares. It only redraws when something in this row changes, so a press costs one or two rows, not the whole grid. Presses
 * are all listened for on the grid, so the squares have nothing of their own to set up.
 */
const NoteRow = memo(function NoteRow({
  row,
  name,
  spans,
  firstColumn,
  lastColumn,
  cursorColumn,
  bar,
  stepParts,
  stepsPerBeat,
  shortCellNames,
  channelIndex,
  song,
  namesStick,
}: {
  row: number;
  name: string;
  spans: string;
  firstColumn: number;
  lastColumn: number;
  /** Which square here has the cursor, or -1. */
  cursorColumn: number;
  /** Which bar it is, for the cursor's square. Other rows are always given 0, so a new bar is no change to them. */
  bar: number;
  stepParts: number;
  stepsPerBeat: number;
  shortCellNames: boolean;
  channelIndex: number;
  /** Only read for the shape of this channel's notes, which never changes while it's drawn. */
  song: SongData;
  /** The view scrolls sideways, so the note names stay put while it does. */
  namesStick: boolean;
}) {
  const sharp = name.includes("#");
  const parsed = spans
    .split(";")
    .filter(Boolean)
    .map((span) => span.split(":").map(Number) as [number, number]);
  const cells: ReactNode[] = [];
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    const start = column * stepParts;
    const end = start + stepParts;
    const covering = parsed.find(([from, to]) => from < end && to > start);
    const on = covering !== undefined;
    const isNoteStart = on && covering[0] >= start;
    const isNoteEnd = on && covering[1] <= end;
    cells.push(
      <NoteSquare
        key={column}
        column={column}
        name={name}
        on={on}
        isNoteStart={isNoteStart}
        isNoteEnd={isNoteEnd}
        cursorBar={column === cursorColumn ? bar : null}
        beatLine={column % stepsPerBeat === 0}
        sharp={sharp}
        stepsPerBeat={stepsPerBeat}
        shortCellNames={shortCellNames}
        channelIndex={on ? channelIndex : 0}
        song={song}
      />,
    );
  }
  return (
    <div role="row" aria-rowindex={row + 2} data-row={row} className="bb-row flex">
      <div
        role="rowheader"
        aria-colindex={1}
        className={`${namesStick ? "sticky left-0 z-30" : ""} flex flex-none cursor-grab items-center justify-center overflow-hidden text-center leading-none font-bold ${name.length > 3 ? "text-bb-cell-m" : "text-bb-cell-l"} ${sharp ? "bg-bb-black" : "bg-bb-royal-blue"}`}
        style={{ width: "var(--name-w)", height: "var(--cell-h)" }}
      >
        {name}
      </div>
      {firstColumn > 0 && <div role="presentation" className="flex-none" style={{ width: `calc(var(--cell-w) * ${firstColumn})` }} />}
      {cells}
    </div>
  );
});

/** The notes being played right now, lit over their names, so a keyboard's keys can be seen landing on their rows. */
function HeldRows({ live, range }: { live: LiveNotes; range: NoteRange }) {
  const held = useSyncExternalStore(live.subscribe, live.getHeld);
  return (
    <>
      {[...held]
        .filter((pitch) => pitch >= range.low && pitch <= range.high)
        .map((pitch) => (
          <div
            key={pitch}
            aria-hidden="true"
            data-held-pitch={pitch}
            className="pointer-events-none absolute left-0 z-30 bg-bb-pink"
            style={{ top: `calc(var(--head-h) + var(--cell-h) * ${range.high - pitch})`, width: "var(--name-w)", height: "var(--cell-h)" }}
          />
        ))}
    </>
  );
}

/** What a press on the squares is in the middle of doing. Everything's worked out from the notes as they were when it began. */
interface Gesture {
  readonly kind: "place" | "move" | "stretch";
  readonly pointer: number;
  readonly row: number;
  readonly column: number;
  readonly pitch: number;
  readonly bar: number;
  readonly base: readonly NoteData[];
  /** The note it took hold of. Placing makes its own. */
  readonly note: NoteData | null;
  lastRow: number;
  lastColumn: number;
  /** Has the pointer left the square it started on? Then letting go isn't taking a note away. */
  moved: boolean;
  /** Has it changed the song? The first change is an undo step and the rest are part of it. */
  sent: boolean;
  /** The notes as it last left them. Anything else means something else changed them meanwhile. */
  left: readonly NoteData[];
}

export interface NoteGridHandle {
  focus: (options?: FocusOptions) => void;
  /** Moves the view so this row and step are in the middle of it, as near as the edges allow. */
  showSpot: (row: number, column: number) => void;
}

export interface NoteGridProps {
  ref?: Ref<NoteGridHandle>;
  song: SongData;
  channelIndex: number;
  bar: number;
  transport: Transport;
  /** Grid cells give only the note and on or off, not the whole position. */
  shortCellNames: boolean;
  /** With the hand on, dragging moves the view and nothing else. */
  hand: boolean;
  /** Which notes the grid shows. */
  range: NoteRange;
  /** The pitch the cursor starts on. */
  homePitch: number;
  live: LiveNotes;
  /** A drag on the squares starts or ends: the grid mustn't change its rows under it. */
  onHold: (holding: boolean) => void;
  /** More keys for the row under the grid. */
  footKeys?: ReactNode;
  /** The bar keys sit under the grid, as they do when the bars are hidden. Otherwise they're under the song map. */
  barKeysHere?: boolean;
  /** Told the rows and steps in view whenever they change. */
  onView?: (view: GridInView) => void;
  art: BeatBoxArt;
  showArtSlots: boolean;
  /** Moves to the next or previous bar, if there is one. */
  onBarStep: (direction: 1 | -1) => boolean;
  /** `partOfLast` means this belongs to the same undo step as the change before it. */
  onNotesChange: (notes: readonly NoteData[], partOfLast?: boolean) => void;
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
  transport,
  shortCellNames,
  hand,
  range,
  homePitch,
  live,
  onHold,
  footKeys,
  barKeysHere = true,
  onView,
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

  const totalRows = range.high - range.low + 1;
  const totalColumns = stepsPerBar(song);
  const stepsPerBeat = gridStepsPerBeat(song);
  const stepParts = partsPerStep(song);
  const barParts = partsPerBar(song);
  const notes = patternAtBar(channel, bar)?.notes ?? [];
  const patternNumber = channel.bars[bar] ?? 0;
  const sharedBars = barsUsingPattern(channel, patternNumber);

  const [frame, viewWidth, viewHeight] = useElementSize();
  const startRow = Math.max(0, Math.min(totalRows - 1, range.high - homePitch));
  const [cursor, setCursor] = useState<GridCursor>({ row: startRow, column: 0 });
  // When the grid changes which notes it shows, the cursor stays on its note, or the nearest one there still is.
  const [highSeen, setHighSeen] = useState({ high: range.high, total: totalRows });
  if (highSeen.high !== range.high || highSeen.total !== totalRows) {
    setHighSeen({ high: range.high, total: totalRows });
    setCursor({ ...cursor, row: Math.max(0, Math.min(totalRows - 1, range.high - (highSeen.high - cursor.row))) });
  }
  const cursorNow = useRef(cursor);
  const [spot, setSpot] = useState({ row: Math.max(0, startRow - 12), column: 0 });
  const moveFocusToCell = useRef(false);
  const revealCursor = useRef(false);
  const startedAtHome = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const cellProbe = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState(44);

  const activeCell = useCallback(
    () => frame.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]') ?? null,
    [frame],
  );
  // The size comes from a theme token, so ask the browser how big it really is.
  useLayoutEffect(() => {
    setTarget(cellProbe.current?.getBoundingClientRect().width || 44);
  }, [viewWidth]);

  const fit = fitCanvas(viewWidth, viewHeight, target, totalColumns, totalRows);
  const viewAcross = Math.max(fit.cellWidth, viewWidth - fit.nameWidth);
  const viewDown = Math.max(fit.cellHeight, viewHeight - fit.headHeight);

  useImperativeHandle(
    ref,
    () => ({
      focus: (options) => activeCell()?.focus(options),
      showSpot(row, column) {
        const view = frame.current;
        if (!view) return;
        // The browser keeps a scroll inside the view by itself.
        view.scrollTop = Math.max(0, row * fit.cellHeight - (viewDown - fit.cellHeight) / 2);
        view.scrollLeft = Math.max(0, column * fit.cellWidth - (viewAcross - fit.cellWidth) / 2);
      },
    }),
    [activeCell, frame, fit.cellHeight, fit.cellWidth, viewAcross, viewDown],
  );

  /** The rows and columns in view right now, with the view just as the browser has it. */
  function inView() {
    const view = frame.current;
    return {
      rows: showing(view?.scrollTop ?? 0, fit.cellHeight, viewDown, totalRows),
      columns: showing(view?.scrollLeft ?? 0, fit.cellWidth, viewAcross, totalColumns),
    };
  }

  /** Keeps up with the view: draws what's come near it, and brings the cursor along if the view has left it behind. */
  function viewMoved() {
    const { rows, columns } = inView();
    onView?.({ firstRow: rows.first, lastRow: rows.last, firstColumn: columns.first, lastColumn: columns.last });
    setSpot((was) => (Math.abs(was.row - rows.first) <= SPARE_ROWS - 1 && Math.abs(was.column - columns.first) <= SPARE_COLUMNS - 1 ? was : { row: rows.first, column: columns.first }));
    if (gesture.current || revealCursor.current) return;
    const row = Math.max(rows.first, Math.min(rows.last, cursorNow.current.row));
    const column = Math.max(columns.first, Math.min(columns.last, cursorNow.current.column));
    if (row === cursorNow.current.row && column === cursorNow.current.column) return;
    moveFocusToCell.current = document.activeElement?.getAttribute("role") === "gridcell" && frame.current?.contains(document.activeElement) === true;
    placeCursor({ row, column });
  }

  function placeCursor(next: GridCursor) {
    cursorNow.current = next;
    setCursor(next);
  }

  useLayoutEffect(() => {
    cursorNow.current = cursor;
  });

  // Opens looking at the channel's own octave, with the cursor on the bottom row and the notes above it in view.
  useLayoutEffect(() => {
    const view = frame.current;
    if (!view || viewHeight === 0) return;
    if (!startedAtHome.current) {
      startedAtHome.current = true;
      view.scrollTop = Math.max(0, (startRow - fit.rows + 1) * fit.cellHeight);
    } else {
      // The squares changed size: stay where the cursor is.
      view.scrollTop = scrollToShow(view.scrollTop, fit.cellHeight, viewDown, cursorNow.current.row);
      view.scrollLeft = scrollToShow(view.scrollLeft, fit.cellWidth, viewAcross, cursorNow.current.column);
    }
    viewMoved();
    // Only when the squares change size, the room does, or the grid shows other notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.cellHeight, fit.cellWidth, viewHeight, viewWidth, range.low, range.high]);

  useLayoutEffect(() => {
    const view = frame.current;
    if (revealCursor.current && view) {
      view.scrollTop = scrollToShow(view.scrollTop, fit.cellHeight, viewDown, cursor.row);
      view.scrollLeft = scrollToShow(view.scrollLeft, fit.cellWidth, viewAcross, cursor.column);
      viewMoved();
    }
    revealCursor.current = false;
    if (moveFocusToCell.current) activeCell()?.focus({ preventScroll: true });
    moveFocusToCell.current = false;
  });

  /** Moves the cursor. The keyboard brings the view along; the mouse is already where it's looking, and the view stays still under it. */
  function goTo(next: GridCursor, by: "keys" | "mouse" | "drag" = "keys") {
    moveFocusToCell.current = true;
    revealCursor.current = by === "keys";
    const rowChanged = next.row !== cursorNow.current.row;
    placeCursor(next);
    if (rowChanged && by !== "drag") onCursorMoved(pitchOfRow(next.row));
  }

  function pitchOfRow(row: number): number {
    return range.high - row;
  }

  function nameOf(pitch: number): string {
    return pitchName(song, channel!, pitch);
  }

  /** Turns a note on or off. Returns the notes as they now are, or null if nothing changed. */
  function toggleAt(row: number, column: number): readonly NoteData[] | null {
    const pitch = pitchOfRow(row);
    const start = column * stepParts;
    const result = toggleNote(notes, pitch, start, start + stepParts);
    if (result.change === "chord-full") {
      onAnnounce(`${nameOf(pitch)} not added. A chord can hold ${MAX_CHORD_SIZE} notes.`);
      return null;
    }
    onNotesChange(result.notes);
    onToggled(pitch, result.change === "added");
    onAnnounce(`${nameOf(pitch)} ${result.change === "added" ? "on" : "off"}, ${spokenStep(column, stepsPerBeat)}.`);
    return result.notes;
  }

  function stretch(byParts: number) {
    const pitch = pitchOfRow(cursor.row);
    const part = cursor.column * stepParts;
    const stretched = stretchNote(notes, pitch, part, byParts, barParts);
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
      goTo(moveCursor(cursor, move, totalRows, totalColumns, fit.rows));
    }
  }

  /** The square under the pointer, wherever it's got to. */
  function squareAt(clientX: number, clientY: number): GridCursor {
    const view = frame.current;
    const box = view?.getBoundingClientRect();
    const across = clientX - (box?.left ?? 0) + (view?.scrollLeft ?? 0) - fit.nameWidth;
    const down = clientY - (box?.top ?? 0) + (view?.scrollTop ?? 0) - fit.headHeight;
    return {
      row: Math.max(0, Math.min(totalRows - 1, Math.floor(down / fit.cellHeight))),
      column: Math.max(0, Math.min(totalColumns - 1, Math.floor(across / fit.cellWidth))),
    };
  }

  function pressed(event: PointerEvent<HTMLDivElement>) {
    const view = frame.current;
    // A second finger is a pinch, not another note.
    if (!view || !event.isPrimary) return;
    const place = event.target instanceof Element ? event.target : null;
    // The right or middle button, the hand, or a press on the headings: that's taking hold of the canvas.
    if (event.button === 1 || event.button === 2 || hand || place?.closest('[role="rowheader"], [role="columnheader"]')) {
      if (event.button === 1) event.preventDefault();
      startPan(event, view);
      return;
    }
    if (event.button !== 0) return;
    const square = place?.closest<HTMLElement>('[role="gridcell"]');
    const row = Number(square?.parentElement?.dataset.row);
    const column = Number(square?.dataset.column);
    if (!square || Number.isNaN(row) || Number.isNaN(column)) return;

    view.setPointerCapture(event.pointerId);
    onHold(true);
    goTo({ row, column }, "mouse");
    const pitch = pitchOfRow(row);
    const start = column * stepParts;
    const under = noteAt(notes, start, start + stepParts);
    const held = { pointer: event.pointerId, row, column, pitch, bar, base: notes, lastRow: row, lastColumn: column, moved: false, sent: false, left: notes };
    if (under?.pitches.includes(pitch)) {
      // Held on a note: nothing changes until it either moves or the button comes up. It sinks at once, by its look.
      // Its right-hand end changes its length, wherever on that part of the square the press lands, its edge included.
      const box = square.getBoundingClientRect();
      const onItsEnd = under.end <= start + stepParts && event.clientX >= box.right - box.width * GRIP_SHARE;
      gesture.current = { ...held, kind: onItsEnd ? "stretch" : "move", note: under };
      return;
    }
    // On an empty square the note lands now. Another note in the same place makes this a chord, whose length is that note's.
    const placed = toggleAt(row, column);
    if (placed && !under) gesture.current = { ...held, kind: "place", note: null, sent: true, left: placed };
    else onHold(false);
  }

  function placedNotes(held: Gesture, row: number, column: number): readonly NoteData[] {
    const start = held.column * stepParts;
    const next = held.base.filter((note) => note.start >= start + stepParts).reduce((soonest, note) => Math.min(soonest, note.start), barParts);
    const end = Math.max(start + stepParts, Math.min(next, (column + 1) * stepParts));
    return [...held.base, makeNote([pitchOfRow(row)], start, end)].sort((a, b) => a.start - b.start);
  }

  function dragged(event: PointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || held.pointer !== event.pointerId) return;
    // The bar's moved on under it, or an undo or a recorded pass has changed its notes: working from what it remembers would write over them.
    if (held.bar !== bar || held.left !== notes) {
      gesture.current = null;
      onHold(false);
      return;
    }
    const view = frame.current;
    // Off the edge of the view, the view follows.
    if (view) {
      const box = view.getBoundingClientRect();
      if (event.clientY > box.bottom) view.scrollTop += fit.cellHeight;
      else if (event.clientY < box.top + fit.headHeight) view.scrollTop -= fit.cellHeight;
      if (event.clientX > box.right) view.scrollLeft += fit.cellWidth;
      else if (event.clientX < box.left + fit.nameWidth) view.scrollLeft -= fit.cellWidth;
    }
    const { row, column } = squareAt(event.clientX, event.clientY);
    if (row === held.lastRow && column === held.lastColumn) return;
    const pitchChanged = row !== held.lastRow;
    held.lastRow = row;
    held.lastColumn = column;
    held.moved = true;

    let next: readonly NoteData[];
    let cursorRow = row;
    if (held.kind === "place") {
      next = placedNotes(held, row, column);
    } else if (held.kind === "move" && held.note) {
      next = moveNote(held.base, held.note, held.pitch, (column - held.column) * stepParts, pitchOfRow(row) - held.pitch, barParts, range.high);
    } else if (held.note) {
      next = setNoteEnd(held.base, held.note, (column + 1) * stepParts, stepParts, barParts);
      cursorRow = held.row;
    } else {
      return;
    }
    goTo({ row: cursorRow, column }, "drag");
    // A place that's taken: nothing has changed, so it costs no undo step.
    if (!held.sent && JSON.stringify(next) === JSON.stringify(held.base)) return;
    onNotesChange(next, held.sent);
    held.sent = true;
    held.left = next;
    if (pitchChanged && held.kind !== "stretch") onToggled(pitchOfRow(row), true);
  }

  function letGo(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const held = gesture.current;
    if (!held || held.pointer !== event.pointerId) return;
    gesture.current = null;
    onHold(false);
    if (held.bar !== bar || held.left !== notes) return;
    if (cancelled) {
      // A finger that turned out to be the start of a pinch or a scroll leaves no note behind.
      if (held.sent) onNotesChange(held.base, true);
      return;
    }
    if (!held.moved && (held.kind === "move" || held.kind === "stretch")) {
      // Pressed and let go on the same spot: that's taking it away.
      toggleAt(held.row, held.column);
      return;
    }
    if (!held.sent) return;
    if (held.kind === "place" && (held.lastRow !== held.row || held.lastColumn !== held.column)) {
      onAnnounce(`${nameOf(pitchOfRow(held.lastRow))} on, ${spokenStep(held.column, stepsPerBeat)}, ${Math.max(1, held.lastColumn - held.column + 1)} steps long.`);
    }
    if (held.kind === "move") onAnnounce(`Note moved to ${nameOf(pitchOfRow(held.lastRow))}, ${spokenStep(held.lastColumn, stepsPerBeat)}.`);
    if (held.kind === "stretch") onAnnounce(`Note now ends at ${spokenStep(held.lastColumn, stepsPerBeat)}.`);
  }

  // A screen reader's press arrives as a click with no pointer before it.
  function clicked(event: MouseEvent<HTMLDivElement>) {
    if (event.detail !== 0) return;
    const square = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="gridcell"]') : null;
    const row = Number(square?.parentElement?.dataset.row);
    const column = Number(square?.dataset.column);
    if (!square || Number.isNaN(row) || Number.isNaN(column)) return;
    goTo({ row, column });
    toggleAt(row, column);
  }

  // A press on the headings would otherwise take the cursor away from the squares; the middle button would start the browser's own scrolling.
  function mouseDown(event: MouseEvent<HTMLDivElement>) {
    const place = event.target instanceof Element ? event.target : null;
    if (event.button === 1 || place?.closest('[role="rowheader"], [role="columnheader"]')) event.preventDefault();
  }

  // Everything within the rows drawn, the cursor's own always among them: it has the keyboard, even in the moment before the view catches it up.
  const rowsDrawn = fit.rows + SPARE_ROWS * 2 + 2;
  const columnsDrawn = Math.ceil(viewAcross / fit.cellWidth) + SPARE_COLUMNS * 2 + 2;
  const firstRow = Math.min(cursor.row, Math.max(0, Math.min(totalRows - rowsDrawn, spot.row - SPARE_ROWS)));
  const lastRow = Math.max(cursor.row, Math.min(totalRows - 1, Math.max(0, Math.min(totalRows - rowsDrawn, spot.row - SPARE_ROWS)) + rowsDrawn - 1));
  const firstColumn = Math.min(cursor.column, Math.max(0, Math.min(totalColumns - columnsDrawn, spot.column - SPARE_COLUMNS)));
  const lastColumn = Math.max(cursor.column, Math.min(totalColumns - 1, Math.max(0, Math.min(totalColumns - columnsDrawn, spot.column - SPARE_COLUMNS)) + columnsDrawn - 1));
  const rows = Array.from({ length: lastRow - firstRow + 1 }, (_, index) => firstRow + index);
  const headColumns = Array.from({ length: lastColumn - firstColumn + 1 }, (_, index) => firstColumn + index);

  // Only read for which channels are drums, which never changes while it's drawn.
  const shapeSource = useMemo(() => song, [song.channels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridStyle = {
    "--cell": "var(--target-min)",
    "--cell-w": `${fit.cellWidth}px`,
    "--cell-h": `${fit.cellHeight}px`,
    "--head-h": `${fit.headHeight}px`,
    "--name-w": `${fit.nameWidth}px`,
    minHeight: "calc(var(--cell) * 4.7)",
  } as CSSProperties;

  return (
    <section aria-label="Note grid" className="relative flex min-h-0 w-full flex-1 flex-col">
      <h2 className="sr-only">
        {channelName(song, channelIndex)}, bar {bar + 1}
        {patternNumber === 0 ? ", silent" : `, pattern ${patternNumber}`}
        {sharedBars > 1 ? `, on ${sharedBars} bars` : ""}
        {patternNumber !== 0 && notes.length === 0 ? ", empty" : ""}
      </h2>

      <div className="flex min-h-0 w-full flex-1">
        <div
          ref={frame}
          onScroll={viewMoved}
          onPointerDown={pressed}
          onPointerMove={dragged}
          onPointerUp={(event) => letGo(event, false)}
          onPointerCancel={(event) => letGo(event, true)}
          onMouseDown={mouseDown}
          onClick={clicked}
          className={`bb-canvas relative min-h-0 min-w-0 flex-1 overflow-auto ${hand ? "bb-hand" : ""}`}
          style={gridStyle}
        >
          <div
            role="grid"
            aria-label={`Notes, ${channelName(song, channelIndex)}, bar ${bar + 1}`}
            aria-rowcount={totalRows + 1}
            aria-colcount={totalColumns + 1}
            onKeyDown={keyDown}
            className="relative select-none"
            style={{ width: fit.width, height: fit.height }}
          >
            <div ref={cellProbe} aria-hidden="true" role="presentation" className="absolute" style={{ width: "var(--cell)", height: 0 }} />
            <div role="row" aria-rowindex={1} className="sticky top-0 z-40 flex" style={{ height: "var(--head-h)" }}>
              <div role="columnheader" aria-colindex={1} aria-label="Note" className={`${fit.width > viewWidth ? "sticky left-0 z-10" : ""} flex-none cursor-grab bg-bb-nigrosine`} style={{ width: "var(--name-w)", height: "var(--head-h)" }} />
              {firstColumn > 0 && <div role="presentation" className="flex-none" style={{ width: `calc(var(--cell-w) * ${firstColumn})` }} />}
              {headColumns.map((column) => (
                <div
                  key={column}
                  role="columnheader"
                  aria-colindex={column + 2}
                  aria-label={spokenStep(column, stepsPerBeat)}
                  className={`flex flex-none cursor-grab items-center justify-start overflow-visible bg-bb-nigrosine text-bb-cell-l font-bold whitespace-nowrap ${column % stepsPerBeat === 0 ? "bb-beat-line" : ""}`}
                  style={{ width: "var(--cell-w)", height: "var(--head-h)" }}
                >
                  {/* Only the beats are numbered: the lines mark the steps between them. */}
                  {column % stepsPerBeat === 0 ? Math.floor(column / stepsPerBeat) + 1 : ""}
                </div>
              ))}
            </div>

            {firstRow > 0 && <div role="presentation" style={{ height: `calc(var(--cell-h) * ${firstRow})` }} />}
            {rows.map((row) => {
              const pitch = pitchOfRow(row);
              return (
                <NoteRow
                  key={row}
                  row={row}
                  name={nameOf(pitch)}
                  spans={spansOf(notes, pitch)}
                  firstColumn={firstColumn}
                  lastColumn={lastColumn}
                  cursorColumn={row === cursor.row ? cursor.column : -1}
                  bar={row === cursor.row ? bar : 0}
                  stepParts={stepParts}
                  stepsPerBeat={stepsPerBeat}
                  shortCellNames={shortCellNames}
                  channelIndex={channelIndex}
                  song={shapeSource}
                  namesStick={fit.width > viewWidth}
                />
              );
            })}
            <HeldRows live={live} range={range} />
            <Playhead
              transport={transport}
              headerCells={1}
              columnOf={(playing) => (playing.bar === bar ? playing.step : null)}
              hitsAt={(playing): HitNote[] => {
                if (playing.bar !== bar) return [];
                const start = playing.step * stepParts;
                const note = noteAt(notes, start, start + stepParts);
                return note ? note.pitches.filter((pitch) => pitch >= range.low && pitch <= range.high).map((pitch) => ({ row: range.high - pitch })) : [];
              }}
            />
          </div>
        </div>
        <ScrollRail
          view={frame}
          axis="up-down"
          step={fit.cellHeight * ROWS_PER_ARROW}
          backGlyph={GLYPHS.up}
          forwardGlyph={GLYPHS.down}
          backName="Higher"
          forwardName="Lower"
        />
      </div>

      {/* After the view in the page, so its coming and going doesn't make the browser look over every square. It shows over them. */}
      {notes.length === 0 && (
        <div className="pointer-events-none z-30 order-first flex flex-none flex-wrap items-center gap-bb-gutter bg-bb-nigrosine p-2 text-display font-bold uppercase md:absolute md:top-1/2 md:left-1/2 md:w-max md:max-w-full md:-translate-x-1/2 md:-translate-y-1/2 md:flex-nowrap">
          <PixelSlot name="empty-state" size="scene" src={art.emptyState} showEmpty={showArtSlots} />
          <p>
            Click a square.
            <br />
            Or arrows and Enter.
          </p>
        </div>
      )}

      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 p-1">
        {barKeysHere && <BarKeys bar={bar} barCount={song.barCount} onStep={onBarStep} />}
        <ScrollRail
          view={frame}
          axis="across"
          step={fit.cellWidth * stepsPerBeat}
          backGlyph={GLYPHS.left}
          forwardGlyph={GLYPHS.right}
          backName="Earlier"
          forwardName="Later"
        />
        {footKeys}
      </div>
    </section>
  );
}
