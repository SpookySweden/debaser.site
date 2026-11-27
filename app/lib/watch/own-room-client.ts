import { createWindowSlot } from '../ui/window-slot';
import type { OwnRoomSession, RoomStore } from './own-room';
import { applyBrowserChange, peekRoom, primeRoom } from './use-watch-room';

/**
 * Your own room in this tab (SPEC-rooms-queues.md): which session is running, and what its room is.
 *
 * Module state, like the windows (`window-slot.ts`): the keeper in `layout.tsx` (`MusicRoomKeeper.tsx`) sets it, and
 * anything that adds to your queue or opens it asks here, without the page being drawn again.
 */

export type OwnRoomNow = {
  session: OwnRoomSession | null;
  /** Null until the room has been found or started. */
  roomId: string | null;
  /** Whose it is: an account's id, or a visitor's browser-only id. */
  hostId: string | null;
  /** A signed-out visitor's: kept in this browser, nothing sent anywhere. */
  visitor: boolean;
  /** Writes are waiting on a database that could not be reached; the room carries on in the browser. */
  waiting: boolean;
  /** The last thing that could not be queued, in words fit to show, until something is. */
  note?: string | null;
};

const NONE: OwnRoomNow = { session: null, roomId: null, hostId: null, visitor: false, waiting: false };
const slot = createWindowSlot<OwnRoomNow>(NONE);

export const ownRoomState = slot.state;
export const subscribeToOwnRoom = slot.subscribe;

export function setOwnRoom(next: OwnRoomNow): void {
  slot.set(next);
}

/** A change to the room in hand, dropped if another session has taken its place since. */
export function patchOwnRoom(session: OwnRoomSession, patch: Partial<OwnRoomNow>): void {
  const now = slot.state();
  if (now.session !== session) return;
  if ((Object.keys(patch) as (keyof OwnRoomNow)[]).every((key) => now[key] === patch[key])) return;
  slot.set({ ...now, ...patch });
}

export function clearOwnRoom(session: OwnRoomSession): void {
  if (slot.state().session === session) slot.set(NONE);
}

/** The browser's copy every window reads (`use-watch-room.ts`), as the session writes to it. */
export const sharedRoomStore: RoomStore = { get: peekRoom, prime: primeRoom, apply: applyBrowserChange };

/**
 * Your room came back with this page (`OwnRoomComesBack`, WatchWindow.tsx). Its window decides what that means once it knows who
 * is in it (Luke, 2026-11-27, device-lead.ts): alone, it was a reload, and your room waits paused where it was (ROOMSYNC); with
 * another of your devices in it playing, this one follows it and nothing is paused.
 */
let cameBack: { roomId: string; at: number } | null = null;
/** A come-back older than this was never taken (its window never led): forgotten. */
const CAME_BACK_MS = 30_000;

export function noteComeBack(roomId: string): void {
  cameBack = { roomId, at: Date.now() };
}

/** True once, for the room that just came back with this page. */
export function takeComeBack(roomId: string): boolean {
  const held = cameBack;
  if (held === null || held.roomId !== roomId) return false;
  cameBack = null;
  return Date.now() - held.at < CAME_BACK_MS;
}

const VISITOR_KEY = 'debaser.own-room.visitor.v1';

/** The visitor id this browser already holds, or null: asked when somebody logs in, so nothing is made up for them. */
export function storedVisitorRoomId(): string | null {
  try {
    const held = window.localStorage.getItem(VISITOR_KEY);
    return held !== null && /^visitor:[0-9a-f-]{36}$/.test(held) ? held : null;
  } catch {
    return null;
  }
}

/** A signed-out visitor's id for their browser room: made once, kept in this browser, sent nowhere. */
export function visitorRoomId(): string {
  try {
    const held = window.localStorage.getItem(VISITOR_KEY);
    if (held !== null && /^visitor:[0-9a-f-]{36}$/.test(held)) return held;
    const made = `visitor:${crypto.randomUUID()}`;
    window.localStorage.setItem(VISITOR_KEY, made);
    return made;
  } catch {
    // Storage blocked: a room for this visit only.
    return `visitor:${crypto.randomUUID()}`;
  }
}
