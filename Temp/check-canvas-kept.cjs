/*
 * CANVAS (2026-11-17): a room's drawing nobody saved stays reachable once its session is over. Luke: "i drew while
 * streaming earlier and that canvas cant be seen under canvases nor is it in my current room". The mock store's
 * PAST CANVASES (listPastCanvases) as CANVASES reads it: an unsaved canvas with strokes, whose canvas was closed or
 * whose room ended, for the people who were in that room; never a saved one (STREAM ART has those), never one still
 * open in a live room (the room shows it), never an empty one, never to somebody who was not there. The room itself
 * (the canvas staying open while private, after a reload, folded) is scripts/drive-room-canvas.cjs on a mock server.
 *   npx tsc app/lib/watch/mock-canvas-repository.ts --rootDir app --outDir Temp/canvas-kept-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-canvas-kept.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'canvas-kept-out');
const rooms = new Map();
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
const read = (id) => {
  const room = rooms.get(id);
  return room === undefined ? null : { room, queue: [], messages: room.messages ?? [], crowns: room.crowns ?? [] };
};
stub('lib/watch/mock-watch-repository.js', { getMockWatchRepository: () => ({ readRoom: async (id) => read(id) }) });

const { getMockCanvasRepository } = require('./canvas-kept-out/lib/watch/mock-canvas-repository.js');
const store = getMockCanvasRepository();
let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok  ${label}`);
};
const stroke = (id, author) => ({ id, authorId: author, authorLabel: author.toUpperCase(), at: new Date().toISOString(), kind: 'stroke', colour: '#ff0000', size: 4, points: [[10, 10], [40, 40]] });
const room = (id, hostId, extra = {}) => rooms.set(id, { id, hostId, originalHostId: hostId, endedAt: null, origin: 'music', isPublic: false, ...extra });
const opened = (roomId, hostId) => store.openCanvas({ roomId, host: { id: hostId, label: hostId.toUpperCase() }, title: `MUSIC :: ${hostId.toUpperCase()}`, by: hostId });

(async () => {
  // 1. Luke's case: his main room goes on, its canvas was closed unsaved (going private once did that).
  room('main', 'luke');
  const lost = await opened('main', 'luke');
  await store.writeInputs(lost.id, [stroke('s1', 'luke'), stroke('s2', 'luke')], 'luke');
  await store.close(lost.id, 'luke');
  const lukes = await store.listPastCanvases('luke');
  assert.deepEqual(lukes.map((entry) => [entry.canvas.id, entry.inputCount]), [[lost.id, 2]], 'his closed, unsaved canvas is listed with its two strokes');
  ok('a closed canvas nobody saved is listed for the room\'s host, with its stroke count');

  // 2. A friend drew on it: listed for them too. A stranger who was never there: not listed.
  room('theirs', 'host');
  const shared = await opened('theirs', 'host');
  await store.writeInputs(shared.id, [stroke('f1', 'friend')], 'friend');
  rooms.get('theirs').endedAt = new Date().toISOString();
  assert.ok((await store.listPastCanvases('friend')).some((entry) => entry.canvas.id === shared.id), 'listed for somebody who drew on it');
  assert.ok((await store.listPastCanvases('host')).some((entry) => entry.canvas.id === shared.id), 'and for the host');
  assert.equal((await store.listPastCanvases('stranger')).length, 0, 'never for somebody who was not there');
  ok('a room that ended with its canvas still open on paper lists it for its host and who drew; not for a stranger');

  // 3. Still open in a live room: the room shows it, so it is not "past". Saved: STREAM ART has it. Empty: nothing to show.
  room('live', 'luke');
  const open = await opened('live', 'luke');
  await store.writeInputs(open.id, [stroke('l1', 'luke')], 'luke');
  room('saved', 'luke');
  const kept = await opened('saved', 'luke');
  await store.writeInputs(kept.id, [stroke('k1', 'luke')], 'luke');
  await store.save(kept.id, { id: 'luke', label: 'LUKE' });
  await store.close(kept.id, 'luke');
  room('empty', 'luke');
  const empty = await opened('empty', 'luke');
  await store.close(empty.id, 'luke');
  const ids = (await store.listPastCanvases('luke')).map((entry) => entry.canvas.id);
  assert.ok(!ids.includes(open.id), 'not the one still open in a live room');
  assert.ok(!ids.includes(kept.id), 'not a saved one');
  assert.ok(!ids.includes(empty.id), 'not an empty one');
  assert.deepEqual(ids, [lost.id], 'only his past one (he was never in the friend\'s room)');
  ok('never a canvas still open in a live room, a saved one, or an empty one');

  // 4. Somebody who only spoke in the room (a chat line) was in it too.
  room('chatty', 'host2', { messages: [{ authorId: 'talker', authorLabel: 'TALKER', createdAt: new Date().toISOString() }] });
  const talked = await opened('chatty', 'host2');
  await store.writeInputs(talked.id, [stroke('c1', 'host2')], 'host2');
  await store.close(talked.id, 'host2');
  assert.ok((await store.listPastCanvases('talker')).some((entry) => entry.canvas.id === talked.id), 'listed for somebody who chatted there');
  ok('somebody who spoke in the room sees its past canvas');

  console.log(`\ncheck-canvas-kept: ${passed} passed`);
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
