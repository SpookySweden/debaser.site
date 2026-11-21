import type { MotionId } from './motion';
import type { WalkerState } from './walker';
import type { SpeechLine } from '../speech/script';

/**
 * Characters who are friends (Luke, 2026-11-21: "make it so that moldavius figtree and swedens characters like eachother
 * and hang out with eachother in a jovial manner").
 *
 * Whenever two friends' characters are on one screen together - a profile's ROOM (the owner's character, a visiting
 * companion, a commenter come to visit) or a stream room's strip - they drift toward each other, stand together facing
 * each other, now and then wave, hop or cheer, and in a ROOM swap a cheerful noise in their own blip voices, the friend
 * answering a moment later. Nothing is stored or sent for it: every browser works it out from this list.
 *
 * Pure on purpose (the dice are handed in), so `Temp/check-character-friends.cjs` can hold every rule in Node.
 *
 * **What a friend says is a noise, never words** (SPEC-character-speech.md: a character never says anything its own
 * person did not write). The lines below are cheerful nonsense and text faces, so no real person is given a sentence.
 */

/** Pairs of accounts whose characters are friends. Add a pair to make two more friends. */
export const FRIEND_PAIRS: readonly (readonly [string, string])[] = [
  // sweden (Luke) and moldavius figtree.
  ['85e2a97c-7963-4b43-981b-370ca3e457d3', 'a887588b-1dd2-4be3-9c9f-9897ec492c31'],
];

export function areFriends(a: string | null | undefined, b: string | null | undefined, pairs = FRIEND_PAIRS): boolean {
  if (!a || !b || a === b) return false;
  return pairs.some(([one, two]) => (one === a && two === b) || (one === b && two === a));
}

/** The first of `present` who is a friend of `me`, or null. */
export function friendIn(me: string | null | undefined, present: readonly string[], pairs = FRIEND_PAIRS): string | null {
  return present.find((other) => areFriends(me, other, pairs)) ?? null;
}

/** The gap left between two friends standing together, as a share of a figure's width. */
export const FRIEND_GAP_SHARE = 0.15;
/** Closer than this many figure-widths apart (left edge to left edge), they count as together. */
export const FRIEND_NEAR_WIDTHS = 1.7;
/** How many of a character's fresh choices (a walk, a stand) head for its friend instead, while they are apart. */
export const FRIEND_PULL = 0.8;
/** The chance a tick that a walk taking it away from its friend turns round (ten ticks a second: within a few seconds). */
export const FRIEND_TURN = 1 / 25;
/** The chance a tick, standing together, that it does something cheerful (ten ticks a second: one every few seconds). */
export const FRIEND_FUN = 1 / 45;
/** On a stream room's strip, how often a companion standing with its friend cheers at them, in ms (picked between the two). */
export const FRIEND_CHEER_MS: readonly [number, number] = [5_000, 12_000];
/** The cheerful one-offs, all in every strip (or played by an older strip's stand-in). */
export const FRIEND_ACTS: readonly MotionId[] = ['wave', 'hop', 'cheer', 'wave', 'hop'];

/**
 * Where to head to stand beside a friend: halfway between the two, on its own side. Both friends heading for it meet in
 * the middle and never cross over, even when each only knows where the other was a moment ago. Positions are left edges.
 */
export function meetingSpot(x: number, friendX: number, w: number): number {
  const mid = (x + friendX) / 2;
  const side = x <= friendX ? -1 : 1;
  return Math.round(mid + (side * (w * (1 + FRIEND_GAP_SHARE))) / 2);
}

/** Whether two figures `w` wide stand together. */
export function nearFriend(x: number, friendX: number, w: number): boolean {
  return Math.abs(x - friendX) <= w * FRIEND_NEAR_WIDTHS;
}

/**
 * A profile ROOM's walker with a friend in the room: `next` is what `stepWalker` chose from `prev`. A fresh choice (a new
 * walk or stand) usually heads for the friend while they are apart; standing together it faces the friend and now and
 * then waves, hops or cheers. A walk taking it away from the friend soon turns round. A dance (the track playing), a
 * one-off under way and a walk already heading the friend's way are left alone.
 * `room` is how far its left edge may go.
 */
export function befriend(
  prev: WalkerState,
  next: WalkerState,
  input: { friendX: number | null; w: number; room: number; random: () => number },
): WalkerState {
  const { friendX, w, room, random } = input;
  if (friendX === null) return next;
  if (next.activity !== 'idle' && next.activity !== 'walk') return next;
  const fresh = next.tick === 0 && next !== prev;
  const together = nearFriend(next.x, friendX, w);
  const toward: 1 | -1 = friendX >= next.x ? 1 : -1;

  // A walk under way that takes it further from its friend: now and then it thinks better of it and turns round.
  const away = next.activity === 'walk' && !fresh && !together && Math.abs(next.target - friendX) > Math.abs(next.x - friendX);
  if ((away && random() < FRIEND_TURN) || (fresh && !together && random() < FRIEND_PULL)) {
    const target = Math.min(Math.max(0, meetingSpot(next.x, friendX, w)), Math.max(0, room));
    if (target !== next.x) return { ...next, activity: 'walk', motion: 'walk', tick: 0, target, dir: target > next.x ? 1 : -1 };
  }
  if (together && next.activity === 'idle') {
    if (random() < FRIEND_FUN) {
      const motion = FRIEND_ACTS[Math.min(FRIEND_ACTS.length - 1, Math.floor(random() * FRIEND_ACTS.length))];
      return { ...next, activity: 'react', motion, tick: 0, dir: toward };
    }
    return next.dir === toward ? next : { ...next, dir: toward };
  }
  // Arrived beside the friend from a walk somewhere else: it stays to hang out rather than wandering straight off.
  if (fresh && together && next.activity === 'walk' && random() < FRIEND_PULL) {
    return { ...next, activity: 'idle', motion: 'idle', tick: 0, left: Math.max(next.left, 30), target: next.x, dir: toward };
  }
  return next;
}

/** Cheerful noises and text faces: what friends say to each other. Never words a real person might have said. */
export const FRIEND_NOISES: readonly string[] = [
  '\\(^o^)/',
  'hehehe!',
  'yay!! \u266A',
  'o/ o/ o/',
  'wheee!',
  'la la la \u266A',
  '(^_^)b',
  '!!!',
  'hoo hoo!',
  '~(^-^)~',
  'bwee!',
  'heh heh \u266A',
];
/** How many of the noises each character has: its own few, so each friend sounds like itself. */
export const NOISES_EACH = 3;
/** The wait before a friend answers a cheerful noise, in ms (picked between the two). */
export const FRIEND_REPLY_MS: readonly [number, number] = [700, 1400];

/** A small steady number from an account's id, so the same character always has the same noises. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

/** Which of the noises a character has: `NOISES_EACH` of them, always the same ones for the same account. */
export function noisesOf(speakerId: string): string[] {
  const seed = seedOf(speakerId);
  const order = FRIEND_NOISES.map((text, index) => ({ text, key: seedOf(`${seed}:${index}`) })).sort((a, b) => a.key - b.key);
  return order.slice(0, NOISES_EACH).map((one) => one.text);
}

/** The prefix of a cheerful line said to a friend, and of a friend's answer to one. */
const SAID = 'friend:';
const ANSWER = 'friend-back:';

/** A character's cheerful lines for its friend, for the ROOM's talk: they lead nowhere when pressed. */
export function friendLines(speakerId: string): SpeechLine[] {
  return noisesOf(speakerId).map((text, index) => ({ id: `${SAID}${index}`, speakerId, text, target: { kind: 'none' } }));
}

/** A friend's answer to a cheerful line: one of its own noises, at random. */
export function friendAnswer(speakerId: string, random: () => number): SpeechLine {
  const own = noisesOf(speakerId);
  const index = Math.min(own.length - 1, Math.floor(random() * own.length));
  return { id: `${ANSWER}${index}`, speakerId, text: own[index], target: { kind: 'none' } };
}

/** Whether a line is a cheerful line said to a friend, which the friend answers (an answer is not answered again). */
export function wantsAnswer(line: SpeechLine): boolean {
  return line.id.startsWith(SAID);
}
