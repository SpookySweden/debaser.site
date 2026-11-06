/*
 * The beat box's screen (SPEC-beatbox-ui.md), the parts that need no browser: the grid fills the room it's given, the side
 * panel's fold on this page is never written down, and the help lists every key the page answers. The acceptance tests
 * themselves need a browser and a running site: Temp/check-beatbox-ui.cjs, run by hand.
 *   npx tsc app/features/beatbox/ui/gridView.ts app/features/beatbox/ui/keyHelp.ts app/lib/ui/side-panel-page.ts --rootDir app --outDir Temp/beatbox-fit-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fitGrid, columnWindowStart } = require('./beatbox-fit-out/features/beatbox/ui/gridView.js');
const { KEY_HELP } = require('./beatbox-fit-out/features/beatbox/ui/keyHelp.js');
const panel = require('./beatbox-fit-out/lib/ui/side-panel-page.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const STEPS_PER_BEAT = 4;
const STEPS = 32;
const ROWS = 85;

// The window at 1280x900 and 1920x1080, beside the bars: whole beats, and a row of notes for every 64px there is.
{
  const small = fitGrid(860, 570, 64, STEPS_PER_BEAT, STEPS, ROWS);
  assert.equal(small.columns, 12, 'three whole beats at 1280');
  assert.equal(small.rows, 8);
  const big = fitGrid(1498, 750, 64, STEPS_PER_BEAT, STEPS, ROWS);
  assert.equal(big.columns, 20, 'five whole beats at 1920');
  assert.equal(big.rows, 11);
}

// It fills the room: no gap past the last cell, and nothing past the edge.
for (const [width, height, cell] of [[860, 570, 64], [1498, 750, 64], [860, 570, 96], [860, 570, 32], [300, 400, 64], [300, 451, 96]]) {
  const fit = fitGrid(width, height, cell, STEPS_PER_BEAT, STEPS, ROWS);
  const across = fit.nameWidth + fit.columns * fit.cellWidth;
  const down = fit.headHeight + fit.rows * fit.cellHeight;
  assert.ok(across <= width, `${across} fits in ${width}`);
  assert.ok(width - across < fit.columns + 1, `only rounding is left over across: ${width - across}`);
  assert.ok(down <= height, `${down} fits in ${height}`);
  assert.ok(height - down < fit.rows + 1, `only rounding is left over down: ${height - down}`);
  assert.ok(fit.cellWidth >= cell && fit.cellHeight >= cell, 'a cell is never smaller than its size');
}

// Too small for whole beats, or for many rows: still something to work with.
{
  const narrow = fitGrid(300, 451, 96, STEPS_PER_BEAT, STEPS, ROWS);
  assert.equal(narrow.columns, 1);
  assert.equal(narrow.rows, 4, 'four rows at the least, as the frame keeps room for');
  assert.equal(fitGrid(0, 0, 64, STEPS_PER_BEAT, STEPS, ROWS).columns, 1, 'before it is measured');
}

// A short song or a drum channel never asks for more than it has.
assert.equal(fitGrid(1498, 2000, 32, STEPS_PER_BEAT, STEPS, 12).rows, 12);
assert.equal(fitGrid(4000, 750, 32, STEPS_PER_BEAT, STEPS, ROWS).columns, 32);

// Bigger notes never mean fewer pixels each.
assert.ok(fitGrid(860, 570, 96, STEPS_PER_BEAT, STEPS, ROWS).cellHeight >= 96);
assert.equal(columnWindowStart(13, 12), 12, 'the view pages by a screenful');

// The side panel on this page: one key toggles it, nothing remembers it.
{
  let told = 0;
  const stop = panel.subscribeToPagePanel(() => {
    told += 1;
  });
  assert.equal(panel.pagePanelOpen(), false, 'folded to begin with');
  panel.togglePagePanel();
  assert.equal(panel.pagePanelOpen(), true);
  panel.togglePagePanel();
  assert.equal(panel.pagePanelOpen(), false);
  assert.equal(told, 2);
  stop();
  assert.doesNotMatch(read('app/lib/ui/side-panel-page.ts'), /\b(localStorage|sessionStorage|setSidebarOpen)\b/, 'never written down');
  // The window only asks for it when a page does; every other page keeps the reader's own answer.
  const sidebar = read('app/components/DesktopSidebar.tsx');
  assert.match(sidebar, /const isOpen = foldedOnThisPage \? openHere : remembered/);
  assert.match(sidebar, /const setOpen = foldedOnThisPage \? setPagePanelOpen : setSidebarOpen/);
  assert.match(read('app/beatbox/page.tsx'), /<SiteWindow[^>]*\bfill\b/, 'the beat box fills the window');
}

// The help lists every key the page answers.
{
  const listed = KEY_HELP.flatMap((group) => group.keys.map(([keys]) => keys)).join(' | ');
  for (const key of ['?', 'Space', 'Esc', '/', '\\', "'", 'R', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', '[ and ]', 'B', 'I', '.', ',', '- and =', 'A W S', 'Z and X', 'V', 'N', 'M', 'Q', 'C', 'L', 'F', '0 to 9', '+ and -', 'Enter', 'Ctrl+Left', 'Shift+Left', 'Shift+Up', 'Delete', 'Home and End', 'Ctrl+Home', 'Page Up']) {
    assert.ok(listed.includes(key), `the help lists ${key}`);
  }
  const page = read('app/features/beatbox/ui/BeatBox.tsx');
  // The main keys say a short word and keep the shortcut for hover and help.
  assert.doesNotMatch(page, /^\s*(Play|Stop|Record|Undo|Redo|Slower|Faster|Follow|Lower|Higher).* \(/m, 'no shortcut spelled out on a key');
  assert.match(page, /title="Play or stop \(Space\)"/, 'on hover instead');
}

console.log('beat box screen: the grid fills its room, the panel fold is never remembered, the help lists every key: OK');
