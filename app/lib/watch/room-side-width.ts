'use client';

import { useSyncExternalStore } from 'react';

/**
 * How wide a room's side column is (the chat, or YOUR ROOM's JUST YOU HERE), when the reader has dragged the edge between
 * it and the picture (Luke, 2026-11-16: "chat space resizable by click-dragging on the side of the video port"). One width
 * for both room windows, since they share the frame (`room-frame.ts`), kept in this browser only. Null: never dragged, so
 * the frame's own width (`ROOM_SIDE`).
 */

const KEY = 'debaser.site.room-side.v1';
/** Narrower than this and the chat's lines and keys stop fitting. */
export const SIDE_MIN = 240;
/** The picture keeps at least this much beside a wide column. */
export const STAGE_MIN = 320;

let width: number | null | undefined;
const listeners = new Set<() => void>();

function read(): number | null {
  if (width !== undefined) return width;
  try {
    const kept = Number(window.localStorage.getItem(KEY));
    width = Number.isFinite(kept) && kept >= SIDE_MIN ? Math.round(kept) : null;
  } catch {
    width = null;
  }
  return width;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The width the reader chose, or null for the frame's own. */
export function useRoomSideWidth(): number | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** The width a drag asks for, kept within what the room has: never under `SIDE_MIN`, and the picture keeps `STAGE_MIN`. */
export function clampSide(asked: number, room: number, gap: number): number {
  const most = Math.max(SIDE_MIN, room - gap - STAGE_MIN);
  return Math.round(Math.min(most, Math.max(SIDE_MIN, asked)));
}

/** A new width (null: back to the frame's own), remembered in this browser unless `keep` is false (mid-drag). */
export function setRoomSideWidth(next: number | null, keep = true): void {
  width = next === null ? null : Math.round(next);
  if (keep) save();
  for (const listener of listeners) listener();
}

function save(): void {
  try {
    if (width === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(width));
  } catch {
    // A browser that keeps nothing still has the width for this visit.
  }
}

/** The end of a drag: the width it left is remembered. */
export function keepRoomSideWidth(): void {
  save();
}
