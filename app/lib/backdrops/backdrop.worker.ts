import { fluidEngine } from './fluid/sim';
import type { Box, Engine, EngineEnv, Palette, Reading } from './engine';
import type { Values } from './knobs';

/**
 * A background's world on a thread of its own (PERF 1b, 2026-11-17; Luke: "the most laggy thing i see so far is moving a
 * window inside the fluid sim", then "B: do it now"). The page keeps everything about being a page - the clock, the pointer,
 * where the windows are, the theme's colours - and sends them here with each step (`../../components/backdrops/CanvasBackdrop.tsx`);
 * this moves the world on, colours it and draws it straight onto the page's canvas (handed over as an OffscreenCanvas), so a
 * dragged window never waits for the water. The engine is the very same one the page runs where there are no workers.
 *
 * Only FLUID runs here: it is the one background heavy enough to need it (60% of the page's time on a 3440-wide screen).
 */

/** The page's messages. Windows' boxes come only when they change, so the engine still tells "moved" by the array itself. */
export type ToBackdropThread =
  | { type: 'init'; engine: string; canvas?: OffscreenCanvas; w: number; h: number; values: Values; solids: readonly Box[]; palette: Palette; ground: number }
  | {
      type: 'step';
      steps: number;
      values?: Values;
      palette?: Palette;
      ground?: number;
      solids?: readonly Box[];
      pointer: EngineEnv['pointer'];
      trail?: readonly { x: number; y: number }[];
      meters: boolean;
    }
  | { type: 'action'; name: string }
  | { type: 'press'; x: number; y: number };

/** What comes back: a step drawn (with the meters when they were asked for), or that the thread could not go on. */
export type FromBackdropThread = { type: 'drawn'; meters: Reading[] | null } | { type: 'failed'; message: string };

const ENGINES: Readonly<Record<string, Engine<unknown>>> = { fluid: fluidEngine as Engine<unknown> };

let engine: Engine<unknown> | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let canvas: OffscreenCanvas | null = null;
let state: unknown = null;
let image: ImageData | null = null;
let pixels = new Uint32Array(0);
let env: EngineEnv = { w: 1, h: 1, pointer: null, solids: [], random: Math.random };
let values: Values = {};
let palette: Palette = {};
let ground = 0;

const say = (message: FromBackdropThread) => self.postMessage(message);

/** The same picture the page paints: the engine's colours, and the empty background in the theme's ground. */
function draw(): void {
  if (engine === null || context === null || image === null || state === null) return;
  engine.render(state, values, pixels, palette, env);
  if (ground !== 0) for (let i = 0; i < pixels.length; i += 1) if (pixels[i] === 0) pixels[i] = ground;
  context.putImageData(image, 0, 0);
}

self.onmessage = (event: MessageEvent<ToBackdropThread>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      if (message.canvas !== undefined) {
        canvas = message.canvas;
        context = canvas.getContext('2d');
      }
      engine = ENGINES[message.engine] ?? null;
      if (engine === null || canvas === null || context === null) throw new Error(`no background "${message.engine}" here`);
      canvas.width = message.w;
      canvas.height = message.h;
      values = message.values;
      palette = message.palette;
      ground = message.ground;
      env = { w: message.w, h: message.h, pointer: null, solids: message.solids, random: Math.random };
      state = engine.init(env, values);
      image = context.createImageData(message.w, message.h);
      pixels = new Uint32Array(image.data.buffer);
      return;
    }
    if (engine === null || state === null) return;
    if (message.type === 'step') {
      if (message.values !== undefined) values = message.values;
      if (message.palette !== undefined) palette = message.palette;
      if (message.ground !== undefined) ground = message.ground;
      if (message.solids !== undefined) env = { ...env, solids: message.solids };
      env.pointer = message.pointer;
      env.trail = message.trail;
      for (let n = 0; n < message.steps; n += 1) {
        engine.step(state, values, env);
        // The way the pointer came is spent on the first step, as on the page.
        env.trail = undefined;
      }
      draw();
      say({ type: 'drawn', meters: message.meters ? (engine.meters?.(state, values, env) ?? []) : null });
    } else if (message.type === 'action') engine.action?.(state, message.name, values, env);
    else if (message.type === 'press') engine.press?.(state, message.x, message.y, values, env);
  } catch (failure) {
    say({ type: 'failed', message: failure instanceof Error ? failure.message : String(failure) });
  }
};
