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

console.log('animate render: all passed');
