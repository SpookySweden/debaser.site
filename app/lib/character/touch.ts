/**
 * Which shapes touch, measured on their real outlines.
 *
 * **Every one of the seven primitives is convex**, so "do these two touch?" is "is the gap between them at most
 * `TOUCH_GAP`?", and the gap between two convex solids is what GJK (Gilbert-Johnson-Keerthi) measures exactly. GJK
 * needs only one thing from a shape: its farthest point in a given direction (its *support*). Each primitive's support
 * is a line or two of arithmetic on the unit shape, then scaled, turned and moved like the mesh is - so a sphere beside
 * a box is measured against the box's real faces, not across its empty corner, and a tilted cone is a tilted cone.
 *
 * The supports are the *ideal* shapes (a true sphere, a true cylinder), not the low-poly meshes the views draw. The
 * difference is under 2% of a shape's size, far less than `TOUCH_GAP`, and it keeps this file free of three.js.
 *
 * Also here: where two shapes meet (the pivot a sagging shape tips about) and how many low-res pixels a shape covers
 * in the FRONT view (its weight). Pure arithmetic over plain data, so a check can drive all of it in Node.
 */
import { FIGURE_ROWS, TALLEST_PRESET } from './pixel-render';
import type { MassShapeId } from './shapes';
import type { Vec3 } from './skeleton';
import { quatInvert, rotateVec, type Quat } from './turns';

/** How close two outlines (or a node and an outline) may come and still count as touching, in model units. */
export const TOUCH_GAP = 0.03;

/** A shape where it is drawn: its primitive, centre, turn and full size. */
export type Solid = { kind: MassShapeId; position: Vec3; rotation: Quat; size: Vec3 };

const EPS = 1e-9;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mul = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z });
const sign = (n: number): number => (n < 0 ? -1 : 1);

/** The corners of the two primitives that are polyhedra, in the unit box (see `geometry.ts` for how they are built). */
const WEDGE_CORNERS: readonly Vec3[] = [
  { x: 0, y: 0.5, z: 0.33 },
  { x: 0.33, y: 0.5, z: 0 },
  { x: 0, y: 0.5, z: -0.33 },
  { x: -0.33, y: 0.5, z: 0 },
  { x: 0, y: -0.5, z: 0.5 },
  { x: 0.5, y: -0.5, z: 0 },
  { x: 0, y: -0.5, z: -0.5 },
  { x: -0.5, y: -0.5, z: 0 },
];

const PRISM_CORNERS: readonly Vec3[] = [
  { x: 0, y: 0.5, z: 0.5 },
  { x: 0.5, y: -0.5, z: 0.5 },
  { x: -0.5, y: -0.5, z: 0.5 },
  { x: 0, y: 0.5, z: -0.5 },
  { x: 0.5, y: -0.5, z: -0.5 },
  { x: -0.5, y: -0.5, z: -0.5 },
];

function farthestCorner(corners: readonly Vec3[], d: Vec3): Vec3 {
  let best = corners[0];
  let bestDot = -Infinity;
  for (const corner of corners) {
    const value = dot(corner, d);
    if (value > bestDot) {
      best = corner;
      bestDot = value;
    }
  }
  return best;
}

/** A point on a ring of radius `r` in the xz plane, farthest along `d` (the ring's centre when `d` is straight up or down). */
function ringPoint(d: Vec3, r: number, y: number): Vec3 {
  const across = Math.hypot(d.x, d.z);
  if (across < EPS) return { x: 0, y, z: 0 };
  return { x: (d.x / across) * r, y, z: (d.z / across) * r };
}

/** The farthest point of an ellipsoid with semi-axes `a`, centred on the origin, along `d`. */
function ellipsoidPoint(d: Vec3, a: Vec3): Vec3 {
  const stretched = Math.hypot(a.x * d.x, a.y * d.y, a.z * d.z);
  if (stretched < EPS) return { x: 0, y: 0, z: 0 };
  return { x: (a.x * a.x * d.x) / stretched, y: (a.y * a.y * d.y) / stretched, z: (a.z * a.z * d.z) / stretched };
}

/** Each primitive's farthest point along `d`, for the unit shape (filling the box -0.5..0.5 on every axis). */
export function unitSupport(kind: MassShapeId, d: Vec3): Vec3 {
  switch (kind) {
    case 'box':
      return { x: 0.5 * sign(d.x), y: 0.5 * sign(d.y), z: 0.5 * sign(d.z) };
    case 'sphere':
      return ellipsoidPoint(d, { x: 0.5, y: 0.5, z: 0.5 });
    case 'cylinder':
      return ringPoint(d, 0.5, 0.5 * sign(d.y));
    case 'capsule': {
      // Normalised, a capsule is the segment y -0.25..0.25 swept by an ellipsoid of semi-axes 0.5, 0.25, 0.5.
      const cap = ellipsoidPoint(d, { x: 0.5, y: 0.25, z: 0.5 });
      return { x: cap.x, y: cap.y + 0.25 * sign(d.y), z: cap.z };
    }
    case 'cone': {
      // Point down: the apex at the bottom, the round base at the top.
      const apex = { x: 0, y: -0.5, z: 0 };
      const rim = ringPoint(d, 0.5, 0.5);
      return dot(apex, d) > dot(rim, d) ? apex : rim;
    }
    case 'wedge':
      return farthestCorner(WEDGE_CORNERS, d);
    case 'prism':
      return farthestCorner(PRISM_CORNERS, d);
  }
}

/**
 * Whether a point (in the unit shape's own space) is inside the unit primitive. The same ideal shapes as `unitSupport`.
 */
export function insideUnit(kind: MassShapeId, p: Vec3): boolean {
  if (Math.abs(p.y) > 0.5 + EPS || Math.abs(p.x) > 0.5 + EPS || Math.abs(p.z) > 0.5 + EPS) return false;
  switch (kind) {
    case 'box':
      return true;
    case 'sphere':
      return p.x * p.x + p.y * p.y + p.z * p.z <= 0.25 + EPS;
    case 'cylinder':
      return p.x * p.x + p.z * p.z <= 0.25 + EPS;
    case 'capsule': {
      const beyond = Math.max(0, Math.abs(p.y) - 0.25);
      return p.x * p.x + p.z * p.z + 4 * beyond * beyond <= 0.25 + EPS;
    }
    case 'cone': {
      const r = 0.5 * (p.y + 0.5);
      return p.x * p.x + p.z * p.z <= r * r + EPS;
    }
    case 'wedge':
      return Math.abs(p.x) + Math.abs(p.z) <= 0.415 - 0.17 * p.y + EPS;
    case 'prism':
      return Math.abs(p.x) <= (0.5 - p.y) / 2 + EPS;
  }
}

/** A solid's farthest point along a world direction: the unit support, scaled, turned and moved like the mesh. */
export function solidSupport(solid: Solid, d: Vec3): Vec3 {
  const local = rotateVec(quatInvert(solid.rotation), d);
  const unit = unitSupport(solid.kind, mul(local, solid.size));
  return add(solid.position, rotateVec(solid.rotation, mul(unit, solid.size)));
}

/** A world point in the solid's unit space, or `null` for a solid too thin to have one. */
function toUnit(solid: Solid, point: Vec3): Vec3 | null {
  const local = rotateVec(quatInvert(solid.rotation), sub(point, solid.position));
  if (solid.size.x < EPS || solid.size.y < EPS || solid.size.z < EPS) return null;
  return { x: local.x / solid.size.x, y: local.y / solid.size.y, z: local.z / solid.size.z };
}

export function insideSolid(solid: Solid, point: Vec3): boolean {
  const unit = toUnit(solid, point);
  return unit !== null && insideUnit(solid.kind, unit);
}

type Support = (d: Vec3) => Vec3;
type Corner = { w: Vec3; a: Vec3; b: Vec3 };

/** The point nearest the origin on the hull of up to four corners, and the corners it uses (with their weights). */
function nearestOnSimplex(corners: Corner[]): { point: Vec3; used: Corner[]; weights: number[] } {
  let best: { point: Vec3; used: Corner[]; weights: number[]; length: number } | null = null;
  const count = corners.length;

  for (let mask = 1; mask < 1 << count; mask += 1) {
    const subset = corners.filter((_, index) => (mask & (1 << index)) !== 0);
    const solved = affineNearest(subset.map((corner) => corner.w));
    if (solved === null) continue;
    const length = dot(solved.point, solved.point);
    // Smaller sets win a tie, so a corner the answer does not need is dropped.
    if (best === null || length < best.length - 1e-15 || (length <= best.length + 1e-15 && subset.length < best.used.length)) {
      best = { point: solved.point, used: subset, weights: solved.weights, length };
    }
  }

  // A single corner is always a valid answer, so `best` is set.
  const found = best as { point: Vec3; used: Corner[]; weights: number[] };
  return { point: found.point, used: found.used, weights: found.weights };
}

/**
 * The point of a set's affine hull nearest the origin, if it lies inside the set's own hull (every weight positive);
 * `null` if it falls outside or the set is degenerate.
 */
function affineNearest(points: Vec3[]): { point: Vec3; weights: number[] } | null {
  const p0 = points[0];
  if (points.length === 1) return { point: p0, weights: [1] };

  const edges = points.slice(1).map((p) => sub(p, p0));
  const k = edges.length;
  // Normal equations: for each edge j, sum_i t_i (e_j . e_i) = -(e_j . p0).
  const m = edges.map((ej) => edges.map((ei) => dot(ej, ei)));
  const rhs = edges.map((ej) => -dot(ej, p0));
  const t = solve(m, rhs);
  if (t === null) return null;

  const weights = [1 - t.reduce((sum, value) => sum + value, 0), ...t];
  if (weights.some((weight) => weight <= 1e-12)) return null;

  let point = p0;
  for (let i = 0; i < k; i += 1) point = add(point, scale(edges[i], t[i]));
  return { point, weights };
}

/** Gaussian elimination with partial pivoting, for the up-to-3x3 systems above. `null` when singular. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  const size = Math.max(...matrix.flat().map(Math.abs), 1e-30);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < size * 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];
      for (let c = col; c <= n; c += 1) a[row][c] -= factor * a[col][c];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let value = a[row][n];
    for (let c = row + 1; c < n; c += 1) value -= a[row][c] * x[c];
    x[row] = value / a[row][row];
  }
  return x;
}

/**
 * The distance between two convex sets given by their supports, and the nearest point of each. Zero when they
 * overlap (the nearest points are then only roughly where they meet).
 */
export function convexDistance(supportA: Support, supportB: Support, start: Vec3): { distance: number; a: Vec3; b: Vec3 } {
  const corner = (d: Vec3): Corner => {
    const a = supportA(d);
    const b = supportB(scale(d, -1));
    return { w: sub(a, b), a, b };
  };

  let direction = dot(start, start) > EPS ? start : { x: 1, y: 0, z: 0 };
  let simplex: Corner[] = [corner(scale(direction, -1))];
  let v = simplex[0].w;
  let weights = [1];

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const length = dot(v, v);
    if (length < 1e-18) break;
    const next = corner(scale(v, -1));
    // No new corner gets nearer the origin than the one already found: done.
    if (length - dot(v, next.w) <= 1e-10 * Math.max(1, length)) break;
    if (simplex.some((c) => dot(sub(c.w, next.w), sub(c.w, next.w)) < 1e-20)) break;

    const reduced = nearestOnSimplex([...simplex, next]);
    if (dot(reduced.point, reduced.point) >= length - 1e-15) break;
    simplex = reduced.used;
    weights = reduced.weights;
    v = reduced.point;
    if (simplex.length === 4) {
      v = { x: 0, y: 0, z: 0 };
      break;
    }
    direction = v;
  }

  let a = { x: 0, y: 0, z: 0 };
  let b = { x: 0, y: 0, z: 0 };
  simplex.forEach((c, index) => {
    a = add(a, scale(c.a, weights[index] ?? 0));
    b = add(b, scale(c.b, weights[index] ?? 0));
  });

  return { distance: Math.sqrt(Math.max(0, dot(v, v))), a, b };
}

/** The gap between two solids' outlines (0 when they overlap). */
export function solidGap(one: Solid, two: Solid): number {
  return convexDistance((d) => solidSupport(one, d), (d) => solidSupport(two, d), sub(one.position, two.position)).distance;
}

/** The gap between a point (a node) and a solid's outline (0 when it is inside). */
export function pointGap(point: Vec3, solid: Solid): number {
  return convexDistance(() => point, (d) => solidSupport(solid, d), sub(point, solid.position)).distance;
}

export function solidsTouch(one: Solid, two: Solid): boolean {
  return solidGap(one, two) <= TOUCH_GAP;
}

export function pointTouches(point: Vec3, solid: Solid): boolean {
  return pointGap(point, solid) <= TOUCH_GAP;
}

/** Sample points through the unit box, kept per primitive: the ones inside it. Built once. */
const SAMPLE_STEPS = 7;
const UNIT_SAMPLES = new Map<MassShapeId, Vec3[]>();

function unitSamples(kind: MassShapeId): Vec3[] {
  const cached = UNIT_SAMPLES.get(kind);
  if (cached !== undefined) return cached;
  const points: Vec3[] = [];
  for (let i = 0; i < SAMPLE_STEPS; i += 1) {
    for (let j = 0; j < SAMPLE_STEPS; j += 1) {
      for (let k = 0; k < SAMPLE_STEPS; k += 1) {
        const p = {
          x: (i + 0.5) / SAMPLE_STEPS - 0.5,
          y: (j + 0.5) / SAMPLE_STEPS - 0.5,
          z: (k + 0.5) / SAMPLE_STEPS - 0.5,
        };
        if (insideUnit(kind, p)) points.push(p);
      }
    }
  }
  UNIT_SAMPLES.set(kind, points);
  return points;
}

function worldSamples(solid: Solid): Vec3[] {
  return unitSamples(solid.kind).map((p) => add(solid.position, rotateVec(solid.rotation, mul(p, solid.size))));
}

function centroid(points: Vec3[]): Vec3 {
  return scale(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / points.length);
}

/**
 * Where a shape meets the one it hangs from: the middle of the part of it that is inside the other (or of the other
 * that is inside it), or - when the two only sit within `TOUCH_GAP` of each other - halfway across the gap. This is
 * the pivot a sagging shape tips about.
 */
export function contactPoint(shape: Solid, support: Solid): Vec3 {
  const inside = worldSamples(shape).filter((p) => insideSolid(support, p));
  if (inside.length > 0) return centroid(inside);
  const around = worldSamples(support).filter((p) => insideSolid(shape, p));
  if (around.length > 0) return centroid(around);
  const near = convexDistance((d) => solidSupport(shape, d), (d) => solidSupport(support, d), sub(shape.position, support.position));
  return scale(add(near.a, near.b), 0.5);
}

/** One low-res pixel's side, in model units: the tallest preset spans `FIGURE_ROWS` of them (see `pixel-render.ts`). */
export const BLOCK_UNITS = TALLEST_PRESET / FIGURE_ROWS;

const OUTLINE_STEPS = 48;

/**
 * How many low-res pixels a shape covers in the FRONT view: its outline there, as a polygon traced from its support in
 * 48 directions across the screen, divided by one pixel's area. This is the shape's weight for sag - its size as the
 * render sees it. (The PIXELS stat under the views is counted from the real render instead.)
 */
export function outlinePixels(solid: Solid): number {
  const corners: { x: number; y: number }[] = [];
  for (let step = 0; step < OUTLINE_STEPS; step += 1) {
    const angle = (step / OUTLINE_STEPS) * Math.PI * 2;
    const point = solidSupport(solid, { x: Math.cos(angle), y: Math.sin(angle), z: 0 });
    corners.push({ x: point.x, y: point.y });
  }
  let twice = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const p = corners[i];
    const q = corners[(i + 1) % corners.length];
    twice += p.x * q.y - q.x * p.y;
  }
  return Math.abs(twice) / 2 / (BLOCK_UNITS * BLOCK_UNITS);
}
