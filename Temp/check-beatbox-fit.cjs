/*
 * The beat box's screen (SPEC-beatbox-ui.md), the parts that need no browser: the grid is a canvas sized to the room it's given, the side
 * panel's fold on this page is never written down, and the help lists every key the page answers. The acceptance tests
 * themselves need a browser and a running site: Temp/check-beatbox-ui.cjs, run by hand.
 *   npx tsc app/features/beatbox/ui/gridView.ts app/features/beatbox/ui/keyHelp.ts app/lib/ui/side-panel-page.ts --rootDir app --outDir Temp/beatbox-fit-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fitCanvas, showing, scrollToShow } = require('./beatbox-fit-out/features/beatbox/ui/gridView.js');
const { keyHelp } = require('./beatbox-fit-out/features/beatbox/ui/keyHelp.js');
const { STARTING_KEYS } = require('./beatbox-fit-out/features/beatbox/ui/keyBindings.js');
const panel = require('./beatbox-fit-out/lib/ui/side-panel-page.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const STEPS = 32;
const ROWS = 85;
const TARGET = 44;

// The room at 1280x900 and 1920x1080, beside the bars: the whole bar across, and a tap target's height for each row.
{
  const small = fitCanvas(915, 560, TARGET, STEPS, ROWS);
  assert.ok(small.nameWidth + small.cellWidth * STEPS <= 915, 'the whole bar fits at 1280');
  assert.ok(small.cellWidth >= 26, `a step stays ${small.cellWidth}px wide`);
  assert.ok(small.cellHeight >= TARGET, 'and a full target tall');
  assert.ok(small.rows >= 11, `about an octave shows: ${small.rows} rows`);
  const big = fitCanvas(1556, 744, TARGET, STEPS, ROWS);
  assert.ok(big.cellWidth >= TARGET, `at 1920 a step is a full target wide too: ${big.cellWidth}px`);
}

// The canvas is the whole bar and every note, and rows share the view out so whole ones show.
for (const [width, height] of [[915, 560], [1556, 744], [300, 400], [500, 300]]) {
  const fit = fitCanvas(width, height, TARGET, STEPS, ROWS);
  assert.equal(fit.width, fit.nameWidth + fit.cellWidth * STEPS);
  assert.equal(fit.height, fit.headHeight + fit.cellHeight * ROWS);
  assert.ok(fit.cellHeight >= TARGET, 'never shorter than a target');
  assert.ok(height - fit.headHeight - fit.rows * fit.cellHeight < fit.rows + 1 || fit.rows === 1, 'only rounding is left over down');
}

// With no room for the whole bar the steps stop shrinking, and the view scrolls instead.
{
  const narrow = fitCanvas(300, 400, TARGET, STEPS, ROWS);
  assert.equal(narrow.cellWidth, Math.round(TARGET * 0.6));
  assert.ok(narrow.width > 300, 'wider than its view');
  assert.equal(fitCanvas(0, 0, TARGET, STEPS, ROWS).cellHeight, TARGET, 'before it is measured');
}

// A drum channel never asks for more rows than it has.
assert.equal(fitCanvas(1556, 2000, TARGET, STEPS, 12).rows, 12);

// What's in view, and how far to go to bring something into it.
assert.deepEqual(showing(0, 44, 440, 85), { first: 0, last: 9 });
assert.deepEqual(showing(22, 44, 440, 85), { first: 1, last: 9 }, 'part-shown rows at either end do not count');
assert.deepEqual(showing(44 * 84, 44, 440, 85), { first: 84, last: 84 });
assert.equal(scrollToShow(440, 44, 440, 12), 440, 'already in view: no move');
assert.equal(scrollToShow(440, 44, 440, 5), 220, 'above: up to it');
assert.equal(scrollToShow(440, 44, 440, 25), 44 * 26 - 440, 'below: only as far as it must');

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
  const listed = keyHelp(STARTING_KEYS).flatMap((group) => group.keys.map(([keys]) => keys)).join(' | ');
  for (const key of ['?', 'Space', 'Esc', 'Shift+L', 'Shift+S', 'Shift+O', 'Shift+H', '/', '\\', "'", 'R', 'Ctrl+Z', 'Ctrl+Y', '[', ']', 'B', 'I', '.', ',', '-', 'A W S', 'Z and X', 'V', 'N', 'M', 'Q', 'C', 'L', 'F', '0 to 9', '+ and -', 'Enter', 'Ctrl+Left', 'Shift+Left', 'Shift+Up', 'Delete', 'Home and End', 'Ctrl+Home', 'Page Up']) {
    assert.ok(listed.includes(key), `the help lists ${key}`);
  }
  const page = read('app/features/beatbox/ui/BeatBox.tsx');
  // The main keys say a short word and keep the shortcut for hover and help.
  assert.doesNotMatch(page, /^\s*(Play|Stop|Record|Undo|Redo|Slower|Faster|Follow|Lower|Higher).* \(/m, 'no shortcut spelled out on a key');
  assert.match(page, /title=\{`\$\{playing \? "Pause" : "Play"\} \(\$\{keyFor\("playPause"\)\}\)`\}/, 'on hover instead, as the key is now');
  assert.match(page, /<HintLine /, 'and in big words on the status line, for anyone who cannot read a tooltip');
}

console.log('beat box screen: the grid is a canvas fitted to its room, the panel fold is never remembered, the help lists every key: OK');
