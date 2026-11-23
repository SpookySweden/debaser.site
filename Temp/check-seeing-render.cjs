/*
 * BROWSER on screen (SPEC-seeing-machine.md, Luke 2026-11-23): what the server draws of it. The pure parts are check-seeing.cjs, and
 * scripts/drive-see.cjs drives it in a browser.
 *   npx tsc app/components/seeing/SeeingMachine.tsx app/components/SeeKey.tsx --rootDir app --outDir Temp/seeing-render-out --module commonjs --target es2022 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-seeing-render.cjs
 *
 * - signed out: the sign-in call and nothing of the machine; signed in, before its tabs are read: neither
 * - tabs: a tablist, one tab in front, a named close key each, the new-tab key quiet at eight
 * - the toolbar's keys are named, and quiet when there is nowhere to go; the address box is named
 * - each lens's settings are there only while it is the lens; the dial is for a page outside; X-RAY prints a page's words as words
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

const L = require(path.join(OUT, 'lib/seeing/lenses/lens.js'));
const lenses = (lens, settings = L.SETTINGS_AT_FIRST) => html(el(at('SeeingLenses'), { lens, settings, onSettings: none, onLens: none }));
// (Phase 3, 2026-11-23: every lens is built, so no key says it isn't.)
assert.equal((lenses('standard').match(/title="Not built yet"/g) ?? []).length, 0);
assert.ok(!lenses('standard').includes('SEPIA') && lenses('reader').includes('SEPIA'));
assert.match(lenses('reader', { ...L.SETTINGS_AT_FIRST, reader: { paper: 'theme', size: 1 } }), /aria-label="Smaller words"[^>]*disabled=""/);
assert.ok(lenses('lowfi').includes('TERMINAL') && lenses('custom').includes('COPY RECIPE') && !lenses('custom').includes('placeholder="SEE:'));

const tools = (props) => html(el(at('SeeingTools'), { address: 'https://example.com/', seam: null, loupe: null, erasing: false, erased: 0, good: false, onSeam: none, onLoupe: none, onErasing: none, onBringBack: none, onScan: none, onGood: none, onGo: none, children: null, ...props }));
assert.ok(/aria-label="Year"/.test(tools({})) && !/aria-label="Year"/.test(tools({ address: 'see:test' })) && !/BRING BACK/.test(tools({})) && /BRING BACK 3/.test(tools({ erased: 3 })));
assert.match(tools({ address: null }), /<button[^>]*disabled=""[^>]*>\[ SEAM \]/);

const beside = html(el(at('SeeingXray'), { point: { path: ['<b>', 'p.x'], kind: 'WORDS', size: '1 x 2', ink: 'x', ground: 'y', face: 'z', words: '<img src=x>', inside: 2 }, census: { counts: { words: 1, pictures: 2, links: 3, frames: 4, scripts: 5, forms: 6 }, rows: [{ depth: 1, name: '<script>', inside: 0 }] } }));
assert.ok(beside.includes('&lt;b&gt;') && beside.includes('&lt;img') && beside.includes('&lt;script&gt;') && !/<script|<img/.test(beside), "a page's own words are drawn as words");
assert.match(html(el(at('SeeingXray'), { point: null, census: null })), /NOTHING\./);

const page = { address: 'see:test', title: 'x', eye: 'BUILT IN', html: '', reading: null, watchers: [{ company: '<i>Ads</i>', host: 'ads.example', refused: true }, { company: 'Fonts', host: 'fonts.example', refused: false }], media: [], files: 0, refused: 0, status: null, signIn: false, refresh: null, assets: null, scripts: false };
const watchers = html(el(at('SeeingWatchers'), { document: page }));
assert.ok(watchers.includes('&lt;i&gt;Ads') && !watchers.includes('<i>'));
assert.equal((watchers.match(/REFUSED/g) ?? []).length, 1);
assert.match(html(el(at('SeeingWatchers'), { document: { ...page, watchers: [] } })), /NOBODY\./);

const SeeKey = require('./seeing-render-out/components/SeeKey.js');
assert.equal(html(el(SeeKey.default, { href: 'https://example.com/' })), '', 'no SEE key for somebody whose bar has no BROWSER on it');
assert.equal(html(el(SeeKey.SeeKeysIn, { text: 'see https://example.com/ and javascript:x' })), '');
const tray = html(el(at('SeeingTray'), { items: [{ key: 'a', title: '<b>x</b>', site: 'y.org', kind: 'VIDEO', seconds: 61, rung: 2, link: { url: 'https://y.org/a.mp4', kind: 'file', title: 'x' } }, { key: 'b', title: 'z', site: 'z.org', kind: 'VIDEO', seconds: null, rung: 5, reason: 'WHY' }] }));
assert.ok(tray.includes('&lt;b&gt;x') && /▶ PLAY IN ROOM/.test(tray) && /\+ QUEUE/.test(tray) && tray.includes('1:01') && tray.includes('WHY'));
assert.match(html(el(at('SeeingTray'), { items: [] })), /NOTHING FOUND\./);
console.log('BROWSER on screen: the sign-in call, tabs, keys, lenses and WATCHERS');
