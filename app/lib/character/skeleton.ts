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
import type { MassShapeId } from './shapes';

/** A point or a scale in space. Always its own object - never shared between two joints. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * The mass hung off a joint: a primitive, and where it sits.
 *
 * **This is authored data, and it lives on the joint - which is the change that makes the brief's "vice versa"
 * true.** It used to be a frozen table in `rig.ts` keyed by joint id: the renderer looked a shape up, and a drag
 * could only scale the *joint*. So "move the hand vertex and the mass follows" worked, and "move the mass and the
 * vertex follows" had nothing to move - there was no per-joint mass to edit, only a lookup.
 *
 * Holding it on the joint makes the relationship the brief describes a real two-way one:
 *
 *   move the JOINT   the mass rides along, because it is drawn in the joint's frame (free, from the tree)
 *   move the MASS    its offset changes, and its *size* changes - nothing about the joint moves
 *
 * **Offset is in the joint's own space, not the parent's**, so a rotated joint carries its mass around with it
 * rather than sliding it sideways. That is the same reasoning as `position` being parent-relative, one level
 * down: every transform is expressed in the frame of the thing it hangs off.
 */
export type Mass = {
  shape: MassShapeId;
  /**
   * Half-extents for a box or sphere, radius and half-length for the round-ended shapes. In joint space, so a
   * scaled joint scales this with it and there is no second place to apply the factor.
   */
  size: Vec3;
  /** Where the primitive's centre sits relative to the joint. Lets a limb's cone start at its hinge. */
  offset: Vec3;
};

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
  /**
   * The primitive this joint carries, or `null` for a joint that carries none.
   *
   * **`null` is a first-class value and not a missing entry.** It used to be "absent from `PART_OF_JOINT`",
   * which meant the renderer consulted a second structure and a joint's emptiness was a fact about a *table*
   * rather than about the joint. `spine` and both shoulders carry nothing by definition - they exist so rotating
   * the chest swings the arms - and saying so on the joint is what lets a reader *add* a shape to one, which is
   * the first thing anybody will want to do to a shoulder.
   */
  mass: Mass | null;
};

/** A rig in the form the editor and the renderer both read: by id, plus the root to start from. */
export type Skeleton = {
  joints: Record<string, Joint>;
  /** The single root joint's id. */
  rootId: string;
};

/**
 * What the renderer hangs off a joint.
 *
 * **Re-exported from `shapes.ts` rather than declared here, and that is the whole point of the indirection.** The
 * vocabulary grew from three primitives to six when the palette was added, and the *shape list* is what the
 * palette, the rig, the renderer and the checks all need to agree about. Declaring the union in this file would
 * make `shapes.ts`'s table a second copy that can fall behind it.
 */
export type MassShape = MassShapeId;

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
  joint: { id: string; parentId: string; position?: Vec3; rotation?: Vec3; scale?: Vec3; mass?: Mass | null },
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
        // A joint added without a mass carries none, which is the same state as a structural joint - so a caller
        // that wants a shape passes one, and a caller that does not gets a joint that is purely a hinge.
        mass: joint.mass ?? null,
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
 * The smallest and largest a mass dimension may be.
 *
 * **Clamped rather than validated, because a zero-size shape is unclickable.** A box of no extent has no surface
 * to hit, so a reader who dragged it to nothing could never select it again and the shape would be gone with no
 * way to bring it back. The floor is small enough to read as "the smallest it goes" and large enough to still be
 * a target at the panes' zoom.
 */
export const MIN_MASS_EXTENT = 0.02;
export const MAX_MASS_EXTENT = 1.2;

function clampExtent(value: number): number {
  if (!Number.isFinite(value)) return MIN_MASS_EXTENT;
  return Math.min(MAX_MASS_EXTENT, Math.max(MIN_MASS_EXTENT, value));
}

/**
 * Set the primitive on a joint, **keeping its size and offset** where it has one.
 *
 * Changing a shape is a change of vocabulary, not a reset: a reader who has sized a limb into a cone and switches
 * it to a capsule wants the capsule that size. A joint with no mass gets the shape at a size derived from its
 * place in the figure, so a newly added shape arrives *visible* rather than as a zero-extent speck the reader has
 * to hunt for.
 *
 * Returns the skeleton unchanged for an unknown joint id.
 */
export function setMassShape(skeleton: Skeleton, id: string, shape: MassShapeId): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined) return skeleton;

  if (joint.mass === null) {
    return {
      ...skeleton,
      joints: {
        ...skeleton.joints,
        [id]: { ...joint, mass: { shape, size: vec3(0.08, 0.08, 0.08), offset: cloneVec3(ORIGIN) } },
      },
    };
  }

  return {
    ...skeleton,
    joints: { ...skeleton.joints, [id]: { ...joint, mass: { ...joint.mass, shape } } },
  };
}

/** Take the primitive off a joint. A joint with no mass is a joint with no mass; it is not an error. */
export function clearMass(skeleton: Skeleton, id: string): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined || joint.mass === null) return skeleton;

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, mass: null } } };
}

/**
 * Resize a joint's mass by an offset, in joint space.
 *
 * An offset rather than an absolute size, for the same reason `setPosition` takes one: that is what a drag
 * produces, and it lets the same gesture grow a big shape and a small one by the same *amount* rather than by the
 * same *factor*. That distinction is the point of the two-tone model - the joint's `scale` is proportional and
 * scales the shape with the joint, while this changes the shape itself.
 *
 * Each axis is clamped independently, so a drag that flattens a shape against the floor cannot also erase it.
 * A joint with no mass is left alone: there is nothing to resize, and inventing a shape from a resize gesture
 * would mean a reader who dragged on an empty joint got geometry they never asked for.
 */
export function resizeMass(skeleton: Skeleton, id: string, delta: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined || joint.mass === null) return skeleton;

  const size = vec3(
    clampExtent(joint.mass.size.x + delta.x),
    clampExtent(joint.mass.size.y + delta.y),
    clampExtent(joint.mass.size.z + delta.z),
  );

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, mass: { ...joint.mass, size } } } };
}

/**
 * Move a joint's mass within the joint's own frame, **leaving the joint where it is**.
 *
 * This is the other half of the brief's two-way rule: moving the joint carries the mass because the mass is drawn
 * in the joint's frame, and moving the *mass* changes only this offset. Two separate facts, so neither can
 * silently rewrite the other.
 */
export function offsetMass(skeleton: Skeleton, id: string, delta: Vec3): Skeleton {
  const joint = skeleton.joints[id];
  if (joint === undefined || joint.mass === null) return skeleton;

  const offset = vec3(
    joint.mass.offset.x + delta.x,
    joint.mass.offset.y + delta.y,
    joint.mass.offset.z + delta.z,
  );

  return { ...skeleton, joints: { ...skeleton.joints, [id]: { ...joint, mass: { ...joint.mass, offset } } } };
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
