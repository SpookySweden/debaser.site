/*
 * ANIMATE's panels, drawn: the loader says what it's doing, the strip and tools show their keys, the panels open. The canvases need a browser, so
 * the drawing itself is driven by `scripts/drive-animate.cjs`.
 *   npx tsc app/components/animate/AnimateLoader.tsx app/components/animate/AnimateStudio.tsx --rootDir app --outDir Temp/animate-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'animate-render-out');
const el = React.createElement;

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

stub('next/dynamic', { default: (load, options) => () => options.loading() });

const AnimateLoader = require('./animate-render-out/components/animate/AnimateLoader.js').default;
const AnimateStudio = require('./animate-render-out/components/animate/AnimateStudio.js').default;
const { useStudio } = require('./animate-render-out/lib/animate/store.js');
void OUT;
// A server render reads a store's initial state: pointed at the current one, so a test can set where the studio is.
React.useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot();

const draw = () => renderToStaticMarkup(el(AnimateStudio));

// The loader's first paint.
assert.match(renderToStaticMarkup(el(AnimateLoader)), /OPENING THE STUDIO/);

// The studio, on the server's first paint.
let html = draw();
for (const word of ['UNDO', 'REDO', 'SAVE FILE', 'OPEN', 'PROJECTS', 'PENCIL', 'INK', 'ERASER', 'FULL', 'COLOUR']) {
  assert.ok(html.includes(word), `the studio shows ${word}`);
}
assert.ok(html.includes('data-animate-stage'), 'and the sheet');
assert.ok(html.includes('data-no-cat'), 'with the cat stepping aside over it');
assert.match(html, /aria-label="Interface bigger"/, 'the interface can be made bigger from a key with a name');
assert.doesNotMatch(html, /<svg/, 'code draws no icons');

// Nothing to undo yet: the keys say so.
assert.match(html, /disabled=""[^>]*>\[ UNDO \]/, 'UNDO is quiet with nothing to undo');
useStudio.setState({ canUndo: true });
assert.doesNotMatch(draw(), /disabled=""[^>]*>\[ UNDO \]/, 'and live once there is');

// Full screen fills the window, and the interface grows.
useStudio.setState({ settings: { ...useStudio.getState().settings, full: true, uiScale: 2 } });
html = draw();
assert.match(html, /fixed inset-0/, 'full covers the window');
assert.match(html, /zoom:2/, 'the interface scale reaches the panels');

// A fault is a Rose chip, not Rose words.
useStudio.setState({ notice: { text: 'LAYER LOCKED', fault: true } });
assert.match(draw(), /bg-bubble-pale px-1 text-ink-bar[^>]*>LAYER LOCKED/);

// The panels open.
useStudio.setState({ panel: 'help' });
html = draw();
assert.ok(html.includes('role="dialog"'), 'the keys panel opens');
assert.ok(html.includes('CTRL + Z'), 'and lists the keys');
useStudio.setState({ panel: 'projects' });
assert.ok(draw().includes('[ NEW ]'), 'the projects panel opens');
useStudio.setState({ panel: 'onion' });
html = draw();
assert.ok(html.includes('ONION SKIN') && html.includes('BEFORE') && html.includes('AFTER') && html.includes('1 AWAY'), 'the onion panel has an opacity per neighbour');
useStudio.setState({ panel: 'export' });
html = draw();
assert.ok(html.includes('[ GIF ]') && html.includes('[ PNG FRAMES ]'), 'the export panel offers both');
assert.ok(html.includes('960 x 540'), 'and says the size it will make');
useStudio.setState({ panel: 'none' });

// The timeline: the transport, a row per layer, and each drawing a box as long as it holds.
const P = require('./animate-render-out/lib/animate/project.js');
const X = require('./animate-render-out/lib/animate/export.js');
let project = useStudio.getState().project;
const layerId = project.nodes[0].id;
project = P.addDrawing(project, layerId, 2, 3).project;
useStudio.setState({ project, layerId, frame: 3 });
html = draw();
assert.ok(html.includes('[ PLAY ]') && html.includes('FRAME 4 / 48'), 'the transport says where we are');
assert.ok(html.includes('LAYER 1'), 'a row for the layer');
assert.match(html, /data-frame="2" data-length="3"/, 'a box for the drawing');
assert.match(html, /aria-label="Drawing at frame 3, held 3 frames, key"/, 'which a screen reader can name');
assert.match(html, /left:48px/, 'starting on its frame');
useStudio.setState({ playing: true });
assert.ok(draw().includes('[ STOP ]'), 'PLAY becomes STOP');
useStudio.setState({ playing: false });

// A GIF counts in hundredths: the total stays true however the frames round.
const delays = X.gifDelays(Array(24).fill(1), 24);
assert.equal(delays.reduce((a, b) => a + b, 0), 1000, 'a second of frames takes a second');
assert.ok(delays.every((d) => d === 40 || d === 50), `each frame near its length (${delays.join(',')})`);
assert.deepEqual(X.gifDelays([2, 1], 10), [200, 100], 'a held drawing is one picture, shown longer');
// Held drawings export as one picture.
assert.deepEqual(X.runsOf(project, 0, 6), [{ frame: 0, count: 2 }, { frame: 2, count: 3 }, { frame: 5, count: 2 }], 'frames that look the same are joined');
assert.deepEqual(X.exportSize(project, 0.5), { w: 960, h: 540 });
assert.deepEqual(X.exportSize({ ...project, width: 101, height: 77 }, 1, true), { w: 102, h: 78 }, 'video sizes are even');
// Skip-on-export layers aren't counted when exporting.
const rough = P.updateNode(project, layerId, { tagId: 'rough' });
assert.deepEqual(X.runsOf(rough, 0, 6), [{ frame: 0, count: 7 }], 'a Rough layer never appears in a render');

// Layers, and the settings.
useStudio.setState({ project, layerId, panel: 'settings' });
html = draw();
assert.ok(html.includes('[ + LAYER ]') && html.includes('[ + FOLDER ]'), 'the layer list can make rows');
assert.ok(html.includes('aria-label="Blend mode"') && html.includes('aria-label="Tag"'), 'a row has a blend and a tag');
assert.ok(html.includes('[ 300% ]'), 'the interface goes to 300%');
assert.ok(html.includes('Pressure curve'), 'the pen has a curve');
assert.ok(html.includes('Change the key for PENCIL'), 'every action can be given a key');
assert.ok(html.includes('COLOUR') && !html.includes('FAILED'), 'and it draws');
useStudio.setState({ panel: 'none' });
// Tag chips: a folder's passes down, and a Figure shows its planes.
const figure = P.updateNode(project, layerId, { tagId: 'figure' });
useStudio.setState({ project: figure });
html = draw();
assert.ok(html.includes('data-animate-chip="figure"'), 'a tag shows as a chip');
assert.ok(html.includes('data-animate-plane="line"') && html.includes('data-animate-plane="colour"'), 'a Figure shows its two planes');
useStudio.setState({ project });

// The master toggle says where it stands, and the sheet says so too.
useStudio.setState({ smartOn: true });
html = draw();
assert.ok(html.includes('[ SMART ON ]'), 'the smart key says on');
assert.ok(!html.includes('data-animate-badge'), 'with no badge');
useStudio.setState({ smartOn: false });
html = draw();
assert.ok(html.includes('[ SMART OFF ]'), 'and off');
assert.match(html, /data-animate-badge[^>]*bg-bubble-pale[^>]*>SMART OFF/, 'with a high-contrast badge');
useStudio.setState({ smartOn: true });
useStudio.setState({ hasSelection: true });
assert.ok(draw().includes('data-animate-make-smart'), 'MAKE SMART shows with a selection');
useStudio.setState({ hasSelection: false });

// The tag editor: every behaviour has a switch, and each tag can be put on the layer in hand.
useStudio.setState({ panel: 'tags' });
html = draw();
assert.ok(html.includes('[ NEW TAG ]') && html.includes('[ SAVE TAGS ]') && html.includes('[ LOAD TAGS ]'), 'tags can be made and carried as a file');
assert.ok(html.includes('CTRL + 1') && html.includes('CTRL + 8'), 'and each says its new-layer key');
assert.ok(html.includes('FIGURE smarts on'), "each tag has its own switch");
useStudio.setState({ panel: 'none' });

// Selection geometry and palette files.
const Sel = require('./animate-render-out/lib/animate/selection.js');
const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
assert.equal(Sel.pointInOutline(square, 5, 5), true);
assert.equal(Sel.pointInOutline(square, 15, 5), false);
const Colours = require('./animate-render-out/lib/animate/colours.js');
assert.deepEqual(Colours.readPalette('{"swatches":[{"name":"A","colour":"#ABCDEF"},{"name":"bad","colour":"red"}]}'), [{ name: 'A', colour: '#abcdef' }], 'a palette file: good swatches kept, bad ones left out');
assert.equal(Colours.readPalette('nonsense'), null);
assert.equal(Colours.readPalette('{"swatches":[]}'), null);

console.log('animate render: all passed');
