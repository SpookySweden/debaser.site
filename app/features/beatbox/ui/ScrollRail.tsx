'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { glyphKey } from "./looks";

const HOLD_BEFORE_REPEAT_MS = 300;
const REPEAT_MS = 80;

/**
 * Big arrows and a bar showing where the view is, for a view that has more than it can show. Moving the view redraws nothing here but
 * the bar's own position, so it keeps up with a drag.
 */
export function ScrollRail({
  view,
  axis,
  step,
  backGlyph,
  forwardGlyph,
  backName,
  forwardName,
  collapse = false,
  className = "",
}: {
  view: RefObject<HTMLElement | null>;
  axis: "up-down" | "across";
  /** How far one press of an arrow goes. */
  step: number;
  backGlyph: string;
  forwardGlyph: string;
  backName: string;
  forwardName: string;
  /** With nothing to scroll, take no room. Otherwise its room stays, and nothing moves when it appears. */
  collapse?: boolean;
  className?: string;
}) {
  const across = axis === "across";
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ needed: false, canBack: false, canForward: false });
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepNow = useRef(step);
  useEffect(() => {
    stepNow.current = step;
  }, [step]);

  useEffect(() => {
    const element = view.current;
    if (!element) return;
    function update() {
      const current = view.current;
      const bar = track.current;
      const mark = thumb.current;
      if (!current || !bar || !mark) return;
      const whole = across ? current.scrollWidth : current.scrollHeight;
      const shown = across ? current.clientWidth : current.clientHeight;
      const at = across ? current.scrollLeft : current.scrollTop;
      const room = across ? bar.clientWidth : bar.clientHeight;
      const length = whole > 0 ? Math.max(Math.min(room, 32), (shown / whole) * room) : room;
      const offset = whole > shown ? (at / (whole - shown)) * (room - length) : 0;
      mark.style[across ? "width" : "height"] = `${length}px`;
      mark.style.transform = across ? `translateX(${offset}px)` : `translateY(${offset}px)`;
      const next = { needed: whole > shown + 1, canBack: at > 0, canForward: at < whole - shown - 1 };
      setState((was) => (was.needed === next.needed && was.canBack === next.canBack && was.canForward === next.canForward ? was : next));
    }
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    if (track.current) observer.observe(track.current);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [view, across]);

  function stopHolding() {
    if (holding.current !== null) {
      clearTimeout(holding.current);
      clearInterval(holding.current);
    }
    holding.current = null;
  }
  useEffect(() => stopHolding, []);

  function go(direction: 1 | -1) {
    const by = direction * stepNow.current;
    view.current?.scrollBy({ left: across ? by : 0, top: across ? 0 : by, behavior: "instant" });
  }

  // It moves as the button goes down, and carries on for as long as the button's held.
  function holdArrow(event: PointerEvent, direction: 1 | -1) {
    if (event.button !== 0) return;
    go(direction);
    stopHolding();
    holding.current = setTimeout(() => {
      holding.current = setInterval(() => go(direction), REPEAT_MS);
    }, HOLD_BEFORE_REPEAT_MS);
  }

  function scrollToPointer(event: PointerEvent<HTMLDivElement>) {
    const current = view.current;
    const bar = track.current;
    const mark = thumb.current;
    if (!current || !bar || !mark) return;
    const box = bar.getBoundingClientRect();
    const length = across ? mark.offsetWidth : mark.offsetHeight;
    const room = (across ? box.width : box.height) - length;
    const along = (across ? event.clientX - box.left : event.clientY - box.top) - length / 2;
    const share = room > 0 ? Math.max(0, Math.min(1, along / room)) : 0;
    current.scrollTo({
      ...(across ? { left: share * (current.scrollWidth - current.clientWidth) } : { top: share * (current.scrollHeight - current.clientHeight) }),
      behavior: "instant",
    });
  }

  const hidden = !state.needed && (collapse ? "hidden" : "invisible");
  const arrow = (glyph: string, name: string, direction: 1 | -1, can: boolean) => (
    <button
      type="button"
      aria-label={name}
      aria-disabled={!can}
      title={name}
      onPointerDown={(event) => holdArrow(event, direction)}
      onPointerUp={stopHolding}
      onPointerLeave={stopHolding}
      onPointerCancel={stopHolding}
      // The mouse moves the view without taking the cursor off the notes, so the keys carry on from where they were.
      onMouseDown={(event) => event.preventDefault()}
      // A press from the keyboard or a screen reader arrives as a click with no pointer before it.
      onClick={(event) => {
        if (event.detail === 0) go(direction);
      }}
      className={`${glyphKey()} flex-none`}
    >
      {glyph}
    </button>
  );

  return (
    <div role="group" aria-label={across ? "Move the view across" : "Move the view up and down"} className={`flex flex-none ${across ? "min-w-0 flex-1 flex-row items-center" : "w-bb-target-min flex-col items-center"} ${hidden || ""} ${className}`}>
      {arrow(backGlyph, backName, -1, state.canBack)}
      <div
        ref={track}
        aria-hidden="true"
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrollToPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrollToPointer(event);
        }}
        className={`relative min-h-0 min-w-0 flex-1 cursor-pointer touch-none ${across ? "bb-rail-x h-bb-target-min" : "bb-rail-y w-bb-target-min"}`}
      >
        <div ref={thumb} className={`bb-rail-thumb absolute ${across ? "left-0" : "top-0"}`} />
      </div>
      {arrow(forwardGlyph, forwardName, 1, state.canForward)}
    </div>
  );
}
