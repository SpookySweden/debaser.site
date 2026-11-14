'use client';

import { useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Letter } from './types';

/**
 * Carrying a letter to a person (SPEC-letter-drag.md; Luke, 2026-11-14: "you can drag and drop letters from the profile
 * page to users on the sidebar or directly to a users character to reccomend them the letter"). Pointer events, the way
 * the stream queue and the room canvas drag (`app/lib/watch/canvas-drag.ts`), not HTML drag and drop. A press that never
 * moves past a few pixels is a click as before (it opens the letter); one that did is not a click.
 *
 * Who can catch a letter is read off the page, so this file knows nothing about the side panel or the characters:
 * - a row of the side panel's people list says whose it is with `data-letter-catcher="<user id>"` (`UserDirectoryRow`);
 * - a drawn character says whose it is with `data-companion-of` (a companion on the strip) or `data-character-of` (a
 *   character in a profile's ROOM), written by the COMPANION session's components.
 * A character is found by its box, because a companion lets presses fall through it; a row by what is really under the
 * pointer, so a row hidden behind a window catches nothing.
 *
 * Luke chose "sends at once" (Q2), so a drop is the send: it counts only inside a lit catcher, and Escape puts the letter
 * back. The sending itself is whoever listens for the drop (`LetterDragLayer`).
 */

export type LetterCatcher = { userId: string; kind: 'row' | 'character' };
export type LetterDragState = { letter: Letter; x: number; y: number; over: LetterCatcher | null } | null;
export type LetterDrop = LetterCatcher & { letter: Letter; x: number; y: number };

export type LetterDraggable = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  /** No native drag (the envelope is a picture): the pointer is ours. */
  onDragStart: (event: ReactMouseEvent<HTMLElement>) => void;
};

/** How far a press moves before it is a drag. */
const PICK_UP_PX = 6;
/** A character is small and may be walking: its catching area reaches this far past its picture. */
export const CATCH_ROOM_PX = 12;

const ROW = 'data-letter-catcher';
const CHARACTERS = '[data-companion-of], [data-character-of]';

let state: LetterDragState = null;
/** Who can't catch the letter in the air: the one carrying it, and the letter's own owner. */
let barred: ReadonlySet<string> = new Set();
let onDrop: ((drop: LetterDrop) => void) | null = null;
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

/** Whoever sends the dropped letter (one at a time: the profile on screen). */
export function setLetterDropHandler(next: ((drop: LetterDrop) => void) | null): void {
  onDrop = next;
}

function ownerOf(figure: HTMLElement): string | null {
  return figure.getAttribute('data-companion-of') ?? figure.getAttribute('data-character-of');
}

/** Every character on screen that could catch the letter in the air, with where it stands now. */
export function characterCatchers(): { userId: string; box: DOMRect }[] {
  if (state === null || typeof document === 'undefined') return [];
  const found: { userId: string; box: DOMRect }[] = [];
  for (const figure of document.querySelectorAll<HTMLElement>(CHARACTERS)) {
    const userId = ownerOf(figure);
    if (userId === null || userId === '' || barred.has(userId)) continue;
    const box = figure.getBoundingClientRect();
    // A companion that isn't drawn (kept in the page but hidden) is nobody to hand a letter to.
    if (box.width > 0 && box.height > 0 && getComputedStyle(figure).visibility !== 'hidden') found.push({ userId, box });
  }
  return found;
}

/** Who is under the point: a character first (it stands over the page), then a row of the people list. */
function catcherAt(x: number, y: number): LetterCatcher | null {
  for (const { userId, box } of characterCatchers()) {
    if (x >= box.left - CATCH_ROOM_PX && x <= box.right + CATCH_ROOM_PX && y >= box.top - CATCH_ROOM_PX && y <= box.bottom + CATCH_ROOM_PX) {
      return { userId, kind: 'character' };
    }
  }
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${ROW}]`);
  const userId = row?.getAttribute(ROW) ?? '';
  return userId !== '' && !barred.has(userId) ? { userId, kind: 'row' } : null;
}

/** What is being carried now: for the envelope under the pointer and the outlines round the characters. */
export function useLetterDrag(): LetterDragState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** How one person's row should look while a letter is in the air: lit (it can catch), under the pointer, or as ever. */
export function useLetterCatcher(userId: string): 'none' | 'lit' | 'over' {
  return useSyncExternalStore(
    subscribe,
    () => (state === null || barred.has(userId) ? 'none' : state.over?.userId === userId ? 'over' : 'lit'),
    () => 'none',
  );
}

/** What a row writes on itself so a drop can find it; nothing on your own row. */
export function letterCatcherProps(userId: string, you: boolean): { [ROW]?: string } {
  return you ? {} : { [ROW]: userId };
}

/**
 * The pointer handlers that make a letter's key draggable. `carried` says what is picked up and who may not catch it,
 * or null when it can't be carried (a visitor). The click a drag ends with is swallowed, so a carried letter doesn't open.
 */
export function letterDraggable(carried: () => { letter: Letter; barred: readonly string[] } | null): LetterDraggable {
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
      if (event.button !== 0 || state !== null) return;
      const picked = carried();
      if (picked === null) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        state = null;
        barred = new Set();
        emit();
      };
      const move = (moved: PointerEvent) => {
        if (moved.pointerId !== pointerId) return;
        if (!dragging && Math.hypot(moved.clientX - startX, moved.clientY - startY) < PICK_UP_PX) return;
        if (!dragging) {
          // Carrying, not selecting: what the press began to select is let go.
          window.getSelection()?.removeAllRanges();
          barred = new Set(picked.barred);
          dragging = true;
        }
        moved.preventDefault();
        // The state has to say a letter is up before the catchers are read: they are only catchers while one is.
        state = { letter: picked.letter, x: moved.clientX, y: moved.clientY, over: state?.over ?? null };
        state = { ...state, over: catcherAt(moved.clientX, moved.clientY) };
        emit();
      };
      const finish = (ended: PointerEvent, dropped: boolean) => {
        if (ended.pointerId !== pointerId) return;
        const landed = dragging && dropped && state !== null ? catcherAt(ended.clientX, ended.clientY) : null;
        if (dragging) {
          swallowClick = true;
          window.setTimeout(() => {
            swallowClick = false;
          }, 0);
        }
        // The drop is handed over while the letter is still up, so whoever sends it can still read what the carry held;
        // the carry ends whatever that does.
        try {
          if (landed !== null) onDrop?.({ ...landed, letter: picked.letter, x: ended.clientX, y: ended.clientY });
        } finally {
          stop();
        }
      };
      const up = (ended: PointerEvent) => finish(ended, true);
      const cancel = (ended: PointerEvent) => finish(ended, false);
      const escape = (key: KeyboardEvent) => {
        if (key.key !== 'Escape' || !dragging) return;
        // Escape puts the letter back, and only that: a window behind it doesn't close on the same press.
        key.stopPropagation();
        key.preventDefault();
        dragging = false;
        stop();
        // The button is still held: when it comes up over the letter's own key, that is not a press to open it.
        const release = () => {
          window.removeEventListener('pointerup', release);
          swallowClick = true;
          window.setTimeout(() => {
            swallowClick = false;
          }, 0);
        };
        window.addEventListener('pointerup', release);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    },
  };
}
