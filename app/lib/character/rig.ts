/**
 * The starting figures: a humanoid skeleton, and the shapes pinned to it.
 *
 * **A starting point, not a constraint.** Every shape built here is an ordinary free shape pinned to a joint - the
 * reader can resize it, unpin it, delete it, or add ten more beside it. The tables below are only what BLOB, LANKY
 * and STOCKY put on the bench before anyone has touched it.
 *
 * The root is the hips, so posing reads as leaning rather than sliding, and the dimensions are in the same units as
 * joint positions. **They are not measurements of a person**: a blob humanoid has a head a third of its body.
 */
import type { Figure, Shape } from './figure';
import { MODEL_LIMB } from './palette';
import type { MassShapeId } from './shapes';
import { addJoint, cloneVec3, vec3, type Skeleton, type Vec3 } from './skeleton';

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

/** A starting shape: what it is, how big (full extents), and where its centre sits from its joint. */
type Part = { joint: string; name: string; kind: MassShapeId; size: Vec3; offset: Vec3; limb: boolean };

const PARTS: readonly Part[] = [
  { joint: 'head', name: 'HEAD', kind: 'box', size: vec3(0.6, 0.6, 0.6), offset: vec3(0, 0.16, 0), limb: false },
  { joint: 'chest', name: 'CHEST', kind: 'sphere', size: vec3(0.68, 0.76, 0.52), offset: vec3(0, -0.18, 0), limb: false },
  { joint: 'hips', name: 'HIPS', kind: 'sphere', size: vec3(0.64, 0.5, 0.48), offset: vec3(0, -0.06, 0), limb: false },
  ...(['left', 'right'] as const).flatMap((side): Part[] => {
    const s = side === 'left' ? 'L' : 'R';
    return [
      { joint: `upper-arm.${side}`, name: `UPPER ARM ${s}`, kind: 'cylinder', size: vec3(0.22, 0.6, 0.22), offset: vec3(0, -0.26, 0), limb: true },
      { joint: `forearm.${side}`, name: `FOREARM ${s}`, kind: 'capsule', size: vec3(0.18, 0.7, 0.18), offset: vec3(0, -0.22, 0), limb: true },
      { joint: `hand.${side}`, name: `HAND ${s}`, kind: 'box', size: vec3(0.2, 0.2, 0.2), offset: vec3(0, -0.06, 0), limb: true },
      { joint: `thigh.${side}`, name: `THIGH ${s}`, kind: 'capsule', size: vec3(0.28, 0.96, 0.28), offset: vec3(0, -0.3, 0), limb: true },
      { joint: `shin.${side}`, name: `SHIN ${s}`, kind: 'capsule', size: vec3(0.22, 0.82, 0.22), offset: vec3(0, -0.26, 0), limb: true },
      // A triangle seen from the front, running forward: the prism's long axis is depth (see the scene's geometry).
      { joint: `foot.${side}`, name: `FOOT ${s}`, kind: 'prism', size: vec3(0.26, 0.2, 0.44), offset: vec3(0, -0.04, 0.07), limb: true },
    ];
  }),
];

export type RigPresetId = 'blob' | 'lanky' | 'stocky';

export const RIG_PRESET_IDS: readonly RigPresetId[] = ['blob', 'lanky', 'stocky'];

export type RigPreset = {
  label: string;
  /** One line, so the choice is made on the figure rather than on the name. */
  note: string;
  /** Multiplies the arm and leg bones - and the length of the shapes on them, so a long bone gets a long limb. */
  limb: number;
  /** Multiplies every shape's thickness. The single dial that turns a figure fat or thin. */
  girth: number;
};

export const RIG_PRESETS: Record<RigPresetId, RigPreset> = {
  blob: { label: 'BLOB', note: 'SHORT AND ROUND - THE BALANCED ONE', limb: 1, girth: 1 },
  lanky: { label: 'LANKY', note: 'LONG LIMBS, THIN - A STRINGY FIGURE', limb: 1.3, girth: 0.78 },
  stocky: { label: 'STOCKY', note: 'SHORT LIMBS, HEAVY - A SOLID FIGURE', limb: 0.78, girth: 1.32 },
};

export function isRigPresetId(value: unknown): value is RigPresetId {
  return typeof value === 'string' && (RIG_PRESET_IDS as readonly string[]).includes(value);
}

function isLimbBone(id: string): boolean {
  return /^(upper-arm|forearm|thigh|shin)\./.test(id);
}

/** The bare skeleton for a preset, every joint at rest. */
export function buildSkeleton(presetId: RigPresetId = 'blob'): Skeleton {
  const preset = RIG_PRESETS[presetId];
  const root = RIG[0];
  let skeleton: Skeleton = {
    joints: { [root.id]: { id: root.id, parentId: null, position: cloneVec3(root.position), rest: cloneVec3(root.position) } },
    rootId: root.id,
  };

  for (const joint of RIG) {
    if (joint.parentId === null) continue;
    // A bone's length is the *child's* offset, so the joint below a limb bone is the one that stretches.
    const parentIsLimb = isLimbBone(joint.parentId);
    const position = parentIsLimb ? vec3(joint.position.x, joint.position.y * preset.limb, joint.position.z) : joint.position;
    skeleton = addJoint(skeleton, { id: joint.id, parentId: joint.parentId, position });
  }

  return skeleton;
}

/** A whole starting figure: the preset's skeleton, with every part pinned to its joint. */
export function buildDefaultFigure(presetId: RigPresetId = 'blob'): Figure {
  const preset = RIG_PRESETS[presetId];

  const shapes: Shape[] = PARTS.map((part, index) => {
    const stretch = isLimbBone(part.joint) ? preset.limb : 1;
    return {
      id: `s${index + 1}`,
      name: part.name,
      kind: part.kind,
      colour: part.limb ? MODEL_LIMB : null,
      hidden: false,
      pin: part.joint,
      position: vec3(part.offset.x, part.offset.y * stretch, part.offset.z),
      rotation: vec3(0, 0, 0),
      size: vec3(part.size.x * preset.girth, part.size.y * (part.limb ? stretch : preset.girth), part.size.z * preset.girth),
    };
  });

  return { skeleton: buildSkeleton(presetId), shapes };
}
