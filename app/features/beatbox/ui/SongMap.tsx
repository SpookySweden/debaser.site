'use client';

import { useMemo, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import type { SongData } from "../engine/songData";
import type { Transport } from "./app";
import type { NoteRange } from "./gridView";
import { barColumns, columnOf, litPixels, mapShape, spotAt, viewBox, type ViewStore } from "./mapPixels";

const NO_VIEW = () => null;

/**
 * The whole song for the picked channel in a few big pixels: its notes, its bars in turn dark and darker, the column being played, and a box
 * round what the grid shows. Pressing or dragging on it moves the grid there. A mouse's shortcut only: the keyboard has the bar keys and the
 * grid's own arrows, so it's hidden from screen readers and takes no Tab stop.
 */
export function SongMap({
  song,
  channelIndex,
  range,
  bar,
  transport,
  view,
  onGo,
}: {
  song: SongData;
  channelIndex: number;
  range: NoteRange;
  /** The bar the grid shows. */
  bar: number;
  transport: Transport;
  view: ViewStore;
  /** A press on the map: show this bar, with this step and grid row in the middle of the view. */
  onGo: (spot: { bar: number; step: number; row: number }) => void;
}) {
  const channel = song.channels[channelIndex];
  // The page works its range out afresh each time it draws, so only a change of notes counts.
  const { low, high } = range;
  const rows = useMemo<NoteRange>(() => ({ low, high, widened: false }), [low, high]);
  const shape = useMemo(() => mapShape(song, rows), [song, rows]);
  const lit = useMemo(() => (channel ? [...litPixels(song, channel, rows, shape)] : []), [song, channel, rows, shape]);
  const seen = useSyncExternalStore(view.subscribe, view.get, NO_VIEW);
  const playing = useSyncExternalStore(transport.subscribe, transport.getSpot, NO_VIEW);
  const dragging = useRef<number | null>(null);
  const lastPlace = useRef("");

  // Every other bar a shade darker, so the bars can be told apart. Bars sharing a pixel take turns by the pixel instead.
  const shaded: { column: number; lastColumn: number }[] = [];
  let turn = 0;
  let previous = -1;
  for (let index = 0; index < shape.barCount; index += 1) {
    const columns = barColumns(shape, index);
    if (columns.column === previous) continue;
    previous = columns.column;
    if (turn % 2 === 1) shaded.push(columns);
    turn += 1;
  }

  const box = viewBox(shape, seen ? { bar, ...seen } : { bar, firstRow: 0, lastRow: shape.totalRows - 1, firstColumn: 0, lastColumn: shape.stepsPerBar - 1 });
  const playColumn = playing ? columnOf(shape, playing.bar, playing.step) : null;

  function go(event: PointerEvent<HTMLDivElement>) {
    const area = event.currentTarget.getBoundingClientRect();
    if (area.width === 0 || area.height === 0) return;
    const spot = spotAt(shape, (event.clientX - area.left) / area.width, (event.clientY - area.top) / area.height);
    const place = `${spot.bar},${spot.step},${spot.row}`;
    if (place === lastPlace.current) return;
    lastPlace.current = place;
    onGo(spot);
  }

  function pressed(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = event.pointerId;
    lastPlace.current = "";
    go(event);
  }

  function dragged(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) go(event);
  }

  function letGo(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) dragging.current = null;
  }

  // The cursor stays where it was, on the grid, so the arrows still work after a press here.
  function mouseDown(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  const style = {
    height: "var(--map-height)",
    gridTemplateColumns: `repeat(${shape.columns}, 1fr)`,
    gridTemplateRows: `repeat(${shape.rows}, 1fr)`,
  } as CSSProperties;
  const span = (first: number, last: number) => `${first + 1} / ${last + 2}`;

  return (
    <div
      aria-hidden="true"
      data-song-map={`${shape.columns}x${shape.rows}`}
      title="The whole song. Click or drag to look there."
      onPointerDown={pressed}
      onPointerMove={dragged}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onMouseDown={mouseDown}
      className="relative grid w-full flex-none cursor-crosshair touch-none select-none border-(length:--frame-width) border-bb-white bg-bb-black"
      style={style}
    >
      {shaded.map(({ column, lastColumn }) => (
        <div key={`bar-${column}`} className="bg-bb-nigrosine" style={{ gridColumn: span(column, lastColumn), gridRow: "1 / -1" }} />
      ))}
      {playColumn !== null && <div data-map-playhead={playColumn} className="bg-bb-flavine" style={{ gridColumn: span(playColumn, playColumn), gridRow: "1 / -1" }} />}
      {lit.map((place) => {
        const [column = 0, row = 0] = place.split(",").map(Number);
        return <div key={place} className="bg-bb-pink" style={{ gridColumn: span(column, column), gridRow: span(row, row) }} />;
      })}
      <div
        data-map-view={`${box.column}-${box.lastColumn}:${box.row}-${box.lastRow}`}
        className="pointer-events-none z-10 outline-(length:--border-width) outline-bb-daffodil"
        style={{ gridColumn: span(box.column, box.lastColumn), gridRow: span(box.row, box.lastRow) }}
      />
    </div>
  );
}
