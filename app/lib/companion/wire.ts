import type { MotionId } from '../character/motion';
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

/**
 * What sets off a one-off motion: a reply, a message, someone coming online, waking up, a press on it, and (Luke,
 * 2026-11-14) a wave, a spin, a cheer, a slump, landing after being dropped, and a page turned.
 */
export type CompanionReaction =
  | 'reply'
  | 'message'
  | 'online'
  | 'wake'
  | 'poke'
  | 'wave'
  | 'spin'
  | 'cheer'
  | 'slump'
  | 'land'
  | 'flick'
  // Step 3 (2026-11-14): a game invite, a recommendation, a look round (the theme changed), and its owner speaking in a room's chat.
  | 'invite'
  | 'recommend'
  | 'look'
  | 'spoke';

export const COMPANION_REACTIONS: readonly CompanionReaction[] = [
  'reply',
  'message',
  'online',
  'wake',
  'poke',
  'wave',
  'spin',
  'cheer',
  'slump',
  'land',
  'flick',
  'invite',
  'recommend',
  'look',
  'spoke',
];

/**
 * The text mark each reaction puts over its head for a moment, or null for a motion alone. Text characters, never art:
 * `!` for a reply, a message or somebody coming online, `VS` for a game invite, a heart for a recommendation, `...` for
 * speaking in a room's chat.
 */
export function reactionMark(kind: CompanionReaction | null): string | null {
  switch (kind) {
    case 'reply':
    case 'message':
    case 'online':
      return '!';
    case 'invite':
      return 'VS';
    case 'recommend':
      return '\u2665';
    case 'spoke':
      return '...';
    default:
      return null;
  }
}

/** Reactions that put a mark over its head; the others are a motion alone. */
export function reactionShowsMark(kind: CompanionReaction): boolean {
  return reactionMark(kind) !== null;
}

/**
 * Reactions a room is never told: they are played on the screen they happen on and nowhere else. A page turned and a
 * theme changed are its owner's own business; a line of chat every browser in the room already has, and works the hop
 * out from it, so nothing extra is sent.
 */
export function reactionIsLocal(kind: CompanionReaction): boolean {
  return kind === 'flick' || kind === 'look' || kind === 'spoke';
}

/**
 * The one-off motion each reaction plays, once through. A browser on older code reads a kind it doesn't know as no kind
 * and plays a hop, so nothing new here can break it.
 */
const REACTION_MOTIONS: Record<CompanionReaction, MotionId> = {
  reply: 'hop',
  message: 'hop',
  online: 'hop',
  poke: 'hop',
  wake: 'stretch',
  wave: 'wave',
  spin: 'dance4',
  cheer: 'cheer',
  slump: 'slump',
  land: 'land',
  flick: 'flick',
  invite: 'hop',
  recommend: 'hop',
  look: 'turn',
  spoke: 'hop',
};
export function reactionMotion(kind: CompanionReaction | null): MotionId {
  return kind === null ? 'hop' : REACTION_MOTIONS[kind];
}

/** The loops a companion may say it is playing in place of its mood's own (`CompanionWire.p`), and the moods each goes with. */
const POSE_MOODS: Partial<Record<MotionId, readonly CompanionMood[]>> = {
  dance1: ['dance'],
  dance2: ['dance'],
  dance3: ['dance'],
  dance4: ['dance'],
  dance5: ['dance'],
  run: ['walk', 'chase'],
  curl: ['sleep'],
  watch: ['sit'],
  read: ['sit'],
  type: ['stand'],
};
/**
 * The poses a room is told. Not `read` or `type`: those say what its owner is doing elsewhere on the site (reading a
 * book, writing to somebody), which is nobody's business in a stream room. The room sees it sit, or stand.
 */
export const COMPANION_POSES: readonly MotionId[] = ['dance1', 'dance2', 'dance3', 'dance4', 'dance5', 'run', 'curl', 'watch'];

/** The loop a mood plays on its own. `dance` is whichever dance the browser drawing it picked. */
export function moodMotion(mood: CompanionMood, dance: MotionId): MotionId {
  switch (mood) {
    case 'walk':
      return 'walk';
    case 'chase':
      return 'run';
    case 'sit':
      return 'sit';
    case 'sleep':
      return 'sleep';
    case 'dance':
      return dance;
    default:
      return 'idle';
  }
}

/** The loop to draw: the pose it says, when that goes with its mood (a curl is only ever a sleep), else the mood's own. */
export function loopMotion(mood: CompanionMood, pose: MotionId | null, dance: MotionId): MotionId {
  return pose !== null && (POSE_MOODS[pose] ?? []).includes(mood) ? pose : moodMotion(mood, dance);
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
  /**
   * The loop it plays in place of its mood's own: which dance, a run, a deep sleep's curl. Null (or missing, from a
   * browser on older code) is the mood's own. The moods stay the first six, so older code still draws it.
   */
  p: MotionId | null;
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
  const p = typeof raw.p === 'string' && (COMPANION_POSES as readonly string[]).includes(raw.p) ? (raw.p as MotionId) : null;
  return { x, m, r, k, c, p };
}

/** Two wires that would draw the same: nothing to re-say. */
export function sameWire(a: CompanionWire | null, b: CompanionWire | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.m === b.m && a.r === b.r && a.k === b.k && a.c === b.c && a.p === b.p;
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

/**
 * How long a companion that has dropped out of the room's presence is kept on screen. A tab re-saying its presence can
 * be missing from one sync and back in the next; without this its companion blinks out and jumps (seen 2026-11-14).
 */
export const LINGER_MS = 2_500;

export type Lingering = ReadonlyMap<string, { companion: RoomCompanion; until: number }>;

/**
 * The companions to show after a sync: everyone present, and anyone who was shown a moment ago and is missing from this
 * sync, kept until their time is up. Pure. An empty sync is the tab leaving the room (or the room emptying): nobody is kept.
 */
export function withLingering(
  shown: readonly RoomCompanion[],
  present: readonly RoomCompanion[],
  held: Lingering,
  now: number,
): { list: RoomCompanion[]; held: Map<string, { companion: RoomCompanion; until: number }> } {
  const next = new Map<string, { companion: RoomCompanion; until: number }>();
  if (present.length === 0) return { list: [], held: next };
  const here = new Set(present.map((one) => one.key));
  for (const [key, kept] of held) if (!here.has(key) && kept.until > now) next.set(key, kept);
  for (const one of shown) if (!here.has(one.key) && !held.has(one.key)) next.set(one.key, { companion: one, until: now + LINGER_MS });
  return { list: [...present, ...[...next.values()].map((kept) => kept.companion)], held: next };
}

let lingering: Map<string, { companion: RoomCompanion; until: number }> = new Map();
let lastPresent: readonly RoomCompanion[] = EMPTY;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

/** Written by the room's presence (the watch repositories) on every sync, and emptied when the tab leaves. */
export function setRoomCompanions(present: readonly RoomCompanion[]): void {
  lastPresent = present;
  const merged = withLingering(roomSlot.state(), present, lingering, Date.now());
  lingering = merged.held;
  if (lingerTimer !== null) clearTimeout(lingerTimer);
  // Looked at again when the first of those kept runs out of time, so it goes even if no sync comes.
  lingerTimer = lingering.size === 0 ? null : setTimeout(() => setRoomCompanions(lastPresent), Math.max(50, Math.min(...[...lingering.values()].map((kept) => kept.until)) - Date.now() + 20));
  const next = merged.list;
  const now = roomSlot.state();
  const same =
    now.length === next.length &&
    now.every((one, i) => one.key === next[i].key && one.userId === next[i].userId && one.name === next[i].name && sameWire(one.wire, next[i].wire));
  if (same) return;
  roomSlot.set(next.length === 0 ? EMPTY : next);
}
