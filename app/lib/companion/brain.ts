import type { MotionId } from '../character/motion';
import type { CompanionMood } from './wire';

/**
 * What your companion decides to do next (SPEC-companion.md, decision 3). Pure: the clock, the pointer, the music and
 * the dice are handed in, so `Temp/check-companion.cjs` can walk it through a whole afternoon in a millisecond.
 *
 * In order of who wins:
 *   1. the pointer near the bottom strip: it runs after it, and keeps after it a moment once it has gone;
 *   2. the music bar playing: it dances where it stands;
 *      (2026-11-14: joining in comes either side of the music: typing along, watching your game and reading along
 *      before it, watching a video after it);
 *   3. nothing happening for a while: it sits down, falls asleep, and after a long while curls right up (any move, key
 *      or scroll wakes it); in the small hours of your own clock it nods off sooner;
 *   4. otherwise it wanders: walks somewhere, stands about, sits a while, and now and then gets bored (Luke,
 *      2026-11-14): a stretch, a spin on the spot, or a burst of running back and forth.
 */

/** A stretch of the strip it may stand on, in screen pixels, for the companion's left edge. */
export type Span = { left: number; right: number };

export type BrainState = {
  mood: CompanionMood;
  /** Where its left edge is headed, for `walk` and `chase`. */
  target: number | null;
  /** When the wander picks again. */
  until: number;
  /** When the chase gives up, once the pointer has left the strip. */
  chaseUntil: number;
  /** A loop it plays in place of the mood's own: a run, a deep sleep's curl. Null is the mood's own. */
  pose: MotionId | null;
  /** A one-off it wants played now (a stretch, a spin): set only in the one thought that decides it, for the figure to play once. */
  act: MotionId | null;
  /** Runs left of a burst of running back and forth, and the spot it runs about. */
  laps: number;
  home: number;
};

export type BrainInput = {
  now: number;
  /** The last pointer move, key or scroll anywhere on the page. */
  lastActivity: number;
  musicPlaying: boolean;
  /** The pointer's x (already set so the figure's middle comes under it) while it is near the strip, else null. */
  pointerX: number | null;
  /** Where it stands now. */
  x: number;
  /** The free stretch it stands in: it never walks past either end. */
  span: Span;
  random: () => number;
  /** The hour on the reader's own clock, 0 to 23. Missing: daytime. */
  hour?: number;
  /** What the reader is doing that it can join in with (`scene.ts`, and typing, which it hears itself). Missing: nothing. */
  scene?: BrainScene | null;
};

/** What it joins in with: typing along, watching a game, reading along, watching a video. */
export type BrainScene = 'type' | 'game' | 'read' | 'watch';

/** Nothing happening this long: it sits down. */
export const SIT_AFTER_MS = 30_000;
/** ...and this long: it falls asleep. */
export const SLEEP_AFTER_MS = 60_000;
/** ...and this long: it curls right up, and is glad to see you back. */
export const CURL_AFTER_MS = 300_000;
/** From midnight until this hour it is sleepy: it sits and sleeps in two thirds of the time. */
export const NIGHT_UNTIL_HOUR = 5;
export const NIGHT_SHARE = 2 / 3;
/** How long it keeps after the pointer once it has left the strip. */
export const CHASE_LINGER_MS = 1_500;
/** A burst of running: this many runs, each this far, about where it stood. */
export const ZOOM_LAPS = 4;
export const ZOOM_REACH = 110;

const REST = { pose: null, act: null, laps: 0, home: 0 } as const;

export function startBrain(now: number): BrainState {
  return { mood: 'stand', target: null, until: now + 2_000, chaseUntil: 0, ...REST };
}

function clamp(x: number, span: Span): number {
  return Math.round(Math.min(span.right, Math.max(span.left, x)));
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

/** Whether the reader's clock says the small hours. */
export function isNight(hour: number | undefined): boolean {
  return hour !== undefined && hour >= 0 && hour < NIGHT_UNTIL_HOUR;
}

export function think(state: BrainState, input: BrainInput): BrainState {
  const { now, span } = input;

  if (input.pointerX !== null) {
    return { mood: 'chase', target: clamp(input.pointerX, span), until: now, chaseUntil: now + CHASE_LINGER_MS, ...REST, pose: 'run' };
  }
  if (state.mood === 'chase' && now < state.chaseUntil) {
    return { ...state, target: state.target === null ? null : clamp(state.target, span) };
  }

  const quiet = now - input.lastActivity;
  // Joining in with what the reader is doing (Luke, 2026-11-14), where it stands. Typing, a game and a book come before
  // the music; a video comes after it (a video left up while music plays is not being watched).
  const settle = (mood: CompanionMood, pose: MotionId | null): BrainState =>
    state.mood === mood && state.pose === pose ? state : { mood, target: null, until: now, chaseUntil: 0, ...REST, pose };
  if (input.scene === 'type') return settle('stand', 'type');
  if (input.scene === 'game') return settle('sit', 'watch');
  // Reading along, until the page has not turned (nor anything else happened) for so long that it has dozed off over the book.
  if (input.scene === 'read') return quiet >= CURL_AFTER_MS ? settle('sleep', null) : settle('sit', 'read');

  if (input.musicPlaying) {
    return state.mood === 'dance' ? state : { mood: 'dance', target: null, until: now, chaseUntil: 0, ...REST };
  }

  // A video playing is watched to the end: nothing happening on the page is what watching looks like.
  if (input.scene === 'watch') return settle('sit', 'watch');

  const share = isNight(input.hour) ? NIGHT_SHARE : 1;
  if (quiet >= CURL_AFTER_MS) {
    return state.mood === 'sleep' && state.pose === 'curl' ? state : { mood: 'sleep', target: null, until: now, chaseUntil: 0, ...REST, pose: 'curl' };
  }
  if (quiet >= SLEEP_AFTER_MS * share) return state.mood === 'sleep' ? state : { mood: 'sleep', target: null, until: now, chaseUntil: 0, ...REST };
  // A plain sit: one left over from reading or watching (its pose still on) is settled again.
  if (quiet >= SIT_AFTER_MS * share) return state.mood === 'sit' && state.pose === null ? state : { mood: 'sit', target: null, until: now, chaseUntil: 0, ...REST };

  // Back from a dance, a chase or a nap: stand a moment before wandering again.
  if (state.mood === 'dance' || state.mood === 'chase' || state.mood === 'sleep') {
    return { mood: 'stand', target: null, until: now + 1_500, chaseUntil: 0, ...REST };
  }

  const arrived = state.mood === 'walk' && state.target !== null && Math.abs(input.x - state.target) < 1;
  if (state.mood === 'walk' && !arrived && now < state.until) return { ...state, target: clamp(state.target ?? input.x, span) };
  // A burst of running: there, and back, and there again.
  if (state.mood === 'walk' && arrived && state.laps > 0) {
    const side = state.laps % 2 === 1 ? -1 : 1;
    return { ...state, target: clamp(state.home + side * ZOOM_REACH, span), until: now + 6_000, laps: state.laps - 1 };
  }
  if (state.mood !== 'walk' && now < state.until) return state.act === null ? state : { ...state, act: null };

  const roll = input.random();
  const width = span.right - span.left;
  if (roll < 0.5 && width > 8) {
    const target = clamp(between(input.random, span.left, span.right), span);
    // A walk gives up after a while, so a stretch that shrank under it cannot hold it walking forever.
    return { mood: 'walk', target, until: now + 20_000, chaseUntil: 0, ...REST };
  }
  if (roll < 0.63) return { mood: 'sit', target: null, until: now + between(input.random, 6_000, 12_000), chaseUntil: 0, ...REST };
  if (roll < 0.85) return { mood: 'stand', target: null, until: now + between(input.random, 3_000, 8_000), chaseUntil: 0, ...REST };
  // Bored: a stretch, a spin, or (with room for it) a run about.
  if (roll < 0.91) return { mood: 'stand', target: null, until: now + 3_000, chaseUntil: 0, ...REST, act: 'stretch' };
  if (roll < 0.96 || width < ZOOM_REACH * 2) return { mood: 'stand', target: null, until: now + 2_500, chaseUntil: 0, ...REST, act: 'dance4' };
  const home = clamp(input.x, { left: span.left + ZOOM_REACH, right: span.right - ZOOM_REACH });
  return { mood: 'walk', target: clamp(home + ZOOM_REACH, span), until: now + 6_000, chaseUntil: 0, pose: 'run', act: null, laps: ZOOM_LAPS - 1, home };
}

/**
 * The free stretches of the strip: the whole width less whatever sits on it (the folded player, the floating
 * video, the stream's TV box), each widened by `gap`. `width` is the figure's own, so a stretch narrower than it
 * is no stretch. Returned for the figure's left edge, left to right.
 */
export function freeSpans(screen: number, blocks: readonly Span[], width: number, gap: number): Span[] {
  const sorted = [...blocks].map((b) => ({ left: b.left - gap, right: b.right + gap })).sort((a, b) => a.left - b.left);
  const spans: Span[] = [];
  let from = 0;
  for (const block of sorted) {
    if (block.left - from >= width) spans.push({ left: from, right: block.left - width });
    from = Math.max(from, block.right);
  }
  if (screen - from >= width) spans.push({ left: from, right: screen - width });
  return spans;
}

/** The stretch holding `x`, or else the nearest one (the companion steps over to it); null when there is none. */
export function spanFor(spans: readonly Span[], x: number): Span | null {
  let best: Span | null = null;
  let distance = Infinity;
  for (const span of spans) {
    const d = x < span.left ? span.left - x : x > span.right ? x - span.right : 0;
    if (d < distance) {
      distance = d;
      best = span;
    }
  }
  return best;
}

/* --- being picked up and dropped (Luke, 2026-11-14) ------------------------------------------------------------- */

/** How fast it falls: it gains this much a frame, up to the most, in whole pixels. */
export const FALL_GAIN = 6;
export const FALL_MAX = 42;
/** The most it carries sideways from a throw, a frame, and how much of that is left each frame after. */
export const THROW_MAX = 30;
export const THROW_KEEP = 0.8;

export type Fall = { x: number; y: number; vx: number; vy: number; landed: boolean };

/**
 * One frame of a fall from where it was let go: down faster each frame until its feet are on `floor`, drifting on with
 * whatever sideways throw it was given, never off either side of the screen (`right` is as far as its left edge may go).
 * Stepped, like everything else: whole pixels, ten frames a second.
 */
export function fallStep(fall: Fall, floor: number, right: number): Fall {
  const vy = Math.min(FALL_MAX, fall.vy + FALL_GAIN);
  const y = Math.min(floor, fall.y + vy);
  const x = Math.round(Math.min(Math.max(0, right), Math.max(0, fall.x + fall.vx)));
  const vx = Math.trunc(fall.vx * THROW_KEEP);
  return { x, y, vx, vy, landed: y >= floor };
}

/** The sideways throw a let-go gives, from how far the pointer moved over the last frame. */
export function throwOf(dx: number): number {
  return Math.round(Math.max(-THROW_MAX, Math.min(THROW_MAX, dx)));
}
