/*
 * BROWSER, the DEBASER SEEING MACHINE, Phase 1 (SPEC-seeing-machine.md, Luke 2026-11-23): the pure parts of the shell.
 * (scripts/drive-see.cjs drives the page itself in a browser, on every theme.)
 *   npx tsc app/lib/seeing/address.ts app/lib/seeing/tabs.ts app/lib/seeing/frame.ts app/lib/seeing/test-engine.ts app/lib/seeing/time.ts app/lib/seeing/trail.ts app/lib/seeing/search.ts app/lib/seeing/margins.ts app/lib/seeing/sonify.ts app/lib/seeing/together.ts app/lib/seeing/keys.ts app/lib/seeing/pages.ts app/lib/seeing/media.ts app/lib/seeing/ask.ts app/lib/seeing/memory.ts app/lib/seeing/lenses/registry.ts app/lib/ui/modules.ts --rootDir app --outDir Temp/seeing-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
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
const { trayOf, lengthText } = require(`${OUT}media.js`);
const H = require(`${OUT}history.js`);
const { trailOf } = require(`${OUT}trail.js`);
const { askToSee, takeAsked } = require(`${OUT}ask.js`);
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

/* ------------------------------------------------------------------ Phase 4: the tray and SEE */
const found = (address, from = 'link', title = '', seconds = null) => ({ address, title, from, seconds });
const tray = trayOf([found('https://youtu.be/aqz-KE-bpKQ', 'player', 'Bunny', 635), found('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), found('https://media.example.org/a.mp4', 'video', 'A'), found('http://media.example.org/b.mp4', 'video'), found('https://x.example.org/embed/1', 'player'), found('https://x.example.org/watch/1', 'declared', 'Film'), found('https://x.example.org/a.m3u8', 'video'), found('nonsense', 'video'), found('javascript:alert(1)', 'video')]);
assert.deepEqual(tray.map((item) => [item.rung, item.kind, item.title]), [[1, 'YOUTUBE', 'Bunny'], [2, 'VIDEO', 'A'], [2, 'STREAM', 'x.example.org'], [5, 'VIDEO', 'media.example.org'], [5, 'VIDEO', 'Film']], 'one of each, the best rung first, and a frame nobody called media left out');
assert.ok(tray.every((item) => item.rung === 5 ? item.reason.length > 0 && !('link' in item) : item.link.url.startsWith('https://')), 'what can go to the Room has a link, what cannot says why');
assert.deepEqual([lengthText(59), lengthText(61.4), lengthText(3723)], ['0:59', '1:01', '1:02:03']);
assert.deepEqual(F.readFrameMessage({ see: 'media', media: [{ address: 'https://a.example/x.mp4', title: 'T'.repeat(500), from: 'evil', seconds: -5 }, { address: 'javascript:x' }, 5] }), { see: 'media', media: [{ address: 'https://a.example/x.mp4', title: 'T'.repeat(160), from: 'video', seconds: null }] });
assert.equal(F.readFrameMessage({ see: 'media' }), null);
askToSee('https://example.com/');
assert.equal(takeAsked(), 'https://example.com/');
assert.equal(takeAsked(), null, 'once');

/* ------------------------------------------------------------------ Phase 5: history and TRAIL */
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const seen = (address, at, from = null, title = 'T') => ({ address, title, at, from });
let h = H.withVisit([], seen('https://a.example/', NOW - 5000));
h = H.withVisit(h, seen('https://a.example/', NOW - 1000, null, 'Better'));
assert.deepEqual(h.map((row) => row.title), ['Better'], 'the same page again at once is the same visit');
h = H.withVisit(h, seen('https://b.example/x?secret=1', NOW, 'https://a.example/'));
assert.equal(H.withVisit(h, seen('see:test', NOW)).length, 2, 'the built-in pages are not history');
assert.deepEqual(H.keptRows([seen('https://a.example/', NOW - 91 * DAY), seen('https://b.example/', NOW - 89 * DAY)], NOW).map((row) => row.address), ['https://b.example/'], 'ninety days');
assert.equal(H.keptRows(Array.from({ length: 3000 }, (_, i) => seen('https://a.example/', NOW - i * 1000)), NOW).length, H.HISTORY_MOST);
assert.deepEqual(H.findIn(h, 'b.example').length, 1);
assert.deepEqual(H.recentPages([seen('https://a.example/#2', 9), seen('https://b.example/', 8), seen('https://a.example/#1', 7), seen('https://c.example/', 6), seen('https://d.example/', 5)], 3).map((row) => row.address), ['https://a.example/#2', 'https://b.example/', 'https://c.example/'], 'a new tab: the last pages, each once, newest first');
assert.equal(H.without(h, NOW, 'https://b.example/x?secret=1').length, 1);
assert.deepEqual(H.rowsFrom([seen('javascript:x', NOW), seen('https://a.example/', 'x'), null, { address: 'https://c.example/', title: 'A\u202eB', at: NOW, from: 'javascript:x' }], NOW), [{ address: 'https://c.example/', title: 'A B', at: NOW, from: null }]);
assert.deepEqual(H.rowsFrom('x', NOW), []);
const walk = [seen('https://c.example/2', NOW, 'https://b.example/'), seen('https://b.example/', NOW - 1, 'https://www.a.example/'), seen('https://www.a.example/', NOW - 2), seen('https://b.example/old', NOW - 3, 'https://www.a.example/')];
const trail = trailOf(walk);
assert.deepEqual(trail.places.map((place) => [place.site, place.visits, place.last]), [['b.example', 2, 'https://b.example/'], ['a.example', 1, 'https://www.a.example/'], ['c.example', 1, 'https://c.example/2']]);
assert.deepEqual(trail.steps, [{ from: 'b.example', to: 'c.example', times: 1 }, { from: 'a.example', to: 'b.example', times: 2 }]);
assert.deepEqual(trailOf(walk), trail, 'the same walk makes the same map');
const big = trailOf(Array.from({ length: 400 }, (_, i) => seen(`https://s${i % 90}.example/`, NOW - i, i > 0 ? `https://s${(i * 7) % 90}.example/` : null)));
assert.ok(big.places.length === 60 && big.places.every((place) => place.x >= 0.05 && place.x <= 0.95 && place.y >= 0.05 && place.y <= 0.95), 'sixty places, all on the map');
assert.ok(big.places.every((one, i) => big.places.every((other, j) => i === j || Math.hypot(one.x - other.x, one.y - other.y) > 0.005)), 'no two in one place');
const one = trailOf([seen('https://a.example/', NOW)]).places[0];
assert.ok(Math.abs(one.x - 0.5) < 1e-9 && Math.abs(one.y - 0.5) < 1e-9, 'one place is in the middle');
assert.deepEqual(trailOf([]), { places: [], steps: [] });

/* ------------------------------------------------------------------ Phase 5: kept pages */
assert.deepEqual(F.readFrameMessage({ see: 'select', text: ` a\n b ${'x'.repeat(900)}` }).text.length <= 300, true);
assert.equal(F.readFrameMessage({ see: 'select' }), null);
const P = require(`${OUT}pages.js`);
const ID = '0123abcd-0000-4000-8000-00000000abcd';
assert.equal(P.keptId(P.keptAddress(ID)), ID);
assert.deepEqual(readAddress(P.keptAddress(ID)), { ok: true, address: P.keptAddress(ID) }, "a copy's address is one the machine takes");
for (const bad of ['see:kept/x', 'see:kept/0123', 'see:test', 'https://a.example/see:kept/']) assert.equal(P.keptId(bad), null);
assert.deepEqual(P.cleanTags('fog, #Fog , harbours,,' + 'x'.repeat(90)), ['FOG', 'HARBOURS', 'X'.repeat(40)]);
assert.equal(P.cleanTags('a,b,c,d,e,f,g,h,i,j').length, P.TAGS_MOST);
const row = { id: ID, ownerId: 'me', ownerLabel: 'Me', address: 'https://a.example/x', title: 'T', description: 'D', picture: 'data:image/webp;base64,AAAA', language: 'en', date: '2026-11-23', at: NOW, tags: ['fog'], note: 'n', quotes: ['q'.repeat(900), ''], hasCopy: true, private: false };
const keptRow = P.pageFrom(row);
assert.ok(keptRow.site === 'a.example' && keptRow.quotes.length === 1 && keptRow.quotes[0].length === P.QUOTE_LENGTH && keptRow.tags[0] === 'FOG');
for (const bad of [{ id: 'x' }, { address: 'javascript:1' }, { address: 'see:test' }, { at: 'x' }]) assert.equal(P.pageFrom({ ...row, ...bad }), null, JSON.stringify(bad));
for (const picture of ['https://tracker.example/p.gif', 'data:image/svg+xml;base64,AAAA', 'data:image/webp;base64,"onerror=', `data:image/webp;base64,${'A'.repeat(70000)}`]) assert.equal(P.pageFrom({ ...row, picture }).picture, null, 'a card asks nothing of anywhere');
assert.equal(P.pageFrom({ ...row, private: undefined }).private, true, 'private unless it says otherwise');
assert.equal(P.copyFrom({ reading: 'x' }), null);
assert.deepEqual(P.copyFrom({ html: 'a', reading: 3, title: 4 }), { html: 'a', reading: null, title: '' });

/* ------------------------------------------------------------------ Phase 6: SONIFY, heard by BeepBox itself */
const S = require(`${OUT}sonify.js`);
const sonPage = '<h1>a</h1><h1x><a href="https://x.example/1">l</a><a name=n>no</a><img src=x><h2>b</h2>' + Array.from({ length: 30 }, (_, i) => `<a class=k href='/p${i}'>w</a><h3>c</h3>`).join('');
const parts = S.partsOf(sonPage);
assert.deepEqual(parts.slice(0, 4).map((part) => part.kind), ['heading', 'link', 'picture', 'heading']);
assert.equal(parts.length, 64);
assert.equal(S.songOf(S.partsOf('<p>words</p><img src=x>')), null);
assert.deepEqual(S.songOf(parts), S.songOf(S.partsOf(sonPage)), 'the same page sounds the same');
const { Song } = require('beepbox');
const hash = new URL(S.beatBoxHref(sonPage), 'https://debaser.site').hash;
assert.ok(hash.length < 30_000 && !/example|secret/.test(decodeURIComponent(hash)), "no word or address of the page is in it");
const heard = new Song(decodeURIComponent(hash.slice(1)));
assert.equal(heard.barCount, 4);
assert.equal(heard.tempo, 112);
const played = (noise) => heard.channels.flatMap((channel, i) => (heard.getChannelIsNoise(i) === noise ? channel.patterns.flatMap((pattern) => pattern.notes) : []));
assert.ok(played(true).length >= 20 && played(false).length >= 20, `BeepBox reads its notes (${played(true).length}, ${played(false).length})`);
assert.ok(played(true).some((note) => note.pitches[0] === 0) && played(true).every((note) => note.start % 6 === 0), 'the headings are the beat');
for (const n of [1, 200, 4100]) assert.ok(new Song(JSON.stringify(S.songOf(S.partsOf('<h2>x</h2><a href=/q>y</a>'.repeat(n))))).barCount <= 8);

/* ------------------------------------------------------------------ Phase 6: MARGINALIA and GRAFFITI */
const M = require(`${OUT}margins.js`);
const PG = 'https://a.example/x';
assert.equal(M.pageOf(`${PG}#part`), PG);
assert.equal(M.pageOf('see:test'), null);
let marginAll = M.withNote(M.NO_MARGINS, { id: ID, page: PG, quote: ' a  b ', note: ' n ', at: NOW });
assert.deepEqual(marginAll.notes, [{ id: ID, page: PG, quote: 'a b', note: 'n', at: NOW }]);
assert.equal(M.withNote(marginAll, { id: ID, page: PG, quote: 'a', note: ' ', at: NOW }), marginAll, 'no note of nothing');
assert.equal(M.withoutNote(marginAll, ID).notes.length, 0);
const line = { ink: 'sun', points: [0, 10, 500, 20] };
marginAll = M.withStrokes(marginAll, M.drawingKey(PG, false), [line]);
assert.deepEqual([M.strokesOn(marginAll, PG).length, M.strokesOn(marginAll, M.drawingKey(PG, true)).length, M.strokesOn(marginAll, '__proto__').length, M.strokesOn(marginAll, 'constructor').length], [1, 0, 0, 0]);
assert.deepEqual(M.marginsFrom(JSON.parse(JSON.stringify(marginAll))), marginAll, 'kept and read back the same');
assert.deepEqual(M.marginsFrom({ notes: [{ id: 'x', page: PG, quote: 'q', note: 'n', at: 1 }, { id: ID, page: 'javascript:1', quote: 'q', note: 'n', at: 1 }], drawings: { [PG]: [{ ink: 'red', points: [1, 2] }, { ink: 'sun', points: [1] }, { ink: 'sun', points: [1, 'x'] }], 'see:test': [line] } }), M.NO_MARGINS);
assert.deepEqual(Object.keys(M.withStrokes(marginAll, PG, []).drawings), []);
const heavy = { notes: [], drawings: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`https://a.example/${i}`, Array.from({ length: 40 }, () => ({ ink: 'sun', points: Array(600).fill(12345) }))])) };
const light = M.storedMargins(heavy);
assert.ok(light.text.length <= M.STORED_MOST && 'https://a.example/29' in light.margins.drawings && !('https://a.example/0' in light.margins.drawings), 'kept within its room, the newest kept');
let pagesDrawn = M.NO_MARGINS;
for (let i = 0; i < 40; i += 1) pagesDrawn = M.withStrokes(pagesDrawn, `https://a.example/${i}`, [line]);
assert.ok(Object.keys(pagesDrawn.drawings).length === M.DRAWN_PAGES_MOST && 'https://a.example/39' in pagesDrawn.drawings && !('https://a.example/0' in pagesDrawn.drawings));

/* ------------------------------------------------------------------ Phase 6: SEEN TOGETHER, a room's words read as a stranger's */
const G = require(`${OUT}together.js`);
assert.deepEqual(G.readTogether({ see: 'at', address: 'https://a.example/x#part', y: 40, whole: 900 }), { see: 'at', address: 'https://a.example/x', y: 40, whole: 900 });
assert.deepEqual(G.readTogether({ see: 'at', address: 'https://a.example/x', y: 5000, whole: 0 }), { see: 'at', address: 'https://a.example/x', y: 0, whole: 1 }, 'never further down than the page');
assert.deepEqual([G.readTogether({ see: 'over', address: 'x' }), G.readTogether({ see: 'who' })], [{ see: 'over' }, { see: 'who' }]);
for (const bad of [null, 'at', { see: 'at', address: 'javascript:alert(1)', y: 1, whole: 2 }, { see: 'at', address: 'see:kept/x', y: 1, whole: 2 }, { see: 'at', address: 'https://user:pw@a.example/', y: 1, whole: 2 }, { see: 'at', address: 'https://a.example/', y: -1, whole: 2 }, { see: 'at', address: 'https://a.example/', y: NaN, whole: 2 }, { see: 'at', address: 'https://a.example/', y: 1, whole: 1e9 }, { see: 'at', address: 'https://a.example/', y: '1', whole: 2 }, { see: 'go', address: 'https://a.example/' }]) {
  assert.equal(G.readTogether(bad), null, `refused: ${JSON.stringify(bad)}`);
}
assert.deepEqual([G.samePage('https://a.example/x#a', 'https://a.example/x#b'), G.samePage('https://a.example/x', 'https://a.example/y'), G.samePage(null, null)], [true, false, false]);

/* ------------------------------------------------------------------ the keys: never one the browser keeps, never while typing */
const K = require(`${OUT}keys.js`);
const press = (more) => ({ key: '', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, typing: false, ...more });
assert.deepEqual(K.seeingKey(press({ key: '/' })), { do: 'box' });
assert.equal(K.seeingKey(press({ key: '/', typing: true })), null, 'a / typed in a box is a /');
assert.deepEqual([K.seeingKey(press({ altKey: true, code: 'KeyN', typing: true })), K.seeingKey(press({ altKey: true, code: 'KeyW' })), K.seeingKey(press({ altKey: true, code: 'Digit3' }))], [{ do: 'new' }, { do: 'close' }, { do: 'tab', index: 2 }]);
for (const theirs of [{ ctrlKey: true, code: 'KeyW' }, { ctrlKey: true, code: 'KeyT' }, { ctrlKey: true, code: 'KeyL' }, { altKey: true, code: 'KeyD' }, { altKey: true, code: 'Digit9' }, { altKey: true, shiftKey: true, code: 'KeyN' }, { metaKey: true, key: '/' }]) {
  assert.equal(K.seeingKey(press(theirs)), null, `the browser's own: ${JSON.stringify(theirs)}`);
}

/* ------------------------------------------------------------------ search: an address or words, and to whom */
const Q = require(`${OUT}search.js`);
const box = (text, choices = Q.CHOICES_AT_FIRST) => Q.readBox(text, choices);
for (const [typed, address] of [['example.com', 'https://example.com/'], ['https://example.com/a b', 'https://example.com/a%20b'], ['example.com/a?b=c d'.replace(' ', '%20'), 'https://example.com/a?b=c%20d'], ['bbc.co.uk/news', 'https://bbc.co.uk/news'], ['example.com:8080/x', 'https://example.com:8080/x'], ['93.184.216.34', 'https://93.184.216.34/'], ['b\u00fccher.example', 'https://xn--bcher-kva.example/'], ['\u0645\u062b\u0627\u0644.\u0625\u062e\u062a\u0628\u0627\u0631', new URL('https://\u0645\u062b\u0627\u0644.\u0625\u062e\u062a\u0628\u0627\u0631').href], ['see:test', 'see:test'], ['readme.md/x', 'https://readme.md/x']]) assert.deepEqual(box(typed), { kind: 'address', address }, typed);
for (const words of ['localhost', 'c++', 'what is 1.5', '1.5', 'a.b', 'node.js', 'notes.txt', 'hello', 'and/or', 'who@example.com', 'example.com is down', 'javascript: the good parts', 'q?', '...', 'a..b.com', '-x.com', '\u65e5\u672c\u8a9e \u6771\u4eac', 'cats & dogs', '100%']) assert.deepEqual([box(words).kind, box(words).words], ['search', words], words);
for (const refused of ['javascript:alert(1)', 'file:///c:/', 'data:text/html,x', 'chrome://settings', 'mailto:a@b.c', 'https://a:b@example.com/', 'about:blank', 'localhost:3000', 'ftp://x.com']) assert.equal(box(refused).kind, 'refused', refused);
assert.equal(box('  ').kind, 'nothing');
assert.equal(box('!').kind, 'list');
assert.equal(box('\u202eexample.com').address, 'https://example.com/', 'nothing that turns a line round is kept');
for (const [typed, id, words] of [['g fog horn', 'google', 'fog horn'], ['!b fog', 'bing', 'fog'], ['W  fog', 'wikipedia', 'fog'], ['m films', 'media', 'films'], ['s posts', 'debaser', 'posts'], ['x fog', 'duckduckgo', 'x fog']]) assert.deepEqual([box(typed).engine.id, box(typed).words], [id, words], typed);
assert.equal(box('g fog', { ...Q.CHOICES_AT_FIRST, off: ['google'] }).engine.id, 'duckduckgo', 'one that is off has no letters');
assert.equal(box('!g fog', { ...Q.CHOICES_AT_FIRST, off: ['google'] }).engine.id, 'google', 'unless it is named outright');
assert.equal(new Set(Q.ENGINES.map((each) => each.id)).size, Q.ENGINES.length);
assert.equal(new Set(Q.ENGINES.map((each) => each.short)).size, Q.ENGINES.length, 'no letters twice');
for (const awkward of ['a&b=c', 'x#y', '100%', '"quoted" \'words\'', '\ud83c\udf0a wave', '\u65e5\u672c\u8a9e', '$& $1 %s', 'a/b?c', '<script>', 'broken \ud83c half']) {
  for (const engine of Q.ENGINES.filter((each) => each.opens !== 'site')) {
    const address = Q.searchAddress(engine, awkward);
    const url = new URL(address);
    assert.equal(url.hostname, new URL(engine.address).hostname, engine.id);
    assert.equal(url.hash, '', `${engine.id}: ${awkward}`);
    assert.ok(readAddress(address).ok);
    const asked = Q.askedOf(address, Q.CHOICES_AT_FIRST);
    assert.deepEqual([asked.engine.id, asked.words], [engine.id, Q.cleanWords(awkward)], `${engine.id} is asked for exactly the words`);
  }
}
assert.equal(Q.askedOf('https://en.wikipedia.org/wiki/Fog', Q.CHOICES_AT_FIRST), null);
assert.equal(Q.askedOf('https://www.google.com/search?q=', Q.CHOICES_AT_FIRST), null);
const madeOwn = Q.ownEngine(' My  engine ', 'https://find.example.com/?q=%s', 'own-1');
assert.deepEqual([madeOwn.name, madeOwn.opens, madeOwn.group], ['My engine', 'here', 'YOURS']);
for (const bad of ['http://find.example.com/?q=%s', 'https://find.example.com/', 'https://find.example.com/?q=%s&r=%s', 'https://%s.example.com/', 'https://a:b@find.example.com/?q=%s', 'https://localhost/?q=%s', 'https://192.168.0.154/?q=%s', 'https://127.0.0.1/?q=%s', 'https://[::1]/?q=%s', 'https://2130706433/?q=%s', 'https://0x7f.1/?q=%s', 'https://jellyfin.local/?q=%s', 'https://box.tail1234.ts.net/?q=%s', 'https://api.debaser.site/?q=%s', 'https://find.example.com:8096/?q=%s', 'https://router/?q=%s', 'javascript:%s', '']) assert.equal(typeof Q.ownEngine('x', bad, 'own-1'), 'string', `${bad} can not be added`);
assert.equal(typeof Q.ownEngine('', 'https://find.example.com/?q=%s', 'own-1'), 'string');
const kept_ = Q.choicesFrom(JSON.parse(JSON.stringify({ chosen: 'own-1', off: ['google', 'nonsense'], order: ['bing'], all: ['bing', 'mojeek', 'wiby', 'brave'], own: [{ id: 'own-1', name: 'Mine', address: 'https://find.example.com/?q=%s', opens: 'site', short: 'g' }, { id: 'own-2', name: 'Bad', address: 'https://192.168.0.1/?q=%s' }, { id: 'google', name: 'Not Google', address: 'https://evil.example.com/?q=%s' }] })));
assert.deepEqual([kept_.chosen, kept_.off, kept_.all, kept_.own.map((each) => [each.id, each.opens, each.short])], ['own-1', ['google'], ['bing', 'mojeek', 'wiby'], [['own-1', 'here', '']]]);
assert.deepEqual(Q.choicesFrom('x'), Q.CHOICES_AT_FIRST);
assert.equal(Q.enginesOf(kept_)[0].id, 'bing');
const up = Q.moved(Q.CHOICES_AT_FIRST, 'bing', -1);
assert.deepEqual(Q.enginesOf(up).slice(0, 3).map((each) => each.id), ['duckduckgo', 'bing', 'google']);
assert.equal(Q.moved(Q.CHOICES_AT_FIRST, 'duckduckgo', -1), Q.CHOICES_AT_FIRST);
assert.deepEqual(Q.enginesOf(Q.moved(Q.CHOICES_AT_FIRST, 'wiby', 1)).filter((each) => each.group === 'GENERAL').map((each) => each.id), Q.ENGINES.filter((each) => each.group === 'GENERAL').map((each) => each.id), 'and only within its own group');
assert.match(Q.sayBox(box('fog')), /^SEARCH DUCKDUCKGO FOR fog$/);
assert.match(Q.sayBox(box('g fog')), /GOOGLE FOR fog ↗$/);
assert.match(Q.sayBox(box('example.com')), /^GO TO https:\/\/example\.com\/$/);

/* ------------------------------------------------------------------ the built-in pages and the module */
const browser = MODULES.find((module) => module.key === 'browser');
assert.deepEqual({ label: browser.label, href: browser.href, wip: browser.wip }, { label: 'BROWSER', href: '/browser', wip: true });
assert.equal(moduleIsOn(browser, NO_CHOICES), false, 'off the bar until ticked');

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
}
for (const file of [...files('app/lib/seeing'), ...files('app/components/seeing'), 'app/browser/page.tsx']) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // (2026-11-23, on purpose) What keeps the extension up to date asks for the build's own list and files, and nothing else.
  if (file.endsWith('/extension-store.ts')) assert.deepEqual([...source.matchAll(/\bfetch\(([^,]+),/g)].map((each) => each[1]), ["'/api/extension/list'", '`/api/extension/file/${encodeURIComponent(name)}?v=${sha256}`']);
  // The page asks our own routes, and BILLBOARD the art: nothing else in the browser reaches anywhere. (Phase 2, 2026-11-23: it was nothing at all.)
  if (!file.startsWith('app/lib/seeing/server/') && !/\/(?:hook|server-engine|billboards|extension-store)\.ts$/.test(file)) assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(source), `${file} fetches nothing`);
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
