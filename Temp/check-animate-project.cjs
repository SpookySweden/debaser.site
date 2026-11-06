/*
 * ANIMATE's pure logic (SPEC-animator.md): the timeline's arithmetic, the layer list's rule, the project file's bytes, the pen's numbers.
 * The pictures themselves are driven in a real browser by `scripts/drive-animate.cjs`.
 *   npx tsc app/lib/animate/project.ts app/lib/animate/zip.ts app/lib/animate/brushes.ts app/lib/animate/tags.ts --rootDir app/lib --outDir Temp/animate-project-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const P = require('./animate-project-out/animate/project.js');
const Z = require('./animate-project-out/animate/zip.js');
const B = require('./animate-project-out/animate/brushes.js');
const T = require('./animate-project-out/animate/tags.js');

(async () => {
  // ── The project: the plan's numbers ────────────────────────────────────────────────────
  let p = P.createProject('p');
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.equal(p.fps, 24);
  const layer = p.nodes[0].id;

  // ── Cels ───────────────────────────────────────────────────────────────────────────────
  let made = P.addDrawing(p, layer, 0, 2);
  p = made.project;
  const a = made.cel;
  assert.equal(a.frame, 0);
  assert.equal(a.length, 2, 'a new drawing runs for what was asked');
  made = P.addDrawing(p, layer, 6, 3);
  p = made.project;
  const b = made.cel;
  assert.equal(P.celAt(p.nodes[0], 1).id, a.id, 'a held frame shows its drawing');
  assert.equal(P.celAt(p.nodes[0], 3), null, 'an empty frame is empty');
  assert.equal(P.celAt(p.nodes[0], 8).id, b.id);

  // An empty frame's new drawing stops at the next one.
  made = P.addDrawing(p, layer, 5, 4);
  assert.equal(made.cel.length, 1, 'it stops short of the next drawing');

  // A new drawing inside a hold cuts the hold.
  made = P.addDrawing(p, layer, 7);
  const cut = made.project.nodes[0].cels;
  assert.deepEqual(cut.map((c) => [c.frame, c.length]), [[0, 2], [6, 1], [7, 2]], 'the hold splits where the new drawing starts');

  // Exposure: dragged out, and stopped by the next drawing unless pushing.
  let q = P.setExposure(p, layer, a.id, 4);
  assert.equal(q.nodes[0].cels[0].length, 4);
  q = P.setExposure(p, layer, a.id, 40);
  assert.equal(q.nodes[0].cels[0].length, 6, 'stops at the next drawing');
  q = P.setExposure(p, layer, a.id, 0);
  assert.equal(q.nodes[0].cels[0].length, 1, 'never below one frame');
  q = P.setExposure(p, layer, a.id, 5, true);
  assert.equal(q.nodes[0].cels[0].length, 5);
  assert.equal(q.nodes[0].cels[1].frame, 9, 'pushing moves what comes after');

  // On twos and threes.
  q = P.setHolds(p, layer, 3);
  assert.deepEqual(q.nodes[0].cels.map((c) => [c.frame, c.length]), [[0, 3], [3, 3]], 'on threes');

  // Insert and remove frames.
  q = P.insertFrames(p, layer, 1, 2);
  assert.deepEqual(q.nodes[0].cels.map((c) => [c.frame, c.length]), [[0, 4], [8, 3]], 'a hold across the spot grows, later ones move');
  const back = P.removeFrames(q, layer, 1, 2);
  assert.deepEqual(back.nodes[0].cels.map((c) => [c.frame, c.length]), [[0, 2], [6, 3]], 'removing undoes inserting');
  const gone = P.removeFrames(p, layer, 6, 3);
  assert.equal(gone.nodes[0].cels.length, 1, 'a cel with no frames left is gone');

  // A paste over cels shortens or splits what's in the way.
  q = P.placeCel(p, layer, 7, a.drawingId, 1);
  assert.deepEqual(q.nodes[0].cels.map((c) => [c.frame, c.length]), [[0, 2], [6, 1], [7, 1], [8, 1]], 'a paste into a hold keeps both ends of it');

  // The shot grows to hold what's on it.
  q = P.setExposure(p, layer, b.id, 100);
  assert.equal(q.frames, 106, 'the shot grows');

  // The original wasn't touched: undo depends on it.
  assert.equal(p.nodes[0].cels[0].length, 2, 'old projects are never changed');

  // ── Playback ───────────────────────────────────────────────────────────────────────────
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => P.frameAtTick(t, 0, 2, 'loop')), [0, 1, 2, 0, 1], 'loop');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((t) => P.frameAtTick(t, 0, 2, 'pingpong')), [0, 1, 2, 1, 0, 1], 'ping-pong');
  assert.deepEqual([0, 3, 4].map((t) => P.frameAtTick(t, 2, 4, 'once')), [2, null, null], 'once stops');
  assert.equal(P.frameAtTick(9, 5, 5, 'pingpong'), 5, 'a one-frame range holds still');
  let ranged = { ...p, frames: 48, range: { in: 3, out: 10 } };
  assert.deepEqual(P.playRange(ranged), { start: 3, end: 10 });
  ranged = { ...ranged, range: { in: 40, out: 100 } };
  assert.deepEqual(P.playRange(ranged), { start: 40, end: 47 }, 'a range past the end is cut to the shot');

  // ── Onion ──────────────────────────────────────────────────────────────────────────────
  let o = P.createProject('o');
  const ol = o.nodes[0].id;
  for (const f of [0, 2, 4, 6]) o = P.addDrawing(o, ol, f, 2).project;
  o = P.setCelMark(o, ol, o.nodes[0].cels[1].id, 'inbetween');
  const prev = P.onionNeighbours(o.nodes[0], 4, -1, 2, false);
  assert.deepEqual(prev.map((n) => [n.cel.frame, n.distance]), [[2, 1], [0, 2]], 'nearest first');
  const next = P.onionNeighbours(o.nodes[0], 4, 1, 3, false);
  assert.deepEqual(next.map((n) => n.cel.frame), [6], 'only what exists');
  const keys = P.onionNeighbours(o.nodes[0], 4, -1, 2, true);
  assert.deepEqual(keys.map((n) => n.cel.frame), [0], 'keys only skips in-betweens');
  assert.deepEqual(P.onionNeighbours(o.nodes[0], 5, -1, 1, false).map((n) => n.cel.frame), [2], 'the drawing on screen is not its own neighbour');
  assert.equal(P.neighbourFrame(o.nodes[0], 5, -1), 4, 'stepping back goes to the start of the hold first');
  assert.equal(P.neighbourFrame(o.nodes[0], 4, -1), 2);
  assert.equal(P.neighbourFrame(o.nodes[0], 4, 1), 6);
  assert.equal(P.neighbourFrame(o.nodes[0], 6, 1), null);

  // ── Layers and folders ─────────────────────────────────────────────────────────────────
  let l = P.createProject('l');
  const first = l.nodes[0].id;
  let added = P.addNode(l, 'layer', first);
  l = added.project;
  const second = added.id;
  added = P.addNode(l, 'folder', second);
  l = added.project;
  const folder = added.id;
  added = P.addNode(l, 'layer', folder);
  l = added.project;
  const inside = added.id;
  assert.equal(P.findNode(l, inside).parent, folder, 'a layer asked for on a folder goes inside it');
  assert.ok(P.findNode(l, second) !== null);
  const folderRule = (project) => {
    const seen = new Set();
    for (const node of project.nodes) {
      if (node.parent !== null) assert.ok(seen.has(node.parent), `${node.id}'s folder comes first`);
      seen.add(node.id);
    }
    project.nodes.forEach((node) => {
      if (node.kind !== 'folder') return;
      const block = P.blockOf(project, node.id);
      const at = project.nodes.indexOf(node);
      block.forEach((row, i) => assert.equal(project.nodes[at + i].id, row.id, 'a folder and its rows stay together'));
    });
  };
  folderRule(l);
  // Moves keep the rule.
  let m = P.moveNode(l, first, folder, null);
  folderRule(m);
  m = P.moveNode(l, first, inside, folder);
  assert.equal(P.findNode(m, first).parent, folder, 'dragged into a folder');
  folderRule(m);
  const refused = P.moveNode(l, folder, inside, folder);
  assert.equal(refused, l, 'a folder cannot go inside itself');
  const nested = P.addNode(l, 'folder', folder);
  const refusedDeep = P.moveNode(nested.project, folder, null, nested.id);
  assert.equal(refusedDeep, nested.project, 'nor inside its own child');
  // Nudge up and down.
  const nudged = P.nudgeNode(l, l.nodes[l.nodes.length - 1].id, -1);
  folderRule(nudged);
  assert.notDeepEqual(nudged.nodes.map((n) => n.id), l.nodes.map((n) => n.id), 'a nudge moves it');
  assert.deepEqual(P.nudgeNode(nudged, l.nodes[l.nodes.length - 1].id, 1).nodes.map((n) => n.id), l.nodes.map((n) => n.id), 'and back');
  // Collapse hides rows; deleting a folder takes its rows; the last layer stays.
  const collapsed = P.updateNode(l, folder, { collapsed: true });
  assert.ok(!P.visibleRows(collapsed).some((n) => n.id === inside), 'collapsed rows are hidden');
  const deleted = P.deleteNode(l, folder);
  assert.ok(!deleted.nodes.some((n) => n.id === inside), 'a folder takes its rows with it');
  let solo = P.createProject('s');
  assert.equal(P.deleteNode(solo, solo.nodes[0].id), solo, 'the last layer stays');
  // Visibility and solo through folders.
  const hiddenFolder = P.updateNode(l, folder, { visible: false });
  assert.equal(P.isShown(hiddenFolder, P.findNode(hiddenFolder, inside)), false, 'a hidden folder hides its rows');
  const soloed = P.updateNode(l, inside, { solo: true });
  assert.equal(P.isShown(soloed, P.findNode(soloed, inside)), true);
  assert.equal(P.isShown(soloed, P.findNode(soloed, first)), false, 'solo hides the rest');
  assert.equal(P.isLocked(P.updateNode(l, folder, { locked: true }), P.findNode(l, inside)), true, 'a locked folder locks its rows');

  // ── Reading a project back ─────────────────────────────────────────────────────────────
  assert.equal(P.readProject('nonsense'), null);
  assert.equal(P.readProject({ format: 2 }), null);
  assert.equal(P.readProject({ format: 1, id: 'x', width: 10, height: 10, nodes: [] }), null, 'a project with no layer is refused');
  const roundTrip = P.readProject(JSON.parse(JSON.stringify(p)));
  assert.equal(roundTrip.nodes[0].cels.length, 2, 'a saved project reads back');

  // ── The file's bytes ───────────────────────────────────────────────────────────────────
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  const entries = [
    { name: 'project.json', bytes: new TextEncoder().encode('{"a":1}') },
    { name: 'planes/d_1.line.png', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'assets/é', bytes: new Uint8Array(0) },
  ];
  const bytes = new Uint8Array(await new Blob(Z.zipParts(entries)).arrayBuffer());
  const listed = Z.zipList(bytes);
  assert.deepEqual(listed.map((e) => e.name), entries.map((e) => e.name), 'names survive');
  for (let i = 0; i < entries.length; i += 1) {
    assert.deepEqual([...(await Z.zipExtract(bytes, listed[i]))], [...entries[i].bytes], 'bytes survive');
    assert.equal(listed[i].crc, Z.crc32(entries[i].bytes));
  }
  assert.throws(() => Z.zipList(new Uint8Array([1, 2, 3])), /not a zip/);
  // A zip a person re-zipped with another tool is deflated: built here by marking a deflated entry as method 8 in both headers.
  const text = 'hello hello hello hello';
  const deflatedZip = new Uint8Array(await new Blob(Z.zipParts([{ name: 'a.txt', bytes: require('node:zlib').deflateRawSync(text) }])).arrayBuffer());
  const deflatedView = new DataView(deflatedZip.buffer);
  deflatedView.setUint16(8, 8, true);
  const centralAt = Z.zipList(deflatedZip)[0].compressedSize + 30 + 'a.txt'.length;
  deflatedView.setUint16(centralAt + 10, 8, true);
  const deflatedEntry = Z.zipList(deflatedZip)[0];
  assert.equal(deflatedEntry.method, 8);
  assert.equal(new TextDecoder().decode(await Z.zipExtract(deflatedZip, deflatedEntry)), text, 'a deflated entry opens');

  // ── The pen's numbers ──────────────────────────────────────────────────────────────────
  assert.ok(Math.abs(B.applyCurve(0.5, B.LINEAR_CURVE) - 0.5) < 0.01, 'the straight curve changes nothing');
  assert.ok(B.applyCurve(0.5, [0.1, 0.6, 0.4, 0.9]) > 0.6, 'a soft curve gives more for less');
  assert.ok(B.applyCurve(0.5, [0.6, 0.1, 0.9, 0.4]) < 0.4, 'a firm curve gives less');
  assert.equal(B.applyCurve(0, B.LINEAR_CURVE) < 0.01, true);
  assert.equal(B.applyCurve(1, B.LINEAR_CURVE) > 0.99, true);
  assert.ok(B.tiltPressure(0.5, 60) > B.tiltPressure(0.5, 0), 'leaning the pen widens the line');
  assert.ok(B.tiltPressure(1, 60) <= 1, 'pressure stays in range');
  const none = new B.Stabiliser(0);
  none.push(0, 0, 0.5, 0);
  assert.deepEqual(none.push(10, 0, 0.5, 8), [10, 0, 0.5], 'a stabiliser of 0 is off');
  const steady = new B.Stabiliser(1);
  steady.push(0, 0, 0.5, 0);
  const trailed = steady.push(10, 0, 0.5, 8);
  assert.ok(trailed[0] > 0 && trailed[0] < 2, `a stabiliser trails the pen (${trailed[0]})`);
  const later = new B.Stabiliser(1);
  later.push(0, 0, 0.5, 0);
  assert.ok(later.push(10, 0, 0.5, 1000)[0] > 9, 'and catches up given time');
  // Rate-independent: 2 steps of 8ms land where 1 step of 16ms does.
  const twoSteps = new B.Stabiliser(0.5);
  twoSteps.push(0, 0, 0.5, 0);
  twoSteps.push(10, 0, 0.5, 8);
  const one = new B.Stabiliser(0.5);
  one.push(0, 0, 0.5, 0);
  assert.ok(Math.abs(twoSteps.push(10, 0, 0.5, 16)[0] - one.push(10, 0, 0.5, 16)[0]) < 1e-9, 'the same feel at any pen rate');
  // Outlines: pressure makes a stroke wider.
  const stroke = (pressure) => ({ brush: 'ink', size: 10, points: Array.from({ length: 20 }, (_, i) => [i * 5, 0, pressure]) });
  const height = (outline) => Math.max(...outline.map((pt) => pt[1])) - Math.min(...outline.map((pt) => pt[1]));
  assert.ok(height(B.outlineOf(stroke(1))) > height(B.outlineOf(stroke(0.1))) * 1.5, 'heavier is wider');
  assert.deepEqual(B.boundsOf([[-50, -50], [10, 10]], 2, 100, 100), { x: 0, y: 0, w: 12, h: 12 }, 'bounds stay on the sheet');
  assert.equal(B.boundsOf([[-50, -50], [-10, -10]], 2, 100, 100), null, 'off the sheet is nothing');

  // ── Tags ───────────────────────────────────────────────────────────────────────────────
  const tags = T.builtinTags();
  assert.deepEqual(tags.map((t) => t.id), ['figure', 'ink', 'rough', 'shade', 'background', 'reference', 'fx', 'notes'], 'the eight built-in tags');
  const figure = tags[0].behaviours;
  assert.ok(figure.paintBehindLines && figure.stayInsideLines && figure.closeGaps.on && figure.tuckUnder && figure.protectLines && figure.showClosures, 'Figure bundles its smarts');
  assert.equal(figure.closeGaps.maxGapPx, 8, 'the 8 px gap');
  assert.equal(figure.carryColourForward, false, 'carry forward is opt-in');
  const shade = tags.find((t) => t.id === 'shade').behaviours;
  assert.ok(shade.clipToLayerBelow && shade.layerDefaults.blend === 'multiply');
  // A folder's tag passes down unless the layer has its own; the three off switches.
  let tp = P.createProject('tp');
  let nodeAdd = P.addNode(tp, 'folder', tp.nodes[0].id);
  tp = nodeAdd.project;
  const tf = nodeAdd.id;
  nodeAdd = P.addNode(tp, 'layer', tf);
  tp = nodeAdd.project;
  const tl = nodeAdd.id;
  tp = P.updateNode(tp, tf, { tagId: 'rough' });
  assert.equal(T.tagOf(tp, P.findNode(tp, tl)).id, 'rough', 'a layer takes its folder tag');
  const own = P.updateNode(tp, tl, { tagId: 'figure' });
  assert.equal(T.tagOf(own, P.findNode(own, tl)).id, 'figure', 'its own tag wins');
  assert.ok(T.liveBehaviours(own, P.findNode(own, tl), true) !== null);
  assert.equal(T.liveBehaviours(own, P.findNode(own, tl), false), null, 'the master key turns smarts off');
  const tagOff = { ...own, tags: own.tags.map((t) => (t.id === 'figure' ? { ...t, on: false } : t)) };
  assert.equal(T.liveBehaviours(tagOff, P.findNode(tagOff, tl), true), null, "the tag's own switch does too");
  assert.deepEqual(T.smartsForStroke(T.liveBehaviours(own, P.findNode(own, tl), true)), ['paintBehindLines', 'stayInsideLines', 'closeGaps', 'tuckUnder'], 'a stroke remembers what was live');
  assert.deepEqual(T.smartsForStroke(null), [], 'a raw stroke remembers nothing');
  // Preset files: read back; junk refused.
  const preset = T.readTagPreset(T.exportTagPreset([tags[0]]));
  assert.equal(preset.length, 1);
  assert.equal(preset[0].builtin, false, 'a shared tag is yours');
  assert.deepEqual(preset[0].behaviours, tags[0].behaviours, 'behaviours survive');
  assert.deepEqual(T.readTagPreset('nonsense'), []);
  assert.deepEqual(T.readTagPreset('{"tags":[{"nope":1}]}'), []);
  assert.equal(T.readTagPreset('{"tags":[{"id":"x","name":"X","colour":"red"}]}')[0].colour.startsWith('#'), true, 'a bad colour is replaced');
  // A shared file can't break the studio with a broken bundle (the code review's worry).
  const broken = T.readTagPreset('{"tags":[{"id":"x","name":"X","behaviours":{"closeGaps":null,"onionSkin":{},"layerDefaults":{"blend":"nonsense"},"dimWhenInactive":7,"stayInsideLines":"yes"}}]}')[0].behaviours;
  assert.equal(broken.closeGaps.on, false, 'a null gap setting reads as off');
  assert.equal(broken.onionSkin.mode, 'tint');
  assert.equal(broken.layerDefaults.blend, 'normal', 'an unknown blend reads as normal');
  assert.equal(broken.dimWhenInactive.on, false);
  assert.equal(broken.stayInsideLines, false, 'a behaviour that is not true or false reads as blank');

  console.log('animate project: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
