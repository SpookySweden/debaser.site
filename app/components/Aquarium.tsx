'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  aquariumGiant,
  aquariumSettings,
  serverAquariumGiant,
  serverAquariumSettings,
  subscribeToAquariumGiant,
  subscribeToAquariumSettings,
} from '../lib/aquarium/settings-slot';
import type { AquariumSettings } from '../lib/aquarium/settings';
import {
  BUBBLE_LOOP,
  BUBBLE_STREAMS,
  MOST_BUBBLES,
  MOST_PELLETS,
  TINY_TANK,
  bubbleAt,
  burstBubbles,
  currentOf,
  discoHue,
  dropPellet,
  fishPlan,
  newSim,
  nightAt,
  stepSim,
  streamBubble,
  type FishPlan,
  type SimState,
} from '../lib/aquarium/sim';
import { backdropState, subscribeToBackdrop, type BackdropState } from '../lib/ui/backdrop-slot';

/**
 * The AQUARIUM background (Luke, 2026-11-15): the Windows 98 Underwater screensaver's sea behind the site window. Coral banks in
 * the two bottom corners, fish crossing at their own speeds and depths, bubbles rising off the coral - and everything about it
 * a knob in the AQUARIUM window (SPEC-aquarium-settings.md, `./AquariumSettingsWindow.tsx`).
 *
 * The pictures are Microsoft's own, cut out of a recording of the screensaver (`assets/aquarium/README.txt`); Luke made them an
 * exception to the hand-drawn rule (.claude/rules/core.md, Asset Rules). Code draws nothing here: it moves, flips, sizes and
 * tints those pictures, which is motion and colour, not artwork.
 *
 * Drawn once in `layout.tsx`, fixed under everything (`.aquarium`, globals.css), and only while AQUARIUM is the chosen background.
 * It is drawn in the browser only - the server cannot know a reader chose TILE - and the sea's black is laid down by the
 * stylesheet before then, from the boot script's `data-backdrop`, so nothing flashes.
 *
 * Where everything is comes from one small simulation (`../lib/aquarium/sim.ts`), stepped fifteen times a second - whole frames,
 * never eased (docs/design.md, Feel) - from a single `requestAnimationFrame` loop that writes each picture's place straight to
 * its element. Nothing about a fish's place is React state, so a swimming sea re-renders nothing. The loop stops while the tab
 * is hidden; under `prefers-reduced-motion` it never starts, and the fish, bubbles and food are not drawn at all (the coral, the
 * tint and the light stay).
 */

/** How often the sea moves on: the screensaver's own stepped look. */
const TICK = 1 / 15;

const art = (file: string) => `/assets/aquarium/${file}`;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

type Size = { w: number; h: number };

/** How strongly the tint shows at a setting: never so thick the fish can't be seen. */
const tintOpacity = (tint: number) => (tint / 100) * 0.6;

/** A fish's picture: its strip stepped through by CSS, mirrored by the loop when it faces the other way. */
function fishStyles(plan: FishPlan, settings: AquariumSettings, n: number): { box: CSSProperties; sprite: CSSProperties } {
  const w = plan.species.w * plan.scale;
  const h = plan.species.h * plan.scale;
  return {
    box: {
      width: w,
      height: h,
      // Each fish a different way round the colours.
      ...(settings.rainbow ? { animationDuration: `${6 / settings.time}s`, animationDelay: `${-((n * 0.7) % 6)}s` } : {}),
    },
    sprite: {
      backgroundImage: `url(${art(plan.species.file)})`,
      backgroundSize: `${plan.species.frames * w}px ${h}px`,
      '--aquarium-strip': `${-plan.species.frames * w}px`,
      animationDuration: `${plan.species.frames / (settings.flap * settings.time)}s`,
      animationTimingFunction: `steps(${plan.species.frames})`,
    } as CSSProperties,
  };
}

function Sea({ settings, giant, hidden, still }: { settings: AquariumSettings; giant: boolean; hidden: boolean; still: boolean }) {
  const [screen, setScreen] = useState<Size | null>(null);
  useEffect(() => {
    const measure = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const plan = useMemo(() => fishPlan(settings, giant), [settings, giant]);
  const world: Size | null = settings.tiny ? TINY_TANK : screen;
  // Bubbles and food are shown at the size the screensaver showed them; in the tiny tank, at half that, like everything else.
  const small = settings.tiny ? 1 : 2;
  const coral = settings.tiny ? 1 : settings.coralSize;

  const tank = useRef<HTMLDivElement>(null);
  const fishEls = useRef<(HTMLDivElement | null)[]>([]);
  const spriteEls = useRef<(HTMLDivElement | null)[]>([]);
  const streamEls = useRef<(HTMLDivElement | null)[]>([]);
  const bubbleEls = useRef<(HTMLDivElement | null)[]>([]);
  const pelletEls = useRef<(HTMLDivElement | null)[]>([]);
  const tintEl = useRef<HTMLDivElement>(null);
  const darkEl = useRef<HTMLDivElement>(null);
  const sim = useRef<SimState | null>(null);
  /** The pointer, where the browser says it is; null while it is off the page. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** What the loop reads: the newest settings, plan and sea size, without the loop restarting for every knob. */
  const now = useRef({ settings, plan, world, small, coral });
  useEffect(() => {
    now.current = { settings, plan, world, small, coral };
  });

  // The pointer is only watched while a knob that uses it is on.
  const watchesPointer = !still && (settings.pointer !== 'ignore' || settings.wake);
  useEffect(() => {
    if (!watchesPointer) return;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const leave = () => {
      pointer.current = null;
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      pointer.current = null;
    };
  }, [watchesPointer]);

  /** A place on the screen as a place in the sea, which may be flipped, mirrored or shrunk into its tank. Null when outside it. */
  const toSea = (x: number, y: number, inside: boolean): { x: number; y: number } | null => {
    const box = tank.current?.getBoundingClientRect();
    const { settings: s, world: size } = now.current;
    if (box === undefined || size === null) return null;
    let seaX = x - box.left;
    let seaY = y - box.top;
    if (inside && (seaX < 0 || seaY < 0 || seaX > size.w || seaY > size.h)) return null;
    if (s.mirror) seaX = size.w - seaX;
    if (s.upsideDown) seaY = size.h - seaY;
    return { x: seaX, y: seaY };
  };

  // A click on the bare sea - the desk round the site window, never anything on the page - drops food or lets out bubbles.
  const takesClicks = !still && (settings.feed || settings.clickBubbles);
  useEffect(() => {
    if (!takesClicks) return;
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('[data-site-window="desk"]') === null || event.target.closest('[data-site-window="frame"]') !== null) return;
      const spot = toSea(event.clientX, event.clientY, true);
      if (spot === null || sim.current === null) return;
      if (now.current.settings.feed) dropPellet(sim.current, spot.x, spot.y);
      if (now.current.settings.clickBubbles) burstBubbles(sim.current, spot.x, spot.y, Math.random);
    };
    document.addEventListener('pointerdown', press);
    return () => document.removeEventListener('pointerdown', press);
    // (`toSea` reads refs only, so it is not something to re-run for.)
  }, [takesClicks]);

  // The one loop.
  useEffect(() => {
    if (hidden || still) return;
    if (sim.current === null) sim.current = newSim();
    const state = sim.current;
    let frame = 0;
    let last = performance.now();
    let owed = 0;

    const place = (el: HTMLDivElement | null | undefined, x: number, y: number, opacity: number) => {
      if (el === null || el === undefined) return;
      el.style.opacity = String(opacity);
      if (opacity > 0) el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };

    const draw = () => {
      const { settings: s, plan: fish, world: size, small: bubbleScale, coral: coralScale } = now.current;
      if (size === null) return;
      for (let n = 0; n < fish.length; n += 1) {
        const el = fishEls.current[n];
        const body = state.fish[n];
        if (el === null || el === undefined || body === undefined) continue;
        if (body.wait > 0) {
          el.style.visibility = 'hidden';
          continue;
        }
        const w = fish[n].species.w * fish[n].scale;
        const h = fish[n].species.h * fish[n].scale;
        el.style.visibility = 'visible';
        el.style.transform = `translate(${Math.round(body.x - w / 2)}px, ${Math.round(body.y - h / 2)}px)`;
        const sprite = spriteEls.current[n];
        if (sprite !== null && sprite !== undefined) sprite.style.transform = body.face === fish[n].species.faces ? '' : 'scaleX(-1)';
      }

      const current = currentOf(s);
      const path = bubbleScale / 2;
      /** How far the current has carried a bubble that is `age` of the way through its loop. */
      const carried = (age: number) => (current * age * BUBBLE_LOOP) / s.bubbleSpeed;
      BUBBLE_STREAMS.forEach((stream, side) => {
        const on = stream.side === 'left' ? s.coralLeft : s.coralRight;
        for (let n = 0; n < s.bubbles; n += 1) {
          const bubble = streamBubble(state.t, n, s.bubbleSpeed);
          const at = bubbleAt(bubble.age);
          const width = (bubble.big ? 7 : 5) * bubbleScale;
          const along = (stream.x + bubble.offset) * coralScale;
          const x = (stream.side === 'left' ? along : size.w - along - width) + at.dx * path + carried(Math.max(0, bubble.age));
          // Off the coral while it is there; off the sea floor when it has been switched off.
          const y = size.h - (on ? stream.y * coralScale : 0) - width + at.dy * path;
          place(streamEls.current[side * 8 + n], x, y, at.opacity);
        }
      });
      for (let n = 0; n < MOST_BUBBLES; n += 1) {
        const bubble = state.bubbles[n];
        if (bubble === undefined) {
          place(bubbleEls.current[n], 0, 0, 0);
          continue;
        }
        const age = ((state.t - bubble.born) * s.bubbleSpeed) / BUBBLE_LOOP;
        const at = bubbleAt(age);
        const el = bubbleEls.current[n];
        if (el !== null && el !== undefined) {
          const width = (bubble.big ? 7 : 5) * bubbleScale;
          el.style.width = `${width}px`;
          el.style.height = `${width}px`;
        }
        place(el, bubble.x + at.dx * path + carried(age), bubble.y + at.dy * path, at.opacity);
      }
      for (let n = 0; n < MOST_PELLETS; n += 1) {
        const pellet = state.pellets[n];
        if (pellet === undefined) place(pelletEls.current[n], 0, 0, 0);
        else place(pelletEls.current[n], pellet.x - (3 * bubbleScale) / 2, pellet.y - (3 * bubbleScale) / 2, 1);
      }

      // The two overlays the loop owns while their knob is on (they are keyed on it, so React takes them back after).
      if (s.disco && tintEl.current !== null) {
        tintEl.current.style.filter = `hue-rotate(${discoHue(state.t)}deg)`;
        tintEl.current.style.opacity = String(tintOpacity(Math.max(35, s.tint)));
      }
      if (s.dayNight && darkEl.current !== null) {
        darkEl.current.style.opacity = (1 - (s.light / 100) * (1 - 0.6 * nightAt(s, state.t))).toFixed(3);
      }
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      // A stall (a busy page, a tab just back) is not caught up on: the fish carry on from where they were.
      owed += Math.min(0.2, (time - last) / 1000);
      last = time;
      if (owed < TICK) return;
      const steps = Math.min(2, Math.floor(owed / TICK));
      owed = Math.min(TICK, owed - steps * TICK);
      const { settings: s, plan: fish, world: size } = now.current;
      if (size === null) return;
      // In the TINY TANK the fish only mind a pointer that is over the tank.
      const at = pointer.current === null ? null : toSea(pointer.current.x, pointer.current.y, s.tiny);
      for (let n = 0; n < steps; n += 1) stepSim(state, fish, s, { w: size.w, h: size.h, pointer: at }, TICK * s.time, Math.random);
      draw();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // (The loop reads everything else through `now`.)
  }, [hidden, still]);

  const flipped = settings.mirror || settings.upsideDown;

  return (
    <div
      aria-hidden="true"
      className="aquarium z-backdrop"
      data-aquarium={hidden ? 'paused' : still ? 'still' : 'on'}
      data-aquarium-fish-count={still ? 0 : plan.length}
    >
      <div
        ref={tank}
        className={settings.tiny ? 'aquarium-tank aquarium-tank-tiny' : 'aquarium-tank'}
        style={flipped ? { transform: `scale(${settings.mirror ? -1 : 1}, ${settings.upsideDown ? -1 : 1})` } : undefined}
      >
        <div className={settings.tide && !still ? 'aquarium-water aquarium-tide' : 'aquarium-water'} style={{ animationDuration: `${16 / settings.time}s` }}>
          {/* The coral, in the corners it sat in. Plain pictures: nothing moves them. */}
          {settings.coralLeft ? (
            // eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number zoom; the optimiser would resample it
            <img src={art('coral-left.png')} alt="" className="aquarium-still left-0" width={216 * coral} height={208 * coral} />
          ) : null}
          {settings.coralRight ? (
            // eslint-disable-next-line @next/next/no-img-element -- as above
            <img src={art('coral-right.png')} alt="" className="aquarium-still right-0" width={178 * coral} height={141 * coral} />
          ) : null}

          {still
            ? null
            : plan.map((fish, n) => {
                const styles = fishStyles(fish, settings, n);
                return (
                  <div
                    // Keyed by its place in the plan: a fish that changes kind or size keeps swimming from where it is.
                    key={n}
                    ref={(el) => {
                      fishEls.current[n] = el;
                    }}
                    className={settings.rainbow ? 'aquarium-fish aquarium-rainbow' : 'aquarium-fish'}
                    style={styles.box}
                    data-aquarium-fish={fish.species.id}
                  >
                    <div
                      ref={(el) => {
                        spriteEls.current[n] = el;
                      }}
                      className="aquarium-sprite"
                      style={styles.sprite}
                    />
                  </div>
                );
              })}

          {still
            ? null
            : BUBBLE_STREAMS.map((stream, side) =>
                Array.from({ length: settings.bubbles }, (_, n) => (
                  <div
                    key={`${stream.side}-${n}`}
                    ref={(el) => {
                      streamEls.current[side * 8 + n] = el;
                    }}
                    className="aquarium-bubble"
                    style={{ width: (n % 2 === 0 ? 7 : 5) * small, height: (n % 2 === 0 ? 7 : 5) * small, backgroundImage: `url(${art(n % 2 === 0 ? 'bubble-big.png' : 'bubble-small.png')})` }}
                  />
                )),
              )}

          {/* Bubbles from a click or the pointer's wake, and food: a fixed set of pictures the loop shows and hides. */}
          {still
            ? null
            : Array.from({ length: MOST_BUBBLES }, (_, n) => (
                <div
                  key={`loose-${n}`}
                  ref={(el) => {
                    bubbleEls.current[n] = el;
                  }}
                  className="aquarium-bubble"
                  style={{ backgroundImage: `url(${art('bubble-small.png')})` }}
                  data-aquarium-bubble="loose"
                />
              ))}
          {still
            ? null
            : Array.from({ length: MOST_PELLETS }, (_, n) => (
                <div
                  key={`pellet-${n}`}
                  ref={(el) => {
                    pelletEls.current[n] = el;
                  }}
                  className="aquarium-bubble"
                  style={{ width: 3 * small, height: 3 * small, backgroundImage: `url(${art('pellet.png')})` }}
                  data-aquarium-pellet=""
                />
              ))}
        </div>

        {/* The water's colour, its murk and its light: flat fields of colour over the pictures, nothing drawn. */}
        <div
          key={settings.disco ? 'disco' : 'tint'}
          ref={tintEl}
          className="aquarium-tint"
          style={{ opacity: tintOpacity(settings.tint), filter: `hue-rotate(${settings.tintHue}deg)` }}
        />
        {settings.murk > 0 ? <div className="aquarium-murk-blur" style={{ backdropFilter: `blur(${((settings.murk / 100) * 3).toFixed(1)}px)` }} /> : null}
        {settings.murk > 0 ? <div className="aquarium-murk-haze" style={{ opacity: (settings.murk / 100) * 0.35 }} /> : null}
        <div key={settings.dayNight ? 'cycle' : 'light'} ref={darkEl} className="aquarium-dark" style={{ opacity: 1 - settings.light / 100 }} />
      </div>
    </div>
  );
}

export default function Aquarium() {
  // Nothing on the server or while hydrating: the server cannot know what this browser chose.
  const chosen = useSyncExternalStore<BackdropState | null>(subscribeToBackdrop, backdropState, () => null);
  const settings = useSyncExternalStore(subscribeToAquariumSettings, aquariumSettings, serverAquariumSettings);
  const giant = useSyncExternalStore(subscribeToAquariumGiant, aquariumGiant, serverAquariumGiant);
  const still = useSyncExternalStore(subscribeToReducedMotion, reducedMotion, () => false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const follow = () => setHidden(document.hidden);
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => document.removeEventListener('visibilitychange', follow);
  }, []);

  if (chosen?.id !== 'aquarium') return null;

  return <Sea settings={settings} giant={giant} hidden={hidden} still={still} />;
}
