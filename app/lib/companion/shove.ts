import { SPLAT_SPEED, THROW_MAX, startThrow, type Thrown } from './throw';

/**
 * Shoved by windows (Luke, 2026-11-16: "the companion should interact with windows physically. If a window pops up on him or
 * moves across him, it pushes him in silly, fun ways, like a physics experiment").
 *
 * Each frame the companion's loop measures the windows on screen and asks here whether one has just hit it. A shove is a
 * throw started by a window, so everything a throw does follows: the flight, the smear, a splat against the edge of the
 * screen, the bounces, the dizzy landing (`./throw.ts`).
 *   - **pop**: a window that has just appeared over it knocks it out sideways, away from the window's middle, and up;
 *   - **push**: a window dragged into it sends it the way the window was going, harder the faster it went (a hard drag can
 *     splat it on the screen's edge);
 *   - **squash**: a window brought down onto its head presses it flat on its floor for a moment, and it squirts out sideways.
 * It can be hit again in the air, so a window can juggle it.
 *
 * Pure: boxes and numbers in, a shove out, ten frames a second, so `Temp/check-companion.cjs` can run it without a browser.
 * The dice are handed in. Speeds are pixels a frame, as the throw's are.
 */

export type ShoveKind = 'pop' | 'push' | 'squash';
export type Shove = { kind: ShoveKind; vx: number; vy: number };
export type Box = { left: number; top: number; right: number; bottom: number };

/** A window's box this frame and last (`before` undefined: it was not on screen last frame). */
export type WindowSeen = { id: string; now: Box; before: Box | undefined };

/** A window that has just appeared: how hard it knocks the figure sideways and up, from the softest to the hardest. */
export const POP_SIDE: readonly [number, number] = [30, 60];
export const POP_UP: readonly [number, number] = [45, 80];
/** A dragged window: moving less than this a frame it is only leaning, not hitting. */
export const PUSH_MIN = 4;
/** How much of the window's speed goes into the figure (more than all of it, so it flies off ahead of the window). */
export const PUSH_GAIN = 1.5;
/** A push lifts it too: at least this, and more the harder it is hit. */
export const PUSH_UP = 25;
export const PUSH_UP_GAIN = 0.4;
/** Squashed flat under a window brought down onto it: how long it stays flat, and how hard it squirts out. */
export const SQUASH_TICKS = 5;
export const SQUIRT_SIDE = 45;
export const SQUIRT_UP = 40;
/** Frames before the same window can hit it again. */
export const SHOVE_COOLDOWN = 3;
/** How far into its head a window's foot may already be and still count as coming down on it from above. */
const HEAD_ROOM = 6;

const overlaps = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const middle = (box: Box): number => (box.left + box.right) / 2;
const between = ([low, high]: readonly [number, number], dice: number): number => Math.round(low + (high - low) * dice);
const capped = (vx: number, vy: number): { vx: number; vy: number } => {
  const speed = Math.hypot(vx, vy);
  if (speed <= THROW_MAX) return { vx: Math.round(vx), vy: Math.round(vy) };
  return { vx: Math.round((vx * THROW_MAX) / speed), vy: Math.round((vy * THROW_MAX) / speed) };
};

/** Which way it goes out from under a window: away from the window's middle, or the dice's way when it is right in it. */
function awayFrom(window: Box, body: Box, dice: number): 1 | -1 {
  const gap = middle(body) - middle(window);
  if (Math.abs(gap) < 2) return dice < 0.5 ? -1 : 1;
  return gap > 0 ? 1 : -1;
}

/**
 * Whether this window hits the figure this frame, and how. `body` is the figure's picture as it stands; `dice` two numbers
 * in [0, 1).
 */
export function shoveFrom(seen: WindowSeen, body: Box, dice: readonly [number, number]): Shove | null {
  const { now, before } = seen;
  if (!overlaps(now, body)) return null;
  const out = awayFrom(now, body, dice[0]);
  // Just appeared over it (opened, or brought back from folded): knocked out sideways and up.
  if (before === undefined) return { kind: 'pop', ...capped(out * between(POP_SIDE, dice[1]), -between(POP_UP, dice[1])) };
  const dx = middle(now) - middle(before);
  const dy = now.top - before.top;
  if (Math.abs(dx) + Math.abs(dy) < PUSH_MIN) return null;
  // Brought down onto its head from above: flat, then it squirts out.
  if (dy >= PUSH_MIN && before.bottom <= body.top + HEAD_ROOM) return { kind: 'squash', vx: out * SQUIRT_SIDE, vy: -SQUIRT_UP };
  // Dragged into it: the way the window was going, ahead of it, and up.
  const vx = Math.abs(dx) >= PUSH_MIN ? dx * PUSH_GAIN : out * PUSH_MIN * PUSH_GAIN;
  const vy = -(PUSH_UP + Math.abs(vx) * PUSH_UP_GAIN) + Math.min(0, dy) * PUSH_GAIN;
  return { kind: 'push', ...capped(vx, vy) };
}

/**
 * Every window on screen this frame against the figure: the first that hits it, and the boxes to compare with next frame.
 * `cooling` counts down each window's frames before it can hit again; the windows that hit start theirs here.
 */
export function shoveStep(
  windows: readonly { id: string; box: Box }[],
  last: ReadonlyMap<string, Box>,
  cooling: ReadonlyMap<string, number>,
  body: Box,
  dice: readonly [number, number],
): { shove: Shove | null; seen: Map<string, Box>; cooling: Map<string, number> } {
  const seen = new Map<string, Box>();
  const nextCooling = new Map<string, number>();
  for (const [id, left] of cooling) if (left > 1) nextCooling.set(id, left - 1);
  let shove: Shove | null = null;
  for (const { id, box } of windows) {
    seen.set(id, box);
    if (shove !== null || nextCooling.has(id)) continue;
    const hit = shoveFrom({ id, now: box, before: last.get(id) }, body, dice);
    if (hit === null) continue;
    shove = hit;
    nextCooling.set(id, SHOVE_COOLDOWN);
  }
  return { shove, seen, cooling: nextCooling };
}

/**
 * The throw a shove starts, from where the figure is (`x` its left edge, `y` its feet). A hit has no wind-up: it is in the air
 * at once. A squash is a splat on its own floor (`stuck` against `floor`), drawn flat, which squirts it out when it peels off,
 * and it lands dizzy as after any splat. Already in the air (`thrown`), the window bats it the new way; one coming down onto it
 * up there swats it down.
 */
export function shoveThrow(x: number, y: number, shove: Shove, thrown: Thrown | null): Thrown {
  const flying = thrown !== null && thrown.stage !== 'landed';
  const vx = shove.vx;
  const vy = shove.kind === 'squash' && flying ? SQUIRT_UP : shove.vy;
  if (shove.kind === 'squash' && !flying) {
    return { x, y, vx: 0, vy: 0, stage: 'stuck', age: 0, span: SQUASH_TICKS, edge: 'floor', impact: SPLAT_SPEED, splatted: true, bounces: 0, fromX: x, fromY: y, squirt: { vx, vy } };
  }
  const base = flying ? thrown : startThrow(x, y, vx, vy);
  return { ...base, x, y, vx, vy, stage: 'fly', age: 0, span: 0, edge: null, impact: 0, fromX: x, fromY: y, squirt: undefined };
}
