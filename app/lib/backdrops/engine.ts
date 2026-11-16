import type { Values } from './knobs';

/**
 * What a simulated background is, to the one component that runs them all (`../../components/backdrops/CanvasBackdrop.tsx`;
 * SPEC-backgrounds.md). A background is a small grid of cells - each cell a few screen pixels, so the picture is chunky on
 * purpose - and four plain functions: make the world, move it on one step, colour the grid from it, and say a few numbers
 * about it. No browser in any of them, so the checks run the same code the site does.
 *
 * Nothing a background draws is a picture of anything (core.md, Asset Rules, 2026-11-16): grains, ink, dots and lines, in
 * the site's own dyes.
 */

/** A number a running background reports about itself, for the settings window's live strips. */
export type Reading = { id: string; label: string; value: number; most: number };

/** The site's dyes by name (`--dye-<name>` in the token files), each as one pixel: 0xAABBGGRR, the order a canvas keeps them in. */
export type Palette = Readonly<Record<string, number>>;

/** A rectangle of cells that is solid: the site window, a docked window, the bars. `x1` and `y1` are one past the last cell. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type EngineEnv = {
  /** The grid's size, in cells. */
  w: number;
  h: number;
  /** The pointer, in cells, while it is over the page; `down` while it is held on the bare background (or is the ghost). */
  pointer: { x: number; y: number; down: boolean } | null;
  /** What is solid just now. The same list until something moves. */
  solids: readonly Box[];
  random: () => number;
};

export type Engine<State> = {
  /** The background's id, as in `../ui/backdrop-slot.ts` and the registry. */
  id: string;
  /** How many screen pixels a cell is, for these settings. */
  cell: (values: Values) => number;
  /** How many steps a second. */
  rate: (values: Values) => number;
  /** A new world of this size. */
  init: (env: EngineEnv, values: Values) => State;
  /** One step. */
  step: (state: State, values: Values, env: EngineEnv) => void;
  /** The world as colours: one entry of `pixels` a cell, row by row. A cell left at 0 shows the black behind it. */
  render: (state: State, values: Values, pixels: Uint32Array, palette: Palette, env: EngineEnv) => void;
  /** One of the window's one-press keys. */
  action?: (state: State, action: string, values: Values, env: EngineEnv) => void;
  /** A press on the bare background, at a cell. */
  press?: (state: State, x: number, y: number, values: Values, env: EngineEnv) => void;
  /** A few numbers about the world, for the window's live strips. */
  meters?: (state: State, values: Values, env: EngineEnv) => Reading[];
  /** How many steps to run before the one still frame that is shown when motion is off. */
  stillSteps: number;
};

/** A pixel from its three colours. */
export const pixel = (r: number, g: number, b: number, a = 255): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** Two pixels mixed: `part` of the way from the first to the second (0 to 1). */
export function mix(from: number, to: number, part: number): number {
  const t = Math.min(1, Math.max(0, part));
  const r = (from & 255) + (((to & 255) - (from & 255)) * t);
  const g = ((from >>> 8) & 255) + ((((to >>> 8) & 255) - ((from >>> 8) & 255)) * t);
  const b = ((from >>> 16) & 255) + ((((to >>> 16) & 255) - ((from >>> 16) & 255)) * t);
  return pixel(Math.round(r), Math.round(g), Math.round(b));
}

/** A pixel made darker or lighter: `by` under 1 darkens it. */
export function shade(colour: number, by: number): number {
  const lit = (v: number) => Math.min(255, Math.max(0, Math.round(v * by)));
  return pixel(lit(colour & 255), lit((colour >>> 8) & 255), lit((colour >>> 16) & 255));
}

/** A colour round the wheel: `hue` in turns (0 to 1), full strength. For the looks that want every colour. */
export function wheel(hue: number, light = 1): number {
  const h = ((hue % 1) + 1) % 1;
  const part = (shift: number) => {
    const k = (h * 6 + shift) % 6;
    return Math.round(255 * light * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return pixel(part(5), part(3), part(1));
}

/** The dyes a background may ask for, by the names the token files give them. */
export const DYES = [
  'black', 'nigrosine', 'royal-blue', 'daffodil', 'flavine', 'brilliant-pink', 'rose', 'emerald', 'white', 'candy', 'carnation', 'salmon', 'coral',
  'tangerine', 'mint', 'orchid', 'lime', 'ash', 'deep-red', 'deep-green', 'light-red', 'light-blue', 'vellum', 'moon-ink', 'sepia-paper', 'sepia-ink',
] as const;

/** A dye from a palette, or white where the palette lacks it (a check's palette, a token since renamed). */
export const dye = (palette: Palette, name: (typeof DYES)[number]): number => palette[name] ?? pixel(255, 255, 255);

/** A token's value (`#rrggbb`) as a pixel; null when it isn't one. */
export function pixelFromHex(value: string): number | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (hex === null) return null;
  const n = parseInt(hex[1], 16);
  return pixel((n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
