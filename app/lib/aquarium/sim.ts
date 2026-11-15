/**
 * How the AQUARIUM's fish, bubbles and food move (SPEC-aquarium-settings.md). Plain numbers in, plain numbers out: no browser,
 * no pictures. `../../components/Aquarium.tsx` calls `stepSim` about fifteen times a second and puts each picture where this says.
 *
 * With `DEFAULT_SETTINGS` this is the screensaver as it shipped: each fish crosses alone at the speed it had in the recording,
 * at a depth and with a drift picked for that crossing, leaves, waits a few seconds and comes back from either side. Every
 * other behaviour (shoals, turning, the pointer, food, the current, gravity) is steering added on top of that crossing, after
 * Reynolds' boids and the seek / flee / arrive of Nature of Code (sources in the SPEC).
 */
import type { AquariumSettings } from './settings';

export type SpeciesId = 'butterfly' | 'trigger' | 'ray' | 'stripe';

export type Species = {
  id: SpeciesId;
  /** A strip of `frames` frames side by side, each `w` x `h`, the fish facing `faces`. */
  file: string;
  w: number;
  h: number;
  frames: number;
  faces: 1 | -1;
  /** How fast it crossed the recording, in its own pixels a second. */
  speed: number;
};

/** The four fish the recording shows, with the speeds they swam at in it (`assets/aquarium/README.txt`). */
export const SPECIES: readonly Species[] = [
  { id: 'butterfly', file: 'fish-butterfly.png', w: 81, h: 55, frames: 6, faces: 1, speed: 33 },
  { id: 'trigger', file: 'fish-trigger.png', w: 97, h: 73, frames: 11, faces: 1, speed: 60 },
  { id: 'ray', file: 'fish-ray.png', w: 120, h: 62, frames: 6, faces: -1, speed: 35 },
  { id: 'stripe', file: 'fish-stripe.png', w: 76, h: 54, frames: 6, faces: 1, speed: 25 },
];

/** GIANT MODE's size, and the most fish it shows: forty fish at eight times their size is more picture than a screen holds. */
export const GIANT_SCALE = 8;
export const GIANT_MOST = 8;

/** The TINY TANK's box, and the size everything in it is shown at. */
export const TINY_TANK = { w: 400, h: 300 } as const;

export type FishPlan = { species: Species; scale: number; school: number };

/** A whole number from 0 up that is the same for the same fish every time, so MIXED SIZES doesn't reshuffle on every change. */
function steadyNumber(n: number): number {
  let x = (n + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * Which fish there are: the count shared round the kinds that are on, each with its size and its shoal. Shoals are of one kind,
 * `schoolSize` fish at the most.
 */
export function fishPlan(settings: AquariumSettings, giant = false): FishPlan[] {
  const kinds = SPECIES.filter((species) => settings[species.id]);
  if (kinds.length === 0) return [];
  const count = giant ? Math.min(settings.count, GIANT_MOST) : settings.count;
  const plan: FishPlan[] = [];
  for (let n = 0; n < count; n += 1) {
    const kind = n % kinds.length;
    const scale = settings.tiny ? 1 : giant ? GIANT_SCALE : settings.mixed ? 1 + (steadyNumber(n) % settings.size) : settings.size;
    plan.push({ species: kinds[kind], scale, school: kind * 100 + Math.floor(Math.floor(n / kinds.length) / settings.schoolSize) });
  }
  return plan;
}

export type SimFish = {
  /** Its middle, in the sea's own pixels. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The way it means to go, and the way its picture faces (they differ for a moment while it turns). */
  dir: 1 | -1;
  face: 1 | -1;
  /** Seconds until it comes in; 0 while it is in the sea. */
  wait: number;
  /** Its own slow rise or fall, pixels a second. */
  drift: number;
};

export type SimBubble = { x: number; y: number; born: number; big: boolean };
export type SimPellet = { x: number; y: number; born: number };

export type SimState = {
  /** Seconds of the sea's own time (TIME stretches it). */
  t: number;
  fish: SimFish[];
  /** Bubbles let out by a click or the pointer's wake; the coral's own streams are worked out from `t` alone. */
  bubbles: SimBubble[];
  pellets: SimPellet[];
  /** Where the wake last let a bubble out. */
  wake: { x: number; y: number } | null;
};

export type SimEnv = {
  /** The sea's size. */
  w: number;
  h: number;
  /** The pointer, in the sea's own pixels, while it is over the page. */
  pointer: { x: number; y: number } | null;
};

export const MOST_BUBBLES = 24;
export const MOST_PELLETS = 12;

export function newSim(): SimState {
  return { t: 0, fish: [], bubbles: [], pellets: [], wake: null };
}

/** How dark it is, 0 (day) to 1 (the middle of the night): a four-minute round, starting at midday. */
export function nightAt(settings: AquariumSettings, t: number): number {
  return settings.dayNight ? (1 - Math.cos((t / 240) * Math.PI * 2)) / 2 : 0;
}

/** DISCO's colour at a moment: a jump round the colour wheel three times every two seconds. */
export function discoHue(t: number): number {
  return (Math.floor(t * 1.5) * 97) % 360;
}

/** The speed a fish cruises at, pixels a second. A bigger fish covers the same lengths of itself. */
function cruiseOf(plan: FishPlan, settings: AquariumSettings, night: number): number {
  return plan.species.speed * plan.scale * settings.speed * (1 - 0.4 * night);
}

/** The band of the sea a fish of this height keeps its middle in. */
function bandOf(settings: AquariumSettings, env: SimEnv, h: number): { top: number; bottom: number } {
  const lowest = Math.max(h / 2, env.h - h / 2);
  const top = Math.min(lowest, (settings.depthTop / 100) * env.h + h / 2);
  const bottom = Math.min(lowest, (settings.depthBottom / 100) * env.h + h / 2);
  return { top, bottom: Math.max(top, bottom) };
}

/** Puts a fish at the start of a crossing: off one side, at a depth in its band, with a drift for the trip. */
function enter(fish: SimFish, plan: FishPlan, settings: AquariumSettings, env: SimEnv, night: number, random: () => number): void {
  const w = plan.species.w * plan.scale;
  const h = plan.species.h * plan.scale;
  const cruise = cruiseOf(plan, settings, night);
  const band = bandOf(settings, env, h);
  const current = currentOf(settings);
  fish.dir = random() < 0.5 ? 1 : -1;
  // Hardly making way against the current: it turns and goes with the water.
  if (Math.abs(fish.dir * cruise + current) < 8 && current !== 0) fish.dir = current > 0 ? 1 : -1;
  fish.face = fish.dir;
  // It comes in on the side it will be carried from. Against a current stronger than it is, that is the side it faces: it
  // swims on and is swept across the sea tail first.
  const going = fish.dir * cruise + current;
  fish.x = going > 0 ? -w / 2 : env.w + w / 2;
  fish.y = band.top + random() * (band.bottom - band.top);
  // As the screensaver had it: up to 80 pixels up or down over the whole crossing.
  const seconds = (env.w + w) / Math.max(1, Math.abs(going));
  fish.drift = ((random() - 0.5) * 160) / seconds;
  fish.vx = fish.dir * cruise;
  fish.vy = fish.drift;
}

function newFish(random: () => number): SimFish {
  // They arrive one by one, not all at once.
  return { x: 0, y: 0, vx: 0, vy: 0, dir: 1, face: 1, wait: 0.05 + random() * 12, drift: 0 };
}

/** Food dropped at a spot. The oldest goes when there is too much. */
export function dropPellet(state: SimState, x: number, y: number): void {
  state.pellets.push({ x, y, born: state.t });
  if (state.pellets.length > MOST_PELLETS) state.pellets.shift();
}

function addBubble(state: SimState, x: number, y: number, big: boolean): void {
  state.bubbles.push({ x, y, born: state.t, big });
  if (state.bubbles.length > MOST_BUBBLES) state.bubbles.shift();
}

/** A burst of bubbles from a spot. */
export function burstBubbles(state: SimState, x: number, y: number, random: () => number): void {
  for (let n = 0; n < 6; n += 1) addBubble(state, x + (random() - 0.5) * 36, y + (random() - 0.5) * 24, n % 2 === 0);
}

/** The bubble's own loop: 4.2 seconds from let out to gone, at BUBBLE SPEED 1. */
export const BUBBLE_LOOP = 4.2;

/** The path every bubble takes, as the screensaver's did: up 200 pixels with a small wobble, in at the start and out at the end. */
const BUBBLE_PATH: readonly { at: number; x: number; y: number }[] = [
  { at: 0, x: 0, y: 0 },
  { at: 0.3, x: 4, y: -60 },
  { at: 0.6, x: -3, y: -120 },
  { at: 0.9, x: 2, y: -180 },
  { at: 1, x: 0, y: -200 },
];

/** Where a bubble is, `age` of the way through its loop (0 to 1), from where it was let out; `opacity` 0 means not drawn. */
export function bubbleAt(age: number): { dx: number; dy: number; opacity: number } {
  if (age < 0 || age >= 1) return { dx: 0, dy: 0, opacity: 0 };
  let n = 1;
  while (n < BUBBLE_PATH.length - 1 && BUBBLE_PATH[n].at < age) n += 1;
  const from = BUBBLE_PATH[n - 1];
  const to = BUBBLE_PATH[n];
  const part = (age - from.at) / (to.at - from.at);
  const opacity = age < 0.03 ? age / 0.03 : age > 0.9 ? (1 - age) / 0.1 : 1;
  return { dx: from.x + (to.x - from.x) * part, dy: from.y + (to.y - from.y) * part, opacity };
}

/** When each of a stream's bubbles starts within the loop, and how far along the coral it starts. The first four are the screensaver's. */
const STREAM_STARTS: readonly number[] = [0, 0.9, 2.1, 2.8, 0.45, 1.5, 3.3, 3.75];
const STREAM_OFFSETS: readonly number[] = [-4, -1, 2, 5, -7, 0.5, 3.5, 8];

/** Where a coral's stream starts, in the coral picture's own pixels: `x` in from its side of the sea, `y` up from the bottom. */
export const BUBBLE_STREAMS = [
  { side: 'left', x: 105, y: 94 },
  { side: 'right', x: 30, y: 104 },
] as const;

/** Bubble `n` of a coral's stream at a moment: how far through its loop it is (under 0: not let out yet), and its start along the coral. */
export function streamBubble(t: number, n: number, bubbleSpeed: number): { age: number; offset: number; big: boolean } {
  const since = t * bubbleSpeed - STREAM_STARTS[n % STREAM_STARTS.length];
  return { age: since < 0 ? -1 : (since % BUBBLE_LOOP) / BUBBLE_LOOP, offset: STREAM_OFFSETS[n % STREAM_OFFSETS.length], big: n % 2 === 0 };
}

/** The current, pixels a second: at 100 it is faster than most of the fish. */
export function currentOf(settings: AquariumSettings): number {
  return settings.current * 0.6;
}

/** How far a fish will come for food, in pixels. */
function greedOf(settings: AquariumSettings): number {
  return 100 + settings.greed * 19;
}

const TURN = 2.5;

/**
 * One step of the sea: `dt` seconds of its own time. `plan` is `fishPlan` for the same settings; the fish are matched to it
 * here, so a knob can change mid-swim without every fish starting again.
 */
export function stepSim(state: SimState, plan: readonly FishPlan[], settings: AquariumSettings, env: SimEnv, dt: number, random: () => number): void {
  state.t += dt;
  const night = nightAt(settings, state.t);
  while (state.fish.length < plan.length) state.fish.push(newFish(random));
  if (state.fish.length > plan.length) state.fish.length = plan.length;

  const current = currentOf(settings);
  const sink = (settings.gravity / 100) * 90 + 5 * night;
  const schooling = settings.schooling / 100;
  // Shoals and parades stay in the sea: their fish turn at the edges where a fish alone would leave and come back later.
  const stays = schooling > 0 || settings.parade;
  const pointer = env.pointer;

  // The wake: a small bubble for every stretch the pointer travels.
  if (settings.wake && pointer !== null) {
    if (state.wake === null) state.wake = { x: pointer.x, y: pointer.y };
    else if (Math.hypot(pointer.x - state.wake.x, pointer.y - state.wake.y) > 36) {
      addBubble(state, pointer.x, pointer.y, false);
      state.wake = { x: pointer.x, y: pointer.y };
    }
  } else state.wake = null;

  // Food sinks (or rises, with gravity turned over), drifts on the current, rests on the floor, and goes when its time is up.
  const pelletSpeed = Math.max(-40, 28 + (settings.gravity / 100) * 60);
  state.pellets = state.pellets.filter((pellet) => state.t - pellet.born < settings.pelletLife);
  for (const pellet of state.pellets) {
    const resting = pellet.y >= env.h - 6 || pellet.y <= 6;
    pellet.y = Math.min(env.h - 6, Math.max(6, pellet.y + pelletSpeed * dt));
    if (!resting) pellet.x = Math.min(env.w - 4, Math.max(4, pellet.x + current * 0.5 * dt));
  }
  state.bubbles = state.bubbles.filter((bubble) => (state.t - bubble.born) * settings.bubbleSpeed < BUBBLE_LOOP);

  for (let n = 0; n < plan.length; n += 1) {
    const fish = state.fish[n];
    const mine = plan[n];
    const w = mine.species.w * mine.scale;
    const h = mine.species.h * mine.scale;
    const cruise = cruiseOf(mine, settings, night);

    if (fish.wait > 0) {
      fish.wait -= dt;
      // A shoal doesn't wait long for its stragglers.
      if (stays && fish.wait > 1.5) fish.wait = 1.5;
      if (fish.wait > 0) continue;
      fish.wait = 0;
      enter(fish, mine, settings, env, night, random);
      continue;
    }

    // WANDER: now and then a change of mind, either the other way or a new slope.
    if (settings.wander > 0 && random() < (settings.wander / 100) * 0.25 * dt) {
      if (random() < 0.5) fish.dir = fish.dir === 1 ? -1 : 1;
      else fish.drift = (random() - 0.5) * 80 * (settings.wander / 100);
    }

    let wantX = fish.dir * cruise;
    let wantY = fish.drift;
    let pushX = 0;
    let pushY = 0;
    let most = cruise * 1.5;

    if (stays) {
      if (fish.x < -w / 2 && fish.dir === -1) {
        fish.dir = 1;
        fish.drift = (random() - 0.5) * 30;
      } else if (fish.x > env.w + w / 2 && fish.dir === 1) {
        fish.dir = -1;
        fish.drift = (random() - 0.5) * 30;
      }
      wantX = fish.dir * cruise;
    }

    // Kept to its band whenever it isn't just crossing: a soft push back, stronger the further out it is.
    if (stays || settings.wander > 0 || settings.pointer !== 'ignore' || state.pellets.length > 0) {
      const band = bandOf(settings, env, h);
      if (fish.y < band.top) pushY += (band.top - fish.y) * 1.5;
      else if (fish.y > band.bottom) pushY -= (fish.y - band.bottom) * 1.5;
    }

    const leader = settings.parade && n > 0 ? state.fish[n - 1] : null;
    if (leader !== null && leader.wait <= 0) {
      // FOLLOW THE LEADER: make for the spot just behind the fish in front, slowing as it gets there.
      const ahead = plan[n - 1];
      const targetX = leader.x - leader.face * ((ahead.species.w * ahead.scale) / 2 + w * 0.6);
      const dx = targetX - fish.x;
      const dy = leader.y - fish.y;
      const far = Math.hypot(dx, dy);
      const pace = Math.min(cruise * 1.8, far * 2);
      if (far > 1) {
        wantX = (dx / far) * pace;
        wantY = (dy / far) * pace;
      }
      if (Math.abs(dx) > w * 0.2) fish.dir = dx > 0 ? 1 : -1;
      most = cruise * 1.8;
    } else if (schooling > 0) {
      // SCHOOLING: towards the middle of its shoal, at the shoal's speed and heading, and not on top of its neighbours.
      let mates = 0;
      let midX = 0;
      let midY = 0;
      let paceX = 0;
      let paceY = 0;
      for (let m = 0; m < plan.length; m += 1) {
        const mate = state.fish[m];
        if (m === n || plan[m].school !== mine.school || mate.wait > 0) continue;
        mates += 1;
        midX += mate.x;
        midY += mate.y;
        paceX += mate.vx;
        paceY += mate.vy;
        const apart = Math.hypot(fish.x - mate.x, fish.y - mate.y);
        const room = Math.max(w, plan[m].species.w * plan[m].scale) * 0.7;
        if (apart < room && apart > 0.01) {
          const shove = ((room - apart) / room) * 260 * schooling;
          pushX += ((fish.x - mate.x) / apart) * shove;
          pushY += ((fish.y - mate.y) / apart) * shove;
        }
      }
      if (mates > 0) {
        pushX += (midX / mates - fish.x) * 0.6 * schooling + (paceX / mates - fish.vx) * 1.2 * schooling;
        pushY += (midY / mates - fish.y) * 0.6 * schooling + (paceY / mates - fish.vy) * 1.2 * schooling;
        // The shoal turns together: a fish heading against the rest comes round.
        const heading = paceX / mates;
        if (Math.abs(heading) > cruise * 0.3 && heading > 0 !== (fish.dir === 1) && random() < schooling * 2 * dt) fish.dir = heading > 0 ? 1 : -1;
      }
    }

    if (pointer !== null && settings.pointer === 'follow') {
      // FOLLOW: drift after the pointer and hang about beside it.
      const dx = pointer.x - fish.x;
      const dy = pointer.y - fish.y;
      const far = Math.hypot(dx, dy);
      if (far > w * 0.4) {
        const pace = Math.min(cruise * 1.4, far * 1.5);
        wantX = (dx / far) * pace;
        wantY = (dy / far) * pace;
      } else {
        wantX = 0;
        wantY = 0;
      }
      if (Math.abs(dx) > w * 0.3) fish.dir = dx > 0 ? 1 : -1;
    }

    // Food: the nearest piece within reach, at a dash. It goes when a fish gets to it.
    if (state.pellets.length > 0) {
      const reach = greedOf(settings);
      let nearest = -1;
      let nearestFar = reach;
      for (let p = 0; p < state.pellets.length; p += 1) {
        const far = Math.hypot(state.pellets[p].x - fish.x, state.pellets[p].y - fish.y);
        if (far < nearestFar) {
          nearest = p;
          nearestFar = far;
        }
      }
      if (nearest >= 0) {
        const pellet = state.pellets[nearest];
        if (nearestFar < Math.max(12, w * 0.25)) state.pellets.splice(nearest, 1);
        else {
          const dx = pellet.x - fish.x;
          const pace = Math.min(cruise * 2.2, nearestFar * 3);
          wantX = (dx / nearestFar) * pace;
          wantY = ((pellet.y - fish.y) / nearestFar) * pace;
          if (Math.abs(dx) > 6) fish.dir = dx > 0 ? 1 : -1;
          most = cruise * 2.2;
        }
      }
    }

    if (pointer !== null && settings.pointer === 'scare') {
      // SCARE: bolt straight away from the pointer, harder the nearer it is. Fear beats food.
      const dx = fish.x - pointer.x;
      const dy = fish.y - pointer.y;
      const far = Math.hypot(dx, dy);
      const reach = settings.scareRadius + w * 0.3;
      if (far < reach) {
        const fright = 1 - far / reach;
        const kick = fright * Math.max(400, cruise * 8);
        const away = far > 0.01 ? 1 / far : 0;
        pushX += (far > 0.01 ? dx * away : fish.dir) * kick;
        pushY += dy * away * kick;
        most = cruise * 3;
        if (fright > 0.3 && Math.abs(dx) > 4) fish.dir = dx > 0 ? 1 : -1;
      }
    }

    fish.vx += ((wantX - fish.vx) * TURN + pushX) * dt;
    fish.vy += ((wantY - fish.vy) * TURN + pushY) * dt;
    const pace = Math.hypot(fish.vx, fish.vy);
    if (pace > most && pace > 0) {
      fish.vx = (fish.vx / pace) * most;
      fish.vy = (fish.vy / pace) * most;
    }
    fish.x += (fish.vx + current) * dt;
    fish.y += (fish.vy + sink) * dt;
    if (Math.abs(fish.vx) > cruise * 0.15) fish.face = fish.vx > 0 ? 1 : -1;

    // With gravity on, the floor and the surface are solid; otherwise a fish may wander a body's height out of sight and back.
    if (settings.gravity !== 0) fish.y = Math.min(Math.max(h / 2, env.h - h / 2), Math.max(h / 2, fish.y));
    else fish.y = Math.min(env.h + h, Math.max(-h, fish.y));

    // Out of the sea on either side and still going that way: the crossing is over. It comes back after a while.
    const going = fish.vx + current;
    if (!stays && ((fish.x < -w / 2 - 2 && going < 0) || (fish.x > env.w + w / 2 + 2 && going > 0))) fish.wait = 2 + random() * 10;
    // A shoal swept right off by the current comes back in from the other side.
    if (stays && fish.x < -w * 2) fish.x = env.w + w;
    else if (stays && fish.x > env.w + w * 2) fish.x = -w;
  }
}
