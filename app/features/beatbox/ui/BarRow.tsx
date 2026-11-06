'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { SongData } from "../engine/songData";
import type { Transport } from "./app";
import { channelName, noteShapeStyle } from "./channelLooks";
import { columnWindowStart, moveCursor, type GridMove } from "./gridView";
import { stripKey } from "./looks";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead } from "./Playhead";
import { barsUsingPattern, setBarPattern, setLoop } from "./songEdit";
import { useElementSize } from "./useElementSize";

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

// Bars run down the column and channels across it, so the arrows swap round before they mean anything:
// from here on, "right" is the next bar and "down" the next channel, as the song's own numbers are.
const COLUMN_KEYS: Record<string, string> = {
  ArrowUp: "ArrowLeft",
  ArrowDown: "ArrowRight",
  ArrowLeft: "ArrowUp",
  ArrowRight: "ArrowDown",
};

const HEAD_HEIGHT_AT_FIRST = 58;

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
  /** More keys for the foot of the column. */
  footKeys?: ReactNode;
}

/**
 * The bars, as a column down the left of the grid: a row for each bar and a column for each channel, so the whole song
 * shows at once. At high zoom it moves under the grid, since there's no width to stand beside it.
 */
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
  footKeys,
}: BarRowProps) {
  const [selectEnd, setSelectEnd] = useState<number | null>(null);
  const [frame, , gridHeight] = useElementSize();
  const [cellSize, setCellSize] = useState(44);
  const [headHeight, setHeadHeight] = useState(HEAD_HEIGHT_AT_FIRST);
  const activeCell = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);
  const headRow = useRef<HTMLDivElement>(null);

  // The sizes come from theme tokens and the words in the headings, so ask the browser how big they really are.
  useLayoutEffect(() => {
    setCellSize(cellProbe.current?.getBoundingClientRect().width || 44);
    setHeadHeight(headRow.current?.getBoundingClientRect().height || HEAD_HEIGHT_AT_FIRST);
  }, [gridHeight]);

  useLayoutEffect(() => {
    if (moveFocus.current) activeCell.current?.focus();
    moveFocus.current = false;
  });

  const rowCount = Math.min(song.barCount, Math.max(1, Math.floor((gridHeight - headHeight) / cellSize)));
  const firstBar = columnWindowStart(pick.bar, rowCount);
  const lastBar = Math.min(song.barCount, firstBar + rowCount) - 1;
  const bars = Array.from({ length: lastBar - firstBar + 1 }, (_, index) => firstBar + index);
  const selectFrom = Math.min(pick.bar, selectEnd ?? pick.bar);
  const selectTo = Math.max(pick.bar, selectEnd ?? pick.bar);
  const loopEnd = song.loopStart + song.loopLength - 1;
  const channel = song.channels[pick.channel];
  const pattern = channel?.bars[pick.bar] ?? 0;
  const sharedBars = channel ? barsUsingPattern(channel, pattern) : 0;

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
    let next = song;
    for (let bar = song.loopStart; bar <= loopEnd; bar += 1) next = setBarPattern(next, pick.channel, bar, pattern);
    onChange(next);
    onAnnounce(`${channelName(song, pick.channel)}: ${pattern === 0 ? "silent" : `pattern ${pattern}`} on the whole loop.`);
  }

  function pageBars(direction: 1 | -1) {
    const bar = Math.max(0, Math.min(song.barCount - 1, firstBar + direction * rowCount));
    setSelectEnd(null);
    onPick({ channel: pick.channel, bar });
  }

  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.metaKey) return;
    const key = COLUMN_KEYS[event.key] ?? event.key;
    if (event.shiftKey && (key === "ArrowRight" || key === "ArrowLeft")) {
      event.preventDefault();
      const direction = key === "ArrowRight" ? 1 : -1;
      const end = Math.max(0, Math.min(song.barCount - 1, (selectEnd ?? pick.bar) + direction));
      setSelectEnd(end);
      onAnnounce(`Bars ${Math.min(pick.bar, end) + 1} to ${Math.max(pick.bar, end) + 1} picked. L loops them.`);
      return;
    }
    if ((key === "l" || key === "L") && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      applyLoop();
      return;
    }
    if ((key === "f" || key === "F") && !event.ctrlKey && !event.shiftKey) {
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
      setPattern(pattern + 1);
      return;
    }
    if (key === "-") {
      event.preventDefault();
      setPattern(pattern - 1);
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

  const gridStyle = {
    "--cell": "var(--target-min)",
    "--head-h": `${headHeight}px`,
    // Four bars at the least: a whole short song, even at high zoom. Past that it pages.
    minHeight: "calc(var(--head-h) + var(--cell) * 4 + var(--cell-line))",
  } as CSSProperties;
  const barBox = { height: "var(--cell)" };
  const channelCell = "flex min-w-14 flex-1 basis-0 items-center justify-center md:min-w-20";
  const barNameCell = "flex w-12 flex-none items-center justify-center whitespace-nowrap md:w-14";

  return (
    <section
      aria-label="Bars"
      className="flex w-full flex-none flex-col gap-1 border-bb-white p-1 max-md:order-last max-md:border-t-(length:--frame-width) md:w-98 md:border-r-(length:--frame-width)"
    >
      <h2 className="sr-only">
        Bars. Loop: {song.loopStart + 1} to {loopEnd + 1}
      </h2>
      {/* Before the bars in reading order, so Shift+Tab from the notes lands straight on the bars. */}
      <div className="order-last flex flex-none flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-display font-bold uppercase md:whitespace-nowrap">
            Bars {firstBar + 1}-{lastBar + 1} of {song.barCount}
          </span>
          <div role="group" aria-label="Move through the bars" className="flex gap-1">
            <button type="button" aria-label="Earlier bars" title="Earlier bars" onClick={() => pageBars(-1)} className={stripKey()}>
              Up
            </button>
            <button type="button" aria-label="Later bars" title="Later bars" onClick={() => pageBars(1)} className={stripKey()}>
              Down
            </button>
          </div>
        </div>
        <div role="group" aria-label="This bar" className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label="Previous pattern" title="Previous pattern (-, in the bars)" onClick={() => setPattern(pattern - 1)} className={stripKey()}>
            -
          </button>
          <button type="button" aria-label="Next pattern" title="Next pattern (+, in the bars)" onClick={() => setPattern(pattern + 1)} className={stripKey()}>
            +
          </button>
          <button type="button" title="This bar's pattern on the whole loop (F, in the bars)" onClick={fillLoop} className={stripKey()}>
            Fill
          </button>
          <button
            type="button"
            title={`The loop is bars ${song.loopStart + 1} to ${loopEnd + 1}. Shift+click picks bars, this makes them the loop (L, in the bars)`}
            onClick={applyLoop}
            className={stripKey()}
          >
            Set loop
          </button>
        </div>
        {footKeys}
      </div>

      <p className="flex-none text-display font-bold text-bb-daffodil uppercase md:whitespace-nowrap">
        Bar {pick.bar + 1}: {pattern === 0 ? "silent" : `pattern ${pattern}`}
        {sharedBars > 1 ? ` on ${sharedBars} bars` : ""}
      </p>

      <div ref={frame} className="min-h-0 w-full flex-1 overflow-x-auto overflow-y-hidden" style={gridStyle}>
        <div ref={cellProbe} aria-hidden="true" style={{ width: "var(--cell)", height: 0 }} />
        <div
          role="grid"
          aria-label="Bars for each channel. Numbers are patterns."
          aria-rowcount={song.barCount + 1}
          aria-colcount={song.channels.length + 1}
          onKeyDown={keyDown}
          className="relative w-full min-w-fit select-none text-bb-cell-m md:text-display"
        >
          <div ref={headRow} role="row" aria-rowindex={1} className="flex">
            <div role="columnheader" aria-colindex={1} className={`${barNameCell} font-bold uppercase`}>
              Bar
            </div>
            {song.channels.map((_, index) => (
              <div key={index} role="columnheader" aria-colindex={index + 2} className={`${channelCell} min-h-bb-target-min`}>
                {/* The mouse's way to a channel. The keyboard's is the arrows, so this isn't one more Tab stop per channel. */}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-pressed={pick.channel === index}
                  title={`Pick ${channelName(song, index)}`}
                  onClick={() => goTo({ channel: index, bar: pick.bar })}
                  className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-0.5 font-bold uppercase active:translate-y-(--press-drop) active:bg-bb-pink active:text-bb-black ${pick.channel === index ? "bg-bb-daffodil text-bb-black" : "text-bb-daffodil hover:bg-bb-daffodil hover:text-bb-nigrosine"}`}
                >
                  <span className="flex items-center gap-1">
                    <PixelSlot
                      name={`channel-icon-${index + 1}`}
                      size="icon"
                      src={art.channelIcons?.[index]}
                      showEmpty={showArtSlots}
                    />
                    <span
                      aria-hidden="true"
                      className={`block flex-none ${pick.channel === index ? "bg-bb-black" : "bg-bb-pink"}`}
                      style={{ width: "var(--target-swatch)", height: "var(--target-swatch)", ...noteShapeStyle(song, index, true, true) }}
                    />
                  </span>
                  <span className="text-center md:whitespace-nowrap">{channelName(song, index)}</span>
                </button>
              </div>
            ))}
          </div>

          {bars.map((bar, position) => {
            const inLoop = bar >= song.loopStart && bar <= loopEnd;
            return (
              <div key={bar} role="row" aria-rowindex={position + 2} className="flex">
                <div
                  role="rowheader"
                  aria-colindex={1}
                  aria-label={`Bar ${bar + 1}${inLoop ? ", in the loop" : ""}`}
                  className={`${barNameCell} font-bold ${inLoop ? "bg-bb-emerald text-bb-black" : ""}`}
                  style={barBox}
                >
                  {bar === song.loopStart ? "[" : ""}
                  {bar + 1}
                  {bar === loopEnd ? "]" : ""}
                </div>
                {song.channels.map((row, channelIndex) => {
                  const number = row.bars[bar] ?? 0;
                  const active = pick.channel === channelIndex && pick.bar === bar;
                  const inSelection = pick.channel === channelIndex && bar >= selectFrom && bar <= selectTo;
                  return (
                    <div
                      key={channelIndex}
                      ref={active ? activeCell : undefined}
                      role="gridcell"
                      aria-colindex={channelIndex + 2}
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
                      className={`bb-bar-cell ${channelCell} cursor-pointer font-bold focus:outline-none active:bg-bb-pink active:text-bb-black ${number === 0 ? "bg-bb-black" : "bg-bb-royal-blue"} ${inSelection ? "underline decoration-(length:--beat-line)" : ""} ${active ? "relative z-10 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`}
                      style={barBox}
                    >
                      {number === 0 ? "-" : number}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <Playhead
            transport={transport}
            columnOf={(spot) => {
              const row = spot.bar - firstBar;
              return row >= 0 && row < bars.length ? row : null;
            }}
            across
          />
        </div>
      </div>
    </section>
  );
}
