import { createWindowSlot } from '../ui/window-slot';
import type { Reading } from './engine';
import { bouncedPuck, clampToKnob, swayedValues, type RangeKnob, type Values } from './knobs';
import { backdropDef } from './registry';
import { backdropExtras, backdropValues, setBackdropValues, subscribeToBackdropScenes } from './store';

/**
 * What moves by itself in a background's settings, and what the backgrounds share while they run (SPEC-backgrounds.md). None of
 * it is saved:
 *
 * - **live values**: a background's settings as they are this instant - the stored ones, with every SWAYING knob where its sway
 *   has it and every BOUNCING pad's two knobs where its puck is. A background draws from these; the window's sliders show them.
 * - **the pointer**: where it is, for whichever background wants it, and the GHOST POINTER: ten seconds of it recorded and
 *   looped, which stands in while the real one is still.
 * - **actions**: a window's one-press keys (GIANT MODE, SHAKE, CLEAR) reaching the background that carries them out.
 * - **meters**: a few numbers a running background reports about itself, for the window's live strips.
 *
 * The moving stops under `prefers-reduced-motion`: knobs rest on their stored values and the ghost is not played.
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const calm = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
const seconds = () => (typeof performance === 'undefined' ? 0 : performance.now() / 1000);

/** The reader has put the site window away (`app/lib/ui/site-hidden.ts` writes this mark on `<html>`; the stylesheet hides the window from it). */
function siteWindowAway(): boolean {
  return document.documentElement.getAttribute('data-site-hidden') === 'on';
}

/**
 * Whether a press landed on the bare background and nothing else: the desk round the site window, never the window, a
 * docked window, a strip or a key. With the site window put away the desk lets the pointer through (so the page under it
 * can be reached), and a press on the background then lands on the page's own body: that is the bare background too.
 */
export function onBareBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-site-window="frame"]') !== null) return false;
  if (target.closest('[data-site-window="desk"]') !== null) return true;
  return siteWindowAway() && (target === document.body || target === document.documentElement);
}

/**
 * True while nothing of the page's background can be seen: something is fullscreen, or the site window fills the screen (the
 * reader's FILL WINDOW, or a page that fills by itself), from the width those apply at. A background's loop rests while this is so. Asked now and then, not a frame.
 */
export function backgroundCovered(): boolean {
  // Something is fullscreen (a video): only what is inside it shows. The copy of the background drawn inside it
  // (`StageBackdrop`) does not ask this.
  if (document.fullscreenElement !== null) return true;
  // The site window put away (HIDE WINDOW): the background is all there is to see, whatever FILL WINDOW says and whatever
  // page this is. (It used to rest here as if the filled window were still over it.)
  if (siteWindowAway()) return false;
  if (!window.matchMedia('(min-width: 768px)').matches) return false;
  // BROWSER's GLASS lens (SPEC-seeing-machine.md xv) looks through the window at it.
  if ((document.documentElement.getAttribute('data-see-glass') ?? null) !== null) return false;
  return document.documentElement.getAttribute('data-site-fill') === 'on' || document.querySelector('[data-page-fill]') !== null;
}

/* ------------------------------------------------------------------ live values: sway and bounce */

export type Puck = { x: number; y: number; vx: number; vy: number };

/** The pads that are bouncing, by `<background>:<pad>`. */
const pucks = new Map<string, Puck>();
const puckKey = (id: string, pad: string) => `${id}:${pad}`;
const pucksSlot = createWindowSlot<number>(0);
/** Changes whenever a pad starts or stops bouncing. */
export const subscribeToBouncing = pucksSlot.subscribe;
export const bouncingVersion = pucksSlot.state;

export function padIsBouncing(id: string, pad: string): boolean {
  return pucks.has(puckKey(id, pad));
}

const liveSlot = createWindowSlot<number>(0);
const liveCache = new Map<string, { base: Values; at: number; values: Values }>();

/** Fires several times a second while anything is swaying or bouncing, and whenever a stored value changes. */
export const subscribeToLiveValues = (listener: () => void): (() => void) => {
  const stopLive = liveSlot.subscribe(listener);
  const stopScenes = subscribeToBackdropScenes(listener);
  return () => {
    stopLive();
    stopScenes();
  };
};

const shareOf = (knob: RangeKnob, value: number) => (value - knob.min) / (knob.max - knob.min);
const fromShare = (knob: RangeKnob, share: number) => clampToKnob(knob, knob.min + share * (knob.max - knob.min));

function rangeKnob(id: string, key: string): RangeKnob | null {
  const knob = backdropDef(id)?.knobs.find((each) => each.key === key);
  return knob !== undefined && knob.kind === 'range' ? knob : null;
}

/**
 * A background's settings this instant. The same object for as long as nothing moves, so React and the backgrounds' loops can
 * tell "unchanged" by looking.
 */
export function liveValues(id: string): Values {
  const def = backdropDef(id);
  const base = backdropValues(id);
  if (def === null || calm()) return base;
  const sway = backdropExtras(id).sway;
  const bouncing = def.widgets.filter((widget) => widget.kind === 'pad' && pucks.has(puckKey(id, widget.id)));
  if (Object.keys(sway).length === 0 && bouncing.length === 0) return base;
  const tick = liveSlot.state();
  const cached = liveCache.get(id);
  if (cached !== undefined && cached.base === base && cached.at === tick) return cached.values;
  let values = swayedValues(def, base, sway, seconds());
  for (const widget of bouncing) {
    if (widget.kind !== 'pad') continue;
    const puck = pucks.get(puckKey(id, widget.id));
    const [x, y] = [rangeKnob(id, widget.x), rangeKnob(id, widget.y)];
    if (puck === undefined || x === null || y === null) continue;
    if (values === base) values = { ...base };
    values[widget.x] = fromShare(x, puck.x);
    values[widget.y] = fromShare(y, puck.y);
  }
  liveCache.set(id, { base, at: tick, values });
  return values;
}

/** How often moving values move on: eight times a second is smooth enough for a knob and cheap enough for a page. */
const LIVE_MS = 125;
let liveTimer: ReturnType<typeof setInterval> | null = null;
/** The backgrounds anybody is drawing from just now. */
const watched = new Map<string, number>();

function anythingMoving(): boolean {
  if (calm()) return false;
  if (pucks.size > 0) return true;
  for (const id of watched.keys()) if (Object.keys(backdropExtras(id).sway).length > 0) return true;
  return false;
}

function liveTick(): void {
  for (const [key, puck] of pucks) pucks.set(key, bouncedPuck(puck, LIVE_MS / 1000));
  liveSlot.set(liveSlot.state() + 1);
  if (!anythingMoving()) settleLiveTimer();
}

function settleLiveTimer(): void {
  const wanted = typeof window !== 'undefined' && anythingMoving();
  if (wanted && liveTimer === null) liveTimer = setInterval(liveTick, LIVE_MS);
  else if (!wanted && liveTimer !== null) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

/** A background (or its window) saying it is drawing from the live values, so they are kept moving. Returns the way to stop. */
export function watchLiveValues(id: string): () => void {
  watched.set(id, (watched.get(id) ?? 0) + 1);
  const stopScenes = subscribeToBackdropScenes(settleLiveTimer);
  settleLiveTimer();
  return () => {
    const left = (watched.get(id) ?? 1) - 1;
    if (left <= 0) watched.delete(id);
    else watched.set(id, left);
    stopScenes();
    settleLiveTimer();
  };
}

/**
 * BOUNCE: the pad's puck let go with a speed (shares of the pad a second). It keeps going, turning back at the walls, and the
 * pad's two knobs go with it until `stopBounce`. A puck let go at rest is given a push, so the key always does something.
 */
export function startBounce(id: string, pad: string, puck: Puck): void {
  const speed = Math.hypot(puck.vx, puck.vy);
  const pushed = speed > 0.05 ? puck : { ...puck, vx: 0.23, vy: 0.17 };
  // No faster than across the pad in a second: a knob that flickers is no knob.
  const most = Math.max(1, Math.hypot(pushed.vx, pushed.vy));
  pucks.set(puckKey(id, pad), { ...pushed, vx: pushed.vx / most, vy: pushed.vy / most });
  pucksSlot.set(pucksSlot.state() + 1);
  settleLiveTimer();
}

/** Stops a pad bouncing; its two knobs stay where the puck was. */
export function stopBounce(id: string, pad: string): void {
  const key = puckKey(id, pad);
  const puck = pucks.get(key);
  if (puck === undefined) return;
  const widget = backdropDef(id)?.widgets.find((each) => each.kind === 'pad' && each.id === pad);
  if (widget !== undefined && widget.kind === 'pad') {
    const [x, y] = [rangeKnob(id, widget.x), rangeKnob(id, widget.y)];
    if (x !== null && y !== null) setBackdropValues(id, { ...backdropValues(id), [widget.x]: fromShare(x, puck.x), [widget.y]: fromShare(y, puck.y) });
  }
  pucks.delete(key);
  pucksSlot.set(pucksSlot.state() + 1);
  settleLiveTimer();
}

/** Where a pad's puck is, as shares of the pad: the bouncing puck's place, or its two knobs' values. */
export function padPuck(id: string, pad: string): { x: number; y: number } {
  const bouncing = pucks.get(puckKey(id, pad));
  if (bouncing !== undefined) return { x: bouncing.x, y: bouncing.y };
  const widget = backdropDef(id)?.widgets.find((each) => each.kind === 'pad' && each.id === pad);
  if (widget === undefined || widget.kind !== 'pad') return { x: 0.5, y: 0.5 };
  const [x, y] = [rangeKnob(id, widget.x), rangeKnob(id, widget.y)];
  const values = backdropValues(id);
  return { x: x === null ? 0.5 : shareOf(x, values[widget.x] as number), y: y === null ? 0.5 : shareOf(y, values[widget.y] as number) };
}

/* ------------------------------------------------------------------ the pointer, and its ghost */

export type PointerNow = { x: number; y: number; ghost: boolean };

let pointer: { x: number; y: number; at: number } | null = null;
let pointerWatchers = 0;
/**
 * Every place the pointer was seen since a background last asked (list 4): a background steps thirty times a second, and a
 * fast stroke passes many places between two steps. The browser's in-between moves (coalesced events) count too.
 */
let trail: { x: number; y: number }[] = [];
const TRAIL_MOST = 96;

const onPointerMove = (event: PointerEvent) => {
  const between = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  for (const each of between.length > 0 ? between : [event]) trail.push({ x: each.clientX, y: each.clientY });
  if (trail.length > TRAIL_MOST) trail = trail.slice(-TRAIL_MOST);
  pointer = { x: event.clientX, y: event.clientY, at: performance.now() };
  if (ghostSlot.state() === 'recording') recordGhost();
};
const onPointerLeave = () => {
  pointer = null;
  trail = [];
};

/** The places the real pointer passed since the last call, oldest first, and a fresh start. Empty while its ghost plays. */
export function takePointerTrail(): { x: number; y: number }[] {
  const taken = trail;
  trail = [];
  return taken;
}

/** A background saying it wants the pointer. Returns the way to stop; the pointer is only listened for while somebody wants it. */
export function watchPointer(): () => void {
  pointerWatchers += 1;
  if (pointerWatchers === 1) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
  }
  return () => {
    pointerWatchers -= 1;
    if (pointerWatchers > 0) return;
    window.removeEventListener('pointermove', onPointerMove);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    pointer = null;
    trail = [];
  };
}

export type GhostState = 'off' | 'recording' | 'looping';

/** How long a ghost is, and how often the pointer is noted for it. */
export const GHOST_SECONDS = 10;
const GHOST_STEP_MS = 66;
/** How long the real pointer has to be still before its ghost takes over. */
const GHOST_AFTER_MS = 1200;

const ghostSlot = createWindowSlot<GhostState>('off');
let ghostPath: { x: number; y: number }[] = [];
let ghostStarted = 0;
let ghostTimer: ReturnType<typeof setTimeout> | null = null;
let ghostWatch: (() => void) | null = null;

export const ghostState = ghostSlot.state;
export const subscribeToGhost = ghostSlot.subscribe;
export const serverGhostState = (): GhostState => 'off';

function recordGhost(): void {
  if (pointer === null) return;
  const n = Math.floor((performance.now() - ghostStarted) / GHOST_STEP_MS);
  // Where the pointer rested is recorded too: every step up to now is filled with its last place.
  while (ghostPath.length <= n) ghostPath.push({ x: pointer.x, y: pointer.y });
}

/** `[ RECORD ]`: the next ten seconds of the pointer, then looped until `stopGhost`. */
export function startGhost(): void {
  stopGhost();
  if (calm()) return;
  ghostWatch = watchPointer();
  ghostPath = [];
  ghostStarted = performance.now();
  ghostSlot.set('recording');
  ghostTimer = setTimeout(() => {
    ghostTimer = null;
    recordGhost();
    if (ghostPath.length < 4) stopGhost();
    else {
      ghostStarted = performance.now();
      ghostSlot.set('looping');
    }
  }, GHOST_SECONDS * 1000);
}

export function stopGhost(): void {
  if (ghostTimer !== null) clearTimeout(ghostTimer);
  ghostTimer = null;
  ghostWatch?.();
  ghostWatch = null;
  ghostPath = [];
  if (ghostSlot.state() !== 'off') ghostSlot.set('off');
}

/** The pointer for a background's loop: the real one while it moves, its ghost while it rests, null when there is neither. */
export function pointerNow(): PointerNow | null {
  const now = performance.now();
  if (ghostSlot.state() === 'looping' && ghostPath.length > 0 && (pointer === null || now - pointer.at > GHOST_AFTER_MS)) {
    const spot = ghostPath[Math.floor((now - ghostStarted) / GHOST_STEP_MS) % ghostPath.length];
    return { x: spot.x, y: spot.y, ghost: true };
  }
  return pointer === null ? null : { x: pointer.x, y: pointer.y, ghost: false };
}

/* ------------------------------------------------------------------ actions, and which are "on" */

const actionListeners = new Map<string, Set<(action: string) => void>>();
const activeSlot = createWindowSlot<readonly string[]>([]);

/** A background listening for its window's one-press keys. Returns the way to stop. */
export function onBackdropAction(id: string, listener: (action: string) => void): () => void {
  if (!actionListeners.has(id)) actionListeners.set(id, new Set());
  actionListeners.get(id)?.add(listener);
  return () => {
    actionListeners.get(id)?.delete(listener);
  };
}

export function fireBackdropAction(id: string, action: string): void {
  for (const listener of actionListeners.get(id) ?? []) listener(action);
}

/** The actions that are a state for a while (GIANT MODE), as `<background>:<action>`: their keys are drawn pressed. */
export const activeActions = activeSlot.state;
export const subscribeToActiveActions = activeSlot.subscribe;

export function setActionActive(id: string, action: string, on: boolean): void {
  const key = `${id}:${action}`;
  const held = activeSlot.state();
  if (held.includes(key) === on) return;
  activeSlot.set(on ? [...held, key] : held.filter((each) => each !== key));
}

/* ------------------------------------------------------------------ meters */

export type { Reading } from './engine';
/** A reading with the ones before it: the last 48, the newest last. */
export type Meter = Reading & { history: readonly number[] };

const metersSlot = createWindowSlot<readonly Meter[]>([]);

export const backdropMeters = metersSlot.state;
export const subscribeToMeters = metersSlot.subscribe;
const NO_METERS: readonly Meter[] = [];
export const serverMeters = (): readonly Meter[] => NO_METERS;

/** A running background reporting about itself, a couple of times a second at the most. No readings: nothing is running. */
export function setBackdropMeters(readings: readonly Reading[]): void {
  if (readings.length === 0 && metersSlot.state().length === 0) return;
  const before = metersSlot.state();
  metersSlot.set(readings.map((reading) => ({ ...reading, history: [...(before.find((meter) => meter.id === reading.id)?.history ?? []).slice(-47), reading.value] })));
}
