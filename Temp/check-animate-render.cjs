/*
 * ANIMATE's panels, drawn: the loader says what it's doing, the few keys show, the tools and panels open. The canvases need a browser, so
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

// The studio, on the server's first paint: the sheet, the timeline and five keys (updated on purpose for SPEC-animate-ui.md).
let html = draw();
for (const word of ['[ MENU ]', '[ TOOLS ]', '[ LAYERS ]', '[ PLAY ]', '[ FRAMES ]']) {
  assert.ok(html.includes(word), `the studio shows ${word}`);
}
for (const word of ['SAVE FILE', 'PROJECTS', 'PENCIL', 'ERASER', 'UNDO', '[ FULL ]', 'HIDE PANELS', '[ GIF ]']) {
  assert.ok(!html.includes(word), `and ${word} has left the screen`);
}
assert.ok(html.includes('data-animate-stage'), 'and the sheet');
assert.ok(html.includes('data-animate-hint'), 'a new person gets a hint');
assert.ok(html.includes('id="animate-open-file"') && html.includes('id="animate-import-picture"'), 'the file pickers are always there for the keys to press');
useStudio.setState({ settings: { ...useStudio.getState().settings, hintSeen: true } });
assert.ok(!draw().includes('data-animate-hint'), 'and it goes for good');
assert.ok(html.includes('data-no-cat'), 'with the cat stepping aside over it');
assert.doesNotMatch(html, /<svg/, 'code draws no icons');

// The tool pop-up: every tool, the actions, the colours, and the brush's three values.
useStudio.setState({ popup: { x: 40, y: 40 } });
html = draw();
assert.ok(html.includes('data-animate-popup'), 'the tools open');
for (const word of ['INK', 'PENCIL', 'FLAT', 'ERASER', 'BUCKET', 'FILL BRUSH', 'FILL ERASER', 'PICK COLOUR', 'LASSO', 'BOX', 'TRACE', 'HAND', 'NEW LAYER', 'ONION', 'SMART', 'FULL SCREEN', 'LAYERS', 'MENU', 'COLOURS', 'SIZE', 'OPACITY', 'STEADY']) {
  assert.ok(html.includes(word), `the tools have ${word}`);
}
assert.match(html, /disabled=""[^>]*>UNDO/, 'UNDO is quiet with nothing to undo');
useStudio.setState({ canUndo: true });
assert.doesNotMatch(draw(), /disabled=""[^>]*>UNDO/, 'and live once there is');
useStudio.setState({ tool: 'hand' });
assert.ok(!draw().includes('OPACITY'), 'the brush values only show for a tool with a brush');
useStudio.setState({ tool: 'ink', popup: null });

// The menu: every action, with its key.
useStudio.setState({ panel: 'menu' });
html = draw();
assert.ok(html.includes('role="dialog"'), 'the menu opens');
for (const word of ['SAVE TO A FILE', 'OPEN A FILE', 'PROJECTS', 'IMPORT A PICTURE', 'EXPORT', 'FIT THE SHEET', 'FULL SCREEN', 'INTERFACE BIGGER', 'SETTINGS', 'CTRL + Z', 'LIGHT TABLE', 'SOUND', 'CARRY COLOUR', 'PALETTE']) {
  assert.ok(html.includes(word), `the menu has ${word}`);
}
useStudio.setState({ panel: 'palette' });
html = draw();
assert.ok(html.includes('aria-label="Colour"') && html.includes('Keep this colour in the palette') && html.includes('Load a palette file'), 'any colour, and the palette, have a home');

// The timeline's menu: the frame keys that left its strip.
useStudio.setState({ panel: 'frames' });
html = draw();
for (const word of ['NEW DRAWING', 'COPY IT', 'DELETE IT', 'MARK IT', 'ON 1S', 'ON 2S', 'ON 3S', 'LOOP', 'PING-PONG', 'ONCE', 'RANGE IN', 'RANGE OUT', 'SPEED', 'FRAME WIDTH', 'ROWS SHOWN', 'ONION SETUP', 'LIGHT TABLE', 'CARRY COLOUR', 'SOUND']) {
  assert.ok(html.includes(word), `the timeline's menu has ${word}`);
}
useStudio.setState({ panel: 'none' });

// Full screen fills the window with the sheet and the timeline, and the interface grows.
useStudio.setState({ settings: { ...useStudio.getState().settings, full: true, uiScale: 2 } });
html = draw();
assert.match(html, /fixed inset-0/, 'full covers the window');
assert.match(html, /zoom:2/, 'the interface scale reaches the timeline');
assert.ok(!html.includes('[ MENU ]') && !html.includes('[ TOOLS ]') && !html.includes('[ LAYERS ]') && html.includes('[ PLAY ]'), 'and the corner keys step aside');
useStudio.setState({ settings: { ...useStudio.getState().settings, full: false, uiScale: 1 } });

// A fault is a Rose chip, not Rose words.
useStudio.setState({ notice: { text: 'LAYER LOCKED', fault: true } });
assert.match(draw(), /bg-bubble-pale px-1 text-ink-bar[^>]*>LAYER LOCKED/);

// The panels open.
useStudio.setState({ notice: null, panel: 'projects' });
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
assert.ok(html.includes('[ PLAY ]') && html.includes('4/48'), 'the timeline says where we are');
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
assert.ok(!html.includes('data-animate-layers-fold'), 'the layer list is folded away at first');
useStudio.setState({ settings: { ...useStudio.getState().settings, showLayers: true } });
html = draw();
assert.ok(html.includes('data-animate-layers-fold'), 'and folds out');
assert.ok(html.includes('[ + LAYER ]') && html.includes('[ + FOLDER ]'), 'the layer list can make rows');
assert.ok(html.includes('aria-label="Blend mode"') && html.includes('aria-label="Tag"'), 'a row has a blend and a tag');
assert.ok(html.includes('[ 300% ]'), 'the interface goes to 300%');
assert.ok(html.includes('Pressure curve'), 'the pen has a curve');
assert.ok(html.includes('Change the key for PENCIL'), 'every action can be given a key');
assert.ok(!html.includes('FAILED'), 'and it draws');
useStudio.setState({ panel: 'none' });
// Tag chips: a folder's passes down, and a Figure shows its planes.
const figure = P.updateNode(project, layerId, { tagId: 'figure' });
useStudio.setState({ project: figure });
html = draw();
assert.ok(html.includes('data-animate-chip="figure"'), 'a tag shows as a chip');
assert.ok(html.includes('data-animate-plane="line"') && html.includes('data-animate-plane="colour"'), 'a Figure shows its two planes');
useStudio.setState({ project });

// The master toggle says where it stands, and the sheet says so too.
useStudio.setState({ smartOn: true, popup: { x: 0, y: 0 } });
html = draw();
assert.match(html, /aria-pressed="true"[^>]*data-animate-tile="SMART"/, 'the smart key is filled while on');
assert.ok(!html.includes('data-animate-badge'), 'with no badge');
useStudio.setState({ smartOn: false });
html = draw();
assert.match(html, /aria-pressed="false"[^>]*data-animate-tile="SMART"/, 'and not while off');
assert.match(html, /data-animate-badge[^>]*bg-bubble-pale[^>]*>SMART OFF/, 'with a high-contrast badge');
useStudio.setState({ smartOn: true, popup: null });
assert.ok(!draw().includes('data-animate-make-smart'), 'MAKE SMART stays away with nothing selected');
useStudio.setState({ hasSelection: true });
assert.ok(draw().includes('data-animate-make-smart'), 'and shows with a selection');
useStudio.setState({ hasSelection: false });

// The tag editor: every behaviour has a switch, and each tag can be put on the layer in hand.
useStudio.setState({ panel: 'tags' });
html = draw();
assert.ok(html.includes('[ NEW TAG ]') && html.includes('[ SAVE TAGS ]') && html.includes('[ LOAD TAGS ]'), 'tags can be made and carried as a file');
assert.ok(html.includes('CTRL + 1') && html.includes('CTRL + 8'), 'and each says its new-layer key');
assert.ok(html.includes('FIGURE smarts on'), "each tag has its own switch");
useStudio.setState({ panel: 'none' });

// The sound panel, and Phase 5's keys.
useStudio.setState({ panel: 'sound' });
html = draw();
assert.ok(html.includes('ADD A SOUND'), 'a sound can be added');
assert.ok(html.includes('STEPPING THROUGH FRAMES PLAYS THE SOUND'), 'and scrubbing is a choice');
useStudio.setState({ panel: 'export' });
html = draw();
assert.ok(html.includes('[ MP4 ]') && html.includes('[ WEBM ]'), 'video is offered');
useStudio.setState({ panel: 'none' });
assert.ok(!draw().includes('data-animate-trace-keys'), 'Shift and Trace keeps its options away until it is in hand');
useStudio.setState({ tool: 'shift' });
assert.ok(draw().includes('data-animate-trace-keys'), 'Shift and Trace shows its options');
useStudio.setState({ tool: 'ink' });

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
