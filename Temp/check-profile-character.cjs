/**
 * Characters on profiles (SPEC-profile-characters.md): the motions, the walker and the sheet, in Node against the
 * compiled modules.
 *
 *   - every preset has every motion, and a motion only names joints its preset has
 *   - motion isn't artwork: no frame adds, removes, resizes, recolours or re-kinds a shape
 *   - the rest frame is the figure as built (sag and all); a turn moves only its joint's shapes and what hangs below;
 *     a lift moves everything; the facing turns the figure on the spot
 *   - shapes on a node added beyond the preset follow that node's parent
 *   - sag is worked out again in every frame
 *   - feet stay on the floor walking, idling and dancing; sitting puts the figure on the floor, not through it
 *   - GUY's wave raises the right arm
 *   - lanes are where nothing is: a character's box anywhere on a lane never crosses anything on the page
 *   - the walker stays on its lane, dances while the music plays, reacts wave, hop, turn, and follows its mood
 *   - a sheet from the database is checked before it is used
 *
 * The pictures themselves (the bake matching the workbench's render) are proven in a browser by
 * `scripts/drive-profile-character.cjs`.
 *
 * Steps:
 *   npx tsc app/lib/character/motion.ts app/lib/character/walker.ts app/lib/character/sheet.ts app/lib/character/rig.ts --outDir Temp/profile-character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');

process.removeAllListeners('warning');
const out = path.join(__dirname, 'profile-character-out');
const motion = require(path.join(out, 'motion.js'));
const walker = require(path.join(out, 'walker.js'));
const { readSheet, readSheetAndAge, cellAt, MOODS } = require(path.join(out, 'sheet.js'));
const { buildDefaultFigure, RIG_PRESET_IDS, RIG_PRESETS, FLOOR_Y } = require(path.join(out, 'rig.js'));
const { sagOf } = require(path.join(out, 'sag.js'));
const { placementOf } = require(path.join(out, 'figure.js'));
const { jointFrames } = require(path.join(out, 'skeleton.js'));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};
const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A seeded random, so a failure can be run again. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The lowest point of a drawn frame (a box round each turned shape, as the bake measures). */
function lowest(drawn) {
  const { rotateVec } = require(path.join(out, 'turns.js'));
  let low = Infinity;
  for (const { shape, placement } of drawn) {
    const h = { x: shape.size.x / 2, y: shape.size.y / 2, z: shape.size.z / 2 };
    const ey =
      Math.abs(rotateVec(placement.rotation, { x: h.x, y: 0, z: 0 }).y) +
      Math.abs(rotateVec(placement.rotation, { x: 0, y: h.y, z: 0 }).y) +
      Math.abs(rotateVec(placement.rotation, { x: 0, y: 0, z: h.z }).y);
    low = Math.min(low, placement.position.y - ey);
  }
  return low;
}

test('every preset has every motion, each with frames, naming only its own joints', () => {
  for (const preset of RIG_PRESET_IDS) {
    const motions = motion.motionsFor(preset);
    const joints = new Set(RIG_PRESETS[preset].nodes.map((node) => node.id));
    for (const id of motion.MOTION_IDS) {
      const m = motions[id];
      assert.ok(m && m.frames.length > 0, `${preset} ${id} has frames`);
      assert.ok(m.facing === 'side' || m.facing === 'front');
      for (const frame of m.frames) {
        for (const joint of Object.keys(frame.joints ?? {})) assert.ok(joints.has(joint), `${preset} ${id} names ${joint}, which it lacks`);
        assert.ok((frame.hold ?? 1) >= 1 && (frame.hold ?? 1) <= 30, `${preset} ${id} hold`);
      }
      const ticks = motion.motionTicks(m);
      assert.ok(ticks.length >= 1 && ticks.length <= 60, `${preset} ${id} plays ${ticks.length} ticks`);
    }
    assert.deepEqual(motion.motionsFor('nonsense').walk, motion.motionsFor('base').walk, 'an unknown preset walks like BASE');
  }
});

test('motion is not artwork: every frame keeps every shape as built (kind, size, colour, name, count)', () => {
  for (const preset of RIG_PRESET_IDS) {
    const figure = buildDefaultFigure(preset);
    const motions = motion.motionsFor(preset);
    for (const id of motion.MOTION_IDS) {
      for (const frame of motions[id].frames) {
        const posed = motion.posedFigure(figure, frame, motion.frameYaw(motions[id], frame));
        assert.equal(posed.shapes.length, figure.shapes.length);
        posed.shapes.forEach((shape, index) => {
          const built = figure.shapes[index];
          assert.equal(shape.id, built.id);
          assert.equal(shape.kind, built.kind);
          assert.equal(shape.colour, built.colour);
          assert.equal(shape.name, built.name);
          assert.equal(shape.hidden, built.hidden);
          assert.deepEqual(shape.size, built.size);
        });
        assert.equal(Object.keys(posed.skeleton.joints).length, Object.keys(figure.skeleton.joints).length);
      }
    }
  }
});

test('the rest frame, facing front, is the figure exactly as the bench draws it (sag included)', () => {
  for (const preset of RIG_PRESET_IDS) {
    const figure = buildDefaultFigure(preset);
    const bench = sagOf(figure).placements;
    for (const { shape, placement } of motion.posedPlacements(figure, {}, 0)) {
      near(dist(placement.position, bench[shape.id].position), 0, 1e-9, `${preset} ${shape.id} position`);
      const q = placement.rotation;
      const r = bench[shape.id].rotation;
      near(Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w), 1, 1e-9, `${preset} ${shape.id} turn`);
    }
  }
});

test('a turn on the head moves only the head shapes; on the hips, everything; a lift moves everything by the lift', () => {
  const figure = buildDefaultFigure('guy');
  const rest = Object.fromEntries(motion.posedPlacements(figure, {}, 0).map((d) => [d.shape.id, d.placement.position]));
  const headTurn = motion.posedPlacements(figure, { joints: { head: { z: 30 } } }, 0);
  for (const { shape, placement } of headTurn) {
    const moved = dist(placement.position, rest[shape.id]) > 1e-6;
    assert.equal(moved, figure.shapes.find((s) => s.id === shape.id).pin === 'head', `${shape.name} moved: ${moved}`);
  }
  const hipsTurn = motion.posedPlacements(figure, { joints: { hips: { z: 20 } } }, 0);
  for (const { shape, placement } of hipsTurn) {
    const pin = figure.shapes.find((s) => s.id === shape.id).pin;
    // A shape centred on the hips' own point would not move; none of GUY's is.
    assert.ok(dist(placement.position, rest[shape.id]) > 1e-4, `${shape.name} (on ${pin}) moves with the hips`);
  }
  for (const { shape, placement } of motion.posedPlacements(figure, { root: { y: 0.25 } }, 0)) {
    near(placement.position.y - rest[shape.id].y, 0.25, 1e-9, `${shape.name} lifted`);
    near(placement.position.x, rest[shape.id].x, 1e-9, `${shape.name} not slid`);
  }
});

test('the facing turns the figure on the spot, round its root', () => {
  const figure = buildDefaultFigure('goblin');
  const root = jointFrames(figure.skeleton)[figure.skeleton.rootId].position;
  const rest = Object.fromEntries(motion.posedPlacements(figure, {}, 0).map((d) => [d.shape.id, d.placement.position]));
  for (const { shape, placement } of motion.posedPlacements(figure, {}, motion.SIDE_YAW)) {
    const before = rest[shape.id];
    near(placement.position.y, before.y, 1e-9, `${shape.name} height`);
    near(Math.hypot(placement.position.x - root.x, placement.position.z - root.z), Math.hypot(before.x - root.x, before.z - root.z), 1e-9, `${shape.name} distance from the root's line`);
  }
  // The ear sticking out to the figure's left (screen left) swings towards the viewer as it turns to face right.
  const earL = figure.shapes.find((s) => s.name === 'EAR L').id;
  const turned = motion.posedPlacements(figure, {}, 90).find((d) => d.shape.id === earL).placement.position;
  assert.ok(turned.z > rest[earL].z + 0.3, 'facing right brings its left side round to the front');
});

test('a node added beyond the preset follows its parent, and so does its shape', () => {
  const figure = buildDefaultFigure('base');
  const frames = jointFrames(figure.skeleton);
  const head = frames.head.position;
  const extra = {
    ...figure,
    skeleton: {
      ...figure.skeleton,
      joints: { ...figure.skeleton.joints, 'node-4': { id: 'node-4', parentId: 'head', position: { x: 0, y: 0.3, z: 0 }, rest: { x: 0, y: 0.3, z: 0 } } },
    },
    shapes: [
      ...figure.shapes,
      { id: 's9', name: 'HAT', kind: 'box', colour: null, hidden: false, pin: 'node-4', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 0.2, y: 0.2, z: 0.2 } },
    ],
  };
  const restHat = placementOf(extra, extra.shapes[5]).position;
  const posed = motion.posedFigure(extra, { joints: { head: { z: 40 } } }, 0);
  const hat = posed.shapes.find((s) => s.id === 's9').position;
  near(dist(hat, head), dist(restHat, head), 1e-9, 'the hat keeps its distance from the head');
  assert.ok(hat.x < restHat.x - 0.1, 'and tips with the head');
});

test('sag is worked out again in every frame', () => {
  const figure = buildDefaultFigure('base');
  // A level-2 bar sticking out sideways from the head: it sags on the bench.
  const headSphere = figure.shapes.find((s) => s.name === 'HEAD');
  const y = headSphere.position.y;
  const bar = (id, x) => ({ id, name: id.toUpperCase(), kind: 'box', colour: null, hidden: false, pin: 'head', position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 0.3, y: 0.1, z: 0.1 } });
  const sagging = { ...figure, shapes: [...figure.shapes, bar('b1', 0.25 + 0.15), bar('b2', 0.25 + 0.3 + 0.15)] };
  assert.ok(sagOf(sagging).tip.b2 > 0.01, 'the bar sags on the bench');
  const frame = { joints: { head: { z: -30 } } };
  const posed = motion.posedFigure(sagging, frame, 0);
  const drawn = motion.posedPlacements(sagging, frame, 0).find((d) => d.shape.id === 'b2').placement.position;
  const unsagged = posed.shapes.find((s) => s.id === 'b2').position;
  assert.ok(dist(drawn, unsagged) > 0.01, 'the posed frame draws the bar sagged');
  assert.deepEqual(sagOf(posed).placements.b2.position, drawn, 'with sag worked out on the posed figure');
});

test('feet stay on the floor walking, idling, dancing and waving; sitting sits on it', () => {
  for (const preset of RIG_PRESET_IDS) {
    const figure = buildDefaultFigure(preset);
    const motions = motion.motionsFor(preset);
    const floor = lowest(motion.posedPlacements(figure, {}, 0));
    near(floor, FLOOR_Y, 0.02, `${preset} stands on the floor`);
    for (const id of ['walk', 'idle', 'dance1', 'dance2', 'dance3', 'wave', 'turn', 'stretch', 'dance4', 'dance5', 'run', 'cheer', 'slump', 'dangle', 'land', 'type', 'climb']) {
      for (const frame of motions[id].frames) {
        const low = lowest(motion.posedPlacements(figure, frame, motion.frameYaw(motions[id], frame)));
        assert.ok(low > floor - 0.08, `${preset} ${id} sinks to ${low.toFixed(3)} (floor ${floor.toFixed(3)})`);
      }
    }
    for (const id of ['sit', 'sleep', 'curl', 'watch', 'read', 'flick']) {
      for (const frame of motions[id].frames) {
        const low = lowest(motion.posedPlacements(figure, frame, motion.frameYaw(motions[id], frame)));
        assert.ok(Math.abs(low - floor) < 0.16, `${preset} ${id} lowest point ${low.toFixed(3)} is near the floor ${floor.toFixed(3)}`);
      }
    }
  }
});

test("GUY's wave raises the right arm above the shoulder", () => {
  const figure = buildDefaultFigure('guy');
  const arm = figure.shapes.find((s) => s.name === 'ARM R').id;
  const shoulder = jointFrames(figure.skeleton)['arm.right'].position;
  const up = motion.motionsFor('guy').wave.frames[1];
  const at = motion.posedPlacements(figure, up, 0).find((d) => d.shape.id === arm).placement.position;
  assert.ok(at.y > shoulder.y + 0.15, `arm at ${at.y.toFixed(2)}, shoulder ${shoulder.y.toFixed(2)}`);
});

test('lanes are where nothing is: a box anywhere along one crosses nothing', () => {
  const random = seeded(7);
  for (let round = 0; round < 60; round += 1) {
    const width = 300 + Math.floor(random() * 900);
    const height = 200 + Math.floor(random() * 900);
    const obstacles = Array.from({ length: Math.floor(random() * 25) }, () => {
      const left = random() * width;
      const top = random() * height;
      return { left, top, right: left + 10 + random() * 300, bottom: top + 8 + random() * 40 };
    });
    const w = 60 + Math.floor(random() * 60);
    const h = 60 + Math.floor(random() * 60);
    for (const lane of walker.findLanes(width, height, obstacles, w, h)) {
      assert.ok(lane.to - lane.from >= w, 'a lane holds the box');
      assert.ok(lane.floor <= height && lane.floor - h >= 0, 'inside the area');
      for (let left = lane.from; left <= lane.to - w; left += 4) {
        const box = { left, right: left + w, top: lane.floor - h, bottom: lane.floor };
        assert.ok(!walker.overlapsAny(box, obstacles), `round ${round}: a box at ${left},${lane.floor} crosses something`);
      }
    }
  }
  // A page full to the edges has no lane; an empty one has its bottom.
  assert.deepEqual(walker.findLanes(400, 300, [{ left: 0, top: 0, right: 400, bottom: 300 }], 50, 50), []);
  const empty = walker.findLanes(400, 300, [], 50, 50);
  assert.equal(empty[0].floor, 300, 'an empty area: its bottom');
  assert.deepEqual(walker.findLanes(40, 300, [], 50, 50), [], 'too narrow: none');
  // Text across the top: the lane is under it, along the bottom, the whole width.
  const under = walker.findLanes(800, 400, [{ left: 0, top: 0, right: 800, bottom: 120 }], 100, 100)[0];
  assert.equal(under.floor, 400);
  assert.equal(under.to - under.from, 800);
});

test('the walker stays on its lane, dances to music, reacts in turn, and follows its mood', () => {
  const random = seeded(11);
  const sheetTicks = { stand: 1, idle: 42, walk: 8, dance1: 6, dance2: 6, dance3: 6, dance4: 8, dance5: 4, wave: 11, hop: 9, turn: 13, sit: 32, sleep: 24 };
  const ticksOf = (m) => sheetTicks[m];
  const room = 500;
  let state = walker.startWalker(room, random);
  for (let i = 0; i < 3000; i += 1) {
    state = walker.stepWalker(state, { mood: 'busy', music: false, room, step: 3, ticksOf, random });
    assert.ok(state.x >= 0 && state.x <= room, `x ${state.x} on the lane`);
    if (state.activity === 'walk') assert.equal(state.motion, 'walk');
  }
  // Music: a dance from the next tick, and nothing but dancing while it plays.
  state = walker.stepWalker(state, { mood: 'calm', music: true, room, step: 3, ticksOf, random });
  for (let i = 0; i < 300; i += 1) {
    assert.ok(motion.DANCES.includes(state.motion), `dancing, not ${state.motion}`);
    const x = state.x;
    state = walker.stepWalker(state, { mood: 'calm', music: true, room, step: 3, ticksOf, random });
    assert.equal(state.x, x, 'dancing on the spot');
  }
  // Clicks: wave, then hop, then turn, each played through, then back to its own business.
  const seen = [];
  for (let click = 0; click < 3; click += 1) {
    state = walker.react(state);
    seen.push(state.motion);
    for (let i = 1; i < ticksOf(state.motion); i += 1) {
      state = walker.stepWalker(state, { mood: 'calm', music: false, room, step: 3, ticksOf, random });
      assert.equal(state.activity, 'react');
    }
    state = walker.stepWalker(state, { mood: 'calm', music: false, room, step: 3, ticksOf, random });
    assert.notEqual(state.activity, 'react');
  }
  assert.deepEqual(seen, ['wave', 'hop', 'turn']);
  // Moods: CALM idles most, BUSY walks most, PARTY dances most.
  for (const [mood, most] of [['calm', 'idle'], ['busy', 'walk'], ['party', 'dance']]) {
    const counts = { idle: 0, walk: 0, dance: 0 };
    for (let i = 0; i < 2000; i += 1) counts[walker.nextActivity({ ...state, x: 100 }, mood, room, random).activity] += 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(top, most, `${mood}: ${JSON.stringify(counts)}`);
  }
});

test('a sheet read back from the database is checked', () => {
  const motions = Object.fromEntries(motion.MOTION_IDS.map((id) => [id, { facing: 'side', loop: true, ticks: [0, 1] }]));
  const good = { v: 1, cell: { w: 40, h: 38 }, columns: 8, cells: 20, fps: 10, floor: 36, head: 4, motions };
  assert.deepEqual(readSheet(good), good);
  assert.equal(readSheet({ ...good, v: 2 }), null);
  assert.equal(readSheet({ ...good, cell: { w: 400, h: 38 } }), null);
  assert.equal(readSheet({ ...good, motions: { ...motions, walk: { facing: 'side', loop: true, ticks: [0, 20] } } }), null, 'a tick past the last cell');
  const missing = { ...motions };
  delete missing.sleep;
  assert.equal(readSheet({ ...good, motions: missing }), null, 'a motion missing');
  assert.equal(readSheet('{}'), null);
  assert.deepEqual(cellAt(good, 9), { x: 40, y: 38 });
  assert.deepEqual([...MOODS], ['calm', 'busy', 'party']);
  assert.equal(readSheetAndAge(good).stale, false, 'a sheet with every motion is up to date');
});

test('a strip baked before the newer motions still plays everything, each missing motion as an older one (2026-11-14)', () => {
  // The sheet exactly as the first set was baked: eleven motions, each on its own cells.
  const first = Object.fromEntries(motion.CORE_MOTION_IDS.map((id, index) => [id, { facing: id === 'stand' ? 'front' : 'side', loop: id !== 'hop', ticks: [index, index + 1] }]));
  const old = { v: 1, cell: { w: 40, h: 38 }, columns: 8, cells: 20, fps: 10, floor: 36, head: 4, motions: first };
  const read = readSheetAndAge(old);
  assert.notEqual(read, null, 'an old strip is not thrown away for want of a new motion');
  assert.equal(read.stale, true, 'and is marked to be baked again');
  for (const id of motion.MOTION_IDS) assert.ok(read.sheet.motions[id].ticks.length > 0, `${id} plays something`);
  for (const [id, older] of Object.entries(motion.MOTION_FALLBACK)) {
    assert.ok(motion.CORE_MOTION_IDS.includes(older), `${id} falls back to one of the first set`);
    assert.deepEqual(read.sheet.motions[id], read.sheet.motions[older], `${id} plays as ${older}`);
  }
  assert.deepEqual(read.sheet.motions.cheer.ticks, first.hop.ticks, 'a cheer is a hop until it is baked');
  assert.deepEqual(read.sheet.motions.read.ticks, first.sit.ticks, 'reading is sitting');
  assert.deepEqual(read.sheet.motions.curl.ticks, first.sleep.ticks, 'a deep sleep is a sleep');
  // One of the first set missing is still no sheet; a newer motion present but broken is no sheet either.
  const lacking = { ...first };
  delete lacking.walk;
  assert.equal(readSheetAndAge({ ...old, motions: lacking }), null);
  assert.equal(readSheetAndAge({ ...old, motions: { ...first, cheer: { facing: 'front', loop: false, ticks: [99] } } }), null, 'a tick past the last cell');
  // Some newer motions baked and some not (a strip from between two releases): the baked ones are its own.
  const part = readSheetAndAge({ ...old, motions: { ...first, cheer: { facing: 'front', loop: false, ticks: [7, 8, 9] } } });
  assert.deepEqual(part.sheet.motions.cheer.ticks, [7, 8, 9]);
  assert.equal(part.stale, true);
  // Every preset's whole set fits a strip: under 200 cells, and each motion under the sheet's 200 ticks.
  for (const preset of RIG_PRESET_IDS) {
    const motions = motion.motionsFor(preset);
    const cells = motion.MOTION_IDS.reduce((sum, id) => sum + motions[id].frames.length, 0);
    assert.ok(cells <= 200, `${preset} bakes ${cells} cells`);
  }
  assert.ok(motion.DANCES.includes('dance4') && motion.DANCES.includes('dance5'), 'two more dances');
});

test('a hello is a wave played through, and leaves the clicks their own turn (2026-11-14)', () => {
  const random = seeded(5);
  const ticksOf = (m) => ({ wave: 11, hop: 9, turn: 13, idle: 42, walk: 8, dance1: 6, dance2: 6, dance3: 6, dance4: 8, dance5: 4 })[m];
  let state = walker.startWalker(400, random);
  state = walker.greet(state);
  assert.equal(state.activity, 'react');
  assert.equal(state.motion, 'wave');
  assert.equal(state.nextReaction, 0, 'the next click still gets the first reaction');
  for (let i = 1; i < ticksOf('wave'); i += 1) {
    state = walker.stepWalker(state, { mood: 'calm', music: false, room: 400, step: 2, ticksOf, random });
    assert.equal(state.motion, 'wave', 'played right through');
  }
  state = walker.stepWalker(state, { mood: 'calm', music: false, room: 400, step: 2, ticksOf, random });
  assert.notEqual(state.activity, 'react', 'then back to its own business');
  assert.equal(walker.react(state).motion, 'wave', 'a click after a hello: its usual first reaction');
});


console.log(`\n${passed} checks passed`);
