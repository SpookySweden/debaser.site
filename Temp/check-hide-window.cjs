/*
 * HIDE WINDOW and the corner keys above the player (Luke, 2026-11-16): the site window put away and brought back, remembered in
 * this browser, written on <html> before the first paint; `[ ▲ WINDOW ]` beside `[ ▲ ROOM ]` on one shelf, in a column over the
 * folded player.
 *   npx tsc app/lib/ui/site-hidden.ts app/lib/ui/corner-shelf.ts app/components/CornerShelf.tsx --rootDir app --outDir Temp/hide-window-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const held = new Map();
const marks = new Map();
global.window = {
  localStorage: {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
global.document = { documentElement: { setAttribute: (name, value) => void marks.set(name, value), removeAttribute: (name) => void marks.delete(name) } };
const hide = require('./hide-window-out/lib/ui/site-hidden.js');
const shelf = require('./hide-window-out/lib/ui/corner-shelf.js');

// The choice: shown to begin with, put away, remembered, marked, brought back.
assert.equal(hide.siteHidden(), false, 'the window is there to begin with');
let told = 0;
const stop = hide.subscribeToSiteHidden(() => {
  told += 1;
});
hide.setSiteHidden(true);
assert.equal(hide.siteHidden(), true);
assert.equal(held.get('debaser.shell.hidden.v1'), 'on', 'remembered in this browser');
assert.equal(marks.get('data-site-hidden'), 'on', 'and written on <html>');
hide.setSiteHidden(false);
assert.equal(held.has('debaser.shell.hidden.v1'), false, 'brought back, forgotten');
assert.equal(marks.has('data-site-hidden'), false, 'and the mark goes');
assert.equal(told, 2);
stop();
const ran = new Map();
new Function('localStorage', 'document', hide.siteHiddenBootScript())({ getItem: (key) => (key === 'debaser.shell.hidden.v1' ? 'on' : null) }, { documentElement: { setAttribute: (name, value) => void ran.set(name, value) } });
assert.equal(ran.get('data-site-hidden'), 'on', 'the boot script marks <html> before the first paint');
new Function('localStorage', 'document', hide.siteHiddenBootScript())({ getItem: () => { throw new Error('blocked'); } }, { documentElement: { setAttribute: () => undefined } });

// The shelf's slot: handed over once, told to whoever waits.
let heard = 0;
const off = shelf.subscribeToCornerSlot(() => {
  heard += 1;
});
const element = {};
shelf.setCornerSlot(element);
shelf.setCornerSlot(element);
assert.equal(shelf.cornerSlot(), element);
assert.equal(heard, 1, 'the same slot again is no news');
shelf.setCornerSlot(null);
off();

// The shelf itself, rendered (the player's own module stood in for: only whether it is folded matters here).
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let folded = false;
const playerPath = require.resolve('./hide-window-out/components/MusicPlayer.js');
require.cache[playerPath] = { id: playerPath, filename: playerPath, loaded: true, exports: { __esModule: true, usePlayerFolded: () => folded, default: () => null } };
const CornerShelf = require('./hide-window-out/components/CornerShelf.js').default;
const quiet = console.error;
console.error = () => undefined; // useLayoutEffect on a server render
let html = renderToStaticMarkup(React.createElement(CornerShelf));
assert.match(html, /data-corner-shelf="row"/, 'over the bar: a row');
assert.doesNotMatch(html, /▲ WINDOW/, 'no [ ▲ WINDOW ] while the window is there');
hide.siteHiddenOnServer = () => true;
folded = true;
html = renderToStaticMarkup(React.createElement(CornerShelf));
console.error = quiet;
assert.match(html, /data-corner-shelf="column"/, 'over the folded player: a column');
assert.match(html, /flex-col-reverse items-start/);
assert.ok(html.includes('[ ▲ WINDOW ]'), '[ ▲ WINDOW ] while it is away');
assert.ok(html.indexOf('class="contents"') < html.indexOf('data-restore-window'), 'the room keys slot first, nearest the player');

// The wiring.
const layout = read('app/layout.tsx');
assert.ok(layout.includes('siteHiddenBootScript()'), 'the boot script runs in <head>');
assert.ok(layout.indexOf('<MusicPlayer />') < layout.indexOf('<CornerShelf />'), 'the shelf is drawn once, beside the player');
const css = read('app/globals.css');
assert.match(css, /html\[data-site-hidden='on'\] \[data-site-window='frame'\] \{\s*display: none;/, 'the stylesheet puts the window away from the mark');
assert.match(css, /html\[data-site-hidden='on'\] \[data-site-window='desk'\] \{\s*pointer-events: none;/, 'and the empty desk lets the pointer through');
const key = read('app/components/FullWindowKey.tsx');
assert.match(key, /onClick=\{\(\) => setSiteHidden\(true\)\}/, 'HIDE WINDOW puts it away');
assert.ok(key.includes('[ HIDE WINDOW ]'));
const corner = read('app/components/CornerShelf.tsx');
assert.match(corner, /\{hidden \? \(/, '[ ▲ WINDOW ] only while it is away');
assert.match(corner, /onClick=\{\(\) => setSiteHidden\(false\)\}/, 'and it brings it back');
assert.ok(corner.includes('[ ▲ WINDOW ]'));
assert.match(corner, /folded \? 'flex-col-reverse items-start' : 'items-end'/, 'a row over the bar, a column over the folded player');
assert.ok(corner.indexOf('<span ref={slot} className="contents" />') < corner.indexOf('data-restore-window'), 'the room keys nearest the player, the window key after');
assert.match(corner, /useEdgeReserve\(shelf, '--stream-box', true\)/, 'the page window keeps clear of the whole shelf');
const watch = read('app/components/WatchWindow.tsx');
assert.equal((watch.match(/useSyncExternalStore\(subscribeToCornerSlot, cornerSlot, noCornerSlot\)/g) ?? []).length, 1, '[ ▲ ROOM ] goes on the shelf');
// One key, not two, on purpose: the folded live room's ROOM :: LIVE tile is gone (SPEC-rooms-your-room.md, part 2: a folded
// room is its floating picture, with `[ BACK ]` on it), so `[ ▲ ROOM ]` is the only room key left for the shelf.
assert.doesNotMatch(watch, /function UpBox/, 'and there is no folded tile to put beside it');
assert.doesNotMatch(watch, /className="fixed z-50 frame bg-sun-pale p-0\.5"/, 'neither sits on the spot by itself any more');
assert.doesNotMatch(watch, /useEdgeReserve/, 'and the shelf, not each key, keeps the window clear');

console.log('hide window: put away, remembered, marked before paint, brought back from the corner shelf: OK');
