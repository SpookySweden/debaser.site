'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { WINDOW_TITLE_BAR } from '../lib/ui/controls';
import { clampFloat, defaultFloat, FLOAT_ROOM_SIZE, type FloatRect } from '../lib/ui/float-geometry';
import { FLOAT_GRIPS, footFloor, screenNow, useFloatFrame } from '../lib/ui/use-float-frame';

/**
 * A folded stream room's picture, floating (SPEC-floating-player.md). The room's player stays where it is in the page:
 * its box only changes to `position: fixed`, so an embedded site's player never reloads and the room's sync never
 * notices. This draws the box's title line and grips, and writes where the box goes. The room's own keys stay on the
 * music bar. It starts bottom-left, so it does not sit on the MEDIA float in the other corner.
 *
 * It floats only by `[ PIP ]`. It has no keys of its own (Luke, 2026-11-16: BACK, FULL and GO LIVE came off it): the way
 * back to the room's window is the room's key on the corner shelf above the player (`FoldedRoomKey`, ./WatchWindow.tsx),
 * or `[ PIP ]` on the bar again; a double press on the picture is still fullscreen.
 */

/** Where the reader last left it, for this visit. */
let placed: FloatRect | null = null;

function rectNow(): FloatRect {
  const screen = screenNow();
  const floor = footFloor();
  return placed === null ? { ...defaultFloat(FLOAT_ROOM_SIZE, screen, floor), x: 8 } : clampFloat(placed, screen, floor);
}

/**
 * The floating picture's drag, for the room that owns the box: its `picture` handlers go on the box itself, so the
 * picture is a handle too, and the rest is handed back to `RoomFloatChrome` for the title line and the grips.
 */
export function useRoomFloatDrag(host: RefObject<HTMLDivElement | null>) {
  return useFloatFrame(
    () => host.current,
    rectNow,
    (rect) => {
      placed = rect;
    },
  );
}

export default function RoomFloatChrome({
  host,
  drag,
  title,
}: {
  host: RefObject<HTMLDivElement | null>;
  drag: ReturnType<typeof useRoomFloatDrag>;
  title: string;
}) {
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    let raf = 0;
    const tick = () => {
      const rect = rectNow();
      element.style.left = `${rect.x}px`;
      element.style.top = `${rect.y}px`;
      element.style.width = `${rect.w}px`;
      element.style.height = `${rect.h}px`;
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => {
      window.cancelAnimationFrame(raf);
      for (const side of ['left', 'top', 'width', 'height']) element.style.removeProperty(side);
    };
  }, [host]);

  return (
    <>
      <div {...drag.bar} className={`${WINDOW_TITLE_BAR} absolute inset-x-0 top-0 z-40 cursor-move touch-none select-none bg-sun-pale [:fullscreen:not(:root)_&]:hidden`} title="Drag by this line or by the picture. Pull an edge to resize. Double press for fullscreen." data-room-float>
        <span className="truncate">{title}</span>
      </div>
      {FLOAT_GRIPS.map((grip) => (
        <div key={grip.className} aria-hidden="true" className={`absolute z-40 touch-none [:fullscreen:not(:root)_&]:hidden ${grip.className}`} {...drag.grip(grip.edges)} data-float-grip />
      ))}
    </>
  );
}
