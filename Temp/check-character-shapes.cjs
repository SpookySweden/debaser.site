const assert = require('node:assert/strict');
const fs = require('node:fs');

/**
 * The seven shapes must be seven *different*, correctly-oriented solids - measured, not read from source.
 *
 * Steps (inside this block; the runner matches the `npx tsc ` prefix literally):
 *   npx tsc app/lib/character/geometry.ts app/lib/character/shapes.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *
 * **Rewritten for the free-shape workbench, and made stronger in the move.** This check used to read the scene's
 * source for the names of geometry classes in a switch, because the geometry lived inside a component and could not
 * be built without React. It now lives in `app/lib/character/geometry.ts`, so every primitive is *built* here and its
 * vertices measured. A capsule that quietly returned a cone, or a prism lying on its side, now fails on what it is,
 * not on what it is called.
 *
 * What is held:
 *   - every primitive fills exactly a unit box, centred - which is what makes `size` mean width/height/depth for all
 *   - no two primitives are the same solid
 *   - each is the solid it is named for: a sphere is round, a cone points down, a cylinder is evenly thick, a wedge
 *     tapers, a capsule has rounded ends, a prism is a triangle seen from the front running forward
 *   - the ADD tool and the properties panel both offer the whole vocabulary, drawn from the one list
 */
process.removeAllListeners('warning'); // three's "require is deprecated" notice is about this harness, not the site
const { unitGeometry } = require('./character-out/geometry.js');
const { MASS_SHAPE_IDS } = require('./character-out/shapes.js');

const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
/** Three decimals, with -0.000 read as 0.000 - a seam vertex a hair either side of zero is the same corner. */
const f3 = (n) => (Math.round(n * 1000) / 1000 + 0).toFixed(3);
const vertices = (kind) => {
  const position = unitGeometry(kind).attributes.position;
  const out = [];
  for (let i = 0; i < position.count; i += 1) out.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
  return out;
};
const radius = (v) => Math.hypot(v.x, v.z);
const at = (vs, y) => vs.filter((v) => near(v.y, y));
const signature = (vs) => [...new Set(vs.map((v) => `${f3(v.x)},${f3(v.y)},${f3(v.z)}`))].sort().join(';');

const all = {};
for (const kind of MASS_SHAPE_IDS) {
  const geometry = unitGeometry(kind);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(near(min[axis], -0.5) && near(max[axis], 0.5), `${kind} fills the unit box along ${axis} (${min[axis]}..${max[axis]})`);
  }
  all[kind] = vertices(kind);
}

const signatures = new Map();
for (const kind of MASS_SHAPE_IDS) {
  const sig = signature(all[kind]);
  assert.ok(!signatures.has(sig), `${kind} is the same solid as ${signatures.get(sig)}`);
  signatures.set(sig, kind);
}

// Each one is what it says.
// Within 3%: a sphere of flat panels is stretched slightly to fill the box, which no pixel will show.
assert.ok(all.sphere.every((v) => near(Math.hypot(v.x, v.y, v.z), 0.5, 0.015)), 'a sphere is round: every point is half a unit out');
assert.ok(at(all.cone, -0.5).every((v) => radius(v) < 0.01), 'a cone points down: its bottom is a point');
assert.ok(Math.max(...at(all.cone, 0.5).map(radius)) > 0.45, 'and its top is the full width');
const ring = (vs, y) => Math.max(...at(vs, y).map(radius));
assert.ok(near(ring(all.cylinder, 0.5), ring(all.cylinder, -0.5), 1e-3), 'a cylinder is evenly thick');
assert.ok(ring(all.wedge, 0.5) < ring(all.wedge, -0.5) - 0.1, 'a wedge tapers towards the top');
assert.equal(new Set(at(all.wedge, -0.5).filter((v) => radius(v) > 0.1).map((v) => `${f3(v.x)},${f3(v.z)}`)).size, 4, 'on four sides');
assert.ok(all.capsule.some((v) => v.y > 0.3 && v.y < 0.49 && radius(v) > 0.1 && radius(v) < 0.45), 'a capsule rounds off at the ends instead of stopping flat');

// The prism, seen from the front (dropping depth): an apex at the top middle, a flat base, and nothing outside that.
const front = [...new Set(all.prism.map((v) => `${f3(v.x)},${f3(v.y)}`))];
const insideTriangle = all.prism.every((v) => v.y >= -0.5 - 1e-4 && Math.abs(v.x) <= (0.5 - v.y) / 2 + 1e-4);
assert.ok(insideTriangle, `a prism is a triangle from the front - nothing pokes outside it (${front.join(' ')})`);
assert.ok(front.includes('0.000,0.500'), 'apex up, in the middle');
assert.ok(front.includes('-0.500,-0.500') && front.includes('0.500,-0.500'), 'flat along the bottom');
assert.ok(all.prism.some((v) => near(v.z, 0.5)) && all.prism.some((v) => near(v.z, -0.5)), 'and it runs front to back');

// The vocabulary is reachable from both places a shape is chosen.
const viewport = fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8');
assert.equal((viewport.match(/MASS_SHAPE_IDS\.map/g) ?? []).length, 2, 'ADD and the properties panel both list every shape from the one list');
const scene = fs.readFileSync('app/components/CharacterScene.tsx', 'utf8');
assert.match(scene, /const geometry = unitGeometry\(shape\.kind\)/, 'and the scene draws through the measured geometry');
assert.match(scene, /scale=\{\[shape\.size\.x, shape\.size\.y, shape\.size\.z\]\}/, 'scaled straight to the shape`s size');

console.log('character shape-vocabulary checks passed');
console.log(`  built    : ${MASS_SHAPE_IDS.length} primitives, each exactly a unit box, no two alike`);
console.log('  measured : sphere round, cone points down, wedge four-sided taper, prism a triangle from the front');
console.log('  cannot   : see them lit. The browser captures in Temp/browse/char/ do that.');
