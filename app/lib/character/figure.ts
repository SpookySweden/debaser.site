/**
 * A figure: a skeleton, and a free list of shapes that may be pinned to its joints.
 *
 * **Free shapes rather than one per joint.** The workbench used to hang exactly one primitive off each joint, so a
 * figure could not have two ears, a nose, or anything a joint did not already own. Now a figure is up to `MAX_SHAPES`
 * shapes, each of which may be **pinned** to a joint. A pinned shape is placed in its joint's frame, so posing the
 * skeleton carries it along *and turns it with the bone* - like a sticker on a bone. An unpinned shape stays where
 * it was put.
 *
 * **Pinning never moves a shape.** Pinning, unpinning and re-pinning all convert the shape's numbers between frames
 * so it stays exactly where it is on screen; only what it follows afterwards changes. A control that made a shape
 * jump across the figure when you changed what it was attached to would be a control nobody trusts.
 *
 * Everything here is pure - plain data in, new plain data out, no React, no Three - so the rules can be checked in
 * Node, and every function returns a new figure rather than editing the one it was given (the store compares by
 * reference, and the undo history keeps old figures alive).
 */
import { isMassDye } from './palette';
import { MASS_SHAPES, isMassShapeId, type MassShapeId } from './shapes';
import {
  addVec3,
  cloneVec3,
  descendantsOf,
  jointFrames,
  subtractVec3,
  type JointFrame,
  type Skeleton,
  type Vec3,
} from './skeleton';
import { eulerFromQuat, quatFromEuler, quatInvert, quatMultiply, rotateVec, type Quat } from './turns';

export type Shape = {
  id: string;
  /** What the shapes list calls it. The reader can rename it. */
  name: string;
  kind: MassShapeId;
  /** A dye from `MASS_DYES`, or `null` for the figure's own colour. */
  colour: string | null;
  /** Hidden shapes are not drawn and cannot be grabbed in the views. */
  hidden: boolean;
  /** The joint this shape follows, or `null` for a shape that stays put. */
  pin: string | null;
  /** The shape's centre: in its joint's frame when pinned, in the world when not. */
  position: Vec3;
  /** XYZ Euler angles in radians, in the same frame as `position`. */
  rotation: Vec3;
  /** Full width, height and depth. Every primitive is drawn to fill exactly this box. */
  size: Vec3;
};

export type Figure = {
  skeleton: Skeleton;
  /** In list order: the order the shapes panel shows, top first. */
  shapes: Shape[];
};

/** The smallest and largest a shape may be along one axis. Zero-size shapes have nothing left to click. */
export const MIN_EXTENT = 0.03;
export const MAX_EXTENT = 2.4;
/** How far from the origin a shape may be put, so a stray drag cannot fling one out of every view. */
export const MAX_REACH = 3;

/** A simple figure: five shapes to start, seven at most (SPEC-simple-figures.md). */
export const MAX_SHAPES = 7;
/** Nodes, likewise: the base skeleton is three, and seven is the most a figure may have. */
export const MAX_NODES = 7;
export const MAX_NAME_LENGTH = 20;

function clampExtent(value: number): number {
  if (!Number.isFinite(value)) return MIN_EXTENT;
  return Math.min(MAX_EXTENT, Math.max(MIN_EXTENT, value));
}

function clampReach(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_REACH, Math.max(-MAX_REACH, value));
}

export function clampSize(size: Vec3): Vec3 {
  return { x: clampExtent(size.x), y: clampExtent(size.y), z: clampExtent(size.z) };
}

function clampPosition(position: Vec3): Vec3 {
  return { x: clampReach(position.x), y: clampReach(position.y), z: clampReach(position.z) };
}

/** Where a shape is, and how it is turned, in the world. */
export type Placement = { position: Vec3; rotation: Quat };

/**
 * A shape's world placement.
 *
 * Pass `frames` when placing many shapes in one render, so the skeleton is walked once rather than once per shape.
 * A pin naming a joint that does not exist is treated as no pin, so a damaged figure still draws.
 */
export function placementOf(figure: Figure, shape: Shape, frames?: Record<string, JointFrame>): Placement {
  const local: Placement = { position: cloneVec3(shape.position), rotation: quatFromEuler(shape.rotation) };
  if (shape.pin === null) return local;

  const frame = (frames ?? jointFrames(figure.skeleton))[shape.pin];
  if (frame === undefined) return local;

  return {
    position: addVec3(frame.position, rotateVec(frame.rotation, local.position)),
    rotation: quatMultiply(frame.rotation, local.rotation),
  };
}

/** The inverse of `placementOf`: the numbers a shape pinned to `pin` needs to sit at `placement`. */
function localFor(figure: Figure, pin: string | null, placement: Placement): { position: Vec3; rotation: Vec3 } {
  const frame = pin === null ? undefined : jointFrames(figure.skeleton)[pin];
  if (frame === undefined) {
    return { position: clampPosition(placement.position), rotation: eulerFromQuat(placement.rotation) };
  }

  const undo = quatInvert(frame.rotation);

  return {
    position: rotateVec(undo, subtractVec3(placement.position, frame.position)),
    rotation: eulerFromQuat(quatMultiply(undo, placement.rotation)),
  };
}

function replaceShape(figure: Figure, id: string, change: (shape: Shape) => Shape): Figure {
  let found = false;
  const shapes = figure.shapes.map((shape) => {
    if (shape.id !== id) return shape;
    found = true;
    return change(shape);
  });

  return found ? { ...figure, shapes } : figure;
}

export function findShape(figure: Figure, id: string | null): Shape | undefined {
  if (id === null) return undefined;
  return figure.shapes.find((shape) => shape.id === id);
}

/** Put a shape at a world placement, keeping whatever it is pinned to. */
export function placeShape(figure: Figure, id: string, placement: Placement): Figure {
  return replaceShape(figure, id, (shape) => ({ ...shape, ...localFor(figure, shape.pin, placement) }));
}

/**
 * Pin a shape to a joint, or unpin it with `null`, **without moving it**.
 *
 * The shape's world placement is read in its old frame and written back in its new one, so the only thing that
 * changes is what it follows from now on.
 */
export function pinShape(figure: Figure, id: string, pin: string | null): Figure {
  const shape = findShape(figure, id);
  if (shape === undefined) return figure;
  if (pin !== null && figure.skeleton.joints[pin] === undefined) return figure;

  const placement = placementOf(figure, shape);

  return replaceShape(figure, id, (current) => ({ ...current, pin, ...localFor(figure, pin, placement) }));
}

/** Set the shape's numbers directly, in its own frame - what the properties panel's boxes do. */
export function setShapeNumbers(
  figure: Figure,
  id: string,
  numbers: { position?: Vec3; rotation?: Vec3; size?: Vec3 },
): Figure {
  return replaceShape(figure, id, (shape) => ({
    ...shape,
    position: numbers.position === undefined ? shape.position : clampPosition(numbers.position),
    rotation: numbers.rotation === undefined ? shape.rotation : cloneVec3(numbers.rotation),
    size: numbers.size === undefined ? shape.size : clampSize(numbers.size),
  }));
}

export function setShapeKind(figure: Figure, id: string, kind: MassShapeId): Figure {
  return replaceShape(figure, id, (shape) => ({ ...shape, kind }));
}

export function setShapeColour(figure: Figure, id: string, colour: string | null): Figure {
  if (!isMassDye(colour)) return figure;
  return replaceShape(figure, id, (shape) => ({ ...shape, colour }));
}

export function setShapeHidden(figure: Figure, id: string, hidden: boolean): Figure {
  return replaceShape(figure, id, (shape) => ({ ...shape, hidden }));
}

/** Rename. Blank names are refused rather than saved, so every row in the list can be told apart. */
export function renameShape(figure: Figure, id: string, name: string): Figure {
  const clean = name.trim().toUpperCase().slice(0, MAX_NAME_LENGTH);
  if (clean.length === 0) return figure;
  return replaceShape(figure, id, (shape) => ({ ...shape, name: clean }));
}

export function removeShape(figure: Figure, id: string): Figure {
  const shapes = figure.shapes.filter((shape) => shape.id !== id);
  return shapes.length === figure.shapes.length ? figure : { ...figure, shapes };
}

/** Move a shape one place up (-1) or down (+1) the list. */
export function reorderShape(figure: Figure, id: string, step: -1 | 1): Figure {
  const index = figure.shapes.findIndex((shape) => shape.id === id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= figure.shapes.length) return figure;

  const shapes = [...figure.shapes];
  [shapes[index], shapes[target]] = [shapes[target], shapes[index]];

  return { ...figure, shapes };
}

/** A fresh id that no shape on this figure already has. */
export function nextShapeId(figure: Figure): string {
  const taken = new Set(figure.shapes.map((shape) => shape.id));
  let index = figure.shapes.length + 1;
  while (taken.has(`s${index}`)) index += 1;
  return `s${index}`;
}

/** "SPHERE 3": the kind's label and the first number not already used by a shape of that name. */
export function nextShapeName(figure: Figure, kind: MassShapeId): string {
  const taken = new Set(figure.shapes.map((shape) => shape.name));
  const label = MASS_SHAPES[kind].label;
  let index = 1;
  while (taken.has(`${label} ${index}`)) index += 1;
  return `${label} ${index}`;
}

/** The default size a new shape arrives at: visible at the views' zoom, small enough to be a part, not a body. */
export const NEW_SHAPE_SIZE: Vec3 = { x: 0.24, y: 0.24, z: 0.24 };

/**
 * Add a shape at a world point, pinned to `pin` (or unpinned with `null`), at the default size and square to the
 * world. Returns the figure and the new shape's id, so the caller can select it. Refused past `MAX_SHAPES`.
 */
export function addShape(
  figure: Figure,
  input: { kind: MassShapeId; at: Vec3; pin: string | null },
): { figure: Figure; id: string | null } {
  if (figure.shapes.length >= MAX_SHAPES) return { figure, id: null };

  const id = nextShapeId(figure);
  const unpinned: Shape = {
    id,
    name: nextShapeName(figure, input.kind),
    kind: input.kind,
    colour: null,
    hidden: false,
    pin: null,
    position: clampPosition(input.at),
    rotation: { x: 0, y: 0, z: 0 },
    size: cloneVec3(NEW_SHAPE_SIZE),
  };

  const withShape: Figure = { ...figure, shapes: [unpinned, ...figure.shapes] };
  const pin = input.pin !== null && figure.skeleton.joints[input.pin] !== undefined ? input.pin : null;

  return { figure: pin === null ? withShape : pinShape(withShape, id, pin), id };
}

/** A copy of a shape, nudged sideways so it does not hide exactly behind the original, and put above it in the list. */
export function duplicateShape(figure: Figure, id: string): { figure: Figure; id: string | null } {
  const original = findShape(figure, id);
  if (original === undefined || figure.shapes.length >= MAX_SHAPES) return { figure, id: null };

  const copyId = nextShapeId(figure);
  const copy: Shape = {
    ...original,
    id: copyId,
    name: `${original.name.slice(0, MAX_NAME_LENGTH - 2)} +`,
    position: cloneVec3(original.position),
    rotation: cloneVec3(original.rotation),
    size: cloneVec3(original.size),
  };
  const index = figure.shapes.indexOf(original);
  const shapes = [...figure.shapes.slice(0, index), copy, ...figure.shapes.slice(index)];
  const placed = placementOf(figure, original);

  return {
    figure: placeShape({ ...figure, shapes }, copyId, {
      ...placed,
      position: addVec3(placed.position, { x: 0.12, y: 0, z: 0 }),
    }),
    id: copyId,
  };
}

/**
 * The figure with a new skeleton, and every shape re-expressed in the new skeleton's frames so that it stays exactly
 * where it was. A shape whose node is gone is unpinned where it stands.
 *
 * Adding or removing a node can change a node's frame (a node's bone points at its *first* child), and on a posed
 * figure that would swing the shapes pinned to it. Re-expressing them keeps every edit to the skeleton from moving a
 * shape - the same promise pinning makes.
 */
function keepShapesInPlace(before: Figure, skeleton: Skeleton): Figure {
  const framesBefore = jointFrames(before.skeleton);
  const after: Figure = { ...before, skeleton };
  const shapes = before.shapes.map((shape) => {
    const world = placementOf(before, shape, framesBefore);
    const pin = shape.pin !== null && skeleton.joints[shape.pin] !== undefined ? shape.pin : null;
    return { ...shape, pin, ...localFor(after, pin, world) };
  });
  return { skeleton, shapes };
}

/** "node-4": the first free id from the node count up, so it reads as a number on screen ("NODE 4"). */
export function nextNodeId(figure: Figure): string {
  let index = Object.keys(figure.skeleton.joints).length + 1;
  while (figure.skeleton.joints[`node-${index}`] !== undefined) index += 1;
  return `node-${index}`;
}

/**
 * Add a node under `parentId` at a world point (or move the node `id`, if this figure was built without it, to there).
 *
 * Its rest is set so its bone starts unturned: posing measures from here. Refused past `MAX_NODES` or for an unknown
 * parent.
 */
export function addNode(figure: Figure, parentId: string, at: Vec3, id?: string): { figure: Figure; id: string | null } {
  const count = Object.keys(figure.skeleton.joints).length;
  const frames = jointFrames(figure.skeleton);
  const parent = frames[parentId];
  if (parent === undefined || count >= MAX_NODES) return { figure, id: null };

  const nodeId = id ?? nextNodeId(figure);
  if (figure.skeleton.joints[nodeId] !== undefined) return { figure, id: null };
  const position = clampPosition(subtractVec3(at, parent.position));
  const skeleton: Skeleton = {
    ...figure.skeleton,
    joints: {
      ...figure.skeleton.joints,
      // The rest is the position seen from the parent's own turn, so the parent's frame does not move.
      [nodeId]: { id: nodeId, parentId, position, rest: rotateVec(quatInvert(parent.rotation), position) },
    },
  };

  return { figure: keepShapesInPlace(figure, skeleton), id: nodeId };
}

/** The nodes removing `id` takes with it: itself and everything below it. The root cannot go. */
export function nodesRemovedWith(figure: Figure, id: string): string[] {
  if (figure.skeleton.joints[id] === undefined || id === figure.skeleton.rootId) return [];
  return [id, ...descendantsOf(figure.skeleton, id)];
}

/** The shapes pinned to a node that removing `id` would take away: they are unpinned, where they stand. */
export function shapesLosingNode(figure: Figure, id: string): Shape[] {
  const doomed = new Set(nodesRemovedWith(figure, id));
  return figure.shapes.filter((shape) => shape.pin !== null && doomed.has(shape.pin));
}

/** Remove a node and every node below it. Shapes pinned to them stay where they are, unpinned. */
export function removeNode(figure: Figure, id: string): Figure {
  const doomed = new Set(nodesRemovedWith(figure, id));
  if (doomed.size === 0) return figure;
  const joints = Object.fromEntries(Object.entries(figure.skeleton.joints).filter(([jointId]) => !doomed.has(jointId)));
  return keepShapesInPlace(figure, { ...figure.skeleton, joints });
}

/** The figure as one string, for "is this the one that was kept?" - the same form the shelf stores. */
export function fingerprint(figure: Figure): string {
  return JSON.stringify(figure);
}

function readVec(value: unknown): Vec3 | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return null;
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * A figure read back from somewhere untrusted (browser storage), or `null` if it is not one.
 *
 * Joints that are damaged are dropped; shapes that are damaged are dropped; a shape pinned to a joint that no longer
 * exists is kept and unpinned rather than lost. Sizes and positions are clamped into range. What comes out is
 * always something the renderer can draw.
 */
export function readFigure(value: unknown): Figure | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const rawSkeleton = raw.skeleton as Record<string, unknown> | null | undefined;
  if (typeof rawSkeleton !== 'object' || rawSkeleton === null) return null;
  if (typeof rawSkeleton.rootId !== 'string') return null;
  if (typeof rawSkeleton.joints !== 'object' || rawSkeleton.joints === null) return null;

  const joints: Skeleton['joints'] = {};
  for (const [id, entry] of Object.entries(rawSkeleton.joints as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const joint = entry as Record<string, unknown>;
    const position = readVec(joint.position);
    const rest = readVec(joint.rest);
    if (joint.id !== id || position === null || rest === null) continue;
    if (joint.parentId !== null && typeof joint.parentId !== 'string') continue;
    joints[id] = { id, parentId: joint.parentId as string | null, position, rest };
  }
  if (joints[rawSkeleton.rootId] === undefined) return null;
  // More nodes than a figure may have: not one this workbench made, so it is dropped rather than trimmed.
  if (Object.keys(joints).length > MAX_NODES) return null;

  const shapes: Shape[] = [];
  const seenIds = new Set<string>();
  for (const entry of Array.isArray(raw.shapes) ? raw.shapes.slice(0, MAX_SHAPES) : []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const shape = entry as Record<string, unknown>;
    const position = readVec(shape.position);
    const rotation = readVec(shape.rotation);
    const size = readVec(shape.size);
    if (typeof shape.id !== 'string' || seenIds.has(shape.id)) continue;
    if (typeof shape.kind !== 'string' || !isMassShapeId(shape.kind)) continue;
    if (position === null || rotation === null || size === null) continue;
    seenIds.add(shape.id);

    const name = typeof shape.name === 'string' ? shape.name.trim().toUpperCase().slice(0, MAX_NAME_LENGTH) : '';
    const colour = typeof shape.colour === 'string' && isMassDye(shape.colour) ? shape.colour : null;
    const pin = typeof shape.pin === 'string' && joints[shape.pin] !== undefined ? shape.pin : null;

    shapes.push({
      id: shape.id,
      name: name.length > 0 ? name : MASS_SHAPES[shape.kind].label,
      kind: shape.kind,
      colour,
      hidden: shape.hidden === true,
      pin,
      position: clampPosition(position),
      rotation,
      size: clampSize(size),
    });
  }

  return { skeleton: { joints, rootId: rawSkeleton.rootId }, shapes };
}
