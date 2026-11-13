/*
 * A profile's room and your companion's visit to it (Luke, 2026-11-13: "never two of the same character on the same
 * screen"), run from the root:
 *   npx tsc app/components/ProfileRoom.tsx app/lib/companion/visit.ts --rootDir app --outDir Temp/profile-room-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-room.cjs
 *
 * What it holds:
 *   - where the companion can climb to: only a room floor that is on screen, inside the page's scrolling pane, above its
 *     own strip, and wide enough to stand in;
 *   - a climb moves in whole steps and never past its floor;
 *   - leaving: settled in the room with its spot on screen it climbs down; still climbing, or its spot off screen, it
 *     vanishes (the portal brings it back); the page changing mid-climb makes it vanish;
 *   - the stores: a room taken away only by itself, and switching the companion off takes it out of the room;
 *   - the room drawn: on your own profile with your companion out there is never a second copy of your character (none
 *     before it arrives, exactly one, the visitor, after); with it off, the room draws your character itself; someone
 *     else's room holds their character and your visiting companion side by side; a room nobody would be in is left out;
 *     nothing is drawn before the companion has said whether it is out.
 * The climbing itself, in a real browser, is `scripts/drive-profile-room.cjs`.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'profile-room-render');

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

/* --- the pure parts ------------------------------------------------------------------------------------------------ */

const pane = { left: 100, top: 80, right: 1100, bottom: 760 };
const figure = { w: 40, h: 60 };
const strip = 820;

ok('it can climb to a room floor on screen, in the pane, above its strip', () => {
  const into = visit.roomFloor({ left: 120, top: 600, right: 1080, bottom: 700 }, pane, figure, strip);
  assert.deepEqual(into, { left: 120, right: 1040, floor: 700 });
});

ok('not to a floor scrolled below the pane, nor one above it, nor under its strip, nor one too narrow', () => {
  assert.equal(visit.roomFloor({ left: 120, top: 700, right: 1080, bottom: 800 }, pane, figure, strip), null, 'below the pane');
  assert.equal(visit.roomFloor({ left: 120, top: 0, right: 1080, bottom: 100 }, pane, figure, strip), null, 'no room over the floor for its head');
  assert.equal(visit.roomFloor({ left: 120, top: 600, right: 1080, bottom: 700 }, { ...pane, bottom: 900 }, figure, 699), null, 'under its own strip');
  assert.equal(visit.roomFloor({ left: 120, top: 600, right: 150, bottom: 700 }, pane, figure, strip), null, 'narrower than it');
});

ok('a climb moves in whole steps and never past its floor', () => {
  assert.equal(visit.climbToward(800, 600), 800 - visit.CLIMB_STEP);
  assert.equal(visit.climbToward(604, 600), 600);
  assert.equal(visit.climbToward(600, 800), 600 + visit.CLIMB_STEP);
  let y = 820;
  let steps = 0;
  while (y !== 300) {
    y = visit.climbToward(y, 300);
    steps += 1;
    assert.ok(steps < 1000);
  }
  assert.equal(steps, Math.ceil(520 / visit.CLIMB_STEP));
});

ok('leaving: down from its spot when settled and on screen, else gone (and the portal); the page changing mid-climb, gone', () => {
  assert.equal(visit.whenRoomGoes('room', true), 'down');
  assert.equal(visit.whenRoomGoes('room', false), 'gone');
  assert.equal(visit.whenRoomGoes('up', true), 'gone');
  assert.equal(visit.whenRoomGoes('strip', true), 'strip');
  assert.equal(visit.whenPageChanges('down'), 'gone');
  assert.equal(visit.whenPageChanges('up'), 'gone');
  assert.equal(visit.whenPageChanges('strip'), 'strip');
  assert.ok(visit.PORTAL_AFTER_MS >= 1500 && visit.PORTAL_AFTER_MS <= 3000, 'about two seconds');
});

ok('a figure shows whole only inside the clip', () => {
  assert.equal(visit.wholeIn({ left: 200, top: 600, right: 240, bottom: 700 }, pane), true);
  assert.equal(visit.wholeIn({ left: 200, top: 720, right: 240, bottom: 780 }, pane), false);
});

ok('the stores: a room is taken away only by itself; switching the companion off takes it out of the room', () => {
  const one = { owner: 'a', stage: {} };
  const two = { owner: 'b', stage: {} };
  const closeOne = visit.openRoom(one);
  const closeTwo = visit.openRoom(two);
  closeOne();
  assert.equal(visit.visitRoomState(), two, 'the old room going does not take the new one');
  closeTwo();
  assert.equal(visit.visitRoomState(), null);
  visit.setCompanionOut({ known: true, out: true, look: null, still: false });
  visit.setCompanionInRoom(true, 12.4);
  assert.equal(visit.companionVisitState().inRoom, true);
  assert.equal(visit.companionVisitState().arriveX, 12);
  visit.setCompanionOut({ known: true, out: false, look: null, still: false });
  assert.equal(visit.companionVisitState().inRoom, false);
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
  motions: Object.fromEntries(['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'].map((id) => [id, SHEET_MOTION])),
};
const shownOf = (person) => ({ person, characterId: 'c', mood: 'busy', stripUrl: `https://store.test/${person}/strip.png`, sheet: SHEET, bakedAt: '2026-11-13' });

let user = null;
let shownFor = () => null;
let visitNow = { known: false, out: false, look: null, still: false, inRoom: false, arriveX: 0 };
stub('components/AuthProvider.js', { useAuth: () => ({ user }) });
stub('components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ playing: false }) });
stub('lib/character/use-shown-character.js', { useShownCharacter: (person) => shownFor(person) });
// The server render reads the visit store's server snapshot: it stands in for what the companion has said.
visit.serverCompanionVisit = () => visitNow;

const ProfileRoom = require(path.join(OUT, 'components/ProfileRoom.js')).default;
const draw = (userId) => renderToStaticMarkup(React.createElement(ProfileRoom, { userId, displayName: 'Test Account A', music: false }));
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const wearing = (html, person) => count(html, new RegExp(`store\\.test/${person}/strip`, 'g'));

const A = 'person-a';
const B = 'person-b';
const myLook = { stripUrl: shownOf(A).stripUrl, sheet: SHEET, mood: 'busy' };

ok('nothing before the companion has said whether it is out', () => {
  user = { id: A };
  shownFor = (person) => (person === A ? shownOf(A) : null);
  visitNow = { known: false, out: false, look: null, still: false, inRoom: false, arriveX: 0 };
  assert.equal(draw(A), '');
});

ok('your own profile, companion out, on its way: the room is there, and no copy of you in it', () => {
  visitNow = { known: true, out: true, look: myLook, still: false, inRoom: false, arriveX: 0 };
  const html = draw(A);
  assert.match(html, /TEST ACCOUNT A&#x27;S ROOM|TEST ACCOUNT A'S ROOM/, 'titled with the name');
  assert.match(html, /data-profile-room-stage/);
  assert.match(html, /class="frame bg-ena-deep"/, 'in the ENA colours, framed');
  assert.equal(count(html, /data-profile-character/g), 0, 'the room draws no character of yours');
  assert.equal(count(html, /data-companion=/g), 0);
  assert.equal(wearing(html, A), 0);
});

ok('your own profile, companion arrived: exactly one of you, the companion', () => {
  visitNow = { known: true, out: true, look: myLook, still: false, inRoom: true, arriveX: 30 };
  const html = draw(A);
  assert.equal(count(html, /data-companion="visiting"/g), 1);
  assert.equal(count(html, /data-profile-character/g), 0);
  assert.equal(wearing(html, A), 1, 'one figure wears your strip');
});

ok('your own profile, companion switched off: the room draws your character itself', () => {
  visitNow = { known: true, out: false, look: myLook, still: false, inRoom: false, arriveX: 0 };
  const html = draw(A);
  assert.equal(count(html, /data-profile-character/g), 1);
  assert.equal(count(html, /data-companion=/g), 0);
  assert.equal(wearing(html, A), 1);
});

ok("someone else's room: their character, and your companion visiting beside it", () => {
  shownFor = (person) => (person === B ? shownOf(B) : person === A ? shownOf(A) : null);
  visitNow = { known: true, out: true, look: myLook, still: false, inRoom: true, arriveX: 10 };
  const html = draw(B);
  assert.equal(count(html, /data-profile-character/g), 1);
  assert.equal(count(html, /data-companion="visiting"/g), 1);
  assert.equal(wearing(html, B), 1);
  assert.equal(wearing(html, A), 1);
});

ok('an owner with no shown character: your companion still visits; with it off the room is left out', () => {
  shownFor = () => null;
  visitNow = { known: true, out: true, look: myLook, still: false, inRoom: true, arriveX: 0 };
  const visited = draw(B);
  assert.equal(count(visited, /data-profile-character/g), 0);
  assert.equal(count(visited, /data-companion="visiting"/g), 1);
  visitNow = { known: true, out: false, look: null, still: false, inRoom: false, arriveX: 0 };
  assert.equal(draw(B), '', 'nobody would be in it');
});

ok('a companion with no shown character visits as the placeholder field', () => {
  shownFor = () => null;
  visitNow = { known: true, out: true, look: null, still: false, inRoom: true, arriveX: 0 };
  const html = draw(B);
  assert.match(html, /data-companion="visiting"/);
  assert.match(html, /data-companion-figure="placeholder"/);
  assert.match(html, /sprite-slot/);
});

console.log(`\n${passed} passed`);
