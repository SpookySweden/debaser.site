/*
 * BROWSER on screen (SPEC-seeing-machine.md, Luke 2026-11-23): what the server draws of it. The pure parts are check-seeing.cjs, and
 * scripts/drive-see.cjs drives it in a browser.
 *   npx tsc app/components/seeing/SeeingMachine.tsx --rootDir app --outDir Temp/seeing-render-out --module commonjs --target es2022 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-seeing-render.cjs
 *
 * - signed out: the sign-in call and nothing of the machine; signed in, before its tabs are read: neither
 * - tabs: a tablist, one tab in front, a named close key each, the new-tab key quiet at eight
 * - the toolbar's keys are named, and quiet when there is nowhere to go; the address box is named
 * - a lens that isn't built has a quiet key that says so; READER's settings are there only while it is the lens
 * - WATCHERS prints what a page says as words, never as markup, and marks what was refused
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'seeing-render-out');
let auth = { status: 'anonymous', user: null };
const stub = (file, exports) => {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
};
stub('components/AuthProvider.js', { useAuth: () => auth });

const at = (name) => require(path.join(OUT, `components/seeing/${name}.js`)).default;
const T = require(path.join(OUT, 'lib/seeing/tabs.js'));
const el = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const none = () => undefined;

const SeeingMachine = require('./seeing-render-out/components/seeing/SeeingMachine.js').default;
const out = html(el(SeeingMachine));
assert.match(out, /THE SEEING MACHINE/);
assert.match(out, /href="\/account"/);
assert.ok(!/data-seeing-tabs|<iframe/.test(out), 'signed out there is no machine');
auth = { status: 'signed-in', user: { id: 'u1' } };
const waiting = html(el(SeeingMachine));
assert.ok(!/\/account|data-seeing-tabs/.test(waiting), 'nobody is told to log in who has, and no tabs are drawn before they are read');

let state = T.visit(T.freshTabs('a'), 'a', 'https://example.com/');
state = T.withTitle(state, 'a', 'https://example.com/', '<b>Bold</b>');
state = T.addTab(state, 'b');
let tabs = html(el(at('SeeingTabs'), { state, onShow: none, onClose: none, onNew: none }));
assert.equal((tabs.match(/role="tab"/g) ?? []).length, 2);
assert.equal((tabs.match(/aria-selected="true"/g) ?? []).length, 1);
assert.ok(tabs.includes('&lt;b&gt;Bold') && !tabs.includes('<b>'), "a page's title is words");
assert.equal((tabs.match(/aria-label="Close /g) ?? []).length, 2);
assert.ok(!/aria-label="New tab"[^>]*disabled=""/.test(tabs));
for (let i = 0; i < 9; i += 1) state = T.addTab(state, `n${i}`);
tabs = html(el(at('SeeingTabs'), { state, onShow: none, onClose: none, onNew: none }));
assert.match(tabs, /<button[^>]*aria-label="New tab"[^>]*disabled=""/);

const bar = (props) => html(el(at('SeeingToolbar'), { place: 'a', address: 'https://example.com/', canBack: false, canForward: false, busy: false, empty: false, onBack: none, onForward: none, onReload: none, onStop: none, onGo: none, ...props }));
const key = (markup, name) => new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`).exec(markup)[0];
for (const name of ['Back', 'Forward', 'Stop']) assert.match(key(bar({}), name), /disabled=""/, name);
assert.ok(!/disabled=""/.test(key(bar({}), 'Reload')));
assert.ok(!/disabled=""/.test(key(bar({ canBack: true }), 'Back')) && !/disabled=""/.test(key(bar({ busy: true }), 'Stop')));
assert.match(bar({}), /<input[^>]*aria-label="Address"[^>]*/);

const lenses = (lens) => html(el(at('SeeingLenses'), { lens, look: { paper: 'theme', size: 2 }, onLook: none, onLens: none, children: null }));
assert.equal((lenses('standard').match(/title="Not built yet"/g) ?? []).length, 3);
assert.ok(!lenses('standard').includes('SEPIA') && lenses('reader').includes('SEPIA'));
assert.match(html(el(at('SeeingLenses'), { lens: 'reader', look: { paper: 'theme', size: 1 }, onLook: none, onLens: none, children: null })), /aria-label="Smaller words"[^>]*disabled=""/);

const page = { address: 'see:test', title: 'x', eye: 'BUILT IN', html: '', reading: null, watchers: [{ company: '<i>Ads</i>', host: 'ads.example', refused: true }, { company: 'Fonts', host: 'fonts.example', refused: false }], files: 0, refused: 0 };
const watchers = html(el(at('SeeingWatchers'), { document: page }));
assert.ok(watchers.includes('&lt;i&gt;Ads') && !watchers.includes('<i>'));
assert.equal((watchers.match(/REFUSED/g) ?? []).length, 1);
assert.match(html(el(at('SeeingWatchers'), { document: { ...page, watchers: [] } })), /NOBODY\./);

console.log('BROWSER on screen: the sign-in call, tabs, keys, lenses and WATCHERS');
