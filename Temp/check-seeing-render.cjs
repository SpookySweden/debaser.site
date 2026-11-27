/*
 * BROWSER on screen (SPEC-seeing-machine.md, Luke 2026-11-23): what the server draws of it. The pure parts are check-seeing.cjs, and
 * scripts/drive-see.cjs drives it in a browser.
 *   npx tsc app/components/seeing/SeeingMachine.tsx app/components/SeeKey.tsx app/components/ExtensionWindow.tsx app/components/KeptPagesLane.tsx --rootDir app --outDir Temp/seeing-render-out --module commonjs --target es2022 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
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

const bar = (props) => html(el(at('SeeingToolbar'), { place: 'a', address: 'https://example.com/', canBack: false, canForward: false, busy: false, empty: false, onBack: none, onForward: none, onReload: none, onStop: none, onGo: none, say: (text) => `SAYS ${text}`, searches: () => false, engine: 'DUCKDUCKGO', listing: false, onList: none, onAll: none, ...props }));
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

const tools = (props) => html(el(at('SeeingTools'), { address: 'https://example.com/', ready: true, seam: null, loupe: null, erasing: false, erased: 0, good: false, onSeam: none, onLoupe: none, onErasing: none, onBringBack: none, onScan: none, onGood: none, onGo: none, children: null, ...props }));
// The TIME DIAL is a key until pressed (decision 37), and open, at its year, on an old copy.
assert.ok(!/aria-label="Year"/.test(tools({})) && tools({}).includes('[ TIME ]') && /aria-label="Year"/.test(tools({ address: 'https://web.archive.org/web/20040701000000if_/https://example.com/' })) && !tools({ address: 'https://web.archive.org/web/20040701000000if_/https://example.com/' }).includes('[ TIME ]'));
assert.ok(!/aria-label="Year"/.test(tools({ address: 'see:test' })) && !tools({ address: 'see:test' }).includes('[ TIME ]') && !/BRING BACK/.test(tools({})) && /BRING BACK 3/.test(tools({ erased: 3 })));
// A refusal's trace: only what this side knows, the address drawn as words (IMPROVE, 2026-11-23).
const refused = (props) => html(el(at('SeeingRefused'), { reason: 'NO SUCH SITE', eye: 'SERVER EYE', ms: 412, address: 'https://example.com/<b>', canOld: true, ownEye: false, onAgain: none, onOld: none, onOwn: none, ...props }));
assert.ok(/data-seeing-trace/.test(refused({})) && refused({}).includes('SERVER EYE') && refused({}).includes('NO SUCH SITE · 412 MS') && refused({}).includes('&lt;b&gt;') && !refused({}).includes('<b>'));
assert.ok(refused({ ms: 15234 }).includes('· 15.2 S'));

// The keys named OWN EYE show the page inside BROWSER (Luke, 2026-11-27: "it seems own eye still opens a new tab in edge when i click it"):
// none of them is marked as leaving (↗); a tab of the browser is behind a key whose name says tab, and only there.
const TAB_KEY = /IN A TAB ↗/;
const ownRefused = refused({ reason: 'TOO LARGE', ownEye: true });
assert.ok(ownRefused.includes('[ OWN EYE ]') && !/OWN EYE ↗/.test(ownRefused) && !/OPENS A NEW TAB/.test(ownRefused), "a refused page's OWN EYE key says nothing of a tab");
const shellPage = (extension) => html(el(at('SeeingShell'), { site: 'x.com', extension, onOwn: none, onTab: none, onGet: none, onAnyway: none }));
assert.ok(shellPage('current').includes('SHOW IT HERE WITH OWN EYE') && !/OWN EYE ↗/.test(shellPage('current')) && shellPage('current').includes('[ IN A TAB ↗ ]'), 'a site the house can\'t show: OWN EYE here, and a tab under its own name');
assert.ok(!TAB_KEY.test(shellPage('missing')) && shellPage('missing').includes('GET THE EXTENSION'), 'without the extension, the extension first');
const signInLine = html(el(at('SeeingSignIn'), { site: 'youtube.com', has: true, onLogIn: none, onGet: none, onNotNow: none, onNever: none }));
assert.ok(signInLine.includes('LOG IN TO YOUTUBE IN A TAB ↗'), 'signing in is in a tab, and the key says so');
const ownFrame = html(el(at('SeeingOwnFrame'), { address: 'https://example.com/', onList: true, site: 'example.com', at: null, onTab: none, onMachine: none, onHouse: none, onAdd: none }));
assert.ok(ownFrame.includes('[ IN A TAB ↗ ]') && ownFrame.includes('[ FROM THE HOUSE ]') && /data-seeing-own-frame/.test(ownFrame), "the frame's own line: a tab and the house, one press away");
// A new tab shows only what works without a page (IMPROVE, 2026-11-23): SCAN stays, the page's own keys wait for a page.
assert.ok(['SEAM', 'LOUPE', 'ERASE', 'GOOD'].every((name) => !tools({ address: null }).includes(`[ ${name} ]`)) && tools({ address: null }).includes('[ SCAN ]'));
assert.ok(['SEAM', 'LOUPE', 'ERASE', 'GOOD', 'SCAN'].every((name) => tools({}).includes(`[ ${name} ]`)));
// Busy or refused: no page to seam, loupe or erase, so those keys are greyed (but one already pressed can still be let go).
const greyed = (markup, name) => markup.split('<button').some((each) => each.includes(`[ ${name} ]`) && each.includes('disabled=""'));
assert.ok(['SEAM', 'LOUPE', 'ERASE'].every((name) => greyed(tools({ ready: false }), name) && !greyed(tools({}), name)));
assert.ok(!greyed(tools({ ready: false, erasing: true }), 'ERASE') && !greyed(tools({ ready: false }), 'SCAN'));

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
const history = html(el(at('SeeingHistory'), { onGo: none, onClose: none }));
assert.ok(/ONLY YOU SEE THIS\. 90 DAYS\./.test(history) && /NOTHING YET\./.test(history) && /TRAIL/.test(history));
const keepPanel = html(el(at('SeeingKeep'), { address: 'https://a.example/', owner: { id: 'u1', label: 'U' }, selected: '', onOpen: none, onClose: none }));
assert.ok(/ONLY YOU, IN THIS BROWSER/.test(keepPanel) && !/EVERYONE/.test(keepPanel), 'it says who will see it');
assert.match(keepPanel, /<a href="https:\/\/web\.archive\.org\/save\/https:\/\/a\.example\/" target="_blank" rel="noopener noreferrer"/);
assert.match(keepPanel, /<button[^>]*disabled=""[^>]*>\[ \+ QUOTE \]/);
assert.match(html(el(at('SeeingKept'), { me: 'u1', onGo: none, onClose: none })), /NOTHING KEPT\./);
const notes = html(el(at('SeeingMargins'), { page: 'https://a.example/', owner: { id: 'u1', label: 'U' }, notes: [{ id: 'n', page: 'https://a.example/', quote: '<i>q</i>', note: 'mine', at: 1, ownerId: 'u2', ownerLabel: 'THEM' }], selected: '', onFind: none, onClose: none }));
assert.ok(/ONLY YOU, IN THIS BROWSER/.test(notes) && /&lt;i&gt;q/.test(notes) && /\[ FIND \]/.test(notes) && !/\[ DELETE \]/.test(notes), "and nobody else's note can be deleted from here");
assert.match(html(el(at('SeeingGraffiti'), { drawing: true, where: 'https://a.example/', at: { y: 0, whole: 1 }, onScroll: none })), /aria-label="Graffiti"/);
const { ExtensionBody, default: ExtensionWindow } = require('./seeing-render-out/components/ExtensionWindow.js');
assert.equal(html(el(ExtensionWindow)), '', 'shut, the EXTENSION window is not there');
const body_ = (state, canPick = true) => html(el(ExtensionBody, { canPick, state: { kind: 'missing', version: null, newest: '0.2.0', folder: 'none', settings: null, said: null, busy: false, ...state } }));
assert.ok(/GET IT FIRST/.test(body_({})) && /href="\/api\/extension\/zip\?v=0\.2\.0"/.test(body_({})) && !/OPENS PAGES IN/.test(body_({})), 'without it, getting it first');
assert.ok(/CHOOSE ITS FOLDER/.test(body_({ kind: 'old', version: '0.1.0' })) && !/OPENS PAGES IN/.test(body_({ kind: 'old', version: '0.1.0' })), 'old, updating it first');
assert.ok(!/CHOOSE ITS FOLDER/.test(body_({ kind: 'old', version: '0.1.0' }, false)) && /DOWNLOAD/.test(body_({ kind: 'old', version: '0.1.0' }, false)), 'a browser that can not pick a folder has the download');
assert.ok(/COULD/.test(body_({ kind: 'old', version: '0.1.0' })) && /COULD/.test(body_({ kind: 'current', version: '0.2.0' })), 'it says what choosing the folder gives');
assert.ok(/>UPDATE</.test(body_({ kind: 'old', version: '0.1.0', folder: 'ask' })));
assert.ok(/OPENS PAGES IN/.test(body_({ kind: 'current', version: '0.2.0', settings: { lens: 'reader', wear: true } })));
assert.ok(/CHROME AND EDGE/.test(body_({ kind: 'unable' })));
for (const kind of ['missing', 'old', 'current', 'unable']) assert.match(body_({ kind, version: '0.1.0' }), /NEVER READS PASSWORDS OR COOKIES/);
// (2026-11-27, "easier to download and update") No store yet: the extension written into a new folder, the extensions page's address copied.
const NO_STORE = { chrome: null, edge: null };
const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';
const get_ = (state = {}, more = {}) => html(el(ExtensionBody, { canPick: true, stores: NO_STORE, state: { kind: 'missing', version: null, newest: '0.2.0', folder: 'none', settings: null, said: null, busy: false, ...state }, ...more }));
assert.ok(/\[ CHOOSE AN EMPTY FOLDER \]/.test(get_()) && /\[ COPY chrome:\/\/extensions \]/.test(get_()) && !/data-store-page/.test(get_()), 'no store yet: an empty folder, and the address to paste');
assert.ok(/\[ COPY edge:\/\/extensions \]/.test(get_({}, { browser: 'edge' })), "Edge's own address in Edge");
assert.ok(/WRITTEN INTO THE FOLDER my-ext/.test(get_({ wroteInto: 'my-ext' })) && !/CHOOSE AN EMPTY FOLDER/.test(get_({ wroteInto: 'my-ext' })) && /CHOOSE THE FOLDER my-ext/.test(get_({ wroteInto: 'my-ext' })), 'once written, which folder to load');
assert.ok(!/CHOOSE AN EMPTY FOLDER/.test(get_({}, { canPick: false })) && /UNZIP IT/.test(get_({}, { canPick: false })), 'no folder picker: the zip');
// Once a store has it: that store's page first, by hand under it.
const chromeStore = get_({}, { stores: { chrome: STORE_ID, edge: null } });
assert.ok(chromeStore.includes(`href="https://chromewebstore.google.com/detail/${STORE_ID}"`) && /GET IT FROM THE CHROME WEB STORE/.test(chromeStore) && /OR BY HAND/.test(chromeStore), "Chrome's store first");
const edgeStore = get_({}, { browser: 'edge', stores: { chrome: STORE_ID, edge: 'ponmlkjihgfedcbaponmlkjihgfedcba' } });
assert.ok(/microsoftedge\.microsoft\.com\/addons\/detail\//.test(edgeStore) && /EDGE ADD-ONS STORE/.test(edgeStore), "Edge's own store in Edge");
assert.ok(/ALLOW EXTENSIONS FROM OTHER STORES/.test(get_({}, { browser: 'edge', stores: { chrome: STORE_ID, edge: null } })), "Edge with only Chrome's: says what Edge asks");
// A store's copy: updated by the store; one behind says the store is checking; two copies in, the one by hand to take out.
const storeCopy = (state) => body_({ kind: 'current', version: '0.2.0', settings: { lens: 'reader', wear: true }, from: 'chrome', copies: 1, ...state });
assert.ok(/UPDATES BY ITSELF/.test(storeCopy({})) && !/CHOOSE ITS FOLDER/.test(storeCopy({})) && !/DELETE ITS FOLDER/.test(storeCopy({})), "a store's copy: no folder");
assert.ok(/STILL CHECKING THE NEW ONE \(0\.3\.0\)/.test(storeCopy({ version: '0.2.0', newest: '0.3.0', checking: true })), 'one behind: the store is checking');
assert.ok(/TWO COPIES ARE IN/.test(storeCopy({ copies: 2 })) && !/TWO COPIES/.test(storeCopy({})), 'two copies: take one out');
const storeOld = body_({ kind: 'old', version: '0.1.0', from: 'edge' });
assert.ok(/UPDATE IT FIRST/.test(storeOld) && /PRESS &ldquo;Update&rdquo;|PRESS “Update”/.test(storeOld) && !/CHOOSE ITS FOLDER/.test(storeOld), 'older than one behind: still UPDATE IT FIRST, by the store');
assert.ok(/\[ DUCKDUCKGO ▾ \]/.test(bar({})) && !/SAYS/.test(bar({})), 'the engine is named, and nothing is said of the page already in front');
const engines = html(el(at('SeeingEngines'), { ownEye: false, onClose: none }));
for (const name of ['Google ↗', 'Bing ↗', 'DuckDuckGo', 'Marginalia', 'Wikipedia', 'DEBASER.SITE', 'MEDIA']) assert.ok(engines.includes(name), name);
assert.ok(/IN A NEW TAB/.test(engines) && /NO WORDS ARE STORED/.test(engines) && /https:\/\/example\.com\/\?q=%s/.test(engines));
assert.match(html(el(at('SeeingEngines'), { ownEye: true, onClose: null })), /IN OWN EYE/);
// Kept pages elsewhere: the lane draws nothing until there are some, and a thread's anchor leads to the kept copy.
stub('lib/seeing/pages-store.js', {
  keptPages: () => [], subscribeToKeptPages: () => none, openKeptPagesOf: async () => undefined,
  keptPagesOnServer: () => LANE,
});
const LANE = [
  { id: '0123abcd-0000-4000-8000-00000000abcd', ownerId: 'u2', ownerLabel: 'THEM', address: 'https://a.example/x', title: '<b>Fog</b> signals', description: '', site: 'a.example', picture: null, language: '', date: '', at: 1, tags: ['FOG'], note: '', quotes: [], hasCopy: true, private: false },
  { id: '0123abcd-0000-4000-8000-00000000abce', ownerId: 'u1', ownerLabel: 'ME', address: 'https://b.example/', title: 'Private thing', description: '', site: 'b.example', picture: null, language: '', date: '', at: 1, tags: ['FOG'], note: '', quotes: [], hasCopy: false, private: true },
];
const lanePath = require.resolve(path.join(OUT, 'components/KeptPagesLane.js'));
const nav = require.resolve('next/navigation');
require.cache[nav] = { id: nav, filename: nav, loaded: true, exports: { useRouter: () => ({ push: none }) } };
delete require.cache[lanePath];
const Lane = require('./seeing-render-out/components/KeptPagesLane.js').default;
const lane = (props) => html(el(Lane, props));
assert.ok(/PAGES :: 1 KEPT/.test(lane({})) && /&lt;b&gt;Fog/.test(lane({})) && !/Private thing/.test(lane({})), 'the open ones, their titles as words');
assert.ok(/Fog/.test(lane({ search: 'signals' })) && lane({ search: 'nothing like it' }) === '', 'those a search finds');
assert.ok(/Fog/.test(lane({ tags: ['fog'] })) && lane({ tags: ['harbours'] }) === '' && lane({ tags: [] }) === '', "and DISCOVER's, by their keepers' own tags");
console.log('BROWSER on screen: the sign-in call, tabs, keys, lenses and WATCHERS');
