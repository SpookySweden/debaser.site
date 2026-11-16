/*
 * PLAY on a MEDIA video pressed before your own room has been read still opens it in your room (Luke, list 4,
 * 2026-11-16: "when pressing play on a video on my "good morning" account it seems to still open a gap and extra options
 * under the video itself, seen in grid view. fix this."). On the live site your room takes a moment to read (343cbd1 found
 * the same for GO LIVE); a PLAY in that moment used to stay in its card for good (the room's keeper was not listening yet,
 * and when it started listening it skipped the video already on). Now the keeper hands over any PLAY it has not handled
 * the moment your room arrives, and never the same PLAY twice.
 * Run from the root:
 *   npx tsc app/lib/watch/row-handoff.ts --outDir Temp/row-handoff-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-row-handoff.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { takeUnhandledPlay } = require('./row-handoff-out/row-handoff.js');

const video = (play, id = `web:${play}`) => ({ play, id, shape: 'video', room: { link: { url: `https://example.org/${play}` } } });

/* 1. The rule: each PLAY once, a newer one always, nothing for nothing --------------------------------------------- */
assert.equal(takeUnhandledPlay(null), null, 'nothing on: nothing to hand over');
const first = video(1);
assert.equal(takeUnhandledPlay(first), first, 'a PLAY not handled yet is handed over');
assert.equal(takeUnhandledPlay(first), null, 'the same PLAY is never handed over twice');
assert.equal(takeUnhandledPlay(video(1)), null, 'nor an older or equal one');
const third = video(3);
assert.equal(takeUnhandledPlay(third), third, 'a newer PLAY is');
console.log('  ok    each PLAY is handed to your room once');

/* 2. The race: PLAY pressed while your room is still being read --------------------------------------------------- */
// The keeper is not listening yet (no room): the PLAY happens. When the room arrives the keeper subscribes and looks at
// what is on: the PLAY it never saw is handed over then.
const early = video(4);
// ...room arrives: the keeper's catch-up call:
assert.equal(takeUnhandledPlay(early), early, 'the PLAY pressed before the room was read goes to the room when it arrives');
// ...the room id changes again later (a blank room made real): the catch-up runs again and does not move it twice.
assert.equal(takeUnhandledPlay(early), null, 'a second catch-up leaves it alone (CANCEL on the ask keeps a video where it is)');
console.log('  ok    a PLAY pressed before your room was read is handed over when it arrives');

/* 3. The keeper uses it: on every start, and once more the moment it starts listening ---------------------------- */
const keeper = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'MusicRoomKeeper.tsx'), 'utf8');
const start = keeper.slice(keeper.indexOf('the screen: a video started'), keeper.indexOf('onFloatingEnded('));
assert.ok(start.length > 200, 'the start listener is where it was');
assert.match(start, /takeUnhandledPlay\(floatingState\(\)\.entry\)/, 'the listener asks for the PLAY it has not handled');
assert.doesNotMatch(start, /let lastPlay = floatingState\(\)\.entry\?\.play/, 'it no longer skips the video already on when it starts listening');
const subscribed = start.indexOf('subscribeToFloating(');
assert.ok(subscribed > 0 && /\n\s*onStart\(\);/.test(start.slice(subscribed)), 'and looks once at what is on right after it starts listening');
console.log('  ok    the room keeper catches up as soon as your room is read');
