/**
 * The starting figures: a humanoid skeleton, and the presets that dress it.
 *
 * **A preset is a whole figure, and a fresh start.** Each one is the skeleton stretched to its own proportions, a set
 * of shapes pinned to its joints, colours from the dyes, and a starting pose. Picking one replaces the bench (UNDO
 * brings the old figure back). Every shape it makes is an ordinary free shape - resize it, unpin it, delete it.
 *
 * **Goofy on purpose.** The owner asked for presets that are fun to start from rather than three sensible body types,
 * so each one exaggerates one idea (all limb, all head, all box...) and has a one-line joke to sell it.
 *
 * The root is the hips, so posing reads as leaning rather than sliding, and the dimensions are in the same units as
 * joint positions. Every preset has to fit the views' fixed frame (`check-character-camera` measures them all).
 */
import { screenBox } from './drag';
import type { Figure, Shape } from './figure';
import { MASS_DYES, MODEL_LIMB } from './palette';
import type { MassShapeId } from './shapes';
import { addJoint, bendJoint, cloneVec3, vec3, worldPosition, addVec3, type Skeleton, type Vec3 } from './skeleton';
import { quatFromAxisAngle, rotateVec } from './turns';

type RigJoint = { id: string; parentId: string | null; position: Vec3 };

/**
 * The skeleton, joint by joint, parents before children. A joint's *first* child is the one its bone points at
 * (`jointFrames`), so the order here matters: the spine is the hips' first child, the forearm the upper arm's.
 *
 * "left" and "right" are the screen's in the FRONT view - `.left` joints are on the left of that pane.
 */
const RIG: readonly RigJoint[] = [
  { id: 'hips', parentId: null, position: vec3(0, 0, 0) },

  { id: 'spine', parentId: 'hips', position: vec3(0, 0.1, 0) },
  { id: 'chest', parentId: 'spine', position: vec3(0, 0.16, 0) },
  { id: 'neck', parentId: 'chest', position: vec3(0, 0.2, 0) },
  { id: 'head', parentId: 'neck', position: vec3(0, 0.1, 0) },

  { id: 'shoulder.left', parentId: 'chest', position: vec3(-0.3, 0.1, 0) },
  { id: 'upper-arm.left', parentId: 'shoulder.left', position: vec3(0, 0, 0) },
  { id: 'forearm.left', parentId: 'upper-arm.left', position: vec3(0, -0.52, 0) },
  { id: 'hand.left', parentId: 'forearm.left', position: vec3(0, -0.48, 0) },

  { id: 'shoulder.right', parentId: 'chest', position: vec3(0.3, 0.1, 0) },
  { id: 'upper-arm.right', parentId: 'shoulder.right', position: vec3(0, 0, 0) },
  { id: 'forearm.right', parentId: 'upper-arm.right', position: vec3(0, -0.52, 0) },
  { id: 'hand.right', parentId: 'forearm.right', position: vec3(0, -0.48, 0) },

  { id: 'thigh.left', parentId: 'hips', position: vec3(-0.13, -0.1, 0) },
  { id: 'shin.left', parentId: 'thigh.left', position: vec3(0, -0.58, 0) },
  { id: 'foot.left', parentId: 'shin.left', position: vec3(0, -0.54, 0) },

  { id: 'thigh.right', parentId: 'hips', position: vec3(0.13, -0.1, 0) },
  { id: 'shin.right', parentId: 'thigh.right', position: vec3(0, -0.58, 0) },
  { id: 'foot.right', parentId: 'shin.right', position: vec3(0, -0.54, 0) },
];

export const ROOT_JOINT_ID = 'hips';

export const DEFAULT_JOINT_IDS: readonly string[] = RIG.map((joint) => joint.id);

/** What a joint is called where a reader can see it: "FOREARM L", not "forearm.left". */
export function jointLabel(id: string): string {
  const [part, side] = id.split('.');
  const name = part.replace(/-/g, ' ').toUpperCase();
  if (side === 'left') return `${name} L`;
  if (side === 'right') return `${name} R`;
  return name;
}

/**
 * How a preset stretches the skeleton. Each number multiplies a group of bones; 1 is BLOB's length.
 *
 *   torso      hips to neck        arms   both arm bones     legs   both leg bones
 *   neck       neck to head        shoulders / hips  how far apart the arms and legs hang
 */
type Proportions = { torso: number; neck: number; arms: number; legs: number; shoulders: number; hips: number };

const NORMAL: Proportions = { torso: 1, neck: 1, arms: 1, legs: 1, shoulders: 1, hips: 1 };

/** Which proportion stretches a joint's offset from its parent, and along which axes. */
function stretchFor(id: string, p: Proportions): Vec3 {
  if (id === 'spine' || id === 'chest' || id === 'neck') return vec3(1, p.torso, 1);
  if (id === 'head') return vec3(1, p.neck, 1);
  if (/^shoulder\./.test(id)) return vec3(p.shoulders, p.torso, 1);
  if (/^(forearm|hand)\./.test(id)) return vec3(1, p.arms, 1);
  if (/^thigh\./.test(id)) return vec3(p.hips, 1, 1);
  if (/^(shin|foot)\./.test(id)) return vec3(1, p.legs, 1);
  return vec3(1, 1, 1);
}

/** A starting shape: what, where (centre from its joint, before posing), how big (full extents), what colour. */
type Part = {
  joint: string;
  name: string;
  kind: MassShapeId;
  size: Vec3;
  offset: Vec3;
  /** A dye id from `MASS_DYES` ('figure' is the default purple). */
  dye: string;
  /** Degrees, XYZ, in the joint's frame. */
  turn?: Vec3;
};

/** A turn of one joint's bone, in degrees about a world axis, applied after the skeleton is built. */
type Bend = { joint: string; axis: 'x' | 'y' | 'z'; degrees: number };

export type RigPresetId = 'blob' | 'noodle' | 'bobblehead' | 'brick' | 'gremlin' | 'snowman' | 'pear';

export const RIG_PRESET_IDS: readonly RigPresetId[] = ['blob', 'noodle', 'bobblehead', 'brick', 'gremlin', 'snowman', 'pear'];

export type RigPreset = {
  label: string;
  /** One line, a joke, so the choice is made on the figure rather than on the name. */
  note: string;
  proportions: Proportions;
  parts: readonly Part[];
  pose: readonly Bend[];
};

const v = vec3;

/** The same part on both sides: `side` is filled into the joint and the name, and x offsets mirror. */
function pair(make: (side: 'left' | 'right', s: 'L' | 'R', mirror: 1 | -1) => Part[]): Part[] {
  return [...make('left', 'L', -1), ...make('right', 'R', 1)];
}

const BLOB_PARTS: Part[] = [
  { joint: 'head', name: 'HEAD', kind: 'box', size: v(0.6, 0.6, 0.6), offset: v(0, 0.16, 0), dye: 'figure' },
  { joint: 'chest', name: 'CHEST', kind: 'sphere', size: v(0.68, 0.76, 0.52), offset: v(0, -0.18, 0), dye: 'figure' },
  { joint: 'hips', name: 'HIPS', kind: 'sphere', size: v(0.64, 0.5, 0.48), offset: v(0, -0.06, 0), dye: 'figure' },
  ...pair((side, s) => [
    { joint: `upper-arm.${side}`, name: `UPPER ARM ${s}`, kind: 'cylinder', size: v(0.22, 0.6, 0.22), offset: v(0, -0.26, 0), dye: 'limb' },
    { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'capsule', size: v(0.18, 0.7, 0.18), offset: v(0, -0.22, 0), dye: 'limb' },
    { joint: `hand.${side}`, name: `HAND ${s}`, kind: 'box', size: v(0.2, 0.2, 0.2), offset: v(0, -0.06, 0), dye: 'limb' },
    { joint: `thigh.${side}`, name: `THIGH ${s}`, kind: 'capsule', size: v(0.28, 0.96, 0.28), offset: v(0, -0.3, 0), dye: 'limb' },
    { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'capsule', size: v(0.22, 0.82, 0.22), offset: v(0, -0.26, 0), dye: 'limb' },
    // A triangle seen from the front, running forward: the prism's long axis is depth.
    { joint: `foot.${side}`, name: `FOOT ${s}`, kind: 'prism', size: v(0.26, 0.2, 0.44), offset: v(0, -0.04, 0.07), dye: 'limb' },
  ]),
];

export const RIG_PRESETS: Record<RigPresetId, RigPreset> = {
  blob: {
    label: 'BLOB',
    note: 'SHORT, ROUND, NEVER IN A HURRY.',
    proportions: NORMAL,
    parts: BLOB_PARTS,
    pose: [],
  },

  noodle: {
    label: 'NOODLE',
    note: 'ALL LIMB. NO LUNCH.',
    proportions: { torso: 0.9, neck: 1.6, arms: 1.55, legs: 1.2, shoulders: 0.55, hips: 0.6 },
    parts: [
      { joint: 'head', name: 'PEA HEAD', kind: 'sphere', size: v(0.22, 0.24, 0.22), offset: v(0, 0.1, 0), dye: 'sun' },
      { joint: 'neck', name: 'NECK', kind: 'cylinder', size: v(0.06, 0.18, 0.06), offset: v(0, 0.06, 0), dye: 'emerald' },
      { joint: 'chest', name: 'BODY', kind: 'capsule', size: v(0.2, 0.6, 0.16), offset: v(0, -0.12, 0), dye: 'bubble' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `ARM ${s}`, kind: 'cylinder', size: v(0.06, 0.8, 0.06), offset: v(0, -0.4, 0), dye: 'emerald' },
        { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'cylinder', size: v(0.05, 0.74, 0.05), offset: v(0, -0.37, 0), dye: 'emerald' },
        { joint: `hand.${side}`, name: `MITT ${s}`, kind: 'sphere', size: v(0.12, 0.12, 0.12), offset: v(0, -0.04, 0), dye: 'sun' },
        { joint: `thigh.${side}`, name: `LEG ${s}`, kind: 'cylinder', size: v(0.07, 0.7, 0.07), offset: v(0, -0.35, 0), dye: 'emerald' },
        { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'cylinder', size: v(0.06, 0.65, 0.06), offset: v(0, -0.32, 0), dye: 'emerald' },
        { joint: `foot.${side}`, name: `SHOE ${s}`, kind: 'sphere', size: v(0.12, 0.08, 0.32), offset: v(0, -0.02, 0.09), dye: 'bubble' },
      ]),
    ],
    // Elbows bowed out, hands back in: a figure made of string.
    pose: [
      { joint: 'forearm.left', axis: 'z', degrees: -28 },
      { joint: 'hand.left', axis: 'z', degrees: 50 },
      { joint: 'forearm.right', axis: 'z', degrees: 28 },
      { joint: 'hand.right', axis: 'z', degrees: -50 },
    ],
  },

  bobblehead: {
    label: 'BOBBLEHEAD',
    note: 'ALL THE THOUGHTS. NONE OF THE NECK.',
    proportions: { torso: 0.7, neck: 1, arms: 0.55, legs: 0.55, shoulders: 0.7, hips: 0.8 },
    parts: [
      { joint: 'head', name: 'BIG HEAD', kind: 'sphere', size: v(1.15, 1.05, 1.0), offset: v(0, 0.48, 0), dye: 'figure' },
      { joint: 'chest', name: 'BODY', kind: 'capsule', size: v(0.36, 0.5, 0.3), offset: v(0, -0.1, 0), dye: 'royal' },
      { joint: 'hips', name: 'PANTS', kind: 'box', size: v(0.36, 0.2, 0.28), offset: v(0, -0.04, 0), dye: 'limb' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `ARM ${s}`, kind: 'capsule', size: v(0.12, 0.32, 0.12), offset: v(0, -0.14, 0), dye: 'royal' },
        { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'capsule', size: v(0.1, 0.28, 0.1), offset: v(0, -0.12, 0), dye: 'figure' },
        { joint: `hand.${side}`, name: `HAND ${s}`, kind: 'sphere', size: v(0.12, 0.12, 0.12), offset: v(0, -0.04, 0), dye: 'figure' },
        { joint: `thigh.${side}`, name: `LEG ${s}`, kind: 'capsule', size: v(0.14, 0.36, 0.14), offset: v(0, -0.16, 0), dye: 'limb' },
        { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'capsule', size: v(0.12, 0.32, 0.12), offset: v(0, -0.14, 0), dye: 'limb' },
        { joint: `foot.${side}`, name: `FOOT ${s}`, kind: 'box', size: v(0.16, 0.08, 0.24), offset: v(0, -0.02, 0.05), dye: 'rose' },
      ]),
    ],
    // A little wave, because a head that size deserves an audience.
    pose: [{ joint: 'forearm.right', axis: 'z', degrees: 130 }, { joint: 'hand.right', axis: 'z', degrees: -60 }],
  },

  brick: {
    label: 'BRICK',
    note: 'BUILT LIKE A FRIDGE. THINKS LIKE ONE TOO.',
    proportions: { torso: 1.1, neck: 1, arms: 0.85, legs: 0.7, shoulders: 1.45, hips: 1.2 },
    parts: [
      { joint: 'head', name: 'HEAD', kind: 'box', size: v(0.34, 0.3, 0.32), offset: v(0, 0.12, 0), dye: 'paper' },
      { joint: 'head', name: 'ANTENNA', kind: 'cylinder', size: v(0.03, 0.3, 0.03), offset: v(0, 0.42, 0), dye: 'limb' },
      { joint: 'head', name: 'ANTENNA BALL', kind: 'sphere', size: v(0.1, 0.1, 0.1), offset: v(0, 0.6, 0), dye: 'sun' },
      { joint: 'chest', name: 'TORSO', kind: 'box', size: v(1.0, 0.72, 0.56), offset: v(0, -0.12, 0), dye: 'royal' },
      { joint: 'hips', name: 'HIPS', kind: 'box', size: v(0.66, 0.3, 0.46), offset: v(0, -0.06, 0), dye: 'limb' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `ARM ${s}`, kind: 'box', size: v(0.24, 0.5, 0.24), offset: v(0, -0.22, 0), dye: 'royal' },
        { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'box', size: v(0.22, 0.44, 0.22), offset: v(0, -0.2, 0), dye: 'paper' },
        { joint: `hand.${side}`, name: `CLAMP ${s}`, kind: 'box', size: v(0.24, 0.16, 0.24), offset: v(0, -0.06, 0), dye: 'sun' },
        { joint: `thigh.${side}`, name: `LEG ${s}`, kind: 'box', size: v(0.26, 0.44, 0.26), offset: v(0, -0.2, 0), dye: 'limb' },
        { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'box', size: v(0.24, 0.4, 0.24), offset: v(0, -0.18, 0), dye: 'limb' },
        { joint: `foot.${side}`, name: `BOOT ${s}`, kind: 'box', size: v(0.3, 0.14, 0.4), offset: v(0, -0.04, 0.06), dye: 'royal' },
      ]),
    ],
    pose: [],
  },

  gremlin: {
    label: 'GREMLIN',
    note: 'SMALL, GREEN, PROBABLY CHEWING A CABLE.',
    proportions: { torso: 0.85, neck: 1, arms: 1.35, legs: 0.75, shoulders: 0.8, hips: 1.1 },
    parts: [
      { joint: 'head', name: 'HEAD', kind: 'sphere', size: v(0.5, 0.42, 0.46), offset: v(0, 0.14, 0.02), dye: 'emerald' },
      { joint: 'head', name: 'NOSE', kind: 'cone', size: v(0.1, 0.24, 0.1), offset: v(0, 0.12, 0.3), dye: 'rose', turn: v(-90, 0, 0) },
      ...pair((side, s, mirror) => [
        // A cone points down; turned 180 it points up, and a further 60 leans its tip out to its own side.
        { joint: 'head', name: `EAR ${s}`, kind: 'cone', size: v(0.14, 0.5, 0.08), offset: v(mirror * 0.38, 0.3, 0), dye: 'emerald', turn: v(0, 0, 180 - mirror * 60) },
      ]),
      { joint: 'chest', name: 'BELLY', kind: 'sphere', size: v(0.5, 0.56, 0.44), offset: v(0, -0.14, 0.02), dye: 'emerald' },
      { joint: 'hips', name: 'HIPS', kind: 'sphere', size: v(0.44, 0.32, 0.36), offset: v(0, -0.04, 0), dye: 'limb' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `ARM ${s}`, kind: 'capsule', size: v(0.12, 0.72, 0.12), offset: v(0, -0.34, 0), dye: 'emerald' },
        { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'capsule', size: v(0.1, 0.66, 0.1), offset: v(0, -0.32, 0), dye: 'emerald' },
        { joint: `hand.${side}`, name: `CLAW ${s}`, kind: 'cone', size: v(0.16, 0.2, 0.12), offset: v(0, -0.08, 0), dye: 'rose' },
        { joint: `thigh.${side}`, name: `THIGH ${s}`, kind: 'capsule', size: v(0.16, 0.46, 0.16), offset: v(0, -0.2, 0), dye: 'emerald' },
        { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'capsule', size: v(0.13, 0.42, 0.13), offset: v(0, -0.2, 0), dye: 'emerald' },
        { joint: `foot.${side}`, name: `FOOT ${s}`, kind: 'prism', size: v(0.22, 0.12, 0.36), offset: v(0, -0.02, 0.08), dye: 'rose' },
      ]),
    ],
    // Hunched forward and crouched: knees out front, feet back under, knuckles near the floor.
    pose: [
      { joint: 'chest', axis: 'x', degrees: 28 },
      { joint: 'shin.left', axis: 'x', degrees: -45 },
      { joint: 'foot.left', axis: 'x', degrees: 75 },
      { joint: 'shin.right', axis: 'x', degrees: -45 },
      { joint: 'foot.right', axis: 'x', degrees: 75 },
      { joint: 'forearm.left', axis: 'z', degrees: -12 },
      { joint: 'forearm.right', axis: 'z', degrees: 12 },
    ],
  },

  snowman: {
    label: 'SNOWMAN',
    note: 'COOL UNDER PRESSURE. MELTS UNDER LAMPS.',
    proportions: { torso: 1, neck: 1, arms: 0.8, legs: 0.55, shoulders: 0.95, hips: 0.6 },
    parts: [
      { joint: 'hips', name: 'BOTTOM BALL', kind: 'sphere', size: v(0.92, 0.88, 0.9), offset: v(0, -0.3, 0), dye: 'paper' },
      { joint: 'chest', name: 'MIDDLE BALL', kind: 'sphere', size: v(0.66, 0.62, 0.64), offset: v(0, -0.02, 0), dye: 'paper' },
      { joint: 'head', name: 'HEAD BALL', kind: 'sphere', size: v(0.46, 0.44, 0.46), offset: v(0, 0.16, 0), dye: 'paper' },
      { joint: 'head', name: 'CARROT', kind: 'cone', size: v(0.08, 0.3, 0.08), offset: v(0, 0.16, 0.36), dye: 'rose', turn: v(-90, 0, 0) },
      { joint: 'head', name: 'HAT', kind: 'cylinder', size: v(0.3, 0.3, 0.3), offset: v(0, 0.52, 0), dye: 'royal' },
      { joint: 'head', name: 'HAT BRIM', kind: 'cylinder', size: v(0.46, 0.04, 0.46), offset: v(0, 0.37, 0), dye: 'royal' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `STICK ARM ${s}`, kind: 'cylinder', size: v(0.04, 0.5, 0.04), offset: v(0, -0.25, 0), dye: 'limb' },
        { joint: `forearm.${side}`, name: `TWIG ${s}`, kind: 'cylinder', size: v(0.03, 0.36, 0.03), offset: v(0, -0.16, 0), dye: 'limb' },
      ]),
    ],
    // Sticks up in the air, mid-celebration. No legs: the bottom ball is the legs.
    pose: [
      { joint: 'forearm.left', axis: 'z', degrees: -125 },
      { joint: 'forearm.right', axis: 'z', degrees: 125 },
    ],
  },

  pear: {
    label: 'PEAR',
    note: 'STARTS SMALL. ENDS EVENTUALLY.',
    proportions: { torso: 0.85, neck: 0.9, arms: 0.75, legs: 0.6, shoulders: 0.55, hips: 1.4 },
    parts: [
      { joint: 'head', name: 'HEAD', kind: 'sphere', size: v(0.3, 0.32, 0.3), offset: v(0, 0.12, 0), dye: 'acid' },
      { joint: 'chest', name: 'TOP', kind: 'sphere', size: v(0.42, 0.46, 0.36), offset: v(0, -0.08, 0), dye: 'acid' },
      { joint: 'hips', name: 'BOTTOM', kind: 'sphere', size: v(1.2, 0.92, 0.9), offset: v(0, -0.12, 0), dye: 'sun' },
      ...pair((side, s) => [
        { joint: `upper-arm.${side}`, name: `ARM ${s}`, kind: 'capsule', size: v(0.1, 0.4, 0.1), offset: v(0, -0.18, 0), dye: 'acid' },
        { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'capsule', size: v(0.09, 0.36, 0.09), offset: v(0, -0.16, 0), dye: 'acid' },
        { joint: `hand.${side}`, name: `HAND ${s}`, kind: 'sphere', size: v(0.1, 0.1, 0.1), offset: v(0, -0.04, 0), dye: 'emerald' },
        { joint: `thigh.${side}`, name: `LEG ${s}`, kind: 'capsule', size: v(0.18, 0.4, 0.18), offset: v(0, -0.18, 0), dye: 'sun' },
        { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'capsule', size: v(0.12, 0.34, 0.12), offset: v(0, -0.15, 0), dye: 'emerald' },
        { joint: `foot.${side}`, name: `FOOT ${s}`, kind: 'prism', size: v(0.18, 0.12, 0.3), offset: v(0, -0.02, 0.06), dye: 'emerald' },
      ]),
    ],
    // Arms out a little, because they cannot reach round the bottom.
    pose: [
      { joint: 'forearm.left', axis: 'z', degrees: -35 },
      { joint: 'forearm.right', axis: 'z', degrees: 35 },
    ],
  },
};

export function isRigPresetId(value: unknown): value is RigPresetId {
  return typeof value === 'string' && (RIG_PRESET_IDS as readonly string[]).includes(value);
}

/** The bare skeleton for a preset, every joint at rest (no pose). */
export function buildSkeleton(presetId: RigPresetId = 'blob'): Skeleton {
  const proportions = RIG_PRESETS[presetId].proportions;
  const root = RIG[0];
  let skeleton: Skeleton = {
    joints: { [root.id]: { id: root.id, parentId: null, position: cloneVec3(root.position), rest: cloneVec3(root.position) } },
    rootId: root.id,
  };

  for (const joint of RIG) {
    if (joint.parentId === null) continue;
    const k = stretchFor(joint.id, proportions);
    const position = vec3(joint.position.x * k.x, joint.position.y * k.y, joint.position.z * k.z);
    skeleton = addJoint(skeleton, { id: joint.id, parentId: joint.parentId, position });
  }

  return skeleton;
}

const AXES: Record<Bend['axis'], Vec3> = { x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) };

/**
 * Turn one joint's bone about its parent, carrying everything below it - the same bend POSE makes, so a preset's
 * starting pose is an ordinary pose the reader can keep bending (or straighten with STRETCH off and a drag).
 */
function applyBend(skeleton: Skeleton, bend: Bend): Skeleton {
  const joint = skeleton.joints[bend.joint];
  if (joint === undefined || joint.parentId === null) return skeleton;
  const turned = rotateVec(quatFromAxisAngle(AXES[bend.axis], (bend.degrees * Math.PI) / 180), joint.position);
  return bendJoint(skeleton, bend.joint, addVec3(worldPosition(skeleton, joint.parentId), turned));
}

function dyeValue(id: string): string | null {
  const dye = MASS_DYES.find((entry) => entry.id === id);
  return dye === undefined ? MODEL_LIMB : dye.value;
}

const toRadians = (degrees: Vec3): Vec3 => v((degrees.x * Math.PI) / 180, (degrees.y * Math.PI) / 180, (degrees.z * Math.PI) / 180);

/** A whole starting figure: the preset's skeleton, its parts pinned to their joints, then its pose. */
export function buildDefaultFigure(presetId: RigPresetId = 'blob'): Figure {
  const preset = RIG_PRESETS[presetId];

  const shapes: Shape[] = preset.parts.map((part, index) => ({
    id: `s${index + 1}`,
    name: part.name,
    kind: part.kind,
    colour: dyeValue(part.dye),
    hidden: false,
    pin: part.joint,
    position: cloneVec3(part.offset),
    rotation: toRadians(part.turn ?? v(0, 0, 0)),
    size: cloneVec3(part.size),
  }));

  // Shapes are placed in their joints' frames, so posing after pinning carries them - nothing to convert.
  const posed: Figure = { skeleton: preset.pose.reduce(applyBend, buildSkeleton(presetId)), shapes };

  return standOnFloor(posed);
}

/**
 * Where every preset's lowest point sits: BLOB's soles. A snowman has no legs and a bobblehead hardly any, so without
 * this they would hang in mid-air at hip height; with it, every preset stands on one floor and the views frame them
 * all the same way.
 */
export const FLOOR_Y = -1.36;

function standOnFloor(figure: Figure): Figure {
  const lowest = Math.min(
    ...figure.shapes.map((shape) => {
      const box = screenBox(figure, shape.id, 'front');
      return box === null ? Infinity : box.centre.y - box.halfUp;
    }),
  );
  if (!Number.isFinite(lowest)) return figure;

  const root = figure.skeleton.joints[figure.skeleton.rootId];
  const lifted = vec3(root.position.x, root.position.y + FLOOR_Y - lowest, root.position.z);

  return {
    ...figure,
    skeleton: {
      ...figure.skeleton,
      // The root's rest moves with it: being lifted onto the floor is where this figure starts, not a pose.
      joints: { ...figure.skeleton.joints, [root.id]: { ...root, position: lifted, rest: cloneVec3(lifted) } },
    },
  };
}
