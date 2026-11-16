'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampSide, keepRoomSideWidth, setRoomSideWidth, SIDE_MIN, useRoomSideWidth } from '../lib/watch/room-side-width';

/** How far an arrow key moves the edge. */
const STEP = 24;

/** The column and the room it shares with the picture, measured at the press. */
function measure(grip: HTMLElement): { side: number; room: number; gap: number } | null {
  const side = grip.parentElement;
  const columns = side?.parentElement;
  if (!side || !columns) return null;
  const gap = Number.parseFloat(window.getComputedStyle(columns).columnGap);
  return { side: side.getBoundingClientRect().width, room: columns.getBoundingClientRect().width, gap: Number.isFinite(gap) ? gap : 0 };
}

/**
 * The edge between a room's picture and its side column, dragged to make the chat wider or narrower (Luke, 2026-11-16:
 * "chat space resizable by click-dragging on the side of the video port"). It lies in the gap between the two, so it
 * covers neither, and draws a dotted line there that darkens under the pointer. Both room windows put it first in their
 * side column (`ROOM_SIDE`); the width is one for both, kept in this browser (`room-side-width.ts`). A double press puts it
 * back to the frame's own width; the arrow keys move it too. Desktop only: on a phone the column is under the picture.
 */
export default function RoomSideGrip() {
  const width = useRoomSideWidth();
  const drag = useRef<{ x: number; side: number; room: number; gap: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const at = measure(event.currentTarget);
    if (at === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, ...at };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (from === null) return;
    // The edge follows the pointer: moved left, the column on the right grows.
    setRoomSideWidth(clampSide(from.side - (event.clientX - from.x), from.room, from.gap), false);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    keepRoomSideWidth();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const at = measure(event.currentTarget);
    if (at === null) return;
    event.preventDefault();
    setRoomSideWidth(clampSide(at.side + (event.key === 'ArrowLeft' ? STEP : -STEP), at.room, at.gap));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Chat width: drag, or the arrow keys. Double press for the usual width."
      aria-valuemin={SIDE_MIN}
      aria-valuenow={width ?? undefined}
      title="DRAG TO MAKE THE CHAT WIDER OR NARROWER. DOUBLE PRESS FOR THE USUAL WIDTH."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => setRoomSideWidth(null)}
      onKeyDown={onKeyDown}
      className="group absolute -left-3 bottom-0 top-0 z-10 flex w-3 cursor-col-resize touch-none select-none justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink max-sm:hidden"
      data-room-side-grip={width ?? 'usual'}
    >
      <span aria-hidden="true" className="h-full border-l-line border-dotted border-ink-quiet group-hover:border-ink group-focus-visible:border-ink" />
    </div>
  );
}
