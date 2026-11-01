/**
 * The two views, as directions in the world, and what a pointer drag in each one means.
 *
 * **Each view is flat (orthographic), and that is a requirement rather than a preference.** Every drag below turns
 * pixels into model units with one number per view, which is only true when a unit is the same number of pixels
 * everywhere on screen. A perspective camera would make it vary with depth, and a dragged shape would slide away
 * from the pointer.
 *
 * **A view edits only the two directions it can see.** FRONT shows left/right and up/down, so a drag there never
 * changes depth; SIDE shows forward/back and up/down, so it never changes width. That is what makes two flat views a
 * complete editor: anything you cannot do in one, you can do in the other.
 *
 * **Every gesture is computed from the figure as it was when the drag began**, plus the pointer's *total* travel -
 * never by adding up small per-frame steps. Adding steps drifts (a bent elbow creeps off the pointer), and a gesture
 * computed from its start is also exactly one undo step: the start is what UNDO puts back.
 */
import { clampSize, findShape, placeShape, placementOf, type Figure, type Placement } from './figure';
import { bendJoint, stretchJoint, worldPosition, addVec3, type Vec3 } from './skeleton';
import { quatFromAxisAngle, quatInvert, quatMultiply, rotateVec } from './turns';

export type ViewportKind = 'front' | 'side';

/**
 * The view's screen directions, in world terms.
 *
 * FRONT looks along -z: screen right is +x. SIDE looks along +x from the figure's left-of-screen side, so screen
 * right is +z - the figure faces right in that pane, and dragging right moves a shape forward. `toward` points out of
 * the screen at the reader, and is the axis TURN spins about.
 */
export type ViewBasis = { right: Vec3; up: Vec3; toward: Vec3; axes: [keyof Vec3, keyof Vec3] };

export const VIEW_BASIS: Record<ViewportKind, ViewBasis> = {
  front: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, toward: { x: 0, y: 0, z: 1 }, axes: ['x', 'y'] },
  side: { right: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, toward: { x: -1, y: 0, z: 0 }, axes: ['z', 'y'] },
};

/** A pointer's travel in pixels, as a world-space offset in the view's plane. Screen y runs down; world y runs up. */
export function dragOffset(view: ViewportKind, dxPixels: number, dyPixels: number, unitsPerPixel: number): Vec3 {
  const basis = VIEW_BASIS[view];
  if (!Number.isFinite(dxPixels) || !Number.isFinite(dyPixels) || !Number.isFinite(unitsPerPixel)) {
    return { x: 0, y: 0, z: 0 };
  }
  const h = dxPixels * unitsPerPixel;
  const v = -dyPixels * unitsPerPixel;

  return {
    x: basis.right.x * h + basis.up.x * v,
    y: basis.right.y * h + basis.up.y * v,
    z: basis.right.z * h + basis.up.z * v,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** MOVE: slide a shape with the pointer, in the view's plane. */
export function moveGesture(base: Figure, shapeId: string, view: ViewportKind, dx: number, dy: number, upp: number): Figure {
  const shape = findShape(base, shapeId);
  if (shape === undefined) return base;
  const start = placementOf(base, shape);

  return placeShape(base, shapeId, { ...start, position: addVec3(start.position, dragOffset(view, dx, dy, upp)) });
}

/**
 * TURN: spin a shape about the axis pointing out of the view, by the angle the pointer has swept round its centre.
 *
 * `grab` is where the pointer went down, measured from the shape's centre in screen units (right, up). The angle is
 * between that and where the pointer is now, so the shape follows the pointer round like a dial. A grab right on the
 * centre has no angle yet; the turn starts once the pointer has moved off it.
 */
export function turnGesture(
  base: Figure,
  shapeId: string,
  view: ViewportKind,
  grab: { right: number; up: number },
  dx: number,
  dy: number,
  upp: number,
): Figure {
  const shape = findShape(base, shapeId);
  if (shape === undefined) return base;

  const nowRight = grab.right + dx * upp;
  const nowUp = grab.up - dy * upp;
  if (Math.hypot(grab.right, grab.up) < 1e-6 || Math.hypot(nowRight, nowUp) < 1e-6) return base;

  const angle = Math.atan2(nowUp, nowRight) - Math.atan2(grab.up, grab.right);
  const start = placementOf(base, shape);
  const spin = quatFromAxisAngle(VIEW_BASIS[view].toward, angle);

  return placeShape(base, shapeId, { ...start, rotation: quatMultiply(spin, start.rotation) });
}

/**
 * Which of a shape's own axes (0 = width, 1 = height, 2 = depth) lines up best with a world direction, given how the
 * shape is turned. SIZE uses it so dragging sideways always widens what *looks* like the width, however the shape is
 * turned.
 */
export function shapeAxisAlong(base: Figure, shapeId: string, direction: Vec3): 'x' | 'y' | 'z' {
  const shape = findShape(base, shapeId);
  if (shape === undefined) return 'x';
  const local = rotateVec(quatInvert(placementOf(base, shape).rotation), direction);
  const ax = Math.abs(local.x);
  const ay = Math.abs(local.y);
  const az = Math.abs(local.z);
  if (ax >= ay && ax >= az) return 'x';
  return ay >= az ? 'y' : 'z';
}

/**
 * SIZE: grow or shrink a shape, about its centre.
 *
 * `handle` says which way each screen direction grows: `{h: 1, v: 0}` is the right-hand edge handle (drag right to
 * widen), `{h: -1, v: 1}` the top-left corner. Dragging a shape's body with the SIZE tool is `{h: 1, v: 1}`: right
 * widens, up heightens. The shape grows on both sides at once, so it stays centred on whatever it is pinned to.
 */
export function sizeGesture(
  base: Figure,
  shapeId: string,
  view: ViewportKind,
  handle: { h: -1 | 0 | 1; v: -1 | 0 | 1 },
  dx: number,
  dy: number,
  upp: number,
): Figure {
  const shape = findShape(base, shapeId);
  if (shape === undefined) return base;

  const basis = VIEW_BASIS[view];
  const size = { ...shape.size };
  const growRight = handle.h * dx * upp * 2;
  const growUp = handle.v * -dy * upp * 2;

  if (handle.h !== 0) size[shapeAxisAlong(base, shapeId, basis.right)] += growRight;
  if (handle.v !== 0) size[shapeAxisAlong(base, shapeId, basis.up)] += growUp;

  return { ...base, shapes: base.shapes.map((s) => (s.id === shapeId ? { ...s, size: clampSize(size) } : s)) };
}

/**
 * POSE: drag a joint. By default it bends - the joint swings round its parent, the bone keeps its length, and the
 * limb below comes with it. With `stretch` it moves freely and the bone changes length. The root (the hips) has
 * nothing to swing round, so dragging it always moves the whole figure.
 */
export function poseGesture(
  base: Figure,
  jointId: string,
  view: ViewportKind,
  dx: number,
  dy: number,
  upp: number,
  stretch: boolean,
): Figure {
  const joint = base.skeleton.joints[jointId];
  if (joint === undefined) return base;

  const target = addVec3(worldPosition(base.skeleton, jointId), dragOffset(view, dx, dy, upp));
  const skeleton =
    stretch || joint.parentId === null
      ? stretchJoint(base.skeleton, jointId, target)
      : bendJoint(base.skeleton, jointId, target);

  return skeleton === base.skeleton ? base : { ...base, skeleton };
}

/**
 * Where a shape's handles go in a view: its centre, and its half-width and half-height as the view sees them. Pass
 * `drawn` to measure the shape where it is drawn (tipped by sag) rather than where it is built.
 */
export function screenBox(
  base: Figure,
  shapeId: string,
  view: ViewportKind,
  drawn?: Placement,
): { centre: Vec3; halfRight: number; halfUp: number } | null {
  const shape = findShape(base, shapeId);
  if (shape === undefined) return null;
  const placement = drawn ?? placementOf(base, shape);
  const basis = VIEW_BASIS[view];
  const axes: Vec3[] = [
    rotateVec(placement.rotation, { x: shape.size.x / 2, y: 0, z: 0 }),
    rotateVec(placement.rotation, { x: 0, y: shape.size.y / 2, z: 0 }),
    rotateVec(placement.rotation, { x: 0, y: 0, z: shape.size.z / 2 }),
  ];

  return {
    centre: placement.position,
    halfRight: axes.reduce((sum, axis) => sum + Math.abs(dot(axis, basis.right)), 0),
    halfUp: axes.reduce((sum, axis) => sum + Math.abs(dot(axis, basis.up)), 0),
  };
}
