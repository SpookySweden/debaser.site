/**
 * Reading line art: which pixels are line, where the small gaps are, and which pixels belong together as one area. Written from the published
 * idea (Fourey, Tschumperlé and Revoy, "A Fast and Efficient Semi-guided Algorithm for Flat Coloring Line-arts"), not from GIMP's GPL code:
 * make a line mask, find line ends, join ends close to each other (or to a line they point at), then label what's left.
 *
 * Pure typed-array code with no DOM, so it runs in a worker and `Temp/check-animate-regions.cjs` can prove it on drawn shapes.
 */

/** Alpha at or above this is line; softer edge pixels count as open, so colour runs under them. */
export const LINE_ALPHA = 64;
/** An open area smaller than this is a speck in the line (a pencil's grain), not an area to colour. */
export const MIN_REGION_AREA = 12;

export type Segment = [number, number, number, number];

export type RegionMap = {
  width: number;
  height: number;
  /**
   * Which region each pixel belongs to, from 1. Every pixel has one: a line pixel takes the nearest region's number, so the two regions
   * either side of a line meet at its middle. That split is what "tuck under, up to half the line's width" comes to.
   */
  labels: Int32Array;
  /** 1 where the pixel is line (or a closure). */
  isLine: Uint8Array;
  count: number;
  /** Per region from 1: minX, minY, maxX, maxY of its pixels, line included. Four numbers each; entry 0 is unused. */
  boxes: Int32Array;
  /** The invisible joins that closed gaps, for the helper lines. */
  closures: Segment[];
};

export function lineMaskFromAlpha(rgba: Uint8ClampedArray, width: number, height: number, into?: Uint8Array): Uint8Array {
  const mask = into ?? new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    if (rgba[i * 4 + 3] >= LINE_ALPHA) mask[i] = 1;
  }
  return mask;
}

/** Thin a line mask to one-pixel lines (Zhang-Suen), working only on line pixels. */
export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
  const s = new Uint8Array(mask);
  let active: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (s[i] !== 0) active.push(i);
    }
  }
  // Past this many passes only big solid shapes are left being eaten, and they have no line ends worth finding.
  const MAX_PASSES = 48;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false;
    for (let step = 0; step < 2; step += 1) {
      const gone: number[] = [];
      for (const i of active) {
        if (s[i] === 0) continue;
        const p2 = s[i - width];
        const p3 = s[i - width + 1];
        const p4 = s[i + 1];
        const p5 = s[i + width + 1];
        const p6 = s[i + width];
        const p7 = s[i + width - 1];
        const p8 = s[i - 1];
        const p9 = s[i - width - 1];
        const count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (count < 2 || count > 6) continue;
        const crossings =
          (p2 === 0 && p3 === 1 ? 1 : 0) +
          (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) +
          (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) +
          (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) +
          (p9 === 0 && p2 === 1 ? 1 : 0);
        if (crossings !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        gone.push(i);
      }
      if (gone.length > 0) changed = true;
      for (const i of gone) s[i] = 0;
    }
    if (!changed) break;
    active = active.filter((i) => s[i] !== 0);
  }
  // A border pixel was never thinned; drop it so a line running off the sheet doesn't count as an end.
  for (let x = 0; x < width; x += 1) {
    s[x] = 0;
    s[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y += 1) {
    s[y * width] = 0;
    s[y * width + width - 1] = 0;
  }
  return s;
}

export type LineEnd = {
  x: number;
  y: number;
  /** Which way the line was heading as it ended: a unit vector. */
  dx: number;
  dy: number;
  /** About how far the line's edge is from its middle here. */
  halfWidth: number;
};

const NEIGHBOURS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function skeletonNeighbours(s: Uint8Array, width: number, i: number): number[] {
  const out: number[] = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const n = i + dy * width + dx;
    if (s[n] !== 0) out.push(n);
  }
  return out;
}

/** How far from this pixel to the nearest open pixel, looking in eight directions (capped). */
function halfWidthAt(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  let best = 32;
  for (const [dx, dy] of NEIGHBOURS) {
    for (let r = 1; r < best; r += 1) {
      const nx = x + dx * r;
      const ny = y + dy * r;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) {
        best = r;
        break;
      }
    }
  }
  return best;
}

const TANGENT_STEPS = 10;

/** The real ends of lines: skeleton pixels with one neighbour, leaving out the short spurs thinning leaves on a thick or bumpy line. */
export function findLineEnds(skeleton: Uint8Array, mask: Uint8Array, width: number, height: number): LineEnd[] {
  const ends: LineEnd[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const start = y * width + x;
      if (skeleton[start] === 0) continue;
      const first = skeletonNeighbours(skeleton, width, start);
      if (first.length !== 1) continue;

      const halfWidth = halfWidthAt(mask, width, height, x, y);
      // Walk back along the line for its direction, stopping at a junction.
      let previous = start;
      let at = first[0];
      let steps = 1;
      let hitJunction = false;
      while (steps < TANGENT_STEPS) {
        const next = skeletonNeighbours(skeleton, width, at).filter((n) => n !== previous && !isAdjacent(n, previous, width));
        if (next.length !== 1) {
          hitJunction = next.length > 1;
          break;
        }
        previous = at;
        at = next[0];
        steps += 1;
      }
      // A spur: it reaches a junction before it has gone further than the line is wide.
      if (hitJunction && steps <= halfWidth * 1.5 + 2) continue;
      if (steps < 2 && halfWidth <= 1) continue;
      const bx = at % width;
      const by = Math.floor(at / width);
      const length = Math.hypot(x - bx, y - by) || 1;
      ends.push({ x, y, dx: (x - bx) / length, dy: (y - by) / length, halfWidth });
    }
  }
  return ends;
}

function isAdjacent(a: number, b: number, width: number): boolean {
  const ax = a % width;
  const bx = b % width;
  const ay = Math.floor(a / width);
  const by = Math.floor(b / width);
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
}

/** The first line pixel along a ray from just past the line's tip, within the gap size; null if there's none. */
function castRay(mask: Uint8Array, width: number, height: number, end: LineEnd, dx: number, dy: number, maxGap: number): [number, number, number] | null {
  // Out of the line's own body first.
  let t = 1;
  const limit = end.halfWidth * 2 + 2;
  while (t <= limit) {
    const px = Math.round(end.x + dx * t);
    const py = Math.round(end.y + dy * t);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    if (mask[py * width + px] === 0) break;
    t += 1;
  }
  if (t > limit) return null;
  const startOfGap = t;
  while (t - startOfGap <= maxGap + 1) {
    const px = Math.round(end.x + dx * t);
    const py = Math.round(end.y + dy * t);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    if (mask[py * width + px] !== 0) return [px, py, t - startOfGap];
    t += 1;
  }
  return null;
}

const FAN = [0, 15, -15, 30, -30].map((deg) => (deg * Math.PI) / 180);

/**
 * Which gaps to close. First, line ends that face each other across a gap of `maxGap` or less, closest pairs first. Then, any end left over,
 * if it points at a line within the gap size (a T that doesn't quite touch).
 */
export function findClosures(mask: Uint8Array, skeleton: Uint8Array, ends: LineEnd[], width: number, height: number, maxGap: number): Segment[] {
  if (maxGap <= 0 || ends.length === 0) return [];
  const closures: Segment[] = [];

  // Pairs, found through a grid so a scratchy drawing with thousands of ends stays quick.
  const reachOf = (a: LineEnd, b: LineEnd) => maxGap + a.halfWidth + b.halfWidth;
  const cell = Math.max(8, maxGap + 16);
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => cy * 100000 + cx;
  ends.forEach((end, i) => {
    const key = cellKey(Math.floor(end.x / cell), Math.floor(end.y / cell));
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [i]);
    else list.push(i);
  });
  const pairs: { a: number; b: number; d: number }[] = [];
  ends.forEach((a, i) => {
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const list = grid.get(cellKey(cx + ox, cy + oy));
        if (list === undefined) continue;
        for (const j of list) {
          if (j <= i) continue;
          const b = ends[j];
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const d = Math.hypot(vx, vy);
          if (d === 0 || d > reachOf(a, b)) continue;
          const gap = d - a.halfWidth - b.halfWidth;
          const facing = (a.dx * vx + a.dy * vy) / d > 0.25 && (-(b.dx * vx + b.dy * vy)) / d > 0.25;
          // Very close ends join whichever way they point; further ones have to be heading for each other.
          if (!facing && gap > maxGap / 2) continue;
          if (sameShortStroke(skeleton, width, a, b, d)) continue;
          pairs.push({ a: i, b: j, d });
        }
      }
    }
  });
  pairs.sort((p, q) => p.d - q.d);
  const used = new Set<number>();
  for (const { a, b } of pairs) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    closures.push([ends[a].x, ends[a].y, ends[b].x, ends[b].y]);
  }

  ends.forEach((end, i) => {
    if (used.has(i)) return;
    let best: [number, number, number] | null = null;
    for (const angle of FAN) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const hit = castRay(mask, width, height, end, end.dx * cos - end.dy * sin, end.dx * sin + end.dy * cos, maxGap);
      if (hit !== null && (best === null || hit[2] < best[2])) best = hit;
    }
    if (best !== null) closures.push([end.x, end.y, best[0], best[1]]);
  });
  return closures;
}

/** Are these two ends the two ends of one short dash? Then a join would only run along itself. */
function sameShortStroke(skeleton: Uint8Array, width: number, a: LineEnd, b: LineEnd, distance: number): boolean {
  const target = b.y * width + b.x;
  let previous = a.y * width + a.x;
  let at = skeletonNeighbours(skeleton, width, previous)[0];
  const limit = Math.ceil(distance * 1.5) + 4;
  for (let steps = 0; at !== undefined && steps < limit; steps += 1) {
    if (at === target) return true;
    const next = skeletonNeighbours(skeleton, width, at).filter((n) => n !== previous && !isAdjacent(n, previous, width));
    if (next.length !== 1) return false;
    previous = at;
    at = next[0];
  }
  return false;
}

/** Draw a one-pixel line (8-connected, which a 4-connected fill can't pass) into the mask. */
export function drawClosure(mask: Uint8Array, width: number, [x0, y0, x1, y1]: Segment): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    mask[y * width + x] = 1;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Number every open area (4-connected, so a diagonal line holds). Specks are left unnumbered, to be taken in with the line. */
export function labelRegions(mask: Uint8Array, width: number, height: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  let count = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (mask[start] !== 0 || labels[start] !== 0) continue;
    count += 1;
    let top = 0;
    let area = 0;
    stack[top] = start;
    top += 1;
    labels[start] = count;
    const first = start;
    while (top > 0) {
      top -= 1;
      const i = stack[top];
      area += 1;
      const x = i % width;
      if (x > 0 && mask[i - 1] === 0 && labels[i - 1] === 0) {
        labels[i - 1] = count;
        stack[top] = i - 1;
        top += 1;
      }
      if (x < width - 1 && mask[i + 1] === 0 && labels[i + 1] === 0) {
        labels[i + 1] = count;
        stack[top] = i + 1;
        top += 1;
      }
      if (i >= width && mask[i - width] === 0 && labels[i - width] === 0) {
        labels[i - width] = count;
        stack[top] = i - width;
        top += 1;
      }
      if (i < labels.length - width && mask[i + width] === 0 && labels[i + width] === 0) {
        labels[i + width] = count;
        stack[top] = i + width;
        top += 1;
      }
    }
    if (area < MIN_REGION_AREA) {
      // A speck: unnumber it, marked -1 so the scan doesn't start here again, and reuse the number.
      top = 0;
      stack[top] = first;
      top += 1;
      labels[first] = -1;
      while (top > 0) {
        top -= 1;
        const i = stack[top];
        const x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < labels.length - width ? i + width : -1]) {
          if (n >= 0 && labels[n] === count) {
            labels[n] = -1;
            stack[top] = n;
            top += 1;
          }
        }
      }
      count -= 1;
    }
  }
  for (let i = 0; i < labels.length; i += 1) if (labels[i] === -1) labels[i] = 0;
  return { labels, count };
}

/** Everything unnumbered (line, closures, specks) takes the number of the nearest region, spreading out from every region at once. */
export function spreadIntoLine(labels: Int32Array, width: number, height: number): void {
  const total = width * height;
  let frontier = new Int32Array(total);
  let next = new Int32Array(total);
  let size = 0;
  for (let i = 0; i < total; i += 1) {
    if (labels[i] !== 0) continue;
    const x = i % width;
    if ((x > 0 && labels[i - 1] > 0) || (x < width - 1 && labels[i + 1] > 0) || (i >= width && labels[i - width] > 0) || (i < total - width && labels[i + width] > 0)) {
      frontier[size] = i;
      size += 1;
    }
  }
  while (size > 0) {
    // One ring at a time, so both sides of a line reach its middle together.
    const assigned: [number, number][] = [];
    for (let k = 0; k < size; k += 1) {
      const i = frontier[k];
      if (labels[i] !== 0) continue;
      const x = i % width;
      const near = (x > 0 && labels[i - 1] > 0 && labels[i - 1]) || (x < width - 1 && labels[i + 1] > 0 && labels[i + 1]) || (i >= width && labels[i - width] > 0 && labels[i - width]) || (i < total - width && labels[i + width] > 0 && labels[i + width]) || 0;
      if (near !== 0) assigned.push([i, near]);
    }
    for (const [i, value] of assigned) labels[i] = value;
    let count = 0;
    for (const [i] of assigned) {
      const x = i % width;
      if (x > 0 && labels[i - 1] === 0) {
        next[count] = i - 1;
        count += 1;
      }
      if (x < width - 1 && labels[i + 1] === 0) {
        next[count] = i + 1;
        count += 1;
      }
      if (i >= width && labels[i - width] === 0) {
        next[count] = i - width;
        count += 1;
      }
      if (i < total - width && labels[i + width] === 0) {
        next[count] = i + width;
        count += 1;
      }
    }
    const swap = frontier;
    frontier = next;
    next = swap;
    size = count;
    if (assigned.length === 0) break;
  }
}

/** The whole reading: a line mask in, a region map out. */
export function buildRegionMap(mask: Uint8Array, width: number, height: number, maxGap: number): RegionMap {
  const skeleton = skeletonize(mask, width, height);
  const ends = findLineEnds(skeleton, mask, width, height);
  const closures = findClosures(mask, skeleton, ends, width, height, maxGap);
  const closed = new Uint8Array(mask);
  for (const segment of closures) drawClosure(closed, width, segment);

  const { labels, count } = labelRegions(closed, width, height);
  spreadIntoLine(labels, width, height);

  const boxes = new Int32Array((count + 1) * 4);
  for (let r = 1; r <= count; r += 1) {
    boxes[r * 4] = width;
    boxes[r * 4 + 1] = height;
    boxes[r * 4 + 2] = -1;
    boxes[r * 4 + 3] = -1;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const r = labels[y * width + x];
      if (r <= 0) continue;
      const at = r * 4;
      if (x < boxes[at]) boxes[at] = x;
      if (y < boxes[at + 1]) boxes[at + 1] = y;
      if (x > boxes[at + 2]) boxes[at + 2] = x;
      if (y > boxes[at + 3]) boxes[at + 3] = y;
    }
  }
  return { width, height, labels, isLine: closed, count, boxes, closures };
}

export type MaskPixels = { x: number; y: number; w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> };

/** One region as pixels for a mask. `tuck` takes it under the lines; without, it stops at their edge. */
export function regionMaskPixels(map: RegionMap, region: number, tuck: boolean): MaskPixels | null {
  if (region < 1 || region > map.count) return null;
  const x0 = map.boxes[region * 4];
  const y0 = map.boxes[region * 4 + 1];
  const x1 = map.boxes[region * 4 + 2];
  const y1 = map.boxes[region * 4 + 3];
  if (x1 < x0 || y1 < y0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    let i = (y0 + y) * map.width + x0;
    let o = y * w * 4 + 3;
    for (let x = 0; x < w; x += 1) {
      if (map.labels[i] === region && (tuck || map.isLine[i] === 0)) rgba[o] = 255;
      i += 1;
      o += 4;
    }
  }
  return { x: x0, y: y0, w, h, rgba };
}
