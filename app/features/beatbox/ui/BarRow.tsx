'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { SongData } from "../engine/songData";
import type { Transport } from "./app";
import { ChoiceGroup } from "./ChoiceGroup";
import { channelName, noteShapeStyle } from "./channelLooks";
import { columnWindowStart, moveCursor, visibleColumnCount, type GridMove } from "./gridView";
import { stripKey } from "./looks";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead } from "./Playhead";
import { setBarPattern, setLoop } from "./songEdit";
import { useElementSize } from "./useElementSize";

export interface BarPick {
  readonly channel: number;
  readonly bar: number;
}

/** Local-only, while Luke picks: where the bars live. */
export type BarLayout = "strip" | "map" | "tracker";

const KEY_MOVES: Record<string, GridMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "row-start",
  End: "row-end",
};

// In the tracker the bars run down and the channels across, so the arrows swap round.
const TRACKER_KEYS: Record<string, string> = {
  ArrowUp: "ArrowLeft",
  ArrowDown: "ArrowRight",
  ArrowLeft: "ArrowUp",
  ArrowRight: "ArrowDown",
};

// The row names take this many cells, and one more when there are channel icons.
const NAME_CELLS = 2;

export interface BarRowProps {
  layout: BarLayout;
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
  layout,
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
  const [frame, gridWidth, gridHeight] = useElementSize();
  const [cellSize, setCellSize] = useState(64);
  const activeCell = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setCellSize(cellProbe.current?.getBoundingClientRect().width || 64);
  }, [gridWidth]);

  useLayoutEffect(() => {
    if (moveFocus.current) activeCell.current?.focus();
    moveFocus.current = false;
  });

  const tracker = layout === "tracker";
  const headHeight = Math.round(cellSize * 0.75);
  const columnCount = tracker
    ? Math.min(song.barCount, Math.max(1, Math.floor((gridHeight - headHeight) / cellSize)))
    : visibleColumnCount(gridWidth - cellSize * (HEADER_CELLS - 1), cellSize, 4, song.barCount);
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

  /** The pattern of this bar, on every bar of the loop. */
  function fillLoop() {
    const number = song.channels[pick.channel]?.bars[pick.bar] ?? 0;
    let next = song;
    for (let bar = song.loopStart; bar <= loopEnd; bar += 1) next = setBarPattern(next, pick.channel, bar, number);
    onChange(next);
    onAnnounce(`${channelName(song, pick.channel)}: ${number === 0 ? "silent" : `pattern ${number}`} on the whole loop.`);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.metaKey) return;
    const key = tracker ? (TRACKER_KEYS[event.key] ?? event.key) : event.key;
    const current = song.channels[pick.channel]?.bars[pick.bar] ?? 0;
    if (event.shiftKey && (key === "ArrowRight" || key === "ArrowLeft")) {
      event.preventDefault();
      const direction = key === "ArrowRight" ? 1 : -1;
      const end = Math.max(0, Math.min(song.barCount - 1, (selectEnd ?? pick.bar) + direction));
      setSelectEnd(end);
      onAnnounce(`Bars ${Math.min(pick.bar, end) + 1} to ${Math.max(pick.bar, end) + 1} picked. L loops them.`);
      return;
    }
    if (key === "l" || key === "L") {
      event.preventDefault();
      event.stopPropagation();
      applyLoop();
      return;
    }
    if (key === "f" || key === "F") {
      event.preventDefault();
      event.stopPropagation();
      fillLoop();
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      onOpenGrid();
      return;
    }
    if (/^[0-9]$/.test(key) && !event.ctrlKey) {
      event.preventDefault();
      setPattern(Number(key));
      return;
    }
    if (key === "+" || key === "=") {
      event.preventDefault();
      setPattern(current + 1);
      return;
    }
    if (key === "-") {
      event.preventDefault();
      setPattern(current - 1);
      return;
    }
    const ctrl = event.ctrlKey && (key === "Home" || key === "End");
    const move: GridMove | undefined = ctrl ? (key === "Home" ? "grid-start" : "grid-end") : KEY_MOVES[key];
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

  function cellLook(channelIndex: number, bar: number, number: number): { className: string; active: boolean } {
    const active = pick.channel === channelIndex && pick.bar === bar;
    const inSelection = pick.channel === channelIndex && bar >= selectFrom && bar <= selectTo;
    return {
      active,
      className: `bb-bar-cell flex flex-none cursor-pointer items-center justify-center font-bold focus:outline-none active:bg-bb-pink active:text-bb-black ${number === 0 ? "bg-bb-black" : "bg-bb-royal-blue"} ${inSelection ? "underline decoration-(length:--beat-line)" : ""} ${active ? "relative z-10 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`,
    };
  }

  function barCell(channelIndex: number, bar: number, style: CSSProperties) {
    const number = song.channels[channelIndex]?.bars[bar] ?? 0;
    const { active, className } = cellLook(channelIndex, bar, number);
    const inSelection = pick.channel === channelIndex && bar >= selectFrom && bar <= selectTo;
    return (
      <div
        key={`${channelIndex}-${bar}`}
        ref={active ? activeCell : undefined}
        role="gridcell"
        aria-colindex={(tracker ? channelIndex : bar) + 2}
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
        className={className}
        style={style}
      >
        {number === 0 ? "-" : number}
      </div>
    );
  }

  function barNumber(bar: number, style: CSSProperties) {
    const inLoop = bar >= song.loopStart && bar <= loopEnd;
    return (
      <div
        key={bar}
        role={tracker ? "rowheader" : "columnheader"}
        aria-colindex={tracker ? 1 : bar + 2}
        aria-label={`Bar ${bar + 1}${inLoop ? ", in the loop" : ""}`}
        className={`flex flex-none items-center justify-center font-bold whitespace-nowrap ${inLoop ? "bg-bb-emerald text-bb-black" : ""}`}
        style={style}
      >
        {bar === song.loopStart ? "[" : ""}
        {bar + 1}
        {bar === loopEnd ? "]" : ""}
      </div>
    );
  }

  const patternKeys = (
    <div role="group" aria-label="This bar" className="flex flex-wrap items-center gap-1">
      <button type="button" aria-label="Previous pattern" title="Previous pattern (-)" onClick={() => setPattern((song.channels[pick.channel]?.bars[pick.bar] ?? 0) - 1)} className={stripKey()}>
        -
      </button>
      <button type="button" aria-label="Next pattern" title="Next pattern (+)" onClick={() => setPattern((song.channels[pick.channel]?.bars[pick.bar] ?? 0) + 1)} className={stripKey()}>
        +
      </button>
      <button type="button" title="This bar's notes on the whole loop (F, in the bars)" onClick={fillLoop} className={stripKey()}>
        Fill
      </button>
      <button type="button" title="Loop the picked bars (L, in the bars)" onClick={applyLoop} className={stripKey()}>
        Loop
      </button>
    </div>
  );

  const channelKeys = (
    <ChoiceGroup
      label="Channel"
      hideLabel
      value={pick.channel}
      options={song.channels.map((_, index) => ({ value: index, label: channelName(song, index) }))}
      onChange={(channel) => onPick({ channel, bar: pick.bar })}
      look={stripKey}
    />
  );

  if (layout === "strip") {
    const gridStyle = { "--cell": "var(--target-min)", "--head-h": "var(--target-swatch)" } as CSSProperties;
    const cell = { width: "var(--cell)", height: "var(--cell)" };
    const head = { width: "var(--cell)" };
    return (
      <section aria-label="Bars" className="flex w-full flex-none flex-col gap-1 px-2 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {channelKeys}
          {patternKeys}
        </div>
        <div ref={frame} className="w-full" style={gridStyle}>
          <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
          <div
            role="grid"
            aria-label={`Bars for ${channelName(song, pick.channel)}. Numbers are patterns.`}
            aria-rowcount={2}
            aria-colcount={song.barCount}
            onKeyDown={keyDown}
            className="relative w-fit select-none text-bb-cell-m"
          >
            <div role="row" aria-rowindex={1} className="flex">
              {columns.map((bar) => barNumber(bar, head))}
            </div>
            <div role="row" aria-rowindex={2} className="flex">
              {columns.map((bar) => barCell(pick.channel, bar, cell))}
            </div>
            <Playhead
              transport={transport}
              headerCells={0}
              columnOf={(spot) => {
                const column = spot.bar - firstColumn;
                return column >= 0 && column < columnCount ? column : null;
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  if (tracker) {
    const gridStyle = { "--cell": "var(--target-min)", "--head-h": `${headHeight}px` } as CSSProperties;
    const cell = { width: "var(--cell)", height: "var(--cell)", flex: "1 1 0" };
    const head = { height: "var(--head-h)", flex: "1 1 0" };
    return (
      <section aria-label="Bars" className="flex w-[17rem] flex-none flex-col gap-1 border-r-(length:--frame-width) border-bb-white p-1">
        <div className="order-last">{patternKeys}</div>
        <div ref={frame} className="min-h-0 w-full flex-1 overflow-hidden" style={gridStyle}>
          <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
          <div
            role="grid"
            aria-label="Bars for each channel. Numbers are patterns."
            aria-rowcount={song.barCount + 1}
            aria-colcount={song.channels.length + 1}
            onKeyDown={keyDown}
            className="relative w-full select-none text-bb-cell-m"
          >
            <div role="row" aria-rowindex={1} className="flex">
              <div role="columnheader" aria-colindex={1} className="flex items-center justify-center font-bold" style={head}>
                Bar
              </div>
              {song.channels.map((channel, index) => (
                <div
                  key={index}
                  role="columnheader"
                  aria-colindex={index + 2}
                  aria-label={channelName(song, index)}
                  title={channelName(song, index)}
                  className={`flex items-center justify-center font-bold ${pick.channel === index ? "bg-bb-daffodil text-bb-black" : ""}`}
                  style={head}
                >
                  {channel.isDrum ? "DR" : `T${index + 1}`}
                </div>
              ))}
            </div>
            {columns.map((bar, position) => (
              <div key={bar} role="row" aria-rowindex={position + 2} className="flex">
                {barNumber(bar, cell)}
                {song.channels.map((_, channelIndex) => barCell(channelIndex, bar, cell))}
              </div>
            ))}
            <Playhead
              transport={transport}
              headerCells={0}
              across
              columnOf={(spot) => {
                const column = spot.bar - firstColumn;
                return column >= 0 && column < columnCount ? column : null;
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  // The map: every channel and bar, under the grid.
  const gridStyle = { "--cell": "var(--target-min)" } as CSSProperties;
  const headerStyle = { width: `calc(var(--cell) * ${HEADER_CELLS})`, height: "var(--cell)" };
  const cellStyle = { width: "var(--cell)", height: "var(--cell)" };

  return (
    <section aria-label="Bars" className="order-last flex w-full flex-none flex-col gap-1 border-t-(length:--frame-width) border-bb-white px-2 pt-1">
      {patternKeys}
      <div ref={frame} className="w-full" style={gridStyle}>
        <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
        <div
          role="grid"
          aria-label="Bars for each channel. Numbers are patterns."
          aria-rowcount={song.channels.length + 1}
          aria-colcount={song.barCount + 1}
          onKeyDown={keyDown}
          className="relative w-fit select-none text-bb-cell-m"
        >
          <div role="row" aria-rowindex={1} className="flex">
            <div role="columnheader" aria-colindex={1} className="flex flex-none items-center font-bold" style={headerStyle}>
              Bar
            </div>
            {columns.map((bar) => barNumber(bar, cellStyle))}
          </div>

          {song.channels.map((_, channelIndex) => (
            <div key={channelIndex} role="row" aria-rowindex={channelIndex + 2} className="flex">
              <div
                role="rowheader"
                aria-colindex={1}
                className="flex flex-none items-center gap-2 overflow-hidden font-bold whitespace-nowrap"
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
              {columns.map((bar) => barCell(channelIndex, bar, cellStyle))}
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
    </section>
  );
}
