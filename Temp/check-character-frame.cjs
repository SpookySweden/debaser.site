/**
 * **One frame of the pixel render, run for real against a recording renderer.**
 *
 * `check-character-pixel.cjs` holds the render's numbers; this holds what a frame *does*. The fresh-context review of
 * the pixel render (2026-10-15) pointed out that the frame order was only ever checked by finding seven lines of text
 * in order - so moving `under.visible = true` above the colour pass would have drawn the grid into the colour target,
 * made every pixel count as figure, and left every Node check green. Here the real `drawFrame` is called with a real
 * three.js scene, real groups and a real camera, and a stand-in renderer that writes down, for every `render` call,
 * which target it went to, which camera drew it, which of the three groups were visible and which override material
 * was on. That record is then held to the order the render promises:
 *
 *   1. colour pass   tiny target, the low-res camera, the figure alone, its own flat materials
 *   2. normal pass   the other tiny target, the same camera, the figure alone, the normal material
 *   3. the grid      the screen, the view's camera, the grid alone
 *   4. light pass    the screen, the full-screen quad
 *   5. depth         the screen, the view's camera, the figure alone, depth only
 *   6. overlays      the screen, the view's camera, the overlays alone
 *
 * and afterwards everything is visible again, no override is left on, and `autoClear` is what it was - so picking,
 * which happens between frames, sees the whole scene. It also holds what the switches hand the shader: PIXELATE picks
 * the tiny hard-edged pair or the full-size multisampled one, and the mode, the LIGHT and the light's direction (in
 * the view's own space) reach the uniforms.
 *
 * What it cannot do is run a shader: the stand-in draws nothing. `Temp/char-drive.cjs` measures the pixels in Chrome.
 *
 * Steps:
 *   npx tsc app/components/CharacterPixelRender.tsx --outDir Temp/character-frame --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 */
const assert = require('node:assert/strict');

process.removeAllListeners('warning'); // three's "require is deprecated" notice is about this harness

const THREE = require('three');
const { drawFrame, createPasses, NORMAL_PASS, DEPTH_ONLY } = require('./character-frame/components/CharacterPixelRender.js');
const { useCharacterStore } = require('./character-frame/lib/character/store.js');
const render = require('./character-frame/lib/character/pixel-render.js');

/** A view the way the scene builds one: three groups in a scene, and the SIDE camera (the one that is turned). */
function view({ width = 374, height = 448, zoom = 160 } = {}) {
  const scene = new THREE.Scene();
  const under = new THREE.Group();
  const figure = new THREE.Group();
  const over = new THREE.Group();
  under.name = 'under';
  figure.name = 'figure';
  over.name = 'over';
  scene.add(under, figure, over);
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -20, 20);
  camera.zoom = zoom;
  camera.position.set(-10, -0.16, 0);
  camera.rotation.set(0, -Math.PI / 2, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  scene.add(camera);
  return { scene, camera, under, figure, over, groups: { under: { current: under }, figure: { current: figure }, over: { current: over } }, width, height, zoom };
}

/** Writes down every call that matters; draws nothing. */
function recorder(v, ratio) {
  const calls = [];
  let target = null;
  const gl = {
    autoClear: true,
    getDrawingBufferSize: (into) => into.set(Math.floor(v.width * ratio), Math.floor(v.height * ratio)),
    getPixelRatio: () => ratio,
    setRenderTarget: (next) => {
      target = next;
    },
    setClearColor: () => {},
    clear: () => calls.push({ kind: 'clear', target }),
    render: (scene, camera) =>
      calls.push({
        kind: 'render',
        target,
        scene,
        camera,
        shown: ['under', 'figure', 'over'].filter((name) => v[name].visible),
        override: scene.overrideMaterial,
        autoClear: gl.autoClear,
      }),
  };
  return { gl, calls };
}

function frame({ layers = {}, lightOn = true, light = render.DEFAULT_LIGHT, ratio = 1 } = {}) {
  useCharacterStore.getState().reset();
  useCharacterStore.setState({ layers: { ...render.DEFAULT_LAYERS, ...layers }, lightOn, light });
  const v = view();
  const passes = createPasses();
  const { gl, calls } = recorder(v, ratio);
  drawFrame(gl, v.scene, v.camera, passes, v.groups);
  return { v, passes, gl, calls, renders: calls.filter((call) => call.kind === 'render') };
}

/* 1. The order, and what each pass sees. */
const lit = frame();
const { v, passes, renders, calls } = lit;
assert.equal(renders.length, 6, `six draws a frame (${renders.length})`);
const [colour, normal, grid, light, depth, overlays] = renders;

assert.equal(colour.target, passes.pixel.colour, '1. the colour pass draws into the tiny colour target');
assert.notEqual(colour.camera, v.camera, '   with the low-res camera, not the view');
assert.deepEqual(colour.shown, ['figure'], '   the figure alone');
assert.equal(colour.override, null, '   in its own flat materials');

assert.equal(normal.target, passes.pixel.normal, '2. the normal pass draws into the tiny normal target');
assert.equal(normal.camera, colour.camera, '   with the same camera');
assert.deepEqual(normal.shown, ['figure'], '   the figure alone');
assert.equal(normal.override, NORMAL_PASS, '   as surface directions');

assert.equal(grid.target, null, '3. then the screen');
assert.equal(grid.camera, v.camera, '   with the view camera');
assert.deepEqual(grid.shown, ['under'], '   the grid alone, behind');
assert.equal(grid.override, null);

assert.equal(light.target, null, '4. the light pass on the screen');
assert.equal(light.scene, passes.screen, '   is the full-screen quad');

assert.equal(depth.target, null, '5. the figure depth on the screen');
assert.deepEqual(depth.shown, ['figure'], '   the figure alone');
assert.equal(depth.override, DEPTH_ONLY, '   depth only, no colour');
assert.equal(DEPTH_ONLY.colorWrite, false);

assert.equal(overlays.target, null, '6. the overlays on the screen');
assert.equal(overlays.camera, v.camera, '   with the view camera, at full resolution');
assert.deepEqual(overlays.shown, ['over'], '   the overlays alone');
assert.equal(overlays.override, null);

assert.ok(renders.every((call) => call.autoClear === false), 'no draw clears the one before it');
const clearedBefore = (draw) => {
  const at = calls.indexOf(draw);
  const previous = calls.slice(0, at).reverse().find((call) => call.kind === 'clear');
  return previous !== undefined && previous.target === draw.target && calls.slice(calls.indexOf(previous) + 1, at).every((call) => call.target !== draw.target || call.kind === 'clear');
};
assert.ok(clearedBefore(colour) && clearedBefore(normal) && clearedBefore(grid), 'each target is cleared before its first draw, the screen once');

/* 2. Between frames the scene is whole again. */
assert.ok(v.under.visible && v.figure.visible && v.over.visible, 'all three groups are visible after the frame, so picking sees everything');
assert.equal(v.scene.overrideMaterial, null, 'no override is left on');
assert.equal(lit.gl.autoClear, true, 'and autoClear is put back');

/* 3. The sizes, the low-res camera, and the uniforms. */
const expected = render.pixelGrid(v.width, v.height, v.zoom, 1, true);
assert.deepEqual([passes.pixel.colour.width, passes.pixel.colour.height], [expected.width, expected.height], 'the tiny targets are the pixel grid');
assert.equal(passes.pixel.colour.samples, 0, 'and not multisampled: hard edges are the point');
const frustum = render.lowResFrustum(v.camera, expected, 1);
assert.deepEqual([colour.camera.left, colour.camera.right, colour.camera.bottom, colour.camera.top, colour.camera.zoom], [frustum.left, frustum.right, frustum.bottom, frustum.top, 1], 'the low-res camera is lowResFrustum');
assert.ok(colour.camera.quaternion.equals(v.camera.quaternion) && colour.camera.position.equals(v.camera.position), 'looking from where the view looks');
const uniforms = passes.material.uniforms;
assert.equal(uniforms.colourPass.value, passes.pixel.colour.texture, 'the light pass reads the colour pass');
assert.equal(uniforms.normalPass.value, passes.pixel.normal.texture, 'and the normal pass');
assert.equal(uniforms.block.value, expected.block, 'in blocks of the grid');
assert.equal(uniforms.mode.value, 2, 'lit, by default');
assert.equal(uniforms.lightOn.value, 1);
// The default light is front-left and up. The SIDE camera looks at the figure's left side, with forward (+z) to the
// right: so in its own space the light is up, to the right, and towards the camera.
const dir = uniforms.lightDir.value;
assert.ok(dir.y > 0 && dir.x > 0 && dir.z > 0, `the light is turned into the view's space (${dir.toArray().map((n) => n.toFixed(2)).join(', ')})`);
assert.ok(Math.abs(dir.length() - 1) < 1e-9, 'as a unit direction');

/* 4. The switches reach the frame. */
const smooth = frame({ layers: { pixelate: false }, ratio: 2 });
assert.equal(smooth.renders[0].target, smooth.passes.smooth.colour, 'PIXELATE off draws into the full-size pair');
assert.equal(smooth.passes.smooth.colour.samples, 4, 'multisampled, so its edges are smooth');
assert.deepEqual([smooth.passes.smooth.colour.width, smooth.passes.smooth.colour.height], [Math.floor(374 * 2), Math.floor(448 * 2)], 'one pixel per device pixel');
assert.equal(smooth.passes.material.uniforms.block.value, 1);
// 50 PX (2026-10-19), 12 PX since 2026-10-21 (updated on purpose: Luke asked for 12): the tiny targets are about 12
// pixels on the view's longer side, and the shader's blocks match. At 12 the blocks are bigger than without it, not smaller.
for (const ratio of [1, 2]) {
  const fine = frame({ layers: { fine: true }, ratio });
  const target = fine.passes.pixel.colour;
  const block = fine.passes.material.uniforms.block.value;
  assert.equal(fine.renders[0].target, target, `12 PX @${ratio}x draws into the tiny pair`);
  assert.ok(Math.abs(Math.max(target.width, target.height) - render.PANEL_PIXELS) <= 1, `12 PX @${ratio}x: the target's longer side is ${Math.max(target.width, target.height)}, about ${render.PANEL_PIXELS}`);
  assert.ok(target.width * block >= Math.floor(374 * ratio) && target.height * block >= Math.floor(448 * ratio), `12 PX @${ratio}x: and its blocks cover the view`);
  assert.ok(block > frame({ ratio }).passes.material.uniforms.block.value, `12 PX @${ratio}x: bigger blocks than without it (${block}px)`);
}
const fineSmooth = frame({ layers: { fine: true, pixelate: false } });
assert.equal(fineSmooth.renders[0].target, fineSmooth.passes.smooth.colour, '12 PX with PIXELATE off still draws at full size');
assert.equal(fineSmooth.passes.material.uniforms.block.value, 1);
assert.equal(frame({ layers: { normalLight: false } }).passes.material.uniforms.mode.value, 1, 'NORMAL LIGHT off: flat');
assert.equal(frame({ layers: { normalMap: true } }).passes.material.uniforms.mode.value, 0, 'NORMAL MAP: the normals');
assert.equal(frame({ lightOn: false }).passes.material.uniforms.lightOn.value, 0, 'LIGHT off reaches the shader');
const turned = frame({ light: render.stepLight(render.stepLight(render.DEFAULT_LIGHT, 'right'), 'right') }).passes.material.uniforms.lightDir.value;
assert.ok(turned.z < 0, 'two turns right put the light behind the SIDE view (it lights the figure`s right)');

console.log('character frame checks passed');
console.log('  order    : colour -> normal (tiny, figure alone) -> grid -> light pass -> figure depth -> overlays');
console.log('  after    : every group visible, no override, autoClear restored');
console.log('  switches : PIXELATE picks the tiny or the multisampled pair; 12 PX sizes the tiny one to ~12 a side; mode, LIGHT and direction reach the shader');
console.log('  cannot   : run a shader. Temp/char-drive.cjs measures the pixels in Chrome.');
