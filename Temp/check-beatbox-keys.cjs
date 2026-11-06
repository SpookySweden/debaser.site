/*
 * The beat box's changeable keys, movable windows, loop bar and picked-up notes, the parts that need no browser: Space starts as play
 * and pause, a key can't be given a job that would break the notes, a taken key swaps, a bad save can't break the page, a window can never
 * be lost off an edge, the loop drags as BeepBox's does, and a moved note lands only where there's room. The browser's side of it is in
 * Temp/check-beatbox-ui.cjs, run by hand.
 *   npx tsc app/features/beatbox/ui/keyBindings.ts app/features/beatbox/ui/windowStore.ts app/features/beatbox/ui/loopEdit.ts app/features/beatbox/ui/noteEdit.ts --rootDir app --outDir Temp/beatbox-keys-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const K = require('./beatbox-keys-out/features/beatbox/ui/keyBindings.js');
const W = require('./beatbox-keys-out/features/beatbox/ui/windowStore.js');
const L = require('./beatbox-keys-out/features/beatbox/ui/loopEdit.js');
const N = require('./beatbox-keys-out/features/beatbox/ui/noteEdit.js');

const stroke = (key, code, extra = {}) => K.strokeOf({ key, code, ctrlKey: false, shiftKey: false, ...extra });
const memory = () => {
  const held = new Map();
  return { getItem: (k) => held.get(k) ?? null, setItem: (k, v) => void held.set(k, v), removeItem: (k) => void held.delete(k), held };
};

// What the keys start as, Luke's first of all.
assert.equal(K.STARTING_KEYS.playPause, 'Space', 'Space plays and pauses');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke(' ', 'Space')), 'playPause');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('r', 'KeyR')), 'record');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('R', 'KeyR', { shiftKey: true })), 'windowRecorder', 'Shift is a different key');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('z', 'KeyZ', { ctrlKey: true })), 'undo');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('Z', 'KeyZ', { ctrlKey: true, shiftKey: true })), 'redo', 'the other redo');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('?', 'Slash', { shiftKey: true })), 'help', 'a printed character goes by what it prints');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('H', 'KeyH', { shiftKey: true })), 'hand');
assert.equal(K.actionFor(K.STARTING_KEYS, stroke('a', 'KeyA')), null, 'a piano key is no action');
assert.equal(stroke('Shift', 'ShiftLeft', { shiftKey: true }), null, 'a modifier alone is no key');

// No two jobs start on one key, and none starts on a key it couldn't be changed to.
{
  const all = Object.values(K.STARTING_KEYS);
  assert.equal(new Set(all).size, all.length, 'every job has its own key');
  for (const [action, key] of Object.entries(K.STARTING_KEYS)) {
    if (key !== 'Escape') assert.equal(K.whyNot(key), null, `${action} starts on ${key}, which is allowed`);
  }
}

// In words a person knows.
assert.equal(K.keyWords('KeyR'), 'R');
assert.equal(K.keyWords('Shift+KeyL'), 'Shift+L');
assert.equal(K.keyWords('Ctrl+Shift+KeyZ'), 'Ctrl+Shift+Z');
assert.equal(K.keyWords('Escape'), 'Esc');
assert.equal(K.keyWords('Space'), 'Space');

// Keys that can't be given a job, each saying why.
for (const refused of ['KeyA', 'KeyL', 'KeyF', 'KeyZ', 'KeyX', ';', '5', 'Enter', 'Tab', 'ArrowUp', 'Shift+ArrowUp', 'Delete', 'Backspace', 'PageUp', 'Home', 'F5', 'F12', 'Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyR', 'Ctrl+Shift+KeyI', 'Ctrl+5']) {
  assert.ok(K.whyNot(refused), `${refused} is refused`);
}
assert.ok(K.whyNot('ö', 'Semicolon'), 'the piano key at the semicolon, on a keyboard where it prints something else');
for (const allowed of ['KeyB', 'Shift+KeyA', 'Ctrl+KeyB', 'F2', 'Insert', '`', 'Shift+Space']) {
  assert.equal(K.whyNot(allowed), null, `${allowed} is allowed`);
}

// A free key moves; a taken key swaps, so no job is left without one.
{
  const moved = K.bind(K.STARTING_KEYS, 'playPause', 'Insert');
  assert.equal(moved.playPause, 'Insert');
  assert.equal(K.actionFor(moved, 'Space'), null, 'Space is free now');
  assert.equal(K.clashWith(K.STARTING_KEYS, 'playPause', 'KeyR'), 'record');
  assert.equal(K.clashWith(K.STARTING_KEYS, 'record', 'KeyR'), null, 'its own key is no clash');
  const swapped = K.bind(K.STARTING_KEYS, 'playPause', 'KeyR');
  assert.equal(swapped.playPause, 'KeyR');
  assert.equal(swapped.record, 'Space');
  assert.equal(K.STARTING_KEYS.playPause, 'Space', 'the starting keys are never changed in place');
  // A second way to a job goes with the job's first key.
  const redo = K.bind(K.STARTING_KEYS, 'redo', 'Insert');
  assert.equal(K.actionFor(redo, 'Ctrl+Shift+KeyZ'), null, 'the other redo goes when redo is changed');
  const taken = K.bind(K.STARTING_KEYS, 'follow', 'Ctrl+Shift+KeyZ');
  assert.equal(K.actionFor(taken, 'Ctrl+Shift+KeyZ'), 'follow', 'a key given a job wins over the other redo');
}

// Remembered, and a bad save can't hurt.
{
  const store = memory();
  K.saveBindings(store, K.bind(K.STARTING_KEYS, 'playPause', 'KeyR'));
  const back = K.loadBindings(store);
  assert.equal(back.playPause, 'KeyR');
  assert.equal(back.record, 'Space');
  assert.equal(new Set(Object.values(back)).size, Object.values(back).length, 'still one job a key');
  assert.deepEqual(K.loadBindings(null), K.STARTING_KEYS, 'no storage');
  store.setItem('debaser.beatbox.keys.v1', 'not json');
  assert.deepEqual(K.loadBindings(store), K.STARTING_KEYS, 'a broken save');
  store.setItem('debaser.beatbox.keys.v1', JSON.stringify({ playPause: 'KeyA', record: 5, stop: 'Enter' }));
  assert.deepEqual(K.loadBindings(store), K.STARTING_KEYS, 'keys that could break the notes are not taken back');
  const moved = K.bind(K.STARTING_KEYS, 'stop', 'Insert');
  store.setItem('debaser.beatbox.keys.v1', JSON.stringify(moved));
  assert.equal(K.loadBindings(store).stop, 'Insert');
  const throwing = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.deepEqual(K.loadBindings(throwing), K.STARTING_KEYS, 'a browser that refuses');
  K.saveBindings(throwing, K.STARTING_KEYS);
}

// A window stays in its room.
{
  const size = { width: 480, height: 600 };
  const room = { width: 1248, height: 650 };
  assert.deepEqual(W.clampPlace({ x: 100, y: 20 }, size, room), { x: 100, y: 20 }, 'inside stays put');
  assert.deepEqual(W.clampPlace({ x: -900, y: -900 }, size, room), { x: 0, y: 0 });
  assert.deepEqual(W.clampPlace({ x: 9000, y: 9000 }, size, room), { x: 768, y: 50 });
  assert.deepEqual(W.clampPlace({ x: 50, y: 50 }, { width: 2000, height: 2000 }, room), { x: 0, y: 0 }, 'too big for the room: its title still shows');
}

// Which is open and in front, and where each one sits.
{
  const store = memory();
  const windows = W.createWindowStore(store);
  let told = 0;
  windows.subscribe(() => {
    told += 1;
  });
  assert.deepEqual(windows.getOpen(), [], 'the page opens clear');
  windows.open('sounds');
  windows.open('song');
  assert.deepEqual(windows.getOpen(), ['sounds', 'song']);
  assert.equal(windows.isFront('song'), true);
  const same = windows.getOpen();
  windows.toFront('song');
  assert.equal(windows.getOpen(), same, 'nothing changes, so nothing redraws');
  windows.toFront('sounds');
  assert.equal(windows.isFront('sounds'), true);
  windows.close('sounds');
  assert.equal(windows.isFront('song'), true, 'the next one comes forward');
  assert.equal(windows.isOpen('sounds'), false);
  assert.ok(told >= 4);

  const start = windows.getPlace('settings');
  assert.notDeepEqual(start, windows.getPlace('sounds'), 'each starts in its own place, so each title shows');
  windows.setPlace('settings', { x: 300, y: 40 });
  assert.equal(store.held.size, 0, 'a drag is not written down pixel by pixel');
  windows.rememberPlaces();
  assert.deepEqual(W.createWindowStore(store).getPlace('settings'), { x: 300, y: 40 }, 'remembered');
  assert.deepEqual(W.createWindowStore(store).getOpen(), [], 'which were open is not');
  windows.resetPlaces();
  assert.deepEqual(windows.getPlace('settings'), start, 'put back');
  assert.deepEqual(W.createWindowStore(store).getPlace('settings'), start, 'and forgotten');

  store.setItem('debaser.beatbox.windows.v1', '{"settings":{"x":"lots","y":null},"sounds":7}');
  assert.deepEqual(W.createWindowStore(store).getPlace('settings'), start, 'a broken save starts afresh');
  store.setItem('debaser.beatbox.windows.v1', 'not json');
  assert.deepEqual(W.createWindowStore(store).getPlace('settings'), start);
  assert.deepEqual(W.createWindowStore(null).getPlace('settings'), start, 'no storage');
}

// The loop bar, against what BeepBox's own does.
{
  const loop = { start: 4, length: 4 }; // Bars 5 to 8, counted from 0, so its middle is at 6.
  assert.equal(L.loopGrabAt(loop, 4.1), 'start', 'the upper half takes the start');
  assert.equal(L.loopGrabAt(loop, 5.9), 'start');
  assert.equal(L.loopGrabAt(loop, 6.1), 'end', 'the lower half takes the end');
  assert.equal(L.loopGrabAt(loop, 8.2), 'end', 'a quarter of a bar past the end still counts');
  assert.equal(L.loopGrabAt(loop, 3.8), 'start', 'and before the start');
  assert.equal(L.loopGrabAt(loop, 3.7), 'both', 'further off, the whole loop goes');
  assert.equal(L.loopGrabAt(loop, 8.3), 'both');

  assert.deepEqual(L.dragLoop('start', loop, 4.5, 2.5, 16), { start: 2, length: 6 }, 'the start up');
  assert.deepEqual(L.dragLoop('end', loop, 7.5, 9.5, 16), { start: 4, length: 6 }, 'the end down');
  assert.deepEqual(L.dragLoop('start', loop, 4.5, 8.5, 16), { start: 7, length: 1 }, 'the start onto the end stays a bar long');
  assert.deepEqual(L.dragLoop('start', loop, 4.5, 10.5, 16), { start: 8, length: 2 }, 'and past it, the two swap');
  assert.deepEqual(L.dragLoop('end', loop, 7.5, 3.5, 16), { start: 4, length: 1 }, 'the end onto the start stays a bar long');
  assert.deepEqual(L.dragLoop('end', loop, 7.5, 1.5, 16), { start: 2, length: 2 }, 'and past it, the two swap');
  assert.deepEqual(L.dragLoop('end', loop, 7.5, 40, 16), { start: 4, length: 12 }, 'it stops at the end of the song');
  assert.deepEqual(L.dragLoop('start', loop, 4.5, -40, 16), { start: 0, length: 8 }, 'and at its start');
  assert.deepEqual(L.dragLoop('both', loop, 12, 12, 16), { start: 10, length: 4 }, 'carried, centred on the pointer');
  assert.deepEqual(L.dragLoop('both', loop, 15.5, 15.5, 16), { start: 12, length: 4 }, 'kept inside the song at the end');
  assert.deepEqual(L.dragLoop('both', loop, 0.2, 0.2, 16), { start: 0, length: 4 }, 'and at the start');

  assert.deepEqual(L.nudgeLoopEnd('start', loop, 3, 16), { start: 3, length: 5 });
  assert.deepEqual(L.nudgeLoopEnd('start', loop, 12, 16), { start: 7, length: 1 }, 'the keyboard stops at the other end');
  assert.deepEqual(L.nudgeLoopEnd('end', loop, 9, 16), { start: 4, length: 6 });
  assert.deepEqual(L.nudgeLoopEnd('end', loop, 0, 16), { start: 4, length: 1 });
  assert.deepEqual(L.nudgeLoopEnd('end', loop, 40, 16), { start: 4, length: 12 });
}

// A note picked up and put down, and its end dragged.
{
  const note = (pitches, start, end) => ({ pitches, start, end, pins: [{ interval: 0, time: 0, size: 3 }, { interval: 0, time: end - start, size: 3 }], continuesLastPattern: false });
  const a = note([48], 0, 6);
  const b = note([50], 24, 30);
  const notes = [a, b];
  const moved = N.moveNote(notes, a, 48, 6, 2, 192, 84);
  assert.deepEqual(moved.map(({ pitches, start, end }) => [pitches, start, end]), [[[50], 6, 12], [[50], 24, 30]], 'along and up');
  assert.deepEqual(N.moveNote(notes, a, 48, 24, 0, 192, 84).map(({ start }) => start), [0, 24], 'a taken place: it stays where it was along the bar');
  assert.deepEqual(N.moveNote(notes, a, 48, 30, 0, 192, 84).map(({ start }) => start), [24, 30], 'past the note in the way it can land');
  assert.deepEqual(N.moveNote(notes, b, 50, 1000, 0, 192, 84).map(({ start }) => start), [0, 186], 'held inside the bar');
  assert.deepEqual(N.moveNote(notes, a, 48, -100, -100, 192, 84)[0].pitches, [0], 'and inside the notes');
  const chord = note([48, 52], 0, 6);
  assert.deepEqual(N.moveNote([chord], chord, 48, 0, 2, 192, 84)[0].pitches, [50, 52], 'only the pitch held moves in a chord');
  assert.deepEqual(N.moveNote([chord], chord, 48, 0, 4, 192, 84)[0].pitches, [48, 52], 'and not onto one the chord has');

  const longer = N.setNoteEnd(notes, a, 18, 6, 192);
  assert.equal(longer[0].end, 18, 'longer');
  assert.equal(longer[0].pins[longer[0].pins.length - 1].time, 18, 'its pins go with it, or the sound would stop short');
  assert.equal(N.setNoteEnd(notes, a, 100, 6, 192)[0].end, 24, 'as far as the next note');
  assert.equal(N.setNoteEnd(notes, b, 1000, 6, 192)[1].end, 192, 'or the end of the bar');
  assert.equal(N.setNoteEnd(notes, a, -5, 6, 192)[0].end, 6, 'one step at the least');
  assert.equal(N.setNoteEnd(notes, a, 6, 6, 192), notes, 'nothing moved, nothing changed');
}

console.log('beat box keys and windows: Space plays and pauses, the notes keys are safe, taken keys swap, windows stay on screen, the loop drags as BeepBox does, notes move only to room: OK');
