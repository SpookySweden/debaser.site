'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SongData } from "../engine/songData";
import type { Transport } from "./app";
import { channelName, noteShapeStyle } from "./channelLooks";
import { columnWindowStart, moveCursor, visibleColumnCount, type GridMove } from "./gridView";
import { smallKey, titleLine } from "./looks";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead } from "./Playhead";
import { setBarPattern, setLoop } from "./songEdit";
import { useElementWidth } from "./useElementWidth";

export interface BarPick {
  readonly channel: number;
  readonly bar: number;
}

const KEY_MOVES: Record<string, GridMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "row-start",
  End: "row-end",
};

// The row names take this many cells, and one more when there are channel icons.
const NAME_CELLS = 2;

export interface BarRowProps {
  song: SongData;
  pick: BarPick;
  transport: Transport;
  onPick: (pick: BarPick) => void;
  onChange: (song: SongData) => void;
  onAnnounce: (message: string) => void;
  onOpenGrid: () => void;
  art: BeatBoxArt;
  showArtSlots: boolean;
}

export function BarRow({
  song,
  pick,
  transport,
  onPick,
  onChange,
  onAnnounce,
  onOpenGrid,
  art,
  showArtSlots,
}: BarRowProps) {
  const HEADER_CELLS = NAME_CELLS + (showArtSlots || art.channelIcons ? 1 : 0);
  const [selectEnd, setSelectEnd] = useState<number | null>(null);
  const [frame, gridWidth] = useElementWidth();
  const [cellWidth, setCellWidth] = useState(64);
  const activeCell = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setCellWidth(cellProbe.current?.getBoundingClientRect().width || 64);
  }, [gridWidth]);

  useLayoutEffect(() => {
    if (moveFocus.current) activeCell.current?.focus();
    moveFocus.current = false;
  });

  const columnCount = visibleColumnCount(gridWidth - cellWidth * (HEADER_CELLS - 1), cellWidth, 4, song.barCount);
  const firstColumn = columnWindowStart(pick.bar, columnCount);
  const columns = Array.from({ length: columnCount }, (_, index) => firstColumn + index);
  const selectFrom = Math.min(pick.bar, selectEnd ?? pick.bar);
  const selectTo = Math.max(pick.bar, selectEnd ?? pick.bar);
  const loopEnd = song.loopStart + song.loopLength - 1;

  function goTo(next: BarPick, keepSelection = false) {
    moveFocus.current = true;
    if (!keepSelection) setSelectEnd(null);
    onPick(next);
  }

  function setPattern(number: number) {
    const next = setBarPattern(song, pick.channel, pick.bar, number);
    onChange(next);
    const actual = next.channels[pick.channel]?.bars[pick.bar] ?? 0;
    onAnnounce(
      `${channelName(song, pick.channel)}, bar ${pick.bar + 1}: ${actual === 0 ? "silent" : `pattern ${actual}`}.`,
    );
  }

  function applyLoop() {
    const next = setLoop(song, selectFrom, selectTo);
    onChange(next);
    onAnnounce(`Loop: bars ${next.loopStart + 1} to ${next.loopStart + next.loopLength}.`);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.metaKey) return;
    const current = song.channels[pick.channel]?.bars[pick.bar] ?? 0;
    if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const end = Math.max(0, Math.min(song.barCount - 1, (selectEnd ?? pick.bar) + direction));
      setSelectEnd(end);
      onAnnounce(`Bars ${Math.min(pick.bar, end) + 1} to ${Math.max(pick.bar, end) + 1} picked. L loops them.`);
      return;
    }
    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      event.stopPropagation();
      applyLoop();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenGrid();
      return;
    }
    if (/^[0-9]$/.test(event.key) && !event.ctrlKey) {
      event.preventDefault();
      setPattern(Number(event.key));
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setPattern(current + 1);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      setPattern(current - 1);
      return;
    }
    const ctrl = event.ctrlKey && (event.key === "Home" || event.key === "End");
    const move: GridMove | undefined = ctrl ? (event.key === "Home" ? "grid-start" : "grid-end") : KEY_MOVES[event.key];
    if (move && (ctrl || !event.ctrlKey)) {
      event.preventDefault();
      const next = moveCursor(
        { row: pick.channel, column: pick.bar },
        move,
        song.channels.length,
        song.barCount,
        song.channels.length,
      );
      goTo({ channel: next.row, bar: next.column });
    }
  }

  const gridStyle = { "--cell": "max(var(--cell-m), min(var(--cell-l), 12vw))" } as CSSProperties;
  const headerStyle = { width: `calc(var(--cell) * ${HEADER_CELLS})`, height: "var(--cell)" };
  const cellStyle = { width: "var(--cell)", height: "var(--cell)" };

  return (
    <section aria-label="Bars" className="flex w-full flex-col gap-bb-gutter">
      <h2 className={titleLine}>
        <span>
          Bars. Loop: {song.loopStart + 1} to {loopEnd + 1}
        </span>
      </h2>
      <div ref={frame} className="w-full" style={gridStyle}>
        <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
        <div
          role="grid"
          aria-label="Bars for each channel. Numbers are patterns."
          aria-rowcount={song.channels.length + 1}
          aria-colcount={song.barCount + 1}
          onKeyDown={keyDown}
          className="relative w-fit select-none text-bb-cell-l"
        >
          <div role="row" aria-rowindex={1} className="flex">
            <div role="columnheader" aria-colindex={1} className="flex flex-none items-center font-bold" style={headerStyle}>
              Bar
            </div>
            {columns.map((bar) => {
              const inLoop = bar >= song.loopStart && bar <= loopEnd;
              return (
                <div
                  key={bar}
                  role="columnheader"
                  aria-colindex={bar + 2}
                  aria-label={`Bar ${bar + 1}${inLoop ? ", in the loop" : ""}`}
                  className={`flex flex-none items-center justify-center font-bold ${inLoop ? "bg-bb-emerald text-bb-black" : ""}`}
                  style={cellStyle}
                >
                  {bar === song.loopStart ? "[" : ""}
                  {bar + 1}
                  {bar === loopEnd ? "]" : ""}
                </div>
              );
            })}
          </div>

          {song.channels.map((channel, channelIndex) => (
            <div key={channelIndex} role="row" aria-rowindex={channelIndex + 2} className="flex">
              <div
                role="rowheader"
                aria-colindex={1}
                className="flex flex-none items-center gap-2 overflow-hidden font-bold wrap-anywhere"
                style={headerStyle}
              >
                <PixelSlot
                  name={`channel-icon-${channelIndex + 1}`}
                  size="icon"
                  src={art.channelIcons?.[channelIndex]}
                  showEmpty={showArtSlots}
                />
                <span
                  aria-hidden="true"
                  className="block flex-none bg-bb-pink"
                  style={{ width: "var(--target-swatch)", height: "var(--target-swatch)", ...noteShapeStyle(song, channelIndex, true, true) }}
                />
                {channelName(song, channelIndex)}
              </div>
              {columns.map((bar) => {
                const number = channel.bars[bar] ?? 0;
                const active = pick.channel === channelIndex && pick.bar === bar;
                const inSelection = pick.channel === channelIndex && bar >= selectFrom && bar <= selectTo;
                return (
                  <div
                    key={bar}
                    ref={active ? activeCell : undefined}
                    role="gridcell"
                    aria-colindex={bar + 2}
                    aria-selected={inSelection}
                    aria-label={`${channelName(song, channelIndex)}, bar ${bar + 1}, ${number === 0 ? "silent" : `pattern ${number}`}`}
                    tabIndex={active ? 0 : -1}
                    onClick={(event) => {
                      if (event.shiftKey && pick.channel === channelIndex) {
                        setSelectEnd(bar);
                        return;
                      }
                      goTo({ channel: channelIndex, bar });
                    }}
                    className={`bb-bar-cell flex flex-none cursor-pointer items-center justify-center font-bold focus:outline-none active:bg-bb-pink active:text-bb-black ${number === 0 ? "bg-bb-black" : "bg-bb-royal-blue"} ${inSelection ? "underline decoration-(length:--beat-line)" : ""} ${active ? "relative z-10 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`}
                    style={cellStyle}
                  >
                    {number === 0 ? "-" : number}
                  </div>
                );
              })}
            </div>
          ))}
          <Playhead
            transport={transport}
            headerCells={HEADER_CELLS}
            columnOf={(spot) => {
              const column = spot.bar - firstColumn;
              return column >= 0 && column < columnCount ? column : null;
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-bb-gutter">
        <button type="button" onClick={applyLoop} className={smallKey()}>
          Loop picked bars (L)
        </button>
      </div>
    </section>
  );
}
