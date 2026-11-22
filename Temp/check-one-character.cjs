/*
 * One of each character on screen (Luke, 2026-11-22: "when viewing someones profile while in a stream with them, there is
 * one version of their character in the profile box and one above the bottom player bar ... i need it so there is just one
 * of each character on the screen at a time and ideally have them be the same one for real"). Run from the root:
 *   npx tsc app/components/ProfileRoom.tsx app/lib/companion/visit.ts --rootDir app --outDir Temp/one-character-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-one-character.cjs
 *
 * What it holds:
 *   - the store: a companion on the strip, climbing in and leaving; a second tab of the same person keeps them on the strip
 *     until both have gone; leaving the strip takes them out of the room too;
 *   - the room draws someone itself only when their companion is not on this screen's strip, or has climbed in;
 *   - the room drawn: the owner of a profile in a stream room with you is not drawn while their companion is on its way up
 *     (none of them in the room), and exactly one after it climbs in, starting where it stepped in, facing the way it
 *     climbed, with a wave; someone not on the strip is drawn by the room as before; the room keeps its height for them meanwhile;
 *   - the room's call: whose companions it wants up, taken away only by itself;
 *   - leaving: down from its spot when it shows whole above its floor, else back over the edge of the floor; a spot is only
 *     that visit's (forgotten as it climbs in, once it has left, and when it leaves the strip).
 * The climb itself, in a real browser on a local mock server, is `scripts/drive-one-character.cjs`.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'one-character-render');

function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

const visit = require(path.join(OUT, 'lib/companion/visit.js'));

const B = 'person-b';
const C = 'person-c';
const VIEWER = 'person-viewer';

/* --- the store ----------------------------------------------------------------------------------------------------- */

ok('the store: on the strip, climbing in, leaving the room, leaving the strip', () => {
  assert.equal(typeof visit.joinStrip, 'function', 'visit.ts keeps a store of other people on the strip');
  const leave = visit.joinStrip(B);
  assert.deepEqual(visit.othersHereState().onStrip, [B]);
  assert.equal(visit.roomDraws(B, visit.othersHereState()), false, 'on the strip and not climbed in: the room draws no copy');
  visit.setOtherInRoom(B, { x: 41.6, facing: -1 });
  assert.deepEqual(visit.othersHereState().inRoom[B], { x: 42, facing: -1 });
  assert.equal(visit.roomDraws(B, visit.othersHereState()), true, 'climbed in: the room draws it');
  visit.setOtherInRoom(B, null);
  assert.equal(visit.roomDraws(B, visit.othersHereState()), false, 'climbed back out');
  visit.setOtherInRoom(B, { x: 10, facing: 1 });
  leave();
  assert.deepEqual(visit.othersHereState().onStrip, []);
  assert.equal(visit.othersHereState().inRoom[B], undefined, 'gone from the strip is gone from the room');
  assert.equal(visit.roomDraws(B, visit.othersHereState()), true, 'not on the strip: the room draws them itself');
  leave();
  assert.deepEqual(visit.othersHereState().onStrip, [], 'leaving twice changes nothing');
});

ok('two tabs of the same person: on the strip till both go; one starting in the room says so', () => {
  const one = visit.joinStrip(C);
  const two = visit.joinStrip(C, { x: 5, facing: 1 });
  assert.deepEqual(visit.othersHereState().onStrip, [C]);
  assert.deepEqual(visit.othersHereState().inRoom[C], { x: 5, facing: 1 });
  one();
  assert.deepEqual(visit.othersHereState().onStrip, [C]);
  two();
  assert.deepEqual(visit.othersHereState().onStrip, []);
  assert.equal(visit.othersHereState().inRoom[C], undefined);
});

ok("the room's call: whose companions it wants, taken away only by itself", () => {
  const first = { stage: {}, wants: [B] };
  const second = { stage: {}, wants: [C] };
  const closeFirst = visit.callIntoRoom(first);
  assert.equal(visit.roomWants(B, visit.roomCallState()), true);
  assert.equal(visit.roomWants(C, visit.roomCallState()), false);
  const closeSecond = visit.callIntoRoom(second);
  closeFirst();
  assert.equal(visit.roomCallState(), second, 'the old room going does not take the new call');
  closeSecond();
  assert.equal(visit.roomCallState(), null);
  assert.equal(visit.roomWants(B, null), false);
});

ok('leaving the room: down from its spot when it shows whole above its floor, else back over the edge', () => {
  assert.equal(visit.otherLeaves({ left: 300, bottom: 600, onScreen: true }, 800), 'down');
  assert.equal(visit.otherLeaves({ left: 300, bottom: 600, onScreen: false }, 800), 'over', 'scrolled out of sight');
  assert.equal(visit.otherLeaves({ left: 300, bottom: 820, onScreen: true }, 800), 'over', 'below its floor');
  assert.equal(visit.otherLeaves(null, 800), 'over', 'never seen in the room');
  visit.noteRoomSpotOf(B, { left: 1, bottom: 2, onScreen: true });
  assert.deepEqual(visit.roomSpotOf(B), { left: 1, bottom: 2, onScreen: true });
  assert.equal(visit.roomSpotOf('nobody'), null);
});

ok("a spot is only that visit's: forgotten as it climbs in, once it has left the room, and when it leaves the strip", () => {
  const leave = visit.joinStrip(B);
  visit.noteRoomSpotOf(B, { left: 1, bottom: 2, onScreen: true });
  visit.setOtherInRoom(B, { x: 5, facing: 1 });
  assert.equal(visit.roomSpotOf(B), null, 'climbing into another room: the old spot is not where it will climb down from');
  visit.noteRoomSpotOf(B, { left: 3, bottom: 4, onScreen: true });
  visit.setOtherInRoom(B, null);
  assert.equal(visit.roomSpotOf(B), null, 'down again: forgotten');
  visit.noteRoomSpotOf(B, { left: 3, bottom: 4, onScreen: true });
  leave();
  assert.equal(visit.roomSpotOf(B), null, 'gone from the strip: forgotten');
});

/* --- the room drawn ------------------------------------------------------------------------------------------------ */

const SHEET_MOTION = { facing: 'side', loop: true, ticks: [0] };
const SHEET = {
  v: 1,
  cell: { w: 20, h: 32 },
  columns: 1,
  cells: 1,
  fps: 10,
  floor: 30,
  head: 4,
  motions: Object.fromEntries(['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep', 'catch'].map((id) => [id, SHEET_MOTION])),
};
const shownOf = (person) => ({ person, characterId: 'c', mood: 'busy', stripUrl: `https://store.test/${person}/strip.png`, sheet: SHEET, bakedAt: '2026-11-22' });

let othersNow = { onStrip: [], inRoom: {} };
const visitNow = { known: true, out: false, look: null, still: false, inRoom: false, arriveX: 0 };
stub('components/AuthProvider.js', { useAuth: () => ({ user: { id: VIEWER, displayName: 'Viewer' } }) });
stub('components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ playing: false }) });
stub('lib/character/use-shown-character.js', { useShownCharacter: (person) => (person === B || person === C ? shownOf(person) : null) });
// The server render reads the stores' server snapshots: they stand in for what the companions have said.
visit.serverCompanionVisit = () => visitNow;
visit.serverOthersHere = () => othersNow;

const ProfileRoom = require(path.join(OUT, 'components/ProfileRoom.js')).default;
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const wearing = (html, person) => count(html, new RegExp(`store\\.test/${person}/strip`, 'g'));
const heightOf = (html) => Number((html.match(/style="height:(\d+)px"[^>]*data-profile-room-stage/) ?? [])[1]);
// Visiting commenters come from lookups after the room mounts, which a static render cannot run: they share the owner's
// path (`guestsHere`, `fromStrip`), and the browser drive covers the room as a whole.
const draw = (userId) => renderToStaticMarkup(React.createElement(ProfileRoom, { userId, displayName: 'Person B', music: false }));

ok('not in a stream with them: the room draws their character itself, as before', () => {
  othersNow = { onStrip: [], inRoom: {} };
  const html = draw(B);
  assert.equal(count(html, /data-profile-character="owner"/g), 1);
  assert.equal(wearing(html, B), 1);
});

ok('in a stream with them, their companion on its way up: the room is there, with no copy of them, and keeps its height', () => {
  const before = heightOf(draw(B));
  othersNow = { onStrip: [B], inRoom: {} };
  const html = draw(B);
  assert.match(html, /data-profile-room-stage/, 'the room is still there to climb into');
  assert.equal(count(html, /data-profile-character="owner"/g), 0, 'their companion on the strip is the one figure of them');
  assert.equal(wearing(html, B), 0);
  assert.equal(heightOf(html), before, 'room kept for it, so nothing jumps when it steps in');
});

ok('climbed in: exactly one of them, the room carrying on where it stepped in, facing the way it climbed', () => {
  othersNow = { onStrip: [B], inRoom: { [B]: { x: 37, facing: -1 } } };
  const html = draw(B);
  assert.equal(count(html, /data-profile-character="owner"/g), 1);
  assert.equal(wearing(html, B), 1);
  // A static render has no width (so every figure stands at 0) and reads as reduced motion (so it idles): where it starts
  // and its wave are the browser drive's to see. The way it faces shows here.
  assert.match(html, /transform:scaleX\(-1\)/, 'facing the way it climbed (left)');
  othersNow = { onStrip: [B], inRoom: { [B]: { x: 37, facing: 1 } } };
  assert.doesNotMatch(draw(B), /transform:scaleX\(-1\)/, 'and right when it climbed facing right');
});

console.log(`\n${passed} passed`);
