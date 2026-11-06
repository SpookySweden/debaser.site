'use client';

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { SongData } from "../engine/songData";
import type { Transport } from "./app";
import { channelName, noteShapeStyle } from "./channelLooks";
import { moveCursor, scrollToShow, type GridMove } from "./gridView";
import { GLYPHS } from "./keyHelp";
import { glyphKey } from "./looks";
import { LoopBar } from "./LoopBar";
import type { LoopSpan } from "./loopEdit";
import { startPan } from "./panning";
import { PixelSlot, type BeatBoxArt } from "./PixelSlot";
import { Playhead } from "./Playhead";
import { ScrollRail } from "./ScrollRail";
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
const BARS_PER_ARROW = 2;
const CHANNEL_CELL = "flex min-w-bb-target-min flex-1 basis-0 items-center justify-center";

/** A channel's name cut to what fits over its column: its number, or a D for the drums. */
function shortName(song: SongData, index: number): string {
  return channelName(song, index).replace(/^Tune /, "").replace(/^Drums ?/, "D");
}

/** One bar's row. It only redraws when something on it changes, so picking a bar costs two rows, not the whole song. */
const BarLine = memo(function BarLine({
  bar,
  inLoop,
  loopFirst,
  loopLast,
  looping,
  numbers,
  names,
  activeChannel,
  selectedChannel,
  sharedChannel,
  several,
  namesStick,
}: {
  bar: number;
  inLoop: boolean;
  loopFirst: boolean;
  loopLast: boolean;
  looping: boolean;
  /** Each channel's pattern on this bar. */
  numbers: string;
  /** The channels' names, joined. */
  names: string;
  /** Which channel's cell has the cursor here, or -1. */
  activeChannel: number;
  /** Which channel's cell is among the picked bars, or -1. */
  selectedChannel: number;
  /** Which channel's cell plays the same pattern as the picked bar, so changing one changes the other. Or -1. */
  sharedChannel: number;
  /** More than one bar is picked, so the picked ones are marked. */
  several: boolean;
  /** The view scrolls sideways, so the bar numbers stay put while it does. */
  namesStick: boolean;
}) {
  const channelNames = names.split("|");
  return (
    <div role="row" aria-rowindex={bar + 2} data-bar={bar} className="bb-row flex">
      <div
        role="rowheader"
        aria-colindex={1}
        aria-label={`Bar ${bar + 1}${inLoop ? ", in the loop" : ""}`}
        className={`${namesStick ? "sticky left-0 z-10" : ""} flex flex-none items-center justify-center font-bold whitespace-nowrap ${inLoop ? (looping ? "bb-loop-on" : "bb-loop-off bg-bb-nigrosine") : "bg-bb-nigrosine"} ${loopFirst ? "bb-loop-first" : ""} ${loopLast ? "bb-loop-last" : ""}`}
        style={{ width: "var(--cell)", height: "var(--cell)" }}
      >
        {bar + 1}
      </div>
      {numbers.split(",").map((text, channelIndex) => {
        const number = Number(text);
        const active = channelIndex === activeChannel;
        return (
          <div
            key={channelIndex}
            role="gridcell"
            data-channel={channelIndex}
            aria-colindex={channelIndex + 2}
            aria-selected={channelIndex === selectedChannel}
            aria-label={`${channelNames[channelIndex]}, bar ${bar + 1}, ${number === 0 ? "silent" : `pattern ${number}`}`}
            tabIndex={active ? 0 : -1}
            className={`bb-bar-cell ${CHANNEL_CELL} cursor-pointer font-bold focus:outline-none active:bg-bb-pink active:text-bb-black ${number === 0 ? "bg-bb-black" : "bg-bb-royal-blue"} ${channelIndex === sharedChannel ? "text-bb-daffodil" : ""} ${several && channelIndex === selectedChannel ? "underline decoration-(length:--beat-line)" : ""} ${active ? "relative z-5 outline-(length:--border-width) outline-bb-white focus:outline-(length:--focus-width) focus:outline-bb-daffodil" : ""}`}
            style={{ height: "var(--cell)" }}
          >
            {number === 0 ? "-" : number}
          </div>
        );
      })}
    </div>
  );
});

export interface BarRowProps {
  song: SongData;
  pick: BarPick;
  transport: Transport;
  /** Is the Loop key on? With it off the bar's only outlined: the song plays through. */
  looping: boolean;
  hand: boolean;
  onPick: (pick: BarPick) => void;
  /** `partOfLast` means this belongs to the same undo step as the change before it. */
  onChange: (song: SongData, partOfLast?: boolean) => void;
  /** The loop's been set on the loop bar. */
  onLoopSet: () => void;
  onAnnounce: (message: string) => void;
  onOpenGrid: () => void;
  art: BeatBoxArt;
  showArtSlots: boolean;
  /** More keys for the foot of the column. */
  footKeys?: ReactNode;
}

/**
 * The bars, as a column down the left of the grid: a row for each bar and a column for each channel, with the whole song there to scroll or
 * drag through. At high zoom it moves under the grid, since there's no width to stand beside it.
 */
export function BarRow({
  song,
  pick,
  transport,
  looping,
  hand,
  onPick,
  onChange,
  onLoopSet,
  onAnnounce,
  onOpenGrid,
  art,
  showArtSlots,
  footKeys,
}: BarRowProps) {
  const [selectEnd, setSelectEnd] = useState<number | null>(null);
  const [frame, viewWidth, viewHeight] = useElementSize();
  const [cellSize, setCellSize] = useState(44);
  const [headHeight, setHeadHeight] = useState(HEAD_HEIGHT_AT_FIRST);
  const moveFocus = useRef(false);
  const cellProbe = useRef<HTMLDivElement>(null);
  const headRow = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  // The heading's height comes from its art slots and words, which a text zoom or a late font can change with nothing else moving.
  useLayoutEffect(() => {
    const row = headRow.current;
    if (!row) return;
    const observer = new ResizeObserver(() => setHeadHeight(row.getBoundingClientRect().height || HEAD_HEIGHT_AT_FIRST));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // The sizes come from theme tokens and the words in the headings, so ask the browser how big they really are.
  useLayoutEffect(() => {
    setCellSize(cellProbe.current?.getBoundingClientRect().width || 44);
    setHeadHeight(headRow.current?.getBoundingClientRect().height || HEAD_HEIGHT_AT_FIRST);
  }, [viewHeight]);

  // The picked bar is always in view, whichever way it was picked.
  useLayoutEffect(() => {
    const view = frame.current;
    if (!view || viewHeight === 0) return;
    const channelWidth = (view.scrollWidth - cellSize) / Math.max(1, song.channels.length);
    view.scrollTo({
      top: scrollToShow(view.scrollTop, cellSize, viewHeight - headHeight, pick.bar),
      left: scrollToShow(view.scrollLeft, channelWidth, viewWidth - cellSize, pick.channel),
      behavior: "instant",
    });
  }, [frame, pick.bar, pick.channel, cellSize, headHeight, viewHeight, viewWidth, song.channels.length]);

  useLayoutEffect(() => {
    if (moveFocus.current) frame.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus({ preventScroll: true });
    moveFocus.current = false;
  });

  const selectFrom = Math.min(pick.bar, selectEnd ?? pick.bar);
  const selectTo = Math.max(pick.bar, selectEnd ?? pick.bar);
  const loopEnd = song.loopStart + song.loopLength - 1;
  const channel = song.channels[pick.channel];
  const pattern = channel?.bars[pick.bar] ?? 0;
  const sharedBars = channel ? barsUsingPattern(channel, pattern) : 0;
  const names = useMemo(() => song.channels.map((_, index) => channelName(song, index)).join("|"), [song]);
  const bars = Array.from({ length: song.barCount }, (_, bar) => bar);
  // A browser gives every sticky thing a layer of its own to look after, so only when there's a sideways scroll for it to stick against.
  const namesStick = cellSize * (song.channels.length + 1) > viewWidth;

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
    onLoopSet();
    onAnnounce(`Loop: bars ${next.loopStart + 1} to ${next.loopStart + next.loopLength}.`);
  }

  /** The pattern of this bar, on every bar of the loop. */
  function fillLoop() {
    let next = song;
    for (let bar = song.loopStart; bar <= loopEnd; bar += 1) next = setBarPattern(next, pick.channel, bar, pattern);
    onChange(next);
    onAnnounce(`${channelName(song, pick.channel)}: ${pattern === 0 ? "silent" : `pattern ${pattern}`} on the whole loop.`);
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

  function cellAt(target: EventTarget): { channel: number; bar: number } | null {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[role="gridcell"]') : null;
    const channelIndex = Number(cell?.dataset.channel);
    const bar = Number(cell?.parentElement?.dataset.bar);
    return !cell || Number.isNaN(channelIndex) || Number.isNaN(bar) ? null : { channel: channelIndex, bar };
  }

  function pressed(event: PointerEvent<HTMLDivElement>) {
    const view = frame.current;
    if (!view || !event.isPrimary) return;
    const place = event.target instanceof Element ? event.target : null;
    if (place?.closest("[data-loop-hit]") && event.button === 0 && !hand) return;
    if (event.button === 1 || event.button === 2 || hand) {
      if (event.button === 1) event.preventDefault();
      startPan(event, view);
      return;
    }
    if (event.button !== 0) return;
    // The channel's own key at the head of the column picks it, as the button goes down.
    const head = place?.closest<HTMLElement>("[data-pick-channel]");
    if (head) {
      goTo({ channel: Number(head.dataset.pickChannel), bar: pick.bar });
      return;
    }
    const cell = cellAt(event.target);
    if (!cell) return;
    if (event.shiftKey && pick.channel === cell.channel) {
      setSelectEnd(cell.bar);
      return;
    }
    goTo(cell);
    // Dragging down the channel picks several bars, for L.
    view.setPointerCapture(event.pointerId);
    dragging.current = event.pointerId;
  }

  function dragged(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId) return;
    const view = frame.current;
    if (!view) return;
    const box = view.getBoundingClientRect();
    const bar = Math.max(0, Math.min(song.barCount - 1, Math.floor((event.clientY - box.top + view.scrollTop - headHeight) / cellSize)));
    if (bar !== (selectEnd ?? pick.bar)) {
      setSelectEnd(bar);
      onAnnounce(`Bars ${Math.min(pick.bar, bar) + 1} to ${Math.max(pick.bar, bar) + 1} picked. L loops them.`);
    }
  }

  function letGo(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) dragging.current = null;
  }

  // A screen reader's press arrives as a click with no pointer before it.
  function clicked(event: MouseEvent<HTMLDivElement>) {
    if (event.detail !== 0) return;
    const head = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pick-channel]") : null;
    if (head) {
      goTo({ channel: Number(head.dataset.pickChannel), bar: pick.bar });
      return;
    }
    const cell = cellAt(event.target);
    if (cell) goTo(cell);
  }

  function loopChanged(loop: LoopSpan, partOfLast: boolean) {
    onChange(setLoop(song, loop.start, loop.start + loop.length - 1), partOfLast);
  }

  function loopSet(loop: LoopSpan) {
    onLoopSet();
    onAnnounce(`Loop: bars ${loop.start + 1} to ${loop.start + loop.length}.`);
  }

  const frameStyle = {
    "--cell": "var(--target-min)",
    "--head-h": `${headHeight}px`,
    // Four bars at the least: a whole short song, even at high zoom. Past that it scrolls.
    minHeight: "calc(var(--head-h) + var(--cell) * 4 + var(--cell-line))",
  } as CSSProperties;

  return (
    <section
      aria-label="Bars"
      className="flex w-full flex-none flex-col gap-1 border-bb-white p-1 max-md:order-last max-md:border-t-(length:--frame-width) md:w-72 md:border-r-(length:--frame-width)"
    >
      <h2 className="sr-only">
        Bars. Loop: {song.loopStart + 1} to {loopEnd + 1}. Bar {pick.bar + 1}: {pattern === 0 ? "silent" : `pattern ${pattern}`}
        {sharedBars > 1 ? ` on ${sharedBars} bars` : ""}
      </h2>
      {/* Before the bars in reading order, so Shift+Tab from the notes lands straight on the bars. */}
      <div className="order-last flex flex-none flex-col gap-1">
        <div role="group" aria-label="This bar's pattern" className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label="Previous pattern" title="Previous pattern (-, in the bars)" onClick={() => setPattern(pattern - 1)} className={glyphKey()}>
            -
          </button>
          <button type="button" aria-label="Next pattern" title="Next pattern (+, in the bars)" onClick={() => setPattern(pattern + 1)} className={glyphKey()}>
            +
          </button>
          <button type="button" aria-label="Fill" title="This bar's pattern on the whole loop (F, in the bars)" onClick={fillLoop} className={glyphKey()}>
            {GLYPHS.fill}
          </button>
          {footKeys}
          <ScrollRail
            view={frame}
            axis="across"
            step={cellSize}
            backGlyph={GLYPHS.left}
            forwardGlyph={GLYPHS.right}
            backName="Earlier channels"
            forwardName="Later channels"
            collapse
          />
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1">
        {/* Before the bars in reading order too, so Shift+Tab from the notes still lands on the bars. It shows after them. */}
        <ScrollRail
          view={frame}
          axis="up-down"
          step={cellSize * BARS_PER_ARROW}
          backGlyph={GLYPHS.up}
          forwardGlyph={GLYPHS.down}
          backName="Earlier bars"
          forwardName="Later bars"
          className="order-last"
        />
        <div
          ref={frame}
          onPointerDown={pressed}
          onPointerMove={dragged}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onClick={clicked}
          className={`bb-canvas min-h-0 min-w-0 flex-1 overflow-auto ${hand ? "bb-hand" : ""}`}
          style={frameStyle}
        >
          <div className="relative w-full min-w-fit">
            <div ref={cellProbe} aria-hidden="true" className="absolute" style={{ width: "var(--cell)", height: 0 }} />
            <LoopBar song={song} hand={hand} onChange={loopChanged} onDone={loopSet} />
            <div
              role="grid"
              aria-label="Bars for each channel. Numbers are patterns."
              aria-rowcount={song.barCount + 1}
              aria-colcount={song.channels.length + 1}
              onKeyDown={keyDown}
              className="relative w-full min-w-fit select-none text-display"
            >
              <div ref={headRow} role="row" aria-rowindex={1} className="sticky top-0 z-40 flex bg-bb-nigrosine">
                <div role="columnheader" aria-colindex={1} aria-label="Bar" className={`${namesStick ? "sticky left-0 z-10" : ""} flex-none bg-bb-nigrosine`} style={{ width: "var(--cell)" }} />
                {song.channels.map((_, index) => (
                  <div key={index} role="columnheader" aria-colindex={index + 2} className={`${CHANNEL_CELL} min-h-bb-target-min flex-col!`}>
                    <PixelSlot name={`channel-icon-${index + 1}`} size="icon" src={art.channelIcons?.[index]} showEmpty={showArtSlots} />
                    {/* The mouse's way to a channel. The keyboard's is the arrows, so this isn't one more Tab stop per channel. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      data-pick-channel={index}
                      aria-label={`Pick ${channelName(song, index)}`}
                      aria-pressed={pick.channel === index}
                      title={`Pick ${channelName(song, index)}`}
                      className={`flex min-h-bb-target-min w-full cursor-pointer items-center justify-center gap-0.5 font-bold uppercase active:translate-y-(--press-drop) active:bg-bb-pink active:text-bb-black ${pick.channel === index ? "bg-bb-daffodil text-bb-black" : "text-bb-daffodil hover:bg-bb-daffodil hover:text-bb-nigrosine"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`block flex-none ${pick.channel === index ? "bg-bb-black" : "bg-bb-pink"}`}
                        style={{ width: "var(--target-swatch)", height: "var(--target-swatch)", ...noteShapeStyle(song, index, true, true) }}
                      />
                      <span aria-hidden="true">{shortName(song, index)}</span>
                    </button>
                  </div>
                ))}
              </div>

              {bars.map((bar) => (
                <BarLine
                  key={bar}
                  bar={bar}
                  inLoop={bar >= song.loopStart && bar <= loopEnd}
                  loopFirst={bar === song.loopStart}
                  loopLast={bar === loopEnd}
                  looping={looping}
                  numbers={song.channels.map((row) => row.bars[bar] ?? 0).join(",")}
                  names={names}
                  activeChannel={pick.bar === bar ? pick.channel : -1}
                  selectedChannel={bar >= selectFrom && bar <= selectTo ? pick.channel : -1}
                  sharedChannel={pattern !== 0 && channel?.bars[bar] === pattern ? pick.channel : -1}
                  several={selectFrom !== selectTo}
                  namesStick={namesStick}
                />
              ))}
              <Playhead transport={transport} columnOf={(spot) => spot.bar} across />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
