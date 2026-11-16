'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { DYES, pixelFromHex, type Box, type Engine, type EngineEnv, type Palette } from '../../lib/backdrops/engine';
import { backgroundCovered, onBackdropAction, onBareBackground, pointerNow, setBackdropMeters, takePointerTrail, watchLiveValues, watchPointer } from '../../lib/backdrops/runtime';
import { subscribeToSiteHidden } from '../../lib/ui/site-hidden';
import { backdropValues, subscribeToBackdropScenes } from '../../lib/backdrops/store';
import { THEME_KEY, currentThemeId, drawnValues, subscribeToTheme, themeGround, themePalette } from '../../lib/backdrops/theme';
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
 *
 * It draws from `drawnValues`: the reader's settings with the site theme laid over them while the background's `[ THEME ]` is on
 * (`../../lib/backdrops/theme.ts`), which also repaints the dyes in the theme's colours and tints the empty ground toward its desk.
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** How long after a press is let go, or a window last moved, where windows are is still read every step. */
const BUSY_AFTER_MS = 1000;

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

/**
 * What is solid just now, in cells. Behind the page: the site window, the docked windows, and the strips along the top and
 * bottom. On a stage (round a fullscreen video): whatever in the fullscreen box is marked `data-backdrop-solid`, the picture.
 */
function readSolids(cell: number, w: number, h: number, stage: boolean): Box[] {
  const boxes: Box[] = [];
  const add = (left: number, top: number, right: number, bottom: number) => {
    const box = { x0: Math.max(0, Math.floor(left / cell)), y0: Math.max(0, Math.floor(top / cell)), x1: Math.min(w, Math.ceil(right / cell)), y1: Math.min(h, Math.ceil(bottom / cell)) };
    if (box.x1 > box.x0 && box.y1 > box.y0) boxes.push(box);
  };
  for (const element of document.querySelectorAll(stage ? '[data-backdrop-solid]' : '[data-site-window="frame"], [data-dock-window]')) {
    // A window folded away keeps its box, only unseen (your room's X folds it so its video plays on: `invisible` in
    // DockWindow.tsx): what can't be seen is not solid. The water used to keep going round a room that was closed until
    // the page was loaded again (list 4, Luke: "fluid seems to obey a closed room winodw sometimes").
    if (element.closest('[data-minimized="true"]') !== null || getComputedStyle(element).visibility === 'hidden') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    // A frame trimmed of its bars is bigger than what shows of it (`data-backdrop-inset`: the share cut from each side, then
    // from top and foot): only the part that shows is solid.
    const [insetX, insetY] = (element.getAttribute('data-backdrop-inset') ?? '').split(' ').map(Number);
    const dx = insetX > 0 && insetX < 0.5 ? rect.width * insetX : 0;
    const dy = insetY > 0 && insetY < 0.5 ? rect.height * insetY : 0;
    add(rect.left + dx, rect.top + dy, rect.right - dx, rect.bottom - dy);
  }
  if (stage) return boxes;
  const root = document.documentElement.style;
  const top = parseFloat(root.getPropertyValue('--top-bar')) || 0;
  const bottom = parseFloat(root.getPropertyValue('--bottom-bar')) || 0;
  if (top > 0) add(0, 0, window.innerWidth, top);
  if (bottom > 0) add(0, window.innerHeight - bottom, window.innerWidth, window.innerHeight);
  return boxes;
}

const sameBoxes = (a: readonly Box[], b: readonly Box[]) => a.length === b.length && a.every((box, n) => box.x0 === b[n].x0 && box.y0 === b[n].y0 && box.x1 === b[n].x1 && box.y1 === b[n].y1);

function Running<State>({ engine, still, stage }: { engine: Engine<State>; still: boolean; stage: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d') ?? null;
    if (element === null || context === null) return;

    const dyes = readPalette();
    let values = drawnValues(engine.id);
    // The theme's colours and ground, worked out again only when the theme or the THEME switch changes, never a frame.
    let themed = '';
    let palette = dyes;
    let ground = 0;
    const retheme = () => {
      const on = values[THEME_KEY] === true;
      const theme = currentThemeId();
      if (themed === `${theme}:${on}`) return;
      themed = `${theme}:${on}`;
      palette = themePalette(theme, engine.id, dyes, on);
      ground = themeGround(theme, on);
    };
    retheme();
    // The cell's size is read from the stored settings, never the live ones: a GRID knob set to sway would otherwise start the
    // world again every time its value crossed a whole pixel.
    const cellNow = () => Math.max(1, Math.round(engine.cell(backdropValues(engine.id))));
    let cell = cellNow();
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
      env = { w, h, pointer: null, solids: readSolids(cell, w, h, stage), random: Math.random };
      state = engine.init(env, values);
      image = context.createImageData(w, h);
      pixels = new Uint32Array(image.data.buffer);
    };
    const paint = () => {
      if (state === null || image === null) return;
      engine.render(state, values, pixels, palette, env);
      // The empty background in the theme's ground rather than the black behind.
      if (ground !== 0) for (let i = 0; i < pixels.length; i += 1) if (pixels[i] === 0) pixels[i] = ground;
      context.putImageData(image, 0, 0);
    };
    build();

    // A press counts on the bare background: the desk round the site window, or (on a stage) the surround of a fullscreen picture.
    const onBare = (target: EventTarget | null) =>
      stage ? target instanceof Element && target.closest('[data-backdrop-press]') !== null && target.closest('[data-backdrop-solid]') === null : onBareBackground(target);
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || !onBare(event.target)) return;
      held = true;
      if (state !== null) engine.press?.(state, event.clientX / cell, event.clientY / cell, values, env);
    };
    const release = () => {
      held = false;
    };
    /** A press anywhere (a window's title bar being dragged, its X): windows may move, so where they are is read each step. */
    let pressing = false;
    let busyUntil = 0;
    const pressAnywhere = () => {
      pressing = true;
    };
    const releaseAnywhere = () => {
      pressing = false;
      busyUntil = performance.now() + BUSY_AFTER_MS;
    };
    const stopActions = onBackdropAction(engine.id, (action) => {
      if (state === null) return;
      engine.action?.(state, action, values, env);
      if (still) paint();
    });

    if (still) {
      // Motion off: the world is let settle out of sight, and one frame of it is shown.
      const settle = () => {
        for (let n = 0; n < engine.stillSteps && state !== null; n += 1) engine.step(state, values, env);
        paint();
      };
      settle();
      // A changed knob, or a new window size, makes a new still frame - a moment after the last change, so a slider being dragged
      // or a window being resized is settled once, not at every pixel.
      let waiting: ReturnType<typeof setTimeout> | null = null;
      const again = () => {
        if (waiting !== null) clearTimeout(waiting);
        waiting = setTimeout(() => {
          waiting = null;
          values = drawnValues(engine.id);
          retheme();
          cell = cellNow();
          build();
          settle();
        }, 200);
      };
      const stopScenes = subscribeToBackdropScenes(again);
      // A new site theme is a new still frame too, while THEME is on.
      const stopTheme = subscribeToTheme(again);
      // The site window put away or brought back changes what is solid: the still frame is made again (it kept the
      // window's shape cut out of it, with sand heaped on a window that was no longer there).
      const stopHidden = stage ? () => undefined : subscribeToSiteHidden(again);
      window.addEventListener('resize', again);
      return () => {
        if (waiting !== null) clearTimeout(waiting);
        stopScenes();
        stopTheme();
        stopHidden();
        window.removeEventListener('resize', again);
        stopActions();
      };
    }

    const stopPointer = watchPointer();
    document.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointerdown', pressAnywhere, { capture: true, passive: true });
    window.addEventListener('pointerup', releaseAnywhere, { capture: true, passive: true });
    window.addEventListener('pointercancel', releaseAnywhere, { capture: true, passive: true });
    window.addEventListener('keydown', releaseAnywhere, { capture: true, passive: true });
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
        takePointerTrail();
        return;
      }
      values = drawnValues(engine.id);
      retheme();
      // A new grain size is a new grid: the world starts again at it.
      const wanted = cellNow();
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
      if (ticks % 20 === 1) covered = !stage && backgroundCovered();
      if (covered) {
        // Where the pointer went while nothing of the water showed is no stroke: it is let go, not drawn when it shows again.
        takePointerTrail();
        return;
      }
      // Where the page is solid. It was looked up twice a second, always, and that was the whole of why a dragged window
      // reached the water in jumps (list 4, Luke: "the tick rate for those movements also need to be increased"): now it is
      // looked up every step while a window can be moving - a press is held (a title bar dragged), a key was pressed, or a
      // window moved a moment ago - and twice a second while the page sits still, since measuring every frame costs.
      const busy = pressing || time < busyUntil;
      if (busy || time - looked > 500) {
        looked = time;
        const solids = readSolids(cell, env.w, env.h, stage);
        if (!sameBoxes(solids, env.solids)) {
          env = { ...env, solids };
          busyUntil = time + BUSY_AFTER_MS;
        }
      }
      const spot = pointerNow();
      env.pointer = spot === null ? null : { x: spot.x / cell, y: spot.y / cell, down: held || spot.ghost };
      const trail = takePointerTrail();
      env.trail = spot === null || spot.ghost ? undefined : trail.map((point) => ({ x: point.x / cell, y: point.y / cell }));
      for (let n = 0; n < steps && state !== null; n += 1) {
        engine.step(state, values, env);
        // The way the pointer came is spent on the first step: the ones after it see it resting where it is.
        env.trail = undefined;
      }
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
      window.removeEventListener('pointerdown', pressAnywhere, { capture: true });
      window.removeEventListener('pointerup', releaseAnywhere, { capture: true });
      window.removeEventListener('pointercancel', releaseAnywhere, { capture: true });
      window.removeEventListener('keydown', releaseAnywhere, { capture: true });
      window.removeEventListener('resize', build);
      setBackdropMeters([]);
    };
  }, [engine, still, stage]);

  return (
    <div aria-hidden="true" className={stage ? 'backdrop-stage' : 'aquarium z-backdrop'} data-backdrop-scene={engine.id} data-backdrop-running={still ? 'still' : 'on'}>
      <canvas ref={canvas} className="backdrop-canvas" />
    </div>
  );
}

/**
 * `stage`: drawn inside the box it is put in (the surround of a fullscreen picture), filling it, instead of fixed behind the
 * page. A stage copy runs while the page's own copy rests (nothing of the page shows in fullscreen).
 */
export default function CanvasBackdrop<State>({ engine, stage = false }: { engine: Engine<State>; stage?: boolean }) {
  // Nothing on the server or while hydrating: the server cannot know what this browser chose.
  const chosen = useSyncExternalStore<BackdropState | null>(subscribeToBackdrop, backdropState, () => null);
  const still = useSyncExternalStore(subscribeToReducedMotion, reducedMotion, () => false);
  const on = chosen?.id === engine.id;
  useEffect(() => (on ? watchLiveValues(engine.id) : undefined), [on, engine.id]);

  if (!on) return null;

  return <Running engine={engine} still={still} stage={stage} />;
}
