/**
 * Snapping, resizable docked windows (SPEC-windows.md), held where they can fail.
 *
 *   npx tsc app/lib/ui/window-layout.ts --outDir Temp/window-layout-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/WindowLayoutHost.tsx app/components/DockWindow.tsx --outDir Temp/window-layout-host-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *
 * Drives the real store the windows read, with pointer positions, the way `DockWindow` does:
 *   1. snapping two windows makes a group, and dragging one moves both;
 *   2. a shake while dragging detaches one (and the key detach does too);
 *   3. resizing a shared edge pushes the neighbour, keeping the group flush;
 *   4. layouts are saved per screen-shape bucket, and a bucket switch swaps layouts;
 *   5. a title bar cannot be dragged off-screen or under the top bar; maximise and back rejoins;
 *   6. phone width is untouched - DockWindow keeps the bottom-sheet classes and never asks the store.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const L = require('./window-layout-out/window-layout.js');

const SPEC = { min: { w: 300, h: 200 }, size: { w: 400, h: 500 }, dock: 'top' };
let saves = [];

function fresh(viewport = { w: 1440, h: 900 }) {
  L.resetLayoutStore();
  L.setViewport(viewport, 0);
  saves = [];
  L.setLayoutSaver((layouts) => saves.push(JSON.parse(JSON.stringify(layouts))));
  L.adoptLayouts(null);
  for (const id of ['a', 'b', 'c']) L.registerWindow(id, SPEC);
}

const rect = (id) => L.liveWindow(id).rect;
function place(id, x, y) {
  // Drag the window from wherever it is to (x, y), by its top-left corner.
  const r = rect(id);
  L.beginMove(id, r.x + 10, r.y + 5);
  L.moveTo(x + 10, y + 5);
  L.endMove();
}

/* 1. Snap, group, drag together. */
fresh();
L.windowOpened('a');
L.windowOpened('b');
place('a', 100, 100);
place('b', 700, 100);
assert.equal(L.liveWindow('a').grouped, false, 'apart, nobody is grouped');

// Drop b 6px short of a's right edge (a spans 100..500): it must snap flush to 500.
place('b', 506, 104);
assert.equal(rect('b').x, 500, 'b snapped flush against a`s right edge');
assert.equal(rect('b').y, 100, 'and its top lined up with a`s');
assert.ok(L.liveWindow('a').grouped && L.liveWindow('b').grouped, 'flush windows form a group');
assert.equal(L.liveWindow('a').group, L.liveWindow('b').group, 'one group id on both');

// Dragging a moves b with it.
L.beginMove('a', 110, 105);
L.moveTo(110, 205, 0);
L.endMove();
assert.equal(rect('a').y, 200, 'a moved down');
assert.equal(rect('b').y, 200, 'and b came with it');
assert.equal(rect('b').x, 500, 'still flush');

// Clicking one brings the whole group to the front.
L.windowOpened('c');
place('c', 1000, 600);
assert.ok(L.liveWindow('c').z > L.liveWindow('a').z, 'c, just opened, is in front');
L.bringToFront('b');
assert.ok(L.liveWindow('a').z > L.liveWindow('c').z && L.liveWindow('b').z > L.liveWindow('c').z, 'raising b raises a too');

/* 2. Shake detaches. A straight fast drag does not. */
L.beginMove('b', 600, 205);
for (let i = 0, t = 0; i < 40; i++, t += 8) L.moveTo(600 + i * 15, 300, t);
L.endMove();
assert.ok(L.liveWindow('b').grouped, 'a long straight drag never counts as a shake');

// A slow side-to-side adjustment - one turn every quarter of a second - is not a shake either.
L.beginMove('b', 600, 300);
for (let i = 0, slow = 5000; i < 8; i++) L.moveTo(i % 2 === 0 ? 630 : 600, 300, (slow += 250));
L.endMove();
assert.ok(L.liveWindow('b').grouped, 'a slow wiggle stays grouped');

L.beginMove('b', 600, 300);
let t = 1000;
const xs = [600, 630, 600, 630, 600, 630, 600, 640, 700];
for (const x of xs) L.moveTo(x, 300, (t += 40));
// ...and carried well clear before the drop, so it does not snap straight back.
L.moveTo(640, 820, (t += 40));
L.endMove();
assert.equal(L.liveWindow('b').group, null, 'shaking side to side breaks b off');
assert.ok(L.liveWindow('b').flash > 0, 'with the cue');
assert.equal(L.liveWindow('a').grouped, false, 'and a, alone now, is not grouped');
assert.equal(L.areFlush(rect('a'), rect('b')), false, 'b ended away from a');

// The key does the same.
place('b', rect('a').x + rect('a').w + 4, rect('a').y);
assert.ok(L.liveWindow('b').grouped, 'regrouped');
L.detachWindow('b');
assert.equal(L.liveWindow('b').group, null, 'the ⇲ key detaches without a shake');

// A click on the title bar after ⇲ must not put it straight back (review finding 2).
L.beginMove('b', rect('b').x + 10, rect('b').y + 5);
L.endMove();
assert.equal(L.liveWindow('b').group, null, 'a click with no move does not regroup a detached window');

/* 3. Resizing pushes the neighbour. */
place('b', rect('a').x + rect('a').w + 3, rect('a').y);
const before = { a: rect('a'), b: rect('b') };
assert.equal(before.a.x + before.a.w, before.b.x, 'flush before the resize');
const edgeX = before.a.x + before.a.w;
L.beginResize('a', { right: true }, edgeX, before.a.y + 50);
L.resizeTo(edgeX + 60, before.a.y + 50);
L.endResize();
assert.equal(rect('a').w, before.a.w + 60, 'a widened by the drag');
assert.equal(rect('b').x, rect('a').x + rect('a').w, 'b`s left edge moved with it: still flush, no overlap');
assert.equal(rect('b').x + rect('b').w, before.b.x + before.b.w, 'b shrank rather than sliding off');

// It stops at b's minimum.
L.beginResize('a', { right: true }, rect('a').x + rect('a').w, before.a.y + 50);
L.resizeTo(rect('a').x + rect('a').w + 1000, before.a.y + 50);
L.endResize();
assert.equal(rect('b').w, SPEC.min.w, 'b is held at its minimum width');
assert.equal(rect('b').x, rect('a').x + rect('a').w, 'and the pair is still flush');

// Shrinking a pulls b's edge back: no gap opens.
L.beginResize('a', { right: true }, rect('a').x + rect('a').w, before.a.y + 50);
L.resizeTo(rect('a').x + rect('a').w - 40, before.a.y + 50);
L.endResize();
assert.equal(rect('b').x, rect('a').x + rect('a').w, 'shrinking leaves no gap');

// A lone window cannot go below its own minimum.
L.beginResize('c', { left: true, top: true }, rect('c').x, rect('c').y);
L.resizeTo(rect('c').x + 5000, rect('c').y + 5000);
L.endResize();
assert.equal(rect('c').w, SPEC.min.w, 'min width');
assert.equal(rect('c').h, SPEC.min.h, 'min height');

/* 5. Off-screen and the top bar. */
L.setViewport({ w: 1440, h: 900 }, 40);
L.beginMove('c', rect('c').x + 5, rect('c').y + 5);
L.moveTo(-5000, -5000);
L.endMove();
assert.equal(rect('c').x, 0, 'cannot leave the left edge');
assert.equal(rect('c').y, 40, 'cannot go under the top bar');

// Maximise, then back into the group.
const grouped = { a: rect('a'), b: rect('b') };
L.toggleMaximise('b');
assert.deepEqual(rect('b'), { x: 0, y: 40, w: 1440, h: 860 }, 'maximised fills the area below the top bar');
assert.equal(L.liveWindow('a').grouped, false, 'out of its group while maximised');
// A wobble between the two clicks of a double-click must not wipe the way back (review finding 1).
L.beginMove('b', 300, 50);
L.moveTo(310, 60);
L.moveTo(300, 52);
L.endMove();
L.toggleMaximise('b');
assert.deepEqual(rect('b'), grouped.b, 'and back where it was');
assert.ok(L.liveWindow('b').grouped && L.liveWindow('a').grouped, 'back in its group');

/* Closing one leaves the rest; reopening rejoins only if still flush. */
L.windowClosed('b');
assert.equal(L.liveWindow('a').grouped, false, 'a alone while b is shut');
L.windowOpened('b');
assert.ok(L.liveWindow('b').grouped, 'b reopens in its spot and rejoins a');
L.windowClosed('b');
place('a', 900, 100);
L.windowOpened('b');
assert.equal(L.liveWindow('b').group, null, 'a moved away, so b does not rejoin');

/* 4. Per-bucket saving. */
async function buckets() {
  fresh({ w: 1440, h: 900 });
  L.windowOpened('a');
  place('a', 222, 111);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.ok(saves.length >= 1, 'a finished drag is saved');
  assert.equal(saves.length <= 2, true, 'and saving is throttled, not per pixel');
  const standard = saves.at(-1).standard;
  assert.deepEqual(standard.windows.a.rect.x, 222, 'saved under the standard bucket');
  assert.equal(standard.windows.a.open, true, 'with the window marked open');
  assert.equal(saves.at(-1).wide, undefined, 'nothing written for a shape never used');

  // A 21:9 screen is a different bucket: the layout swaps to the default corner there.
  L.setViewport({ w: 2560, h: 1080 }, 0);
  assert.equal(L.windowLayoutState().bucket, 'wide');
  assert.notEqual(rect('a').x, 222, 'the wide bucket has its own layout');
  place('a', 1500, 300);
  L.flushLayoutSave();
  L.setViewport({ w: 1440, h: 900 }, 0);
  assert.equal(rect('a').x, 222, 'back on 16:10 the standard layout returns');
  L.flushLayoutSave();
  const all = L.savedLayoutsForTest();
  assert.equal(all.wide.windows.a.rect.x, 1500, 'the wide layout was kept');

  // Loading a saved layout reopens what it had open.
  L.resetLayoutStore();
  L.setViewport({ w: 1440, h: 900 }, 0);
  const reopen = L.adoptLayouts(all);
  assert.deepEqual(reopen, ['a'], 'the host is told to reopen a');

  // A saved group comes back as a group, though its windows reopen one at a time.
  fresh({ w: 1440, h: 900 });
  L.windowOpened('a');
  L.windowOpened('b');
  place('a', 100, 100);
  place('b', 503, 100);
  assert.ok(L.liveWindow('b').grouped, 'grouped before saving');
  const grouped2 = L.savedLayoutsForTest();
  L.resetLayoutStore();
  L.setViewport({ w: 1440, h: 900 }, 0);
  for (const id of ['a', 'b']) L.registerWindow(id, SPEC);
  assert.deepEqual(L.adoptLayouts(grouped2).sort(), ['a', 'b'], 'both to reopen');
  L.windowOpened('a');
  L.windowOpened('b');
  assert.ok(L.liveWindow('a').grouped && L.liveWindow('b').grouped, 'and they reopen as a group');

  // A saved window nothing can reopen is not marked open; one that never draws is closed (finding 6).
  L.resetLayoutStore();
  L.setViewport({ w: 1440, h: 900 }, 0);
  for (const id of ['a', 'b']) L.registerWindow(id, SPEC);
  assert.deepEqual(L.adoptLayouts(grouped2, (id) => id === 'a'), ['a'], 'only openable windows reopen');
  assert.equal(L.liveWindow('b').open, false, 'and the other is not counted as open');
  L.closeUndrawnWindows();
  assert.equal(L.liveWindow('a').open, false, 'a window that never drew is closed again');

  // Nothing moves before the layout has arrived (finding 5).
  L.resetLayoutStore();
  L.setViewport({ w: 1440, h: 900 }, 0);
  L.registerWindow('a', SPEC);
  L.windowOpened('a');
  const early = rect('a');
  L.beginMove('a', early.x + 10, early.y + 5);
  L.moveTo(early.x + 200, early.y + 200);
  L.endMove();
  assert.deepEqual(rect('a'), early, 'a drag before the saved layout arrives does nothing');

  // A smaller screen of the same shape nudges windows on.
  L.resetLayoutStore();
  L.setViewport({ w: 1440, h: 900 }, 0);
  L.adoptLayouts(all);
  L.registerWindow('a', SPEC);
  L.windowOpened('a');
  place('a', 1000, 300);
  L.setViewport({ w: 1200, h: 750 }, 0);
  assert.ok(rect('a').x + rect('a').w <= 1200, 'nudged back on screen');

  // Reset puts it back in its corner and forgets this bucket.
  L.resetLayout();
  assert.deepEqual(rect('a'), L.defaultRect(SPEC, { w: 1200, h: 750 }, 0), 'reset = the default corner');
  assert.equal(L.savedLayoutsForTest().wide.windows.a.rect.x, 1500, 'other shapes keep theirs');

  // Narrowed to phone width: the sheets close as windows, and none of it is saved (finding 3).
  fresh({ w: 1440, h: 900 });
  L.windowOpened('a');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const savesBefore = saves.length;
  globalThis.window = { innerWidth: 500 };
  L.windowClosed('a');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  L.flushLayoutSave();
  delete globalThis.window;
  assert.equal(saves.length, savesBefore, 'nothing is saved while the screen is phone-width');

  assert.equal(L.bucketFor(1024, 768), 'tall');
  assert.equal(L.bucketFor(1440, 900), 'standard');
  assert.equal(L.bucketFor(1920, 1080), 'standard');
  assert.equal(L.bucketFor(2560, 1080), 'wide');
}

/* 6. Phones untouched. */
const dock = fs.readFileSync('app/components/DockWindow.tsx', 'utf8');
// (2026-10-23, docs/theming.md) z-[90] became z-dock: the same layer, named in app/theme/tokens.css.
assert.match(dock, /fixed inset-x-1 bottom-20 z-dock max-h-\[62vh\]/, 'the phone bottom sheet classes are the same');
assert.match(dock, /if \(!desktop\) return;\s*registerWindow/, 'a phone never registers with the layout store');
assert.match(dock, /const managed = desktop && /, 'and is never placed by it');
const host = fs.readFileSync('app/components/WindowLayoutHost.tsx', 'utf8');
assert.match(host, /if \(!window\.matchMedia\(DESKTOP\)\.matches\) return;/, 'no saved layout is read on a phone');
assert.match(fs.readFileSync('app/layout.tsx', 'utf8'), /<WindowLayoutHost \/>/, 'the shell draws the host');
for (const file of ['MusicWindow', 'ArcadeWindow', 'QueueWindow', 'PreferencesWindow']) {
  assert.match(fs.readFileSync(`app/components/${file}.tsx`, 'utf8'), /minSize=\{\{/, `${file} declares a minimum size`);
}
// Rendered, not grepped: away from a desktop (the server, and a phone) the frame is the bottom sheet,
// with no inline box, no resize grips and the detach key hidden.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const DockWindow = require('./window-layout-host-out/components/DockWindow.js').default;
const WindowLayoutHost = require('./window-layout-host-out/components/WindowLayoutHost.js').default;
const sheet = renderToStaticMarkup(
  React.createElement(DockWindow, { id: 'x', title: 'T', onClose() {}, defaultSize: { w: 400, h: 400 }, minSize: { w: 300, h: 200 } }, 'body'),
);
assert.match(sheet, /class="fixed inset-x-1 bottom-20 z-dock max-h-\[62vh\]/, 'a phone gets the bottom sheet');
assert.match(sheet, /style="transform:translate\(0px, 0px\)"/, 'with no box from the layout store - only the sheet`s own drag offset');
assert.doesNotMatch(sheet, /resize/, 'and no resize grips');
// (2026-10-23, SPEC-efficiency.md) The detach key is drawn only while the window is grouped (it was
// always drawn and disabled when ungrouped); an ungrouped sheet has none. Where it is drawn, it is
// still `hidden ... sm:inline-block` - held in the source, since a server render is never grouped.
assert.doesNotMatch(sheet, /aria-label="Detach T from its group"/, 'an ungrouped window draws no detach key');
assert.match(
  fs.readFileSync('app/components/DockWindow.tsx', 'utf8'),
  /\{grouped \? \([\s\S]*?className="hidden [^"]*sm:inline-block"[\s\S]*?⇲/,
  'and a grouped one draws it from sm up only',
);
assert.equal(typeof WindowLayoutHost, 'function', 'the host is a component');

const layoutSrc = fs.readFileSync('app/lib/ui/window-layout.ts', 'utf8');
assert.doesNotMatch(layoutSrc, /createContext|useContext/, 'the layout is a module store, not a context over the board');

buckets().then(
  () => console.log('window layout: all checks passed'),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
