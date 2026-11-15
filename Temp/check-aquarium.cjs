/**
 * The AQUARIUM background (Luke, 2026-11-15): the Windows 98 Underwater sea behind the site window, chosen in PREFERENCES >
 * BACKGROUND, and the default for a browser that has chosen nothing.
 *
 * Held here:
 *   1. the default is AQUARIUM, TILE is offered beside it, and a choice is remembered and read back;
 *   2. the boot script writes `data-backdrop` before the first paint - the default when nothing (or junk) is stored;
 *   3. the server draws no aquarium (it cannot know a reader chose TILE), and the shell and PREFERENCES both mount their parts;
 *   4. every picture the component asks for is on disk at the size the component lays it out at;
 *   5. the stylesheet lets go of the tile only while the aquarium is on, and stops the motion when motion is off.
 *
 * Compiled fresh on every run:
 *   npx tsc app/components/Aquarium.tsx app/lib/ui/backdrop-slot.ts --outDir Temp/aquarium-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { readPng } = require('../scripts/png-read.cjs');

const OUT = path.join(__dirname, 'aquarium-out');
const slotFile = path.join(OUT, 'lib/ui/backdrop-slot.js');

/* 1. The choice, as the store holds it (loaded with no `window`, as the server would). */
const slot = require(slotFile);
assert.equal(slot.DEFAULT_BACKDROP, 'aquarium', 'a browser with nothing stored gets the aquarium');
assert.deepEqual(slot.BACKDROPS.map((b) => b.id), ['aquarium', 'tile'], 'AQUARIUM first, TILE beside it');
assert.equal(slot.backdropState().id, 'aquarium', 'the store starts on the default');

// A browser: storage that keeps what it is given, and the document the choice is written onto.
const stored = new Map();
global.window = { localStorage: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)) } };
const root = { dataset: {} };
const stop = slot.initBackdrop(root);
assert.equal(root.dataset.backdrop, 'aquarium', 'nothing stored: the aquarium goes on the document');
slot.setBackdrop('tile');
assert.equal(root.dataset.backdrop, 'tile', 'pressing TILE puts the tile on at once');
assert.equal([...stored.values()][0], 'tile', 'and remembers it');
stop();

// Loaded fresh in a browser that chose TILE earlier: the store starts there, so the sea is never drawn for a frame first.
delete require.cache[require.resolve(slotFile)];
const again = require(slotFile);
assert.equal(again.backdropState().id, 'tile', 'a reload starts on the stored choice');
stored.set([...stored.keys()][0], 'nonsense');
delete require.cache[require.resolve(slotFile)];
assert.equal(require(slotFile).backdropState().id, 'aquarium', 'a stored id that is no longer offered falls back to the default');
delete global.window;

/* 2. The boot script, run as the browser runs it. */
function boot(storedValue, storageThrows = false) {
  const attrs = {};
  const sandbox = {
    localStorage: {
      getItem: () => {
        if (storageThrows) throw new Error('blocked');
        return storedValue;
      },
    },
    document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } },
  };
  vm.runInNewContext(slot.backdropBootScript(), sandbox);
  return attrs['data-backdrop'];
}
assert.equal(boot(null), 'aquarium', 'boot: nothing stored writes the aquarium');
assert.equal(boot('tile'), 'tile', 'boot: TILE stored writes the tile');
assert.equal(boot('fishbowl'), 'aquarium', 'boot: junk writes the default');
assert.equal(boot(null, true), 'aquarium', 'boot: storage that throws still writes the default');
const layout = fs.readFileSync('app/layout.tsx', 'utf8');
assert.match(layout, /backdropBootScript\(\)/, 'the boot script is in the page head');
assert.match(layout, /<Aquarium \/>/, 'the shell draws the aquarium once');

/* 3. Nothing from the server; the window offers both. */
const Aquarium = require('./aquarium-out/components/Aquarium.js').default;
assert.equal(renderToString(React.createElement(Aquarium)), '', 'the server draws no aquarium');
const prefs = fs.readFileSync('app/components/PreferencesWindow.tsx', 'utf8');
assert.match(prefs, /<span>BACKGROUND<\/span>/, 'PREFERENCES has a BACKGROUND section');
assert.match(prefs, /BACKDROPS\.map\(/, 'listing every background the store offers');
assert.match(prefs, /onClick=\{\(\) => setBackdrop\(backdrop\.id\)\}/, 'each row switches to its own');
assert.match(fs.readFileSync('app/components/ThemeHost.tsx', 'utf8'), /useEffect\(\(\) => initBackdrop\(\), \[\]\)/, 'the choice is applied on mount');

/* 4. The pictures, at the sizes the component lays out. */
const source = fs.readFileSync('app/components/Aquarium.tsx', 'utf8');
const fish = [...source.matchAll(/file: '(fish-[a-z]+\.png)', w: (\d+), h: (\d+), frames: (\d+)/g)];
assert.equal(fish.length, 4, 'four fish, as the recording shows');
for (const [, file, w, h, frames] of fish) {
  const png = readPng(path.join('assets/aquarium', file));
  assert.equal(png.width, Number(w) * Number(frames), `${file}: ${frames} frames of ${w} wide`);
  assert.equal(png.height, Number(h), `${file}: ${h} tall`);
}
for (const [file, w, h] of [['coral-left.png', 216, 208], ['coral-right.png', 178, 141]]) {
  const png = readPng(path.join('assets/aquarium', file));
  assert.equal(`${png.width}x${png.height}`, `${w}x${h}`, `${file} is the size the component lays it out at`);
  assert.match(source, new RegExp(`${file.replace('.', '\\.')}'\\)\\} alt="" className="aquarium-still [a-z]+-0" width=\\{${w} \\* SCALE\\} height=\\{${h} \\* SCALE\\}`), `${file} laid out at ${w}x${h}`);
}
for (const [file, size] of [['bubble-big.png', 7], ['bubble-small.png', 5]]) {
  const png = readPng(path.join('assets/aquarium', file));
  assert.equal(`${png.width}x${png.height}`, `${size}x${size}`, `${file} is ${size}x${size}`);
}
assert.ok(fs.existsSync('assets/aquarium/README.txt'), 'the pictures say where they came from');

/* 5. The stylesheet. */
const css = fs.readFileSync('app/globals.css', 'utf8');
assert.match(css, /html\[data-backdrop='aquarium'\] \[data-site-window='desk'\] \{\s*background: none;/, 'the desk lets go of its tile only for the aquarium');
assert.match(css, /html\[data-backdrop='aquarium'\] body \{\s*background: var\(--dye-black\);/, 'and the canvas is the sea before the fish arrive');
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.aquarium-swim,\s*\.aquarium-bubble \{\s*display: none;/, 'motion off: no fish, no bubbles');
assert.match(css, /\.aquarium\[data-aquarium='paused'\] \* \{\s*animation-play-state: paused;/, 'a hidden tab pauses them');
assert.match(fs.readFileSync('app/theme/tokens.css', 'utf8'), /--z-index-backdrop: -1;/, 'the layer sits under the page');

console.log('aquarium');
console.log('  choice : AQUARIUM by default, TILE beside it, remembered in this browser, read back on reload');
console.log('  boot   : data-backdrop written before the first paint (default for nothing, junk or blocked storage)');
console.log('  server : draws nothing; the shell mounts it, PREFERENCES offers both');
console.log('  art    : 4 fish strips, 2 coral banks, 2 bubbles, each the size the component lays out');
