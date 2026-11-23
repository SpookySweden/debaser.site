/*
 * BROWSER, the DEBASER SEEING MACHINE, Phase 1 (SPEC-seeing-machine.md, Luke 2026-11-23): the pure parts of the shell.
 * (scripts/drive-see.cjs drives the page itself in a browser, on every theme.)
 *   npx tsc app/lib/seeing/address.ts app/lib/seeing/tabs.ts app/lib/seeing/frame.ts app/lib/seeing/test-engine.ts app/lib/seeing/time.ts app/lib/seeing/memory.ts app/lib/seeing/lenses/registry.ts app/lib/ui/modules.ts --rootDir app --outDir Temp/seeing-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-seeing.cjs
 *
 * - an address: http and https only, no user names or passwords, no control characters, bare names get https, words are refused
 * - an address travels after the `#` and never in the path or the query; a bad one there is nothing
 * - tabs: eight at most, back and forward per tab, a visit forgets what was ahead, closing the last leaves a new one, fifty stops,
 *   stored and read back through one door (junk dropped, a javascript: stop dropped, drafts never stored)
 * - a page's title is plain text: no control or direction-changing characters, cut short
 * - the frame: two, each `allow-scripts` and nothing more; what each may load; our script first; messages read as a stranger's
 * - READER's words and links read 4.5:1 on their paper, on every theme and all four papers; WATCHERS' inks too; STANDARD wears nothing
 * - BROWSER is a module: off until ticked, WIP, and only its engine (the site's own routes) and BILLBOARD fetch anything
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = './seeing-out/lib/seeing/';
const { readAddress, addressInHash, browserHref, shortName } = require(`${OUT}address.js`);
const T = require(`${OUT}tabs.js`);
const F = require(`${OUT}frame.js`);
const { testEngine } = require(`${OUT}test-engine.js`);
const { lensById, lensOr } = require(`${OUT}lenses/registry.js`);
const { readerColours } = require(`${OUT}lenses/reader.js`);
const { lowFiColours } = require(`${OUT}lenses/lowfi.js`);
const { themeDyes } = require(`${OUT}lenses/dye.js`);
const { PAPERS, TEXT_SIZES, PALETTES, BLOCKS, SETTINGS_AT_FIRST, recipeText, recipeFrom } = require(`${OUT}lenses/lens.js`);
const { dialOf, dialTo } = require(`${OUT}time.js`);
const { memoryFrom, siteIn } = require(`${OUT}memory.js`);
const { LENS_NAMES } = require(`${OUT}lenses/names.js`);
const { THEMES } = require('./seeing-out/lib/ui/themes.js');
const { contrastRatio } = require('./seeing-out/lib/ui/colour.js');
const { MODULES, moduleIsOn, NO_CHOICES } = require('./seeing-out/lib/ui/modules.js');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ addresses */
const good = (text, address) => assert.deepEqual(readAddress(text), { ok: true, address }, text);
const bad = (text, why) => {
  const read = readAddress(text);
  assert.equal(read.ok, false, `${JSON.stringify(text)} is refused`);
  if (why) assert.match(read.reason, why);
};
good('example.com', 'https://example.com/');
good('  http://example.com/a?b=1#c ', 'http://example.com/a?b=1#c');
good('HTTPS://EXAMPLE.com', 'https://example.com/');
good('example.com:8080/x', 'https://example.com:8080/x');
good('see:test', 'see:test');
good('SEE:TEST/2', 'see:test/2');
for (const text of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'file:///c:/', 'ftp://example.com', 'blob:https://example.com/x', 'mailto:a@example.com', 'view-source:https://example.com', 'about:blank']) bad(text, /ONLY HTTP/);
for (const text of ['https://user@example.com', 'https://user:pass@example.com', 'http://debaser.site@evil.example']) bad(text, /NAME OR PASSWORD/);
for (const text of ['', '   ', 'hello', 'two words', 'java\nscript:alert(1)', 'https://', 'see:<script>', 'localhost:3000', 'https://exa mple.com', `https://example.com/${'a'.repeat(2000)}`]) bad(text);
assert.equal(shortName('https://www.example.com/a'), 'example.com');

const href = browserHref('https://example.com/a?b=c&d#e');
assert.equal(href, '/browser#see=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%23e');
assert.equal(href.split('#')[0], '/browser', 'nothing of the address before the #');
assert.equal(addressInHash(href.slice(href.indexOf('#'))), 'https://example.com/a?b=c&d#e');
assert.equal(browserHref(null), '/browser');
for (const hash of ['', '#', '#see=', '#see=%', '#see=javascript%3Aalert(1)', '#other=https%3A%2F%2Fexample.com', '#see=hello']) assert.equal(addressInHash(hash), null, hash);

/* ------------------------------------------------------------------ tabs */
let s = T.freshTabs('a');
assert.equal(T.tabName(T.frontTab(s)), 'NEW TAB');
assert.ok(!T.canGoBack(T.frontTab(s)) && !T.canGoForward(T.frontTab(s)));
s = T.visit(s, 'a', 'https://one.example/');
s = T.visit(s, 'a', 'https://two.example/');
s = T.visit(s, 'a', 'https://three.example/');
assert.equal(T.visit(s, 'a', 'https://three.example/'), s, 'the page it is at is not written twice');
s = T.step(s, 'a', -1);
s = T.step(s, 'a', -1);
assert.equal(T.stopOf(T.frontTab(s)).address, 'https://one.example/');
assert.equal(T.step(s, 'a', -1), s, 'no further back');
s = T.step(s, 'a', 1);
s = T.visit(s, 'a', 'https://four.example/');
assert.deepEqual(T.frontTab(s).stops.map((stop) => stop.address), ['https://one.example/', 'https://two.example/', 'https://four.example/'], 'what was ahead is forgotten');
assert.ok(!T.canGoForward(T.frontTab(s)));
s = T.withTitle(s, 'a', 'https://four.example/', '  Four\u202e\n\u0007 pages ');
assert.equal(T.tabName(T.frontTab(s)), 'Four pages');
assert.equal(T.withTitle(s, 'a', 'https://one.example/', 'late'), s, 'a title that comes after the tab moved on is dropped');
assert.equal(T.cleanTitle('\u0000 '), null);
assert.equal(T.cleanTitle('x'.repeat(500)).length, 80);
assert.equal(T.cleanTitle('<b>hi</b>'), '<b>hi</b>', 'words, never markup: it is drawn as text');
for (let i = 0; i < 70; i += 1) s = T.visit(s, 'a', `https://example.com/${i}`);
assert.equal(T.frontTab(s).stops.length, T.STOPS_MOST);
assert.equal(T.stopOf(T.frontTab(s)).address, 'https://example.com/69');

let many = T.freshTabs('t0');
for (let i = 1; i < 12; i += 1) many = T.addTab(many, `t${i}`);
assert.equal(many.tabs.length, 8, 'eight at most');
assert.equal(many.front, 't7');
many = T.closeTab(many, 't7', 'x');
assert.equal(many.front, 't6', 'the last one closed: the one to its left');
many = T.closeTab(T.showTab(many, 't2'), 't2', 'x');
assert.equal(many.front, 't3', 'closed: the one to its right');
assert.equal(T.closeTab(many, 't0', 'x').front, 't3', 'closing one behind leaves the front alone');
assert.deepEqual(T.closeTab(T.freshTabs('a'), 'a', 'b'), T.freshTabs('b'), 'closing the last leaves a new tab');

const kept = T.withDraft(T.withLens(s, 'a', 'reader'), 'a', 'https://brought.example/');
const back = T.tabsFromStored(T.storedTabs(kept));
assert.equal(T.frontTab(back).draft, null, 'a draft is never stored');
assert.equal(T.frontTab(back).lens, 'reader');
assert.deepEqual(T.stopOf(T.frontTab(back)), T.stopOf(T.frontTab(s)));
for (const raw of [null, '', '{', '7', '{}', '{"tabs":[]}', '{"tabs":[{"id":"<x>","stops":[]}]}']) assert.equal(T.tabsFromStored(raw), null, String(raw));
const odd = T.tabsFromStored(JSON.stringify({ front: 'gone', tabs: [{ id: 'a', at: 2, lens: 'evil', stops: [{ address: 'https://one.example/' }, { address: 'javascript:alert(1)' }, { address: 'https://two.example/', title: 5 }] }, { id: 'a', stops: [] }] }));
assert.equal(odd.tabs.length, 1, 'a second tab of the same id is dropped');
assert.equal(odd.front, 'a');
assert.deepEqual(T.frontTab(odd).stops.map((stop) => stop.address), ['https://one.example/', 'https://two.example/']);
assert.equal(T.stopOf(T.frontTab(odd)).address, 'https://two.example/');
assert.equal(T.frontTab(odd).lens, 'standard');
assert.equal(T.tabsFromStored(JSON.stringify({ tabs: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, stops: [] })) })).tabs.length, 8);

/* ------------------------------------------------------------------ the frame */
assert.equal(F.FRAME_SANDBOX, 'allow-scripts', 'the frame may run scripts and nothing else: never allow-same-origin, popups, top navigation or downloads');
const ASSETS = 'https://see.example.org/api/see/asset/';
const asked = (more = {}) => ({ html: '<p>hello</p>', address: 'https://page.example.org/a', nonce: 'NONCE', siteOrigin: 'https://debaser.site', assets: ASSETS, scripts: true, ...more });
const policyOf = (more) => Object.fromEntries(F.framePolicy(asked(more)).split('; ').map((line) => [line.split(' ')[0], line.split(' ').slice(1).join(' ')]));
for (const scripts of [true, false]) {
  const policy = policyOf({ scripts });
  for (const name of ['default-src', 'connect-src', 'media-src', 'worker-src', 'frame-src', 'object-src', 'base-uri', 'form-action']) assert.equal(policy[name], "'none'", `${name} is nothing`);
  assert.equal(policy.webrtc, "'block'");
  assert.equal(policy['img-src'], `${ASSETS} data: blob:`);
  assert.equal(policy['script-src'], scripts ? `${ASSETS} 'unsafe-inline' 'unsafe-eval' data: blob:` : "'nonce-NONCE'", scripts ? 'scripts from our signed files and the page itself' : 'scripts off: ours alone');
}
for (const assets of ['https://evil.example', 'https://a.example/api/see/asset/; img-src *', "https://a.example/api/see/asset/ 'self'", '*', 'https:']) assert.equal(F.framePolicy(asked({ assets })), F.framePolicy(asked({ assets: null })), `no place but a plain one: ${assets}`);
const inner = F.pageDocument(asked());
assert.ok(inner.indexOf('Content-Security-Policy') < inner.indexOf('<script') && inner.indexOf('<script') < inner.indexOf('<p>hello'), 'the policy, then our script, then the page');
assert.equal((inner.match(/<script/g) ?? []).length, 1);
assert.ok(inner.includes('"site":"https://debaser.site"'), 'its messages go to the site alone');
for (const address of ['https://x.example/</script><script>', 'https://x.example/"onload="']) assert.equal((F.pageDocument(asked({ address })).match(/<\/?script/g) ?? []).length, 2, 'nothing written into our script can close it');
const outer = F.frameDocument(asked({ html: '"></iframe><script>evil()</script>' }));
assert.equal((outer.match(/<script/g) ?? []).length, 0, "the outer frame has no script, and the page can't write one into it");
assert.equal((outer.match(/<iframe/g) ?? []).length, 1);
assert.match(outer, /<iframe sandbox="allow-scripts" /, 'the inner frame is held as the outer is');
assert.match(F.OUTER_POLICY, /frame-src 'none'/, 'and can be taken nowhere');
const { HOOK } = require(`${OUT}hook.js`);
assert.ok(!/<\//.test(HOOK), 'our script holds nothing that could close its element');
new Function(`return ${HOOK}`);
const viewport = fs.readFileSync(path.join(ROOT, 'app/components/seeing/SeeingViewport.tsx'), 'utf8');
assert.match(viewport, /sandbox=\{FRAME_SANDBOX\}/);
assert.match(viewport, /if \(from === null \|\| event\.source !== from\) return;\s*\n\s*const message = readFrameMessage/, 'only the page in front is heard, and before its words are read');
for (const data of [null, 5, 'ready', [], {}, { see: 'go' }, { see: 'open' }, { see: 'open', address: 5 }, { see: 'open', address: '' }, { see: 'open', address: 'x'.repeat(5000) }, { see: 'ask', id: 'x', address: 'a' }, { see: 'ask', id: 1.5, address: 'a' }, { see: 'ask', id: 1 }, { see: 'seal', id: 1, files: 'x' }, { see: 'seal', id: 1, files: [{ address: 5, kind: 'picture' }] }, { see: 'seal', id: 1, files: Array(51).fill({ address: 'a', kind: 'picture' }) }, { see: 'art', index: -1 }, { see: 'art', index: 1e9 }, { see: 'restricted', count: 'x' }, { see: 'dress', css: 'x' }, { see: 'answer', id: 1 }]) assert.equal(F.readFrameMessage(data), null, JSON.stringify(data)?.slice(0, 60));
assert.deepEqual(F.readFrameMessage({ see: 'open', address: 'https://a.example/', newTab: 'yes', extra: 1 }), { see: 'open', address: 'https://a.example/', newTab: false });
assert.deepEqual(F.readFrameMessage({ see: 'ready', css: 'x' }), { see: 'ready', ads: false });

/* ------------------------------------------------------------------ lenses, on every theme */
assert.deepEqual(LENS_NAMES.filter((lens) => lensById(lens.id) !== null).map((lens) => lens.id), LENS_NAMES.map((lens) => lens.id), 'every lens is built (Phase 3)');
assert.equal(lensOr('nonsense').id, 'standard', 'a lens that is not built draws STANDARD');
assert.ok(THEMES.length >= 18);
let pairs = 0;
const reads = (ink, surface, what) => {
  pairs += 1;
  assert.ok(contrastRatio(ink, surface) >= 4.5, `${what}: ${contrastRatio(ink, surface).toFixed(2)}`);
};
for (const theme of THEMES) {
  for (const paper of PAPERS) {
    const colours = readerColours(theme.tokens, paper);
    for (const ink of ['ink', 'link', 'quiet']) reads(colours[ink], colours.paper, `${theme.id} READER ${paper} ${ink}`);
    for (const size of TEXT_SIZES) {
      const look = { tokens: theme.tokens, scheme: theme.scheme, face: 'monospace', settings: { ...SETTINGS_AT_FIRST, reader: { paper, size } } };
      const css = lensById('reader').css(look);
      for (const colour of [colours.paper, colours.ink, colours.link]) assert.ok(css.includes(colour), `${theme.id} ${paper}: ${colour} is in the stylesheet`);
      assert.ok(!/undefined|NaN|url\(|@import|expression/.test(css), css);
      assert.equal(lensById('standard').css(look), '', 'STANDARD wears nothing');
    }
  }
  const t = theme.tokens;
  const settings = (more) => ({ tokens: t, scheme: theme.scheme, face: 'monospace', settings: { ...SETTINGS_AT_FIRST, ...more } });
  for (const palette of PALETTES) {
    const colours = lowFiColours(t, palette);
    reads(colours.ink, colours.paper, `${theme.id} LOW-FI ${palette}`);
    reads(colours.link, colours.paper, `${theme.id} LOW-FI ${palette} link`);
    const css = lensById('lowfi').css(settings({ palette }));
    assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{[^}]*steps\(/, 'its lines move in steps, and only for those who want motion');
    assert.ok(!/ease|cubic-bezier|linear infinite/.test(css));
  }
  // DYE's dyes hold a pair that reads on every one of them, so words can always be made to.
  const dyes = themeDyes(t);
  for (const ground of dyes) assert.ok(dyes.some((ink) => contrastRatio(ink, ground) >= 4.5), `${theme.id} DYE: something reads on ${ground}`);
  reads(t.ink, t.paper, `${theme.id} GLASS`);
  reads(t['accent-ink'], t.paper, `${theme.id} GLASS link`);
  for (const { id } of BLOCKS) for (const lens of ['xray', 'lowfi', 'dye', 'glass', 'custom']) assert.ok(!/undefined|NaN|url\(|@import/.test(lensById(lens).css(settings({ recipe: [id] }))), `${lens} ${id}`);
  reads(t.ink, t.paper, `${theme.id} WATCHERS`);
  reads(t['ink-quiet'], t.paper, `${theme.id} WATCHERS host`);
  reads(t['ink-bar'], t['bubble-pale'], `${theme.id} refused chip`);
  reads(t.paper, t.ink, `${theme.id} the tab in front`);
  reads(t['accent-ink'], t.paper, `${theme.id} keys`);
}

/* ------------------------------------------------------------------ Phase 3's own */
assert.deepEqual(recipeFrom(recipeText(['words', 'mono'])), ['words', 'mono']);
assert.deepEqual(recipeFrom(' see:MONO+nonsense+words '), ['words', 'mono'], 'in the blocks\' own order, and nothing that is not one');
for (const text of ['', 'words', 'SEE:<b>', 'SEE:{}', 'SEE:words;x']) assert.equal(recipeFrom(text), null, text);
assert.deepEqual(dialOf('https://web.archive.org/web/20040701000000if_/http://example.com/a'), { address: 'http://example.com/a', year: 2004 });
assert.deepEqual(dialOf('https://web.archive.org/web/2011/https:/example.com/'), { address: 'https://example.com/', year: 2011 });
assert.deepEqual(dialOf('https://example.com/'), { address: 'https://example.com/', year: null });
assert.equal(dialTo('https://web.archive.org/web/2004if_/http://example.com/', 1999), 'https://web.archive.org/web/19990701000000if_/http://example.com/');
assert.equal(dialTo('https://web.archive.org/web/2004if_/http://example.com/', null), 'http://example.com/');
for (const selector of ['#a', 'div:nth-of-type(2)', 'body:nth-of-type(1) > div:nth-of-type(2) > my-tag:nth-of-type(10)', '#a > p:nth-of-type(1)']) assert.ok(F.isSelector(selector), selector);
for (const selector of ['', '*', 'a{}', '#a{} *', 'div', '#a, #b', '#a]', 'x:nth-of-type(1){background:url(x)}', '#a > *', '@import', 'a:hover', '/**/', '#a\n', `#${'a'.repeat(600)}`]) assert.ok(!F.isSelector(selector), JSON.stringify(selector));
assert.deepEqual(F.readFrameMessage({ see: 'erase', selector: '#a' }), { see: 'erase', selector: '#a' });
for (const data of [{ see: 'erase', selector: '*{}' }, { see: 'erase' }, { see: 'pointer', x: 'a', y: 1 }, { see: 'pointer', x: Infinity, y: 1 }, { see: 'scroll', x: 1, y: 1 }, { see: 'point' }, { see: 'point', path: Array(20).fill('x') }]) assert.equal(F.readFrameMessage(data), null, JSON.stringify(data));
const told = F.readFrameMessage({ see: 'point', path: ['x'.repeat(500), 5], kind: {}, size: 'x'.repeat(500), words: 'w'.repeat(5000), inside: -1 });
assert.ok(told.point.path[0].length === 60 && told.point.path[1] === '' && told.point.kind === '' && told.point.words.length === 160 && told.point.inside === 0);
const counted = F.readFrameMessage({ see: 'census', counts: { words: 5, scripts: 'x' }, rows: [...Array(300).fill({ depth: 99, name: 'x'.repeat(99), inside: 1 }), 7] });
assert.ok(counted.census.rows.length === 160 && counted.census.rows[0].depth === 6 && counted.census.rows[0].name.length === 60 && counted.census.counts.scripts === 0 && counted.census.counts.words === 5);
const kept3 = memoryFrom({ 'example.com': 'reader', 'bad site': 'reader', 'x.org': 'evil' }, { 'example.com': ['#a', '*{}', 5], 'y.org': 'x' }, [{ address: 'https://example.com/', title: 'A\u202eB' }, { address: 'javascript:alert(1)', title: 'x' }, 5]);
assert.deepEqual(kept3, { lenses: { 'example.com': 'reader' }, erased: { 'example.com': ['#a'] }, good: [{ address: 'https://example.com/', title: 'A B' }] });
assert.deepEqual(memoryFrom(null, 'x', { a: 1 }), { lenses: {}, erased: {}, good: [] });
assert.equal(siteIn('https://web.archive.org/web/19990701000000if_/http://foo.example.com/a'), 'foo.example.com', 'an old copy is its own site');
assert.equal(siteIn('javascript:x'), null);
// The lens tools run in the page's window: what they hold of the browser's own is called without asking it.
assert.ok(!/plain\w+\.(?:set|get)\.(?:call|apply)/.test(HOOK), 'nothing captured is called by way of something the page could put in its place');

/* ------------------------------------------------------------------ the built-in pages and the module */
const browser = MODULES.find((module) => module.key === 'browser');
assert.deepEqual({ label: browser.label, href: browser.href, wip: browser.wip }, { label: 'BROWSER', href: '/browser', wip: true });
assert.equal(moduleIsOn(browser, NO_CHOICES), false, 'off the bar until ticked');

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
}
for (const file of [...files('app/lib/seeing'), ...files('app/components/seeing'), 'app/browser/page.tsx']) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // The page asks our own routes, and BILLBOARD the art: nothing else in the browser reaches anywhere. (Phase 2, 2026-11-23: it was nothing at all.)
  if (!file.startsWith('app/lib/seeing/server/') && !/\/(?:hook|server-engine|billboards)\.ts$/.test(file)) assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(source), `${file} fetches nothing`);
  if (file.endsWith('server-engine.ts')) assert.deepEqual([...source.matchAll(/\bfetch\(([^,]+),/g)].map((m) => m[1]), ['`/api/see/${path}`'], 'the engine asks the site and nobody else');
  // The hook runs in the frame, not here.
  if (!file.endsWith('/hook.ts')) assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(source), `${file} puts no markup in the site's own page`);
}

(async () => {
  const steps = [];
  const answer = await testEngine.open('see:test', (step) => steps.push(step), new AbortController().signal);
  assert.ok(answer.ok && answer.document.reading.length > 0);
  assert.deepEqual(steps, ['ACQUIRING SOURCE']);
  assert.equal(answer.document.files + answer.document.refused, 0, 'no made-up counts');
  assert.equal((await testEngine.open('see:nowhere', () => {}, new AbortController().signal)).ok, false);
  console.log(`BROWSER: addresses, tabs, the frame, ${pairs} pairs over ${THEMES.length} themes, the module`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
