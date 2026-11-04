/**
 * Simple figures (SPEC-simple-figures.md): touching, validity, sag, the caps, the presets, and the placement flow -
 * driven for real in Node against the compiled modules.
 *
 *   - touching is measured on the real outlines (a sphere beside a box is not touching across the box's empty corner),
 *     and each primitive's outline matches the mesh the views draw
 *   - validity: a bare node, a loose shape, a cut-off shape, an unpinned shape; hidden shapes left out
 *   - the save refusal names the first problem and counts the rest
 *   - sag: levels 0 and 1 do not sag; x2 per level down; +25% per sibling sagger; a long shape hanging down sags far
 *     less than the same shape sticking out sideways; it is drawn only (the figure's numbers never change); it
 *     follows the pose; SAG % never passes 100
 *   - the caps: 7 shapes, 7 nodes, and every way of adding refuses at the cap
 *   - the presets: BASE, GOBLIN, ROBOT, GUY - five shapes each, valid, no sag
 *   - placing: a shape or a node is one undo step; ✗ puts back exactly the figure from before; ✓ is refused while the
 *     new shape touches nothing; adding or deleting a node never moves a shape, even on a posed figure
 *   - the pixel counter counts what the render filled, and a shape's weight is its front outline in blocks
 *
 * It cannot see pixels: `Temp/char-drive.cjs` compares the PIXELS stat with a real front render in Chrome.
 *
 * Steps:
 *   npx tsc app/lib/character/store.ts app/lib/character/sag.ts app/lib/character/library.ts --outDir Temp/simple-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/character/geometry.ts --outDir Temp/simple-geometry --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CharacterPixelRender.tsx --outDir Temp/simple-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 */
const assert = require('node:assert/strict');
const path = require('node:path');

process.removeAllListeners('warning');
const out = path.join(__dirname, 'simple-out');
const { buildDefaultFigure, RIG_PRESET_IDS, RIG_PRESETS } = require(path.join(out, 'rig.js'));
const fig = require(path.join(out, 'figure.js'));
const { structureOf, saveRefusal, problemText, brokenShapes, bareNodes } = require(path.join(out, 'structure.js'));
const { sagOf, SAG } = require(path.join(out, 'sag.js'));
const touch = require(path.join(out, 'touch.js'));
const { jointFrames, bendJoint } = require(path.join(out, 'skeleton.js'));
const { quatFromEuler, IDENTITY } = require(path.join(out, 'turns.js'));
const { poseGesture } = require(path.join(out, 'drag.js'));
const { useCharacterStore, placingBlock } = require(path.join(out, 'store.js'));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};
const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);

/** A figure from plain parts: a skeleton of `nodes` ([id, parent, x, y, z]) and boxes (or other kinds) in the world. */
function build(nodes, shapes) {
  const joints = {};
  for (const [id, parentId, x, y, z] of nodes) {
    joints[id] = { id, parentId, position: { x, y, z }, rest: { x, y, z } };
  }
  const figure = { skeleton: { joints, rootId: nodes[0][0] }, shapes: [] };
  const frames = jointFrames(figure.skeleton);
  figure.shapes = shapes.map((s, index) => {
    const pin = s.pin ?? nodes[0][0];
    const at = frames[pin].position;
    return {
      id: s.id ?? `s${index + 1}`,
      name: s.name ?? `S${index + 1}`,
      kind: s.kind ?? 'box',
      colour: null,
      hidden: s.hidden ?? false,
      pin,
      position: { x: s.at[0] - at.x, y: s.at[1] - at.y, z: s.at[2] - at.z },
      rotation: s.turn ?? { x: 0, y: 0, z: 0 },
      size: { x: s.size[0], y: s.size[1], z: s.size[2] },
    };
  });
  return figure;
}

const ROOT = [['root', null, 0, 0, 0]];
const deg = (radians) => (radians * 180) / Math.PI;
/** How far a rotation turns (0 to pi): a shape built square to the world is drawn turned by exactly this. */
const turnOf = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

/* ---------------------------------------------------------------- touching */

test('touching is measured on real outlines: a sphere off a box corner is not touching, though their boxes overlap', () => {
  const box = { kind: 'box', position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 1, y: 1, z: 1 } };
  const k = 0.4; // the sphere's centre, along the diagonal past the corner: gap = k * sqrt(2) - 0.5 = 0.066
  const sphere = { kind: 'sphere', position: { x: 0.5 + k, y: 0.5 + k, z: 0 }, rotation: IDENTITY, size: { x: 1, y: 1, z: 1 } };
  near(touch.solidGap(box, sphere), k * Math.SQRT2 - 0.5, 1e-4, 'the gap is the real one');
  assert.ok(!touch.solidsTouch(box, sphere), 'so they do not touch, although their bounding boxes overlap by 0.4');
  const closer = { ...sphere, position: { x: 0.5 + 0.36, y: 0.5 + 0.36, z: 0 } };
  assert.ok(touch.solidsTouch(box, closer), 'and moved in until the gap is under TOUCH_GAP, they do');
});

test('distances are exact for known cases, and zero for anything overlapping', () => {
  const sphere = (x, r) => ({ kind: 'sphere', position: { x, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 2 * r, y: 2 * r, z: 2 * r } });
  near(touch.solidGap(sphere(0, 0.3), sphere(1, 0.2)), 0.5, 1e-5, 'two spheres');
  const box = (x, y, w) => ({ kind: 'box', position: { x, y, z: 0 }, rotation: IDENTITY, size: { x: w, y: w, z: w } });
  near(touch.solidGap(box(0, 0, 1), box(1.2, 0.3, 0.2)), 0.6, 1e-6, 'two boxes, face to face');
  // A plus sign: two thin bars crossing, no corner of either inside the other. Sampling misses this; GJK does not.
  const across = { kind: 'box', position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 2, y: 0.04, z: 0.04 } };
  const down = { kind: 'box', position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 0.04, y: 2, z: 0.04 } };
  near(touch.solidGap(across, down), 0, 1e-9, 'two crossing bars overlap');
  // A node inside a shape, on its surface, and just off it.
  near(touch.pointGap({ x: 0, y: 0, z: 0 }, box(0, 0, 1)), 0, 1e-9, 'a node inside');
  near(touch.pointGap({ x: 0.52, y: 0, z: 0 }, box(0, 0, 1)), 0.02, 1e-6, 'a node just off a face');
  // Turned: a box turned 45 degrees about z reaches sqrt(0.5) along x.
  const turned = { ...box(0, 0, 1), rotation: quatFromEuler({ x: 0, y: 0, z: Math.PI / 4 }) };
  near(touch.pointGap({ x: 0.8, y: 0, z: 0 }, turned), 0.8 - Math.SQRT1_2, 1e-6, 'a turned box');
});

test('each primitive outline is the mesh the views draw (support vs the real three.js vertices)', () => {
  const { unitGeometry } = require(path.join(__dirname, 'simple-geometry', 'geometry.js'));
  for (const kind of ['box', 'sphere', 'cone', 'cylinder', 'capsule', 'wedge', 'prism']) {
    const positions = unitGeometry(kind).getAttribute('position');
    let worst = 0;
    for (let i = 0; i < 400; i += 1) {
      const a = Math.acos(1 - 2 * ((i + 0.5) / 400));
      const b = i * 2.399963;
      const d = { x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b) };
      let mesh = -Infinity;
      for (let v = 0; v < positions.count; v += 1) {
        mesh = Math.max(mesh, positions.getX(v) * d.x + positions.getY(v) * d.y + positions.getZ(v) * d.z);
      }
      const s = touch.unitSupport(kind, d);
      worst = Math.max(worst, Math.abs(mesh - (s.x * d.x + s.y * d.y + s.z * d.z)));
    }
    // Round primitives are drawn with 10-14 sides (a capsule's caps with only 4 rings), so the ideal outline can stand
    // up to 3% of the size proud of the mesh - on a 0.3-unit shape, under a third of TOUCH_GAP.
    assert.ok(worst < 0.03, `${kind}: the outline used for touching is within ${worst.toFixed(4)} of the drawn mesh`);
    // And the inside test agrees with the support: the support point is on the surface, a little inwards is inside.
    for (const d of [{ x: 1, y: 0.2, z: 0.1 }, { x: -0.3, y: -1, z: 0.2 }, { x: 0.1, y: 0.4, z: -1 }]) {
      const s = touch.unitSupport(kind, d);
      assert.ok(touch.insideUnit(kind, { x: s.x * 0.98, y: s.y * 0.98, z: s.z * 0.98 }), `${kind} inside just in from its support`);
    }
  }
});

/* ---------------------------------------------------------------- validity */

test('the presets: BASE, GOBLIN, ROBOT, GUY - five shapes each, valid, no sag, nodes within the cap', () => {
  assert.deepEqual([...RIG_PRESET_IDS], ['base', 'goblin', 'robot', 'guy']);
  for (const id of RIG_PRESET_IDS) {
    const f = buildDefaultFigure(id);
    assert.ok(RIG_PRESETS[id].label.length > 0 && RIG_PRESETS[id].note.length > 0, `${id} has a name and a line`);
    assert.equal(f.shapes.length, 5, `${id} is exactly five shapes`);
    assert.ok(Object.keys(f.skeleton.joints).length <= fig.MAX_NODES, `${id} has at most ${fig.MAX_NODES} nodes`);
    assert.deepEqual(structureOf(f).problems, [], `${id} ships valid`);
    assert.equal(saveRefusal(f), null, `${id} can be saved as it is`);
    assert.equal(sagOf(f).share, 0, `${id} has no sag at rest`);
    for (const shape of f.shapes) assert.ok(f.skeleton.joints[shape.pin], `${id} ${shape.name} is pinned to a node`);
  }
  assert.equal(Object.keys(buildDefaultFigure('base').skeleton.joints).length, 3, 'the base skeleton is three nodes');
  assert.deepEqual(Object.keys(buildDefaultFigure('base').skeleton.joints), ['hips', 'body', 'head'], 'hips, body, head');
});

test('validity: a bare node, a loose shape, a cut-off shape and an unpinned shape are each named', () => {
  const base = buildDefaultFigure('base');
  const body = base.shapes.find((s) => s.name === 'BODY');

  // Deleting BODY leaves the body node bare.
  const noBody = fig.removeShape(base, body.id);
  assert.deepEqual(bareNodes(noBody), ['body'], 'the body node has no shape round it');
  assert.equal(saveRefusal(noBody), "CAN'T SAVE: NODE BODY HAS NO SHAPE AROUND IT");

  // A shape far away from everything.
  const far = fig.addShape(base, { kind: 'cone', at: { x: 0.9, y: 1.2, z: 0 }, pin: 'head' });
  const loose = fig.renameShape(far.figure, far.id, 'CONE 2');
  assert.equal(brokenShapes(loose)[far.id], "CONE 2 ISN'T TOUCHING ANYTHING");
  assert.equal(saveRefusal(loose), "CAN'T SAVE: CONE 2 ISN'T TOUCHING ANYTHING", 'the spec\'s own example');

  // A second shape touching only the loose one: touching something, but nothing connected to a node.
  const tail = fig.addShape(loose, { kind: 'box', at: { x: 0.9, y: 1.4, z: 0 }, pin: 'head' });
  assert.equal(problemText(tail.figure, structureOf(tail.figure).problems.find((p) => p.id === tail.id)), "BOX 1 ISN'T CONNECTED TO A NODE");
  assert.equal(saveRefusal(tail.figure), "CAN'T SAVE: BOX 1 ISN'T CONNECTED TO A NODE (AND 1 MORE)", 'the first problem, and a count of the rest');

  // Unpinned, though still touching.
  const unpinned = fig.pinShape(base, base.shapes[0].id, null);
  assert.equal(saveRefusal(unpinned), "CAN'T SAVE: HEAD ISN'T PINNED TO A NODE");

  // Hidden shapes count for nothing - not touching, not as a problem.
  const hidden = fig.setShapeHidden(base, base.shapes[0].id, true);
  assert.deepEqual(bareNodes(hidden), ['head'], 'hiding the head leaves its node bare');
  assert.equal(brokenShapes(hidden)[base.shapes[0].id], undefined, 'and the hidden head is not itself reported');
  const hiddenLoose = fig.setShapeHidden(loose, far.id, true);
  assert.equal(saveRefusal(hiddenLoose), null, 'a hidden loose shape does not block saving');
});

test('levels are the shortest path from a node, and a deleted support marks what hung from it (not deletes it)', () => {
  const f = build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.1] },
    { name: 'A2', at: [0.78, 0, 0], size: [0.4, 0.1, 0.1] },
    { name: 'A3', at: [1.17, 0, 0], size: [0.4, 0.1, 0.1] },
  ]);
  const { level } = structureOf(f);
  assert.deepEqual([level.s1, level.s2, level.s3, level.s4], [0, 1, 2, 3]);
  const cut = fig.removeShape(f, 's2');
  assert.equal(cut.shapes.length, 3, 'deleting A1 deletes nothing else');
  assert.deepEqual(Object.keys(brokenShapes(cut)).sort(), ['s3', 's4'], 'but A2 and A3 are marked');
});

/* ---------------------------------------------------------------- sag */

/** A chain sticking out sideways from a core on the root node: CORE (level 0), then identical bars. */
function chain(extra = []) {
  return build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.1] },
    { name: 'A2', at: [0.78, 0, 0], size: [0.4, 0.1, 0.1] },
    { name: 'A3', at: [1.17, 0, 0], size: [0.4, 0.1, 0.1] },
    ...extra,
  ]);
}

test('sag: levels 0 and 1 do not sag; each further level doubles; a sagger drags its support down a little', () => {
  const sag = sagOf(chain());
  assert.equal(sag.own.s1, undefined, 'level 0: no sag');
  assert.equal(sag.own.s2, undefined, 'level 1: no sag of its own');
  assert.ok(sag.own.s3 > 0, `level 2 sags (${deg(sag.own.s3).toFixed(2)} degrees)`);
  near(sag.own.s4 / sag.own.s3, SAG.perLevel, 1e-6, 'level 3 sags twice as much as an identical level 2');
  assert.ok(sag.tip.s2 > 0, 'and the level-1 bar is dragged down a little by what hangs off it');
  near(sag.tip.s2, SAG.supportDrag * sag.tip.s3, 1e-9, 'by its share of the sagger below');
});

test('sag: another sagger on the same support at the same level adds a quarter (125%, then 150%)', () => {
  const one = sagOf(build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.4] },
    { name: 'B', at: [0.78, 0, 0], size: [0.4, 0.1, 0.1] },
  ])).own.s3;
  const sibling = (z) => ({ name: `B${z}`, at: [0.78, 0, z], size: [0.4, 0.1, 0.1] });
  const two = sagOf(build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.4] },
    { name: 'B', at: [0.78, 0, 0], size: [0.4, 0.1, 0.1] },
    sibling(0.15),
  ])).own.s3;
  const three = sagOf(build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.4] },
    { name: 'B', at: [0.78, 0, 0], size: [0.4, 0.1, 0.1] },
    sibling(0.15),
    sibling(-0.15),
  ])).own.s3;
  near(two / one, 1 + SAG.perSibling, 1e-6, 'two saggers: each sags 125%');
  near(three / one, 1 + 2 * SAG.perSibling, 1e-6, 'three: 150%');
});

test('sag: a long shape hanging straight down sags far less than the same shape sticking out sideways', () => {
  const base = [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.1] },
  ];
  const leg = build(ROOT, [...base, { name: 'LEG', at: [0.55, -0.29, 0], size: [0.1, 0.5, 0.1] }]);
  const arm = build(ROOT, [...base, { name: 'ARM', at: [0.79, 0, 0], size: [0.5, 0.1, 0.1] }]);
  assert.equal(structureOf(leg).level.s3, 2);
  assert.equal(structureOf(arm).level.s3, 2);
  const solids = (f) => structureOf(f).solids.s3;
  near(touch.outlinePixels(solids(leg)), touch.outlinePixels(solids(arm)), 1e-6, 'the same weight (pixel count)');
  const hanging = sagOf(leg).own.s3;
  const sideways = sagOf(arm).own.s3;
  assert.ok(hanging < sideways * 0.15, `hanging ${deg(hanging).toFixed(2)} vs sideways ${deg(sideways).toFixed(2)} degrees`);
  // And heavier sags more: the same arm, twice as thick, has twice the pixels.
  const fat = build(ROOT, [...base, { name: 'ARM', at: [0.79, 0, 0], size: [0.5, 0.2, 0.1] }]);
  assert.ok(sagOf(fat).own.s3 > sideways * 1.8, 'twice the pixels, about twice the sag');
});

test('sag is drawn only: the figure keeps its numbers, saves and loads as built, and the shape visibly tips down', () => {
  const f = chain();
  const before = JSON.stringify(f);
  const sag = sagOf(f);
  assert.equal(JSON.stringify(f), before, 'working out the sag changed nothing in the figure');
  const built = structureOf(f).solids.s4.position;
  const drawn = sag.placements.s4.position;
  assert.ok(drawn.y < built.y - 0.01, `A3 is drawn lower than it is built (${drawn.y.toFixed(3)} vs ${built.y.toFixed(3)})`);
  const again = fig.readFigure(JSON.parse(JSON.stringify(f)));
  assert.equal(JSON.stringify(again), before, 'read back exactly as built');
  assert.ok(sag.share > 0 && sag.share <= 1, `SAG ${Math.round(sag.share * 100)}% is within 0..100`);
});

test('SAG % never passes 100: a huge sagger tips at most to hanging straight down', () => {
  const f = build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.1, 0.1] },
    { name: 'BIG', at: [1.38, 0, 0], size: [2, 0.6, 0.6] },
  ]);
  const sag = sagOf(f);
  assert.equal(sag.share, 1, 'clamped at 100%');
  const centre = sag.placements.s3.position;
  const pivot = structureOf(f).solids.s2.position;
  assert.ok(centre.y < pivot.y - 0.5 && Math.abs(centre.x - pivot.x) < 0.5, 'and it hangs below where it meets A1');
  // Built pointing straight out, it is drawn turned exactly a quarter turn - hanging, not swung back past it, although
  // A1 (which it is carried by) was dragged down too.
  // (Within 0.6 degrees: the contact point is sampled, so "straight out" is measured to about a tenth of a degree.)
  near(turnOf(sag.placements.s3.rotation), Math.PI / 2, 0.01, 'BIG turns to hanging, counting what A1 carried it');
  assert.ok(sag.tip.s2 > 0, 'A1 was dragged down');
});

test('a chain of tips never swings a shape past hanging, and SAG % counts what each shape is carried by', () => {
  // The review's case: heavy bars all sticking out the same way, so every tip turns about the same axis and adds up.
  const f = build(ROOT, [
    { name: 'CORE', at: [0, 0, 0], size: [0.4, 0.4, 0.4] },
    { name: 'A1', at: [0.39, 0, 0], size: [0.4, 0.3, 0.3] },
    { name: 'A2', at: [0.78, 0, 0], size: [0.4, 0.3, 0.3] },
    { name: 'A3', at: [1.17, 0, 0], size: [0.4, 0.3, 0.3] },
  ]);
  const sag = sagOf(f);
  const turns = ['s2', 's3', 's4'].map((id) => turnOf(sag.placements[id].rotation));
  for (const [index, turn] of turns.entries()) {
    assert.ok(turn <= Math.PI / 2 + 0.01, `A${index + 1} turns ${deg(turn).toFixed(1)} degrees: never past hanging`);
  }
  assert.ok(turns[2] > sag.tip.s4 + 1e-6, 'A3 turns by more than its own tip: it is carried by A2 and A1 as well');
  near(sag.share, Math.min(1, Math.max(...turns) / (Math.PI / 2)), 1e-9, 'and SAG % is the biggest whole turn, not the biggest own tip');
});

test('sag follows the pose: swing an arm out sideways and what hangs off it sags more', () => {
  let f = buildDefaultFigure('guy');
  const hand = jointFrames(f.skeleton)['hand.left'].position;
  const one = fig.addShape(f, { kind: 'box', at: { x: hand.x, y: hand.y - 0.14, z: 0 }, pin: 'arm.left' });
  f = fig.setShapeNumbers(one.figure, one.id, { size: { x: 0.14, y: 0.14, z: 0.14 } });
    // Long, hanging straight down from the hand: it barely sags until the arm swings out and it sticks out sideways.
  const two = fig.addShape(f, { kind: 'box', at: { x: hand.x - 0.05, y: hand.y - 0.36, z: 0 }, pin: 'arm.left' });
  f = fig.setShapeNumbers(two.figure, two.id, { size: { x: 0.1, y: 0.3, z: 0.1 } });
  assert.equal(f.shapes.length, fig.MAX_SHAPES);
  assert.equal(structureOf(f).level[one.id], 1, 'a hand hanging off the arm (level 1)');
  assert.equal(structureOf(f).level[two.id], 2, 'and a level-2 shape hanging off the hand');
  const hanging = sagOf(f).share;
  // Swing the arm straight out to the left, at shoulder height.
  const shoulder = jointFrames(f.skeleton)['arm.left'].position;
  const swungOut = { ...f, skeleton: bendJoint(f.skeleton, 'hand.left', { x: shoulder.x - 0.62, y: shoulder.y, z: 0 }) };
  assert.equal(structureOf(swungOut).level[two.id], 2, 'still level 2 when posed');
  const swung = sagOf(swungOut).share;
  assert.ok(swung > hanging * 2, `more sag with the arm out (${Math.round(hanging * 100)}% -> ${Math.round(swung * 100)}%)`);
});

/* ---------------------------------------------------------------- caps */

test('the caps: seven shapes and seven nodes, and every way of adding refuses past them', () => {
  assert.equal(fig.MAX_SHAPES, 7);
  assert.equal(fig.MAX_NODES, 7);
  let f = buildDefaultFigure('base');
  f = fig.addShape(f, { kind: 'box', at: { x: 0, y: 0, z: 0 }, pin: 'hips' }).figure;
  f = fig.addShape(f, { kind: 'box', at: { x: 0, y: 0, z: 0 }, pin: 'hips' }).figure;
  assert.equal(f.shapes.length, 7);
  assert.equal(fig.addShape(f, { kind: 'box', at: { x: 0, y: 0, z: 0 }, pin: 'hips' }).id, null, 'an eighth shape is refused');
  assert.equal(fig.duplicateShape(f, f.shapes[0].id).id, null, 'and so is duplicating one');

  const guy = buildDefaultFigure('guy');
  assert.equal(Object.keys(guy.skeleton.joints).length, 7);
  assert.equal(fig.addNode(guy, 'head', { x: 0, y: 0, z: 0 }).id, null, 'an eighth node is refused');

  const store = useCharacterStore;
  store.getState().loadFigure(f, 'base');
  store.getState().startPlacing({ what: 'shape', kind: 'cone' });
  assert.equal(store.getState().placing, null, 'ADD does not start at seven shapes');
  store.getState().loadFigure(guy, 'guy');
  store.getState().startPlacing({ what: 'node' });
  assert.equal(store.getState().placing, null, '+NODE does not start at seven nodes');
  const many = { skeleton: guy.skeleton, shapes: [...guy.shapes, ...guy.shapes.map((s) => ({ ...s, id: `${s.id}x` }))] };
  assert.equal(fig.readFigure(JSON.parse(JSON.stringify(many))).shapes.length, 7, 'a stored figure is read with seven shapes at most');
  const bigRig = JSON.parse(JSON.stringify(guy));
  bigRig.skeleton.joints.extra = { id: 'extra', parentId: 'head', position: { x: 0, y: 0.1, z: 0 }, rest: { x: 0, y: 0.1, z: 0 } };
  assert.equal(fig.readFigure(bigRig), null, 'and a stored figure with eight nodes is dropped');
});

/* ---------------------------------------------------------------- placing */

test('ADD: pick a node, the shape appears on it pinned to it; drags file nothing; ✓ is one undo step', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const start = store.getState().figure;
  store.getState().startPlacing({ what: 'shape', kind: 'cone' });
  assert.equal(store.getState().placing.stage, 'node', 'first, a node is picked');
  assert.equal(store.getState().figure, start, 'nothing has changed yet');
  store.getState().pickPlacingNode('head');
  const placing = store.getState().placing;
  assert.equal(placing.stage, 'place');
  const shape = fig.findShape(store.getState().figure, placing.id);
  assert.equal(shape.pin, 'head', 'pinned to the node picked');
  const at = fig.placementOf(store.getState().figure, shape).position;
  const head = jointFrames(start.skeleton).head.position;
  // (2026-11-04) Placing changed on purpose (place.ts): the new shape starts on the node's ring and follows the pointer.
  near(Math.hypot(at.x - head.x, at.y - head.y, at.z - head.z), placing.radius, 1e-9, 'and it appears on the node\'s ring');
  assert.equal(placingBlock(store.getState().figure, placing), null, 'touching its node, it can be kept');

  store.getState().beginGesture({ kind: 'place', view: 'front', upp: 0.01 });
  store.getState().updateGesture(20, 0);
  store.getState().endGesture();
  store.getState().beginGesture({ kind: 'place', view: 'side', upp: 0.01 });
  store.getState().updateGesture(10, -5);
  store.getState().endGesture();
  assert.equal(store.getState().past.length, 0, 'the drags filed nothing');
  // Dragged far away: touching nothing, ✓ refuses, with the reason.
  store.getState().beginGesture({ kind: 'place', view: 'front', upp: 0.01 });
  store.getState().updateGesture(150, 0);
  store.getState().endGesture();
  assert.match(placingBlock(store.getState().figure, store.getState().placing), /CONE 1 ISN'T TOUCHING ANYTHING/);
  store.getState().confirmPlacing();
  assert.notEqual(store.getState().placing, null, '✓ refused while it touches nothing');
  store.getState().beginGesture({ kind: 'place', view: 'front', upp: 0.01 });
  // (2026-11-04) The shape now starts on the ring (place.ts), only just touching its node, so the two small drags
  // above already carry it clear. Back in touch means back to where it started: undo all three drags, not just the far one.
  store.getState().updateGesture(-170, 0);
  store.getState().endGesture();
  store.getState().beginGesture({ kind: 'place', view: 'side', upp: 0.01 });
  store.getState().updateGesture(-10, 5);
  store.getState().endGesture();
  assert.equal(placingBlock(store.getState().figure, store.getState().placing), null, 'back at its start it touches again');
  store.getState().confirmPlacing();
  assert.equal(store.getState().placing, null, 'back in touch, ✓ keeps it');
  assert.equal(store.getState().past.length, 1, 'as one undo step');
  assert.equal(store.getState().figure.shapes.length, 6);
  assert.equal(store.getState().selectedShapeId, placing.id, 'and the new shape is picked');
  store.getState().undo();
  assert.equal(fig.fingerprint(store.getState().figure), fig.fingerprint(start), 'one UNDO takes the whole placement away');
});

test('✗ (and ESC, which calls the same thing) puts the figure back exactly; other tools and NEW abandon it too', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const start = store.getState().figure;
  store.getState().startPlacing({ what: 'shape', kind: 'box' });
  store.getState().pickPlacingNode('body');
  store.getState().beginGesture({ kind: 'place', view: 'front', upp: 0.01 });
  store.getState().updateGesture(30, 10);
  store.getState().endGesture();
  store.getState().cancelPlacing();
  assert.equal(store.getState().figure, start, 'the very figure from before');
  assert.equal(store.getState().placing, null);
  assert.equal(store.getState().past.length, 0, 'with nothing filed');

  store.getState().startPlacing({ what: 'shape', kind: 'box' });
  store.getState().pickPlacingNode('body');
  store.getState().setTool('move');
  assert.equal(store.getState().figure, start, 'another tool abandons it');
  store.getState().startPlacing({ what: 'node' });
  store.getState().pickPlacingNode('body');
  store.getState().setPresetPicker(true);
  assert.equal(store.getState().figure, start, 'and so does NEW');
  store.getState().setPresetPicker(false);

  store.getState().startPlacing({ what: 'shape', kind: 'box' });
  store.getState().pickPlacingNode('body');
  store.getState().undo();
  assert.notEqual(store.getState().placing, null, 'UNDO waits while placing (✗ is the way back)');
  store.getState().beginGesture({ kind: 'move', shapeId: start.shapes[0].id, view: 'front', upp: 0.01 });
  assert.equal(store.getState().gesture, null, 'and nothing else can be grabbed meanwhile');
  store.getState().revert();
  assert.equal(store.getState().placing, null, 'throwing changes away ends the placement too');
  store.getState().startPlacing({ what: 'shape', kind: 'box' });
  store.getState().pickPlacingNode('body');
  store.getState().loadFigure(buildDefaultFigure('guy'), 'guy');
  assert.equal(store.getState().placing, null, 'and so does loading a figure off the shelf');
  assert.equal(store.getState().tool, 'select', 'which lets go of ADD, so the views work again');
});

test('+NODE: pick a parent, drag, ✓ - one undo step; the new node is marked until a shape is round it', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const start = store.getState().figure;
  store.getState().startPlacing({ what: 'node' });
  store.getState().pickPlacingNode('body');
  const id = store.getState().placing.id;
  assert.equal(id, 'node-4');
  assert.equal(store.getState().figure.skeleton.joints[id].parentId, 'body');
  store.getState().beginGesture({ kind: 'place', view: 'front', upp: 0.01 });
  store.getState().updateGesture(40, 0);
  store.getState().endGesture();
  assert.equal(placingBlock(store.getState().figure, store.getState().placing), null, 'a node can always be kept');
  store.getState().confirmPlacing();
  assert.equal(store.getState().past.length, 1, 'one undo step');
  assert.ok(bareNodes(store.getState().figure).includes(id), 'and it is marked: no shape round it yet');
  assert.equal(saveRefusal(store.getState().figure), "CAN'T SAVE: NODE 4 HAS NO SHAPE AROUND IT");
  store.getState().undo();
  assert.equal(fig.fingerprint(store.getState().figure), fig.fingerprint(start), 'UNDO takes it away');
});

test('adding or deleting a node never moves a shape, even on a posed figure', () => {
  const guy = buildDefaultFigure('guy');
  const posed = { ...guy, skeleton: poseGesture(guy, 'hand.left', 'front', -60, -40, 0.01, false).skeleton };
  const world = (f) => f.shapes.map((s) => fig.placementOf(f, s));
  const same = (a, b) =>
    a.forEach((p, i) => {
      near(p.position.x, b[i].position.x, 1e-9, 'x');
      near(p.position.y, b[i].position.y, 1e-9, 'y');
      near(Math.abs(p.rotation.x * b[i].rotation.x + p.rotation.y * b[i].rotation.y + p.rotation.z * b[i].rotation.z + p.rotation.w * b[i].rotation.w), 1, 1e-9, 'turn');
    });
  // hand.left has no child, so it turns with its arm; a node added under it becomes its bone. A shape pinned to the
  // hand must not swing when that happens. (GUY is at the node cap, so the right arm goes first.)
  let small = fig.removeNode(guy, 'arm.right');
  const hand = jointFrames(small.skeleton)['hand.left'].position;
  small = fig.addShape(small, { kind: 'box', at: { x: hand.x, y: hand.y, z: 0 }, pin: 'hand.left' }).figure;
  const bent = { ...small, skeleton: poseGesture(small, 'hand.left', 'front', -60, -40, 0.01, false).skeleton };
  const added = fig.addNode(bent, 'hand.left', { x: -0.9, y: 0, z: 0.1 });
  assert.ok(added.id !== null, 'a node under the hand');
  same(world(added.figure), world(bent));
  const removed = fig.removeNode(posed, 'arm.left');
  assert.deepEqual(fig.nodesRemovedWith(posed, 'arm.left'), ['arm.left', 'hand.left'], 'a node goes with the nodes below it');
  same(world(removed), world(posed));
  const arm = removed.shapes.find((s) => s.name === 'ARM L');
  assert.equal(arm.pin, null, 'ARM L lost its node: unpinned, where it stood');
  assert.equal(brokenShapes(removed)[arm.id], "ARM L ISN'T PINNED TO A NODE", 'and marked');
  assert.deepEqual(fig.nodesRemovedWith(posed, 'hips'), [], 'the root cannot go');
});

test('undo and redo bring validity and sag back with the figure (they are worked out, never stored)', () => {
  const store = useCharacterStore;
  store.getState().reset();
  const body = store.getState().figure.shapes.find((s) => s.name === 'BODY');
  store.getState().deleteShape(body.id);
  assert.notEqual(saveRefusal(store.getState().figure), null, 'deleting BODY breaks the figure');
  store.getState().undo();
  assert.equal(saveRefusal(store.getState().figure), null, 'undo mends it');
  store.getState().redo();
  assert.notEqual(saveRefusal(store.getState().figure), null, 'redo breaks it again');
});

/* ---------------------------------------------------------------- pixels */

test('pixels: a shape weighs its front outline in blocks, and the counter counts filled pixels', () => {
  const box = { kind: 'box', position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 0.5, y: 0.3, z: 2 } };
  near(touch.outlinePixels(box), (0.5 * 0.3) / touch.BLOCK_UNITS ** 2, 1e-6, 'a box: width x height over a block');
  const sphere = { kind: 'sphere', position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, size: { x: 0.4, y: 0.4, z: 0.4 } };
  near(touch.outlinePixels(sphere) / ((Math.PI * 0.04) / touch.BLOCK_UNITS ** 2), 1, 0.01, 'a sphere: a disc');
  const { countFilled } = require(path.join(__dirname, 'simple-render', 'components', 'CharacterPixelRender.js'));
  const rgba = new Uint8Array(4 * 10);
  for (const i of [0, 3, 4, 9]) rgba[i * 4 + 3] = 255;
  rgba[2 * 4] = 200; // colour with no alpha is not a filled pixel
  assert.equal(countFilled(rgba), 4, 'the counter counts opaque pixels only');
});

console.log(`\ncharacter simple-figure checks passed (${passed})`);
