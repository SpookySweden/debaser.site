'use client';

import { useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

export type CanvasDraggable = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  /** No native drag (a link or picture inside): the pointer is ours. */
  onDragStart: (event: ReactMouseEvent<HTMLElement>) => void;
};

/**
 * Dragging things onto the room canvas (SPEC-stream-art.md): a GIPHY / Commons search result or a chat line, picked
 * up with the pointer (a finger too) and dropped on the canvas, where it lands as a placed picture or a line of text.
 * Pointer events, the way the queue window drags, not HTML drag and drop. A press that never moves past a few
 * pixels is a click as before (sending the picture to the chat); one that did is not a click.
 *
 * The canvas on screen registers itself as the drop target; while none is registered nothing can be dragged.
 */

/** What is being carried. */
export type CanvasDragPayload =
  | { type: 'picture'; url: string; title: string }
  | { type: 'text'; text: string; writerId: string | null; writerLabel: string; colour: string };

export type CanvasDragState = { payload: CanvasDragPayload; x: number; y: number } | null;

/** How far a press moves before it is a drag. */
const PICK_UP_PX = 6;

type Target = { element: HTMLElement; onDrop: (payload: CanvasDragPayload, clientX: number, clientY: number) => void };

let target: Target | null = null;
let state: CanvasDragState = null;
/** A drag just ended: the click the browser sends after the release is not a click. */
let swallowClick = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The canvas on screen takes drops; null when it goes. */
export function setCanvasDropTarget(next: Target | null): void {
  target = next;
  emit();
}

/** Whether a canvas is on screen to drop onto (the search results wiggle then). */
export function useCanvasOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => target !== null,
    () => false,
  );
}

/** What is being carried now, for the picture under the pointer. */
export function useCanvasDrag(): CanvasDragState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** Is the point over the drop target? */
export function overCanvas(x: number, y: number): boolean {
  if (target === null) return false;
  const box = target.element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * The pointer handlers that make an element draggable onto the canvas. The click a drag ends with is swallowed
 * (`onClickCapture`), so a dragged GIF is not also sent to the chat and a dragged line does not open a profile.
 */
export function canvasDraggable(payload: () => CanvasDragPayload | null): CanvasDraggable {
  return {
    onDragStart(event) {
      event.preventDefault();
    },
    onClickCapture(event) {
      if (!swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown(event) {
      if (target === null || event.button !== 0) return;
      const carried = payload();
      if (carried === null) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;
      const move = (moved: PointerEvent) => {
        if (moved.pointerId !== pointerId) return;
        if (!dragging && Math.hypot(moved.clientX - startX, moved.clientY - startY) < PICK_UP_PX) return;
        // Carrying, not selecting: what the press began to select is let go.
        if (!dragging) window.getSelection()?.removeAllRanges();
        dragging = true;
        moved.preventDefault();
        state = { payload: carried, x: moved.clientX, y: moved.clientY };
        emit();
      };
      const finish = (ended: PointerEvent, dropped: boolean) => {
        if (ended.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (dragging) {
          swallowClick = true;
          window.setTimeout(() => {
            swallowClick = false;
          }, 0);
          if (dropped && target !== null && overCanvas(ended.clientX, ended.clientY)) target.onDrop(carried, ended.clientX, ended.clientY);
        }
        state = null;
        emit();
      };
      const up = (ended: PointerEvent) => finish(ended, true);
      const cancel = (ended: PointerEvent) => finish(ended, false);
      const escape = (key: KeyboardEvent) => {
        if (key.key !== 'Escape' || !dragging) return;
        key.stopPropagation();
        dragging = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        state = null;
        emit();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    },
  };
}

/** True once, for the click a drag's release makes: the element's onClick then does nothing. */
export function dragClick(): boolean {
  return swallowClick;
}
