'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SongData } from "../engine/songData";
import { dragLoop, loopGrabAt, nudgeLoopEnd, type LoopGrab, type LoopSpan } from "./loopEdit";

const PAGE_OF_BARS = 4;

const CELL_ROW = (bar: number) => `calc(var(--head-h) + var(--cell) * ${bar})`;
const CELLS = (bars: number) => `calc(var(--cell) * ${bars})`;

/**
 * The loop bar: what's playing and repeating, along the bar numbers, worked as BeepBox's own is (see loopEdit.ts). The purple is the number
 * cells' own, so this is what lies over them: where the mouse takes hold, what it's about to take hold of, and the two ends for the keyboard.
 */
export function LoopBar({
  song,
  hand,
  onChange,
  onDone,
}: {
  song: SongData;
  /** With the hand on, dragging moves the view and nothing else. */
  hand: boolean;
  /** `partOfLast` means this belongs to the same undo step as the change before it. */
  onChange: (loop: LoopSpan, partOfLast: boolean) => void;
  onDone: (loop: LoopSpan) => void;
}) {
  const loop: LoopSpan = { start: song.loopStart, length: song.loopLength };
  const hit = useRef<HTMLDivElement>(null);
  const hold = useRef<{ pointer: number; grab: LoopGrab; was: LoopSpan; fromBar: number; now: LoopSpan; sent: boolean } | null>(null);
  const [hover, setHover] = useState<LoopSpan | null>(null);

  function barAt(clientY: number): number {
    const box = hit.current?.getBoundingClientRect();
    return box && box.height > 0 ? ((clientY - box.top) / box.height) * song.barCount : 0;
  }

  /** What a press here would take hold of, to light up before it does: BeepBox's preview. */
  function previewAt(bar: number): LoopSpan {
    const grab = loopGrabAt(loop, bar);
    if (grab === "both") return dragLoop("both", loop, bar, bar, song.barCount);
    return { start: grab === "start" ? loop.start : loop.start + loop.length - 1, length: 1 };
  }

  function apply(next: LoopSpan) {
    const held = hold.current;
    if (!held || (next.start === held.now.start && next.length === held.now.length)) return;
    held.now = next;
    onChange(next, held.sent);
    held.sent = true;
  }

  function pressed(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || hand || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bar = barAt(event.clientY);
    hold.current = { pointer: event.pointerId, grab: loopGrabAt(loop, bar), was: loop, fromBar: bar, now: loop, sent: false };
    setHover(null);
    // A press outside the loop carries it there straight away. Inside, nothing moves until the pointer does.
    if (hold.current.grab === "both") apply(dragLoop("both", loop, bar, bar, song.barCount));
  }

  function moved(event: PointerEvent<HTMLDivElement>) {
    const bar = barAt(event.clientY);
    const held = hold.current;
    if (!held || held.pointer !== event.pointerId) {
      if (event.pointerType === "mouse" && !hand) setHover(previewAt(bar));
      return;
    }
    apply(dragLoop(held.grab, held.was, held.fromBar, bar, song.barCount));
  }

  function letGo(event: PointerEvent<HTMLDivElement>) {
    const held = hold.current;
    if (!held || held.pointer !== event.pointerId) return;
    hold.current = null;
    if (held.sent) onDone(held.now);
  }

  function endKeyDown(event: KeyboardEvent, which: "start" | "end") {
    const at = which === "start" ? loop.start : loop.start + loop.length - 1;
    const to = {
      ArrowUp: at - 1,
      ArrowLeft: at - 1,
      ArrowDown: at + 1,
      ArrowRight: at + 1,
      PageUp: at - PAGE_OF_BARS,
      PageDown: at + PAGE_OF_BARS,
      Home: which === "start" ? 0 : loop.start,
      End: which === "start" ? loop.start + loop.length - 1 : song.barCount - 1,
    }[event.key];
    if (to === undefined || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const next = nudgeLoopEnd(which, loop, to, song.barCount);
    if (next.start === loop.start && next.length === loop.length) return;
    onChange(next, false);
    onDone(next);
  }

  const lastBar = loop.start + loop.length - 1;
  const end = (which: "start" | "end", bar: number, name: string, low: number, high: number) => (
    <div
      role="slider"
      tabIndex={0}
      data-loop-end={which}
      aria-label={name}
      aria-orientation="vertical"
      aria-valuemin={low + 1}
      aria-valuemax={high + 1}
      aria-valuenow={bar + 1}
      aria-valuetext={`Bar ${bar + 1}`}
      onKeyDown={(event) => endKeyDown(event, which)}
      className="pointer-events-none absolute left-0 focus:outline-(length:--focus-width) focus:outline-bb-daffodil"
      style={{ top: CELL_ROW(bar), width: "var(--cell)", height: "var(--cell)" }}
    />
  );

  return (
    // Holds still when the bars scroll sideways, as the numbers do, and takes no room of its own.
    <div className="sticky left-0 z-30 h-0 w-0">
      <div
        ref={hit}
        data-loop-hit=""
        title="The loop: drag its ends, or press elsewhere to move it"
        onPointerDown={pressed}
        onPointerMove={moved}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={() => setHover(null)}
        className="absolute left-0 cursor-ns-resize touch-none"
        style={{ top: "var(--head-h)", width: "var(--cell)", height: CELLS(song.barCount) }}
      />
      {hover && (
        <div
          aria-hidden="true"
          data-loop-preview=""
          className="pointer-events-none absolute left-0 outline-(length:--border-width) -outline-offset-(length:--border-width) outline-bb-white"
          style={{ top: CELL_ROW(hover.start), width: "var(--cell)", height: CELLS(hover.length) }}
        />
      )}
      {end("start", loop.start, "Loop starts at", 0, lastBar)}
      {end("end", lastBar, "Loop ends at", loop.start, song.barCount - 1)}
    </div>
  );
}
