/*
 * BROWSER's extension, OWN EYE (SPEC-seeing-machine.md, D1 and phase 4; Luke 2026-11-23), read as files and its pure parts run. (In a real
 * browser: scripts/drive-see-extension.cjs.)
 *   npx tsc app/lib/seeing/own-eye.ts app/lib/seeing/server/sign-ins.ts app/lib/ui/themes.ts --rootDir app --outDir Temp/see-extension-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-see-extension.cjs
 *
 * - it asks for no site when it is put in, and for none of the browser's private things (cookies, history, webRequest, debugger, tabs)
 * - only https://debaser.site may speak to it, and only to say three things; a theme is colours and nothing else
 * - the header rule is for frames made by its own page, of added sites, never a sign-in, and goes with the session
 * - its never-framed list is the server's own, and its id is the one the site asks for
 * - no remote code, no cookies, no passwords, no markup written from a page's words
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8').replace(/\r\n/g, '\n');
const files = fs.readdirSync(path.join(ROOT, 'extension'));
const manifest = JSON.parse(read('manifest.json'));

assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'declarativeNetRequestWithHostAccess', 'scripting', 'sidePanel', 'storage'], 'nothing that reads cookies, history, other tabs or requests');
assert.equal(manifest.host_permissions, undefined, 'no site until it is added');
assert.equal(manifest.content_scripts, undefined, 'and on no page until it is asked');
assert.match(read('frame.js'), /^\/\*[\s\S]*?\*\/\nif \(window !== window\.top && window\.parent === window\.top && location\.ancestorOrigins\[0\] === 'chrome-extension:\/\/' \+ chrome\.runtime\.id\) \{\n  chrome\.runtime\.sendMessage\(\{ see: 'frame'[^\n]*\n\}\n$/, 'what runs on an added site says where it is, in the machine\'s frame, and nothing else');
assert.deepEqual(manifest.externally_connectable, { matches: ['https://debaser.site/*'] });
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'; object-src 'none'/);
const id = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const ownEye = require('./see-extension-out/lib/seeing/own-eye.js');
assert.equal(ownEye.EXTENSION_ID, id, 'the site asks for the extension with this key');
assert.ok(read('README.md').includes(id));

for (const file of files) {
  const text = read(file);
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(text), file);
  if (!/\.(?:js|html)$/.test(file)) continue;
  assert.ok(!/document\.cookie|chrome\.cookies|type=["']?password|\.value\b.*password|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|importScripts|XMLHttpRequest|\bfetch\(|WebSocket/i.test(text), `${file}: no cookies, passwords, markup from words, remote code or requests of its own`);
  for (const src of text.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(!/^https?:|^\/\//.test(src[1]), file);
}
const worker = read('worker.js');
assert.match(worker, /sender\.origin !== 'https:\/\/debaser\.site'\) return;/, 'who is speaking is asked first');
assert.match(worker, /condition: \{ tabIds, initiatorDomains: \[chrome\.runtime\.id, \.\.\.sites\], requestDomains: sites, excludedRequestDomains/, "only in the machine's own tabs, only added sites");
assert.match(worker, /sites\.length === 0 \|\| machines\.size === 0 \? \[\] :/, 'and no rule at all with no machine open');
assert.match(worker, /port\.sender\?\.url\?\.startsWith\(chrome\.runtime\.getURL\('machine\.html'\)\) !== true/, "a tab is the machine's only while the machine's own page is in it");
assert.ok(!/updateDynamicRules|rule_resources/.test(worker + JSON.stringify(manifest)), 'the rule lasts as long as the browser is open');
assert.match(read('machine.html'), /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"/, 'a site in the frame cannot move the machine');
assert.ok(!/allow-top-navigation/.test(read('machine.html')));

(async () => {
  // The pure parts, run as they are.
  const load = async (file) => import('data:text/javascript,' + encodeURIComponent(read(file).replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '')));
  const sites = await load('sites.js');
  const server = require('./see-extension-out/lib/seeing/server/sign-ins.js');
  assert.deepEqual(sites.NEVER_HOSTS, [...server.SIGN_IN_HOSTS], "the server's own list");
  assert.deepEqual(sites.NEVER_NAMES, [...server.SIGN_IN_NAMES, ...server.BANKS]);
  for (const address of ['https://accounts.google.com/signin', 'https://github.com/login', 'https://github.com/login?x', 'https://x.okta.com/', 'https://online.hsbc.co.uk/', 'nonsense']) assert.equal(sites.neverFramed(address), true, address);
  for (const address of ['https://github.com/loginov', 'https://www.google.com/', 'https://notokta.com/']) assert.equal(sites.neverFramed(address), false, address);
  for (const [address, refused] of [['https://accounts.google.com/', true], ['https://github.com/login', true], ['https://github.com/', false]]) assert.equal(server.refusesSignIn(new URL(address)) !== null, refused, 'and they say the same');
  assert.equal(sites.readAddress('example.com'), 'https://example.com/');
  for (const bad of ['javascript:alert(1)', 'file:///c:/', 'chrome://settings', 'https://a:b@example.com/', 'data:text/html,x', 'hello', 'chrome-extension://x/']) assert.equal(sites.readAddress(bad), null, bad);
  assert.deepEqual(sites.originsOf('example.com'), ['https://example.com/*', 'https://*.example.com/*', 'http://example.com/*', 'http://*.example.com/*']);
  assert.equal(sites.siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(sites.siteOf('a.alice.github.io'), 'alice.github.io', "one person's, not everybody's");
  assert.equal(sites.siteOf('192.168.1.1'), '192.168.1.1');
  assert.deepEqual(sites.originsOf('192.168.1.1'), ['https://192.168.1.1/*', 'http://192.168.1.1/*']);
  const themeFrom = new Function(`${/export (function themeFrom[\s\S]*?\n\})/.exec(worker)[1]} return themeFrom;`)();
  const { THEMES } = require('./see-extension-out/lib/ui/themes.js');
  for (const theme of THEMES) assert.deepEqual(themeFrom(ownEye.ownEyeTheme(theme.tokens, theme.scheme)), ownEye.ownEyeTheme(theme.tokens, theme.scheme), `${theme.id} is worn as it is`);
  const good = ownEye.ownEyeTheme(THEMES[0].tokens, 'dark');
  for (const bad of [null, {}, 'x', { ...good, paper: 'red;}*{background:url(x)' }, { ...good, ink: '#fff' }]) assert.equal(themeFrom(bad), null, 'a theme is colours and nothing else');
  console.log(`the extension: no site until it is added, ${sites.NEVER_HOSTS.length + sites.NEVER_NAMES.length} never framed, ${THEMES.length} themes worn`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
