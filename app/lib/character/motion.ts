/**
 * Code-made motion for a character (SPEC-profile-characters.md, Luke 2026-11-13).
 *
 * **Motion isn't artwork (Luke's ruling, core.md's Asset Rules).** The shapes are what a person builds by hand on the
 * workbench; this file only turns their joints over time. It never adds a shape, changes one's size or colour, or draws
 * anything. Every motion is a short list of keyframes of joint turns, in degrees, written here as numbers so they can be
 * tuned by eye. Frames are stepped (the site's no-easing rule), so a keyframe *is* a frame: nothing is blended between
 * two. `hold` repeats a frame for that many ticks without drawing it twice.
 *
 * **How a turn moves a figure.** A turn on a joint swings that joint's own shapes and everything below it round the
 * joint's point (forward kinematics, from the root out). So a turn on the hips tips the whole figure from the hips, on
 * the body tips the body and head, on the head nods only the head. A joint the motion doesn't name follows its parent,
 * which is how shapes added beyond a preset (on their own nodes) still go along. The root can also be lifted (`root`),
 * and the whole figure faces a way (`yaw`): three-quarters to the right for walking, square to the front for dancing.
 * Left-facing frames are the right-facing ones mirrored when shown, never drawn here.
 *
 * **Sag still applies.** Each frame is turned into a plain posed figure (`posedFigure`) and sag is worked out on it
 * afresh (`sagOf`), so whatever hangs off a swinging part swings and droops as it would on the bench.
 *
 * **A keyframe format that a hand-keyed tool could write later** (the spec keeps that door open): joint ids to turns,
 * a lift, a facing and a hold. Nothing here assumes the frames were typed by hand or by code.
 *
 * Pure: no React, no three. Checked in Node by `Temp/check-profile-character.cjs`.
 */
import { placementOf, type Figure, type Placement, type Shape } from './figure';
import type { RigPresetId } from './rig';
import { sagOf } from './sag';
import { jointFrames, type Skeleton, type Vec3 } from './skeleton';
import { eulerFromQuat, IDENTITY, quatFromEuler, quatMultiply, rotateVec, type Quat } from './turns';

/** A joint's turn, in degrees about the world's axes at rest: x tips forward (towards the viewer), y twists round to the
 * figure's left, z tips towards the viewer's left. Missing axes are zero. */
export type JointTurn = { x?: number; y?: number; z?: number };

export type Keyframe = {
  /** Joint id -> its turn. */
  joints?: Record<string, JointTurn>;
  /** The whole figure lifted (y), or moved, in model units. */
  root?: { x?: number; y?: number; z?: number };
  /** Which way the figure faces, in degrees round from the front, overriding the motion's facing for this frame. */
  yaw?: number;
  /** How many ticks this frame stays up. 1 when missing. */
  hold?: number;
};

/** `side`: three-quarters to the right (mirrored for left). `front`: square to the viewer. */
export type Facing = 'side' | 'front';

export type Motion = { facing: Facing; loop: boolean; frames: readonly Keyframe[] };

/** The first set (2026-11-13): every strip ever baked holds these. */
export const CORE_MOTION_IDS = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'] as const;
export type CoreMotionId = (typeof CORE_MOTION_IDS)[number];

/**
 * The companion's wider life (Luke, 2026-11-14: "more animations for it for all of its use cases"): stretching, two more
 * dances, running, cheering, slumping, being picked up and landing, a deep curled-up sleep, watching, reading and turning
 * a page, typing along, and climbing. A strip baked before these has none of them: it plays the motion beside each name
 * instead (`sheet.ts` fills them in on reading), until its owner's browser bakes it again (`rebake.ts`).
 */
export const MOTION_FALLBACK = {
  stretch: 'idle',
  dance4: 'dance2',
  dance5: 'dance3',
  run: 'walk',
  cheer: 'hop',
  slump: 'sit',
  dangle: 'idle',
  land: 'hop',
  curl: 'sleep',
  watch: 'sit',
  read: 'sit',
  flick: 'sit',
  type: 'idle',
  climb: 'walk',
} as const satisfies Record<string, CoreMotionId>;
export type ExtraMotionId = keyof typeof MOTION_FALLBACK;
export const EXTRA_MOTION_IDS = Object.keys(MOTION_FALLBACK) as ExtraMotionId[];

export type MotionId = CoreMotionId | ExtraMotionId;
export const MOTION_IDS: readonly MotionId[] = [...CORE_MOTION_IDS, ...EXTRA_MOTION_IDS];

/** The dances a PARTY character, or a companion hearing music, picks between. */
export const DANCES: readonly MotionId[] = ['dance1', 'dance2', 'dance3', 'dance4', 'dance5'];

/** Three-quarters round: enough to read as walking sideways and still show the figure's front. */
export const SIDE_YAW = 50;
/** Every frame is stepped at this rate. 10 a second sits in the spec's 8-12. */
export const MOTION_FPS = 10;

export const facingYaw = (facing: Facing): number => (facing === 'side' ? SIDE_YAW : 0);

// ---------------------------------------------------------------------------------------------------------------------
// The motions. BASE's are the shared set; each other preset replaces the ones it moves differently. GOBLIN, ROBOT and
// BASE have three joints (hips, body, head) and their legs hang off the hips as one piece, so they waddle rather than
// step (Luke: "Waddle is fine"). GUY's arms swing and wave.
// ---------------------------------------------------------------------------------------------------------------------

const BASE: Record<MotionId, Motion> = {
  // The figure as built, square to the front: what the workbench's FRONT view shows. The bake's proof compares this one.
  stand: { facing: 'front', loop: true, frames: [{}] },

  // Stands, breathes, looks round now and then.
  idle: {
    facing: 'side',
    loop: true,
    frames: [
      { hold: 8 },
      { joints: { body: { x: 2 } }, root: { y: 0.01 }, hold: 6 },
      { hold: 8 },
      { joints: { body: { x: 2 } }, root: { y: 0.01 }, hold: 6 },
      { joints: { head: { y: 25 } }, hold: 10 },
      { hold: 4 },
    ],
  },

  // A waddle: rocking from side to side on the hips, bobbing, leaning into it.
  walk: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { z: 7 }, body: { x: 6, z: -4 } }, root: { y: 0 } },
      { joints: { hips: { z: 4 }, body: { x: 6, z: -2 } }, root: { y: 0.04 } },
      { joints: { hips: { z: 0 }, body: { x: 6 } }, root: { y: 0.06 } },
      { joints: { hips: { z: -4 }, body: { x: 6, z: 2 } }, root: { y: 0.03 } },
      { joints: { hips: { z: -7 }, body: { x: 6, z: 4 } }, root: { y: 0 } },
      { joints: { hips: { z: -4 }, body: { x: 6, z: 2 } }, root: { y: 0.04 } },
      { joints: { hips: { z: 0 }, body: { x: 6 } }, root: { y: 0.06 } },
      { joints: { hips: { z: 4 }, body: { x: 6, z: -2 } }, root: { y: 0.03 } },
    ],
  },

  // Bounce: side to side on the beat.
  dance1: {
    facing: 'front',
    loop: true,
    frames: [
      { joints: { hips: { z: 8 }, body: { z: -12 }, head: { z: 10 } }, root: { y: 0 }, hold: 2 },
      { joints: { hips: { z: 0 }, body: { z: 0 }, head: { z: 0 } }, root: { y: 0.1 } },
      { joints: { hips: { z: -8 }, body: { z: 12 }, head: { z: -10 } }, root: { y: 0 }, hold: 2 },
      { joints: { hips: { z: 0 }, body: { z: 0 }, head: { z: 0 } }, root: { y: 0.1 } },
    ],
  },

  // Twist: hips one way, shoulders the other.
  dance2: {
    facing: 'front',
    loop: true,
    frames: [
      { joints: { hips: { y: 25 }, body: { y: -35 }, head: { y: 20 } }, hold: 2 },
      { joints: { hips: { y: 0 }, body: { y: 0 }, head: { y: 0 } }, root: { y: 0.05 } },
      { joints: { hips: { y: -25 }, body: { y: 35 }, head: { y: -20 } }, hold: 2 },
      { joints: { hips: { y: 0 }, body: { y: 0 }, head: { y: 0 } }, root: { y: 0.05 } },
    ],
  },

  // Nod along: the body dips forward and the head goes with it.
  dance3: {
    facing: 'front',
    loop: true,
    frames: [
      { joints: { body: { x: 0 }, head: { x: -10 } }, root: { y: 0.03 } },
      { joints: { body: { x: 18 }, head: { x: 22 } }, root: { y: 0 }, hold: 2 },
      { joints: { body: { x: 0 }, head: { x: -10 } }, root: { y: 0.03 } },
      { joints: { body: { x: 18 }, head: { x: 22 }, hips: { z: 6 } }, root: { y: 0 }, hold: 2 },
    ],
  },

  // No arms to wave with: a hello wobble, tipping side to side with the head cocked.
  wave: {
    facing: 'front',
    loop: false,
    frames: [
      { joints: { body: { z: 10 }, head: { z: 14 } }, hold: 2 },
      { joints: { body: { z: -10 }, head: { z: -14 } }, hold: 2 },
      { joints: { body: { z: 10 }, head: { z: 14 } }, hold: 2 },
      { joints: { body: { z: -10 }, head: { z: -14 } }, hold: 2 },
      { joints: { head: { z: 10 } }, hold: 4 },
    ],
  },

  // Crouch, up, down, land.
  hop: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { body: { x: 14 }, head: { x: -8 } }, root: { y: -0.05 }, hold: 2 },
      { joints: { body: { x: -4 } }, root: { y: 0.2 } },
      { joints: { body: { x: -6 } }, root: { y: 0.34 } },
      { joints: { body: { x: -4 } }, root: { y: 0.3 } },
      { joints: { body: { x: 2 } }, root: { y: 0.12 } },
      { joints: { body: { x: 12 } }, root: { y: -0.04 }, hold: 2 },
      { hold: 2 },
    ],
  },

  // Turns round to face whoever clicked, and looks at them.
  turn: {
    facing: 'side',
    loop: false,
    frames: [
      { yaw: 34 },
      { yaw: 17 },
      { yaw: 0, hold: 2 },
      { yaw: 0, joints: { head: { z: 12 } }, hold: 8 },
      { yaw: 0, hold: 2 },
    ],
  },

  // Down on the floor: the legs (hung off the hips) swing forward and the body stays upright. For the companion.
  sit: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 70 } }, root: { y: -0.36 }, hold: 20 },
      { joints: { hips: { x: -70 }, body: { x: 72 }, head: { y: 20 } }, root: { y: -0.36 }, hold: 12 },
    ],
  },

  // Sitting, slumped, breathing slowly. For the companion.
  sleep: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 95 }, head: { x: 25 } }, root: { y: -0.36 }, hold: 12 },
      { joints: { hips: { x: -70 }, body: { x: 98 }, head: { x: 28 } }, root: { y: -0.37 }, hold: 12 },
    ],
  },

  // Waking up, or bored: leans back with its head thrown back, tips to each side, settles.
  stretch: {
    facing: 'front',
    loop: false,
    frames: [
      { joints: { body: { x: -6 } }, root: { y: 0.02 }, hold: 2 },
      { joints: { body: { x: -12 }, head: { x: -18 } }, root: { y: 0.05 }, hold: 5 },
      { joints: { body: { x: -12, z: 9 }, head: { x: -18, z: 6 } }, root: { y: 0.05 }, hold: 3 },
      { joints: { body: { x: -12, z: -9 }, head: { x: -18, z: -6 } }, root: { y: 0.05 }, hold: 3 },
      { joints: { body: { x: 4 } }, hold: 2 },
    ],
  },

  // Spin: right round on the spot, an eighth of a turn a frame, bobbing.
  dance4: {
    facing: 'front',
    loop: true,
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
      yaw: index * 45,
      joints: { hips: { z: index % 2 === 0 ? 5 : -5 }, head: { z: index % 2 === 0 ? -6 : 6 } },
      root: { y: index % 2 === 0 ? 0 : 0.06 },
    })),
  },

  // Headbang: the body throws the head down and back.
  dance5: {
    facing: 'front',
    loop: true,
    frames: [
      { joints: { body: { x: 22 }, head: { x: 30 } }, root: { y: 0 } },
      { joints: { body: { x: 8 }, head: { x: 5 } }, root: { y: 0.03 } },
      { joints: { body: { x: -6 }, head: { x: -14 } }, root: { y: 0.06 } },
      { joints: { body: { x: 8 }, head: { x: 5 } }, root: { y: 0.03 } },
    ],
  },

  // A run: the waddle leaning hard into it, twice as quick, with a bigger bounce. For chasing the pointer.
  run: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { z: 9 }, body: { x: 16, z: -5 } }, root: { y: 0 } },
      { joints: { hips: { z: 0 }, body: { x: 18 } }, root: { y: 0.09 } },
      { joints: { hips: { z: -9 }, body: { x: 16, z: 5 } }, root: { y: 0 } },
      { joints: { hips: { z: 0 }, body: { x: 18 } }, root: { y: 0.09 } },
    ],
  },

  // Two jumps for joy, head back. A win, a post filed, a book finished.
  cheer: {
    facing: 'front',
    loop: false,
    frames: [
      { joints: { body: { x: 10 } } },
      { joints: { body: { x: -8 }, head: { x: -14 } }, root: { y: 0.26 }, hold: 2 },
      { joints: { body: { x: -4 } }, root: { y: 0.1 } },
      { joints: { body: { x: 8 } } },
      { joints: { body: { x: -8, z: 6 }, head: { x: -14 } }, root: { y: 0.3 }, hold: 2 },
      { joints: { body: { x: -4 } }, root: { y: 0.1 } },
      { joints: { head: { z: 8 } }, hold: 3 },
    ],
  },

  // Droops, shakes its head slowly, picks itself up. A game lost.
  slump: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { body: { x: 14 }, head: { x: 14 } }, hold: 2 },
      { joints: { body: { x: 26 }, head: { x: 30 } }, hold: 8 },
      { joints: { body: { x: 26 }, head: { x: 30, y: 14 } }, hold: 4 },
      { joints: { body: { x: 26 }, head: { x: 30, y: -14 } }, hold: 4 },
      { joints: { body: { x: 26 }, head: { x: 30 } }, hold: 6 },
      { joints: { body: { x: 10 }, head: { x: 8 } }, hold: 2 },
    ],
  },

  // Picked up by the pointer: it hangs, swinging from the hips.
  dangle: {
    facing: 'front',
    loop: true,
    frames: [
      { joints: { hips: { z: 14 }, body: { z: -8 }, head: { z: -6 } }, hold: 2 },
      { joints: { hips: { z: 0 } } },
      { joints: { hips: { z: -14 }, body: { z: 8 }, head: { z: 6 } }, hold: 2 },
      { joints: { hips: { z: 0 } } },
    ],
  },

  // Dropped: lands bent right over, and straightens.
  land: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { body: { x: 26 }, head: { x: 12 } }, hold: 2 },
      { joints: { body: { x: 12 }, head: { x: -6 } }, hold: 2 },
      { hold: 2 },
    ],
  },

  // A deep sleep, after a long while alone: folded right over its own legs.
  curl: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 122 }, head: { x: 38 } }, root: { y: -0.36 }, hold: 14 },
      { joints: { hips: { x: -70 }, body: { x: 125 }, head: { x: 40 } }, root: { y: -0.37 }, hold: 14 },
    ],
  },

  // Sitting, leaning back a touch, looking up at a screen: a video, a game.
  watch: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 62 }, head: { x: -26 } }, root: { y: -0.36 }, hold: 24 },
      { joints: { hips: { x: -70 }, body: { x: 62 }, head: { x: -26, z: 8 } }, root: { y: -0.36 }, hold: 10 },
      { joints: { hips: { x: -70 }, body: { x: 64 }, head: { x: -22 } }, root: { y: -0.36 }, hold: 14 },
    ],
  },

  // Sitting with its head down over a book (the book itself is Luke's to draw: an art slot beside it).
  read: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 80 }, head: { x: 30 } }, root: { y: -0.36 }, hold: 20 },
      { joints: { hips: { x: -70 }, body: { x: 80 }, head: { x: 30, y: -10 } }, root: { y: -0.36 }, hold: 10 },
      { joints: { hips: { x: -70 }, body: { x: 82 }, head: { x: 34 } }, root: { y: -0.36 }, hold: 12 },
    ],
  },

  // A page turned: its head flicks across and back.
  flick: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { hips: { x: -70 }, body: { x: 80 }, head: { x: 30, y: 24 } }, root: { y: -0.36 }, hold: 2 },
      { joints: { hips: { x: -70 }, body: { x: 78 }, head: { x: 16, y: 24 } }, root: { y: -0.36 }, hold: 2 },
      { joints: { hips: { x: -70 }, body: { x: 80 }, head: { x: 30 } }, root: { y: -0.36 }, hold: 2 },
    ],
  },

  // Typing along with you: leaning in, its head bobbing at every key.
  type: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 12 }, head: { x: 6 } } },
      { joints: { body: { x: 12 }, head: { x: 16 } } },
      { joints: { body: { x: 14 }, head: { x: 6 } } },
      { joints: { body: { x: 12 }, head: { x: 16, y: 10 } } },
    ],
  },

  // Climbing up into a profile's room: its back to you, rocking from one side to the other as it goes.
  climb: {
    facing: 'front',
    loop: true,
    frames: [
      { yaw: 180, joints: { hips: { z: 8 }, body: { z: -4 } } },
      { yaw: 180, root: { y: 0.05 } },
      { yaw: 180, joints: { hips: { z: -8 }, body: { z: 4 } } },
      { yaw: 180, root: { y: 0.05 } },
    ],
  },
};

/** A motion with GUY's arms added, frame by frame: each arm's turn, on top of what the frame already turns. */
function withArms(motion: Motion, arms: (index: number) => { left?: JointTurn; right?: JointTurn }): Motion {
  return {
    ...motion,
    frames: motion.frames.map((frame, index) => {
      const { left, right } = arms(index);
      return {
        ...frame,
        joints: { ...frame.joints, ...(left === undefined ? {} : { 'arm.left': left }), ...(right === undefined ? {} : { 'arm.right': right }) },
      };
    }),
  };
}

/** GUY: the same, with arms. A walk swings them; a wave is a real wave with the right arm. */
const GUY: Partial<Record<MotionId, Motion>> = {
  // Arms up over its head, then down.
  stretch: withArms(BASE.stretch, (index) => {
    const up = [70, 165, 165, 165, 25][index];
    return { left: { z: -up }, right: { z: up } };
  }),
  // Arms out as it spins.
  dance4: withArms(BASE.dance4, (index) => ({ left: { z: index % 2 === 0 ? -80 : -100 }, right: { z: index % 2 === 0 ? 80 : 100 } })),
  // A fist in the air.
  dance5: withArms(BASE.dance5, (index) => ({ right: { z: [120, 150, 165, 150][index] } })),
  run: withArms(BASE.run, (index) => {
    const swing = [40, 0, -40, 0][index];
    return { left: { x: swing }, right: { x: -swing } };
  }),
  // Both arms thrown up on each jump.
  cheer: withArms(BASE.cheer, (index) => {
    const up = [30, 160, 100, 30, 160, 100, 140][index];
    return { left: { z: -up }, right: { z: up } };
  }),
  // Arms hanging straight down from drooped shoulders.
  slump: withArms(BASE.slump, (index) => {
    const hang = [-14, -26, -26, -26, -26, -10][index];
    return { left: { x: hang }, right: { x: hang } };
  }),
  // Held up by its arms.
  dangle: withArms(BASE.dangle, () => ({ left: { z: -155 }, right: { z: 155 } })),
  // Arms out for balance.
  land: withArms(BASE.land, (index) => {
    const out = [70, 40, 0][index];
    return { left: { z: -out }, right: { z: out } };
  }),
  curl: withArms(BASE.curl, () => ({ left: { x: -50 }, right: { x: -50 } })),
  // Propped back on its hands.
  watch: withArms(BASE.watch, () => ({ left: { x: 30 }, right: { x: 30 } })),
  // Arms out in front, as if holding the book.
  read: withArms(BASE.read, () => ({ left: { x: -70 }, right: { x: -70 } })),
  flick: withArms(BASE.flick, (index) => ({ left: { x: -70 }, right: { x: [-95, -110, -70][index] } })),
  type: withArms(BASE.type, (index) => ({ left: { x: index % 2 === 0 ? -70 : -55 }, right: { x: index % 2 === 0 ? -55 : -70 } })),
  // Reaching up, one hand then the other.
  climb: withArms(BASE.climb, (index) => ({ left: { z: [-165, -150, -135, -150][index] }, right: { z: [135, 150, 165, 150][index] } })),
  walk: {
    facing: 'side',
    loop: true,
    frames: BASE.walk.frames.map((frame, index) => {
      const swing = [24, 14, 0, -14, -24, -14, 0, 14][index];
      return {
        ...frame,
        joints: { ...frame.joints, 'arm.left': { x: swing }, 'arm.right': { x: -swing } },
      };
    }),
  },
  wave: {
    facing: 'front',
    loop: false,
    frames: [
      { joints: { 'arm.right': { z: 120 } } },
      { joints: { 'arm.right': { z: 150 }, head: { z: 8 } }, hold: 2 },
      { joints: { 'arm.right': { z: 125 }, head: { z: 8 } }, hold: 2 },
      { joints: { 'arm.right': { z: 155 }, head: { z: 8 } }, hold: 2 },
      { joints: { 'arm.right': { z: 125 }, head: { z: 8 } }, hold: 2 },
      { joints: { 'arm.right': { z: 150 }, head: { z: 8 } }, hold: 2 },
      { joints: { 'arm.right': { z: 60 } } },
    ],
  },
  dance1: {
    facing: 'front',
    loop: true,
    frames: BASE.dance1.frames.map((frame, index) => ({
      ...frame,
      joints: {
        ...frame.joints,
        'arm.left': { z: [-40, -110, -40, -110][index] },
        'arm.right': { z: [110, 40, 110, 40][index] },
      },
    })),
  },
  dance3: {
    facing: 'front',
    loop: true,
    frames: BASE.dance3.frames.map((frame, index) => ({
      ...frame,
      joints: {
        ...frame.joints,
        'arm.left': { z: index % 2 === 0 ? -150 : -120 },
        'arm.right': { z: index % 2 === 0 ? 150 : 120 },
      },
    })),
  },
  sit: {
    facing: 'side',
    loop: true,
    frames: BASE.sit.frames.map((frame) => ({ ...frame, joints: { ...frame.joints, 'arm.left': { x: -20 }, 'arm.right': { x: -20 } } })),
  },
};

/** GOBLIN: walks on its belly, so it rocks harder and its big head bobs. */
const GOBLIN: Partial<Record<MotionId, Motion>> = {
  walk: {
    facing: 'side',
    loop: true,
    frames: BASE.walk.frames.map((frame, index) => ({
      ...frame,
      joints: {
        hips: { z: [10, 6, 0, -6, -10, -6, 0, 6][index] },
        body: { x: 4 },
        head: { x: [0, 6, 10, 6, 0, 6, 10, 6][index], z: [-6, -3, 0, 3, 6, 3, 0, -3][index] },
      },
      root: { y: [0, 0.03, 0.05, 0.03, 0, 0.03, 0.05, 0.03][index] },
    })),
  },
  // Its belly is already on the floor: it settles down and its ears droop with its head.
  sit: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 8 } }, root: { y: -0.06 }, hold: 20 },
      { joints: { body: { x: 8 }, head: { y: 20 } }, root: { y: -0.06 }, hold: 12 },
    ],
  },
  sleep: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 20 }, head: { x: 20 } }, root: { y: -0.08 }, hold: 12 },
      { joints: { body: { x: 22 }, head: { x: 22 } }, root: { y: -0.09 }, hold: 12 },
    ],
  },
  // No legs to fold: its seated motions are its own settle, with the head doing the work.
  curl: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 34 }, head: { x: 34, z: 12 } }, root: { y: -0.1 }, hold: 14 },
      { joints: { body: { x: 36 }, head: { x: 36, z: 12 } }, root: { y: -0.11 }, hold: 14 },
    ],
  },
  watch: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: -6 }, head: { x: -22 } }, root: { y: -0.06 }, hold: 24 },
      { joints: { body: { x: -6 }, head: { x: -22, z: 8 } }, root: { y: -0.06 }, hold: 10 },
      { joints: { body: { x: -4 }, head: { x: -18 } }, root: { y: -0.06 }, hold: 14 },
    ],
  },
  read: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 12 }, head: { x: 26 } }, root: { y: -0.06 }, hold: 20 },
      { joints: { body: { x: 12 }, head: { x: 26, y: -10 } }, root: { y: -0.06 }, hold: 10 },
      { joints: { body: { x: 14 }, head: { x: 30 } }, root: { y: -0.06 }, hold: 12 },
    ],
  },
  flick: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { body: { x: 12 }, head: { x: 26, y: 24 } }, root: { y: -0.06 }, hold: 2 },
      { joints: { body: { x: 10 }, head: { x: 12, y: 24 } }, root: { y: -0.06 }, hold: 2 },
      { joints: { body: { x: 12 }, head: { x: 26 } }, root: { y: -0.06 }, hold: 2 },
    ],
  },
};

/** ROBOT: on tracks, so it glides rather than bobs; its binocular head scans. */
const ROBOT: Partial<Record<MotionId, Motion>> = {
  walk: {
    facing: 'side',
    loop: true,
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
      joints: { body: { x: [3, 4, 3, 2, 3, 4, 3, 2][index] }, head: { y: [-10, -10, -5, 0, 10, 10, 5, 0][index] } },
      root: { y: index % 2 === 0 ? 0 : 0.015 },
    })),
  },
  idle: {
    facing: 'side',
    loop: true,
    frames: [
      { hold: 8 },
      { joints: { head: { y: -30 } }, hold: 8 },
      { hold: 6 },
      { joints: { head: { y: 30 } }, hold: 8 },
      { joints: { head: { x: 15 } }, hold: 6 },
    ],
  },
  sit: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 6 } }, root: { y: -0.08 }, hold: 20 },
      { joints: { body: { x: 6 }, head: { y: 25 } }, root: { y: -0.08 }, hold: 12 },
    ],
  },
  // Powered down: the head drops, the body sinks a touch.
  sleep: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 10 }, head: { x: 35 } }, root: { y: -0.1 }, hold: 16 },
      { joints: { body: { x: 10 }, head: { x: 33 } }, root: { y: -0.1 }, hold: 16 },
    ],
  },
  // Full speed on its tracks: leaning in, shuddering a little.
  run: {
    facing: 'side',
    loop: true,
    frames: [0, 1, 2, 3].map((index) => ({ joints: { body: { x: index % 2 === 0 ? 9 : 11 } }, root: { y: index % 2 === 0 ? 0 : 0.02 } })),
  },
  // Powered right down: the head hangs.
  curl: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 16 }, head: { x: 52 } }, root: { y: -0.1 }, hold: 20 },
      { joints: { body: { x: 16 }, head: { x: 50 } }, root: { y: -0.1 }, hold: 20 },
    ],
  },
  // Binoculars up at the screen.
  watch: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: -4 }, head: { x: -28 } }, root: { y: -0.08 }, hold: 24 },
      { joints: { body: { x: -4 }, head: { x: -28, y: 12 } }, root: { y: -0.08 }, hold: 10 },
      { joints: { body: { x: -4 }, head: { x: -24 } }, root: { y: -0.08 }, hold: 14 },
    ],
  },
  // Scanning the page, line by line.
  read: {
    facing: 'side',
    loop: true,
    frames: [
      { joints: { body: { x: 8 }, head: { x: 30, y: 12 } }, root: { y: -0.08 }, hold: 14 },
      { joints: { body: { x: 8 }, head: { x: 30 } }, root: { y: -0.08 }, hold: 14 },
      { joints: { body: { x: 8 }, head: { x: 30, y: -12 } }, root: { y: -0.08 }, hold: 14 },
    ],
  },
  flick: {
    facing: 'side',
    loop: false,
    frames: [
      { joints: { body: { x: 8 }, head: { x: 30, y: 28 } }, root: { y: -0.08 }, hold: 2 },
      { joints: { body: { x: 6 }, head: { x: 14, y: 28 } }, root: { y: -0.08 }, hold: 2 },
      { joints: { body: { x: 8 }, head: { x: 30 } }, root: { y: -0.08 }, hold: 2 },
    ],
  },
};

const BY_PRESET: Record<RigPresetId, Partial<Record<MotionId, Motion>>> = { base: {}, goblin: GOBLIN, robot: ROBOT, guy: GUY };

/** A preset's motions: its own where it has them, BASE's otherwise. An unknown preset id gets BASE's. */
export function motionsFor(presetId: string): Record<MotionId, Motion> {
  const own = BY_PRESET[presetId as RigPresetId] ?? {};
  return Object.fromEntries(MOTION_IDS.map((id) => [id, own[id] ?? BASE[id]])) as Record<MotionId, Motion>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Posing.
// ---------------------------------------------------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** A rigid move: turn, then shift. */
type Move = { rotation: Quat; offset: Vec3 };

const STILL: Move = { rotation: IDENTITY, offset: { x: 0, y: 0, z: 0 } };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function apply(move: Move, point: Vec3): Vec3 {
  return add(rotateVec(move.rotation, point), move.offset);
}

/** `outer` after `inner`. */
function compose(outer: Move, inner: Move): Move {
  return { rotation: quatMultiply(outer.rotation, inner.rotation), offset: add(rotateVec(outer.rotation, inner.offset), outer.offset) };
}

/** A turn through `pivot`. */
function turnAbout(pivot: Vec3, rotation: Quat): Move {
  return { rotation, offset: sub(pivot, rotateVec(rotation, pivot)) };
}

function turnQuat(turn: JointTurn | undefined): Quat {
  if (turn === undefined) return IDENTITY;
  return quatFromEuler({ x: (turn.x ?? 0) * RAD, y: (turn.y ?? 0) * RAD, z: (turn.z ?? 0) * RAD });
}

/**
 * A figure in one keyframe's pose, facing `yaw` degrees, as a plain figure: every joint where the pose puts it, and every
 * shape unpinned at its posed place in the world. Sag is then worked out on that (`posedPlacements`).
 *
 * The figure as built is the rest pose, including whatever the owner posed on the bench, so a motion moves from there.
 * The facing turns round the root's upright line, so the figure turns on the spot.
 */
export function posedFigure(figure: Figure, frame: Keyframe, yaw: number): Figure {
  const skeleton = figure.skeleton;
  const rest = jointFrames(skeleton);
  const rootId = skeleton.rootId;
  const rootAt = rest[rootId]?.position ?? { x: 0, y: 0, z: 0 };
  const lift = { x: frame.root?.x ?? 0, y: frame.root?.y ?? 0, z: frame.root?.z ?? 0 };

  // Facing first (outermost), then the lift, then each joint's turn from the root out.
  const facing = turnAbout({ x: rootAt.x, y: 0, z: rootAt.z }, quatFromEuler({ x: 0, y: yaw * RAD, z: 0 }));
  const lifted = compose(facing, { rotation: IDENTITY, offset: lift });

  const moves: Record<string, Move> = {};
  const joints: Skeleton['joints'] = {};
  const visit = (id: string, parentMove: Move, parentAt: Vec3 | null, seen: Set<string>) => {
    const joint = skeleton.joints[id];
    const at = rest[id]?.position;
    if (joint === undefined || at === undefined || seen.has(id)) return;
    seen.add(id);
    const posedAt = apply(parentMove, at);
    const move = compose(parentMove, turnAbout(at, turnQuat(frame.joints?.[id])));
    moves[id] = move;
    const position = parentAt === null ? posedAt : sub(posedAt, parentAt);
    joints[id] = { id, parentId: joint.parentId, position, rest: position };
    for (const child of Object.values(skeleton.joints)) {
      if (child.parentId === id) visit(child.id, move, posedAt, seen);
    }
  };
  visit(rootId, lifted, null, new Set());

  const shapes: Shape[] = figure.shapes.map((shape) => {
    const built = placementOf(figure, shape, rest);
    const move = (shape.pin !== null ? moves[shape.pin] : undefined) ?? moves[rootId] ?? STILL;
    return {
      ...shape,
      pin: null,
      position: apply(move, built.position),
      rotation: eulerFromQuat(quatMultiply(move.rotation, built.rotation)),
    };
  });

  return { skeleton: { joints, rootId }, shapes };
}

type Drawn = { shape: Shape; placement: Placement }[];

function sagged(figure: Figure, frame: Keyframe, yaw: number): Drawn {
  const posed = posedFigure(figure, frame, yaw);
  const placements = sagOf(posed).placements;
  return posed.shapes.flatMap((shape) =>
    shape.hidden || placements[shape.id] === undefined ? [] : [{ shape, placement: placements[shape.id] }],
  );
}

/** The lowest point drawn: a box round each turned shape. */
export function lowestPoint(drawn: Drawn): number {
  let low = Infinity;
  for (const { shape, placement } of drawn) {
    const q = placement.rotation;
    const reach = (axis: Vec3) => Math.abs(rotateVec(q, axis).y);
    low = Math.min(
      low,
      placement.position.y - reach({ x: shape.size.x / 2, y: 0, z: 0 }) - reach({ x: 0, y: shape.size.y / 2, z: 0 }) - reach({ x: 0, y: 0, z: shape.size.z / 2 }),
    );
  }
  return low;
}

/** Where the figure as built stands, per figure object. */
const FLOORS = new WeakMap<Figure, number>();
function floorOf(figure: Figure): number {
  const known = FLOORS.get(figure);
  if (known !== undefined) return known;
  const floor = lowestPoint(sagged(figure, {}, 0));
  FLOORS.set(figure, floor);
  return floor;
}

/**
 * Where each shown shape is drawn in this frame: posed, then sagged. Hidden shapes are left out, as on the bench.
 *
 * **Nothing goes through the floor.** A frame that would put any part lower than the figure stands as built is lifted
 * until it doesn't, so a rock on the hips lifts one side rather than sinking the other, and a figure sits *on* the floor.
 */
export function posedPlacements(figure: Figure, frame: Keyframe, yaw: number): Drawn {
  const drawn = sagged(figure, frame, yaw);
  const floor = floorOf(figure);
  const low = lowestPoint(drawn);
  if (!(low < floor - 1e-9) || !Number.isFinite(floor)) return drawn;
  const lift = floor - low;
  return drawn.map(({ shape, placement }) => ({
    shape,
    placement: { position: { ...placement.position, y: placement.position.y + lift }, rotation: placement.rotation },
  }));
}

/** The yaw a keyframe of `motion` faces. */
export function frameYaw(motion: Motion, frame: Keyframe): number {
  return frame.yaw ?? facingYaw(motion.facing);
}

/**
 * The ticks a motion plays, as indexes into its keyframes: each keyframe repeated `hold` times. What the sheet stores, so
 * a hold costs nothing in the picture.
 */
export function motionTicks(motion: Motion): number[] {
  return motion.frames.flatMap((frame, index) => Array.from({ length: Math.max(1, Math.round(frame.hold ?? 1)) }, () => index));
}
