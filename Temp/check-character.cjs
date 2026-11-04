/**
 * The character rig's arithmetic, held where it can fail - and the workbench's frame.
 *
 * `skeleton.ts`, `rig.ts`, `figure.ts` and `drag.ts` are pure - no React, no WebGL, no DOM - so this check drives
 * the real modules rather than reading their source. The frame assertions (the CHAR tab's place, the two views,
 * the client-only load) live at the bottom, because a check deleted when its phase is done is a check whose
 * regression nobody catches.
 *
 * **Rewritten for the free-shape workbench (2026-10-13).** What stayed: the rig is one tree, a parent's move carries
 * its branch, values are copied rather than shared, a drag's arithmetic is exact, and the CHAR tab sits between the
 * other two. What went, because the thing it held is gone on purpose:
 *   - the per-joint mass table and "structural joints" - shapes are a free list pinned to joints now
 *   - joint scale, re-parenting and joint removal - the workbench never exposed them, and shapes are sized directly
 *   - dragging to turn the light, and the four edit layers - the light has two sliders, the layers are a tool strip
 * Pinning, posing and undo have their own check, `check-character-figure.cjs`.
 *
 * Steps: the runner reads `npx tsc ...` lines *inside this comment block*, and matches that prefix literally.
 *   npx tsc app/lib/character/skeleton.ts app/lib/character/rig.ts app/lib/character/drag.ts app/lib/character/shapes.ts app/lib/character/figure.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/ui/icons.ts --outDir Temp/icons-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { addJoint, setPosition, validateRig, worldPosition, descendantsOf, vec3 } = require('./character-out/skeleton.js');
const { buildDefaultFigure, buildSkeleton, DEFAULT_JOINT_IDS, ROOT_JOINT_ID, RIG_PRESET_IDS } = require('./character-out/rig.js');
const { dragOffset } = require('./character-out/drag.js');
const { MASS_SHAPE_IDS, MASS_SHAPES } = require('./character-out/shapes.js');
const fig = require('./character-out/figure.js');
const { MASS_SHAPE_GLYPHS, TOOL_GLYPHS } = require('./icons-out/icons.js');

const rig = buildSkeleton('base');
/** GUY's skeleton has branches (a head and two arms off the body), so it is the one the tree rules are held on. */
const guyRig = buildSkeleton('guy');

/* 1. The figure itself is well formed. */
assert.deepEqual(validateRig(rig), [], 'the default rig has one root, real parents and no cycles');
assert.equal(Object.keys(rig.joints).length, DEFAULT_JOINT_IDS.length, 'every declared joint was added');
assert.equal(rig.rootId, 'hips', 'the root is the hips, so a lean pivots on the pelvis rather than the floor');
assert.equal(rig.joints[ROOT_JOINT_ID].parentId, null, 'and the root has no parent');
for (const joint of Object.values(rig.joints)) {
  assert.deepEqual(joint.rest, joint.position, `${joint.id} starts at rest - a pose is measured from here`);
  assert.notEqual(joint.rest, joint.position, `${joint.id} owns two triples, so posing cannot move its rest`);
}

/* 2. The vocabulary: seven primitives, each labelled, explained and drawable in the 2D panels. */
assert.equal(MASS_SHAPE_IDS.length, 7, 'seven primitives');
for (const shape of MASS_SHAPE_IDS) {
  assert.ok(MASS_SHAPES[shape].label.length > 0, `${shape} has a label`);
  assert.ok(MASS_SHAPES[shape].note.length > 0, `${shape} has a one-line note`);
  assert.ok(MASS_SHAPE_GLYPHS[shape] !== undefined, `${shape} has a glyph for the panels`);
}
for (const tool of ['select', 'add', 'move', 'turn', 'size', 'pose', 'node', 'delete', 'undo', 'redo']) {
  assert.ok(typeof TOOL_GLYPHS[tool] === 'string' && TOOL_GLYPHS[tool].length > 0, `${tool} has a text glyph - no drawn icons`);
}
// Simple figures: five shapes each, so the vocabulary is exercised across the presets rather than by one figure.
const used = new Set(RIG_PRESET_IDS.flatMap((preset) => buildDefaultFigure(preset).shapes.map((shape) => shape.kind)));
assert.ok(used.size >= 4, `the starting figures exercise the vocabulary (they use ${used.size} of 7)`);
for (const preset of RIG_PRESET_IDS) {
  assert.ok(buildDefaultFigure(preset).shapes.every((shape) => MASS_SHAPE_IDS.includes(shape.kind)), `${preset} uses declared shapes only`);
}

/* 3. The tree: a child's position is relative to its parent, which is what makes a parent's move carry. A drag
 *    produces an *offset*, so it is applied as one (setPosition replaces; adding is what a drag does). */
const moveBy = (skeleton, id, offset) => {
  const joint = skeleton.joints[id];
  return setPosition(skeleton, id, {
    x: joint.position.x + offset.x,
    y: joint.position.y + offset.y,
    z: joint.position.z + offset.z,
  });
};
const moved = moveBy(guyRig, 'body', vec3(1, 0, 0));
assert.equal(worldPosition(moved, 'hand.left').x - worldPosition(guyRig, 'hand.left').x, 1, 'moving the body carries the hand');
assert.equal(worldPosition(moved, 'hand.left').y, worldPosition(guyRig, 'hand.left').y, 'and only along the offset');
assert.equal(worldPosition(moved, 'head').x - worldPosition(guyRig, 'head').x, 1, 'and the head on the body`s branch');
assert.equal(worldPosition(moved, 'hips').x, 0, 'but not the node above it');
const shrugged = moveBy(guyRig, 'arm.left', vec3(1, 0, 0));
assert.equal(worldPosition(shrugged, 'hand.left').x - worldPosition(guyRig, 'hand.left').x, 1, 'moving a shoulder carries its hand');
assert.equal(worldPosition(shrugged, 'hand.right').x, worldPosition(guyRig, 'hand.right').x, 'but not the hand on another branch');
assert.deepEqual(
  descendantsOf(guyRig, 'body'),
  ['head', 'arm.left', 'hand.left', 'arm.right', 'hand.right'],
  'descendants are depth first, nearest child first - the order a renderer needs',
);

/* 4. Immutability. The store compares by reference and the undo history keeps old figures alive, so an edit must
 *    return new objects and leave its input untouched. This is what would catch a `Vector3`-style in-place write. */
const before = JSON.stringify(rig);
const edited = setPosition(rig, 'body', vec3(2, 0, 0));
assert.notEqual(edited, rig, 'a change returns a new skeleton');
assert.notEqual(edited.joints, rig.joints, 'with a new joint record');
assert.equal(JSON.stringify(rig), before, 'and the input is not mutated');
const passed = vec3(2, 0, 0);
const owned = setPosition(rig, 'body', passed);
passed.x = 99;
assert.equal(owned.joints.body.position.x, 2, 'the joint owns its own triple, not the caller`s');

const figure = buildDefaultFigure('base');
const figureBefore = JSON.stringify(figure);
const head = figure.shapes.find((shape) => shape.name === 'HEAD');
for (const [name, change] of [
  ['recolour', (f) => fig.setShapeColour(f, head.id, '#FF00A0')],
  ['resize', (f) => fig.setShapeNumbers(f, head.id, { size: vec3(1, 1, 1) })],
  ['unpin', (f) => fig.pinShape(f, head.id, null)],
  ['rename', (f) => fig.renameShape(f, head.id, 'skull')],
  ['hide', (f) => fig.setShapeHidden(f, head.id, true)],
  ['reorder', (f) => fig.reorderShape(f, head.id, 1)],
  ['delete', (f) => fig.removeShape(f, head.id)],
  ['add', (f) => fig.addShape(f, { kind: 'cone', at: vec3(0, 1, 0), pin: 'head' }).figure],
]) {
  const after = change(figure);
  assert.notEqual(after, figure, `${name} returns a new figure`);
  assert.equal(JSON.stringify(figure), figureBefore, `${name} leaves the figure it was handed untouched`);
}
assert.equal(fig.setShapeColour(figure, 'nobody', '#FF00A0'), figure, 'an edit to a shape that is not there changes nothing');
assert.equal(fig.renameShape(figure, head.id, '   '), figure, 'a blank name is refused, so every row can be told apart');
assert.equal(fig.findShape(fig.renameShape(figure, head.id, 'skull'), head.id).name, 'SKULL', 'names are upper case, like the rest of the site');

/* 5. A joint added under a parent keeps the tree whole; one under a parent that does not exist is refused. */
const withSpur = addJoint(rig, { id: 'spur', parentId: 'body', position: vec3(0, 0.1, 0) });
assert.ok(withSpur.joints.spur !== undefined, 'a joint can be added under an existing parent');
assert.deepEqual(validateRig(withSpur), [], 'and the result is still well formed');
assert.equal(addJoint(rig, { id: 'spur', parentId: 'nowhere', position: vec3(0, 0, 0) }), rig, 'an unknown parent adds nothing');
assert.equal(addJoint(withSpur, { id: 'spur', parentId: 'body', position: vec3(0, 0, 0) }), withSpur, 'a duplicate id adds nothing');

/* 6. The drag arithmetic. This is where a bug cannot be seen, so it is where the check earns its keep. */
const upp = 1 / 150;
const front = dragOffset('front', 100, 50, upp);
assert.equal(front.z, 0, 'a front drag leaves depth exactly where it was');
assert.equal(front.x, 100 * upp, 'and moves across by the drag distance');
assert.equal(front.y, -50 * upp, 'and up for an upward drag - screen y grows down, model y up');
const side = dragOffset('side', 100, 50, upp);
assert.equal(side.x, 0, 'a side drag leaves width alone');
assert.equal(side.z, 100 * upp, 'and moves forward');
assert.equal(side.y, front.y, 'and the vertical is the same in both views - one figure, two views');
assert.deepEqual(dragOffset('front', Number.NaN, 0, upp), vec3(0, 0, 0), 'a NaN drag moves nothing');
assert.deepEqual(dragOffset('front', 10, 10, Number.NaN), vec3(0, 0, 0), 'nor does a NaN scale');

/* 7. The workbench frame. */
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const panel = fs.readFileSync('app/components/CharacterEditorPanel.tsx', 'utf8');
const viewport = strip(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'));
const customiser = fs.readFileSync('app/components/ProfileCustomiserWindow.tsx', 'utf8');

assert.match(customiser, /import CharacterEditorPanel from '\.\/CharacterEditorPanel'/);
const tabKeys = [...customiser.matchAll(/\{ key: '(\w+)', label: '([^']+)' \}/g)].map((m) => ({ key: m[1], label: m[2] }));
assert.deepEqual(tabKeys.map((entry) => entry.key), ['profile', 'character', 'privacy'], 'CHAR sits between the dressing and the switches');
assert.equal(tabKeys[1].label, '[ CHAR 🐰 ]', 'labelled CHAR with the bunny the owner asked for');
assert.match(customiser, /\{tab === 'character' \?/, 'the workbench has its own tab body');
assert.match(customiser, /maxWidth=\{tab === 'character' \? 'max-w-6xl' : 'max-w-3xl'\}/, 'and the window widens for it, and only for it');

assert.match(viewport, /<View kind="front" label="FRONT"/, 'a front view');
assert.match(viewport, /<View kind="side" label="SIDE"/, 'a side view');
assert.equal((viewport.match(/<View kind=/g) ?? []).length, 2, 'exactly two - the brief asks for front and side');
assert.match(viewport, /sm:grid-cols-2/, 'side by side once there is room for two, stacked on a phone');
assert.match(viewport, /CharacterScene/, 'each view renders the scene');

assert.match(panel, /dynamic\(/, 'the workbench is loaded dynamically');
assert.match(panel, /ssr: false/, 'in the browser only - Three.js touches window at import time');
assert.match(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'), /^'use client'/, 'and it is a client component');

assert.doesNotMatch(viewport, /'#[0-9a-fA-F]{3,6}'/, 'no component writes a hex');
assert.doesNotMatch(viewport, /rounded-(sm|md|lg|xl|full)/, 'and nothing is rounded');
assert.doesNotMatch(viewport, /\btransition\b|duration-/, 'and nothing eases - feedback snaps');

console.log('character workbench checks passed');
console.log(' ---- detail ----');
console.log(`  rig     : ${DEFAULT_JOINT_IDS.length} joints, one root, no cycles, every joint starts at rest`);
console.log(`  shapes  : ${MASS_SHAPE_IDS.length} primitives; the starting figures use ${used.size}`);
console.log('  tree    : parent offsets carry, branches do not leak');
console.log('  values  : plain triples and figures - copied in, copied out, never mutated');
console.log('  layout  : CHAR tab between the dressing and the switches, two views, window widens');
