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
 * Two on the very same spot (a ROOM's walkers all start at its left edge before it has a width) settle which side each
 * takes by `tieLeft` (`tiesLeft`, from the pair's ids), so they step apart instead of standing on top of each other.
 */
export function meetingSpot(x: number, friendX: number, w: number, tieLeft = true): number {
  const mid = (x + friendX) / 2;
  return Math.round(mid + (sideOf(x, friendX, tieLeft) * (w * (1 + FRIEND_GAP_SHARE))) / 2);
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
  input: { friendX: number | null; w: number; room: number; random: () => number; tieLeft?: boolean },
): WalkerState {
  const { friendX, w, room, random, tieLeft = true } = input;
  if (friendX === null) return next;
  if (next.activity !== 'idle' && next.activity !== 'walk') return next;
  const fresh = next.tick === 0 && next !== prev;
  const together = nearFriend(next.x, friendX, w);
  const toward: 1 | -1 = sideOf(next.x, friendX, tieLeft) === -1 ? 1 : -1;
  // Standing on the very same spot as its friend: it steps over to its own side first.
  if (next.x === friendX && next.activity === 'idle') {
    const target = Math.min(Math.max(0, meetingSpot(next.x, friendX, w, tieLeft)), Math.max(0, room));
    if (target !== next.x) return { ...next, activity: 'walk', motion: 'walk', tick: 0, target, dir: target > next.x ? 1 : -1 };
  }

  // A walk under way that takes it further from its friend: now and then it thinks better of it and turns round.
  const away = next.activity === 'walk' && !fresh && !together && Math.abs(next.target - friendX) > Math.abs(next.x - friendX);
  if ((away && random() < FRIEND_TURN) || (fresh && !together && random() < FRIEND_PULL)) {
    const target = Math.min(Math.max(0, meetingSpot(next.x, friendX, w, tieLeft)), Math.max(0, room));
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

/*
 * A kiss now and then (Luke, 2026-11-22: "Make it so that moldsvius figtree and Sweden's characters kiss sometimes with
 * hearts and cutely"). Two friends who have been standing together a while step in until they all but touch, face each
 * other, both lean in on their own baked frame (sheared toward the other, feet kept where they stand: the smear rules,
 * nothing drawn), peck, lean back out, and the one on the left hops while the other cheers. Text hearts (♥) rise from
 * between them while they lean (`NoteTrail.tsx`). Rare on purpose, so it stays special.
 *
 * **When is worked out from the clock, never sent.** Time is cut into slots of `KISS_SLOT_MS`; each slot has one moment
 * in its first `KISS_WINDOW_MS`, the same for both friends (a number from the pair and the slot). At a moment, two friends
 * together for `KISS_TOGETHER_MS` kiss if it is their first since they met (and `KISS_FIRST_GAP_MS` since the last), or
 * on a coin from the same number once `KISS_GAP_MS` has passed. On a stream room's strip each friend's own browser runs
 * this for its own companion, so both lean in the same second without a word between them; and one that heard its
 * friend's companion start a kiss it did not (busy a moment, or counting their time together a second differently)
 * joins in on that same moment. In a ROOM the room runs it for both.
 * Everything after the moment is timed from it (`kissPhase`): `KISS_GO_MS` to get there, then the lean a tick at a time.
 */

/** The slots time is cut into, and the stretch at the start of each that its moment falls in, in ms. */
export const KISS_SLOT_MS = 45_000;
export const KISS_WINDOW_MS = 15_000;
/** How long two friends stand together before they may kiss, in ms. */
export const KISS_TOGETHER_MS = 20_000;
/** The least time between two kisses, and between the last kiss and a first one after meeting again, in ms. */
export const KISS_GAP_MS = 120_000;
export const KISS_FIRST_GAP_MS = 60_000;
/**
 * A moment is due only this soon after it, in ms: a clock looked at again after a long gap (the companion away in a
 * ROOM, the tab in the background) lets the kisses it missed go, rather than playing one that is already over.
 */
export const KISS_LATE_MS = 1_500;
/** The time to step in close and face each other before the lean, in ms (enough to close `KISS_NEAR_WIDTHS` at a walk). */
export const KISS_GO_MS = 3_000;
/**
 * Closer than this many figure-widths apart, two friends count as together for a kiss: looser than hanging out's
 * `FRIEND_NEAR_WIDTHS`, so a friend wandering half a step off does not start their time together again.
 */
export const KISS_NEAR_WIDTHS = 2.2;
/** Whether two figures `w` wide are close enough to count their time together for a kiss. */
export function nearForKiss(x: number, friendX: number, w: number): boolean {
  return Math.abs(x - friendX) <= w * KISS_NEAR_WIDTHS;
}
/** One step of the lean, in ms (the walkers' own ten a second). */
export const KISS_TICK_MS = 100;
/**
 * The lean, a step at a time: how far the top of the figure is pushed toward its friend, as a share of its height (its
 * feet stay put). In, a held lean, the peck (a step further for two steps), held again, and back out.
 */
export const KISS_LEAN: readonly number[] = [0.06, 0.12, 0.18, 0.18, 0.18, 0.24, 0.24, 0.18, 0.18, 0.18, 0.18, 0.12, 0.06];
/** The whole kiss, from its moment to the hop and cheer after it, in ms. */
export const KISS_MS = KISS_GO_MS + KISS_LEAN.length * KISS_TICK_MS;
/** How much of a figure's box overlaps its friend's when they stand to kiss: the boxes are wider than the figures. */
export const KISS_OVERLAP = 0.4;

/** The pair's own key, the same whichever of the two asks. */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** A slot's moment for a pair, in ms since 1970: somewhere in the first `KISS_WINDOW_MS` of it, the same for both. */
export function kissMoment(pair: string, slot: number): number {
  return slot * KISS_SLOT_MS + (seedOf(`${pair}:${slot}`) % KISS_WINDOW_MS);
}

/** When two friends started standing together, carried a step on: kept while they are near, forgotten when apart. */
export function togetherSince(since: number | null, near: boolean, now: number): number | null {
  return near ? (since ?? now) : null;
}

/**
 * Whether a pair kisses between `from` (not included) and `to`: the moment if so, else null. `since` is when they
 * started standing together (null: apart), `last` when they last kissed (null: never on this screen).
 */
export function kissDue(pair: string, from: number, to: number, since: number | null, last: number | null): number | null {
  if (since === null || to <= from) return null;
  for (let slot = Math.floor(from / KISS_SLOT_MS); slot <= Math.floor(to / KISS_SLOT_MS); slot += 1) {
    const moment = kissMoment(pair, slot);
    if (moment <= from || moment > to || to - moment > KISS_LATE_MS || moment - since < KISS_TOGETHER_MS) continue;
    const first = last === null || last < since;
    if (first && (last === null || moment - last >= KISS_FIRST_GAP_MS)) return moment;
    // After the first, a coin from the pair and the slot: both friends' browsers toss the same one.
    if (!first && moment - last >= KISS_GAP_MS && (seedOf(`${pair}:${slot}:coin`) & 1) === 0) return moment;
  }
  return null;
}

/** Where a kiss is up to, `elapsed` ms after its moment: stepping in, leaning (how far), or over (null). */
export type KissPhase = { stage: 'go' } | { stage: 'lean'; lean: number } | null;
export function kissPhase(elapsed: number): KissPhase {
  if (elapsed < 0 || elapsed >= KISS_MS) return null;
  if (elapsed < KISS_GO_MS) return { stage: 'go' };
  return { stage: 'lean', lean: KISS_LEAN[Math.min(KISS_LEAN.length - 1, Math.floor((elapsed - KISS_GO_MS) / KISS_TICK_MS))] };
}

/**
 * Which side of its friend it is on: -1 the left, 1 the right. Two standing on the very same spot settle it by `tieLeft`
 * (the pair's ids, so the two of them never both take the same side): one tie-break, everywhere.
 */
export function sideOf(x: number, friendX: number, tieLeft: boolean): 1 | -1 {
  if (x !== friendX) return x < friendX ? -1 : 1;
  return tieLeft ? -1 : 1;
}

/** Whether, on a tie, `me` takes the left side of `friend`: the smaller id does. */
export function tiesLeft(me: string | null | undefined, friend: string | null | undefined): boolean {
  return (me ?? '') < (friend ?? '');
}

/** Where to stand to kiss a friend: halfway between the two, on its own side, the boxes overlapping by `KISS_OVERLAP`. */
export function kissSpot(x: number, friendX: number, w: number, tieLeft = true): number {
  const mid = (x + friendX) / 2;
  return Math.round(mid + (sideOf(x, friendX, tieLeft) * (w * (1 - KISS_OVERLAP))) / 2);
}

/**
 * A profile ROOM's walker during a kiss, a tick at a time: stepping in to `kissSpot` (`step` px a tick), then standing
 * facing its friend in its idle frame, still through the lean (the lean itself is drawn by its owner, `leanShear`).
 * `room` is how far its left edge may go.
 */
export function kissWalk(
  current: WalkerState,
  phase: NonNullable<KissPhase>,
  input: { friendX: number; w: number; room: number; step: number; tieLeft: boolean },
): WalkerState {
  const { friendX, w, room, step, tieLeft } = input;
  const toward: 1 | -1 = sideOf(current.x, friendX, tieLeft) === -1 ? 1 : -1;
  const target = Math.min(Math.max(0, kissSpot(current.x, friendX, w, tieLeft)), Math.max(0, room));
  if (phase.stage === 'go' && Math.abs(target - current.x) >= 1) {
    const dir: 1 | -1 = target > current.x ? 1 : -1;
    const x = current.x + dir * Math.min(step, Math.abs(target - current.x));
    return { ...current, activity: 'walk', motion: 'walk', tick: current.motion === 'walk' ? current.tick + 1 : 0, x, target, dir };
  }
  const tick = phase.stage === 'go' && current.motion === 'idle' ? current.tick + 1 : 0;
  return { ...current, activity: 'idle', motion: 'idle', tick, left: Math.max(current.left, 30), target: current.x, dir: toward };
}

/** What it does once the kiss is over: the one on the left (its friend on its right) hops, the other cheers. */
export function kissAfter(toward: 1 | -1): MotionId {
  return toward === 1 ? 'hop' : 'cheer';
}

/**
 * The lean as a plain 2D shear of its own frame (a CSS `matrix(1, 0, c, 1, dx, 0)` about the middle of its box): the top
 * goes `lean` of its height toward its friend and the feet stay where they are. Whole steps, hard pixels, nothing drawn.
 */
export function leanShear(lean: number, toward: 1 | -1, h: number): { c: number; dx: number } {
  if (lean === 0) return { c: 0, dx: 0 };
  const c = Math.round(-toward * lean * 1000) / 1000;
  return { c, dx: Math.round((-c * h) / 2) };
}
