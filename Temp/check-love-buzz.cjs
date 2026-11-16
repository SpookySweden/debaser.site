/*
 * LOVE BUZZ on arrival (Luke, 2026-11-16: "on loading the website play love buzz on loop quietly in the music player"):
 * which file it is, once a visit, quiet, and started by the first press only when nothing else plays by then.
 * Run from the root:
 *   npx tsc app/lib/audio/love-buzz.ts --rootDir app --outDir Temp/love-buzz-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-love-buzz.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const buzz = require('./love-buzz-out/lib/audio/love-buzz.js');

const track = (title, src) => ({ id: src, title, credit: 'sweden', kind: '', src, length: '0:51', tags: [], folderPath: null, shelf: 'bucket' });
const STORE = 'https://x.supabase.co/storage/v1/object/public/mp3/640d/';
const kive = track('KIVE - WU TANG', `${STORE}love-buzz-20260925195200.wav`);
const loveBuzz = track('LOVE BUZZ - UPLOAD TEST', `${STORE}love-buzz-20260925195523.wav`);
const other = track('HEXHAM', `${STORE}hexham.mp3`);

/* 1. Which file -------------------------------------------------------------------------------------------------- */
assert.equal(buzz.findLoveBuzz([other, kive, loveBuzz]), loveBuzz, 'the copy titled LOVE BUZZ, not the retitled one');
assert.equal(buzz.findLoveBuzz([other, kive]), kive, 'failing that, the file named love-buzz');
assert.equal(buzz.findLoveBuzz([other]), undefined, 'no LOVE BUZZ on the shelf: nothing');
assert.equal(buzz.findLoveBuzz([track('LOVE BUZZARD', `${STORE}b.mp3`)]), undefined, 'a word boundary, not a prefix');
console.log('  ok    LOVE BUZZ is the copy titled so');

/* 2. Once a visit, and only when nothing else holds the bar ------------------------------------------------------ */
const quiet = { playing: false, screen: false, room: false, following: false };
assert.equal(buzz.arrivalStep(null, false, true, quiet), 'wait', 'the shelf is still being read');
assert.equal(buzz.arrivalStep(null, true, true, quiet), 'load', 'a first page with nothing on: loaded');
for (const mark of ['loaded', 'started', 'skipped']) assert.equal(buzz.arrivalStep(mark, true, true, quiet), 'none', `the visit already ${mark} it: never again`);
for (const busy of ['playing', 'screen', 'room', 'following']) assert.equal(buzz.arrivalStep(null, true, true, { ...quiet, [busy]: true }), 'skip', `${busy}: let go`);
assert.equal(buzz.arrivalStep(null, true, false, quiet), 'skip', 'not on the shelf: let go');
assert.equal(buzz.arrivalStep(null, true, true, { ...quiet, handedOver: true }), 'skip', "a profile's own song waiting for a press: left alone");
console.log('  ok    once a visit, never over something else');

/* 3. The first press starts it only if it is still waiting and nothing started ----------------------------------- */
assert.equal(buzz.startOnPress('loaded', true, quiet), true);
assert.equal(buzz.startOnPress('loaded', true, { ...quiet, playing: true }), false, 'the press was PLAY (it, or another song): left alone');
assert.equal(buzz.startOnPress('loaded', true, { ...quiet, screen: true }), false, 'the press started a video');
assert.equal(buzz.startOnPress('loaded', true, { ...quiet, room: true }), false, 'the press opened a room');
assert.equal(buzz.startOnPress('loaded', false, quiet), false, 'the bar holds another song now');
assert.equal(buzz.startOnPress('skipped', true, quiet), false);
assert.equal(buzz.startOnPress(null, true, quiet), false);
console.log('  ok    the first press starts it only when nothing else did');

/* 4. Quiet --------------------------------------------------------------------------------------------------------- */
assert.equal(buzz.arrivalVolume(0.8), buzz.QUIET_VOLUME, 'a loud saved volume is lowered');
assert.equal(buzz.arrivalVolume(0.1), 0.1, 'a quieter one is kept');
assert.equal(buzz.arrivalVolume(Number.NaN), buzz.QUIET_VOLUME);
assert.ok(buzz.QUIET_VOLUME <= 0.3);
// The reader's own volume comes back with the next song, unless they moved the slider themself.
assert.equal(buzz.volumeStep(null, false, 0.25), 'none');
assert.equal(buzz.volumeStep(0.8, true, buzz.QUIET_VOLUME), 'keep', 'while LOVE BUZZ plays, quiet');
assert.equal(buzz.volumeStep(0.8, false, buzz.QUIET_VOLUME), 'restore', 'the next song: their volume back');
assert.equal(buzz.volumeStep(0.8, false, 0.6), 'drop', 'they moved the slider: their move stands');
console.log('  ok    quiet, and the reader\'s volume comes back');

/* 5. The visit's mark ------------------------------------------------------------------------------------------- */
const bag = new Map();
const storage = { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, v) };
assert.equal(buzz.readArrival(storage), null);
buzz.writeArrival(storage, 'loaded');
assert.equal(buzz.readArrival(storage), 'loaded');
bag.set(buzz.LOVE_BUZZ_KEY, 'nonsense');
assert.equal(buzz.readArrival(storage), null);
assert.equal(buzz.readArrival({ getItem: () => { throw new Error('blocked'); } }), null, 'storage blocked: no crash');
assert.equal(buzz.readArrival(null), null);

/* 6. The component keeps to it: per tab (sessionStorage), looping by the track's own repeat, mounted with the bar ---- */
const component = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'LoveBuzzOnArrival.tsx'), 'utf8');
assert.match(component, /window\.sessionStorage/, 'once a visit is per tab');
assert.match(component, /assign\(found, \{ loop: true, origin: \{ origin: 'shelf'/, "looping by the track's own repeat, filed as the shelf's");
const arrival = component.slice(component.indexOf('// Arrival:'), component.indexOf('// The reader\'s own volume'));
assert.ok(arrival.length > 100 && !/setVolume/.test(arrival), 'arriving never touches the volume: a reader who never presses keeps theirs');
assert.ok(component.indexOf('setWaitingVolume(now.volume)') < component.indexOf('now.setVolume(quiet)'), 'the reader\'s volume is kept before it is lowered');
assert.doesNotMatch(component, /autoplay: true/, "never the provider's start-on-any-press: it would start over a video");
const bar = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'MusicPlayer.tsx'), 'utf8');
assert.equal((bar.match(/<LoveBuzzOnArrival \/>/g) ?? []).length, 2, 'mounted whichever shape the player is in');
console.log('  ok    the visit remembers, and the bar carries it');
