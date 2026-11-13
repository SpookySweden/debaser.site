import type { CompanionMood } from './wire';

/**
 * What your companion decides to do next (SPEC-companion.md, decision 3). Pure: the clock, the pointer, the music and
 * the dice are handed in, so `Temp/check-companion.cjs` can walk it through a whole afternoon in a millisecond.
 *
 * In order of who wins:
 *   1. the pointer near the bottom strip: it chases it, and keeps after it a moment once it has gone;
 *   2. the music bar playing: it dances where it stands;
 *   3. nothing happening for a while: it sits down, then falls asleep (any move, key or scroll wakes it);
 *   4. otherwise it wanders: walks somewhere, stands about, or sits a while.
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
};

/** Nothing happening this long: it sits down. */
export const SIT_AFTER_MS = 30_000;
/** ...and this long: it falls asleep. */
export const SLEEP_AFTER_MS = 60_000;
/** How long it keeps after the pointer once it has left the strip. */
export const CHASE_LINGER_MS = 1_500;

export function startBrain(now: number): BrainState {
  return { mood: 'stand', target: null, until: now + 2_000, chaseUntil: 0 };
}

function clamp(x: number, span: Span): number {
  return Math.round(Math.min(span.right, Math.max(span.left, x)));
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

export function think(state: BrainState, input: BrainInput): BrainState {
  const { now, span } = input;

  if (input.pointerX !== null) {
    return { mood: 'chase', target: clamp(input.pointerX, span), until: now, chaseUntil: now + CHASE_LINGER_MS };
  }
  if (state.mood === 'chase' && now < state.chaseUntil) {
    return { ...state, target: state.target === null ? null : clamp(state.target, span) };
  }

  if (input.musicPlaying) {
    return state.mood === 'dance' ? state : { mood: 'dance', target: null, until: now, chaseUntil: 0 };
  }

  const quiet = now - input.lastActivity;
  if (quiet >= SLEEP_AFTER_MS) return state.mood === 'sleep' ? state : { mood: 'sleep', target: null, until: now, chaseUntil: 0 };
  if (quiet >= SIT_AFTER_MS) return state.mood === 'sit' ? state : { mood: 'sit', target: null, until: now, chaseUntil: 0 };

  // Back from a dance, a chase or a nap: stand a moment before wandering again.
  if (state.mood === 'dance' || state.mood === 'chase' || state.mood === 'sleep') {
    return { mood: 'stand', target: null, until: now + 1_500, chaseUntil: 0 };
  }

  const arrived = state.mood === 'walk' && state.target !== null && Math.abs(input.x - state.target) < 1;
  if (state.mood === 'walk' && !arrived && now < state.until) return { ...state, target: clamp(state.target ?? input.x, span) };
  if (state.mood !== 'walk' && now < state.until) return state;

  const roll = input.random();
  if (roll < 0.55 && span.right - span.left > 8) {
    const target = clamp(between(input.random, span.left, span.right), span);
    // A walk gives up after a while, so a stretch that shrank under it cannot hold it walking forever.
    return { mood: 'walk', target, until: now + 20_000, chaseUntil: 0 };
  }
  if (roll < 0.7) return { mood: 'sit', target: null, until: now + between(input.random, 6_000, 12_000), chaseUntil: 0 };
  return { mood: 'stand', target: null, until: now + between(input.random, 3_000, 8_000), chaseUntil: 0 };
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
