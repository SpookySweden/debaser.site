/**
 * Is each view framed so the whole figure fits, centred - and does a drag agree with the camera?
 *
 * **Rewritten for the canvas-window workbench.** The rules are the ones this check always held; what changed is how
 * the views are built. The zoom is no longer one constant: it is fitted to the pane (`Fitted` in the scene), and the
 * same number is handed to every drag as `upp`, units per pixel. So "zoom and the drag constant are one fact" is now
 * "the drag is handed `1 / zoom`", and "the figure fits" is checked at the real pane sizes, desktop and phone.
 *
 * **One new rule, from a bug the old check could not see:** each view's drag directions must match where its camera
 * actually looks. The old SIDE camera sat at +x, where screen-right is world -z, while its drag sent screen-right to
 * +z - so dragging right moved a joint left. Here the camera's right-hand direction is computed from its declared
 * position and rotation and compared with the drag's.
 *
 * The figures are measured, not assumed: every shape of every starting figure is placed and its silhouette taken from
 * the same `screenBox` the transform handles use.
 *
 * Steps:
 *   npx tsc app/lib/character/drag.ts app/lib/character/rig.ts app/lib/character/figure.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { VIEW_BASIS, screenBox } = require('./character-out/drag.js');
const { buildDefaultFigure, RIG_PRESET_IDS } = require('./character-out/rig.js');

const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scene = strip(fs.readFileSync('app/components/CharacterScene.tsx', 'utf8'));
const viewport = strip(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'));

const constant = (name) => {
  const value = Number(scene.match(new RegExp(`const ${name} = (-?[\\d.]+);`))?.[1]);
  assert.ok(Number.isFinite(value), `the scene declares ${name}`);
  return value;
};
const VIEW_HEIGHT = constant('VIEW_HEIGHT');
const VIEW_WIDTH = constant('VIEW_WIDTH');
const FIGURE_CENTRE_Y = constant('FIGURE_CENTRE_Y');

/*
 * 1. One zoom, fitted to the pane, and the drag is handed its reciprocal.
 *
 * **Updated for simple figures (SPEC-simple-figures.md):** the fit is now one function, `fitZoom`, because the ✓ / ✗ of
 * a placement are drawn over the view in HTML and must land where the camera puts the shape. The rule is the same -
 * one formula - and is now also held for its second reader.
 */
assert.match(scene, /export function fitZoom\(width: number, height: number\): number \{\s*return Math\.max\(20, Math\.min\(height \/ VIEW_HEIGHT, width \/ VIEW_WIDTH\)\);/, 'the zoom fits the pane, in one function');
assert.match(scene, /const zoom = fitZoom\(size\.width, size\.height\);/, 'which the camera uses');
assert.match(scene, /const zoom = fitZoom\(width, height\);/, 'and so does the overlay that places the ✓ / ✗');
assert.match(scene, /upp: 1 \/ zoom/, 'and every drag is handed exactly 1 / zoom units per pixel');
assert.match(scene, /zoom=\{zoom\}/, 'and the camera uses that same zoom');
assert.equal((scene.match(/zoom=\{/g) ?? []).length, 1, 'set in exactly one place');
assert.match(scene, /<OrthographicCamera\s+makeDefault/, 'the camera is orthographic, which is what makes one zoom meaningful');
assert.match(viewport, /touch-none/, 'and a phone cannot scroll the page out from under a drag');

/* 2. Every starting figure fits, with margin, at the real pane sizes. */
function silhouette(figure, view) {
  let minUp = Infinity;
  let maxUp = -Infinity;
  let minRight = Infinity;
  let maxRight = -Infinity;
  const basis = VIEW_BASIS[view];
  for (const shape of figure.shapes) {
    const box = screenBox(figure, shape.id, view);
    const up = box.centre.x * basis.up.x + box.centre.y * basis.up.y + box.centre.z * basis.up.z;
    const right = box.centre.x * basis.right.x + box.centre.y * basis.right.y + box.centre.z * basis.right.z;
    minUp = Math.min(minUp, up - box.halfUp);
    maxUp = Math.max(maxUp, up + box.halfUp);
    minRight = Math.min(minRight, right - box.halfRight);
    maxRight = Math.max(maxRight, right + box.halfRight);
  }
  return { minUp, maxUp, minRight, maxRight };
}

const paneRem = (pattern) => Number(viewport.match(pattern)?.[1]);
const phoneRem = paneRem(/"h-\[(\d+)rem\] touch-none/);
const deskRem = paneRem(/sm:h-\[(\d+)rem\]/);
assert.ok(phoneRem > 0 && deskRem > 0, 'the views declare a phone and a desktop height');

const panes = [
  { name: 'desktop', height: deskRem * 16, width: 340 },
  { name: 'phone', height: phoneRem * 16, width: 330 },
];

/** The span of every starting figure together: the views must not need to move when a preset is picked. */
const spans = RIG_PRESET_IDS.map((id) => silhouette(buildDefaultFigure(id), 'front'));
const lowest = Math.min(...spans.map((s) => s.minUp));
const highest = Math.max(...spans.map((s) => s.maxUp));
const measuredCentre = (lowest + highest) / 2;

for (const preset of RIG_PRESET_IDS) {
  for (const view of ['front', 'side']) {
    const s = silhouette(buildDefaultFigure(preset), view);
    for (const pane of panes) {
      const zoom = Math.max(20, Math.min(pane.height / VIEW_HEIGHT, pane.width / VIEW_WIDTH));
      const halfH = pane.height / zoom / 2;
      const halfW = pane.width / zoom / 2;
      const top = FIGURE_CENTRE_Y + halfH;
      const bottom = FIGURE_CENTRE_Y - halfH;
      assert.ok(s.maxUp < top - 0.05 && s.minUp > bottom + 0.05, `${preset} ${view} fits top to bottom on ${pane.name} (${s.minUp.toFixed(2)}..${s.maxUp.toFixed(2)} in ${bottom.toFixed(2)}..${top.toFixed(2)})`);
      assert.ok(s.maxRight < halfW && s.minRight > -halfW, `${preset} ${view} fits side to side on ${pane.name}`);
    }
  }
}

/* 3. The camera is centred on the presets' measured middle, not on the hips. */
assert.ok(
  Math.abs(FIGURE_CENTRE_Y - measuredCentre) < 0.02,
  `FIGURE_CENTRE_Y should be ${measuredCentre.toFixed(3)} - the measured middle of the presets - found ${FIGURE_CENTRE_Y}`,
);
assert.match(
  scene,
  /position=\{view === 'front' \? \[0, FIGURE_CENTRE_Y, 10\] : \[-10, FIGURE_CENTRE_Y, 0\]\}/,
  'both cameras sit at that height, on the axis their view cannot see',
);

/* 4. Each camera's screen-right is the drag's screen-right. */
const rotation = scene.match(/rotation=\{view === 'front' \? \[([^\]]+)\] : \[([^\]]+)\]\}/);
assert.ok(rotation, 'the cameras declare their rotation, so neither is aimed by default');
const angles = (text) => text.split(',').map((part) => new Function('Math', `return (${part.trim()});`)(Math));
/** Three's XYZ Euler applied to the camera's own right, (1, 0, 0). Only a turn about y is used here. */
const rightOf = ([x, y, z]) => {
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9, 'cameras only turn about the vertical');
  return { x: Math.cos(y), y: 0, z: -Math.sin(y) };
};
for (const [view, text] of [['front', rotation[1]], ['side', rotation[2]]]) {
  const right = rightOf(angles(text));
  const drag = VIEW_BASIS[view].right;
  assert.ok(
    Math.abs(right.x - drag.x) < 1e-9 && Math.abs(right.z - drag.z) < 1e-9,
    `${view}: the camera's screen-right is (${right.x.toFixed(2)}, ${right.z.toFixed(2)}) but a drag right moves (${drag.x}, ${drag.z})`,
  );
}

console.log('character camera checks passed');
console.log(`  presets  : ${lowest.toFixed(2)} to ${highest.toFixed(2)}, middle at y = ${measuredCentre.toFixed(3)}`);
console.log(`  framing  : ${VIEW_HEIGHT} x ${VIEW_WIDTH} units fitted to ${deskRem}rem (desktop) and ${phoneRem}rem (phone) panes`);
console.log('  drag     : 1 / zoom units per pixel, and each view drags the way its camera faces');
