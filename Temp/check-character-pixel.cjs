/**
 * 5. **The live pixel render: its size, its light, its switches - and the old composer is gone.**
 *
 * **Rewritten for the Dead Cells render (SPEC-pixel-render.md, 2026-10-14).** This check used to hold the FINAL look:
 * an `EffectComposer` with `Pixelation` and `Outline`, mounted only for FINAL. That whole arrangement was replaced - the
 * figure is now drawn tiny with anti-aliasing off, as a colour pass and a normal pass, and a cel shader lights one from
 * the other, in both views all the time. So what this holds now:
 *
 *   - **the size, measured**: every preset, in both views, at the real desktop and phone pane sizes and at 1x, 2x and
 *     3x screens, is at most 30 low-res pixels tall (and not much fewer - "about 30" is the spec, chunkier than Dead
 *     Cells' 50). The silhouettes come from the real figures, through the same `screenBox` the handles use.
 *   - **the target covers the view in whole blocks**: no column or row is left unpainted, and none is spare.
 *   - **the d-pad steps**: 45 degrees round, 30 up or down, clamped short of straight up and down, walking all the way
 *     round comes home, and an off-grid light snaps onto the grid.
 *   - **12 PX** (2026-10-19 as 50 PX; 12 since 2026-10-21): with it on, each view's longer side is about 12 low-res
 *     pixels, set by the pane.
 *   - **the defaults**: PIXELATE on, 12 PX off, NORMAL LIGHT on, NORMAL MAP off, the LIGHT on.
 *   - **the bands**: three, hard, with the shadow band above zero; and the shader uses these numbers, not copies.
 *   - **the composer is gone** and the three passes exist, in the order the render notes describe.
 *
 * It cannot see a pixel. `Temp/char-drive.cjs` measures the render in Chrome: edges on the block grid with PIXELATE
 * on and spread out with it off, a rainbow under NORMAL MAP, fewer shades with the LIGHT off, and the lit side moving
 * with the d-pad.
 *
 * Steps:
 *   npx tsc app/lib/character/pixel-render.ts app/lib/character/drag.ts app/lib/character/rig.ts app/lib/character/figure.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const render = require('./character-out/pixel-render.js');
const { VIEW_BASIS, screenBox } = require('./character-out/drag.js');
const { buildDefaultFigure, RIG_PRESET_IDS } = require('./character-out/rig.js');

const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sceneCode = strip(fs.readFileSync('app/components/CharacterScene.tsx', 'utf8'));
const passCode = fs.readFileSync('app/components/CharacterPixelRender.tsx', 'utf8');
const passPlain = strip(passCode);
const viewportCode = strip(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'));
const storeCode = strip(fs.readFileSync('app/lib/character/store.ts', 'utf8'));

/* 1. Every preset is at most 30 low-res pixels tall, in both views, on every screen. */
const constant = (name) => {
  const value = Number(sceneCode.match(new RegExp(`const ${name} = (-?[\\d.]+);`))?.[1]);
  assert.ok(Number.isFinite(value), `the scene declares ${name}`);
  return value;
};
const VIEW_HEIGHT = constant('VIEW_HEIGHT');
const VIEW_WIDTH = constant('VIEW_WIDTH');

function heightOf(figure, view) {
  const basis = VIEW_BASIS[view];
  let low = Infinity;
  let high = -Infinity;
  for (const shape of figure.shapes) {
    const box = screenBox(figure, shape.id, view);
    if (box === null) continue;
    const up = box.centre.x * basis.up.x + box.centre.y * basis.up.y + box.centre.z * basis.up.z;
    low = Math.min(low, up - box.halfUp);
    high = Math.max(high, up + box.halfUp);
  }
  return high - low;
}

const heights = RIG_PRESET_IDS.flatMap((id) =>
  ['front', 'side'].map((view) => ({ id, view, height: heightOf(buildDefaultFigure(id), view) })),
);
const tallest = Math.max(...heights.map((h) => h.height));
assert.ok(tallest <= render.TALLEST_PRESET + 1e-9, `no preset is taller than TALLEST_PRESET (${tallest.toFixed(3)})`);
assert.ok(
  render.TALLEST_PRESET - tallest < 0.02,
  `TALLEST_PRESET (${render.TALLEST_PRESET}) is the real tallest preset (${tallest.toFixed(3)}), not a stale guess that makes pixels too big`,
);

const paneRem = (pattern) => Number(viewportCode.match(pattern)?.[1]);
const phoneRem = paneRem(/"h-\[(\d+)rem\] touch-none/);
const deskRem = paneRem(/sm:h-\[(\d+)rem\]/);
assert.ok(phoneRem > 0 && deskRem > 0, 'the views declare a phone and a desktop height');

const panes = [
  { name: 'desktop', height: deskRem * 16, width: 374 },
  { name: 'desktop wide', height: deskRem * 16, width: 620 },
  { name: 'phone', height: phoneRem * 16, width: 330 },
];
let fewest = Infinity;
let most = 0;
for (const pane of panes) {
  const zoom = Math.max(20, Math.min(pane.height / VIEW_HEIGHT, pane.width / VIEW_WIDTH));
  for (const ratio of [1, 1.5, 2, 3]) {
    const bufferWidth = Math.floor(pane.width * ratio);
    const bufferHeight = Math.floor(pane.height * ratio);
    const grid = render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, true);
    assert.ok(Number.isInteger(grid.block) && grid.block >= 1, 'a block is a whole number of device pixels');
    assert.ok(grid.width * grid.block >= bufferWidth && grid.height * grid.block >= bufferHeight, `${pane.name} @${ratio}x: the blocks cover the view`);
    assert.ok((grid.width - 1) * grid.block < bufferWidth && (grid.height - 1) * grid.block < bufferHeight, `${pane.name} @${ratio}x: and no column or row is spare`);
    for (const { id, view, height } of heights) {
      const rows = (height * zoom * ratio) / grid.block;
      assert.ok(rows <= render.FIGURE_ROWS + 1e-9, `${id} ${view} on ${pane.name} @${ratio}x is ${rows.toFixed(1)} pixels tall - at most ${render.FIGURE_ROWS}`);
      if (height === tallest) {
        fewest = Math.min(fewest, rows);
        most = Math.max(most, rows);
        assert.ok(rows >= render.FIGURE_ROWS - 3, `and the tallest is about ${render.FIGURE_ROWS}, not far fewer (${rows.toFixed(1)} on ${pane.name} @${ratio}x)`);
      }
    }
    const smooth = render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, false);
    assert.deepEqual(smooth, { block: 1, width: bufferWidth, height: bufferHeight }, 'PIXELATE off is one block per device pixel');
  }
}

/*
 * 1a. **12 PX: each view's longer side is about 12 low-res pixels** (`PANEL_PIXELS`, added 2026-10-19 at Luke's
 * request as 50; Luke asked for 12 on 2026-10-21). The block is set by the pane, not the figure, so it does not move
 * with the zoom. Updated on purpose 2026-10-21: at 12 it is coarser than the figure-sized block on every pane - switching
 * it on gives fewer, bigger pixels - so the old "finer, except on the wide pane" rule is now "coarser everywhere". And
 * "about" is within 1, not 3: at 12, three either way would be a quarter off (rounding the block can only give 12 or
 * 13). PIXELATE off still wins: one block per device pixel.
 */
assert.equal(render.PANEL_PIXELS, 12, 'about 12 pixels a view');
let fineFewest = Infinity;
let fineMost = 0;
for (const pane of panes) {
  const zoom = Math.max(20, Math.min(pane.height / VIEW_HEIGHT, pane.width / VIEW_WIDTH));
  for (const ratio of [1, 1.25, 1.5, 2, 3]) {
    const bufferWidth = Math.floor(pane.width * ratio);
    const bufferHeight = Math.floor(pane.height * ratio);
    const label = `12 PX, ${pane.name} @${ratio}x`;
    const fine = render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, true, true);
    assert.ok(Number.isInteger(fine.block) && fine.block >= 1, `${label}: a block is a whole number of device pixels`);
    assert.ok(fine.width * fine.block >= bufferWidth && fine.height * fine.block >= bufferHeight, `${label}: the blocks cover the view`);
    assert.ok((fine.width - 1) * fine.block < bufferWidth && (fine.height - 1) * fine.block < bufferHeight, `${label}: and no column or row is spare`);
    const longer = Math.max(fine.width, fine.height);
    fineFewest = Math.min(fineFewest, longer);
    fineMost = Math.max(fineMost, longer);
    assert.ok(Math.abs(longer - render.PANEL_PIXELS) <= 1, `${label}: the longer side is ${longer} pixels - about ${render.PANEL_PIXELS}`);
    assert.deepEqual(render.pixelGrid(bufferWidth, bufferHeight, zoom * 2, ratio, true, true), fine, `${label}: set by the pane, not the zoom`);
    const coarse = render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, true);
    assert.ok(fine.block > coarse.block, `${label}: bigger blocks than without it (${fine.block} vs ${coarse.block} device pixels a block)`);
    assert.deepEqual(
      render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, false, true),
      { block: 1, width: bufferWidth, height: bufferHeight },
      `${label}: PIXELATE off still draws at full size`,
    );
  }
}

/*
 * 1b. **Each low-res pixel lands on its own block of the screen** - built with real three.js cameras, the way the
 * render builds them. The first version set the low-res edges in pixels with the view's zoom; three divides the width
 * by the zoom but not the centre, so the low-res camera looked units to one side and both passes came out empty. Only
 * a browser showed it. This measures it: the centre of low-res pixel (i, j), projected by the low-res camera and then
 * by the view's, must be the centre of device-pixel block (i, j).
 */
const THREE = require('three');
for (const pane of panes) {
  const zoom = Math.max(20, Math.min(pane.height / VIEW_HEIGHT, pane.width / VIEW_WIDTH));
  // Both grids: the figure-sized one and 12 PX's.
  for (const [ratio, fine] of [1, 2, 3].flatMap((r) => [[r, false], [r, true]])) {
    const view = new THREE.OrthographicCamera(-pane.width / 2, pane.width / 2, pane.height / 2, -pane.height / 2, -20, 20);
    view.zoom = zoom;
    view.position.set(-10, -0.16, 0);
    view.rotation.set(0, -Math.PI / 2, 0);
    view.updateProjectionMatrix();
    view.updateMatrixWorld();
    const bufferWidth = Math.floor(pane.width * ratio);
    const bufferHeight = Math.floor(pane.height * ratio);
    const grid = render.pixelGrid(bufferWidth, bufferHeight, zoom, ratio, true, fine);
    const low = view.clone();
    Object.assign(low, render.lowResFrustum(view, grid, ratio), { zoom: 1 });
    low.updateProjectionMatrix();
    low.updateMatrixWorld();
    for (const [i, j] of [[0, 0], [grid.width - 1, 0], [Math.floor(grid.width / 2), Math.floor(grid.height / 2)], [3, grid.height - 1]]) {
      // The world point at the centre of low-res pixel (i, j)...
      const point = new THREE.Vector3(((i + 0.5) / grid.width) * 2 - 1, ((j + 0.5) / grid.height) * 2 - 1, 0).unproject(low);
      // ...seen by the view, in device pixels from the bottom-left corner.
      const seen = point.clone().project(view);
      const x = ((seen.x + 1) / 2) * pane.width * ratio;
      const y = ((seen.y + 1) / 2) * pane.height * ratio;
      assert.ok(
        Math.abs(x - (i + 0.5) * grid.block) < 0.5 && Math.abs(y - (j + 0.5) * grid.block) < 0.5,
        `${pane.name} @${ratio}x${fine ? ' 12 PX' : ''}: low-res pixel ${i},${j} lands at ${x.toFixed(1)},${y.toFixed(1)}, not on its block's centre ${((i + 0.5) * grid.block).toFixed(1)},${((j + 0.5) * grid.block).toFixed(1)}`,
      );
    }
  }
}

/* 2. The light d-pad. */
const DEG = Math.PI / 180;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const degrees = (light) => `${Math.round(light.azimuth / DEG)}°, ${Math.round(light.elevation / DEG)}°`;
assert.ok(near(render.LIGHT_TURN_STEP, 45 * DEG) && near(render.LIGHT_RAISE_STEP, 30 * DEG), 'the steps are 45° round and 30° up');
assert.ok(near(render.LIGHT_HIGHEST, 60 * DEG), 'and the light stops at 60°, short of straight up');
const start = render.DEFAULT_LIGHT;
assert.ok(near(start.azimuth % render.LIGHT_TURN_STEP, 0) && near(start.elevation % render.LIGHT_RAISE_STEP, 0), `the default is on the step grid (${degrees(start)})`);

let light = start;
light = render.stepLight(light, 'right');
assert.ok(near(light.azimuth, start.azimuth + 45 * DEG) && near(light.elevation, start.elevation), `RIGHT turns 45° (${degrees(light)})`);
light = render.stepLight(render.stepLight(start, 'left'), 'left');
assert.ok(near(light.azimuth, start.azimuth - 90 * DEG), `LEFT twice turns 90° the other way (${degrees(light)})`);
light = start;
for (let press = 0; press < 8; press += 1) light = render.stepLight(light, 'right');
assert.ok(near(light.azimuth, start.azimuth) && near(light.elevation, start.elevation), 'eight presses go all the way round and home');
for (let press = 0; press < 3; press += 1) {
  assert.ok(light.azimuth > -Math.PI - 1e-9 && light.azimuth <= Math.PI + 1e-9, 'the angle stays within one turn');
  light = render.stepLight(light, 'left');
}
light = render.stepLight(start, 'up');
assert.ok(near(light.elevation, start.elevation + 30 * DEG), `UP raises 30° (${degrees(light)})`);
light = render.stepLight(render.stepLight(render.stepLight(light, 'up'), 'up'), 'up');
assert.ok(near(light.elevation, 60 * DEG), `and clamps at 60° however often it is pressed (${degrees(light)})`);
for (let press = 0; press < 10; press += 1) light = render.stepLight(light, 'down');
assert.ok(near(light.elevation, -60 * DEG), `DOWN clamps at -60°, short of straight down (${degrees(light)})`);
light = render.stepLight({ azimuth: -0.6, elevation: 0.9 }, 'right');
assert.ok(near(light.azimuth, 0) && near(light.elevation, 0.9), 'a turn from an off-grid angle (the old default) lands on the grid');
light = render.stepLight({ azimuth: -0.6, elevation: 0.9 }, 'up');
assert.ok(near(light.elevation, 60 * DEG), 'and so does a raise');
const from = render.lightDirection({ azimuth: 0, elevation: 0 });
assert.ok(near(from.z, 1) && near(from.x, 0), 'azimuth 0 is straight in front of the figure');
assert.ok(render.lightDirection(render.stepLight({ azimuth: 0, elevation: 0 }, 'left')).x < 0, "LEFT moves the light to the front view's left");

// The store's d-pad is this function, and the centre button is the default.
assert.match(storeCode, /stepLight: \(step\) => set\(\(state\) => \(\{ light: stepLight\(state\.light, step\) \}\)\)/, 'the store steps with stepLight');
assert.match(storeCode, /resetLight: \(\) => set\(\{ light: \{ \.\.\.DEFAULT_LIGHT \} \}\)/, 'and resets to DEFAULT_LIGHT');

/* 3. The defaults. */
// Updated on purpose 2026-10-19: 50 PX (12 PX since 2026-10-21) joined, off by default, beside the PIXELATE it sizes.
assert.deepEqual({ ...render.DEFAULT_LAYERS }, { pixelate: true, fine: false, normalLight: true, normalMap: false }, 'PIXELATE on, 12 PX off, NORMAL LIGHT on, NORMAL MAP off');
assert.deepEqual([...render.LAYER_IDS], ['pixelate', 'fine', 'normalLight', 'normalMap'], 'four layer switches');
const resting = (overrides) => render.LAYER_IDS.filter((id) => render.layerRests(id, { ...render.DEFAULT_LAYERS, ...overrides }));
assert.deepEqual(resting({}), [], 'nothing rests on arrival');
assert.deepEqual(resting({ pixelate: false }), ['fine'], '12 PX rests with PIXELATE off: there are no pixels to size');
assert.deepEqual(resting({ pixelate: false, fine: true }), ['fine'], 'whether it is on or off');
assert.deepEqual(resting({ fine: true }), [], 'and works with PIXELATE on');
assert.deepEqual(resting({ normalMap: true }), ['normalLight'], 'NORMAL LIGHT rests under the normal map');
assert.deepEqual(resting({ normalMap: true, pixelate: false }), ['fine', 'normalLight'], 'the two rests are independent');
assert.match(storeCode, /layers: \{ \.\.\.DEFAULT_LAYERS \},\s*lightOn: true,\s*lightPadOpen: false,/, 'the bench opens with those, the LIGHT on and the pad shut');
assert.equal(render.shadeMode(render.DEFAULT_LAYERS), 'lit', 'which is the cel-lit picture');
assert.equal(render.shadeMode({ pixelate: true, normalLight: false, normalMap: false }), 'flat', 'NORMAL LIGHT off is flat colour');
assert.equal(render.shadeMode({ pixelate: false, normalLight: false, normalMap: true }), 'normals', 'NORMAL MAP shows the normals whatever else is on');

/* 4. Three hard bands, and shadow is never black. */
const levels = [...new Set(Array.from({ length: 101 }, (_, i) => render.celBand(i / 100)))].sort();
assert.equal(levels.length, 3, `three bands, not a gradient (${levels.join(', ')})`);
assert.ok(render.celBand(0) > 0.3, 'facing away is shadow, not black');
assert.equal(render.celBand(1), 1, 'facing the light is the dye itself');
assert.ok(render.CEL_BANDS.shadow < render.CEL_BANDS.mid && render.CEL_BANDS.mid < render.CEL_BANDS.lit, 'in order');
for (const name of ['LIT_FROM', 'MID_FROM', 'CEL_BANDS.lit', 'CEL_BANDS.mid', 'CEL_BANDS.shadow']) {
  assert.ok(passCode.includes(`\${${name}.toFixed(3)}`), `the shader takes ${name} from pixel-render.ts, not a copy`);
}
assert.match(passCode, /lightOn \* max\(dot\(normalize\(encoded \* 2\.0 - 1\.0\), lightDir\), 0\.0\)/, 'the light amount is dot(normal, light), and LIGHT off makes it zero (shadow everywhere)');

/* 5. The composer is gone. */
assert.ok(!fs.existsSync('app/components/CharacterPixelPass.tsx'), 'the old FINAL pass is gone');
const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(full);
  }
};
walk('app');
for (const file of sources) {
  const code = strip(fs.readFileSync(file, 'utf8'));
  assert.doesNotMatch(code, /@react-three\/postprocessing|<EffectComposer|<Outline|<Pixelation/, `${file} uses no composer, outline or pixelation filter`);
}
assert.doesNotMatch(sceneCode, /look/, 'there is no SHAPES / FINAL look left in the scene');
assert.doesNotMatch(storeCode, /LookId|setLook/, 'or in the store');

/* 6. The new passes exist, in order. */
assert.match(sceneCode, /gl=\{\{ antialias: false \}\}/, 'anti-aliasing off: the pixel look comes from the size alone');
// Simple figures: the FRONT view's render also counts its pixels, for the PIXELS stat.
assert.match(sceneCode, /<PixelRender groups=\{groups\} countPixels=\{view === 'front'\} \/>/, 'the scene is drawn by the pixel render');
assert.match(sceneCode, /material=\{flatMaterial\(shape\.colour \?\? MODEL_INK\)\}/, 'shapes wear flat, unlit colours');
assert.doesNotMatch(sceneCode, /meshLambertMaterial|directionalLight|ambientLight/, 'and the scene has no lights of its own: the light is the shader');
assert.match(passPlain, /useFrame\(\(\{ gl, scene, camera, clock \}\) => \{\s*drawFrame\(gl, scene, camera, passes, groups\);/, 'the render takes over the frame');
assert.match(passPlain, /\}, 1\);/, 'at a priority above zero');
assert.match(passPlain, /minFilter: THREE\.NearestFilter,\s*magFilter: THREE\.NearestFilter/, 'the tiny targets are nearest-neighbour');
assert.match(passPlain, /vNormal = normalize\(normalMatrix \* normal\)/, 'the normal pass stores the view-space surface direction');
assert.match(passPlain, /gl_FragColor = vec4\(normalize\(vNormal\) \* 0\.5 \+ 0\.5, 1\.0\)/, 'encoded as a colour');
assert.match(passPlain, /floor\(gl_FragCoord\.xy \/ block\)/, 'the light pass scales up with hard square blocks');
/*
 * The frame's order - colour pass, normal pass, then on screen the grid, the light pass, the figure depth and the
 * overlays - used to be asserted here as seven lines of text in sequence. That is the "string next to the behaviour"
 * the fresh-context review flagged: it would have stayed green with the grid left on in the colour pass. It is now run
 * for real against a recording renderer in `Temp/check-character-frame.cjs`, so it is not repeated as text here.
 */

console.log('character pixel-render checks passed');
console.log(`  size     : tallest preset ${tallest.toFixed(2)} units = ${fewest.toFixed(1)}-${most.toFixed(1)} pixels tall across ${panes.length} panes x 4 screens (max ${render.FIGURE_ROWS})`);
console.log(`  12 PX    : the longer side is ${fineFewest}-${fineMost} pixels across ${panes.length} panes x 5 screens, set by the pane; bigger blocks on every pane`);
console.log('  blocks   : each low-res pixel lands on its own block (both grids), measured with real three.js cameras');
console.log('  light    : 45° / 30° steps, clamped at ±60°, home after a full turn, off-grid snaps on');
console.log('  layers   : PIXELATE on, 12 PX off, NORMAL LIGHT on, NORMAL MAP off, LIGHT on; 12 PX rests with PIXELATE off');
console.log(`  bands    : ${levels.join(' / ')}, from pixel-render.ts`);
console.log('  passes   : colour -> normal -> light, no composer, no outline, no filter');
console.log('  cannot   : see the pixels. Temp/char-drive.cjs measures them in Chrome.');
