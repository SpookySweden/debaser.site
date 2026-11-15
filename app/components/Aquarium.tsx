'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { backdropState, subscribeToBackdrop, type BackdropState } from '../lib/ui/backdrop-slot';

/**
 * The AQUARIUM background (Luke, 2026-11-15): the Windows 98 Underwater screensaver's sea behind the site window. Coral banks in
 * the two bottom corners, fish crossing at their own speeds and depths, bubbles rising off the coral.
 *
 * The pictures are Microsoft's own, cut out of a recording of the screensaver (`assets/aquarium/README.txt`); Luke made them an
 * exception to the hand-drawn rule (.claude/rules/core.md, Asset Rules). Code draws nothing here: it only moves those pictures,
 * which is motion, not artwork.
 *
 * Drawn once in `layout.tsx`, fixed under everything (`.aquarium`, globals.css), and only while AQUARIUM is the chosen background.
 * It is drawn in the browser only - the server cannot know a reader chose TILE - and the sea's black is laid down by the
 * stylesheet before then, from the boot script's `data-backdrop`, so nothing flashes. Every movement is a CSS animation on a
 * transform or a background position, the browser's cheapest kinds; they pause while the tab is hidden and stop altogether
 * under `prefers-reduced-motion` (the fish and bubbles go, the coral stays).
 */

/** Every picture is shown at twice its size, pixel for pixel, the way the screensaver filled a 640x480 screen. */
const SCALE = 2;

/** The sprites' frame rate and the rate their position steps at: whole frames, never eased (docs/design.md, Feel). */
const FRAME_RATE = 10;
const STEP_RATE = 15;

type Fish = {
  id: string;
  /** A strip of `frames` frames side by side, each `w` x `h`, the fish facing `faces`. */
  file: string;
  w: number;
  h: number;
  frames: number;
  faces: 1 | -1;
  /** How fast it crossed the recording, in its own pixels a second. */
  speed: number;
};

/** The four fish the recording shows, with the speeds they swam at in it. */
const FISH: readonly Fish[] = [
  { id: 'butterfly', file: 'fish-butterfly.png', w: 81, h: 55, frames: 6, faces: 1, speed: 33 },
  { id: 'trigger', file: 'fish-trigger.png', w: 97, h: 73, frames: 11, faces: 1, speed: 60 },
  { id: 'ray', file: 'fish-ray.png', w: 120, h: 62, frames: 6, faces: -1, speed: 35 },
  { id: 'stripe', file: 'fish-stripe.png', w: 76, h: 54, frames: 6, faces: 1, speed: 25 },
];

/** Where the bubbles rise, from the coral: `side` is the screen edge `x` is measured from, `y` is up from the bottom. */
const BUBBLE_STREAMS = [
  { side: 'left', x: 105, y: 94 },
  { side: 'right', x: 30, y: 104 },
] as const;

/** Each stream's bubbles: which picture, and how far into the stream's loop it starts. */
const BUBBLES = [
  { file: 'bubble-big.png', size: 7, delay: 0 },
  { file: 'bubble-small.png', size: 5, delay: 0.9 },
  { file: 'bubble-big.png', size: 7, delay: 2.1 },
  { file: 'bubble-small.png', size: 5, delay: 2.8 },
] as const;

const BUBBLE_LOOP = 4.2;

const art = (file: string) => `/assets/aquarium/${file}`;

type Swim = { run: number; dir: 1 | -1; top: number; dy: number; delay: number };

/** A fresh crossing: a side to start from, a depth, a drift up or down, and a pause before it sets off. */
function nextSwim(run: number, first: boolean): Swim {
  return {
    run,
    dir: Math.random() < 0.5 ? 1 : -1,
    // Kept above the coral's height for the most part, as the screensaver kept them.
    top: 0.04 + Math.random() * 0.56,
    dy: (Math.random() - 0.5) * 160,
    // On arrival the fish come in one by one rather than all at once.
    delay: first ? Math.random() * 12 : 2 + Math.random() * 10,
  };
}

function SwimmingFish({ fish }: { fish: Fish }) {
  const [swim, setSwim] = useState<Swim>(() => nextSwim(0, true));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const onEnd = useCallback(() => setSwim((last) => nextSwim(last.run + 1, false)), []);

  if (width === 0) return null;

  const w = fish.w * SCALE;
  const h = fish.h * SCALE;
  const from = swim.dir === 1 ? -w : width;
  const to = swim.dir === 1 ? width : -w;
  const seconds = (width + w) / (fish.speed * SCALE);

  const travel = {
    top: `${swim.top * 100}%`,
    width: w,
    height: h,
    '--aquarium-from': `${from}px`,
    '--aquarium-to': `${to}px`,
    '--aquarium-dy': `${swim.dy}px`,
    animationDuration: `${seconds}s`,
    animationDelay: `${swim.delay}s`,
    animationTimingFunction: `steps(${Math.max(1, Math.round(seconds * STEP_RATE))})`,
  } as CSSProperties;

  const sprite = {
    backgroundImage: `url(${art(fish.file)})`,
    backgroundSize: `${fish.frames * w}px ${h}px`,
    '--aquarium-strip': `${-fish.frames * w}px`,
    animationDuration: `${fish.frames / FRAME_RATE}s`,
    animationTimingFunction: `steps(${fish.frames})`,
    // A fish drawn facing the other way swims mirrored.
    transform: fish.faces === swim.dir ? undefined : 'scaleX(-1)',
  } as CSSProperties;

  return (
    <div key={swim.run} className="aquarium-swim" style={travel} onAnimationEnd={onEnd} data-aquarium-fish={fish.id}>
      <div className="aquarium-sprite" style={sprite} />
    </div>
  );
}

export default function Aquarium() {
  // Nothing on the server or while hydrating: the server cannot know what this browser chose.
  const chosen = useSyncExternalStore<BackdropState | null>(subscribeToBackdrop, backdropState, () => null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const follow = () => setHidden(document.hidden);
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => document.removeEventListener('visibilitychange', follow);
  }, []);

  if (chosen?.id !== 'aquarium') return null;

  return (
    <div aria-hidden="true" className="aquarium z-backdrop" data-aquarium={hidden ? 'paused' : 'on'}>
      {/* The coral, in the corners it sat in. Plain pictures: nothing moves them. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number zoom; the optimiser would resample it */}
      <img src={art('coral-left.png')} alt="" className="aquarium-still left-0" width={216 * SCALE} height={208 * SCALE} />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img src={art('coral-right.png')} alt="" className="aquarium-still right-0" width={178 * SCALE} height={141 * SCALE} />

      {BUBBLE_STREAMS.map((stream) =>
        BUBBLES.map((bubble, n) => (
          <div
            key={`${stream.side}-${n}`}
            className="aquarium-bubble"
            style={{
              [stream.side]: (stream.x + n * 3 - 4) * SCALE,
              bottom: stream.y * SCALE,
              width: bubble.size * SCALE,
              height: bubble.size * SCALE,
              backgroundImage: `url(${art(bubble.file)})`,
              animationDuration: `${BUBBLE_LOOP}s`,
              animationDelay: `${bubble.delay}s`,
              animationTimingFunction: `steps(${Math.round(BUBBLE_LOOP * STEP_RATE)})`,
            }}
          />
        )),
      )}

      {FISH.map((fish) => (
        <SwimmingFish key={fish.id} fish={fish} />
      ))}
    </div>
  );
}
