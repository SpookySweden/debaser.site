import { dye, mix, pixel, wheel, type Box, type Engine, type EngineEnv, type Palette, DYES } from '../engine';
import type { Values } from '../knobs';
import { line } from '../starfield/sim';

/**
 * MYSTIFY (SPEC-backgrounds.md): the Windows 98 "Mystify Your Mind" screensaver, rebuilt as arithmetic. A few shapes whose
 * corners each fly in a straight line and bounce off the edges of the screen; the lines between the corners are drawn, and the
 * last few places the shape has been are drawn behind it, fainter. Nothing of the original is copied: it is lines.
 *
 * On top of that the corners can be given weight (GRAVITY), joined by springs so a shape wobbles like jelly, pulled or pushed
 * by the pointer, and made to bounce off the site window as well as the screen.
 */

export const MOST_SHAPES = 6;
export const MOST_CORNERS = 8;
export const MOST_TRAILS = 40;

export type MystifyShape = {
  /** Its corners' places and speeds, in cells and cells a second. */
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  /** Where it has been: its corners' places at each of the last steps kept, the newest first. */
  trail: { x: number[]; y: number[] }[];
  /** Where it is on the colour wheel (0 to 1), and how often it is kept for the trail. */
  hue: number;
};

export type MystifyState = { w: number; h: number; shapes: MystifyShape[]; t: number; tick: number };

const num = (values: Values, key: string): number => values[key] as number;

export function newMystify(w: number, h: number): MystifyState {
  return { w, h, shapes: [], t: 0, tick: 0 };
}

/** The speed a corner flies at with nothing acting on it, in cells a second. */
const cruise = (values: Values, state: MystifyState) => (num(values, 'speed') / 100) * Math.max(state.w, state.h) * 0.35 + 2;

function newCorner(shape: MystifyShape, state: MystifyState, values: Values, random: () => number): void {
  const angle = random() * Math.PI * 2;
  const pace = cruise(values, state) * (0.6 + random() * 0.8);
  shape.x.push(random() * state.w);
  shape.y.push(random() * state.h);
  shape.vx.push(Math.cos(angle) * pace);
  shape.vy.push(Math.sin(angle) * pace);
}

/** Pushes a corner out of a solid box by its nearest side and turns it back. */
function bounceOff(shape: MystifyShape, n: number, box: Box): void {
  const [x, y] = [shape.x[n], shape.y[n]];
  if (x <= box.x0 || x >= box.x1 || y <= box.y0 || y >= box.y1) return;
  const sides = [x - box.x0, box.x1 - x, y - box.y0, box.y1 - y];
  const nearest = sides.indexOf(Math.min(...sides));
  if (nearest === 0) [shape.x[n], shape.vx[n]] = [box.x0, -Math.abs(shape.vx[n])];
  else if (nearest === 1) [shape.x[n], shape.vx[n]] = [box.x1, Math.abs(shape.vx[n])];
  else if (nearest === 2) [shape.y[n], shape.vy[n]] = [box.y0, -Math.abs(shape.vy[n])];
  else [shape.y[n], shape.vy[n]] = [box.y1, Math.abs(shape.vy[n])];
}

/** One step: a thirtieth of a second of its own time, stretched by TIME. */
export function stepMystify(state: MystifyState, values: Values, env: EngineEnv): void {
  const { w, h } = state;
  const random = env.random;
  const dt = (1 / 30) * num(values, 'time');
  state.t += dt;
  state.tick += 1;

  // As many shapes as SHAPES, each with CORNERS corners.
  const shapes = Math.min(MOST_SHAPES, Math.round(num(values, 'shapes')));
  const corners = Math.min(MOST_CORNERS, Math.round(num(values, 'corners')));
  while (state.shapes.length < shapes) state.shapes.push({ x: [], y: [], vx: [], vy: [], trail: [], hue: state.shapes.length / Math.max(1, shapes) + random() * 0.1 });
  if (state.shapes.length > shapes) state.shapes.length = shapes;

  const pace = cruise(values, state);
  const gravity = (num(values, 'gravity') / 100) * Math.max(w, h) * 0.9;
  const springs = (num(values, 'springs') / 100) * 6;
  const pull = values.pointer === 'pull' ? 1 : values.pointer === 'push' ? -1 : 0;
  const solid = values.solid === true;
  const trails = Math.min(MOST_TRAILS, Math.round(num(values, 'trails')));
  const every = Math.max(1, Math.round(num(values, 'gap')));
  const free = gravity === 0 && springs === 0 && (pull === 0 || env.pointer === null);

  for (const shape of state.shapes) {
    while (shape.x.length < corners) newCorner(shape, state, values, random);
    if (shape.x.length > corners) {
      for (const list of [shape.x, shape.y, shape.vx, shape.vy]) list.length = corners;
      for (const past of shape.trail) {
        past.x.length = corners;
        past.y.length = corners;
      }
    }
    shape.hue = (shape.hue + (num(values, 'cycle') / 100) * 0.25 * dt) % 1;

    // Kept for the trail, every few steps.
    if (state.tick % every === 0) {
      shape.trail.unshift({ x: shape.x.slice(), y: shape.y.slice() });
      if (shape.trail.length > trails) shape.trail.length = trails;
    } else if (shape.trail.length > trails) shape.trail.length = trails;

    // The middle of the shape, which its springs pull each corner toward.
    let [mx, my] = [0, 0];
    for (let n = 0; n < corners; n += 1) {
      mx += shape.x[n];
      my += shape.y[n];
    }
    mx /= corners;
    my /= corners;
    const rest = Math.min(w, h) * 0.18;

    for (let n = 0; n < corners; n += 1) {
      if (gravity !== 0) shape.vy[n] += gravity * dt;
      if (springs > 0) {
        // Toward a place a fixed way out from the middle, in the direction it already lies: the shape keeps a size and wobbles round it.
        const [dx, dy] = [shape.x[n] - mx, shape.y[n] - my];
        const far = Math.hypot(dx, dy) || 1;
        shape.vx[n] -= (dx / far) * (far - rest) * springs * dt;
        shape.vy[n] -= (dy / far) * (far - rest) * springs * dt;
      }
      if (pull !== 0 && env.pointer !== null) {
        const [dx, dy] = [env.pointer.x - shape.x[n], env.pointer.y - shape.y[n]];
        const far = Math.hypot(dx, dy) || 1;
        const force = (pull * pace * 3.5) / (1 + far / 30);
        shape.vx[n] += (dx / far) * force * dt;
        shape.vy[n] += (dy / far) * force * dt;
      }
      const speed = Math.hypot(shape.vx[n], shape.vy[n]);
      if (free) {
        // Nothing acting on it: it flies at its own steady speed, as the screensaver's corners did (SPEED moves them all).
        const own = pace * (0.6 + ((n * 37 + state.shapes.indexOf(shape) * 17) % 80) / 100);
        if (speed > 0) {
          shape.vx[n] = (shape.vx[n] / speed) * own;
          shape.vy[n] = (shape.vy[n] / speed) * own;
        }
      } else if (speed > pace * 4) {
        shape.vx[n] = (shape.vx[n] / speed) * pace * 4;
        shape.vy[n] = (shape.vy[n] / speed) * pace * 4;
      }
      shape.x[n] += shape.vx[n] * dt;
      shape.y[n] += shape.vy[n] * dt;
      // The edges of the screen.
      if (shape.x[n] < 0) [shape.x[n], shape.vx[n]] = [-shape.x[n], Math.abs(shape.vx[n])];
      if (shape.x[n] > w - 1) [shape.x[n], shape.vx[n]] = [2 * (w - 1) - shape.x[n], -Math.abs(shape.vx[n])];
      if (shape.y[n] < 0) [shape.y[n], shape.vy[n]] = [-shape.y[n], Math.abs(shape.vy[n])];
      if (shape.y[n] > h - 1) [shape.y[n], shape.vy[n]] = [2 * (h - 1) - shape.y[n], -Math.abs(shape.vy[n])];
      shape.x[n] = Math.min(w - 1, Math.max(0, shape.x[n]));
      shape.y[n] = Math.min(h - 1, Math.max(0, shape.y[n]));
      if (solid) for (const box of env.solids) bounceOff(shape, n, box);
    }
  }
}

type DyeName = (typeof DYES)[number];

const SETS: Readonly<Record<string, readonly DyeName[]>> = {
  dyes: ['brilliant-pink', 'daffodil', 'light-blue', 'emerald', 'tangerine', 'orchid'],
  cool: ['royal-blue', 'light-blue', 'mint', 'orchid', 'white', 'emerald'],
  mono: ['white', 'moon-ink', 'vellum', 'ash', 'white', 'moon-ink'],
};

/** The colour of a shape just now: round the wheel for RAINBOW, or between two dyes of its set and on to the next. */
function colourOf(shape: MystifyShape, values: Values, palette: Palette, n: number): number {
  const chosen = values.colours as string;
  if (chosen === 'rainbow') return wheel(shape.hue + n / 6);
  const set = SETS[chosen] ?? SETS.dyes;
  const at = ((shape.hue + n / set.length) % 1) * set.length;
  return mix(dye(palette, set[Math.floor(at) % set.length]), dye(palette, set[(Math.floor(at) + 1) % set.length]), at % 1);
}

/** The shapes as colours: each a closed run of lines, with its trail behind it, fainter the older. */
export function renderMystify(state: MystifyState, values: Values, pixels: Uint32Array, palette: Palette): void {
  const { w, h } = state;
  pixels.fill(0);
  const black = pixel(0, 0, 0);
  const width = Math.max(1, Math.round(num(values, 'line')));
  state.shapes.forEach((shape, index) => {
    const colour = colourOf(shape, values, palette, index);
    const draw = (xs: readonly number[], ys: readonly number[], shade: number) => {
      const count = Math.min(xs.length, ys.length);
      if (count < 2) return;
      // Two corners make one line; more make a closed shape.
      const sides = count === 2 ? 1 : count;
      for (let n = 0; n < sides; n += 1) line(pixels, w, h, xs[n], ys[n], xs[(n + 1) % count], ys[(n + 1) % count], width, shade);
    };
    // Oldest first, so the shape itself is drawn over its own trail.
    for (let n = shape.trail.length - 1; n >= 0; n -= 1) draw(shape.trail[n].x, shape.trail[n].y, mix(black, colour, 0.75 * (1 - (n + 1) / (shape.trail.length + 1)) + 0.08));
    draw(shape.x, shape.y, colour);
  });
}

export const mystifyEngine: Engine<MystifyState> = {
  id: 'mystify',
  cell: (values) => num(values, 'cell'),
  rate: () => 30,
  init: (env) => newMystify(env.w, env.h),
  step: stepMystify,
  render: renderMystify,
  meters: (state) => [{ id: 'corners', label: 'CORNERS', value: state.shapes.reduce((sum, shape) => sum + shape.x.length, 0), most: MOST_SHAPES * MOST_CORNERS }],
  stillSteps: 40,
};
