'use client';

import { useRef } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { floorFrom, resizedFloat, type FloatEdges, type FloatRect } from './float-geometry';

/** What the strips along the foot reach up to right now (`use-edge-reserve.ts`), read from `<html>`'s own style. */
export function footFloor(): number {
  const style = document.documentElement.style;
  return floorFrom(['--music-top', '--bottom-bar', '--start-bar', '--stream-box'].map((name) => style.getPropertyValue(name)));
}

export function screenNow() {
  return { w: document.documentElement.clientWidth, h: window.innerHeight };
}

/**
 * A floating picture's eight grips (SPEC-rooms-your-room.md, part 2): the windows' own (`DockWindow.tsx`'s `GRIPS`),
 * bigger. A picture has only a thin frame to aim at, so each corner is a 20px square and each edge a 12px strip,
 * where a window's are 12px and 8px. They reach no further in than a title line's own padding, so no key is covered.
 */
export const FLOAT_GRIPS: { edges: FloatEdges; className: string }[] = [
  { edges: { top: true }, className: '-top-1.5 left-3 right-3 h-3 cursor-ns-resize' },
  { edges: { bottom: true }, className: '-bottom-1.5 left-3 right-3 h-3 cursor-ns-resize' },
  { edges: { left: true }, className: '-left-1.5 top-3 bottom-3 w-3 cursor-ew-resize' },
  { edges: { right: true }, className: '-right-1.5 top-3 bottom-3 w-3 cursor-ew-resize' },
  { edges: { top: true, left: true }, className: '-top-2 -left-2 h-5 w-5 cursor-nwse-resize' },
  { edges: { bottom: true, right: true }, className: '-bottom-2 -right-2 h-5 w-5 cursor-nwse-resize' },
  { edges: { top: true, right: true }, className: '-top-2 -right-2 h-5 w-5 cursor-nesw-resize' },
  { edges: { bottom: true, left: true }, className: '-bottom-2 -left-2 h-5 w-5 cursor-nesw-resize' },
];

/** How far a press on the picture travels before it is a drag: under this it is still a press (a double press is FULL). */
export const PICTURE_DRAG_AFTER = 6;

/** What on a picture keeps its own presses: a key, a field, a toolbar, and the room's canvas while it is being drawn on. */
const PICTURE_STILL = 'button, a, input, select, textarea, [role="toolbar"], [data-room-canvas="shown"]';

/**
 * Pointer handling for a floating picture's title line and resize grips, like the site's windows (`DockWindow.tsx`),
 * and for the picture itself as a handle.
 *
 * `read` is the rect drawn now and `write` keeps a new one. An iframe swallows the pointer, so while a drag is on the
 * frames inside `host` ignore it; the press itself is captured by the handle, as the windows' are.
 */
export function useFloatFrame(host: () => HTMLElement | null, read: () => FloatRect, write: (rect: FloatRect) => void) {
  const start = useRef<{ x: number; y: number; rect: FloatRect } | null>(null);
  /** A press on the picture that has not travelled far enough to be a drag yet. */
  const press = useRef<{ x: number; y: number; rect: FloatRect } | null>(null);

  const quiet = (on: boolean) => {
    for (const frame of host()?.querySelectorAll('iframe') ?? []) frame.style.pointerEvents = on ? 'none' : '';
  };
  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY, rect: read() };
    quiet(true);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    quiet(false);
  };

  return {
    bar: {
      onPointerDown: begin,
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const from = start.current;
        if (from === null) return;
        write({ ...from.rect, x: from.rect.x + event.clientX - from.x, y: from.rect.y + event.clientY - from.y });
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
    grip: (edges: FloatEdges) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation();
        begin(event);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const from = start.current;
        if (from === null) return;
        write(resizedFloat(from.rect, edges, event.clientX - from.x, event.clientY - from.y));
      },
      onPointerUp: end,
      onPointerCancel: end,
    }),
    /**
     * The picture as a handle, on the box that holds it (SPEC-rooms-your-room.md, part 2: "drags by the picture, not
     * only by its thin title line"). A press there may be meant for the picture, so nothing is captured until the
     * pointer has travelled (`PICTURE_DRAG_AFTER`); keys and fields on the picture keep their presses. Only a press
     * that reaches the page can start it: a platform's own player in a frame keeps its presses, and its own controls.
     */
    picture: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // The title line or a grip, which sit inside the box, has this press already.
        if (event.button !== 0 || start.current !== null) return;
        if (event.target instanceof Element && event.target.closest(PICTURE_STILL) !== null) return;
        press.current = { x: event.clientX, y: event.clientY, rect: read() };
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const from = press.current;
        if (from === null) return;
        // Let go somewhere this box never heard of: the press is over.
        if ((event.buttons & 1) === 0) {
          press.current = null;
          return;
        }
        if (start.current === null) {
          if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < PICTURE_DRAG_AFTER) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = from;
          quiet(true);
        }
        write({ ...from.rect, x: from.rect.x + event.clientX - from.x, y: from.rect.y + event.clientY - from.y });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        const dragged = press.current !== null && start.current === press.current;
        press.current = null;
        if (dragged) end(event);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
        const dragged = press.current !== null && start.current === press.current;
        press.current = null;
        if (dragged) end(event);
      },
      // The browser's own drag (a picture is draggable by nature, and so is anything a double press left selected) would
      // take the pointer away mid-move and leave the float where the first step put it: seen with YouTube's cover in a
      // room, 2026-11-16. A press this handle has is this handle's.
      onDragStart: (event: ReactDragEvent<HTMLElement>) => {
        if (press.current !== null) event.preventDefault();
      },
    },
  };
}
