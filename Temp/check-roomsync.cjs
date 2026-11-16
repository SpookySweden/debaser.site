/*
 * ROOMSYNC's rules (Luke's list 4, 2026-11-16), without a browser. scripts/drive-roomsync.cjs drives them in one.
 *   npx tsc app/lib/watch/chat-picture.ts app/lib/watch/room-transport.ts app/lib/watch/watch-window.ts app/lib/companion/events.ts --outDir Temp/roomsync-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict --jsx react-jsx
 *   node Temp/check-roomsync.cjs
 *
 * What it holds:
 *   1. "click on a previous thing in the queue to play it again, and the back arrow ... to go back to it": the back arrow
 *      starts the row played just before what is on, where it stands in the list; on a black screen the last thing
 *      played; nothing before the first. A press in the queue window plays at once in the drawn room, or opens the room
 *      and plays as soon as it says it can, and a press that waited too long is forgotten.
 *   2. "when leasving make sure the room you had before is waiting for you": going from your own room into somebody
 *      else's and leaving it puts you back in yours, folded or open as you left it; leaving with no room behind you,
 *      or a room that is not yours, closes the window as before.
 *   4. "have the companion raise it rather than sending the text of the url": which chat lines are pictures (GIPHY and
 *      Commons as before; any public https picture address as an outside picture; never SVG, a private-network address,
 *      plain http, words, or a guest's line), and the companion is told only of a fresh line.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'roomsync-check');
const { chatPicture } = require(path.join(OUT, 'watch', 'chat-picture.js'));
const transport = require(path.join(OUT, 'watch', 'room-transport.js'));
const windows = require(path.join(OUT, 'watch', 'watch-window.js'));
const events = require(path.join(OUT, 'companion', 'events.js'));

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

const row = (id, playIndex, over = {}) => ({ id, playIndex, playedAt: playIndex === null ? null : `2026-11-16T20:0${playIndex}:00Z`, inQueue: true, position: playIndex ?? 9, addedAt: '2026-11-16T20:00:00Z', series: null, ...over });
const read = (current, queue, clearedAt = null) => ({ room: { currentEntryId: current, clearedAt }, queue });

ok('1. the back arrow starts the row played just before what is on, where it stands in the list', () => {
  const queue = [row('a', 0), row('b', 1), row('c', 2), row('d', null)];
  assert.equal(transport.previousPlay(read('c', queue))?.id, 'b');
  assert.equal(transport.previousPlay(read('b', queue))?.id, 'a', 'and again, further back (the list does not move)');
  assert.equal(transport.previousPlay(read('a', queue)), null, 'nothing before the first: what is on starts from the top');
  assert.equal(transport.previousPlay(read(null, queue))?.id, 'c', 'a black screen: the last thing played');
  assert.equal(transport.previousPlay(read('d', [row('d', null)])), null, 'nothing played: nothing to go back to');
  // STORE AND START BLANK: what played before the clear is not gone back to.
  assert.equal(transport.previousPlay(read('c', queue, '2026-11-16T20:01:30Z')), null, 'not past a clear');
});

ok('1. a press in the queue window plays at once in the drawn room, or opens it and plays once it can; an old press is forgotten', () => {
  const played = [];
  const off = transport.registerRoomReplay('room-1', (id) => played.push(['room-1', id]));
  transport.replayInRoom('room-1', 'a');
  assert.deepEqual(played, [['room-1', 'a']], 'at once while the room is drawn');
  off();
  windows.closeWatch();
  transport.replayInRoom('room-1', 'b');
  assert.deepEqual(windows.watchWindowState().focus, { kind: 'room', roomId: 'room-1' }, 'the room is opened for it');
  assert.deepEqual(played, [['room-1', 'a']], 'nothing plays before the room can');
  const off2 = transport.registerRoomReplay('room-1', (id) => played.push(['room-1', id]));
  assert.deepEqual(played, [['room-1', 'a'], ['room-1', 'b']], 'played once the room says it can');
  off2();
  const off3 = transport.registerRoomReplay('room-1', (id) => played.push(['room-1', id]));
  assert.equal(played.length, 2, 'and only once');
  off3();
  // A press that waited longer than the room took to open is not played long after.
  const realNow = Date.now;
  transport.replayInRoom('room-2', 'c');
  Date.now = () => realNow() + 60_000;
  const off4 = transport.registerRoomReplay('room-2', (id) => played.push(['room-2', id]));
  Date.now = realNow;
  assert.equal(played.length, 2, 'an old press is forgotten');
  off4();
  windows.closeWatch();
});

ok('2. leaving somebody else\'s room puts you back in your own, folded or open as you left it', () => {
  windows.closeWatch();
  windows.openWatch({ kind: 'room', roomId: 'mine' });
  windows.collapseWatch(false);
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  assert.deepEqual(windows.watchWindowState(), { open: true, focus: { kind: 'room', roomId: 'theirs' }, collapsed: false, pip: false });
  windows.leaveRoom('mine');
  assert.deepEqual(windows.watchWindowState(), { open: true, focus: { kind: 'room', roomId: 'mine' }, collapsed: true, pip: false }, 'back in yours, folded as it was');

  windows.expandWatch();
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.leaveRoom('mine');
  assert.deepEqual(windows.watchWindowState(), { open: true, focus: { kind: 'room', roomId: 'mine' }, collapsed: false, pip: false }, 'open as it was');

  windows.leaveRoom('mine');
  assert.equal(windows.watchWindowState().open, false, 'leaving your own room closes the window, as before');

  // Code review, 2026-11-16: a hop through somebody's room into another's still finds the way back.
  windows.openWatch({ kind: 'room', roomId: 'mine' });
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.openWatch({ kind: 'room', roomId: 'another' });
  windows.leaveRoom('mine');
  assert.deepEqual(windows.watchWindowState().focus, { kind: 'room', roomId: 'mine' }, 'yours, two rooms on');
  windows.closeWatch();
  windows.openWatch({ kind: 'room', roomId: 'someone' });
  windows.openWatch({ kind: 'room', roomId: 'mine' });
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.leaveRoom('mine');
  assert.deepEqual(windows.watchWindowState().focus, { kind: 'room', roomId: 'mine' }, 'yours, though another room came before it');
  windows.closeWatch();
});

ok('2. leaving with no room behind you, or a room that is not yours behind you, closes the window as before', () => {
  windows.closeWatch();
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.leaveRoom('mine');
  assert.equal(windows.watchWindowState().open, false, 'nothing behind it: closed');

  windows.openWatch({ kind: 'room', roomId: 'someone' });
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.leaveRoom('mine');
  assert.equal(windows.watchWindowState().open, false, 'a room that is not yours is not gone back into');

  windows.openWatch({ kind: 'room', roomId: 'mine' });
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.openWatch({ kind: 'room', roomId: 'mine' });
  windows.openWatch({ kind: 'room', roomId: 'other' });
  windows.closeWatch();
  windows.openWatch({ kind: 'room', roomId: 'theirs' });
  windows.leaveRoom('mine');
  assert.equal(windows.watchWindowState().open, false, 'a window closed on the way spends the way back');
});

ok('4. which chat lines are pictures: GIPHY and Commons as before, any public https picture address as an outside one', () => {
  assert.deepEqual(chatPicture('https://media2.giphy.com/media/abc/200.gif?cid=x', false), { url: 'https://media2.giphy.com/media/abc/200.gif', outside: false }, 'GIPHY, its tracking dropped');
  assert.deepEqual(chatPicture('  https://media.tenor.com/abc/cat.gif  ', false), { url: 'https://media.tenor.com/abc/cat.gif', outside: true }, 'any public host: an outside picture');
  assert.deepEqual(chatPicture('https://cdn.example.com/a/b/photo.JPG?size=large', false), { url: 'https://cdn.example.com/a/b/photo.JPG?size=large', outside: true }, 'its query kept (many hosts need it)');
  for (const words of [
    'hello there',
    'https://example.com/page',
    'https://example.com/report.pdf',
    'https://www.youtube.com/watch.html?v=abc',
    'look https://media.tenor.com/abc/cat.gif',
    'http://cdn.example.com/cat.gif',
    'https://cdn.example.com/cat.svg',
    'https://192.168.1.10/cat.png',
    'https://router.local/cat.png',
    'https://user:pass@cdn.example.com/cat.png',
    'https://cdn.example.com:8080/cat.png',
    'javascript:alert(1)//x.png',
    '',
  ]) {
    assert.equal(chatPicture(words, false), null, `words, not a picture: ${words}`);
  }
  assert.equal(chatPicture('https://media.tenor.com/abc/cat.gif', true), null, 'a guest\'s line is always words');
  assert.equal(chatPicture(`https://cdn.example.com/${'a'.repeat(2100)}.png`, false), null, 'too long to be taken as an address');
});

ok('4. the companion is told of a fresh picture line, never of an old one read back in', () => {
  const heard = [];
  const off = events.onCompanionHolds((who, picture) => heard.push([who, picture.url]));
  events.companionHolds('u1', new Date().toISOString(), { url: 'https://media.giphy.com/media/a/giphy.gif', outside: false });
  events.companionHolds('u1', new Date(Date.now() - 60_000).toISOString(), { url: 'https://media.giphy.com/media/b/giphy.gif', outside: false });
  events.companionHolds('u1', 'not a time', { url: 'https://media.giphy.com/media/c/giphy.gif', outside: false });
  off();
  events.companionHolds('u1', new Date().toISOString(), { url: 'https://media.giphy.com/media/d/giphy.gif', outside: false });
  assert.deepEqual(heard, [['u1', 'https://media.giphy.com/media/a/giphy.gif']]);
});

console.log(`\n${passed} passed`);
