import { dye, mix, pixel, type EngineEnv, type Palette } from '../engine';
import type { Values } from '../knobs';
import type { StarState } from './sim';

/**
 * A star, pressed (SPEC-backgrounds.md; Luke, 2026-11-28: "make it so that clicking on individual stars interacts with them in a
 * few different ways that are selectable in the settings, physics inspired"). A press that finds a star does what PRESS A STAR
 * says:
 *
 * - NUDGE: the star is shoved away from the pointer and swings back onto its path on a damped spring; its neighbours stir.
 * - LASER: a pulse one dot wide comes in from the nearer side of the screen; the star glows, recoils, throws a few sparks, cools.
 * - THROW: held, the star follows the pointer; let go, it flies on at the hand's speed, bent by WIND and FALL and carried by
 *   SPEED, until it slows and is an ordinary star again.
 * - PULL: the star turns heavy for two seconds; the stars near it bend towards it as a dotted ring closes in, then spring back.
 * - BURST: the star breaks into eight faint pieces that fly apart, slow and fade; a new star arrives far off in its place.
 * - TIE: one star pressed, then another: a dotted elastic thread ties them and they tug each other for six seconds.
 *
 * With a mode on, one press on empty sky does nothing and two quick ones are hyperspace (Luke, 2026-11-28: "Hyperspace on
 * double press"): both on empty sky, and neither of them a drag.
 *
 * Everything here is points, lines and fades the arithmetic makes (art.md, 2026-11-16). Nothing is kept once an effect is over:
 * a star that was only pushed or pulled is drawn exactly where it would have been had nobody pressed. None of it asks
 * `env.random` for a number while it runs, so the rest of the sky is the same sky either way (only a star thrown off the screen
 * or burst is brought back new, by the field).
 */

export const TOUCH_KEY = 'touch';
const MODES = ['nudge', 'laser', 'throw', 'pull', 'burst', 'tie'] as const;
export type TouchMode = (typeof MODES)[number];

/** What a press on a star does now; null for OFF. */
export const touchMode = (values: Values): TouchMode | null => MODES.find((mode) => mode === values[TOUCH_KEY]) ?? null;

/** How near a press has to be to a star to be that star's, in screen pixels: they are a few pixels wide and moving. */
export const REACH_PX = 28;
/** The press is also measured against the last tenth of a second of the star's way: a hand presses where the star just was. */
const BEHIND_STEPS = 3;

/** A star off its path on a spring: how far, and how fast, in cells. */
type Push = { n: number; x: number; y: number; vx: number; vy: number };
/** A star held in the hand, or flying from it. `w` is its speed over and above the field's own, in cells a second. */
type Flight = { n: number; held: boolean; x: number; y: number; wx: number; wy: number; age: number; seen: { x: number; y: number }[]; felt: number[] };
type Beam = { n: number; from: number; x: number; y: number; tone: number; age: number };
type Hot = { n: number; age: number };
type Spark = { x: number; y: number; vx: number; vy: number; tone: number; age: number };
/** A dotted ring, going out or closing in. One not yet begun has an age under nothing. */
type Ripple = { x: number; y: number; reach: number; tone: number; age: number; seconds: number; inward: boolean };
type Wake = { x: number; y: number; tone: number; age: number };
/** A star made heavy. */
type Well = { n: number; age: number };
/** A piece of a burst star, and the way the star was going (`ux`, `uy`), which the pieces slow back to. */
type Shard = { x: number; y: number; vx: number; vy: number; ux: number; uy: number; tone: number; age: number };
/** Two stars tied: how far the spring is drawn up (1 is where it would rest), how fast that changes, and what it last moved them. */
type Tie = { a: number; b: number; age: number; s: number; v: number; ox: number; oy: number };

export type TouchState = {
  pushes: Push[];
  flights: Flight[];
  beams: Beam[];
  hot: Hot[];
  sparks: Spark[];
  ripples: Ripple[];
  wake: Wake[];
  wells: Well[];
  shards: Shard[];
  /** Stars burst since the last step, for the field to bring back new. */
  broken: number[];
  ties: Tie[];
  /** TIE's first star, waiting for its second. */
  waiting: Well | null;
  /** A press on empty sky, waiting to see whether a second follows; `again` once it has, until that one is let go. */
  miss: { x: number; y: number; age: number; again: boolean } | null;
  /** Counts presses, for the sparks' and the pieces' own spread. */
  presses: number;
};

export const newTouch = (): TouchState => ({ pushes: [], flights: [], beams: [], hot: [], sparks: [], ripples: [], wake: [], wells: [], shards: [], broken: [], ties: [], waiting: null, miss: null, presses: 0 });

/** Anything still going on. */
export const touching = (touch: TouchState): boolean =>
  touch.pushes.length + touch.flights.length + touch.beams.length + touch.hot.length + touch.sparks.length + touch.ripples.length + touch.wake.length + touch.wells.length + touch.shards.length + touch.broken.length + touch.ties.length > 0 ||
  touch.waiting !== null ||
  touch.miss !== null;

/* The spring: how fast it swings (radians a second) and how soon it stops (1 would not swing at all). */
const OMEGA = 9;
const ZETA = 0.28;
/** The farthest an underdamped spring of these two goes, for a start speed of 1: `peak = speed * SWING / OMEGA`. */
const SWING = 0.69;

const NUDGE_PX = 40;
const NUDGE_NEAR_PX = 70;
const RECOIL_PX = 20;
const RECOIL_NEAR_PX = 36;
const BEAM_SECONDS = 0.45;
const HEAT_SECONDS = 0.5;
const SPARKS = 5;
const SPARK_SECONDS = 0.5;
const RIPPLE_SECONDS = 0.4;
const RIPPLE_DOTS = 14;
const WAKE_SECONDS = 0.45;
/** The hand's speed is taken over this many steps, so one still step does not stop a throw dead. */
const HAND_STEPS = 5;
/** How soon a thrown star's own speed is lost to the field (seconds), and when it is a star like any other again. */
const DRAG_SECONDS = 1.2;
const SETTLED = 6;
const LONGEST_FLIGHT = 4;
/** PULL: how long the star is heavy, how far it reaches, how its pull softens near it, and the hardest it pulls (px/s²). */
const WELL_SECONDS = 2;
const PULL_REACH_PX = 180;
const PULL_SOFT_PX = 60;
const PULL_ACCEL_PX = 2000;
/** BURST: eight pieces, gone inside a second. */
const SHARDS = 8;
const SHARD_SECONDS = 0.9;
const SHARD_DRAG_SECONDS = 0.35;
/** TIE: how long the thread holds, how it springs (radians a second, damping), and how long the first star waits. */
const TIE_SECONDS = 6;
const TIE_OMEGA = 6;
const TIE_ZETA = 0.07;
const TIE_PX = 24;
const TIE_LET_GO_SECONDS = 1.2;
const WAITING_SECONDS = 6;
const MOST_TIES = 12;
/** Two presses on empty sky are a double one when this close in time and place; a press that moves this far is a drag. */
const DOUBLE_SECONDS = 0.5;
const DOUBLE_PX = 30;
const DRAG_PX = 10;
/** A step is a thirtieth of a second of the reader's time, whatever TIME makes of the sky's. */
const STEP_SECONDS = 1 / 30;

/** The numbers of the sky a press needs: where the stars come from and how wide they fan. */
export type Sky = { fan: number };

const cellsOf = (values: Values, px: number): number => px / Math.max(1, values.cell as number);

function distanceToWay(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const [dx, dy] = [x1 - x0, y1 - y0];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length));
  return Math.hypot(px - x0 - dx * t, py - y0 - dy * t);
}

/** The drawn star nearest a press, within reach, and not one hidden under a window; -1 for empty sky. */
export function starAt(state: StarState, x: number, y: number, values: Values, env: EngineEnv): number {
  const reach = cellsOf(values, REACH_PX);
  let found = -1;
  let best = reach;
  for (let n = 0; n < state.count; n += 1) {
    const [sx, sy] = [state.sx[n], state.sy[n]];
    if (state.lit[n] <= 0 || Number.isNaN(sx) || sx < 0 || sx >= state.w || sy < 0 || sy >= state.h) continue;
    if (env.solids.some((box) => sx >= box.x0 && sx < box.x1 && sy >= box.y0 && sy < box.y1)) continue;
    let [bx, by] = [sx, sy];
    if (!Number.isNaN(state.px[n])) {
      bx = sx + (state.px[n] - sx) * BEHIND_STEPS;
      by = sy + (state.py[n] - sy) * BEHIND_STEPS;
    }
    const far = distanceToWay(x, y, sx, sy, bx, by);
    if (far <= best) {
      best = far;
      found = n;
    }
  }
  return found;
}

/** A press that found no star. It does nothing by itself; a second one soon after, near it, is on its way to hyperspace. */
export function missSky(touch: TouchState, x: number, y: number, values: Values): void {
  const first = touch.miss;
  const again = first !== null && !first.again && Math.hypot(first.x - x, first.y - y) <= cellsOf(values, DOUBLE_PX);
  touch.miss = { x, y, age: 0, again };
}

function pushOf(touch: TouchState, n: number): Push {
  let push = touch.pushes.find((each) => each.n === n);
  if (push === undefined) {
    push = { n, x: 0, y: 0, vx: 0, vy: 0 };
    touch.pushes.push(push);
  }
  return push;
}

/** A shove, in cells of farthest swing, along a direction. A star already swinging is shoved on from where it is. */
function shove(touch: TouchState, n: number, dx: number, dy: number): void {
  const speed = OMEGA / SWING;
  const push = pushOf(touch, n);
  push.vx += dx * speed;
  push.vy += dy * speed;
}

/** The stars round one feel it: less the farther off they are, away from it or (given a way) along it. */
function stir(state: StarState, centre: number, reach: number, most: number, along?: readonly [number, number]): void {
  const [cx, cy] = [state.sx[centre], state.sy[centre]];
  for (let n = 0; n < state.count; n += 1) {
    if (n === centre || state.lit[n] <= 0 || Number.isNaN(state.sx[n])) continue;
    const [dx, dy] = [state.sx[n] - cx, state.sy[n] - cy];
    const far = Math.hypot(dx, dy);
    if (far >= reach || far === 0) continue;
    const strength = most * (1 - far / reach);
    const [ux, uy] = along ?? [dx / far, dy / far];
    shove(state.touch, n, ux * strength, uy * strength);
  }
}

/** A star in flight is put back into the box where it is drawn, as a star like any other. */
function rejoin(state: StarState, flight: Flight, sky: Sky): void {
  const n = flight.n;
  state.x[n] = ((flight.x - state.cx - state.ox[n]) * state.z[n]) / sky.fan;
  state.y[n] = ((flight.y - state.cy - state.oy[n]) * state.z[n]) / sky.fan;
}

/** A number from 0 to 1 that differs press by press and piece by piece, without asking the sky's dice. */
const odd = (presses: number, k: number): number => (presses * 0.618 + k * 0.7548) % 1;

/** A press on the star `n` at a cell: what the mode does to it. */
export function pressStar(state: StarState, n: number, x: number, y: number, mode: TouchMode, values: Values, sky: Sky): void {
  const touch = state.touch;
  touch.presses += 1;
  touch.miss = null;
  if (mode !== 'tie') touch.waiting = null;
  const flying = touch.flights.findIndex((each) => each.n === n);
  if (flying !== -1) {
    rejoin(state, touch.flights[flying], sky);
    touch.flights.splice(flying, 1);
  }
  const [sx, sy] = [state.sx[n], state.sy[n]];
  const tone = state.tone[n];

  if (mode === 'throw') {
    touch.pushes = touch.pushes.filter((each) => each.n !== n);
    touch.flights.push({ n, held: true, x: sx, y: sy, wx: 0, wy: 0, age: 0, seen: [], felt: [] });
    return;
  }

  if (mode === 'nudge') {
    // Away from the pointer; pressed dead on, outward along the way it was already going.
    let [dx, dy] = [sx - x, sy - y];
    if (Math.hypot(dx, dy) < 1) [dx, dy] = [sx - state.cx, sy - state.cy];
    const far = Math.hypot(dx, dy);
    const [ux, uy] = far === 0 ? [1, 0] : [dx / far, dy / far];
    stir(state, n, cellsOf(values, NUDGE_NEAR_PX), cellsOf(values, NUDGE_PX) * 0.4);
    shove(touch, n, ux * cellsOf(values, NUDGE_PX), uy * cellsOf(values, NUDGE_PX));
    touch.ripples.push({ x, y, reach: cellsOf(values, NUDGE_PX), tone, age: 0, seconds: RIPPLE_SECONDS, inward: false });
    return;
  }

  if (mode === 'pull') {
    touch.wells = touch.wells.filter((each) => each.n !== n);
    touch.wells.push({ n, age: 0 });
    // Two rings closing in on it, one after the other.
    for (const wait of [0, 0.7]) touch.ripples.push({ x: sx, y: sy, reach: cellsOf(values, PULL_REACH_PX * 0.6), tone, age: -wait, seconds: 0.9, inward: true });
    return;
  }

  if (mode === 'burst') {
    // The way the star was going, in cells a second: the pieces carry it between them.
    const dt = (1 / 30) * (values.time as number);
    const [ux, uy] = Number.isNaN(state.px[n]) ? [0, 0] : [(sx - state.px[n]) / dt, (sy - state.py[n]) / dt];
    const away: [number, number][] = [];
    for (let k = 0; k < SHARDS; k += 1) {
      const angle = ((k + odd(touch.presses, k) * 0.8) / SHARDS) * Math.PI * 2;
      const speed = cellsOf(values, 45 + 55 * ((odd(touch.presses, k) * 3.7) % 1));
      away.push([Math.cos(angle) * speed, Math.sin(angle) * speed]);
    }
    // Apart from each other they add up to nothing, so together they still go as the star went.
    const [mx, my] = [away.reduce((sum, each) => sum + each[0], 0) / SHARDS, away.reduce((sum, each) => sum + each[1], 0) / SHARDS];
    for (const [vx, vy] of away) touch.shards.push({ x: sx, y: sy, vx: ux + vx - mx, vy: uy + vy - my, ux, uy, tone, age: 0 });
    touch.pushes = touch.pushes.filter((each) => each.n !== n);
    touch.broken.push(n);
    state.lit[n] = 0;
    return;
  }

  if (mode === 'tie') {
    const first = touch.waiting;
    if (first === null) touch.waiting = { n, age: 0 };
    else {
      // The same star pressed again is let go of.
      touch.waiting = null;
      if (first.n === n) return;
      // Two stars are tied once: tying them again starts that thread afresh.
      touch.ties = touch.ties.filter((tie) => !((tie.a === first.n && tie.b === n) || (tie.a === n && tie.b === first.n)));
      touch.ties.push({ a: first.n, b: n, age: 0, s: 0, v: 0, ox: 0, oy: 0 });
      if (touch.ties.length > MOST_TIES) touch.ties.shift();
    }
    return;
  }

  // LASER: from the nearer side, so the pulse is short and mostly over bare sky.
  const from = sx < state.w / 2 ? 0 : state.w - 1;
  const way = sx >= from ? 1 : -1;
  touch.beams.push({ n, from, x: sx, y: sy, tone, age: 0 });
  touch.hot = touch.hot.filter((each) => each.n !== n);
  touch.hot.push({ n, age: 0 });
  stir(state, n, cellsOf(values, RECOIL_NEAR_PX), cellsOf(values, RECOIL_PX) * 0.3, [way, 0]);
  shove(touch, n, way * cellsOf(values, RECOIL_PX), 0);
  for (let k = 0; k < SPARKS; k += 1) {
    // Fanned on past the star, the way the light was going; each press fans them a little differently.
    const spread = odd(touch.presses, k);
    const angle = ((k + spread) / SPARKS - 0.5) * 2.4;
    const speed = cellsOf(values, 50 + 70 * ((spread * 3.7) % 1));
    touch.sparks.push({ x: sx, y: sy, vx: Math.cos(angle) * speed * way, vy: Math.sin(angle) * speed, tone, age: 0 });
  }
}

/** The field's own movement at a place, in cells a second: outward with SPEED, sideways with WIND, down with FALL. */
function flow(state: StarState, values: Values, n: number, x: number, y: number): [number, number] {
  const speed = ((values.speed as number) / 100) * 0.9 * (values.reverse === true ? -1 : 1);
  const out = speed / Math.max(0.2, state.z[n]);
  return [(x - state.cx) * out + ((values.wind as number) / 100) * 30, (y - state.cy) * out + ((values.fall as number) / 100) * 30];
}

/** Everything let go at once, each star where it would be: PRESS A STAR switched OFF. */
export function endTouch(state: StarState, sky: Sky): void {
  for (const flight of state.touch.flights) rejoin(state, flight, sky);
  state.touch = newTouch();
}

/** Whether a star is held or flying: the field leaves it where it is and the flight draws it. */
export const inFlight = (touch: TouchState, n: number): boolean => touch.flights.some((flight) => flight.n === n);

/** A heavy star draws the stars near it: each is given the speed one step of that pull gives, and its spring does the rest. */
function pull(state: StarState, values: Values, well: Well, dt: number): void {
  const [cx, cy] = [state.sx[well.n], state.sy[well.n]];
  const reach = cellsOf(values, PULL_REACH_PX);
  const soft = cellsOf(values, PULL_SOFT_PX);
  // Softened inverse-square (it falls to nothing at the very centre, so nothing is flung out of it), scaled so its hardest is 1.
  const shape = (far: number) => far / (far * far + soft * soft) ** 1.5;
  const hardest = shape(soft / Math.SQRT2);
  const swell = Math.max(0, Math.min(1, well.age / 0.3, (WELL_SECONDS - well.age) / 0.3));
  for (let n = 0; n < state.count; n += 1) {
    if (n === well.n || state.lit[n] <= 0 || Number.isNaN(state.sx[n])) continue;
    const push = state.touch.pushes.find((each) => each.n === n);
    const [dx, dy] = [cx - state.sx[n] - (push?.x ?? 0), cy - state.sy[n] - (push?.y ?? 0)];
    const far = Math.hypot(dx, dy);
    if (far >= reach || far === 0) continue;
    const speed = cellsOf(values, PULL_ACCEL_PX) * swell * (shape(far) / hardest) * (1 - (far / reach) ** 2) * dt;
    const pushed = pushOf(state.touch, n);
    pushed.vx += (dx / far) * speed;
    pushed.vy += (dy / far) * speed;
  }
}

/**
 * One step of whatever presses started, after the field's own step (which has just put every star not in flight where its path
 * says). `dt` is the step in the sky's own seconds. `gone` are the stars to bring back new (thrown off the screen, or burst);
 * `rush` that a double press on empty sky has just been let go.
 */
export function stepTouch(state: StarState, values: Values, env: EngineEnv, dt: number, sky: Sky): { gone: number[]; rush: boolean } {
  const touch = state.touch;
  const gone: number[] = touch.broken.filter((n) => n < state.count);
  touch.broken = [];
  const decay = Math.exp(-dt / DRAG_SECONDS);

  let rush = false;
  const miss = touch.miss;
  if (miss !== null) {
    miss.age += STEP_SECONDS;
    const down = env.pointer?.down === true;
    if (down && Math.hypot((env.pointer?.x ?? miss.x) - miss.x, (env.pointer?.y ?? miss.y) - miss.y) > cellsOf(values, DRAG_PX)) touch.miss = null;
    else if (miss.again && !down) {
      rush = true;
      touch.miss = null;
    } else if (miss.age > DOUBLE_SECONDS) touch.miss = null;
  }

  touch.flights = touch.flights.filter((flight) => {
    const n = flight.n;
    if (n >= state.count) return false;
    const before = [state.sx[n], state.sy[n]];
    if (flight.held && env.pointer?.down === true) {
      flight.x = env.pointer.x;
      flight.y = env.pointer.y;
      flight.seen.push({ x: flight.x, y: flight.y });
      if (flight.seen.length > HAND_STEPS) flight.seen.shift();
    } else {
      if (flight.held) {
        // Let go: it leaves at the hand's speed.
        flight.held = false;
        const [first, last] = [flight.seen[0], flight.seen[flight.seen.length - 1]];
        // Not moved at all (a click, or held still before letting go): it is simply put down, a star like any other.
        if (flight.seen.length < 2 || (last.x === first.x && last.y === first.y)) {
          rejoin(state, flight, sky);
          [state.px[n], state.py[n], state.sx[n], state.sy[n]] = [flight.x, flight.y, flight.x, flight.y];
          state.lit[n] = 1;
          return false;
        }
        const over = (flight.seen.length - 1) * dt;
        const [ux, uy] = flow(state, values, n, flight.x, flight.y);
        flight.wx = (last.x - first.x) / over - ux;
        flight.wy = (last.y - first.y) / over - uy;
      }
      const [ux, uy] = flow(state, values, n, flight.x, flight.y);
      flight.x += (ux + flight.wx) * dt;
      flight.y += (uy + flight.wy) * dt;
      // WIND pushes it and FALL pulls it down, as a thrown thing; what the hand gave it drains away.
      flight.wx = flight.wx * decay + ((values.wind as number) / 100) * 30 * dt;
      flight.wy = flight.wy * decay + ((values.fall as number) / 100) * 60 * dt;
      flight.age += dt;
      const speed = Math.hypot(flight.wx, flight.wy);
      if (speed > 25) {
        touch.wake.push({ x: flight.x, y: flight.y, tone: state.tone[n], age: 0 });
        // The stars it passes close feel it go by, once each.
        const reach = cellsOf(values, 30);
        for (let other = 0; other < state.count; other += 1) {
          if (other === n || state.lit[other] <= 0 || flight.felt.includes(other)) continue;
          if (Math.hypot(state.sx[other] - flight.x, state.sy[other] - flight.y) >= reach) continue;
          flight.felt.push(other);
          const most = cellsOf(values, 10);
          shove(touch, other, (flight.wx / speed) * most, (flight.wy / speed) * most);
        }
      }
    }
    state.px[n] = before[0];
    state.py[n] = before[1];
    state.sx[n] = flight.x;
    state.sy[n] = flight.y;
    state.lit[n] = 1;
    if (flight.held) return true;
    if (flight.x < -4 || flight.x > state.w + 4 || flight.y < -4 || flight.y > state.h + 4) {
      gone.push(n);
      return false;
    }
    if (flight.age >= LONGEST_FLIGHT || (flight.age >= 0.4 && Math.hypot(flight.wx, flight.wy) < SETTLED)) {
      rejoin(state, flight, sky);
      return false;
    }
    return true;
  });

  /** A star that is no longer the one that was pressed: burst, thrown off, past the viewer, or come round the other side. */
  const lost = (n: number): boolean => n >= state.count || gone.includes(n) || Number.isNaN(state.sx[n]);

  touch.wells = touch.wells.filter((well) => {
    well.age += dt;
    if (well.age >= WELL_SECONDS || lost(well.n)) return false;
    pull(state, values, well, dt);
    return true;
  });

  // The springs. A star that has passed the viewer meanwhile (it is somewhere new, and not drawn yet) is let be.
  const parts = Math.max(1, Math.ceil(dt / 0.02));
  const part = dt / parts;
  touch.pushes = touch.pushes.filter((push) => {
    if (lost(push.n)) return false;
    for (let k = 0; k < parts; k += 1) {
      push.vx += (-OMEGA * OMEGA * push.x - 2 * ZETA * OMEGA * push.vx) * part;
      push.vy += (-OMEGA * OMEGA * push.y - 2 * ZETA * OMEGA * push.vy) * part;
      push.x += push.vx * part;
      push.y += push.vy * part;
    }
    // While a star is heavy, the little springs near it are still being wound.
    if (touch.wells.length === 0 && Math.abs(push.x) + Math.abs(push.y) < 0.25 && Math.abs(push.vx) + Math.abs(push.vy) < 2) return false;
    state.sx[push.n] += push.x;
    state.sy[push.n] += push.y;
    return true;
  });

  touch.ties = touch.ties.filter((tie) => {
    const { a, b } = tie;
    const left = lost(a) || Number.isNaN(state.px[a]);
    const right = lost(b) || Number.isNaN(state.px[b]);
    if (left || right) {
      // The thread snaps: whichever end is left springs back from where the thread had it.
      for (const [n, sign, snapped] of [[a, 1, left], [b, -1, right]] as const) {
        if (snapped) continue;
        const push = pushOf(touch, n);
        push.x += tie.ox * sign;
        push.y += tie.oy * sign;
        state.sx[n] += tie.ox * sign;
        state.sy[n] += tie.oy * sign;
      }
      return false;
    }
    tie.age += dt;
    if (tie.age >= TIE_SECONDS) return false;
    for (let k = 0; k < parts; k += 1) {
      tie.v += (-TIE_OMEGA * TIE_OMEGA * (tie.s - 1) - 2 * TIE_ZETA * TIE_OMEGA * tie.v) * part;
      tie.s += tie.v * part;
    }
    const [dx, dy] = [state.sx[b] - state.sx[a], state.sy[b] - state.sy[a]];
    const far = Math.hypot(dx, dy);
    // Drawn together by a share of the way between them, and never by more than a few dozen pixels, easing out at the end.
    const draw = far === 0 ? 0 : (tie.s * Math.min(far * 0.18, cellsOf(values, TIE_PX)) * Math.min(1, (TIE_SECONDS - tie.age) / TIE_LET_GO_SECONDS)) / far;
    [tie.ox, tie.oy] = [dx * draw, dy * draw];
    state.sx[a] += tie.ox;
    state.sy[a] += tie.oy;
    state.sx[b] -= tie.ox;
    state.sy[b] -= tie.oy;
    return true;
  });

  if (touch.waiting !== null) {
    touch.waiting.age += dt;
    // Also forgotten when PRESS A STAR is turned to something else.
    if (touch.waiting.age >= WAITING_SECONDS || lost(touch.waiting.n) || touchMode(values) !== 'tie') touch.waiting = null;
  }

  const lives = <T extends { age: number }>(list: T[], most: number): T[] => {
    for (const each of list) each.age += dt;
    return list.filter((each) => each.age < most);
  };
  touch.hot = lives(touch.hot, HEAT_SECONDS * 3).filter((hot) => !lost(hot.n));
  touch.beams = lives(touch.beams, BEAM_SECONDS);
  for (const beam of touch.beams) {
    // The pulse stays on its star while there is one.
    if (!lost(beam.n) && touch.hot.some((hot) => hot.n === beam.n)) [beam.x, beam.y] = [state.sx[beam.n], state.sy[beam.n]];
  }
  touch.sparks = lives(touch.sparks, SPARK_SECONDS);
  for (const spark of touch.sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
  }
  touch.shards = lives(touch.shards, SHARD_SECONDS);
  const slow = Math.exp(-dt / SHARD_DRAG_SECONDS);
  for (const shard of touch.shards) {
    shard.x += shard.vx * dt;
    shard.y += shard.vy * dt;
    shard.vx = shard.ux + (shard.vx - shard.ux) * slow;
    shard.vy = shard.uy + (shard.vy - shard.uy) * slow;
  }
  for (const ripple of touch.ripples) ripple.age += dt;
  touch.ripples = touch.ripples.filter((ripple) => ripple.age < ripple.seconds);
  // A ring closing in stays on its star.
  for (const ripple of touch.ripples) {
    const well = ripple.inward ? touch.wells.find((each) => Math.hypot(state.sx[each.n] - ripple.x, state.sy[each.n] - ripple.y) < 8) : undefined;
    if (well !== undefined) [ripple.x, ripple.y] = [state.sx[well.n], state.sy[well.n]];
  }
  touch.wake = lives(touch.wake, WAKE_SECONDS);
  return { gone, rush };
}

/** How hot a lasered star still is: 1 as the pulse lands, cooling away. */
export function heatOf(touch: TouchState, n: number): number {
  const hot = touch.hot.find((each) => each.n === n);
  return hot === undefined ? 0 : Math.exp(-hot.age / HEAT_SECONDS);
}

/** Drawn a size bigger while it is heavy, or waiting to be tied. */
export const marked = (touch: TouchState, n: number): boolean => touch.waiting?.n === n || touch.wells.some((well) => well.n === n);

/** The threads, pulses, rings, sparks, pieces and wakes, in the stars' own colours. Drawn before the stars, so none is hidden. */
export function renderTouch(state: StarState, pixels: Uint32Array, palette: Palette, colourOf: (tone: number) => number): void {
  const { w, h, touch } = state;
  const black = pixel(0, 0, 0);
  const put = (x: number, y: number, colour: number) => {
    const [px, py] = [Math.round(x), Math.round(y)];
    if (px >= 0 && px < w && py >= 0 && py < h) pixels[py * w + px] = colour;
  };
  const ring = (x: number, y: number, radius: number, dots: number, colour: number) => {
    for (let k = 0; k < dots; k += 1) {
      const angle = (k / dots) * Math.PI * 2;
      put(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, colour);
    }
  };

  for (const tie of touch.ties) {
    // A dotted thread, every third cell of the way, fading as it lets go.
    const [x0, y0, x1, y1] = [state.sx[tie.a], state.sy[tie.a], state.sx[tie.b], state.sy[tie.b]];
    if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
    const colour = mix(black, colourOf(state.tone[tie.a]), 0.34 * Math.min(1, (TIE_SECONDS - tie.age) / TIE_LET_GO_SECONDS));
    const dots = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 3);
    for (let k = 1; k < dots; k += 1) put(x0 + ((x1 - x0) * k) / dots, y0 + ((y1 - y0) * k) / dots, colour);
  }
  if (touch.waiting !== null && !Number.isNaN(state.sx[touch.waiting.n])) ring(state.sx[touch.waiting.n], state.sy[touch.waiting.n], 5, 6, mix(black, colourOf(state.tone[touch.waiting.n]), 0.4));
  for (const beam of touch.beams) {
    const gone = beam.age / BEAM_SECONDS;
    const bright = Math.exp(-beam.age / 0.16);
    const light = mix(colourOf(beam.tone), dye(palette, 'white'), 0.5);
    // Its far end comes in toward the star as it fades.
    const tail = beam.from + (beam.x - beam.from) * gone;
    const length = Math.abs(beam.x - tail);
    const way = beam.x >= tail ? 1 : -1;
    for (let k = 0; k <= length; k += 1) put(tail + k * way, beam.y, mix(black, light, bright * (0.3 + 0.55 * (k / Math.max(1, length)))));
  }
  for (const ripple of touch.ripples) {
    if (ripple.age < 0) continue;
    const gone = ripple.age / ripple.seconds;
    const eased = 1 - (1 - gone) * (1 - gone);
    const radius = ripple.inward ? ripple.reach - (ripple.reach - 3) * gone * gone : 2 + (ripple.reach - 2) * eased;
    const bright = ripple.inward ? 0.3 * Math.min(1, gone * 4, (1 - gone) * 4) : 0.4 * (1 - gone);
    ring(ripple.x, ripple.y, radius, ripple.inward ? RIPPLE_DOTS * 2 : RIPPLE_DOTS, mix(black, colourOf(ripple.tone), bright));
  }
  for (const spark of touch.sparks) put(spark.x, spark.y, mix(black, colourOf(spark.tone), 0.85 * (1 - spark.age / SPARK_SECONDS)));
  for (const shard of touch.shards) put(shard.x, shard.y, mix(black, colourOf(shard.tone), 0.6 * (1 - shard.age / SHARD_SECONDS)));
  for (const wake of touch.wake) put(wake.x, wake.y, mix(black, colourOf(wake.tone), 0.45 * (1 - wake.age / WAKE_SECONDS)));
}
