import { dye, mix, type Box, type Engine, type EngineEnv, type Palette, DYES } from '../engine';
import type { Values } from '../knobs';

/**
 * SAND (SPEC-backgrounds.md): a falling-sand toy behind the site, after SandSpiel and the write-ups of Noita's sand. A grid of
 * grains; each step every grain looks at the cells beside it and moves by a rule of its kind. Sand piles and slides, water
 * finds its level, oil floats on water, plant drinks water and grows, fire eats plant and oil and leaves smoke.
 *
 * The page is part of it: whatever is handed in as solid (the site window, docked windows, the bars) holds grains up, so sand
 * heaps on the window's top edge and pours off its corners.
 *
 * Plain arrays and arithmetic, no browser. The rows are gone through from the floor up (so a falling grain moves once a step,
 * as the Noita article has it), left to right and right to left by turns, so nothing leans one way.
 */

export const EMPTY = 0;
export const SAND = 1;
export const WATER = 2;
export const STONE = 3;
export const PLANT = 4;
export const FIRE = 5;
export const SMOKE = 6;
export const OIL = 7;

export type SandState = {
  w: number;
  h: number;
  /** What is in each cell, row by row. */
  cells: Uint8Array;
  /** Each grain's own shade, picked when it was made and carried with it. */
  tone: Uint8Array;
  /** How many steps a flame or a wisp of smoke has left. */
  life: Uint8Array;
  /** The step a cell was last moved into, so a grain is moved once a step however the rows are gone through. */
  stamp: Uint8Array;
  /** Where the page is solid. */
  solid: Uint8Array;
  solidsOf: readonly Box[] | null;
  solidOn: boolean;
  tick: number;
  /** How many grains there are, counted now and then for the meter. */
  grains: number;
};

const num = (values: Values, key: string): number => values[key] as number;

export function newSand(w: number, h: number): SandState {
  const size = Math.max(1, w * h);
  return { w, h, cells: new Uint8Array(size), tone: new Uint8Array(size), life: new Uint8Array(size), stamp: new Uint8Array(size), solid: new Uint8Array(size), solidsOf: null, solidOn: false, tick: 0, grains: 0 };
}

/** Puts a grain in a cell (or rubs one out). Nothing goes into a solid cell. */
export function place(state: SandState, x: number, y: number, kind: number, random: () => number, life = 0): void {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
  const i = y * state.w + x;
  if (state.solid[i] === 1) return;
  state.cells[i] = kind;
  state.tone[i] = Math.floor(random() * 256);
  state.life[i] = kind === FIRE || kind === SMOKE ? Math.max(1, Math.min(255, Math.round(life))) : 0;
}

const GRAINS: Readonly<Record<string, number>> = { sand: SAND, water: WATER, stone: STONE, plant: PLANT, fire: FIRE, oil: OIL, erase: EMPTY };
const MIX = [SAND, WATER, OIL, PLANT, FIRE] as const;

function markSolids(state: SandState, boxes: readonly Box[], on: boolean): void {
  state.solid.fill(0);
  state.solidsOf = boxes;
  state.solidOn = on;
  if (!on) return;
  for (const box of boxes) {
    const [x0, x1, y0, y1] = [Math.max(0, box.x0), Math.min(state.w, box.x1), Math.max(0, box.y0), Math.min(state.h, box.y1)];
    for (let y = y0; y < y1; y += 1) state.solid.fill(1, y * state.w + x0, y * state.w + x1);
  }
}

/** One step of the sand. */
export function stepSand(state: SandState, values: Values, env: EngineEnv): void {
  const { w, h, cells, tone, life, stamp, solid } = state;
  const random = env.random;
  state.tick += 1;
  const mark = (state.tick & 127) + 1;
  const wantSolid = values.solid === true;
  if (state.solidsOf !== env.solids || state.solidOn !== wantSolid) markSolids(state, env.solids, wantSolid);

  const gravity = num(values, 'gravity');
  const down = gravity >= 0 ? 1 : -1;
  const pull = Math.min(1, Math.abs(gravity) / 100);
  const wind = num(values, 'wind') / 100;
  const flow = num(values, 'flow');
  const drain = values.drain === true;
  const fireLife = num(values, 'fireLife');
  const spread = (num(values, 'fireSpread') / 100) * 0.25;
  const grow = (num(values, 'grow') / 100) * 0.05;
  const dry = (num(values, 'evaporate') / 100) * 0.004;

  // Pouring: the chosen grain, in a round brush under the pointer, while it is held down.
  if (env.pointer !== null && env.pointer.down) {
    const kind = GRAINS[values.grain as string] ?? SAND;
    const brush = num(values, 'brush');
    const rate = (num(values, 'pour') / 100) * (kind === EMPTY || kind === STONE || kind === PLANT ? 1 : 0.5);
    const [px, py] = [Math.round(env.pointer.x), Math.round(env.pointer.y)];
    for (let dy = -brush; dy <= brush; dy += 1) {
      for (let dx = -brush; dx <= brush; dx += 1) {
        if (dx * dx + dy * dy > brush * brush || random() > rate) continue;
        const [x, y] = [px + dx, py + dy];
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        // A grain is poured into empty space; only the rubber and stone go over what is there.
        if (kind !== EMPTY && kind !== STONE && cells[y * w + x] !== EMPTY) continue;
        place(state, x, y, kind, random, fireLife);
      }
    }
  }

  // Rain: grains let in along the top (the bottom, with gravity turned over), in a band round the middle.
  const rain = (num(values, 'rain') / 100) * w * 0.02;
  if (rain > 0) {
    const half = Math.max(1, (num(values, 'rainWide') / 100) * w * 0.5);
    const top = down === 1 ? 0 : h - 1;
    const drops = Math.floor(rain) + (random() < rain % 1 ? 1 : 0);
    for (let n = 0; n < drops; n += 1) {
      const x = Math.floor(w / 2 - half + random() * half * 2);
      if (x < 0 || x >= w) continue;
      // It comes in just under whatever covers the top of its column (the guest strip is solid, and rain behind it would never be seen).
      let from = top;
      while (from >= 0 && from < h && solid[from * w + x] === 1) from += down;
      if (from < 0 || from >= h || cells[from * w + x] !== EMPTY) continue;
      const of = values.rainOf as string;
      place(state, x, from, of === 'mix' ? MIX[Math.floor(random() * MIX.length) % MIX.length] : (GRAINS[of] ?? SAND), random, fireLife);
    }
  }

  const leftFirst = (state.tick & 1) === 0;
  const move = (from: number, to: number) => {
    cells[to] = cells[from];
    tone[to] = tone[from];
    life[to] = life[from];
    stamp[to] = mark;
    cells[from] = EMPTY;
  };
  const swap = (a: number, b: number) => {
    const [kind, shade, left] = [cells[b], tone[b], life[b]];
    cells[b] = cells[a];
    tone[b] = tone[a];
    life[b] = life[a];
    cells[a] = kind;
    tone[a] = shade;
    life[a] = left;
    stamp[a] = mark;
    stamp[b] = mark;
  };
  const open = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && cells[y * w + x] === EMPTY && solid[y * w + x] === 0;

  // From the floor up (whichever way the floor is), so that a grain falls into space the one under it has just left.
  for (let row = 0; row < h; row += 1) {
    const y = down === 1 ? h - 1 - row : row;
    for (let col = 0; col < w; col += 1) {
      const x = leftFirst ? col : w - 1 - col;
      const i = y * w + x;
      const kind = cells[i];
      if (kind === EMPTY || kind === STONE || stamp[i] === mark || solid[i] === 1) continue;

      if (kind === SAND || kind === WATER || kind === OIL) {
        if (kind === WATER && dry > 0 && random() < dry && open(x, y - down)) {
          cells[i] = EMPTY;
          continue;
        }
        if (random() > pull) continue;
        const ny = y + down;
        if (ny < 0 || ny >= h) {
          // The floor: open (the grain is gone) or shut (it rests, and a liquid still spreads).
          if (drain) {
            cells[i] = EMPTY;
            continue;
          }
        } else {
          const below = ny * w + x;
          if (solid[below] === 0) {
            const under = cells[below];
            if (under === EMPTY) {
              // Falling, and carried a little by the wind as it goes.
              const blown = wind !== 0 && random() < Math.abs(wind) * 0.35 ? x + (wind > 0 ? 1 : -1) : x;
              move(i, open(blown, ny) ? ny * w + blown : below);
              continue;
            }
            // Heavier things sink through lighter ones: sand through water and oil, water through oil.
            if ((kind === SAND && (under === WATER || under === OIL)) || (kind === WATER && under === OIL)) {
              if (stamp[below] !== mark) swap(i, below);
              continue;
            }
          }
          // Not straight down: to one side or the other of it.
          const first = random() < 0.5 + wind * 0.5 ? 1 : -1;
          if (open(x + first, ny)) {
            move(i, ny * w + x + first);
            continue;
          }
          if (open(x - first, ny)) {
            move(i, ny * w + x - first);
            continue;
          }
        }
        if (kind === SAND) continue;
        // A liquid that can't go down runs along: as far as it is runny, until something is in the way.
        const reach = kind === WATER ? flow : Math.max(1, Math.round(flow / 2));
        const way = random() < 0.5 + wind * 0.5 ? 1 : -1;
        let far = 0;
        while (far < reach && open(x + way * (far + 1), y)) far += 1;
        if (far > 0) move(i, y * w + x + way * far);
        else if (open(x - way, y)) move(i, y * w + x - way);
        continue;
      }

      if (kind === PLANT) {
        if (grow <= 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (cells[n] === WATER && random() < grow) {
            cells[n] = PLANT;
            stamp[n] = mark;
          }
        }
        continue;
      }

      // Fire and smoke: both have their time, and both go up.
      if (life[i] <= 1) {
        if (kind === FIRE && random() < 0.4) {
          cells[i] = SMOKE;
          life[i] = 14 + Math.floor(random() * 20);
        } else cells[i] = EMPTY;
        continue;
      }
      life[i] -= 1;
      if (kind === FIRE) {
        let doused = false;
        /** Still touching something that burns: a flame stays on its fuel, and only a loose one floats up. */
        let fed = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (cells[n] === WATER) {
            doused = true;
            if (random() < 0.3) cells[n] = EMPTY;
          } else if (cells[n] === PLANT || cells[n] === OIL) {
            fed = true;
            if (random() < spread) {
              cells[n] = FIRE;
              life[n] = Math.max(2, Math.min(255, Math.round(fireLife * (0.6 + random() * 0.8))));
              stamp[n] = mark;
            }
          }
        }
        if (doused) {
          cells[i] = SMOKE;
          life[i] = 10 + Math.floor(random() * 12);
          continue;
        }
        if (fed || random() > 0.5) continue;
      }
      const up = y - down;
      if (up < 0 || up >= h) {
        if (kind === SMOKE) cells[i] = EMPTY;
        continue;
      }
      const drift = random() < 0.34 ? 0 : random() < 0.5 + wind * 0.5 ? 1 : -1;
      if (open(x + drift, up)) move(i, up * w + x + drift);
      else if (kind === SMOKE && open(x + (drift === 0 ? 1 : drift), y)) move(i, y * w + x + (drift === 0 ? 1 : drift));
    }
  }

  // Sifting: grains resting on something solid slowly go into it, so a heap on the window is always being fed and never just sits.
  const sift = (num(values, 'sift') / 100) * w * 0.03;
  if (sift > 0 && state.solidOn && env.solids.length > 0) {
    const tries = Math.floor(sift) + (random() < sift % 1 ? 1 : 0);
    for (let n = 0; n < tries; n += 1) {
      const box = env.solids[Math.floor(random() * env.solids.length) % env.solids.length];
      const x = box.x0 + Math.floor(random() * Math.max(1, box.x1 - box.x0));
      const y = down === 1 ? box.y0 - 1 : box.y1;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const kind = cells[y * w + x];
      if (kind === SAND || kind === WATER || kind === OIL) cells[y * w + x] = EMPTY;
    }
  }

  if (state.tick % 15 === 1) {
    let grains = 0;
    for (let i = 0; i < cells.length; i += 1) if (cells[i] !== EMPTY) grains += 1;
    state.grains = grains;
  }
}

/** The window's one-press keys. */
export function sandAction(state: SandState, action: string, values: Values, env: EngineEnv): void {
  const { w, h, cells, solid } = state;
  const random = env.random;
  if (action === 'clear') cells.fill(EMPTY);
  else if (action === 'flood') {
    const down = num(values, 'gravity') >= 0 ? 1 : -1;
    for (let y = 0; y < h; y += 1) {
      const deep = down === 1 ? y >= (h * 2) / 3 : y < h / 3;
      if (!deep) continue;
      for (let x = 0; x < w; x += 1) if (cells[y * w + x] === EMPTY && solid[y * w + x] === 0 && random() < 0.9) place(state, x, y, WATER, random);
    }
  } else if (action === 'burn') {
    for (let i = 0; i < cells.length; i += 1) {
      if ((cells[i] === PLANT || cells[i] === OIL) && random() < 0.5) {
        cells[i] = FIRE;
        state.life[i] = Math.max(2, Math.min(255, Math.round(num(values, 'fireLife') * (0.6 + random() * 0.8))));
      }
    }
  } else if (action === 'shake') {
    // Everything loose jumps to somewhere near it.
    for (let i = 0; i < cells.length; i += 1) {
      const kind = cells[i];
      if (kind === EMPTY || kind === STONE || kind === PLANT || random() < 0.4) continue;
      const x = (i % w) + Math.round((random() - 0.5) * 14);
      const y = Math.floor(i / w) + Math.round((random() - 0.5) * 14);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const to = y * w + x;
      if (cells[to] !== EMPTY || solid[to] === 1) continue;
      cells[to] = kind;
      state.tone[to] = state.tone[i];
      state.life[to] = state.life[i];
      cells[i] = EMPTY;
    }
  }
}

type DyeName = (typeof DYES)[number];
type Pair = readonly [DyeName, DyeName];

/** Each colour set: two dyes a kind of grain is shaded between, and the three a flame goes through as it burns down. */
const SETS: Readonly<Record<string, { kinds: Readonly<Record<number, Pair>>; fire: readonly [DyeName, DyeName, DyeName] }>> = {
  dyes: {
    kinds: { [SAND]: ['daffodil', 'tangerine'], [WATER]: ['royal-blue', 'light-blue'], [STONE]: ['ash', 'moon-ink'], [PLANT]: ['emerald', 'deep-green'], [SMOKE]: ['ash', 'nigrosine'], [OIL]: ['orchid', 'nigrosine'] },
    fire: ['daffodil', 'tangerine', 'rose'],
  },
  desert: {
    kinds: { [SAND]: ['sepia-paper', 'tangerine'], [WATER]: ['mint', 'light-blue'], [STONE]: ['sepia-ink', 'ash'], [PLANT]: ['lime', 'deep-green'], [SMOKE]: ['ash', 'sepia-ink'], [OIL]: ['sepia-ink', 'black'] },
    fire: ['daffodil', 'coral', 'deep-red'],
  },
  neon: {
    kinds: { [SAND]: ['brilliant-pink', 'flavine'], [WATER]: ['light-blue', 'mint'], [STONE]: ['orchid', 'royal-blue'], [PLANT]: ['lime', 'emerald'], [SMOKE]: ['candy', 'orchid'], [OIL]: ['rose', 'deep-red'] },
    fire: ['flavine', 'brilliant-pink', 'rose'],
  },
  mono: {
    kinds: { [SAND]: ['white', 'moon-ink'], [WATER]: ['ash', 'moon-ink'], [STONE]: ['white', 'vellum'], [PLANT]: ['moon-ink', 'ash'], [SMOKE]: ['ash', 'nigrosine'], [OIL]: ['ash', 'black'] },
    fire: ['white', 'moon-ink', 'ash'],
  },
};

/** The grid as colours. An empty cell is left at nothing, so the black behind shows. */
export function renderSand(state: SandState, values: Values, pixels: Uint32Array, palette: Palette): void {
  const set = SETS[values.colours as string] ?? SETS.dyes;
  const speckle = num(values, 'speckle') / 100;
  const fireLife = Math.max(1, num(values, 'fireLife') * 1.4);
  // Sixteen shades of each kind, worked out once a frame.
  const shades = new Uint32Array(8 * 16);
  for (const [kind, pair] of Object.entries(set.kinds)) {
    for (let n = 0; n < 16; n += 1) shades[Number(kind) * 16 + n] = mix(dye(palette, pair[0]), dye(palette, pair[1]), 0.5 + (n / 15 - 0.5) * speckle);
  }
  const fire = set.fire.map((name) => dye(palette, name));
  const { cells, tone, life } = state;
  const count = Math.min(pixels.length, cells.length);
  for (let i = 0; i < count; i += 1) {
    const kind = cells[i];
    if (kind === EMPTY) pixels[i] = 0;
    else if (kind === FIRE) pixels[i] = fire[life[i] > fireLife * 0.6 ? 0 : life[i] > fireLife * 0.25 ? 1 : 2];
    else pixels[i] = shades[kind * 16 + (tone[i] >> 4)];
  }
}

export const sandEngine: Engine<SandState> = {
  id: 'sand',
  cell: (values) => num(values, 'cell'),
  rate: (values) => 30 * num(values, 'time'),
  init: (env) => newSand(env.w, env.h),
  step: stepSand,
  render: renderSand,
  action: sandAction,
  meters: (state) => [{ id: 'grains', label: 'GRAINS', value: state.grains, most: Math.max(1, state.w * state.h * 0.25) }],
  stillSteps: 360,
};
