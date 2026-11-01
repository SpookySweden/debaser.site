/**
 * The character's skeleton, as arithmetic.
 *
 * **A rig is a tree of joints, and every joint's position is relative to its parent.** That is what makes posing
 * behave: moving an elbow carries the wrist and the hand, because a child's position is an offset from its parent
 * rather than a point in the world. Store absolute positions instead and every parent drag has to walk its
 * descendants and rewrite each one.
 *
 * **Joints carry no shapes.** They used to - one primitive per joint - which meant a figure could never have two
 * ears, a nose, or a shape on a joint that already had one. Shapes are now a free list (`figure.ts`), and a shape
 * may be *pinned* to a joint. The skeleton is purely the thing shapes hang off and the thing a pose bends.
 *
 * **Plain `{x, y, z}` triples, never `THREE.Vector3`.** A `Vector3` is mutable: putting one in the store means a
 * drag mutates a value React has already compared, and the canvas does not redraw. Triples are values - they
 * compare, they copy, they serialise, and this file runs in plain Node.
 *
 * This file holds **no React and no rendering**, so the rules a figure obeys can be checked without a browser.
 */
import { IDENTITY, quatSwing, rotateVec, type Quat } from './turns';

/** A point, a direction or a size. Always its own object - never shared between two joints or shapes. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * One joint: a bone's origin.
 *
 * `rest` is where the joint sat, relative to its parent, when the rig was built. It never changes after that: it is
 * the "before" a pose is measured against, so a bone's rotation is the turn from its rest direction to its current
 * one (`jointFrames`). Without it, a shape pinned to a forearm would have no way to know the forearm had bent.
 */
export type Joint = {
  id: string;
  parentId: string | null;
  /** Where this joint sits now, measured from its parent's origin (or the world's, for the root). */
  position: Vec3;
  /** Where it sat when the rig was built. */
  rest: Vec3;
};

/** A rig in the form the editor and the renderer both read: by id, plus the root to start from. */
export type Skeleton = {
  joints: Record<string, Joint>;
  rootId: string;
};

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A copy. Every mutation in these files returns new objects, because the store compares by reference. */
export function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(a: Vec3, factor: number): Vec3 {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

export function lengthOf(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** A joint placed in the world: its own offset, its parent's, and so on up to the root. */
export function worldPosition(skeleton: Skeleton, id: string): Vec3 {
  let total = cloneVec3(ORIGIN);
  let cursor: string | null = id;
  // A `Set` guard: a cycle is a bug worth surviving, not one worth hanging on.
  const seen = new Set<string>();

  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const joint: Joint | undefined = skeleton.joints[cursor];
    if (joint === undefined) break;
    total = addVec3(total, joint.position);
    cursor = joint.parentId;
  }

  return total;
}

/** Every joint between `id` and its root, nearest first. The root itself is not included. */
export function ancestorsOf(skeleton: Skeleton, id: string): string[] {
  const chain: string[] = [];
  let parentId = skeleton.joints[id]?.parentId ?? null;
  const seen = new Set<string>();

  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    chain.push(parentId);
    parentId = skeleton.joints[parentId]?.parentId ?? null;
  }

  return chain;
}

/** The joints hung directly off `id`, in the order the rig declared them. */
export function childrenOf(skeleton: Skeleton, id: string): Joint[] {
  return Object.values(skeleton.joints).filter((joint) => joint.parentId === id);
}

/** Every joint below `id`, depth first, excluding `id` itself. */
export function descendantsOf(skeleton: Skeleton, id: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([id]);
  const walk = (parentId: string) => {
    for (const child of childrenOf(skeleton, parentId)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child.id);
      walk(child.id);
    }
  };

  walk(id);

  return found;
}

/** Add a joint. The parent must exist (or be `null` for a first root); its rest pose is where it is put. */
export function addJoint(skeleton: Skeleton, joint: { id: string; parentId: string; position: Vec3 }): Skeleton {
  if (skeleton.joints[joint.id] !== undefined) return skeleton;
  if (skeleton.joints[joint.parentId] === undefined) return skeleton;

  return {
    ...skeleton,
    joints: {
      ...skeleton.joints,
      [joint.id]: {
        id: joint.id,
        parentId: joint.parentId,
        position: cloneVec3(joint.position),
        rest: cloneVec3(joint.position),
      },
    },
  };
}

/** Set a joint's position (parent-relative). Returns the skeleton unchanged when the id is unknown. */
export function setPosition(skeleton: Skeleton, id: string, position: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, position: cloneVec3(position) } } };
}

/**
 * A joint's world placement: where it is, and which way its bone is turned.
 *
 * **A bone runs from a joint to its first child**, and its turn is the swing from where that child sat at rest to
 * where it sits now. A joint with no child, or whose first child sits on top of it (a shoulder and its upper arm
 * share a point), has no bone of its own and borrows its parent's turn - so a hand turns with its forearm.
 */
export type JointFrame = { position: Vec3; rotation: Quat };

export function jointFrames(skeleton: Skeleton): Record<string, JointFrame> {
  const frames: Record<string, JointFrame> = {};

  const visit = (id: string, parentPosition: Vec3, parentRotation: Quat, seen: Set<string>) => {
    const joint = skeleton.joints[id];
    if (joint === undefined || seen.has(id)) return;
    seen.add(id);

    const position = addVec3(parentPosition, joint.position);
    const children = childrenOf(skeleton, id);
    const lead = children[0];

    let rotation = parentRotation;
    if (lead !== undefined && lengthOf(lead.rest) > 1e-6 && lengthOf(lead.position) > 1e-6) {
      rotation = quatSwing(lead.rest, lead.position);
    }

    frames[id] = { position, rotation };
    for (const child of children) visit(child.id, position, rotation, seen);
  };

  visit(skeleton.rootId, ORIGIN, IDENTITY, new Set());

  return frames;
}

/**
 * Bend a limb: put joint `id` as near to `target` (a world point) as its bone allows, **keeping the bone's length**,
 * and carry everything below it round with it.
 *
 * This is what POSE does by default. The joint swings about its parent - an elbow dragged moves on a circle round
 * the shoulder - and every descendant's offset is turned by the same amount, so the forearm and hand come along
 * rigidly instead of staying pointed where they were. A joint sitting on its parent (zero-length bone) cannot
 * swing, and the root has no parent to swing about: both are left alone.
 */
export function bendJoint(skeleton: Skeleton, id: string, target: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined || joint.parentId === null) return skeleton;

  const length = lengthOf(joint.position);
  if (length < 1e-6) return skeleton;

  const parentWorld = worldPosition(skeleton, joint.parentId);
  const wanted = subtractVec3(target, parentWorld);
  if (lengthOf(wanted) < 1e-6) return skeleton;

  const turn = quatSwing(joint.position, wanted);
  const joints = { ...skeleton.joints };

  joints[id] = { ...joint, position: scaleVec3(wanted, length / lengthOf(wanted)) };
  for (const below of descendantsOf(skeleton, id)) {
    const child = joints[below];
    joints[below] = { ...child, position: rotateVec(turn, child.position) };
  }

  return { ...skeleton, joints };
}

/**
 * Stretch a limb: move joint `id` to `target` freely, changing the bone's length. Everything below it keeps its own
 * offsets and so travels with it. This is POSE with STRETCH switched on - for proportions rather than posture.
 */
export function stretchJoint(skeleton: Skeleton, id: string, target: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  const parentWorld = joint.parentId === null ? ORIGIN : worldPosition(skeleton, joint.parentId);

  return setPosition(skeleton, id, subtractVec3(target, parentWorld));
}

/** Exactly one root, every parent exists, no cycles. The two ways to corrupt a tree are both invisible until it hangs. */
export function validateRig(skeleton: Skeleton): string[] {
  const problems: string[] = [];
  const joints = Object.values(skeleton.joints);

  const roots = joints.filter((joint) => joint.parentId === null);
  if (roots.length !== 1) problems.push(`expected exactly one root, found ${roots.length}`);
  if (skeleton.joints[skeleton.rootId] === undefined) problems.push(`root joint "${skeleton.rootId}" is missing`);

  for (const joint of joints) {
    if (joint.parentId !== null && skeleton.joints[joint.parentId] === undefined) {
      problems.push(`joint "${joint.id}" points at a parent that does not exist ("${joint.parentId}")`);
    }
    if (ancestorsOf(skeleton, joint.id).includes(joint.id)) problems.push(`joint "${joint.id}" is in a cycle`);
  }

  return problems;
}
