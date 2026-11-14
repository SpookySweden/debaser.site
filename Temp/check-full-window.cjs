/*
 * The site window's fullscreen key, the parts that need no browser: the reader's choice is remembered and a page's own fill never touches it.
 * The browser's side is in Temp/check-full-window-ui.cjs, run by hand.
 *   npx tsc app/lib/ui/site-fill.ts --rootDir app --outDir Temp/full-window-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const held = new Map();
const tabs = new Set();
global.window = {
  localStorage: {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  },
  addEventListener: (_, listener) => void tabs.add(listener),
  removeEventListener: (_, listener) => void tabs.delete(listener),
};
const fill = require('./full-window-out/lib/ui/site-fill.js');

assert.equal(fill.chosenFill(), false, 'normal to begin with');
let told = 0;
const stop = fill.subscribeToChosenFill(() => {
  told += 1;
});
fill.setChosenFill(true);
assert.equal(fill.chosenFill(), true);
assert.equal(told, 1);
assert.equal(held.get('debaser.shell.fill.v1'), 'on', 'remembered');
fill.setChosenFill(false);
assert.equal(fill.chosenFill(), false);
assert.equal(held.has('debaser.shell.fill.v1'), false, 'and forgotten');

// Another tab changes it: this one follows.
held.set('debaser.shell.fill.v1', 'on');
assert.equal(tabs.size, 1);
for (const listener of tabs) listener({ key: 'debaser.shell.fill.v1' });
assert.equal(fill.chosenFill(), true, 'follows another tab');
assert.equal(told, 3, 'and redraws');
for (const listener of tabs) listener({ key: 'something else' });
assert.equal(told, 3, "other keys aren't its business");
fill.setChosenFill(false);
stop();
assert.equal(tabs.size, 0, 'stops listening with nobody left');

// A browser that refuses to keep anything still has the key, until a reload.
global.window = {
  get localStorage() {
    throw new Error('no');
  },
};
fill.setChosenFill(true);
assert.equal(fill.chosenFill(), true, 'for as long as the page is open');
fill.setChosenFill(false);

// The page's own fill and the reader's choice are two things: the page's is a prop, never written, and the window is filled by either.
const site = read('app/components/SiteWindow.tsx');
// Changed on purpose 2026-11-14 (Luke: "pretty buggy and not very obvious"). It was `const filled = fill || chosen;`: React swapped the
// window's size classes once the page's script had loaded, so every reload painted the normal window first and then jumped. The
// choice is now a mark on <html>, written before the first paint, and the stylesheet lays the window out from it.
assert.doesNotMatch(site, /fill \|\| chosen/, 'the choice no longer swaps classes in the window');
const css = read('app/globals.css');
for (const part of ['desk', 'frame', 'title']) {
  assert.ok(site.includes(`data-site-window="${part}"`), `the window marks its ${part} for the stylesheet`);
  assert.ok(css.includes(`html[data-site-fill='on'] [data-site-window='${part}']`), `and the stylesheet lays out the ${part} from the mark`);
}
assert.ok(read('app/layout.tsx').includes('siteFillBootScript()'), 'the mark is written before the first paint');
assert.ok(site.includes('foldedOnThisPage={fill}'), "only a page's own fill folds the side panel, never the reader's choice");
assert.ok(site.includes('endKey={fill ? undefined : <FullWindowKey on={chosen} />}'), 'one key, at the end of the top bar in both states');
// The mark itself: set and cleared with the choice, and the boot script reads the same key.
const marks = new Map();
global.document = { documentElement: { setAttribute: (name, value) => void marks.set(name, value), removeAttribute: (name) => void marks.delete(name) } };
global.window = { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined };
fill.setChosenFill(true);
assert.equal(marks.get('data-site-fill'), 'on', 'choosing it marks <html>');
fill.setChosenFill(false);
assert.equal(marks.has('data-site-fill'), false, 'and collapsing it clears the mark');
delete global.document;
assert.ok(fill.siteFillBootScript().includes('"debaser.shell.fill.v1"') && fill.siteFillBootScript().includes('"data-site-fill"'), 'the boot script reads the same key and writes the same mark');
const ran = new Map();
new Function('localStorage', 'document', fill.siteFillBootScript())({ getItem: () => 'on' }, { documentElement: { setAttribute: (name, value) => void ran.set(name, value) } });
assert.equal(ran.get('data-site-fill'), 'on', 'run with the choice on, it marks <html>');
ran.clear();
new Function('localStorage', 'document', fill.siteFillBootScript())({ getItem: () => null }, { documentElement: { setAttribute: (name, value) => void ran.set(name, value) } });
assert.equal(ran.size, 0, 'and leaves it alone otherwise');
new Function('localStorage', 'document', fill.siteFillBootScript())({ getItem: () => { throw new Error('blocked'); } }, { documentElement: { setAttribute: () => undefined } });
assert.doesNotMatch(site, /setChosenFill/, 'the window itself never changes the choice');
for (const file of ['app/beatbox/page.tsx', 'app/animate/page.tsx']) {
  assert.match(read(file), /<SiteWindow[^>]*\bfill\b/, `${file} fills by itself`);
  assert.doesNotMatch(read(file), /site-fill/, `${file} leaves the choice alone`);
}
assert.match(read('app/components/FullWindowKey.tsx'), /setChosenFill\(!chosenFill\(\)\)/, 'only the key does');
assert.doesNotMatch(read('app/lib/ui/side-panel-page.ts'), /site-fill/, 'and the side panel fold is a third thing');

console.log("full window key: remembered, forgotten, and a page's own fill never touches the choice: OK");
