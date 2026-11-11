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
console.log('visualiser checks passed');
