/*
 * The stream room's visualiser (Luke, 2026-11-11): that it only ever asks to hear sound whose host allows it, so it can
 * never silence the music; that a refusal reloads the music plainly; and what the key and the visualiser draw first.
 * Run from the root:
 *   npx tsc app/lib/watch/audio-tap.ts app/lib/watch/visualiser.ts app/components/VisualiserToggle.tsx app/components/RoomVisualiser.tsx --rootDir app --outDir Temp/visualiser-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-visualiser.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
const el = React.createElement;
const OUT = path.join(__dirname, 'visualiser-out');
function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
stub(path.join(OUT, 'components/ArtMark.js'), { default: ({ fallback }) => fallback });

const tap = require('./visualiser-out/lib/watch/audio-tap.js');
const vis = require('./visualiser-out/lib/watch/visualiser.js');
const VisualiserToggle = require('./visualiser-out/components/VisualiserToggle.js').default;
const RoomVisualiser = require('./visualiser-out/components/RoomVisualiser.js').default;

const ORIGIN = 'https://debaser-site.vercel.app';

/* 1. Which sound it may ask to hear ------------------------------------------------------------- */
const yes = [
  '/assets/audio/theme.mp3',
  '/api/web/audio/internet_archive/some_item/0',
  '/api/web/audio/audiobooks/271/3',
  'https://archive.org/download/a/b.mp3',
  'https://www.archive.org/download/a/b.mp3',
  'https://ia800300.us.archive.org/1/items/a/b.mp3',
  'https://abcdefgh.supabase.co/storage/v1/object/public/mp3/x.mp3',
];
const no = [
  '/api/web/audio/podcast/show-1/0',
  '/api/web/audio/openverse/abc/0',
  'http://archive.org/download/a/b.mp3',
  'https://evil.example/archive.org/x.mp3',
  'https://archive.org.evil.example/x.mp3',
  'https://some-podcast-host.example/ep1.mp3',
  'https://www.youtube.com/watch?v=x',
  '',
  null,
];
for (const src of yes) assert.equal(tap.analysableSrc(src, ORIGIN), true, `may hear ${src}`);
for (const src of no) assert.equal(tap.analysableSrc(src, ORIGIN), false, `never asks to hear ${src}`);
console.log('  ok    which sound it may ask to hear');

/* 2. The element: asked that way only where allowed, and a refusal reloads it plainly ---------------- */
function fakeElement() {
  const attrs = new Map();
  const listeners = {};
  return {
    attrs,
    loads: 0,
    currentTime: 42,
    currentSrc: 'x',
    error: null,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    removeAttribute: (name) => attrs.delete(name),
    set crossOrigin(value) {
      attrs.set('crossorigin', value);
    },
    load() {
      this.loads += 1;
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
    fire(type) {
      listeners[type]?.();
    },
  };
}
global.window = { location: { origin: ORIGIN } };
const good = fakeElement();
assert.equal(tap.prepareForAnalysis(good, 'https://archive.org/download/a/b.mp3'), true);
assert.equal(good.getAttribute('crossorigin'), 'anonymous', 'an allowed host is asked the analysable way');
good.error = { code: 4 };
good.fire('error');
assert.equal(good.getAttribute('crossorigin'), null, 'a refusal drops the analysable way');
assert.equal(good.loads, 1, 'and loads the same song again plainly');
assert.equal(good.currentTime, 42, 'from where it was');
const plain = fakeElement();
plain.attrs.set('crossorigin', 'anonymous');
assert.equal(tap.prepareForAnalysis(plain, '/api/web/audio/podcast/show-1/0'), false);
assert.equal(plain.getAttribute('crossorigin'), null, 'a podcast is never asked that way, even after an Archive song');
assert.equal(tap.tapSound(plain), null, 'and the visualiser takes no copy of it');
assert.equal(tap.tapSound(null), null, 'nor of a player that is not the room`s own');
console.log('  ok    the element');

/* 3. Looks -------------------------------------------------------------------------------------------- */
const all = ['A', 'Flexi - alien fish pond', 'B', 'martin - glass corridor'];
assert.deepEqual(vis.presetNames(all, false), ['Flexi - alien fish pond', 'martin - glass corridor'], 'CALM is the calm ones the pack has');
assert.deepEqual(vis.presetNames(all, true), all, 'ALL is the whole pack');
assert.deepEqual(vis.presetNames(['A'], false), ['A'], 'a pack with none of the calm ones still shows something');
assert.equal(vis.stepPreset(3, 4, 'next'), 0, 'next wraps round');
assert.equal(vis.stepPreset(0, 4, 'previous'), 3, 'previous wraps round');
for (let i = 0; i < 20; i += 1) assert.notEqual(vis.stepPreset(2, 5, 'random', () => i / 20), 2, 'random never repeats the one showing');
console.log('  ok    looks');

/* 4. The key, and the warning first -------------------------------------------------------------------- */
assert.match(renderToStaticMarkup(el(VisualiserToggle, { roomId: 'r1' })), /aria-pressed="false"[\s\S]*>\[ VIS \]</, 'the key reads [ VIS ] until Luke draws its mark');
// (Pressed while it shows is the browser's business: a server render always draws the starting state, off.)
assert.equal(vis.warningAccepted(), false);
const first = renderToStaticMarkup(el(RoomVisualiser, { roomId: 'r1', element: null }));
assert.match(first, /FLASHING LIGHTS/, 'the flashing-lights warning comes first');
assert.match(first, /\[ I UNDERSTAND, SHOW IT \][\s\S]*\[ NOT NOW \]/);
assert.doesNotMatch(first, /<canvas/, 'and nothing is drawn before it is accepted');
console.log('  ok    the key and the warning');

/* 5. One copy of the sound, kept (Luke, 2026-11-14: "needs to react properly to the audio playing") ------ */
// Measured in Chrome and Edge (Temp/probe-tap.cjs): a second copy of an element silences the first, and a new song adds
// a track to the kept copy while the old track stays live and silent. Before, a fresh copy was taken every two seconds.
function capturable() {
  const element = fakeElement();
  element.attrs.set('crossorigin', 'anonymous');
  element.copies = 0;
  element.captureStream = () => {
    element.copies += 1;
    return { copy: element.copies, getAudioTracks: () => [] };
  };
  return element;
}
const song = capturable();
const firstCopy = tap.tapSound(song);
for (let i = 0; i < 5; i += 1) assert.equal(tap.tapSound(song), firstCopy, 'asked again, it hands back the copy it kept');
assert.equal(song.copies, 1, 'one copy of an element`s sound is taken, ever: a second would silence the first');
const other = capturable();
assert.notEqual(tap.tapSound(other), firstCopy, 'another element has its own copy');
song.attrs.delete('crossorigin');
assert.equal(tap.tapSound(song), null, 'a song whose host does not allow it is not listened to, kept copy or not');
song.attrs.set('crossorigin', 'anonymous');
assert.equal(tap.tapSound(song), firstCopy, 'and the next one that does is heard through the same copy');
assert.equal(song.copies, 1);
const refused = capturable();
refused.captureStream = () => {
  throw new Error('SecurityError');
};
assert.equal(tap.tapSound(refused), null, 'a browser that refuses is no copy, not a crash');

const track = (id, readyState = 'live') => ({ id, readyState });
const streamOf = (...tracks) => ({ getAudioTracks: () => tracks });
assert.equal(tap.soundTrack(null), null);
assert.equal(tap.soundTrack(streamOf()), null, 'nothing loaded yet: nothing to hear');
assert.equal(tap.soundTrack(streamOf(track('first'))).id, 'first');
assert.equal(tap.soundTrack(streamOf(track('first'), track('second'), track('third'))).id, 'third', 'the newest track carries the song playing now');
assert.equal(tap.soundTrack(streamOf(track('first'), track('second', 'ended'))).id, 'first', 'an ended track is never listened to');

assert.equal(tap.whyDeaf(null), 'player', 'an outside player (YouTube) keeps its sound');
assert.equal(tap.whyDeaf(fakeElement()), 'browser', 'a browser with no way to copy a sound says so');
const hostSays = capturable();
hostSays.attrs.delete('crossorigin');
assert.equal(tap.whyDeaf(hostSays), 'host', 'a host that does not allow it says so');
assert.equal(tap.whyDeaf(capturable()), null);
console.log('  ok    one kept copy of the sound, followed to its newest track');

/* 6. The sliders: their ranges, what is kept, and the way back ---------------------------------------- */
assert.deepEqual(vis.SLIDERS.map((slider) => slider.key), ['react', 'speed', 'brightness', 'change']);
for (const slider of vis.SLIDERS) {
  assert.ok(slider.name.length > 8 && slider.label.length > 0, `${slider.key} has a name to read out`);
  assert.ok(slider.min < slider.max && (slider.max - slider.min) % slider.step === 0, `${slider.key}: whole steps from end to end`);
  assert.ok(slider.initial >= slider.min && slider.initial <= slider.max && (slider.initial - slider.min) % slider.step === 0, `${slider.key} starts on a step`);
  assert.ok((slider.max - slider.min) / slider.step <= 40, `${slider.key}: end to end in forty arrow presses or fewer`);
  assert.ok(slider.say(slider.initial).length > 0);
}
assert.deepEqual(vis.DEFAULT_SETTINGS, { react: 130, speed: 100, brightness: 100, change: 20 });
assert.equal(vis.DEFAULT_SETTINGS.change, vis.CYCLE_SECONDS, 'a look still stays twenty seconds until the reader says otherwise');
assert.deepEqual(vis.cleanSettings(null), vis.DEFAULT_SETTINGS);
assert.deepEqual(vis.cleanSettings({ react: 9999, speed: -4, brightness: 'bright', change: 33 }), { react: 200, speed: 25, brightness: 100, change: 35 }, 'out of range, not a number, or off a step: made safe');
assert.deepEqual(vis.cleanSettings({ react: 0, brightness: 20 }), { react: 0, speed: 100, brightness: 20, change: 20 }, 'the ends themselves are allowed');
assert.equal(vis.SLIDERS[0].say(0), 'OFF');
assert.equal(vis.SLIDERS[3].say(20), '20 SECONDS');
const kept = new Map();
global.window.localStorage = { getItem: (key) => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => void kept.set(key, value) };
assert.deepEqual(vis.readSettings(), vis.DEFAULT_SETTINGS, 'a browser that has kept nothing gets the defaults');
vis.saveSettings({ react: 60, speed: 150, brightness: 40, change: 60 });
assert.deepEqual(vis.readSettings(), { react: 60, speed: 150, brightness: 40, change: 60 }, 'kept in this browser');
assert.deepEqual([...kept.keys()], ['debaser-visualiser-settings'], 'under one name, and nothing else is written');
kept.set('debaser-visualiser-settings', '{not json');
assert.deepEqual(vis.readSettings(), vis.DEFAULT_SETTINGS, 'a broken record is the defaults, not a crash');
delete global.window.localStorage;
assert.deepEqual(vis.readSettings(), vis.DEFAULT_SETTINGS, 'and so is a browser that refuses storage');
console.log('  ok    the sliders');

/* 7. The sound, as the picture is fed it ---------------------------------------------------------------- */
const flat = new Uint8Array(1024).fill(128);
const wave = (height) => Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(Math.sin(i / 5) * height));
assert.equal(vis.loudness(flat), 0, 'bytes at rest are silence');
assert.ok(vis.loudness(wave(100)) > vis.loudness(wave(20)) && vis.loudness(wave(20)) > vis.SILENCE, 'a taller wave is louder');
assert.equal(vis.reactGain(0, 0.3, 0.2), 0, 'REACT at nothing feeds the picture silence');
assert.equal(vis.reactGain(100, 0.3, 0.2), 1, 'at 100% the song passes as it is');
assert.equal(vis.reactGain(100, 0.05, 0.2), 1);
assert.ok(vis.reactGain(200, 0.4, 0.2) > vis.reactGain(200, 0.2, 0.2), 'above 100%, a moment louder than usual is pushed up');
assert.ok(vis.reactGain(200, 0.1, 0.2) < vis.reactGain(200, 0.2, 0.2), 'and a quieter one is pushed down: a bigger swing');
assert.ok(vis.reactGain(50, 0.4, 0.2) < vis.reactGain(50, 0.2, 0.2) && vis.reactGain(50, 0.2, 0.2) === 0.5, 'below it the swing is flattened and the whole turned down');
assert.ok(vis.reactGain(200, 5, 0.01) <= 6 && vis.reactGain(200, 0.0001, 0.5) >= 0.2, 'never without limit, either way');
assert.equal(vis.reactGain(150, 0.3, 0), 1.25, 'with no usual level yet there is no swing to stretch');
const out = new Uint8Array(1024);
vis.shapeSound(wave(60), out, 0);
assert.deepEqual([...out], [...flat], 'times nothing: silence');
vis.shapeSound(wave(60), out, 1);
assert.deepEqual([...out], [...wave(60)], 'times one: the song as it is');
vis.shapeSound(wave(100), out, 4);
assert.ok(Math.max(...out) === 255 && Math.min(...out) === 0, 'a wave pushed past a byte is held at its ends, not wrapped round');
let usual = 0;
usual = vis.usualLoudness(usual, 0.3);
assert.equal(usual, 0.3, 'the first sound heard is the usual level');
for (let i = 0; i < 600; i += 1) usual = vis.usualLoudness(usual, 0.1);
assert.ok(Math.abs(usual - 0.1) < 0.01, 'and it follows the song over a few seconds');
assert.equal(vis.levelMeter(0), '········', 'silence lights nothing');
assert.equal(vis.levelMeter(0.004).replace(/·/g, '').length, 1, 'a whisper lights one square');
assert.equal(vis.levelMeter(0.9), '■■■■■■■■');
assert.ok(vis.levelMeter(0.3).replace(/·/g, '').length > vis.levelMeter(0.05).replace(/·/g, '').length, 'louder lights more');

assert.equal(vis.hearingNote('listening', null, false), 'LISTENING');
assert.match(vis.hearingNote('own-rhythm', 'player', false), /THIS PLAYER KEEPS ITS SOUND TO ITSELF: MOVING ON ITS OWN/, 'YouTube: it says it cannot hear, and fakes nothing');
assert.match(vis.hearingNote('own-rhythm', 'browser', false), /THIS BROWSER CAN'T LEND IT THE SOUND/);
assert.match(vis.hearingNote('own-rhythm', 'host', false), /HOST KEEPS ITS SOUND TO ITSELF/);
assert.match(vis.hearingNote('own-rhythm', null, false), /WAITING FOR A SONG/);
assert.match(vis.hearingNote('listening', null, true), /A STILL PICTURE \(REDUCE MOTION IS ON\)/, 'under reduce motion it says the picture is still');
assert.match(vis.hearingNote('own-rhythm', 'player', true), /A STILL PICTURE/);
assert.equal(vis.pictureScale(1, 1920, 1440), 1, 'a computer draws at its own density');
assert.equal(vis.pictureScale(3, 2560, 1440), 2, 'two at most');
assert.ok(Math.abs(vis.pictureScale(3, 390, 1280) - 0.914) < 0.01, 'a phone, shown the desktop at a third of its size, draws only what it really shows');
assert.equal(vis.pictureScale(1, 320, 1280), 0.5, 'never coarser than half');
assert.equal(vis.pictureScale(undefined, 0, 0), 1, 'a browser that says nothing gets one');
console.log('  ok    the sound as the picture is fed it, and what it says');

/* 8. The picture is fed, not left to listen for itself; nothing leaves the page --------------------------- */
const drawn = require('node:fs').readFileSync('app/components/RoomVisualiser.tsx', 'utf8');
const code = drawn.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
assert.doesNotMatch(code, /connectAudio\(|\.connect\(context\.destination\)|MediaRecorder|fetch\(|sendBeacon|createMediaElementSource/, 'the copy is measured only: never played, recorded or sent, and the element is never re-routed');
assert.match(code, /visualiser\.render\(\{ audioLevels: sound, elapsedTime:/, 'each frame is handed its sound and its clock');
assert.match(code, /type="range"[\s\S]{0,400}aria-label=\{slider\.name\}[\s\S]{0,120}aria-valuetext=/, 'the sliders are real range inputs, each with a name and its value in words');
console.log('  ok    measured only');
console.log('visualiser checks passed');
