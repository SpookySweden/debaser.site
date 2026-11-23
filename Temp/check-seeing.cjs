/*
 * BROWSER, the DEBASER SEEING MACHINE, Phase 1 (SPEC-seeing-machine.md, Luke 2026-11-23): the pure parts of the shell.
 * (scripts/drive-see.cjs drives the page itself in a browser, on every theme.)
 *   npx tsc app/lib/seeing/address.ts app/lib/seeing/tabs.ts app/lib/seeing/frame.ts app/lib/seeing/test-engine.ts app/lib/seeing/lenses/registry.ts app/lib/ui/modules.ts --rootDir app --outDir Temp/seeing-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-seeing.cjs
 *
 * - an address: http and https only, no user names or passwords, no control characters, bare names get https, words are refused
 * - an address travels after the `#` and never in the path or the query; a bad one there is nothing
 * - tabs: eight at most, back and forward per tab, a visit forgets what was ahead, closing the last leaves a new one, fifty stops,
 *   stored and read back through one door (junk dropped, a javascript: stop dropped, drafts never stored)
 * - a page's title is plain text: no control or direction-changing characters, cut short
 * - the frame: `allow-scripts` and nothing more, default-src 'none', our one script by its nonce, messages read as a stranger's
 * - READER's words and links read 4.5:1 on their paper, on every theme and all four papers; WATCHERS' inks too; STANDARD wears nothing
 * - BROWSER is a module: off until ticked, WIP, and nothing in Phase 1's files fetches anything
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = './seeing-out/lib/seeing/';
const { readAddress, addressInHash, browserHref, shortName } = require(`${OUT}address.js`);
const T = require(`${OUT}tabs.js`);
const F = require(`${OUT}frame.js`);
const { testEngine, engineFor } = require(`${OUT}test-engine.js`);
const { lensById, lensOr } = require(`${OUT}lenses/registry.js`);
const { readerColours } = require(`${OUT}lenses/reader.js`);
const { PAPERS, TEXT_SIZES } = require(`${OUT}lenses/lens.js`);
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
const doc = F.frameDocument('<p>hello</p>', 'NONCE', 'https://debaser.site');
assert.match(doc, /default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-NONCE'; base-uri 'none'; form-action 'none'/);
assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script'), 'the policy comes before any script');
assert.equal((doc.match(/<script/g) ?? []).length, 1);
assert.ok(doc.includes('"https://debaser.site"'), 'its messages go to the site alone');
assert.ok(!F.frameDocument('', 'N', 'https://x.example/</script><script>').slice(doc.indexOf('<script')).includes('</script><script>'), 'nothing written into our script can close it');
const viewport = fs.readFileSync(path.join(ROOT, 'app/components/seeing/SeeingViewport.tsx'), 'utf8');
assert.match(viewport, /sandbox=\{FRAME_SANDBOX\}/);
assert.match(viewport, /event\.source !== frame\.current\.contentWindow\) return;\s*\n\s*const message = readFrameMessage/, 'only the frame in front is heard, and before its words are read');
for (const data of [null, 5, 'ready', [], {}, { see: 'go' }, { see: 'open' }, { see: 'open', address: 5 }, { see: 'open', address: '' }, { see: 'open', address: 'x'.repeat(5000) }]) assert.equal(F.readFrameMessage(data), null, JSON.stringify(data)?.slice(0, 60));
assert.deepEqual(F.readFrameMessage({ see: 'open', address: 'https://a.example/', newTab: 'yes', extra: 1 }), { see: 'open', address: 'https://a.example/', newTab: false });
assert.deepEqual(F.readFrameMessage({ see: 'ready', css: 'x' }), { see: 'ready' });

/* ------------------------------------------------------------------ lenses, on every theme */
assert.deepEqual(LENS_NAMES.filter((lens) => lensById(lens.id) !== null).map((lens) => lens.id), ['standard', 'reader', 'watchers']);
assert.equal(lensOr('xray').id, 'standard', 'a lens that is not built draws STANDARD');
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
      const look = { tokens: theme.tokens, scheme: theme.scheme, face: 'monospace', reader: { paper, size } };
      const css = lensById('reader').css(look);
      for (const colour of [colours.paper, colours.ink, colours.link]) assert.ok(css.includes(colour), `${theme.id} ${paper}: ${colour} is in the stylesheet`);
      assert.ok(!/undefined|NaN|url\(|@import|expression/.test(css), css);
      assert.equal(lensById('standard').css(look), '', 'STANDARD wears nothing');
    }
  }
  const t = theme.tokens;
  reads(t.ink, t.paper, `${theme.id} WATCHERS`);
  reads(t['ink-quiet'], t.paper, `${theme.id} WATCHERS host`);
  reads(t['ink-bar'], t['bubble-pale'], `${theme.id} refused chip`);
  reads(t.paper, t.ink, `${theme.id} the tab in front`);
  reads(t['accent-ink'], t.paper, `${theme.id} keys`);
}

/* ------------------------------------------------------------------ the built-in pages and the module */
const browser = MODULES.find((module) => module.key === 'browser');
assert.deepEqual({ label: browser.label, href: browser.href, wip: browser.wip }, { label: 'BROWSER', href: '/browser', wip: true });
assert.equal(moduleIsOn(browser, NO_CHOICES), false, 'off the bar until ticked');

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
}
for (const file of [...files('app/lib/seeing'), ...files('app/components/seeing'), 'app/browser/page.tsx']) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Phase 1 fetches nothing. Phase 2 takes this line out on purpose, when the server's eye arrives.
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(source), `${file} fetches nothing`);
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(source), `${file} puts no markup in the site's own page`);
}

(async () => {
  const steps = [];
  const answer = await testEngine.open('see:test', (step) => steps.push(step), new AbortController().signal);
  assert.ok(answer.ok && answer.document.reading.length > 0);
  assert.deepEqual(steps, ['ACQUIRING SOURCE']);
  assert.equal(answer.document.files + answer.document.refused, 0, 'no made-up counts');
  assert.equal((await testEngine.open('see:nowhere', () => {}, new AbortController().signal)).ok, false);
  assert.equal(engineFor('https://example.com/').name, 'NO EYE');
  const outside = await engineFor('https://example.com/').open('https://example.com/', () => {}, new AbortController().signal);
  assert.equal(outside.ok, false, 'nothing outside opens in Phase 1');
  console.log(`BROWSER: addresses, tabs, the frame, ${pairs} pairs over ${THEMES.length} themes, the module`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
