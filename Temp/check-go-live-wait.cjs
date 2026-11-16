/**
 * GO LIVE pressed before your own room has been read waits for it, and never falls back to making a separate room
 * (list 3, ROOMS: found on the live site, where TEST ACCOUNT B's GO LIVE opened the old separate-room menu because the
 * room was still being read). Held against main-room-play.ts itself.
 *
 * Steps (above the fold, because `run-checks.cjs` only reads the first 20 lines for these):
 *   npx tsc app/lib/watch/main-room-play.ts --rootDir app --outDir Temp/go-live-wait-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *
 * What it holds:
 *   1. An account whose room is not read yet: goLiveInMainRoom says it will handle it (true), so the caller opens no menu
 *      of its own, and once the room is read the room's window opens on WHO CAN JOIN.
 *   2. A signed-out visitor: false (the caller tells them to log in).
 *   3. A room already read: the window opens at once.
 */
const assert = require('node:assert/strict');

// The page's window, as far as these modules ask of it.
global.window = { setTimeout, clearTimeout, location: { search: '', pathname: '/forum' }, history: { replaceState() {}, pushState() {} }, addEventListener() {}, removeEventListener() {} };

const play = require('./go-live-wait-out/lib/watch/main-room-play.js');
const own = require('./go-live-wait-out/lib/watch/own-room-client.js');
const watchWindow = require('./go-live-wait-out/lib/watch/watch-window.js');

let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const session = (id) => ({ id: () => id, ensureMade: async () => true });

(async () => {
  // 1. Not read yet.
  watchWindow.closeWatch();
  own.setOwnRoom({ session: null, roomId: null, hostId: null, visitor: false, waiting: false });
  assert.equal(play.goLiveInMainRoom(), true, 'an account is never sent to the old separate-room menu');
  await tick();
  assert.equal(watchWindow.watchWindowState().open, false, 'nothing opens before the room is read');
  const made = session('room-b');
  own.setOwnRoom({ session: made, roomId: 'room-b', hostId: 'user-b', visitor: false, waiting: false });
  await tick();
  await tick();
  const shown = watchWindow.watchWindowState();
  assert.ok(shown.open && shown.focus?.kind === 'room' && shown.focus.roomId === 'room-b', 'once read, your room opens');
  assert.equal(play.takeGoLiveAsk('room-b'), true, 'on WHO CAN JOIN');
  pass('pressed before your room is read: it waits, then opens your room on WHO CAN JOIN; no separate room');

  // 2. A visitor.
  watchWindow.closeWatch();
  own.setOwnRoom({ session: session('visitor-room'), roomId: 'visitor-room', hostId: 'visitor:x', visitor: true, waiting: false });
  assert.equal(play.goLiveInMainRoom(), false, 'a visitor: false, so the caller says to log in');
  pass('a signed-out visitor: false');

  // 3. Already read.
  own.setOwnRoom({ session: session('room-c'), roomId: 'room-c', hostId: 'user-c', visitor: false, waiting: false });
  assert.equal(play.goLiveInMainRoom(), true);
  await tick();
  await tick();
  assert.equal(watchWindow.watchWindowState().focus?.roomId, 'room-c', 'opens at once');
  pass('a room already read: it opens at once');
  console.log(`check-go-live-wait: ${passed} passed`);
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
