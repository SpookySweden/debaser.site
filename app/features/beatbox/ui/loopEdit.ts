// Dragging the loop, as BeepBox's own loop bar does it (its editor/LoopEditor.ts, MIT: see CREDITS.md). A press inside the loop, or
// within a quarter of a bar of it, takes hold of whichever end is nearer. A press outside it carries the whole loop there, centred on
// the pointer, keeping its length. An end dragged past the other swaps with it, and a loop is one bar long at the least.

export type LoopGrab = "start" | "end" | "both";

export interface LoopSpan {
  readonly start: number;
  readonly length: number;
}

const NEAR_THE_LOOP = 0.25;

/** What a press at this place takes hold of. `bar` counts in bars from the top, with a fraction for how far into the bar. */
export function loopGrabAt(loop: LoopSpan, bar: number): LoopGrab {
  if (bar > loop.start - NEAR_THE_LOOP && bar < loop.start + loop.length + NEAR_THE_LOOP) {
    return bar - loop.start < loop.length * 0.5 ? "start" : "end";
  }
  return "both";
}

/** The whole loop carried to a place, centred on it and kept inside the song. */
function loopCentredOn(loop: LoopSpan, bar: number, barCount: number): LoopSpan {
  let start = Math.round(bar - loop.length / 2);
  let end = start + loop.length;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > barCount) {
    start -= end - barCount;
    end = barCount;
  }
  return { start, length: end - start };
}

/** Where the loop is now, for a drag that took hold of `grab` at `fromBar` on the loop as it was and has reached `bar`. */
export function dragLoop(grab: LoopGrab, was: LoopSpan, fromBar: number, bar: number, barCount: number): LoopSpan {
  if (grab === "both") return loopCentredOn(was, bar, barCount);
  const wasEnd = was.start + was.length;
  const moved = Math.round(bar - fromBar);
  let start = was.start;
  let end = wasEnd;
  if (grab === "start") {
    start = Math.max(0, Math.min(barCount, was.start + moved));
    if (start === end) start = end - 1;
  } else {
    end = Math.max(0, Math.min(barCount, wasEnd + moved));
    if (end === start) end = start + 1;
  }
  return { start: Math.min(start, end), length: Math.abs(end - start) };
}

/** One end of the loop moved by the keyboard. It stops at the other end rather than swapping with it, since the cursor stays on this end. */
export function nudgeLoopEnd(which: "start" | "end", loop: LoopSpan, to: number, barCount: number): LoopSpan {
  const end = loop.start + loop.length - 1;
  if (which === "start") {
    const start = Math.max(0, Math.min(end, to));
    return { start, length: end - start + 1 };
  }
  const last = Math.max(loop.start, Math.min(barCount - 1, to));
  return { start: loop.start, length: last - loop.start + 1 };
}
