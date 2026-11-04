/**
 * The free-shape figure, pinning, posing and undo - driven for real in Node.
 *
 * The workbench was rebuilt around free shapes (each pinned to a node) and an undo history. Everything a reader relies
 * on that can be stated as arithmetic is held here, against the real modules:
 *
 *   - the starting figures are well-formed trees with every shape pinned to a node that exists
 *   - pinning, unpinning and re-pinning never move a shape on screen
 *   - a bent limb keeps its length and carries the nodes below it
 *   - a shape pinned to a bone follows it AND turns with it
 *   - a new shape pins to the node it is added at
 *   - a drag is exactly one undo step, a click is none, and undo/redo put back exactly what was there
 *   - the shelf reads v3 and ignores v1 and v2
 *
 * **Updated for simple figures (SPEC-simple-figures.md):** the seven goofy presets went (now BASE, GOBLIN, ROBOT, GUY,
 * five shapes each, on their own small skeletons), so the posing tests use GUY's posable arms; a shape is added by
 * picking a node (`nearestJoint` went with click-to-place); the shelf is v3. The rules held are unchanged.
 *
 * It cannot see pixels or prove a drag feels right; the browser captures do that.
 *
 * Steps:
 *   npx tsc app/lib/character/store.ts --outDir Temp/figure-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'figure-out');
const { buildDefaultFigure, RIG_PRESET_IDS, RIG_PRESETS, DEFAULT_JOINT_IDS, FLOOR_Y } = require(path.join(out, 'rig.js'));
const { rotateVec } = require(path.join(out, 'turns.js'));
const { MASS_DYES } = require(path.join(out, 'palette.js'));
const fig = require(path.join(out, 'figure.js'));
const { validateRig, jointFrames, worldPosition, lengthOf, subtractVec3 } = require(path.join(out, 'skeleton.js'));
const { poseGesture, moveGesture, turnGesture, sizeGesture, screenBox } = require(path.join(out, 'drag.js'));
const { useCharacterStore } = require(path.join(out, 'store.js'));

const near = (a, b, eps = 1e-6, label = '') => assert.ok(Math.abs(a - b) < eps, `${label} ${a} vs ${b}`);
const nearVec = (a, b, eps = 1e-6, label = '') => {
  near(a.x, b.x, eps, `${label}.x`);
  near(a.y, b.y, eps, `${label}.y`);
  near(a.z, b.z, eps, `${label}.z`);
};
/** Two quaternions are the same turn if they are equal or exact opposites. */
const sameTurn = (a, b, label) => {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  near(d, 1, 1e-6, label);
};

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

test('every preset is one tree, five shapes, and every shape is pinned to a node that exists', () => {
  for (const id of RIG_PRESET_IDS) {
    const f = buildDefaultFigure(id);
    assert.deepEqual(validateRig(f.skeleton), [], id);
    assert.ok(Object.keys(f.skeleton.joints).length <= fig.MAX_NODES, `${id} has at most ${fig.MAX_NODES} nodes`);
    assert.equal(f.shapes.length, 5, `${id} is five shapes - a simple figure`);
    for (const shape of f.shapes) assert.ok(f.skeleton.joints[shape.pin], `${shape.name} pinned to ${shape.pin}`);
    assert.equal(new Set(f.shapes.map((s) => s.id)).size, f.shapes.length, 'shape ids unique');
  }
  assert.deepEqual(Object.keys(buildDefaultFigure('base').skeleton.joints), [...DEFAULT_JOINT_IDS], 'BASE is the base skeleton');
});

test('the presets: four, each with a name and a line, standing on one floor, in the dyes', () => {
  assert.equal(RIG_PRESET_IDS.length, 4);
  const dyes = new Set(MASS_DYES.map((dye) => dye.value));
  for (const id of RIG_PRESET_IDS) {
    assert.ok(RIG_PRESETS[id].label.length > 0 && RIG_PRESETS[id].note.length > 0, `${id} has a name and a line`);
    const f = buildDefaultFigure(id);
    const lowest = Math.min(...f.shapes.map((s) => { const b = screenBox(f, s.id, 'front'); return b.centre.y - b.halfUp; }));
    near(lowest, FLOOR_Y, 1e-9, `${id} stands on the floor`);
    for (const shape of f.shapes) assert.ok(dyes.has(shape.colour), `${id} ${shape.name} wears a pickable dye`);
  }
});

test('preset details point the way they should', () => {
  // A cone's tip is its local -y. Each GOBLIN ear sticks straight out to its own side.
  const goblin = buildDefaultFigure('goblin');
  for (const [name, side] of [['EAR L', -1], ['EAR R', 1]]) {
    const ear = goblin.shapes.find((s) => s.name === name);
    const tip = rotateVec(fig.placementOf(goblin, ear).rotation, { x: 0, y: -1, z: 0 });
    assert.ok(Math.sign(tip.x) === side && Math.abs(tip.x) > 0.95, `${name} points outward (tip ${tip.x.toFixed(2)}, ${tip.y.toFixed(2)})`);
  }
  // The nose points forward, out of the face.
  const nose = rotateVec(fig.placementOf(goblin, goblin.shapes.find((s) => s.name === 'NOSE')).rotation, { x: 0, y: -1, z: 0 });
  assert.ok(nose.z > 0.95, 'the GOBLIN NOSE points forward');
  // ROBOT's binocular eyes look out of the front: each cylinder's axis runs front to back.
  const robot = buildDefaultFigure('robot');
  for (const name of ['EYE L', 'EYE R']) {
    const axis = rotateVec(fig.placementOf(robot, robot.shapes.find((s) => s.name === name)).rotation, { x: 0, y: 1, z: 0 });
    assert.ok(Math.abs(axis.z) > 0.95, `the ROBOT ${name} looks forward`);
  }
  // GUY's arms hang from shoulder nodes down to hand nodes, so they can be posed.
  const guy = buildDefaultFigure('guy');
  for (const side of ['left', 'right']) assert.equal(guy.skeleton.joints[`hand.${side}`].parentId, `arm.${side}`);
});

test('pinning, unpinning and re-pinning never move a shape', () => {
  let f = buildDefaultFigure('guy');
  // Pose something first, so the frames involved are not all the identity turn.
  f = poseGesture(f, 'hand.left', 'front', -60, -40, 1 / 150, false);
  const id = f.shapes.find((s) => s.pin === 'arm.left').id;
  const before = fig.placementOf(f, fig.findShape(f, id));

  for (const pin of [null, 'head', 'hand.right', 'arm.left']) {
    f = fig.pinShape(f, id, pin);
    const after = fig.placementOf(f, fig.findShape(f, id));
    nearVec(after.position, before.position, 1e-9, `pin ${pin}`);
    sameTurn(after.rotation, before.rotation, `pin ${pin} turn`);
    assert.equal(fig.findShape(f, id).pin, pin);
  }
});

test('bending keeps the bone length and carries the nodes below', () => {
  const f = buildDefaultFigure('guy');
  const shoulder = worldPosition(f.skeleton, 'arm.left');
  const handBefore = worldPosition(f.skeleton, 'hand.left');
  const arm = lengthOf(subtractVec3(handBefore, shoulder));

  const bent = poseGesture(f, 'hand.left', 'front', -80, -60, 1 / 150, false);
  const handAfter = worldPosition(bent.skeleton, 'hand.left');
  near(lengthOf(subtractVec3(handAfter, shoulder)), arm, 1e-9, 'arm length');
  assert.ok(lengthOf(subtractVec3(handAfter, handBefore)) > 0.1, 'the hand actually moved');
  near(handAfter.z, handBefore.z, 1e-9, 'a FRONT drag never changes depth');

  // Bending the shoulder swings it round the body node, and the hand below comes with it.
  const shrug = poseGesture(f, 'arm.left', 'front', -20, -30, 1 / 150, false);
  const carried = subtractVec3(worldPosition(shrug.skeleton, 'hand.left'), worldPosition(shrug.skeleton, 'arm.left'));
  near(lengthOf(carried), arm, 1e-9, 'the hand stays an arm away from the shoulder');
  assert.ok(lengthOf(subtractVec3(worldPosition(shrug.skeleton, 'hand.left'), handBefore)) > 0.05, 'and moved with it');

  const stretched = poseGesture(f, 'hand.left', 'front', 0, 30, 1 / 150, true);
  near(lengthOf(subtractVec3(worldPosition(stretched.skeleton, 'hand.left'), shoulder)), 0.62 + 0.2, 1e-9, 'stretch changes length');
});

test('a shape pinned to a bone follows it and turns with it', () => {
  const f = buildDefaultFigure('guy');
  const arm = f.shapes.find((s) => s.pin === 'arm.left');
  const before = fig.placementOf(f, arm);
  const shoulder = worldPosition(f.skeleton, 'arm.left');

  // Swing the arm straight out to the side: the hand goes from below the shoulder to level with it.
  const hand = worldPosition(f.skeleton, 'hand.left');
  const dx = (-0.62 - (hand.x - shoulder.x)) * 150;
  const dy = -(shoulder.y - hand.y) * 150;
  const bent = poseGesture(f, 'hand.left', 'front', dx, dy, 1 / 150, false);
  const after = fig.placementOf(bent, fig.findShape(bent, arm.id));

  // Its centre swung from below the shoulder to beside it, at the same distance.
  near(lengthOf(subtractVec3(after.position, shoulder)), lengthOf(subtractVec3(before.position, shoulder)), 1e-6, 'distance');
  near(after.position.y, shoulder.y, 1e-6, 'now level with the shoulder');
  assert.ok(after.position.x < shoulder.x - 0.2, 'now out to the left');
  // And it turned a quarter turn about the view axis.
  const frames = jointFrames(bent.skeleton);
  near(Math.abs(frames['arm.left'].rotation.z), Math.sin(Math.PI / 4), 1e-6, 'quarter turn');

  // The hand, which has no bone of its own, turns with its arm.
  sameTurn(frames['hand.left'].rotation, frames['arm.left'].rotation, 'hand borrows the arm turn');
});

test('a new shape added at a node pins to it, lands on it, and goes to the top of the list', () => {
  const f = buildDefaultFigure('guy');
  const hand = worldPosition(f.skeleton, 'hand.left');
  const result = fig.addShape(f, { kind: 'sphere', at: hand, pin: 'hand.left' });
  const shape = fig.findShape(result.figure, result.id);
  assert.equal(shape.pin, 'hand.left');
  nearVec(fig.placementOf(result.figure, shape).position, hand, 1e-9, 'lands on the node');
  assert.equal(result.figure.shapes[0].id, result.id, 'new shapes go to the top of the list');
});

test('move, turn and size gestures do what their names say, from the start of the drag', () => {
  const f = buildDefaultFigure('base');
  const head = f.shapes.find((s) => s.name === 'HEAD');
  const start = fig.placementOf(f, head);

  const moved = moveGesture(f, head.id, 'side', 30, 0, 1 / 150);
  nearVec(fig.placementOf(moved, fig.findShape(moved, head.id)).position, { ...start.position, z: start.position.z + 0.2 }, 1e-9, 'SIDE right is +z');

  // Grab to the right of centre, sweep up to above it: a quarter turn anticlockwise on screen, about +z in FRONT.
  const turned = turnGesture(f, head.id, 'front', { right: 0.3, up: 0 }, -45, -45, 1 / 150);
  const q = fig.placementOf(turned, fig.findShape(turned, head.id)).rotation;
  near(q.z, Math.sin(Math.PI / 4), 1e-6, 'turned about +z');

  const sized = sizeGesture(f, head.id, 'front', { h: 1, v: 0 }, 15, 0, 1 / 150);
  near(fig.findShape(sized, head.id).size.x, head.size.x + 0.2, 1e-9, 'wider by twice the drag');
  near(fig.findShape(sized, head.id).size.y, head.size.y, 1e-9, 'height untouched');
  const crushed = sizeGesture(f, head.id, 'front', { h: 1, v: 0 }, -5000, 0, 1 / 150);
  near(fig.findShape(crushed, head.id).size.x, fig.MIN_EXTENT, 1e-9, 'never smaller than the floor');
});

test('a drag is one undo step, a click is none, and undo/redo restore exactly', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const opening = fig.fingerprint(store.getState().figure);
  const head = store.getState().figure.shapes.find((s) => s.name === 'HEAD');

  // A click: begin and end without moving.
  store.getState().beginGesture({ kind: 'move', shapeId: head.id, view: 'front', upp: 1 / 150 });
  store.getState().endGesture();
  assert.equal(store.getState().past.length, 0, 'a click files nothing');

  // A drag across many frames.
  store.getState().beginGesture({ kind: 'move', shapeId: head.id, view: 'front', upp: 1 / 150 });
  for (let i = 1; i <= 20; i += 1) store.getState().updateGesture(i * 3, -i);
  store.getState().endGesture();
  const dragged = fig.fingerprint(store.getState().figure);
  assert.notEqual(dragged, opening);
  assert.equal(store.getState().past.length, 1, 'twenty frames, one step');

  store.getState().setColour(head.id, '#FF00A0');
  assert.equal(store.getState().past.length, 2);
  store.getState().setColour('no-such-shape', '#FF00A0');
  assert.equal(store.getState().past.length, 2, 'an edit that changed nothing is not filed');

  store.getState().undo();
  assert.equal(fig.fingerprint(store.getState().figure), dragged);
  store.getState().undo();
  assert.equal(fig.fingerprint(store.getState().figure), opening);
  store.getState().undo();
  assert.equal(fig.fingerprint(store.getState().figure), opening, 'undo past the start does nothing');
  store.getState().redo();
  assert.equal(fig.fingerprint(store.getState().figure), dragged);

  // A new edit after an undo drops the redo list.
  store.getState().deleteShape(head.id);
  assert.equal(store.getState().future.length, 0);
  assert.equal(store.getState().selectedShapeId, null, 'deleting the selected shape clears the selection');
  store.getState().undo();
  assert.ok(fig.findShape(store.getState().figure, head.id), 'undo brings a deleted shape back');
});

test('adding through the store (ADD, a node, ✓) selects the new shape and is one undo step', () => {
  const store = useCharacterStore;
  store.getState().reset();
  store.getState().startPlacing({ what: 'shape', kind: 'cone' });
  assert.equal(store.getState().tool, 'add', 'picking a kind arms ADD');
  store.getState().pickPlacingNode('head');
  store.getState().confirmPlacing();
  const added = store.getState().figure.shapes[0];
  assert.equal(added.kind, 'cone');
  assert.equal(store.getState().selectedShapeId, added.id);
  assert.equal(store.getState().past.length, 1);
  assert.equal(store.getState().tool, 'select', 'and SELECT is back in hand');
});

test('throwing changes away puts back exactly the kept figure, so nothing is left unsaved', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const kept = store.getState().keptFigure;
  store.getState().startPlacing({ what: 'shape', kind: 'box' });
  store.getState().pickPlacingNode('body');
  store.getState().confirmPlacing();
  store.getState().setColour(store.getState().figure.shapes[1].id, '#FF00A0');
  assert.notEqual(fig.fingerprint(store.getState().figure), kept, 'the bench was edited');
  store.getState().revert();
  assert.equal(fig.fingerprint(store.getState().figure), kept, 'and is back to the kept figure, byte for byte');
  assert.equal(store.getState().past.length, 0, 'with no history to undo into');
  assert.equal(store.getState().selectedShapeId, null, 'and nothing picked');
});

test('a damaged saved figure is repaired or refused, never half-drawn', () => {
  const f = buildDefaultFigure('base');
  const copy = JSON.parse(JSON.stringify(f));
  copy.shapes[0].kind = 'teapot';
  copy.shapes[1].size = { x: 99, y: -1, z: 0.5 };
  copy.shapes[2].pin = 'tail';
  copy.shapes[3].colour = '#123456';
  const read = fig.readFigure(copy);
  assert.equal(read.shapes.length, f.shapes.length - 1, 'unknown kind dropped');
  assert.deepEqual(read.shapes[0].size, { x: fig.MAX_EXTENT, y: fig.MIN_EXTENT, z: 0.5 }, 'sizes clamped');
  assert.equal(read.shapes[1].pin, null, 'missing joint unpinned, shape kept');
  assert.equal(read.shapes[2].colour, null, 'unknown colour back to the figure colour');
  assert.equal(fig.readFigure({ skeleton: { joints: {}, rootId: 'hips' }, shapes: [] }), null, 'no root, no figure');
  assert.equal(fig.fingerprint(fig.readFigure(JSON.parse(JSON.stringify(f)))), fig.fingerprint(f), 'a clean figure round-trips exactly');
});

test('the shelf is v3, and reads simple figures rather than v2 ones', () => {
  const library = fs.readFileSync('app/lib/character/library.ts', 'utf8');
  assert.match(library, /'debaser\.character\.library\.v3'/);
  assert.doesNotMatch(library, /library\.v[12]'/);
  assert.match(library, /readFigure\(record\.figure\)/);
});

console.log(`\ncheck-character-figure: ${passed} passed`);
