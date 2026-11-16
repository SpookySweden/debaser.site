'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { DYES, pixelFromHex, type Box, type Engine, type EngineEnv, type Palette } from '../../lib/backdrops/engine';
import { backgroundCovered, liveValues, onBackdropAction, pointerNow, setBackdropMeters, watchLiveValues, watchPointer } from '../../lib/backdrops/runtime';
import { backdropState, subscribeToBackdrop, type BackdropState } from '../../lib/ui/backdrop-slot';

/**
 * The one component that runs every simulated background (SPEC-backgrounds.md): SAND, FLUID, STARFIELD, MYSTIFY. Each of those
 * is an `Engine` - plain functions that make a small world, move it on a step and colour a grid from it
 * (`../../lib/backdrops/engine.ts`). This owns everything about being on a page: one canvas the size of the grid, shown at a
 * whole number of screen pixels a cell with `image-rendering: pixelated`; one `requestAnimationFrame` loop; the pointer, a press
 * on the bare background, and where the page is solid; and resting when there is nothing to see.
 *
 * Drawn in the browser only, fixed under everything like the aquarium (`.aquarium` in globals.css lays the black down before
 * the first paint), and only while its background is the chosen one. Under `prefers-reduced-motion` it shows one settled frame
 * and runs no loop. In a hidden tab, and while the site window fills the screen, the loop rests.
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** The site's dyes as the page has them, read from the token variables: no colour is written in a background. */
function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const palette: Record<string, number> = {};
  for (const name of DYES) {
    const colour = pixelFromHex(style.getPropertyValue(`--dye-${name}`));
    if (colour !== null) palette[name] = colour;
  }
  return palette;
}

/** What is solid on the page just now, in cells: the site window, the docked windows, and the strips along the top and bottom. */
function readSolids(cell: number, w: number, h: number): Box[] {
  const boxes: Box[] = [];
  const add = (left: number, top: number, right: number, bottom: number) => {
    const box = { x0: Math.max(0, Math.floor(left / cell)), y0: Math.max(0, Math.floor(top / cell)), x1: Math.min(w, Math.ceil(right / cell)), y1: Math.min(h, Math.ceil(bottom / cell)) };
    if (box.x1 > box.x0 && box.y1 > box.y0) boxes.push(box);
  };
  for (const element of document.querySelectorAll('[data-site-window="frame"], [data-dock-window]')) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) add(rect.left, rect.top, rect.right, rect.bottom);
  }
  const root = document.documentElement.style;
  const top = parseFloat(root.getPropertyValue('--top-bar')) || 0;
  const bottom = parseFloat(root.getPropertyValue('--bottom-bar')) || 0;
  if (top > 0) add(0, 0, window.innerWidth, top);
  if (bottom > 0) add(0, window.innerHeight - bottom, window.innerWidth, window.innerHeight);
  return boxes;
}

const sameBoxes = (a: readonly Box[], b: readonly Box[]) => a.length === b.length && a.every((box, n) => box.x0 === b[n].x0 && box.y0 === b[n].y0 && box.x1 === b[n].x1 && box.y1 === b[n].y1);

function Running<State>({ engine, still }: { engine: Engine<State>; still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d') ?? null;
    if (element === null || context === null) return;

    const palette = readPalette();
    let values = liveValues(engine.id);
    let cell = Math.max(1, Math.round(engine.cell(values)));
    let env: EngineEnv = { w: 1, h: 1, pointer: null, solids: [], random: Math.random };
    let state: State | null = null;
    let image: ImageData | null = null;
    let pixels = new Uint32Array(0);
    /** Held down on the bare background: what pouring and stirring ask for. */
    let held = false;

    const build = () => {
      const w = Math.max(1, Math.ceil(window.innerWidth / cell));
      const h = Math.max(1, Math.ceil(window.innerHeight / cell));
      element.width = w;
      element.height = h;
      // A whole number of screen pixels a cell: the grid may hang a little over the right and bottom edges, never squeezed to fit.
      element.style.width = `${w * cell}px`;
      element.style.height = `${h * cell}px`;
      env = { w, h, pointer: null, solids: readSolids(cell, w, h), random: Math.random };
      state = engine.init(env, values);
      image = context.createImageData(w, h);
      pixels = new Uint32Array(image.data.buffer);
    };
    const paint = () => {
      if (state === null || image === null) return;
      engine.render(state, values, pixels, palette, env);
      context.putImageData(image, 0, 0);
    };
    build();

    const onBare = (target: EventTarget | null) => target instanceof Element && target.closest('[data-site-window="desk"]') !== null && target.closest('[data-site-window="frame"]') === null;
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || !onBare(event.target)) return;
      held = true;
      if (state !== null) engine.press?.(state, event.clientX / cell, event.clientY / cell, values, env);
    };
    const release = () => {
      held = false;
    };
    const stopActions = onBackdropAction(engine.id, (action) => {
      if (state === null) return;
      engine.action?.(state, action, values, env);
      if (still) paint();
    });

    if (still) {
      // Motion off: the world is let settle out of sight, and one frame of it is shown.
      for (let n = 0; n < engine.stillSteps && state !== null; n += 1) engine.step(state, values, env);
      paint();
      const again = () => {
        build();
        for (let n = 0; n < engine.stillSteps && state !== null; n += 1) engine.step(state, values, env);
        paint();
      };
      window.addEventListener('resize', again);
      return () => {
        window.removeEventListener('resize', again);
        stopActions();
      };
    }

    const stopPointer = watchPointer();
    document.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('resize', build);

    let frame = 0;
    let last = performance.now();
    let owed = 0;
    let ticks = 0;
    let covered = false;
    let stepped = 0;
    let reported = last;
    let looked = 0;

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || state === null) {
        last = time;
        return;
      }
      values = liveValues(engine.id);
      // A new grain size is a new grid: the world starts again at it.
      const wanted = Math.max(1, Math.round(engine.cell(values)));
      if (wanted !== cell) {
        cell = wanted;
        build();
      }
      const step = 1 / Math.max(1, engine.rate(values));
      // A stall (a busy page, a tab just back) is not caught up on: the world carries on from where it was.
      owed += Math.min(0.25, (time - last) / 1000);
      last = time;
      if (owed < step) return;
      const steps = Math.min(3, Math.floor(owed / step));
      owed = Math.min(step, owed - steps * step);
      ticks += 1;
      if (ticks % 20 === 1) covered = backgroundCovered();
      if (covered) return;
      // Where the page is solid is looked up twice a second, never a frame: windows move seldom, and measuring costs.
      if (time - looked > 500) {
        looked = time;
        const solids = readSolids(cell, env.w, env.h);
        if (!sameBoxes(solids, env.solids)) env = { ...env, solids };
      }
      const spot = pointerNow();
      env.pointer = spot === null ? null : { x: spot.x / cell, y: spot.y / cell, down: held || spot.ghost };
      for (let n = 0; n < steps && state !== null; n += 1) engine.step(state, values, env);
      paint();
      stepped += steps;
      if (time - reported >= 500 && state !== null) {
        setBackdropMeters([...(engine.meters?.(state, values, env) ?? []), { id: 'steps', label: 'STEPS A SECOND', value: (stepped * 1000) / (time - reported), most: Math.max(1, engine.rate(values)) }]);
        stepped = 0;
        reported = time;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      stopPointer();
      stopActions();
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('resize', build);
      setBackdropMeters([]);
    };
  }, [engine, still]);

  return (
    <div aria-hidden="true" className="aquarium z-backdrop" data-backdrop-scene={engine.id} data-backdrop-running={still ? 'still' : 'on'}>
      <canvas ref={canvas} className="backdrop-canvas" />
    </div>
  );
}

export default function CanvasBackdrop<State>({ engine }: { engine: Engine<State> }) {
  // Nothing on the server or while hydrating: the server cannot know what this browser chose.
  const chosen = useSyncExternalStore<BackdropState | null>(subscribeToBackdrop, backdropState, () => null);
  const still = useSyncExternalStore(subscribeToReducedMotion, reducedMotion, () => false);
  const on = chosen?.id === engine.id;
  useEffect(() => (on ? watchLiveValues(engine.id) : undefined), [on, engine.id]);

  if (!on) return null;

  return <Running engine={engine} still={still} />;
}
