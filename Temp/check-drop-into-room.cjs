/*
 * Dropping a character into a profile's ROOM (Luke, 2026-11-23: "allow to drag into the profile room"; "Also others' in
 * stream"). Run from the root:
 *   npx tsc app/lib/companion/loose.ts app/components/ProfileRoom.tsx app/lib/companion/visit.ts --rootDir app --outDir Temp/drop-into-room-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-drop-into-room.cjs
 *
 * What it holds (the rule every carried character uses: your companion, one taken out of a ROOM, somebody's off the strip):
 *   - let go over a ROOM, it falls onto the ROOM's floor; thrown so that it comes down through the floor, it lands there,
 *     where it crossed the floor line;
 *   - rising up through the floor, passing beside the ROOM, falling from below its floor, or with no ROOM on screen: no;
 *   - it lands only where a figure of its width can stand, at whole pixels;
 *   - somebody's companion dropped into a ROOM that is not theirs is drawn there as a visitor, wearing its own look, where it
 *     landed; nobody already in the ROOM (its owner, a visiting commenter, you) is drawn twice; gone from the store, gone
 *     from the ROOM; a ROOM always offers itself to a drop, even with nobody to call up.
 * The carrying itself, in a real browser on a local mock server, is `scripts/drive-drop-into-room.cjs`.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'drop-into-room-render');
let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

const loose = require(path.join(OUT, 'lib/companion/loose.js'));
const room = { left: 200, right: 700, floor: 600 };

ok('let go over a ROOM: falling straight down, it lands on its floor where it is', () => {
  assert.equal(typeof loose.dropsInto, 'function', 'loose.ts says whether a frame drops it into a room');
  assert.equal(loose.dropsInto({ x: 400, y: 560 }, { x: 400, y: 620 }, room), 400);
  assert.equal(loose.dropsInto({ x: 400, y: 600 }, { x: 400, y: 600 }, room), 400, 'already on the floor line');
});

ok('thrown in from above: it lands where it crossed the floor line', () => {
  assert.equal(loose.dropsInto({ x: 300, y: 500 }, { x: 500, y: 700 }, room), 400, 'halfway along the frame is the floor');
  assert.equal(loose.dropsInto({ x: 150, y: 590 }, { x: 250, y: 610 }, room), 200, 'just inside its left end');
});

ok('not rising through it, beside it, from below its floor, or with no ROOM on screen', () => {
  assert.equal(loose.dropsInto({ x: 400, y: 700 }, { x: 400, y: 560 }, room), null, 'rising up through the floor');
  assert.equal(loose.dropsInto({ x: 900, y: 560 }, { x: 900, y: 640 }, room), null, 'beside it');
  assert.equal(loose.dropsInto({ x: 100, y: 560 }, { x: 120, y: 640 }, room), null, 'crossing the line short of it');
  assert.equal(loose.dropsInto({ x: 400, y: 650 }, { x: 400, y: 700 }, room), null, 'let go below its floor');
  assert.equal(loose.dropsInto({ x: 400, y: 560 }, { x: 400, y: 590 }, room), null, 'not down to the floor yet');
  assert.equal(loose.dropsInto({ x: 400, y: 560 }, { x: 400, y: 620 }, null), null, 'no ROOM on screen');
});

ok('only where a figure of its width can stand, in whole pixels', () => {
  assert.equal(loose.dropsInto({ x: 700.4, y: 590 }, { x: 700.4, y: 610 }, room), 700);
  assert.equal(loose.dropsInto({ x: 333.3, y: 590 }, { x: 333.3, y: 610 }, room), 333);
});

/* --- dropped into somebody else's ROOM ------------------------------------------------------------------------------ */

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
const visit = require(path.join(OUT, 'lib/companion/visit.js'));
const SHEET_MOTION = { facing: 'side', loop: true, ticks: [0] };
const SHEET = {
  v: 1,
  cell: { w: 20, h: 32 },
  columns: 1,
  cells: 1,
  fps: 10,
  floor: 30,
  head: 4,
  motions: Object.fromEntries(['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep', 'catch', 'land'].map((id) => [id, SHEET_MOTION])),
};
const OWNER = 'room-owner';
const PAL = 'stream-pal';
const palLook = { stripUrl: 'https://store.test/stream-pal/strip.png', sheet: SHEET, mood: 'busy' };
let othersNow = { onStrip: [], inRoom: {} };
stub('components/AuthProvider.js', { useAuth: () => ({ user: { id: 'the-reader', displayName: 'Reader' } }) });
stub('components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ playing: false }) });
stub('lib/character/use-shown-character.js', {
  useShownCharacter: (person) => (person === OWNER ? { person, characterId: 'c', mood: 'calm', stripUrl: 'https://store.test/room-owner/strip.png', sheet: SHEET, bakedAt: '2026-11-23' } : null),
});
visit.serverCompanionVisit = () => ({ known: true, out: false, look: null, still: false, inRoom: false, arriveX: 0 });
visit.serverOthersHere = () => othersNow;
const ProfileRoom = require(path.join(OUT, 'components/ProfileRoom.js')).default;
const draw = () => renderToStaticMarkup(React.createElement(ProfileRoom, { userId: OWNER, displayName: 'Room Owner', music: false }));
const count = (html, pattern) => (html.match(pattern) ?? []).length;

ok("dropped into somebody else's ROOM: drawn there as a visitor, in its own look, by its own name", () => {
  assert.equal(typeof visit.droppedVisitors, 'function', 'visit.ts says who was dropped into a room');
  othersNow = { onStrip: [PAL], inRoom: { [PAL]: { x: 40, facing: -1, dropped: { name: 'Stream Pal', look: palLook } } } };
  const html = draw();
  assert.equal(count(html, /data-character-of="stream-pal"/g), 1, 'exactly one of them, in the ROOM');
  assert.equal(count(html, /store\.test\/stream-pal\/strip/g), 1, 'wearing their own look');
  assert.match(html, /STREAM PAL&#x27;S CHARACTER|STREAM PAL'S CHARACTER/, 'by their own name');
  assert.equal(count(html, /data-profile-character="owner"/g), 1, "and the ROOM's owner still there");
  assert.match(html, /transform:scaleX\(-1\)/, 'facing the way it was going as it landed');
});

ok('nobody already in the ROOM is drawn twice; gone from the store, gone from the ROOM', () => {
  othersNow = { onStrip: [OWNER], inRoom: { [OWNER]: { x: 10, facing: 1, dropped: { name: 'Room Owner', look: null } } } };
  assert.equal(count(draw(), /data-character-of="room-owner"/g), 1, 'its owner dropped into their own ROOM: still one');
  const two = { onStrip: [], inRoom: { a: { x: 1, facing: 1, dropped: { name: 'A', look: null } }, b: { x: 2, facing: 1 } } };
  assert.deepEqual(visit.droppedVisitors(two, ['the-reader']).map((one) => one.id), ['a'], 'only those dropped, not those who climbed in');
  assert.deepEqual(visit.droppedVisitors({ onStrip: [], inRoom: { me: { x: 1, facing: 1, dropped: { name: 'Me', look: null } } } }, ['me']), [], 'never one already drawn');
  othersNow = { onStrip: [PAL], inRoom: {} };
  assert.equal(count(draw(), /data-character-of="stream-pal"/g), 0, 'climbed back out: not in the ROOM');
});

ok('a ROOM always offers itself to a drop, even with nobody to call up', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'app', 'components', 'ProfileRoom.tsx'), 'utf8');
  assert.doesNotMatch(src, /if \(stage === null \|\| wantsKey\.length === 0\) return;/, 'not only when it has somebody to call');
  assert.match(src, /callIntoRoom\(\{ stage, wants: wantsKey\.length === 0 \? \[\] : wantsKey\.split/);
});

console.log(`\n${passed} passed`);
