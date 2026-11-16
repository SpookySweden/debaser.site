import { spanFor, type Span } from './brain';

/**
 * Thrown (Luke, 2026-11-14: "when picking up and throwing the companion around i want him to retain momentum and splat
 * against the edge of the screen and obey the principles of animation such as squash and stretch and wind up and
 * smearing").
 *
 * Let go of while the pointer is moving, it keeps that speed: a beat of wind-up (pulled back against the throw, pressed
 * short), then it flies under gravity with a little drag, stretched along its path with a smear of itself behind it. An
 * edge of the screen hit hard is a splat: flat against it for a beat, then it peels off and drops. Hit softly it bounces.
 * It bounces off its floor, squashed on each landing, skids if it comes in low, and settles.
 *
 * Pure: every frame is worked out here from the last, in whole pixels, ten frames a second (the site's stepped look), so
 * `Temp/check-companion.cjs` can throw it a thousand times without a browser. Nothing here draws: the look is numbers
 * (a stretch, a nudge, where the smear's copies sit) that `Companion.tsx` puts on the figure's own baked frame.
 *
 * Speeds are pixels a frame. `x` is the figure's left edge and `y` its feet, from the top of the screen.
 */

/** Let go slower than this and it is put down, not thrown: it drops as it always did (`fallStep`). */
export const THROW_MIN = 15;
/** The fastest a throw may be. */
export const THROW_MAX = 180;
/** What it gains downward each frame, and the most it may fall at. */
export const GRAVITY = 8;
export const FALL_LIMIT = 140;
/** The share of its speed the air leaves it each frame. */
export const DRAG = 0.97;
/** Into a side or the top of the screen at this speed or more: a splat. Slower, it bounces off. */
export const SPLAT_SPEED = 60;
/** The share of its speed a bounce gives back: off a side or the top, and off the floor. */
export const WALL_BOUNCE = 0.5;
export const FLOOR_BOUNCE = 0.4;
/** The share of its sideways speed a bounce on the floor leaves it. */
export const FLOOR_GRIP = 0.7;
/** Onto the floor slower than this it stays down. */
export const BOUNCE_MIN = 18;
/** Down on the floor but still going sideways this fast, it skids, keeping this share a frame. */
export const SKID_MIN = 10;
export const SKID_KEEP = 0.6;
/** The wind-up: frames held where it was let go, pulled back, before it flies. */
export const WIND_TICKS = 2;
/** How long a splat sticks, in frames, from the gentlest to the hardest; it starts slipping after `STUCK_HOLD`. */
export const STUCK_TICKS: readonly [number, number] = [6, 12];
export const STUCK_HOLD = 3;
export const STUCK_SLIDE = 2;
/** Peeling off: frames, how far it slips each, and the push away from the side it was stuck to. */
export const PEEL_TICKS = 3;
export const PEEL_SLIDE = 4;
export const PEEL_KICK = 4;
/** Down on something it cannot stand on, further than this from where it can: it hops off toward it, at least this hard. */
export const STEP_OVER = 24;
export const HOP_OFF_UP = 30;
export const HOP_OFF_MOST = 6;
/** The flattest a squash goes, and the longest a stretch. */
export const SQUASH_MIN = 0.5;
export const STRETCH_MAX = 1.5;
/** Flying this fast or faster, copies of itself trail behind it. */
export const SMEAR_SPEED = 40;

export type Edge = 'left' | 'right' | 'top' | 'floor';

/** Winding up, in the air (or skidding), stuck to an edge, peeling off it, down. */
export type ThrowStage = 'wind' | 'fly' | 'stuck' | 'peel' | 'landed';

export type Thrown = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stage: ThrowStage;
  /** Frames into this stage, and how many it lasts (wind, stuck, peel). */
  age: number;
  span: number;
  /** The edge it hit this frame, or is stuck to. */
  edge: Edge | null;
  /** How fast it went into that edge: on the frame of a bounce, all through a splat, and at the landing. */
  impact: number;
  /** It has splatted on this throw: it lands dizzy. */
  splatted: boolean;
  bounces: number;
  /** Where it was a frame ago: the smear lies back along that line. */
  fromX: number;
  fromY: number;
  /** Pressed flat on its floor under a window (`./shove.ts`): the way it squirts out when it peels off. */
  squirt?: { vx: number; vy: number };
};

/**
 * Where it may be: `left` and `right` for its left edge, `ceiling` the highest its feet may be (its head at the top of the
 * screen), `floor` the line it stands on. `spans` are the stretches of that floor it can stand on (missing: all of it).
 */
export type Arena = { left: number; right: number; ceiling: number; floor: number; spans?: readonly Span[] };

/** A pointer seen at a moment, in screen pixels and milliseconds. */
export type Sample = { x: number; y: number; t: number };

/** The moves a let-go is judged from: those in this last while. A pointer that stopped this long ago was at rest. */
export const SAMPLE_WINDOW_MS = 100;
export const SAMPLE_FRESH_MS = 60;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(low, high), Math.max(low, value));

/**
 * How fast the pointer was going when it let go, in pixels a frame (`frameMs` long): across the moves of the last tenth of
 * a second. Nothing when it had stopped first (a throw is let go on the move). Never faster than `THROW_MAX`.
 */
export function releaseVelocity(samples: readonly Sample[], now: number, frameMs = 100): { vx: number; vy: number } {
  const recent = samples.filter((sample) => now - sample.t <= SAMPLE_WINDOW_MS && sample.t <= now);
  const last = recent[recent.length - 1];
  const first = recent[0];
  if (recent.length < 2 || last === undefined || first === undefined || now - last.t > SAMPLE_FRESH_MS) return { vx: 0, vy: 0 };
  // Two moves a hair apart (a burst from the browser) are not a speed to trust: never judged over less than a screen frame.
  const over = Math.max(16, last.t - first.t);
  let vx = ((last.x - first.x) / over) * frameMs;
  let vy = ((last.y - first.y) / over) * frameMs;
  const speed = Math.hypot(vx, vy);
  if (speed > THROW_MAX) {
    vx *= THROW_MAX / speed;
    vy *= THROW_MAX / speed;
  }
  return { vx: Math.round(vx), vy: Math.round(vy) };
}

/** Whether a let-go at this speed is a throw. */
export function isThrow(vx: number, vy: number): boolean {
  return Math.hypot(vx, vy) >= THROW_MIN;
}

export function startThrow(x: number, y: number, vx: number, vy: number): Thrown {
  return { x, y, vx, vy, stage: 'wind', age: 0, span: WIND_TICKS, edge: null, impact: 0, splatted: false, bounces: 0, fromX: x, fromY: y };
}

/** How long a splat at this speed sticks. */
export function stuckTicks(impact: number): number {
  const share = clamp((impact - SPLAT_SPEED) / (THROW_MAX - SPLAT_SPEED), 0, 1);
  return Math.round(STUCK_TICKS[0] + (STUCK_TICKS[1] - STUCK_TICKS[0]) * share);
}

/** How far from somewhere it can stand: 0 on a free stretch, else the way to the nearest (signed). */
function wayToStand(arena: Arena, x: number): number {
  if (arena.spans === undefined) return 0;
  const span = spanFor(arena.spans, x);
  if (span === null) return 0;
  return x < span.left ? span.left - x : x > span.right ? span.right - x : 0;
}

/** One frame of a throw. */
export function throwStep(now: Thrown, arena: Arena): Thrown {
  if (now.stage === 'landed') return now;
  const from = { fromX: now.x, fromY: now.y };
  if (now.stage === 'wind' && now.age + 1 < now.span) return { ...now, ...from, age: now.age + 1 };
  if (now.stage === 'stuck') {
    // Stuck fast for a moment, then slipping down the glass (not along the top: there it only hangs).
    if (now.age + 1 < now.span) {
      const slide = now.edge !== 'top' && now.age + 1 >= STUCK_HOLD ? STUCK_SLIDE : 0;
      return { ...now, ...from, age: now.age + 1, y: Math.min(Math.max(arena.floor, now.y), now.y + slide) };
    }
    return { ...now, ...from, stage: 'peel', age: 0, span: PEEL_TICKS };
  }
  if (now.stage === 'peel') {
    if (now.age + 1 < now.span) {
      const slide = now.edge === 'top' ? 0 : PEEL_SLIDE;
      return { ...now, ...from, age: now.age + 1, y: Math.min(Math.max(arena.floor, now.y), now.y + slide) };
    }
    // Flat on the floor under a window: it squirts out sideways.
    if (now.edge === 'floor' && now.squirt !== undefined) return fly({ ...now, vx: now.squirt.vx, vy: now.squirt.vy, squirt: undefined }, arena);
    // Off it comes, pushed a little away from the side it was on, and falls.
    const kick = now.edge === 'left' ? PEEL_KICK : now.edge === 'right' ? -PEEL_KICK : 0;
    return fly({ ...now, vx: kick, vy: 0 }, arena);
  }
  return fly(now, arena);
}

/** A frame in the air, or skidding along the floor. */
function fly(now: Thrown, arena: Arena): Thrown {
  // Down on the floor already and not on its way up: it skids, losing speed fast.
  const grounded = now.y >= arena.floor && now.vy >= 0;
  const vx = now.vx * (grounded ? SKID_KEEP : DRAG);
  const vy = grounded ? 0 : Math.min(FALL_LIMIT, now.vy * DRAG + GRAVITY);

  // (A floor right at the top of the screen, a room's window with no room over it: the top is never lower than the floor.)
  const ceiling = Math.min(arena.ceiling, arena.floor);
  // The first edge its path crosses this frame, and how far along the frame that is.
  let part = 1;
  let edge: Edge | null = null;
  const meets = (hit: boolean, at: number, which: Edge) => {
    if (!hit) return;
    const share = clamp(at, 0, 1);
    if (edge === null || share < part) {
      part = share;
      edge = which;
    }
  };
  meets(vx < 0 && now.x + vx <= arena.left, (arena.left - now.x) / vx, 'left');
  meets(vx > 0 && now.x + vx >= arena.right, (arena.right - now.x) / vx, 'right');
  meets(vy < 0 && now.y + vy <= ceiling, (ceiling - now.y) / vy, 'top');
  meets(!grounded && vy > 0 && now.y + vy >= arena.floor, (arena.floor - now.y) / vy, 'floor');
  const hit = edge as Edge | null;

  const x = Math.round(clamp(now.x + vx * part, arena.left, arena.right));
  const y = grounded ? arena.floor : Math.round(clamp(now.y + vy * part, ceiling, arena.floor));
  const next: Thrown = { ...now, x, y, vx, vy, stage: 'fly', age: now.stage === 'fly' ? now.age + 1 : 0, span: 0, edge: null, impact: 0, fromX: now.x, fromY: now.y };

  if (hit === 'left' || hit === 'right' || hit === 'top') {
    const impact = Math.abs(hit === 'top' ? vy : vx);
    // Hard into the glass: stuck to it, flat.
    if (impact >= SPLAT_SPEED) return { ...next, vx: 0, vy: 0, stage: 'stuck', age: 0, span: stuckTicks(impact), edge: hit, impact, splatted: true };
    return hit === 'top' ? { ...next, vy: -vy * WALL_BOUNCE, edge: hit, impact } : { ...next, vx: -vx * WALL_BOUNCE, edge: hit, impact };
  }
  if (hit !== 'floor' && !grounded) return next;

  // On the floor: this frame it came down onto it, or it was skidding along it.
  const impact = grounded ? 0 : vy;
  const way = wayToStand(arena, x);
  if (Math.abs(way) > STEP_OVER && now.bounces < HOP_OFF_MOST) {
    // Down on something it cannot stand on (the folded player, a floating video): it hops off toward where it can.
    const up = Math.max(impact * FLOOR_BOUNCE, HOP_OFF_UP);
    const frames = (2 * up) / GRAVITY;
    return { ...next, vx: (way + Math.sign(way) * (STEP_OVER / 2)) / frames, vy: -up, edge: 'floor', impact, bounces: now.bounces + 1 };
  }
  if (impact >= BOUNCE_MIN) return { ...next, vx: vx * FLOOR_GRIP, vy: -impact * FLOOR_BOUNCE, edge: 'floor', impact, bounces: now.bounces + 1 };
  // Too slow to bounce, still going sideways: it skids on next frame. Otherwise it is down.
  if (Math.abs(vx) >= SKID_MIN) return { ...next, vy: 0, edge: 'floor', impact };
  return { ...next, vx: 0, vy: 0, stage: 'landed', edge: 'floor', impact };
}

/* --- the look: squash, stretch, the wind-up's pull, the smear ---------------------------------------------------- */

/**
 * How short a hit at this speed presses it, along the way it was going: 1 untouched, down to `SQUASH_MIN`. The harder,
 * the flatter.
 */
export function squashFor(impact: number): number {
  return Math.round(clamp(1 - Math.max(0, impact) / 160, SQUASH_MIN, 1) * 100) / 100;
}

/** How long it is drawn out along its path at this speed: 1 at rest, up to `STRETCH_MAX`. */
export function stretchFor(speed: number): number {
  return Math.round(clamp(1 + (Math.max(0, speed) - THROW_MIN) / 250, 1, STRETCH_MAX) * 100) / 100;
}

/**
 * What a squash or stretch of `along` does across it, so there is as much of it as before: pressed to half its length it
 * spreads by the square root of two each other way (length x width x depth stays 1).
 */
export function acrossFor(along: number): number {
  return 1 / Math.sqrt(along);
}

/** A whole number of pixels, and never a minus nought. */
const whole = (value: number): number => Math.round(value) || 0;

/** The figure's box in screen pixels, and how much empty margin its picture leaves inside it on three sides. */
export type ThrowBox = { w: number; h: number; left?: number; right?: number; top?: number };

/**
 * What to do to its drawn frame: a 2x2 stretch about the middle of its box (as a CSS `matrix(a, b, c, d, 0, 0)`), a nudge
 * in whole pixels, and where the smear's copies sit (nudges from its own place, nearest first).
 */
export type ThrowLook = { a: number; b: number; c: number; d: number; dx: number; dy: number; ghosts: { dx: number; dy: number }[] };

export const NO_LOOK: ThrowLook = { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0, ghosts: [] };

/** Stretched (or pressed) by `along` on the line it travels, and by `acrossFor` the other way. Symmetric, so it never turns. */
export function stretchAlong(vx: number, vy: number, along: number): { a: number; b: number; c: number; d: number } {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-6 || along === 1) return { a: 1, b: 0, c: 0, d: 1 };
  const ux = vx / speed;
  const uy = vy / speed;
  const across = acrossFor(along);
  return { a: along * ux * ux + across * uy * uy, b: (along - across) * ux * uy, c: (along - across) * ux * uy, d: along * uy * uy + across * ux * ux };
}

/**
 * Pressed against an edge to `along` of its size (more than 1: drawn out from it), the side that touches staying where it
 * is. The picture's own margin is allowed for, so it is the figure that stays on the glass, not the empty edge of its box.
 */
export function squashLook(edge: Edge, along: number, box: ThrowBox): ThrowLook {
  const across = acrossFor(along);
  const give = 1 - along;
  if (edge === 'left') return { a: along, b: 0, c: 0, d: across, dx: whole(-give * (box.w / 2 - (box.left ?? 0))), dy: 0, ghosts: [] };
  if (edge === 'right') return { a: along, b: 0, c: 0, d: across, dx: whole(give * (box.w / 2 - (box.right ?? 0))), dy: 0, ghosts: [] };
  if (edge === 'top') return { a: across, b: 0, c: 0, d: along, dx: 0, dy: whole(-give * (box.h / 2 - (box.top ?? 0))), ghosts: [] };
  return { a: across, b: 0, c: 0, d: along, dx: 0, dy: whole(give * (box.h / 2)), ghosts: [] };
}

/** The wind-up, frame by frame: how far it is pulled back against the throw, and how short it is pressed along it. */
export const WIND_PULL: readonly number[] = [5, 9];
export const WIND_SQUASH: readonly number[] = [0.88, 0.76];
/** A splat, frame by frame: the hit, the give, then held; pressed again for a frame before it peels (its own wind-up). */
const SPLAT_HIT = 0.4;
const SPLAT_GIVE = 0.58;
const SPLAT_HELD = 0.5;
const SPLAT_PRESS = 0.44;
/** Peeling off a side it comes back to its shape; off the top it hangs and is drawn out before it drops. */
const PEEL_SIDE: readonly number[] = [0.62, 0.78, 0.92];
const PEEL_TOP: readonly number[] = [0.7, 1, 1.25];

/** How a throw is drawn this frame. */
export function throwLook(now: Thrown, box: ThrowBox): ThrowLook {
  if (now.stage === 'wind') {
    const speed = Math.hypot(now.vx, now.vy) || 1;
    const pull = WIND_PULL[Math.min(now.age, WIND_PULL.length - 1)];
    const squash = WIND_SQUASH[Math.min(now.age, WIND_SQUASH.length - 1)];
    return { ...stretchAlong(now.vx, now.vy, squash), dx: whole((-now.vx / speed) * pull), dy: whole((-now.vy / speed) * pull), ghosts: [] };
  }
  if (now.stage === 'stuck' && now.edge !== null) {
    const along = now.age === 0 ? SPLAT_HIT : now.age === 1 ? SPLAT_GIVE : now.age === now.span - 1 ? SPLAT_PRESS : SPLAT_HELD;
    return squashLook(now.edge, along, box);
  }
  if (now.stage === 'peel' && now.edge !== null) {
    const steps = now.edge === 'top' ? PEEL_TOP : PEEL_SIDE;
    return squashLook(now.edge, steps[Math.min(now.age, steps.length - 1)], box);
  }
  if (now.stage === 'landed') return squashLook('floor', squashFor(now.impact), box);
  // The frame of a bounce: pressed against what it hit.
  if (now.edge !== null && now.impact > 0) return squashLook(now.edge, squashFor(now.impact), box);
  // In the air: drawn out along its path, and fast enough, copies of itself trail back to where it was a frame ago.
  const speed = Math.hypot(now.vx, now.vy);
  const ghosts =
    speed >= SMEAR_SPEED
      ? [1 / 3, 2 / 3].map((back) => ({ dx: whole((now.fromX - now.x) * back), dy: whole((now.fromY - now.y) * back) }))
      : [];
  return { ...stretchAlong(now.vx, now.vy, stretchFor(speed)), dx: 0, dy: 0, ghosts };
}

/** Being dragged: how far its feet lean back per pixel a frame the pointer moves sideways, and the most they lean. */
export const DRAG_LEAN = 0.006;
export const DRAG_LEAN_MAX = 0.6;
/** Dragged this fast or faster (pixels a frame), copies of itself trail behind it, as in the air. */
export const DRAG_SMEAR_SPEED = 30;

/**
 * Being dragged (Luke, 2026-11-16, on smears: "be leniant with the rules where necessary for the sake of creativity and
 * fun"): hanging from where it was taken hold of, its own frame leans back against the way it is dragged (its feet trail,
 * a shear), is drawn out along the drag (the flight's own stretch), and dragged fast, two copies of the frame it is
 * showing trail back along the pointer's path. `vx`, `vy` are the pointer's speed in pixels a frame (`releaseVelocity`).
 * Its own baked frame sheared, stretched and copied with a plain 2D transform: nothing drawn, nothing blurred. At rest it
 * is itself.
 */
export function dragLook(vx: number, vy: number): ThrowLook {
  const speed = Math.hypot(vx, vy);
  if (speed < 1) return NO_LOOK;
  const s = stretchAlong(vx, vy, stretchFor(speed));
  // The feet trail the way it came: a shear about the middle of its box, the lower half pushed back against the drag.
  const lean = -clamp(vx * DRAG_LEAN, -DRAG_LEAN_MAX, DRAG_LEAN_MAX);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const ghosts = speed >= DRAG_SMEAR_SPEED ? [1 / 4, 1 / 2].map((back) => ({ dx: whole(-vx * back), dy: whole(-vy * back) })) : [];
  return { a: round(s.a), b: round(s.b), c: round(s.a * lean + s.c), d: round(s.b * lean + s.d), dx: 0, dy: 0, ghosts };
}

/**
 * Where it is drawn between two frames of a throw or a fall (Luke, 2026-11-16: "better framerate and visual tracking"):
 * the rules still step ten times a second, and in between it is drawn on the line from this frame's place to the next
 * frame's, `along` of the way (0 to 1). The next frame is the rules' own, worked out a frame early, so at every step the
 * place drawn is exactly the rules' and nothing overshoots a wall or the floor. Whole pixels.
 */
export function glideAt(from: { x: number; y: number }, to: { x: number; y: number }, along: number): { x: number; y: number } {
  const t = clamp(along, 0, 1);
  return { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
}

/**
 * Settling after it lands (follow-through): the squash of the landing, a spring back up past its shape, a smaller dip,
 * and it is itself again. Each is how tall it is drawn, feet on the floor; its width goes the other way (`acrossFor`).
 */
export function settleFrames(impact: number): number[] {
  const squash = squashFor(impact);
  const give = 1 - squash;
  if (give <= 0) return [];
  const round = (value: number) => Math.round(value * 100) / 100;
  return [squash, round(1 + give / 2), round(1 - give / 4)];
}
