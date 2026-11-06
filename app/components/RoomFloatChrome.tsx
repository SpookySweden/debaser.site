'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { PLATE, WINDOW_TITLE_BAR } from '../lib/ui/controls';
import { clampFloat, defaultFloat, FLOAT_ROOM_SIZE, type FloatRect } from '../lib/ui/float-geometry';
import { footFloor, screenNow, useFloatFrame } from '../lib/ui/use-float-frame';
import { GRIPS } from './DockWindow';

/**
 * A folded stream room's picture, floating (SPEC-floating-player.md). The room's player stays where it is in the page:
 * its box only changes to `position: fixed`, so an embedded site's player never reloads and the room's sync never
 * notices. This draws the box's title line and grips, and writes where the box goes. The room's own keys stay on the
 * music bar. It starts bottom-left, above the room's way back, so it does not sit on the MEDIA float in the other corner.
 */

/** Where the reader last left it, for this visit. */
let placed: FloatRect | null = null;

function rectNow(): FloatRect {
  const screen = screenNow();
  const floor = footFloor();
  return placed === null ? { ...defaultFloat(FLOAT_ROOM_SIZE, screen, floor), x: 8 } : clampFloat(placed, screen, floor);
}

export default function RoomFloatChrome({
  host,
  title,
  onBack,
  onHide,
}: {
  host: RefObject<HTMLDivElement | null>;
  title: string;
  onBack: () => void;
  onHide: () => void;
}) {
  const drag = useFloatFrame(
    () => host.current,
    rectNow,
    (rect) => {
      placed = rect;
    },
  );

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
      <div {...drag.bar} className={`${WINDOW_TITLE_BAR} absolute inset-x-0 top-0 z-40 cursor-move touch-none select-none bg-sun-pale [:fullscreen_&]:hidden`} title="Drag to move. Pull an edge to resize. Double press for fullscreen." data-room-float>
        <span className="truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onBack} aria-label="Back to the room" className={PLATE}>
            [ BACK ]
          </button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onHide} aria-label="Hide the picture. The room keeps playing." className={PLATE}>
            [ × ]
          </button>
        </span>
      </div>
      {GRIPS.map((grip) => (
        <div key={grip.className} aria-hidden="true" className={`absolute z-40 touch-none ${grip.className}`} {...drag.grip(grip.edges)} />
      ))}
    </>
  );
}
