import { dye, pixel, wheel, type Box, type Engine, type EngineEnv, type Palette, DYES } from '../engine';
import type { Values } from '../knobs';

/**
 * FLUID (SPEC-backgrounds.md): ink in water, stirred by the pointer. Jos Stam's stable fluids ("Real-Time Fluid Dynamics for
 * Games") with the vorticity step that gives Pavel Dobryakov's WebGL Fluid Simulation its curl - but solved here on the
 * processor, on a small grid, on purpose: it is chunky like everything else on the site, needs no graphics card, can't lose a
 * context, and its arithmetic is run by a check.
 *
 * Each step: forces go in (the pointer's drag, the wind, splats, ink rising or sinking), the swirl is sharpened, the water is
 * made to neither pile up nor thin out anywhere (the pressure solve), and the water carries itself and its ink along. The ink
 * is three amounts a cell (three inks of the chosen colour set), which the picture mixes, cuts to a few steps and dithers.
 *
 * Arrays have a one-cell border all round, as Stam's do: cell (x, y) of the grid is at `(x + 1) + (w + 2) * (y + 1)`.
 */

export type FluidState = {
  w: number;
  h: number;
  /** The water's speed, in cells a second, and room to work in. */
  u: Float32Array;
  v: Float32Array;
  u0: Float32Array;
  v0: Float32Array;
  p: Float32Array;
  div: Float32Array;
  /** The three inks. */
  ink: [Float32Array, Float32Array, Float32Array];
  ink0: Float32Array;
  /** Where the page is solid. */
  solid: Uint8Array;
  solidsOf: readonly Box[] | null;
  solidOn: boolean;
  /** Seconds of the fluid's own time. */
  t: number;
  /** Where the pointer was at the last step, to tell how it moved. */
  was: { x: number; y: number } | null;
  /** How long until the next splat by itself. */
  nextSplat: number;
  /** Which ink comes out next. */
  turn: number;
  /** For the meters, and for resting: how much ink there is and how fast the water goes, a cell on average. */
  inkNow: number;
  flowNow: number;
  /** How many steps have been worked out in full (a resting step is not one). */
  solved: number;
};

const num = (values: Values, key: string): number => values[key] as number;

export function newFluid(w: number, h: number): FluidState {
  const size = (w + 2) * (h + 2);
  const field = () => new Float32Array(size);
  return {
    w, h, u: field(), v: field(), u0: field(), v0: field(), p: field(), div: field(), ink: [field(), field(), field()], ink0: field(),
    solid: new Uint8Array(size), solidsOf: null, solidOn: false, t: 0, was: null, nextSplat: 0.5, turn: 0, inkNow: 0, flowNow: 0, solved: 0,
  };
}

/** A push and a blot of ink round a spot: strongest at the middle, gone by about three sizes out. */
export function splat(state: FluidState, x: number, y: number, fx: number, fy: number, size: number, amount: number, which: number): void {
  const { w, h } = state;
  const reach = Math.ceil(size * 2.5);
  const row = w + 2;
  // Counted at once, so the next step doesn't take the water for empty and rest.
  state.inkNow = Math.max(state.inkNow, 0.001);
  for (let j = Math.max(1, Math.floor(y + 1 - reach)); j <= Math.min(h, Math.ceil(y + 1 + reach)); j += 1) {
    for (let i = Math.max(1, Math.floor(x + 1 - reach)); i <= Math.min(w, Math.ceil(x + 1 + reach)); i += 1) {
      const n = i + row * j;
      if (state.solid[n] === 1) continue;
      const far = (i - 1 - x) * (i - 1 - x) + (j - 1 - y) * (j - 1 - y);
      const part = Math.exp(-far / (size * size));
      state.u[n] += fx * part;
      state.v[n] += fy * part;
      const ink = state.ink[((which % 3) + 3) % 3];
      ink[n] = Math.min(1.6, ink[n] + amount * part);
    }
  }
}

/** The edges of the grid are walls: nothing flows through them. A field that isn't a speed just copies its neighbour. */
function edges(state: FluidState, field: Float32Array, kind: 0 | 1 | 2): void {
  const { w, h } = state;
  const row = w + 2;
  for (let i = 1; i <= w; i += 1) {
    field[i] = kind === 2 ? -field[i + row] : field[i + row];
    field[i + row * (h + 1)] = kind === 2 ? -field[i + row * h] : field[i + row * h];
  }
  for (let j = 1; j <= h; j += 1) {
    field[row * j] = kind === 1 ? -field[1 + row * j] : field[1 + row * j];
    field[w + 1 + row * j] = kind === 1 ? -field[w + row * j] : field[w + row * j];
  }
}

/** Where the page is solid the water doesn't move and holds no ink. */
function holdSolids(state: FluidState): void {
  if (!state.solidOn) return;
  const { solid, u, v, ink } = state;
  for (let n = 0; n < solid.length; n += 1) {
    if (solid[n] === 0) continue;
    u[n] = 0;
    v[n] = 0;
    ink[0][n] = 0;
    ink[1][n] = 0;
    ink[2][n] = 0;
  }
}

/** A field carried along by the water for `dt` seconds: each cell takes what was upstream of it. */
function carry(state: FluidState, to: Float32Array, from: Float32Array, dt: number): void {
  const { w, h, u, v } = state;
  const row = w + 2;
  for (let j = 1; j <= h; j += 1) {
    for (let i = 1; i <= w; i += 1) {
      const n = i + row * j;
      const x = Math.min(w + 0.5, Math.max(0.5, i - dt * u[n]));
      const y = Math.min(h + 0.5, Math.max(0.5, j - dt * v[n]));
      const i0 = Math.floor(x);
      const j0 = Math.floor(y);
      const s = x - i0;
      const t = y - j0;
      to[n] = (1 - s) * ((1 - t) * from[i0 + row * j0] + t * from[i0 + row * (j0 + 1)]) + s * ((1 - t) * from[i0 + 1 + row * j0] + t * from[i0 + 1 + row * (j0 + 1)]);
    }
  }
}

/** How many times the pressure is passed round. Sixteen keeps the water from bunching and costs little on a grid this small. */
export const PRESSURE_PASSES = 16;

/** Makes the water neither pile up nor thin out: works out the pressure that would stop it and lets that pressure push back. */
function project(state: FluidState): void {
  const { w, h, u, v, p, div, solid } = state;
  const row = w + 2;
  for (let j = 1; j <= h; j += 1) {
    for (let i = 1; i <= w; i += 1) {
      const n = i + row * j;
      div[n] = solid[n] === 1 ? 0 : -0.5 * (u[n + 1] - u[n - 1] + v[n + row] - v[n - row]);
      p[n] = 0;
    }
  }
  edges(state, div, 0);
  edges(state, p, 0);
  for (let pass = 0; pass < PRESSURE_PASSES; pass += 1) {
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const n = i + row * j;
        // Each pass overshoots a little on purpose (over-relaxation): the same sixteen passes settle far more of the bunching.
        p[n] += 1.6 * ((div[n] + p[n - 1] + p[n + 1] + p[n - row] + p[n + row]) * 0.25 - p[n]);
      }
    }
    edges(state, p, 0);
  }
  for (let j = 1; j <= h; j += 1) {
    for (let i = 1; i <= w; i += 1) {
      const n = i + row * j;
      u[n] -= 0.5 * (p[n + 1] - p[n - 1]);
      v[n] -= 0.5 * (p[n + row] - p[n - row]);
    }
  }
  edges(state, u, 1);
  edges(state, v, 2);
}

/** How much the water piles up or thins out, a cell on average, after the pressure has pushed back: near nothing. For the check. */
export function bunching(state: FluidState): number {
  const { w, h, u, v } = state;
  const row = w + 2;
  let sum = 0;
  for (let j = 2; j < h; j += 1) for (let i = 2; i < w; i += 1) sum += Math.abs(0.5 * (u[i + 1 + row * j] - u[i - 1 + row * j] + v[i + row * (j + 1)] - v[i + row * (j - 1)]));
  return sum / Math.max(1, (w - 2) * (h - 2));
}

function markSolids(state: FluidState, boxes: readonly Box[], on: boolean): void {
  state.solid.fill(0);
  state.solidsOf = boxes;
  state.solidOn = on;
  if (!on) return;
  const row = state.w + 2;
  for (const box of boxes) {
    for (let y = Math.max(0, box.y0); y < Math.min(state.h, box.y1); y += 1) state.solid.fill(1, Math.max(0, box.x0) + 1 + row * (y + 1), Math.min(state.w, box.x1) + 1 + row * (y + 1));
  }
}

/** One step of the fluid. The step is as long as the rate says, stretched by TIME. */
export function stepFluid(state: FluidState, values: Values, env: EngineEnv): void {
  const { w, h, u, v, u0, v0, ink, ink0 } = state;
  const row = w + 2;
  const dt = (1 / 30) * num(values, 'time');
  state.t += dt;
  const walls = values.walls === true;
  if (state.solidsOf !== env.solids || state.solidOn !== walls) markSolids(state, env.solids, walls);

  const size = num(values, 'splat');
  const push = num(values, 'push') / 100;
  let touched = false;

  // The pointer drags the water the way it moves and leaves ink where it goes.
  const pointer = values.pointer === 'stir' ? env.pointer : null;
  if (pointer !== null && state.was !== null) {
    const [dx, dy] = [pointer.x - state.was.x, pointer.y - state.was.y];
    const far = Math.hypot(dx, dy);
    if (far > 0.05 && far < Math.max(w, h) / 2) {
      const drag = Math.min(6, 30 * push * 0.9 + 4);
      splat(state, pointer.x, pointer.y, dx * drag, dy * drag, size, Math.min(0.5, 0.08 + far * 0.04), state.turn);
      touched = true;
    }
  }
  state.was = pointer === null ? null : { x: pointer.x, y: pointer.y };

  // Splats by themselves, so the water is alive when nobody touches it.
  const auto = num(values, 'auto') / 100;
  if (auto > 0) {
    state.nextSplat -= dt;
    if (state.nextSplat <= 0) {
      state.nextSplat = (0.4 + env.random() * 1.2) / (auto * 1.5);
      burst(state, 1, values, env);
      touched = true;
    }
  }

  // Resting: no ink, no flow and nothing new - there is nothing to work out.
  if (!touched && state.inkNow < 1e-4 && state.flowNow < 1e-3) return;
  state.solved += 1;

  const windX = (num(values, 'windX') / 100) * 14;
  const windY = (num(values, 'windY') / 100) * 14;
  const lift = (num(values, 'buoyancy') / 100) * 22;
  const swirl = (num(values, 'swirl') / 100) * 9;
  const slow = Math.max(0, 1 - (num(values, 'thickness') / 100) * 3 * dt);
  const fade = Math.max(0, 1 - (((100 - num(values, 'fade')) / 100) * 1.4 + 0.015) * dt);

  // Wind pushes where there is ink to push (still clear water stays still), and ink rises or sinks.
  if (windX !== 0 || windY !== 0 || lift !== 0) {
    for (let j = 1; j <= h; j += 1) {
      for (let i = 1; i <= w; i += 1) {
        const n = i + row * j;
        const here = Math.min(1, ink[0][n] + ink[1][n] + ink[2][n]);
        if (here <= 0) continue;
        u[n] += windX * here * dt * 4;
        v[n] += (windY - lift) * here * dt * 4;
      }
    }
  }

  // The swirl: where the water turns, it is turned a little more, so curls hold instead of smearing out.
  if (swirl > 0) {
    const curl = state.p;
    for (let j = 1; j <= h; j += 1) for (let i = 1; i <= w; i += 1) curl[i + row * j] = 0.5 * (v[i + 1 + row * j] - v[i - 1 + row * j] - u[i + row * (j + 1)] + u[i + row * (j - 1)]);
    for (let j = 2; j < h; j += 1) {
      for (let i = 2; i < w; i += 1) {
        const n = i + row * j;
        const dx = 0.5 * (Math.abs(curl[n + 1]) - Math.abs(curl[n - 1]));
        const dy = 0.5 * (Math.abs(curl[n + row]) - Math.abs(curl[n - row]));
        const length = Math.hypot(dx, dy) + 1e-5;
        u[n] += dt * swirl * (dy / length) * curl[n];
        v[n] -= dt * swirl * (dx / length) * curl[n];
      }
    }
  }

  for (let n = 0; n < u.length; n += 1) {
    u[n] *= slow;
    v[n] *= slow;
  }
  holdSolids(state);
  project(state);
  u0.set(u);
  v0.set(v);
  carry(state, u, u0, dt);
  carry(state, v, v0, dt);
  edges(state, u, 1);
  edges(state, v, 2);
  holdSolids(state);
  project(state);
  let inkSum = 0;
  for (const one of ink) {
    ink0.set(one);
    carry(state, one, ink0, dt);
    for (let n = 0; n < one.length; n += 1) {
      const kept = one[n] * fade;
      // The last trace goes out, so a calm sea is truly empty and can rest.
      one[n] = kept < 0.004 ? 0 : kept;
      inkSum += one[n];
    }
    edges(state, one, 0);
  }
  holdSolids(state);
  let flow = 0;
  for (let j = 1; j <= h; j += 1) for (let i = 1; i <= w; i += 1) flow += Math.abs(u[i + row * j]) + Math.abs(v[i + row * j]);
  state.inkNow = inkSum / (w * h);
  state.flowNow = flow / (w * h);
}

/** Splats at random places, each with a push in a random direction and the next ink in turn. */
export function burst(state: FluidState, count: number, values: Values, env: EngineEnv): void {
  const size = num(values, 'splat');
  const push = num(values, 'push') / 100;
  for (let n = 0; n < count; n += 1) {
    const angle = env.random() * Math.PI * 2;
    const force = (10 + env.random() * 30) * (0.3 + push);
    state.turn = (state.turn + 1) % 3;
    // Somewhere it can be seen: a place under the site window is tried again, a few times.
    let [x, y] = [env.random() * state.w, env.random() * state.h];
    for (let tries = 0; tries < 12 && state.solid[Math.floor(x) + 1 + (state.w + 2) * (Math.floor(y) + 1)] === 1; tries += 1) [x, y] = [env.random() * state.w, env.random() * state.h];
    splat(state, x, y, Math.cos(angle) * force, Math.sin(angle) * force, size * (0.8 + env.random() * 0.8), 0.9, state.turn);
  }
  // (Counted at once, so the step that follows doesn't take the water for empty and rest.)
  state.inkNow = Math.max(state.inkNow, 0.001);
}

export function fluidAction(state: FluidState, action: string, values: Values, env: EngineEnv): void {
  if (action === 'splat') burst(state, 5 + Math.floor(env.random() * 8), values, env);
  else if (action === 'calm') {
    state.u.fill(0);
    state.v.fill(0);
  } else if (action === 'clear') {
    state.u.fill(0);
    state.v.fill(0);
    for (const one of state.ink) one.fill(0);
    state.inkNow = 0;
    state.flowNow = 0;
  }
}

/** A press on the bare background: one big splat there, pushed a random way. */
export function fluidPress(state: FluidState, x: number, y: number, values: Values, env: EngineEnv): void {
  const angle = env.random() * Math.PI * 2;
  state.turn = (state.turn + 1) % 3;
  splat(state, x, y, Math.cos(angle) * 40, Math.sin(angle) * 40, num(values, 'splat') * 1.8, 1.2, state.turn);
  state.inkNow = Math.max(state.inkNow, 0.001);
}

type DyeName = (typeof DYES)[number];

/** The three inks of each colour set. RAINBOW's are worked out, not dyes: red, green and blue, which mix to every colour. */
const SETS: Readonly<Record<string, readonly [DyeName, DyeName, DyeName] | null>> = {
  dyes: ['brilliant-pink', 'royal-blue', 'daffodil'],
  fire: ['daffodil', 'tangerine', 'rose'],
  sea: ['royal-blue', 'light-blue', 'mint'],
  mono: ['white', 'moon-ink', 'ash'],
  rainbow: null,
};

/** The 4x4 pattern an ordered dither goes by: which cells of a block tip up to the next step first. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The grid as colours: the three inks mixed, cut to COLOUR STEPS levels with an ordered dither. No ink: left for the black behind. */
export function renderFluid(state: FluidState, values: Values, pixels: Uint32Array, palette: Palette): void {
  const { w, h, ink } = state;
  const row = w + 2;
  const chosen = values.colours as string;
  // (RAINBOW's entry is null on purpose, so "not in the list" and "worked out" must not be told apart by `??`.)
  const set = chosen in SETS ? SETS[chosen] : SETS.dyes;
  const inks = set === null ? [wheel(0), wheel(1 / 3), wheel(2 / 3)] : set.map((name) => dye(palette, name));
  const parts = inks.map((colour) => [colour & 255, (colour >>> 8) & 255, (colour >>> 16) & 255]);
  const steps = Math.max(2, Math.round(num(values, 'steps')));
  const dither = num(values, 'dither') / 100;
  const fold = values.mirror as string;
  const level = 255 / (steps - 1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // KALEIDOSCOPE: the picture is one corner of the water (or half a corner), turned over into the rest.
      let sx = fold === 'off' ? x : x < w / 2 ? x : w - 1 - x;
      let sy = fold === '4' || fold === '8' ? (y < h / 2 ? y : h - 1 - y) : y;
      if (fold === '8' && sx * h > sy * w) {
        const turned = Math.min(w - 1, Math.floor((sy * w) / h));
        sy = Math.min(h - 1, Math.floor((sx * h) / w));
        sx = turned;
      }
      const n = sx + 1 + row * (sy + 1);
      const [a, b, c] = [ink[0][n], ink[1][n], ink[2][n]];
      const out = y * w + x;
      if (a + b + c <= 0.01) {
        pixels[out] = 0;
        continue;
      }
      const nudge = ((BAYER[(x & 3) + ((y & 3) << 2)] + 0.5) / 16 - 0.5) * dither * level;
      const cut = (value: number) => Math.min(255, Math.max(0, Math.round((Math.min(255, value) + nudge) / level) * level));
      const r = cut(a * parts[0][0] + b * parts[1][0] + c * parts[2][0]);
      const g = cut(a * parts[0][1] + b * parts[1][1] + c * parts[2][1]);
      const bl = cut(a * parts[0][2] + b * parts[1][2] + c * parts[2][2]);
      pixels[out] = r + g + bl === 0 ? 0 : pixel(r, g, bl);
    }
  }
}

export const fluidEngine: Engine<FluidState> = {
  id: 'fluid',
  cell: (values) => num(values, 'cell'),
  rate: () => 30,
  init: (env, values) => {
    const state = newFluid(env.w, env.h);
    markSolids(state, env.solids, values.walls === true);
    // It starts with a few splats, so there is something to see at once (and something in the one still frame).
    burst(state, 4, values, env);
    return state;
  },
  step: stepFluid,
  render: renderFluid,
  action: fluidAction,
  press: fluidPress,
  meters: (state) => [
    { id: 'ink', label: 'INK', value: Math.round(state.inkNow * 1000), most: 400 },
    { id: 'flow', label: 'FLOW', value: Math.round(state.flowNow * 10), most: 60 },
  ],
  stillSteps: 45,
};
