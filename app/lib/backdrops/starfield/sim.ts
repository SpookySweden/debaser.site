import { dye, mix, pixel, wheel, type Engine, type EngineEnv, type Palette, DYES } from '../engine';
import type { Values } from '../knobs';

/**
 * STARFIELD (SPEC-backgrounds.md): the Windows 98 "Starfield Simulation" screensaver, rebuilt as arithmetic. Each star is a
 * point in a box in front of the viewer; every step it comes nearer, and where it is drawn is its place divided by how far away
 * it is, so stars rush outward from one point and pass. Nothing of the original is copied: it is dots, and lines for the
 * streaks.
 *
 * On top of that: the point they come from can be moved (a pad, or the pointer), the field can spin, the stars can run
 * backwards, they can drift and fall across the screen like snow, and a press on the background is two seconds of hyperspace.
 */

export type StarState = {
  w: number;
  h: number;
  count: number;
  /** Each star's place in the box: across and up-down from -1 to 1, and how far away (0 near, 1 far). */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** How far it has drifted across the screen, in cells (FALL and WIND). */
  ox: Float32Array;
  oy: Float32Array;
  /** Where it was drawn last step, for the streak; NaN when it has only just arrived. */
  px: Float32Array;
  py: Float32Array;
  /** Where it is drawn now, and how bright (0 to 1). */
  sx: Float32Array;
  sy: Float32Array;
  lit: Float32Array;
  tone: Float32Array;
  /** Seconds of its own time, and how much hyperspace is left. */
  t: number;
  hyper: number;
  /** The point the stars come from, in cells: it follows the pointer smoothly when STEER is on. */
  cx: number;
  cy: number;
  inView: number;
};

export const MOST_STARS = 800;
const NEAR = 0.02;
/**
 * How far out the farthest stars already are, as a share of SPREAD. Wide on purpose: the middle of the screen is under the site
 * window, so a sky whose stars only fan out as they arrive would show almost none of them.
 */
const FAN = 0.45;
/** A star is at its brightest and biggest by this depth: with a wide fan most have left the screen before they are any nearer. */
const CLOSE = 0.6;

const num = (values: Values, key: string): number => values[key] as number;

export function newStars(w: number, h: number): StarState {
  const field = () => new Float32Array(MOST_STARS);
  return { w, h, count: 0, x: field(), y: field(), z: field(), ox: field(), oy: field(), px: field(), py: field(), sx: field(), sy: field(), lit: field(), tone: field(), t: 0, hyper: 0, cx: w / 2, cy: h / 2, inView: 0 };
}

/** A star put somewhere new in the box: anywhere in depth when the field is first filled, at the far end after that. */
function scatter(state: StarState, n: number, random: () => number, far: boolean): void {
  state.x[n] = random() * 2 - 1;
  state.y[n] = random() * 2 - 1;
  state.z[n] = far ? 1 : NEAR + random() * (1 - NEAR);
  state.ox[n] = 0;
  state.oy[n] = 0;
  state.px[n] = Number.NaN;
  state.py[n] = Number.NaN;
  state.tone[n] = random();
}

/** How long hyperspace lasts, in seconds. */
export const HYPER_SECONDS = 2;

/** One step: a thirtieth of a second of the stars' own time, stretched by TIME. */
export function stepStars(state: StarState, values: Values, env: EngineEnv): void {
  const { w, h } = state;
  const random = env.random;
  const dt = (1 / 30) * num(values, 'time');
  state.t += dt;
  state.hyper = Math.max(0, state.hyper - dt);

  // The field is filled or thinned to STARS.
  const wanted = Math.min(MOST_STARS, Math.round(num(values, 'stars')));
  while (state.count < wanted) {
    scatter(state, state.count, random, false);
    state.count += 1;
  }
  if (state.count > wanted) state.count = wanted;

  const rush = state.hyper > 0 ? 6 : 1;
  const speed = (num(values, 'speed') / 100) * 0.9 * rush * (values.reverse === true ? -1 : 1);
  const spin = (num(values, 'spin') / 100) * 1.2 * dt;
  const [cos, sin] = [Math.cos(spin), Math.sin(spin)];
  const spread = (num(values, 'spread') / 100) * Math.max(w, h) * 0.9;
  const wind = (num(values, 'wind') / 100) * 30 * dt;
  const fall = (num(values, 'fall') / 100) * 30 * dt;
  const twinkle = num(values, 'twinkle') / 100;

  // Where they come from: the pad's place, or (STEER) wherever the pointer is, followed smoothly.
  let [tx, ty] = [w / 2 + (num(values, 'originX') / 100) * (w / 2), h / 2 + (num(values, 'originY') / 100) * (h / 2)];
  if (values.steer === true && env.pointer !== null) [tx, ty] = [env.pointer.x, env.pointer.y];
  state.cx += (tx - state.cx) * Math.min(1, dt * 4);
  state.cy += (ty - state.cy) * Math.min(1, dt * 4);

  let inView = 0;
  for (let n = 0; n < state.count; n += 1) {
    state.px[n] = state.sx[n];
    state.py[n] = Number.isNaN(state.px[n]) ? Number.NaN : state.sy[n];
    if (Number.isNaN(state.px[n]) || state.lit[n] <= 0) {
      state.px[n] = Number.NaN;
      state.py[n] = Number.NaN;
    }
    if (spin !== 0) {
      const [x, y] = [state.x[n], state.y[n]];
      state.x[n] = x * cos - y * sin;
      state.y[n] = x * sin + y * cos;
    }
    state.z[n] -= speed * dt;
    state.ox[n] += wind;
    state.oy[n] += fall;
    let sx = state.cx + (state.x[n] / state.z[n]) * spread * FAN + state.ox[n];
    let sy = state.cy + (state.y[n] / state.z[n]) * spread * FAN + state.oy[n];
    // Drifting stars come round again on the other side: snow never runs out.
    if (wind !== 0 || fall !== 0) {
      if (sx < 0 || sx >= w) {
        state.ox[n] -= Math.floor(sx / w) * w;
        sx = ((sx % w) + w) % w;
        state.px[n] = Number.NaN;
      }
      if (sy < 0 || sy >= h) {
        state.oy[n] -= Math.floor(sy / h) * h;
        sy = ((sy % h) + h) % h;
        state.px[n] = Number.NaN;
      }
    }
    const gone = state.z[n] <= NEAR || state.z[n] > 1 || sx < -w || sx > w * 2 || sy < -h || sy > h * 2 || (fall === 0 && wind === 0 && (sx < 0 || sx >= w || sy < 0 || sy >= h) && speed > 0);
    if (gone) {
      // Past the viewer (or, running backwards, back at the far end): it starts again.
      scatter(state, n, random, speed >= 0);
      if (speed < 0) state.z[n] = NEAR * 2 + random() * 0.1;
      state.sx[n] = Number.NaN;
      state.sy[n] = Number.NaN;
      state.lit[n] = 0;
      continue;
    }
    state.sx[n] = sx;
    state.sy[n] = sy;
    // Brighter as it nears, with a flicker of its own.
    const near = Math.min(1, (1 - state.z[n]) / CLOSE);
    state.lit[n] = Math.min(1, Math.max(0.12, 0.25 + near * 0.9)) * (1 - twinkle * 0.7 * (0.5 + 0.5 * Math.sin(state.t * (3 + state.tone[n] * 7) + state.tone[n] * 40)));
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) inView += 1;
  }
  state.inView = inView;
}

/** A press on the bare background: two seconds of hyperspace. */
export function starsPress(state: StarState): void {
  state.hyper = HYPER_SECONDS;
}

type DyeName = (typeof DYES)[number];

const SETS: Readonly<Record<string, readonly DyeName[]>> = {
  white: ['white'],
  dyes: ['white', 'daffodil', 'light-blue', 'brilliant-pink', 'mint'],
  warm: ['vellum', 'daffodil', 'tangerine', 'salmon'],
};

function dot(pixels: Uint32Array, w: number, h: number, x: number, y: number, size: number, colour: number): void {
  const [x0, y0] = [Math.round(x), Math.round(y)];
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const [px, py] = [x0 + dx, y0 + dy];
      if (px >= 0 && px < w && py >= 0 && py < h) pixels[py * w + px] = colour;
    }
  }
}

/** A straight run of cells from one place to another. */
export function line(pixels: Uint32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, size: number, colour: number): void {
  let [x, y] = [Math.round(x0), Math.round(y0)];
  const [ex, ey] = [Math.round(x1), Math.round(y1)];
  const [dx, dy] = [Math.abs(ex - x), -Math.abs(ey - y)];
  const [stepX, stepY] = [x < ex ? 1 : -1, y < ey ? 1 : -1];
  let error = dx + dy;
  // No line here is longer than the grid's two sides together; anything longer is a mistake, and is not drawn for ever.
  for (let guard = 0; guard <= w + h + 4; guard += 1) {
    dot(pixels, w, h, x, y, size, colour);
    if (x === ex && y === ey) return;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += stepX;
    }
    if (twice <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

/** The stars as colours: a dot each, bigger as it nears, with a streak back to where it was when WARP is up. */
export function renderStars(state: StarState, values: Values, pixels: Uint32Array, palette: Palette): void {
  const { w, h } = state;
  pixels.fill(0);
  const chosen = values.colours as string;
  const set = chosen === 'rainbow' ? null : (SETS[chosen] ?? SETS.white).map((name) => dye(palette, name));
  const black = pixel(0, 0, 0);
  const biggest = Math.max(1, Math.round(num(values, 'size')));
  const warp = (state.hyper > 0 ? 1 : num(values, 'warp') / 100) * 1.0;
  for (let n = 0; n < state.count; n += 1) {
    const lit = state.lit[n];
    if (lit <= 0 || Number.isNaN(state.sx[n])) continue;
    const base = set === null ? wheel(state.tone[n]) : set[Math.floor(state.tone[n] * set.length) % set.length];
    const colour = mix(black, base, lit);
    const nearness = Math.min(1, (1 - state.z[n]) / CLOSE);
    const size = Math.max(1, Math.round(1 + (biggest - 1) * nearness * nearness));
    if (warp > 0 && !Number.isNaN(state.px[n])) {
      // The streak: back along the way it came, as long as WARP says.
      const [bx, by] = [state.sx[n] + (state.px[n] - state.sx[n]) * warp * 6, state.sy[n] + (state.py[n] - state.sy[n]) * warp * 6];
      // Drawn from the star backwards, so that a streak whose far end is off the screen is still drawn where it is on it.
      if (Math.abs(bx - state.sx[n]) + Math.abs(by - state.sy[n]) < w + h) line(pixels, w, h, state.sx[n], state.sy[n], bx, by, 1, mix(black, colour, 0.6));
    }
    dot(pixels, w, h, state.sx[n], state.sy[n], size, colour);
  }
}

export const starfieldEngine: Engine<StarState> = {
  id: 'starfield',
  cell: (values) => num(values, 'cell'),
  rate: () => 30,
  init: (env) => newStars(env.w, env.h),
  step: stepStars,
  render: renderStars,
  press: (state) => starsPress(state),
  meters: (state) => [{ id: 'stars', label: 'STARS IN VIEW', value: state.inView, most: Math.max(1, state.count) }],
  stillSteps: 30,
};
