/**
 * The profile character's two decisions, kept pure so a check can hold them in Node (SPEC-profile-characters.md):
 *
 *   1. **Where it may walk** (`findLanes`): the empty strips of a page, measured from the boxes of what is on it - text,
 *      pictures, keys, fields - never guessed. A lane is a floor line with nothing above it for the character's height,
 *      and the character keeps its whole box inside one, so it never covers text or a key and never sits on a click.
 *   2. **What it does next** (`nextActivity`, `stepWalker`): stroll, stop, idle, dance; more of one or another by mood;
 *      dancing while the profile's track plays; a wave, hop or turn when clicked.
 *
 * Both are worked in CSS pixels relative to the page area the character lives in.
 */
import { DANCES, type MotionId } from './motion';
import type { Mood } from './sheet';

export type Box = { left: number; top: number; right: number; bottom: number };

/** A floor line the character can stand on: `floor` is the y its feet are at, and it may be anywhere from `from` to `to`
 * (its box's left and right edges). */
export type Lane = { floor: number; from: number; to: number };

/** The grid the free space is worked in, in CSS pixels. */
export const LANE_STEP = 4;
/** Kept clear round anything on the page, so the character never brushes text. */
export const LANE_MARGIN = 4;

/**
 * The lanes in an area `width` x `height` with `obstacles` in it, for a character `w` x `h` (its box from the top of its
 * cell to its feet). Each lane is the lowest floor of a free run, so a character stands on something - the bottom of a
 * gap, the foot of the page - rather than floating in the middle of an empty patch. Longest first.
 */
export function findLanes(width: number, height: number, obstacles: readonly Box[], w: number, h: number): Lane[] {
  const cols = Math.max(0, Math.floor(width / LANE_STEP));
  const rows = Math.max(0, Math.floor(height / LANE_STEP));
  const needCols = Math.ceil(w / LANE_STEP);
  const needRows = Math.ceil(h / LANE_STEP);
  if (cols < needCols || rows < needRows) return [];

  const taken = new Uint8Array(cols * rows);
  for (const box of obstacles) {
    const c0 = Math.max(0, Math.floor((box.left - LANE_MARGIN) / LANE_STEP));
    const c1 = Math.min(cols - 1, Math.ceil((box.right + LANE_MARGIN) / LANE_STEP) - 1);
    const r0 = Math.max(0, Math.floor((box.top - LANE_MARGIN) / LANE_STEP));
    const r1 = Math.min(rows - 1, Math.ceil((box.bottom + LANE_MARGIN) / LANE_STEP) - 1);
    for (let r = r0; r <= r1; r += 1) taken.fill(1, r * cols + c0, r * cols + c1 + 1);
  }

  // How many free cells end at each row, per column.
  const run = new Uint16Array(cols);
  const lanes: Lane[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) run[c] = taken[r * cols + c] === 1 ? 0 : run[c] + 1;
    let start = -1;
    for (let c = 0; c <= cols; c += 1) {
      const fits = c < cols && run[c] >= needRows;
      if (fits && start < 0) start = c;
      if (!fits && start >= 0) {
        if (c - start >= needCols && standsHere(taken, cols, rows, r, start, c)) {
          lanes.push({ floor: (r + 1) * LANE_STEP, from: start * LANE_STEP, to: c * LANE_STEP });
        }
        start = -1;
      }
    }
  }
  return lanes.sort((a, b) => b.to - b.from - (a.to - a.from) || b.floor - a.floor);
}

/** A run is a floor when most of the row under it is taken, or it is the bottom of the area. */
function standsHere(taken: Uint8Array, cols: number, rows: number, r: number, from: number, to: number): boolean {
  if (r === rows - 1) return true;
  let below = 0;
  for (let c = from; c < to; c += 1) below += taken[(r + 1) * cols + c];
  return below * 2 >= to - from;
}

/** True when `box` crosses any of `obstacles`: what the browser drive checks every tick. */
export function overlapsAny(box: Box, obstacles: readonly Box[]): boolean {
  return obstacles.some((o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top);
}

// ---------------------------------------------------------------------------------------------------------------------
// What it does.
// ---------------------------------------------------------------------------------------------------------------------

export type Activity = 'idle' | 'walk' | 'dance';

/** How often each mood picks each activity (out of 100). CALM mostly idles, BUSY walks, PARTY dances. */
export const MOOD_WEIGHTS: Record<Mood, Record<Activity, number>> = {
  calm: { idle: 70, walk: 25, dance: 5 },
  busy: { idle: 20, walk: 75, dance: 5 },
  party: { idle: 15, walk: 25, dance: 60 },
};

/** How long an idle or a dance lasts, in ticks (10 a second). */
export const IDLE_TICKS: readonly [number, number] = [30, 70];
export const DANCE_TICKS: readonly [number, number] = [40, 90];
/** How far it walks each tick, in blocks of its own picture: stepped, a block at a time. */
export const WALK_BLOCKS_PER_TICK = 1;

/** The clicked reactions, in turn. */
export const REACTIONS: readonly MotionId[] = ['wave', 'hop', 'turn'];

export type WalkerState = {
  activity: Activity | 'react';
  motion: MotionId;
  /** Ticks into the motion. */
  tick: number;
  /** Ticks left of an idle or a dance; for a walk, unused. */
  left: number;
  /** The box's left edge within the lane, in CSS pixels. */
  x: number;
  /** Where a walk is heading. */
  target: number;
  /** +1 facing right, -1 left. */
  dir: 1 | -1;
  /** Which reaction the next click gets. */
  nextReaction: number;
};

export function startWalker(laneLength: number, random: () => number): WalkerState {
  return {
    activity: 'idle',
    motion: 'idle',
    tick: 0,
    left: IDLE_TICKS[0],
    x: Math.round(random() * Math.max(0, laneLength)),
    target: 0,
    dir: random() < 0.5 ? 1 : -1,
    nextReaction: 0,
  };
}

const between = (range: readonly [number, number], random: () => number) => Math.round(range[0] + random() * (range[1] - range[0]));

/** The next thing to do, by mood. `room` is how far the box may move along its lane. */
export function nextActivity(state: WalkerState, mood: Mood, room: number, random: () => number): WalkerState {
  const weights = MOOD_WEIGHTS[mood];
  const roll = random() * (weights.idle + weights.walk + weights.dance);
  const activity: Activity = roll < weights.idle ? 'idle' : roll < weights.idle + weights.walk ? 'walk' : 'dance';
  if (activity === 'walk' && room > 0) {
    let target = Math.round(random() * room);
    // A walk worth seeing: at least a fifth of the lane, or turn and go the other way.
    if (Math.abs(target - state.x) < room / 5) target = state.x < room / 2 ? room : 0;
    return { ...state, activity, motion: 'walk', tick: 0, target, dir: target >= state.x ? 1 : -1 };
  }
  if (activity === 'dance') {
    return { ...state, activity, motion: DANCES[Math.floor(random() * DANCES.length)], tick: 0, left: between(DANCE_TICKS, random) };
  }
  return { ...state, activity: 'idle', motion: 'idle', tick: 0, left: between(IDLE_TICKS, random) };
}

/**
 * One tick. `ticksOf` says how many ticks a motion lasts; `step` is how far a walking tick moves, in CSS pixels; `room` how
 * far the box may go along its lane. While `music` is on it dances in place, changing dance now and then.
 */
export function stepWalker(
  state: WalkerState,
  input: { mood: Mood; music: boolean; room: number; step: number; ticksOf: (motion: MotionId) => number; random: () => number },
): WalkerState {
  const { mood, music, room, step, ticksOf, random } = input;
  const x = Math.min(Math.max(0, state.x), Math.max(0, room));
  const tick = state.tick + 1;

  if (state.activity === 'react') {
    if (tick < ticksOf(state.motion)) return { ...state, x, tick };
    return nextActivity({ ...state, x }, mood, room, random);
  }

  if (music) {
    if (state.activity === 'dance' && state.left > 0) return { ...state, x, tick, left: state.left - 1 };
    return { ...state, x, activity: 'dance', motion: DANCES[Math.floor(random() * DANCES.length)], tick: 0, left: between(DANCE_TICKS, random) };
  }

  if (state.activity === 'walk') {
    const target = Math.min(Math.max(0, state.target), Math.max(0, room));
    if (x === target) return nextActivity({ ...state, x }, mood, room, random);
    const moved = state.dir > 0 ? Math.min(target, x + step) : Math.max(target, x - step);
    return { ...state, x: moved, target, tick };
  }

  if (state.left > 0) return { ...state, x, tick, left: state.left - 1 };
  return nextActivity({ ...state, x }, mood, room, random);
}

/** A click: the next reaction in turn, from its first tick. */
export function react(state: WalkerState): WalkerState {
  return { ...state, activity: 'react', motion: REACTIONS[state.nextReaction % REACTIONS.length], tick: 0, nextReaction: state.nextReaction + 1 };
}
