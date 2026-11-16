/*
 * One thing plays at a time, and an audio row's PLAY uses the music bar (MISC, Luke's list 4, items 5 and 6, from a test
 * run he passed on: "Two things played at once ... the audio kept running underneath the video." and "Audio "Play"
 * doesn't use the music player ... it opened a separate Internet Archive player in the list.").
 * Run from the root:
 *   npx tsc app/lib/audio/room-screen-sound.ts --rootDir app --outDir Temp/one-at-a-time-out --module commonjs --target es2020 --lib es2021,dom --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-one-at-a-time.cjs
 * The browser proof is scripts/drive-one-at-a-time.cjs (a mock dev server).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { whoGivesWay } = require('./one-at-a-time-out/lib/audio/room-screen-sound.js');

/* 1. The rule: the one that started last wins ------------------------------------------------------------------- */
const quiet = { bar: false, room: false };
assert.equal(whoGivesWay({ bar: true, room: false }, { bar: true, room: true }), 'bar', 'a video starts under a song: the song pauses');
assert.equal(whoGivesWay({ bar: false, room: true }, { bar: true, room: true }), 'room', 'a song starts over a video: the video pauses');
assert.equal(whoGivesWay(quiet, { bar: true, room: true }), 'room', 'both at once (a press that starts the bar as the page opens a room): the press wins');
assert.equal(whoGivesWay(quiet, { bar: true, room: false }), 'none');
assert.equal(whoGivesWay(quiet, { bar: false, room: true }), 'none');
assert.equal(whoGivesWay({ bar: true, room: true }, { bar: true, room: true }), 'none', 'nothing new started: nobody is stopped again');
console.log('  ok    the bar and your room: the one that started last plays');

/* 2. The keeper applies it: the room's player paused, or the bar steered quiet ---------------------------------- */
const keeper = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'MusicRoomKeeper.tsx'), 'utf8');
const block = keeper.slice(keeper.indexOf('one thing at a time'), keeper.indexOf('one thing at a time') + 1800);
assert.ok(block.length > 300, 'the keeper has the block');
assert.match(block, /whoGivesWay\(/);
assert.match(block, /roomScreenSound\(\)\?\.element\?\.pause\(\)/, "the room's player is paused");
assert.match(block, /steer\(false\)/, 'the bar is made quiet without touching the room it may be bound to');
assert.match(block, /roomSounding = screen !== null && screen\.element !== null && screen\.playing/, "an embed with no player (PeerTube) appearing is not a start: it never silences the bar");
console.log('  ok    the room keeper pauses whichever gave way');

/* 3. An audio row's PLAY never opens the platform's player in the list --------------------------------------------- */
const stream = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'WebStream.tsx'), 'utf8');
const bar = stream.slice(stream.indexOf('function useBarPlay('), stream.indexOf('function useBarPlay(') + 3500);
assert.ok(bar.length > 500, 'useBarPlay is where it was');
assert.doesNotMatch(bar, /onFallback/, "no fallback to the platform's player in the row");
assert.match(bar, /NO PLAYABLE FILE/, 'it says so');
assert.match(bar, /data-bar-play-elsewhere/, "and offers the platform's own page");
assert.match(bar, /rel="noopener noreferrer nofollow"/, 'opened safely, in a new tab');
assert.doesNotMatch(stream, /useBarPlay\(item, opened, embed \? startPlayer : null\)/, 'the row no longer hands it the player');
console.log("  ok    an audio row's PLAY plays in the bar or says it can't, never a player in the list");
