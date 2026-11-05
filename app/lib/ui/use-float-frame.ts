'use client';

import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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
 * Pointer handling for a floating picture's title line and resize grips, like the site's windows (`DockWindow.tsx`).
 *
 * `read` is the rect drawn now and `write` keeps a new one. An iframe swallows the pointer, so while a drag is on the
 * frames inside `host` ignore it; the press itself is captured by the handle, as the windows' are.
 */
export function useFloatFrame(host: () => HTMLElement | null, read: () => FloatRect, write: (rect: FloatRect) => void) {
  const start = useRef<{ x: number; y: number; rect: FloatRect } | null>(null);

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
  };
}
