/**
 * The starting figures: four simple characters, each five shapes on its own small skeleton.
 *
 * **Simple on purpose.** A figure is a few nodes and at most seven shapes (`MAX_SHAPES`, `MAX_NODES`), and every
 * shape is placed in relation to a node. Each preset is exactly five shapes and ships *valid* - every node has a shape
 * round it, every shape reaches a node - and with no sag at rest (nothing hangs further than one shape from a node).
 * `Temp/check-character-simple.cjs` holds all of that.
 *
 * **A preset is a whole figure, and a fresh start.** Picking one replaces the bench (UNDO brings the old figure back).
 * Every shape it makes is an ordinary shape pinned to its node - resize it, re-pin it, delete it.
 *
 * The root is always the hips, so posing reads as leaning rather than sliding. Every preset has to fit the views'
 * fixed frame (`check-character-camera` measures them all).
 */
import { screenBox } from './drag';
import type { Figure, Shape } from './figure';
import { MASS_DYES, MODEL_LIMB } from './palette';
import type { MassShapeId } from './shapes';
import { addJoint, cloneVec3, vec3, type Skeleton, type Vec3 } from './skeleton';

/** A node: where it sits, measured from its parent. Parents come before children, and a node's *first* child is the
 * one its bone points at (`jointFrames`) - so a body lists its head before its arms. */
type PresetNode = { id: string; parentId: string | null; position: Vec3 };

/** A starting shape: what, where (centre from its node), how big (full extents), what colour. */
type Part = {
  node: string;
  name: string;
  kind: MassShapeId;
  size: Vec3;
  offset: Vec3;
  /** A dye id from `MASS_DYES` ('figure' is the default purple). */
  dye: string;
  /** Degrees, XYZ, in the node's frame. */
  turn?: Vec3;
};

export const ROOT_JOINT_ID = 'hips';

/** The base skeleton: three nodes. */
const BASE_NODES: readonly PresetNode[] = [
  { id: 'hips', parentId: null, position: vec3(0, 0, 0) },
  { id: 'body', parentId: 'hips', position: vec3(0, 0.38, 0) },
  { id: 'head', parentId: 'body', position: vec3(0, 0.48, 0) },
];

export const DEFAULT_JOINT_IDS: readonly string[] = BASE_NODES.map((node) => node.id);

/** What a node is called where a reader can see it: "HAND L", not "hand.left"; "NODE 4", not "node-4". */
export function jointLabel(id: string): string {
  const [part, side] = id.split('.');
  const name = part.replace(/-/g, ' ').toUpperCase();
  if (side === 'left') return `${name} L`;
  if (side === 'right') return `${name} R`;
  return name;
}

/** A node in a sentence: "NODE HAND L", and "NODE 4" for one added on the bench (whose label already says NODE). */
export function nodeName(id: string): string {
  const label = jointLabel(id);
  return label.startsWith('NODE ') ? label : `NODE ${label}`;
}

export type RigPresetId = 'base' | 'goblin' | 'robot' | 'guy';

export const RIG_PRESET_IDS: readonly RigPresetId[] = ['base', 'goblin', 'robot', 'guy'];

export type RigPreset = {
  label: string;
  /** One line, so the choice is made on the figure rather than on the name. */
  note: string;
  nodes: readonly PresetNode[];
  parts: readonly Part[];
};

const v = vec3;

/** The same part on both sides: `side` is filled into the node and the name, and `mirror` flips x. */
function pair(make: (side: 'left' | 'right', s: 'L' | 'R', mirror: 1 | -1) => Part[]): Part[] {
  return [...make('left', 'L', -1), ...make('right', 'R', 1)];
}

export const RIG_PRESETS: Record<RigPresetId, RigPreset> = {
  base: {
    label: 'BASE',
    note: 'HEAD, BODY, HIPS, TWO LEGS. START HERE.',
    nodes: BASE_NODES,
    parts: [
      { node: 'head', name: 'HEAD', kind: 'sphere', size: v(0.5, 0.5, 0.46), offset: v(0, 0.06, 0), dye: 'figure' },
      { node: 'body', name: 'BODY', kind: 'box', size: v(0.56, 0.6, 0.38), offset: v(0, 0, 0), dye: 'figure' },
      { node: 'hips', name: 'HIPS', kind: 'box', size: v(0.5, 0.26, 0.36), offset: v(0, -0.02, 0), dye: 'limb' },
      ...pair((_, s, mirror) => [
        { node: 'hips', name: `LEG ${s}`, kind: 'capsule', size: v(0.2, 0.8, 0.22), offset: v(mirror * 0.14, -0.48, 0), dye: 'limb' },
      ]),
    ],
  },

  goblin: {
    label: 'GOBLIN',
    note: 'ALL EARS. WALKS ON ITS BELLY.',
    nodes: [
      { id: 'hips', parentId: null, position: v(0, 0, 0) },
      { id: 'body', parentId: 'hips', position: v(0, 0.3, 0) },
      { id: 'head', parentId: 'body', position: v(0, 0.42, 0) },
    ],
    parts: [
      { node: 'head', name: 'HEAD', kind: 'sphere', size: v(0.64, 0.54, 0.58), offset: v(0, 0.04, 0.04), dye: 'emerald' },
      ...pair((_, s, mirror) => [
        // A cone points down; a quarter turn about the view's axis points it straight out to its own side.
        { node: 'head', name: `EAR ${s}`, kind: 'cone', size: v(0.2, 0.5, 0.12), offset: v(mirror * 0.48, 0.1, 0), dye: 'emerald', turn: v(0, 0, mirror * 90) },
      ]),
      { node: 'head', name: 'NOSE', kind: 'cone', size: v(0.14, 0.3, 0.14), offset: v(0, 0, 0.38), dye: 'rose', turn: v(-90, 0, 0) },
      { node: 'hips', name: 'BELLY', kind: 'sphere', size: v(0.8, 0.76, 0.7), offset: v(0, 0.14, 0.02), dye: 'limb' },
    ],
  },

  robot: {
    label: 'ROBOT',
    note: 'A BOX ON TRACKS, WITH BINOCULARS FOR A HEAD.',
    nodes: [
      { id: 'hips', parentId: null, position: v(0, 0, 0) },
      { id: 'body', parentId: 'hips', position: v(0, 0.36, 0) },
      { id: 'head', parentId: 'body', position: v(0, 0.46, 0) },
    ],
    parts: [
      ...pair((_, s, mirror) => [
        // A cylinder stands upright; a quarter turn about x lays it along the depth, so it looks out of the front.
        { node: 'head', name: `EYE ${s}`, kind: 'cylinder', size: v(0.28, 0.32, 0.28), offset: v(mirror * 0.14, 0, 0.04), dye: 'paper', turn: v(90, 0, 0) },
      ]),
      { node: 'body', name: 'BODY', kind: 'box', size: v(0.84, 0.72, 0.66), offset: v(0, -0.02, 0), dye: 'sun' },
      ...pair((_, s, mirror) => [
        { node: 'hips', name: `TRACK ${s}`, kind: 'box', size: v(0.24, 0.4, 0.8), offset: v(mirror * 0.5, -0.12, 0), dye: 'limb' },
      ]),
    ],
  },

  guy: {
    label: 'GUY',
    note: 'A ROUGH LITTLE PERSON. ARMS THAT POSE.',
    nodes: [
      { id: 'hips', parentId: null, position: v(0, 0, 0) },
      { id: 'body', parentId: 'hips', position: v(0, 0.44, 0) },
      { id: 'head', parentId: 'body', position: v(0, 0.5, 0) },
      { id: 'arm.left', parentId: 'body', position: v(-0.3, 0.22, 0) },
      { id: 'hand.left', parentId: 'arm.left', position: v(0, -0.62, 0) },
      { id: 'arm.right', parentId: 'body', position: v(0.3, 0.22, 0) },
      { id: 'hand.right', parentId: 'arm.right', position: v(0, -0.62, 0) },
    ],
    parts: [
      { node: 'head', name: 'HEAD', kind: 'sphere', size: v(0.44, 0.46, 0.42), offset: v(0, 0.08, 0), dye: 'figure' },
      // Flavine, not rose: rose is what marks a broken shape, and a mark on a rose shirt would not show.
      { node: 'body', name: 'BODY', kind: 'capsule', size: v(0.5, 0.8, 0.32), offset: v(0, -0.02, 0), dye: 'acid' },
      ...pair((side, s) => [
        { node: `arm.${side}`, name: `ARM ${s}`, kind: 'capsule', size: v(0.16, 0.76, 0.16), offset: v(0, -0.3, 0), dye: 'figure' },
      ]),
      { node: 'hips', name: 'LEGS', kind: 'box', size: v(0.42, 0.9, 0.3), offset: v(0, -0.38, 0), dye: 'royal' },
    ],
  },
};

export function isRigPresetId(value: unknown): value is RigPresetId {
  return typeof value === 'string' && (RIG_PRESET_IDS as readonly string[]).includes(value);
}

/** The bare skeleton for a preset, every node at rest. */
export function buildSkeleton(presetId: RigPresetId = 'base'): Skeleton {
  const nodes = RIG_PRESETS[presetId].nodes;
  const root = nodes[0];
  let skeleton: Skeleton = {
    joints: { [root.id]: { id: root.id, parentId: null, position: cloneVec3(root.position), rest: cloneVec3(root.position) } },
    rootId: root.id,
  };

  for (const node of nodes) {
    if (node.parentId === null) continue;
    skeleton = addJoint(skeleton, { id: node.id, parentId: node.parentId, position: node.position });
  }

  return skeleton;
}

function dyeValue(id: string): string | null {
  const dye = MASS_DYES.find((entry) => entry.id === id);
  return dye === undefined ? MODEL_LIMB : dye.value;
}

const toRadians = (degrees: Vec3): Vec3 => v((degrees.x * Math.PI) / 180, (degrees.y * Math.PI) / 180, (degrees.z * Math.PI) / 180);

/** A whole starting figure: the preset's skeleton and its parts pinned to their nodes, standing on the floor. */
export function buildDefaultFigure(presetId: RigPresetId = 'base'): Figure {
  const preset = RIG_PRESETS[presetId];

  const shapes: Shape[] = preset.parts.map((part, index) => ({
    id: `s${index + 1}`,
    name: part.name,
    kind: part.kind,
    colour: dyeValue(part.dye),
    hidden: false,
    pin: part.node,
    position: cloneVec3(part.offset),
    rotation: toRadians(part.turn ?? v(0, 0, 0)),
    size: cloneVec3(part.size),
  }));

  return standOnFloor({ skeleton: buildSkeleton(presetId), shapes });
}

/**
 * Where every preset's lowest point sits. Without it a figure with no legs would hang in mid-air at hip height; with
 * it, every preset stands on one floor and the views frame them all the same way.
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
