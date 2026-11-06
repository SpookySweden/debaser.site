/*
 * ANIMATE's line reading (SPEC-animator.md, the plan's pipeline): drawn shapes in, regions out. Closed shapes hold, small gaps close, big ones don't,
 * colour reaches the middle of a line, specks don't count, and a full sheet is quick enough for a background worker.
 *   npx tsc app/lib/animate/regions-core.ts --rootDir app/lib --outDir Temp/animate-regions-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const R = require('./animate-regions-out/animate/regions-core.js');

const W = 200;
const H = 200;
const blank = () => new Uint8Array(W * H);
const at = (x, y) => y * W + x;

/** A filled disc of line at each point along the way: a pen stroke, of a width. */
function stroke(mask, points, width = 3) {
  const r = width / 2;
  for (let s = 0; s < points.length - 1; s += 1) {
    const [x0, y0] = points[s];
    const [x1, y1] = points[s + 1];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
    for (let t = 0; t <= steps; t += 1) {
      const cx = x0 + ((x1 - x0) * t) / steps;
      const cy = y0 + ((y1 - y0) * t) / steps;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
          if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - cx, y - cy) <= r) mask[at(x, y)] = 1;
        }
      }
    }
  }
  return mask;
}
const square = (mask, x0, y0, x1, y1, width = 3, gap = 0) =>
  stroke(mask, [[x0 + gap, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 0]], width);

const regionAt = (map, x, y) => map.labels[at(x, y)];

// ── An empty sheet is one region ─────────────────────────────────────────────────────────
let map = R.buildRegionMap(blank(), W, H, 8);
assert.equal(map.count, 1, 'nothing drawn: one area');
assert.equal(map.closures.length, 0);

// ── A closed square: inside and outside ──────────────────────────────────────────────────
map = R.buildRegionMap(square(blank(), 50, 50, 150, 150), W, H, 8);
assert.equal(map.count, 2, 'a closed square makes two areas');
assert.notEqual(regionAt(map, 100, 100), regionAt(map, 10, 10), 'inside is not outside');
assert.equal(map.closures.length, 0, 'nothing to close');

// ── A gap: closed when small, left when big ──────────────────────────────────────────────
const gapped = (gap) => stroke(blank(), [[50 + gap, 50], [150, 50], [150, 150], [50, 150], [50, 50]]);
map = R.buildRegionMap(gapped(6), W, H, 8);
assert.equal(map.count, 2, 'a 6 px gap closes at 8 px');
assert.equal(map.closures.length, 1, 'with one join');
const seg = map.closures[0];
assert.ok(Math.abs(seg[1] - 50) < 6 && Math.abs(seg[3] - 50) < 6, `the join runs along the gap (${seg})`);
map = R.buildRegionMap(gapped(6), W, H, 0);
assert.equal(map.count, 1, 'with closing off, it leaks');
map = R.buildRegionMap(gapped(30), W, H, 8);
assert.equal(map.count, 1, 'a 30 px gap stays open at 8 px: a deliberately open line');
assert.equal(map.closures.length, 0);
map = R.buildRegionMap(gapped(30), W, H, 40);
assert.equal(map.count, 2, 'and closes if the gap size is raised');

// ── A T that doesn't quite touch ─────────────────────────────────────────────────────────
const tee = stroke(blank(), [[20, 100], [180, 100]]);
stroke(tee, [[100, 20], [100, 94]]);
stroke(tee, [[20, 20], [180, 20], [180, 100]]);
stroke(tee, [[20, 20], [20, 100]]);
map = R.buildRegionMap(tee, W, H, 8);
assert.ok(map.closures.length >= 1, 'a line pointing at another across a small gap gets joined');
assert.notEqual(regionAt(map, 60, 60), regionAt(map, 140, 60), 'so the two sides are two areas');

// ── A stray dash in the open closes nothing, and doesn't join itself ─────────────────────
map = R.buildRegionMap(stroke(blank(), [[80, 100], [84, 100]], 3), W, H, 8);
assert.equal(map.count, 1, 'a dash encloses nothing');
assert.equal(map.closures.length, 0, 'and joins nothing');

// ── Line pixels belong to their nearest area, split at the middle: the tuck ──────────────
map = R.buildRegionMap(stroke(square(blank(), 50, 50, 150, 150, 11), [[100, 50], [100, 150]], 11), W, H, 8);
assert.equal(map.count, 3, 'two rooms and the outside');
const left = regionAt(map, 70, 100);
const right = regionAt(map, 130, 100);
assert.notEqual(left, right);
// The wall between them is x = 95..105. Colour from each side reaches its middle, and no further.
assert.equal(regionAt(map, 96, 100), left, 'near the left edge of the line: the left room');
assert.equal(regionAt(map, 104, 100), right, 'near the right edge: the right room');
assert.ok(map.isLine[at(100, 100)] === 1, 'and those are line pixels');
const tucked = R.regionMaskPixels(map, left, true);
const plain = R.regionMaskPixels(map, left, false);
const alpha = (m, x, y) => m.rgba[((y - m.y) * m.w + (x - m.x)) * 4 + 3];
assert.equal(alpha(tucked, 96, 100), 255, 'tucked colour runs under the line');
assert.equal(alpha(tucked, 70, 100), 255);
assert.equal(alpha(plain, 96, 100), 0, 'untucked stops at its edge');
assert.equal(alpha(plain, 70, 100), 255);
assert.ok(tucked.x + tucked.w - 1 <= 101, `and never past the middle (reaches ${tucked.x + tucked.w - 1})`);

// ── Pen-down on a line pixel uses the nearest area ───────────────────────────────────────
assert.ok(regionAt(map, 100, 51) > 0, 'every pixel has an area, line or not');
for (let i = 0; i < map.labels.length; i += 1) assert.ok(map.labels[i] > 0, 'no pixel without an area');

// ── Specks (a pencil's grain) aren't areas ───────────────────────────────────────────────
const specked = square(blank(), 50, 50, 150, 150, 9);
specked[at(100, 50)] = 0;
specked[at(101, 50)] = 0;
map = R.buildRegionMap(specked, W, H, 8);
assert.equal(map.count, 2, 'a two-pixel hole in a line is not an area');

// ── Boxes hold each region's pixels ──────────────────────────────────────────────────────
map = R.buildRegionMap(square(blank(), 50, 60, 150, 140), W, H, 8);
const inner = regionAt(map, 100, 100);
const box = map.boxes.slice(inner * 4, inner * 4 + 4);
assert.ok(box[0] >= 49 && box[0] <= 52 && box[2] >= 148 && box[2] <= 151, `box left and right (${box})`);
assert.ok(box[1] >= 59 && box[3] <= 141, `box top and bottom (${box})`);
assert.equal(R.regionMaskPixels(map, 0, true), null, 'no region 0');
assert.equal(R.regionMaskPixels(map, 99, true), null, 'nor one that does not exist');

// ── A plain flood, for a fill with smarts off ────────────────────────────────────────────
const rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 50; y <= 150; y += 1) {
  for (let x = 50; x <= 150; x += 1) {
    if (x === 50 || x === 150 || y === 50 || y === 150) rgba[at(x, y) * 4 + 3] = 255;
  }
}
const flood = R.floodPixels(rgba, W, H, 100, 100);
assert.deepEqual([flood.x, flood.y, flood.w, flood.h], [51, 51, 99, 99], 'a flood stops at pixels');
assert.equal(R.floodPixels(rgba, W, H, -1, 0), null, 'off the sheet is nothing');

// ── Fast enough ──────────────────────────────────────────────────────────────────────────
// A busy drawing on a full sheet, as the worker would get it: hundreds of curves with gaps.
const FW = 1920;
const FH = 1080;
const full = new Uint8Array(FW * FH);
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
for (let c = 0; c < 600; c += 1) {
  const cx = rand() * FW;
  const cy = rand() * FH;
  const radius = 10 + rand() * 80;
  const start = rand() * 6.28;
  for (let t = 0; t < 5.8; t += 0.01) {
    const x = Math.round(cx + Math.cos(start + t) * radius);
    const y = Math.round(cy + Math.sin(start + t) * radius);
    for (let oy = -2; oy <= 2; oy += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        const px = x + ox;
        const py = y + oy;
        if (px >= 0 && py >= 0 && px < FW && py < FH) full[py * FW + px] = 1;
      }
    }
  }
}
const started = Date.now();
const big = R.buildRegionMap(full, FW, FH, 8);
const took = Date.now() - started;
assert.ok(took < 3000, `a busy full sheet reads in under 3 seconds in the background (${took} ms)`);
console.log(`animate regions: all passed (a busy 1920x1080 sheet: ${took} ms, ${big.count} areas, ${big.closures.length} joins)`);
