/**
 * ADD's ring: where a new shape may go once its node is picked.
 *
 * **The ring is sized from the node's own shapes.** Its radius reaches just past the farthest outline already pinned
 * to the node, plus half a new shape, so a big torso node gets a big ring and a bare hand node a small one - never
 * smaller than one new shape across (`RING_MIN`). The same radius is drawn in both views.
 *
 * **The shape follows the pointer in the view it is over, held inside the ring.** Only the two directions that view
 * can see change (as for every drag, see `drag.ts`); the hidden one keeps what it had, trimmed only so the shape's
 * centre stays within the radius of the node (so it is inside the ring in the other view too). A point outside the
 * ring puts the shape on the ring's edge, nearest the pointer.
 *
 * Pure arithmetic over plain data, so a check can drive all of it in Node.
 */
import { NEW_SHAPE_SIZE, placementOf, placeShape, findShape, type Figure } from './figure';
import { VIEW_BASIS, type ViewportKind } from './drag';
import { jointFrames, type Vec3 } from './skeleton';
import { structureOf } from './structure';
import { solidSupport } from './touch';

/** The smallest ring: one new shape across. */
export const RING_MIN = NEW_SHAPE_SIZE.x;

/** Directions an outline's reach is sampled along: the 26 neighbours of a cube's centre. */
const DIRECTIONS: Vec3[] = [];
for (const x of [-1, 0, 1]) {
  for (const y of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      const length = Math.hypot(x, y, z);
      if (length > 0) DIRECTIONS.push({ x: x / length, y: y / length, z: z / length });
    }
  }
}

/** The ring's radius round a node, in model units. `skip` is a shape left out (the one being placed). */
export function ringRadius(figure: Figure, nodeId: string, skip: string | null = null): number {
  const node = jointFrames(figure.skeleton)[nodeId]?.position;
  if (node === undefined) return RING_MIN;
  const { solids } = structureOf(figure);
  let reach = 0;
  for (const shape of figure.shapes) {
    if (shape.id === skip || shape.pin !== nodeId || solids[shape.id] === undefined) continue;
    for (const d of DIRECTIONS) {
      const p = solidSupport(solids[shape.id], d);
      reach = Math.max(reach, Math.hypot(p.x - node.x, p.y - node.y, p.z - node.z));
    }
  }
  return Math.max(RING_MIN, reach + NEW_SHAPE_SIZE.x / 2);
}

/** A point's offset from the node in the view's screen directions (right, up), in model units. */
function inPlane(view: ViewportKind, point: Vec3, node: Vec3): { right: number; up: number } {
  const { right, up } = VIEW_BASIS[view];
  const d = { x: point.x - node.x, y: point.y - node.y, z: point.z - node.z };
  return { right: d.x * right.x + d.y * right.y + d.z * right.z, up: d.x * up.x + d.y * up.y + d.z * up.z };
}

/** Whether a point (seen in this view) lands inside the ring. A hair of slack, so a click on the line counts. */
export function insideRing(view: ViewportKind, point: Vec3, node: Vec3, radius: number): boolean {
  const { right, up } = inPlane(view, point, node);
  return Math.hypot(right, up) <= radius * 1.001;
}

/**
 * The figure with the shape moved to follow `point` in this view, held inside the ring round `nodeId`. The shape's
 * centre goes under the pointer; its depth in the view (the direction the view cannot see) is kept.
 */
export function followTo(
  figure: Figure,
  shapeId: string,
  nodeId: string,
  radius: number,
  view: ViewportKind,
  point: Vec3,
): Figure {
  const shape = findShape(figure, shapeId);
  const node = jointFrames(figure.skeleton)[nodeId]?.position;
  if (shape === undefined || node === undefined) return figure;

  let { right, up } = inPlane(view, point, node);
  const distance = Math.hypot(right, up);
  if (distance > radius) {
    right = (right / distance) * radius;
    up = (up / distance) * radius;
  }

  const current = placementOf(figure, shape);
  const basis = VIEW_BASIS[view];
  // The hidden direction is kept, but never so far that the shape would sit outside the ring in the other view.
  const room = Math.sqrt(Math.max(0, radius * radius - right * right - up * up));
  const depth = Math.max(-room, Math.min(room, inPlaneDepth(view, current.position, node)));
  const position = {
    x: node.x + basis.right.x * right + basis.up.x * up + basis.toward.x * depth,
    y: node.y + basis.right.y * right + basis.up.y * up + basis.toward.y * depth,
    z: node.z + basis.right.z * right + basis.up.z * up + basis.toward.z * depth,
  };
  return placeShape(figure, shapeId, { ...current, position });
}

/** How far a point sits from the node along the view's `toward` axis: the part a drag in that view keeps. */
function inPlaneDepth(view: ViewportKind, point: Vec3, node: Vec3): number {
  const { toward } = VIEW_BASIS[view];
  return (point.x - node.x) * toward.x + (point.y - node.y) * toward.y + (point.z - node.z) * toward.z;
}

/**
 * Where a new shape starts: on the ring, pointing away from the figure's root (outward from the body), seen from the
 * front - so it never starts buried in the node's own shapes. Straight right when the node is the root itself.
 */
export function ringStart(figure: Figure, nodeId: string, radius: number): Vec3 | null {
  const frames = jointFrames(figure.skeleton);
  const node = frames[nodeId]?.position;
  if (node === undefined) return null;
  const root = Object.values(figure.skeleton.joints).find((joint) => joint.parentId === null);
  const from = root === undefined ? undefined : frames[root.id]?.position;
  let dx = from === undefined ? 0 : node.x - from.x;
  let dy = from === undefined ? 0 : node.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= length;
    dy /= length;
  }
  return { x: node.x + dx * radius, y: node.y + dy * radius, z: node.z };
}
