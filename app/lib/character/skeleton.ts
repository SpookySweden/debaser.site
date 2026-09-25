/**
 * The character's skeleton, as arithmetic.
 *
 * **A rig is a tree of joints, and every joint's transform is relative to its parent.** That is the whole
 * design, and it is what makes the editor behave: rotating a shoulder carries the elbow, the wrist and
 * everything hung off them, because a child's position is expressed *in its parent's space* rather than in
 * the world's. Store absolute positions instead and every parent drag has to walk its descendants and
 * rewrite each one - which is more code, more places to be wrong, and a figure that tears apart the moment
 * a write is missed.
 *
 * **Plain `{x, y, z}` triples, never `THREE.Vector3`.** This is the module's most load-bearing rule. A
 * `Vector3` is a mutable object: putting one in the store means a drag mutates a value that React has
 * already compared and decided was unchanged, so the canvas does not re-render and the joint appears stuck.
 * It also means the arithmetic below could only be tested with a WebGL context present. Triples are values -
 * they compare, they copy, they serialise to a database column, and this whole file runs in plain Node.
 * The conversion to Three's types happens at the boundary, in the viewport, once per render.
 *
 * This file holds **no React and no rendering** on purpose, for the reason `app/lib/forum/post-layout.ts`
 * holds none: the rules a figure obeys should be readable, and checkable, without a browser.
 */

/** A point or a scale in space. Always its own object - never shared between two joints. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * One joint: a bone's origin, and the frame its children hang off.
 *
 * `parentId` of `null` marks a root. There is exactly one root - the hips - and `buildDefaultRig` is what
 * guarantees it; a second root is not an error the type can catch, so `validateRig` does.
 */
export type Joint = {
  id: string;
  parentId: string | null;
  /** Where this joint sits, measured from its parent's origin (or the origin of the world, for the root). */
  position: Vec3;
  /** The rotation of this joint's own frame, in radians, applied before its children are placed. */
  rotation: Vec3;
  /** Scale of the mass hung off this joint. Uniform by construction - see `setScale`. */
  scale: Vec3;
};

/** A rig in the form the editor and the renderer both read: by id, plus the root to start from. */
export type Skeleton = {
  joints: Record<string, Joint>;
  /** The single root joint's id. */
  rootId: string;
};

/** What the renderer hangs off a joint: a box, a sphere or a cone, or nothing at all. */
export type MassShape = 'box' | 'sphere' | 'cone';

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
export const UNIT: Vec3 = { x: 1, y: 1, z: 1 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A copy. Every mutation in this file returns new objects, because the store compares by reference. */
export function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * A joint placed in the world: its own position, its parent's, and so on up to the root.
 *
 * Recursive and therefore bounded by the depth of the rig, which is under twenty joints - there is no
 * cache here because a mutation invalidates every descendant's answer anyway, so a cache would be a
 * correctness risk for no measurable gain. A cycle would hang here, which is why `validateRig` exists and
 * `reparent` refuses to make one.
 */
export function worldPosition(skeleton: Skeleton, id: string): Vec3 {
  const joint = skeleton.joints[id];
  if (joint === undefined) return cloneVec3(ORIGIN);
  if (joint.parentId === null) return cloneVec3(joint.position);

  return addVec3(worldPosition(skeleton, joint.parentId), joint.position);
}

/** Every joint between `id` and its root, nearest first. The root itself is not included. */
export function ancestorsOf(skeleton: Skeleton, id: string): string[] {
  const chain: string[] = [];
  let parentId = skeleton.joints[id]?.parentId ?? null;
  // A `Set` guard rather than a depth limit: a cycle is a bug worth surviving, not one worth hanging on.
  const seen = new Set<string>();

  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    chain.push(parentId);
    parentId = skeleton.joints[parentId]?.parentId ?? null;
  }

  return chain;
}

/**
 * Every joint below `id`, in depth-first order, excluding `id` itself.
 *
 * The order matters to the renderer: a parent's transform has to be applied before its children's, and
 * depth-first is that order. It is also why children are found by search rather than kept in a list on each
 * joint - a `childIds` array is a second place the tree is recorded, and the two would drift the first time
 * a joint moved without being pushed to both.
 */
export function descendantsOf(skeleton: Skeleton, id: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([id]);
  const walk = (parentId: string) => {
    for (const child of Object.values(skeleton.joints)) {
      if (child.parentId !== parentId || seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child.id);
      walk(child.id);
    }
  };

  walk(id);

  return found;
}

/**
 * Whether `candidateParentId` sits at or below `id`.
 *
 * The guard that keeps the tree a tree: re-parenting a joint onto its own descendant would detach the whole
 * branch from the root and, because `worldPosition` walks upward, hang every later read. `reparent` refuses
 * on this rather than trusting callers to check.
 */
export function isDescendant(skeleton: Skeleton, id: string, candidateParentId: string): boolean {
  return id === candidateParentId || descendantsOf(skeleton, id).includes(candidateParentId);
}

/** Add a joint. The parent must exist, and the new joint comes back in a new skeleton. */
export function addJoint(
  skeleton: Skeleton,
  joint: { id: string; parentId: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 },
): Skeleton {
  if (skeleton.joints[joint.id] !== undefined) return skeleton;
  if (skeleton.joints[joint.parentId] === undefined) return skeleton;

  return {
    ...skeleton,
    joints: {
      ...skeleton.joints,
      [joint.id]: {
        id: joint.id,
        parentId: joint.parentId,
        position: cloneVec3(joint.position ?? ORIGIN),
        rotation: cloneVec3(joint.rotation ?? ORIGIN),
        scale: cloneVec3(joint.scale ?? UNIT),
      },
    },
  };
}

/**
 * Remove a joint **and everything below it**.
 *
 * Deleting a joint and leaving its children pointing at a parent that no longer exists is the failure this
 * avoids: those children would become invisible roots, still in the record, still counted, drawn at the
 * world origin. A reader removing an arm means the arm, so the branch goes with it. The root cannot be
 * removed - a rig with no root is no longer a tree at all.
 */
export function removeJoint(skeleton: Skeleton, id: string): Skeleton {
  if (id === skeleton.rootId || skeleton.joints[id] === undefined) return skeleton;

  const doomed = new Set<string>([id, ...descendantsOf(skeleton, id)]);
  const joints: Record<string, Joint> = {};

  for (const joint of Object.values(skeleton.joints)) {
    if (!doomed.has(joint.id)) joints[joint.id] = joint;
  }

  return { ...skeleton, joints };
}

/** Move a joint under a new parent, keeping its own position, rotation and scale. */
export function reparent(skeleton: Skeleton, id: string, parentId: string): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined || id === skeleton.rootId) return skeleton;
  if (skeleton.joints[parentId] === undefined) return skeleton;
  // Refused, not asserted: see `isDescendant`. Leaving the skeleton unchanged keeps this total.
  if (isDescendant(skeleton, id, parentId)) return skeleton;

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, parentId } } };
}

/** Set a joint's position. Returns the skeleton unchanged when the id is unknown. */
export function setPosition(skeleton: Skeleton, id: string, position: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, position: cloneVec3(position) } } };
}

/** Set a joint's rotation, in radians. */
export function setRotation(skeleton: Skeleton, id: string, rotation: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, rotation: cloneVec3(rotation) } } };
}

/**
 * Set a joint's scale, **uniformly** - the same factor on all three axes.
 *
 * The rescaler in the sidebar is a single range input, and this is why: a figure whose limb is 1.4 wide, 1.0
 * tall and 0.8 deep is not a shape anybody asked for, and allowing it means the control has to grow to three
 * sliders. Non-uniform scale is also the case that makes the outline pass wrong, because a distance measured
 * in screen space stops matching the geometry. Keeping the three components equal is the cheap way to keep
 * that door shut; the field stays a triple so a future non-uniform mode is a change here and not a change to
 * every consumer.
 */
export function setScale(skeleton: Skeleton, id: string, factor: number): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  const safe = Number.isFinite(factor) && factor > 0 ? factor : 1;

  return {
    ...skeleton,
    joints: { ...skeleton.joints, [id]: { ...joint, scale: vec3(safe, safe, safe) } },
  };
}

/** The scale factor a joint carries, read back from its (uniform) triple. */
export function scaleOf(joint: Joint): number {
  return joint.scale.x;
}

/**
 * A rig is well formed when it has exactly one root, every non-root's parent exists, and there are no
 * cycles.
 *
 * Worth having as a function because the two ways to corrupt a tree - a dangling parent and a loop - are
 * both invisible until something hangs, and `buildDefaultRig` is not the only thing that will ever build
 * one. The check runs it over the default rig.
 */
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
  }

  for (const joint of joints) {
    if (ancestorsOf(skeleton, joint.id).includes(joint.id)) problems.push(`joint "${joint.id}" is in a cycle`);
  }

  return problems;
}
