import { createWindowSlot } from '../ui/window-slot';

/**
 * What a companion says about itself in a stream or music room (SPEC-companion.md, decision 4).
 *
 * It rides on the room's own presence channel (`watch:<room>`, `joinRoom` in the watch repositories), as a field of
 * the tab's presence, so no new channel and no new database rule: presence on `watch:%` is already allowed. A tab
 * re-says its presence only when this changes (a new walk target, a new mood, a reaction), never per frame, and each
 * browser plays the walking itself. Nothing here is ever stored.
 */

/** What a companion is doing. `walk` and `chase` walk to `x`; the rest happen where it stands. */
export type CompanionMood = 'stand' | 'walk' | 'sit' | 'sleep' | 'dance' | 'chase';

export const COMPANION_MOODS: readonly CompanionMood[] = ['stand', 'walk', 'sit', 'sleep', 'dance', 'chase'];

/** What sets off a hop: a reply, a message, someone coming online, waking up, or a press on it. */
export type CompanionReaction = 'reply' | 'message' | 'online' | 'wake' | 'poke';

export const COMPANION_REACTIONS: readonly CompanionReaction[] = ['reply', 'message', 'online', 'wake', 'poke'];

/** Reactions that put a `!` over its head; the others are a hop alone. */
export function reactionShowsMark(kind: CompanionReaction): boolean {
  return kind === 'reply' || kind === 'message' || kind === 'online';
}

export type CompanionWire = {
  /** Where it is headed, as a share of the strip's width (0 left .. 1 right), so screens of any width agree. */
  x: number;
  m: CompanionMood;
  /** Counts up with every reaction: a viewer hops when it sees a bigger number than last time. */
  r: number;
  /** The latest reaction's kind, read with `r`. */
  k: CompanionReaction | null;
  /**
   * Which baked strip it wears: when its owner's SHOWN character was baked (SPEC-profile-characters.md), so a viewer
   * reads it again when it changes. Null is the placeholder field (no SHOWN character).
   */
  c: string | null;
};

/** A companion seen in the room, with its owner's name for the hover. */
export type RoomCompanion = {
  /** The tab's presence key: one account in two tabs is two companions, as it is two members. */
  key: string;
  /** Its owner's account: viewers read that account's SHOWN character to draw it (anyone may). */
  userId: string;
  name: string;
  joinedAt: number;
  wire: CompanionWire;
};

/** At most this many companions are drawn on one strip (yours included); the rest are dropped quietly. */
export const MAX_COMPANIONS = 8;

const CHARACTER_REF_MAX = 200;

/** Reads a companion off somebody else's presence. Anything malformed is no companion, never an error. */
export function parseCompanionWire(value: unknown): CompanionWire | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? Math.min(1, Math.max(0, raw.x)) : null;
  const m = typeof raw.m === 'string' && (COMPANION_MOODS as readonly string[]).includes(raw.m) ? (raw.m as CompanionMood) : null;
  if (x === null || m === null) return null;
  const r = typeof raw.r === 'number' && Number.isInteger(raw.r) && raw.r >= 0 ? raw.r : 0;
  const k = typeof raw.k === 'string' && (COMPANION_REACTIONS as readonly string[]).includes(raw.k) ? (raw.k as CompanionReaction) : null;
  const c = typeof raw.c === 'string' && raw.c.length > 0 && raw.c.length <= CHARACTER_REF_MAX ? raw.c : null;
  return { x, m, r, k, c };
}

/** Two wires that would draw the same: nothing to re-say. */
export function sameWire(a: CompanionWire | null, b: CompanionWire | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.m === b.m && a.r === b.r && a.k === b.k && a.c === b.c;
}

/** The companions to draw, oldest in the room first, capped so yours (when it is out) always has a place. */
export function companionsToDraw(others: readonly RoomCompanion[], mineOut: boolean): RoomCompanion[] {
  const room = MAX_COMPANIONS - (mineOut ? 1 : 0);
  return [...others].sort((a, b) => a.joinedAt - b.joinedAt || a.key.localeCompare(b.key)).slice(0, Math.max(0, room));
}

/* --- the two slots: what this tab says, and what the room says back ------------------------------------------- */

const outSlot = createWindowSlot<CompanionWire | null>(null);
const roomSlot = createWindowSlot<readonly RoomCompanion[]>([]);

/** This tab's companion as the room should hear it; null while it is off (or signed out). */
export const companionOutState = outSlot.state;
export const subscribeToCompanionOut = outSlot.subscribe;

export function sayCompanion(next: CompanionWire | null): void {
  if (sameWire(outSlot.state(), next)) return;
  outSlot.set(next);
}

/** The other companions in the room this tab is in. Empty outside rooms. */
export const roomCompanionsState = roomSlot.state;
export const subscribeToRoomCompanions = roomSlot.subscribe;
export const serverRoomCompanions = (): readonly RoomCompanion[] => EMPTY;
const EMPTY: readonly RoomCompanion[] = [];

/** Written by the room's presence (the watch repositories) on every sync, and emptied when the tab leaves. */
export function setRoomCompanions(next: readonly RoomCompanion[]): void {
  const now = roomSlot.state();
  const same =
    now.length === next.length &&
    now.every((one, i) => one.key === next[i].key && one.userId === next[i].userId && one.name === next[i].name && sameWire(one.wire, next[i].wire));
  if (same) return;
  roomSlot.set(next.length === 0 ? EMPTY : next);
}
