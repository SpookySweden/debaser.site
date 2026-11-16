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
  /** When (in the fluid's time) what is solid last changed, to tell how fast a window moved. */
  solidAt: number;
  /** The windows that are moving just now, each with its speed in cells a second: they shove the water as they go. */
  movers: { box: Box; vx: number; vy: number }[];
  /** Until when (the fluid's time) the movers count: a window that stops sends no word, so the push runs out by itself. */
  moversUntil: number;
};

const num = (values: Values, key: string): number => values[key] as number;

export function newFluid(w: number, h: number): FluidState {
  const size = (w + 2) * (h + 2);
  const field = () => new Float32Array(size);
  return {
    w, h, u: field(), v: field(), u0: field(), v0: field(), p: field(), div: field(), ink: [field(), field(), field()], ink0: field(),
    solid: new Uint8Array(size), solidsOf: null, solidOn: false, t: 0, was: null, nextSplat: 0.5, turn: 0, inkNow: 0, flowNow: 0, solved: 0,
    solidAt: 0, movers: [], moversUntil: 0,
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

/**
 * Where the page is solid the water doesn't move and holds no ink. `moving`: a window being dragged moves at its own speed
 * instead, so the pressure step makes the water in front of it give way and the water behind it follow (list 4, Luke: "push
 * the fluid in a fun way rather than ever deleting the fluid under it").
 */
function holdSolids(state: FluidState, moving = false): void {
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
  if (!moving || state.movers.length === 0 || state.t > state.moversUntil) return;
  const row = state.w + 2;
  for (const { box, vx, vy } of state.movers) {
    for (let y = Math.max(0, box.y0); y < Math.min(state.h, box.y1); y += 1) {
      for (let x = Math.max(0, box.x0); x < Math.min(state.w, box.x1); x += 1) {
        const n = x + 1 + row * (y + 1);
        u[n] = vx;
        v[n] = vy;
      }
    }
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

/** The fastest a window shoves the water, in cells a second: a flung window is a big push, not a blast that tears it apart. */
export const MOVER_TOP_SPEED = 60;

/**
 * What is solid changed while the walls were on (list 4): a window moved, opened, closed or changed size. Nothing is deleted:
 *
 * - ink a window comes down on is shoved out past its nearest edge (the edge it is heading for, when it moves), so a window
 *   dragged through ink ploughs it along instead of wiping it;
 * - a window that moved is remembered with its speed for a moment, and `holdSolids` lets it push the water (the movers);
 * - where a window stood and no longer does, the ink round it runs in: each freed cell takes the ink of the nearest open
 *   water outside, fading with how deep in it is, so there is never a hard black hole;
 * - a window that is gone altogether (closed or put away, nothing of it left) makes the water there churn as it goes:
 *   a few counter-turning curls the size of the window, which carry the ink in from its edges and fold it through the
 *   middle, so the space fills with swirling colour instead of sitting as a black square (Luke: "creativeley disperses").
 */
function moveSolids(state: FluidState, boxes: readonly Box[], values: Values, env: EngineEnv, dt: number): void {
  const { w, h, solid, ink, u, v } = state;
  const row = w + 2;
  const before = solid.slice();
  const old = state.solidsOf ?? [];
  markSolids(state, boxes, true);
  const elapsed = Math.min(4 * dt, Math.max(dt, state.t - state.solidAt));
  state.solidAt = state.t;

  // Which window is which: the same size, nearest to where it was. A window that changed size is not a mover.
  const used = new Set<number>();
  const movers: FluidState['movers'] = [];
  const motion = new Map<Box, { vx: number; vy: number }>();
  for (const box of boxes) {
    let best = -1;
    let bestFar = Infinity;
    old.forEach((was, n) => {
      if (used.has(n) || was.x1 - was.x0 !== box.x1 - box.x0 || was.y1 - was.y0 !== box.y1 - box.y0) return;
      const far = Math.abs(was.x0 - box.x0) + Math.abs(was.y0 - box.y0);
      if (far < bestFar) [best, bestFar] = [n, far];
    });
    if (best < 0) continue;
    used.add(best);
    if (bestFar === 0) continue;
    const top = (speed: number) => Math.max(-MOVER_TOP_SPEED, Math.min(MOVER_TOP_SPEED, speed));
    const speed = { vx: top((box.x0 - old[best].x0) / elapsed), vy: top((box.y0 - old[best].y0) / elapsed) };
    motion.set(box, speed);
    movers.push({ box, ...speed });
  }
  state.movers = movers;
  state.moversUntil = state.t + 3 * dt;

  // Ink a window has come down on goes out past its edge.
  for (const box of boxes) {
    const speed = motion.get(box) ?? { vx: 0, vy: 0 };
    const going = Math.hypot(speed.vx, speed.vy);
    for (let y = Math.max(0, box.y0); y < Math.min(h, box.y1); y += 1) {
      for (let x = Math.max(0, box.x0); x < Math.min(w, box.x1); x += 1) {
        const n = x + 1 + row * (y + 1);
        if (before[n] === 1) continue;
        const a = ink[0][n] + ink[1][n] + ink[2][n];
        if (a <= 0) continue;
        // Out each way, nearest first; the way the window is heading counts as much nearer. The ink is folded out as far
        // past the edge as it was in from it, so a window landing on a pool spreads it round itself instead of piling it
        // all into one line (nearer, if that far out is not open water).
        const ways = [
          { ex: box.x1 - 1, ey: y, far: box.x1 - x, dx: 1, dy: 0 },
          { ex: box.x0, ey: y, far: x - box.x0 + 1, dx: -1, dy: 0 },
          { ex: x, ey: box.y1 - 1, far: box.y1 - y, dx: 0, dy: 1 },
          { ex: x, ey: box.y0, far: y - box.y0 + 1, dx: 0, dy: -1 },
        ].sort((p, q) => {
          const lean = (way: { dx: number; dy: number }) => (going > 0 ? 1 + 4 * Math.max(0, (way.dx * speed.vx + way.dy * speed.vy) / going) : 1);
          return p.far / lean(p) - q.far / lean(q);
        });
        let to = -1;
        for (const way of ways) {
          for (let out = way.far; out >= 1 && to < 0; out -= 1) {
            const [tx, ty] = [way.ex + way.dx * out, way.ey + way.dy * out];
            if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
            const at = tx + 1 + row * (ty + 1);
            if (solid[at] === 0) to = at;
          }
          if (to >= 0) break;
        }
        if (to >= 0) for (const one of ink) one[to] = Math.min(2, one[to] + one[n]);
        ink[0][n] = 0;
        ink[1][n] = 0;
        ink[2][n] = 0;
      }
    }
  }

  // Where a window was: the ink round it runs in. Gone altogether, it churns as well.
  for (const was of old) {
    const gone = !boxes.some((box) => box.x0 < was.x1 && was.x0 < box.x1 && box.y0 < was.y1 && was.y0 < box.y1);
    const [bw, bh] = [Math.min(w, was.x1) - Math.max(0, was.x0), Math.min(h, was.y1) - Math.max(0, was.y0)];
    if (bw <= 0 || bh <= 0) continue;
    // How deep the ink reaches in before it has faded: further for a window that went altogether.
    const reach = gone ? Math.max(4, Math.min(bw, bh) / 5) : 3;
    for (let y = Math.max(0, was.y0); y < Math.min(h, was.y1); y += 1) {
      for (let x = Math.max(0, was.x0); x < Math.min(w, was.x1); x += 1) {
        const n = x + 1 + row * (y + 1);
        if (before[n] === 0 || solid[n] === 1) continue;
        // The nearest open water outside the window, straight out each way: the nearest with ink in it, a little further
        // out if the edge itself is clear (ink is often held a cell or two off a window's side).
        let from = -1;
        let far = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let open = -1;
          for (let step = 1; step < far && step <= Math.max(bw, bh) + 1 + reach; step += 1) {
            const [sx, sy] = [x + dx * step, y + dy * step];
            if (sx < 0 || sx >= w || sy < 0 || sy >= h) break;
            const at = sx + 1 + row * (sy + 1);
            if (before[at] === 1 || solid[at] === 1) {
              if (open >= 0) break;
              continue;
            }
            if (open < 0) open = step;
            if (ink[0][at] + ink[1][at] + ink[2][at] > 0.05 || step - open >= reach) {
              [from, far] = [at, step];
              break;
            }
          }
        }
        if (from < 0) continue;
        const part = Math.exp(-(far - 1) / reach);
        for (const one of ink) one[n] = one[from] * part;
      }
    }
    if (!gone || bw * bh < 24) continue;
    // The churn: a stream function of counter-turning curls (sin a sin b) laid over the space and a margin round it, whose
    // water runs in from round the window and through the middle. It neither piles up nor thins out, so the pressure step
    // keeps it whole. Which way the curls turn is a coin toss, so no two closings look the same.
    const margin = Math.round(Math.min(bw, bh) * 0.2);
    const [cx0, cy0] = [Math.max(0, was.x0 - margin), Math.max(0, was.y0 - margin)];
    const [cw, ch] = [Math.min(w, was.x1 + margin) - cx0, Math.min(h, was.y1 + margin) - cy0];
    const across = Math.max(2, Math.min(4, Math.round((2 * cw) / ch)));
    const down = Math.max(2, Math.min(4, Math.round((2 * ch) / cw)));
    const [a, b] = [(across * Math.PI) / cw, (down * Math.PI) / ch];
    const push = num(values, 'push') / 100;
    const speed = Math.min(MOVER_TOP_SPEED, 0.5 * Math.min(cw, ch) + 12) * (0.4 + push) * (env.random() < 0.5 ? -1 : 1);
    const strength = speed / Math.max(a, b);
    for (let y = cy0; y < cy0 + ch; y += 1) {
      for (let x = cx0; x < cx0 + cw; x += 1) {
        const n = x + 1 + row * (y + 1);
        if (solid[n] === 1) continue;
        const [px, py] = [x - cx0 + 0.5, y - cy0 + 0.5];
        u[n] += strength * b * Math.sin(a * px) * Math.cos(b * py);
        v[n] -= strength * a * Math.cos(a * px) * Math.sin(b * py);
      }
    }
    state.flowNow = Math.max(state.flowNow, 1);
  }
  state.inkNow = Math.max(state.inkNow, 0.001);
}

/**
 * The pointer's way since the last step, laid down as ink and push (list 4, Luke: "make the fluid respond better to higher
 * mouse movement speeds"). A short move is one splat where the pointer is, exactly as it always was. A long one - a fast
 * stroke - is splats all along the way it went (through every place the pointer was seen, so a curve stays a curve), a
 * little under half a splat apart so they join into one line, each pushing the way the stroke went at that point. The
 * line is as dark as a slow stroke's blot and pushes as hard along its whole length as the old one splat did at its end:
 * a fast stroke carries water and ink the whole way instead of leaving a gap and one blot. A jump across half the
 * screen (the pointer back from another window) is not a stroke. True when anything was laid down.
 */
function stroke(state: FluidState, was: { x: number; y: number }, trail: readonly { x: number; y: number }[], now: { x: number; y: number }, size: number, push: number): boolean {
  const { w, h } = state;
  const points = [was, ...trail, now];
  let length = 0;
  for (let n = 1; n < points.length; n += 1) {
    const far = Math.hypot(points[n].x - points[n - 1].x, points[n].y - points[n - 1].y);
    if (far >= Math.max(w, h) / 2) return false;
    length += far;
  }
  if (length <= 0.05) return false;
  const drag = Math.min(6, 30 * push * 0.9 + 4);
  const spacing = Math.max(1, size * 0.45);
  const count = Math.min(64, Math.ceil(length / spacing));
  if (count <= 1) {
    const [dx, dy] = [now.x - was.x, now.y - was.y];
    splat(state, now.x, now.y, dx * drag, dy * drag, size, Math.min(0.5, 0.08 + Math.hypot(dx, dy) * 0.04), state.turn);
    return true;
  }
  // Neighbouring splats overlap: about this many lie over any one cell of the line.
  // (Never under one: splats further apart than that each get their own share, not more.)
  const overlap = Math.max(1, Math.min(count, (Math.sqrt(Math.PI) * size) / (length / count)));
  const force = (length * drag) / overlap;
  const amount = Math.min(0.5, 0.08 + length * 0.04) / overlap;
  let segment = 1;
  let walked = 0;
  for (let n = 1; n <= count; n += 1) {
    const at = (length * n) / count;
    // Along the way to the segment this point lies on.
    while (segment < points.length - 1 && walked + Math.hypot(points[segment].x - points[segment - 1].x, points[segment].y - points[segment - 1].y) < at) {
      walked += Math.hypot(points[segment].x - points[segment - 1].x, points[segment].y - points[segment - 1].y);
      segment += 1;
    }
    const [a, b] = [points[segment - 1], points[segment]];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (piece <= 0) continue;
    const part = Math.min(1, (at - walked) / piece);
    splat(state, a.x + (b.x - a.x) * part, a.y + (b.y - a.y) * part, ((b.x - a.x) / piece) * force, ((b.y - a.y) / piece) * force, size, amount, state.turn);
  }
  return true;
}

/** One step of the fluid. The step is as long as the rate says, stretched by TIME. */
export function stepFluid(state: FluidState, values: Values, env: EngineEnv): void {
  const { w, h, u, v, u0, v0, ink, ink0 } = state;
  const row = w + 2;
  const dt = (1 / 30) * num(values, 'time');
  state.t += dt;
  const walls = values.walls === true;
  let touched = false;
  if (state.solidsOf !== env.solids || state.solidOn !== walls) {
    // A window moved, opened or closed while the walls were on: the water is shoved and runs in, never wiped (list 4).
    if (walls && state.solidOn && state.solidsOf !== null) {
      moveSolids(state, env.solids, values, env, dt);
      touched = true;
    } else markSolids(state, env.solids, walls);
  }

  const size = num(values, 'splat');
  const push = num(values, 'push') / 100;

  // The pointer drags the water the way it moves and leaves ink where it goes.
  const pointer = values.pointer === 'stir' ? env.pointer : null;
  if (pointer !== null && state.was !== null && stroke(state, state.was, env.trail ?? [], pointer, size, push)) touched = true;
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
  holdSolids(state, true);
  project(state);
  u0.set(u);
  v0.set(v);
  carry(state, u, u0, dt);
  carry(state, v, v0, dt);
  edges(state, u, 1);
  edges(state, v, 2);
  holdSolids(state, true);
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
