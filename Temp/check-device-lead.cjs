/*
 * One account on several devices in one room (Luke, 2026-11-27: "issues with my streams being synced on multiple devices logged
 * into the same account, they dont seem to try to be synced"; his answers 1A "last one touched", 2A "follow live", 3A "full sync").
 *   npx tsc app/lib/watch/device-lead.ts --outDir Temp/device-lead-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-device-lead.cjs
 *
 * The rules `app/lib/watch/device-lead.ts` keeps, which the room window (WatchRoom.tsx) and your room's keeper on the music bar
 * (MusicRoomKeeper.tsx) both read:
 *   - a change to the room's playback that this tab wrote is its own (it leads); one it did not write came from another of your
 *     devices (it follows), to the millisecond the stores keep;
 *   - only a real change counts: what is on, playing or paused, or a jump. The clock running on between two writes, or a write
 *     about something else, is not one;
 *   - a crown's NEXT taking a picture off says nothing about which of your devices leads.
 * The whole of it, in a browser with two devices, is scripts/drive-same-account.cjs (watched failing on the code before it).
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const lead = require(path.join(__dirname, 'device-lead-check', 'watch', 'device-lead.js'));

let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const room = (over) => ({ id: 'room-1', currentEntryId: 'a', positionSeconds: 10, isPlaying: true, updatedAt: '2026-11-27T10:00:00.000Z', ...over });
const t0 = Date.parse('2026-11-27T10:00:00Z');

/* --- whose write ---------------------------------------------------------------------------------------------------- */

lead.forgetOwnPlayback();
lead.noteOwnPlayback('room-1', { currentEntryId: 'a', positionSeconds: 42.1234567, isPlaying: false }, t0);
assert.equal(lead.isOwnPlayback(room({ positionSeconds: 42.123, isPlaying: false }), t0 + 300), true, 'the store keeps the place to the millisecond');
assert.equal(lead.isOwnPlayback(room({ positionSeconds: 42.1234567, isPlaying: false }), t0 + 300), true, 'or exactly as sent (the mock store)');
pass('a write this tab sent is known as its own when it comes back');

assert.equal(lead.isOwnPlayback(room({ positionSeconds: 42.123, isPlaying: true }), t0 + 300), false, 'playing, where this tab said paused');
assert.equal(lead.isOwnPlayback(room({ positionSeconds: 45, isPlaying: false }), t0 + 300), false, 'another place');
assert.equal(lead.isOwnPlayback(room({ currentEntryId: 'b', positionSeconds: 42.123, isPlaying: false }), t0 + 300), false, 'another play');
assert.equal(lead.isOwnPlayback(room({ id: 'room-2', positionSeconds: 42.123, isPlaying: false }), t0 + 300), false, 'another room');
pass("anything else is another device's");

assert.equal(lead.isOwnPlayback(room({ positionSeconds: 42.123, isPlaying: false }), t0 + 61_000), false, 'a minute later it is forgotten');
pass('an old write is forgotten');

/* --- a real change -------------------------------------------------------------------------------------------------- */

const before = room({ positionSeconds: 10, isPlaying: true, updatedAt: '2026-11-27T10:00:00.000Z' });
assert.equal(lead.playbackChanged(before, room({ positionSeconds: 13, isPlaying: true, updatedAt: '2026-11-27T10:00:03.000Z' })), false, 'a beat three seconds on');
assert.equal(lead.playbackChanged(before, room({ positionSeconds: 13.8, isPlaying: true, updatedAt: '2026-11-27T10:00:03.000Z' })), false, 'a beat a little ahead');
assert.equal(lead.playbackChanged(before, before), false, 'the same row again (a setting saved)');
pass('the clock running on, or a write about something else, is no change');

assert.equal(lead.playbackChanged(before, room({ positionSeconds: 13, isPlaying: false, updatedAt: '2026-11-27T10:00:03.000Z' })), true, 'a pause');
assert.equal(lead.playbackChanged(before, room({ currentEntryId: 'b', positionSeconds: 0, updatedAt: '2026-11-27T10:00:03.000Z' })), true, 'another play');
assert.equal(lead.playbackChanged(before, room({ positionSeconds: 90, isPlaying: true, updatedAt: '2026-11-27T10:00:03.000Z' })), true, 'a jump forward');
assert.equal(lead.playbackChanged(before, room({ positionSeconds: 2, isPlaying: true, updatedAt: '2026-11-27T10:00:03.000Z' })), true, 'a jump back');
const paused = room({ positionSeconds: 30, isPlaying: false });
assert.equal(lead.playbackChanged(paused, room({ positionSeconds: 30, isPlaying: false, updatedAt: '2026-11-27T10:05:00.000Z' })), false, 'paused, the place stays');
assert.equal(lead.playbackChanged(paused, room({ positionSeconds: 60, isPlaying: false, updatedAt: '2026-11-27T10:00:01.000Z' })), true, 'a jump while paused');
pass('a pause, a play, another play and a jump are changes');

/* --- who leads ------------------------------------------------------------------------------------------------------ */

assert.equal(lead.leadFromChange({ own: true, pictureTakenOff: false }), 'lead');
assert.equal(lead.leadFromChange({ own: false, pictureTakenOff: false }), 'follow');
assert.equal(lead.leadFromChange({ own: false, pictureTakenOff: true }), null);
pass("your own change leads, another device's follows, a crown's NEXT off a picture says nothing");

console.log(`\nPASSED ${passed}`);
