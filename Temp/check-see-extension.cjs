/*
 * BROWSER's extension, OWN EYE (SPEC-seeing-machine.md, D1 and phase 4; Luke 2026-11-23), read as files and its pure parts run. (In a real
 * browser: scripts/drive-see-extension.cjs.)
 *   npx tsc app/lib/seeing/own-eye.ts app/lib/seeing/extension.ts app/lib/seeing/server/extension-files.ts app/lib/seeing/server/sign-ins.ts app/lib/ui/themes.ts --rootDir app --outDir Temp/see-extension-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-see-extension.cjs
 *
 * - it asks for no site when it is put in, and for none of the browser's private things (cookies, history, webRequest, debugger, tabs)
 * - only https://debaser.site may speak to it, and only to say eight things, none answered with a site or a page; a theme is colours and nothing else
 * - a change to it comes with a new version (extension-versions.json), and what the site serves of it is these files and no others
 * - the site's updater (2026-11-23): nothing is written unless every file is proved, only in its own folder, and a failure leaves the old one
 * - the header rule is for frames made by its own page, of added sites, never a sign-in, and goes with the session
 * - its never-framed list is the server's own, and its id is the one the site asks for
 * - no remote code, no cookies, no passwords, no markup written from a page's words
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// (2026-11-27) Its icons are pictures, read as they are; the rest are words, whatever the machine does with line ends.
const read = (file) => (file.endsWith('.png') ? fs.readFileSync(path.join(ROOT, 'extension', file)) : fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8').replace(/\r\n/g, '\n'));
const asText = (contents) => (typeof contents === 'string' ? contents : new TextDecoder().decode(contents));
const files = fs.readdirSync(path.join(ROOT, 'extension'));
const manifest = JSON.parse(read('manifest.json'));

assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'declarativeNetRequestWithHostAccess', 'scripting', 'sidePanel', 'storage'], 'nothing that reads cookies, history, other tabs or requests');
assert.equal(manifest.host_permissions, undefined, 'no site until it is added');
// (2026-11-27) IMPORT FROM THIS BROWSER reads the browser's history once, on a press, and gives the leave back at once.
assert.deepEqual(manifest.optional_permissions, ['history'], 'nothing else to ask for later');
assert.ok(read('machine.js').includes("await chrome.permissions.remove({ permissions: ['history'] }).catch(() => undefined);") && !/chrome\.history/.test(read('worker.js') + read('panel.js') + read('act.js')), 'given back after the one read, and read nowhere else');
assert.equal(manifest.content_scripts, undefined, 'and on no page until it is asked');
// (2026-11-27) and in one of BROWSER's tabs on debaser.site, where OWN EYE shows a page in a frame too.
assert.equal(read('frame.js').replace(/^\/\*[\s\S]*?\*\/\n/, ''), "if (window !== window.top && window.parent === window.top && (location.ancestorOrigins[0] === 'chrome-extension://' + chrome.runtime.id || location.ancestorOrigins[0] === 'https://debaser.site')) {\n  chrome.runtime.sendMessage({ see: 'frame', href: location.href, title: document.title.slice(0, 160) }).catch(() => undefined);\n}\n", "what runs on an added site says where it is, in the machine's frame or BROWSER's, and nothing else");
// (2026-11-27, the review) and only its top frame: debaser.site framed inside another site's tab must not unlock frames in that tab.
assert.ok(read('worker.js').includes("if (port.name !== 'browser' || port.sender?.origin !== SITE || tab === undefined || port.sender?.frameId !== 0) return port.disconnect();"), "only debaser.site's own page, its top frame, holds a tab open for frames");
// (2026-11-27, the review) asks about a site go one at a time, so asks at once can't overrun the hour's few.
assert.ok(/let asking = Promise\.resolve\(\);\nfunction mayAsk\(site\) \{\n  const turn = asking\.then\(\(\) => mayAskNow\(site\)\);/.test(read('worker.js')), 'asks about sites go one at a time');
assert.ok(read('worker.js').includes("const ours = [...browsers].filter(([, tab]) => tab === sender.tab.id);") && read('worker.js').includes("for (const [port] of ours) port.postMessage"), "and where a framed page got to goes to that tab's page alone");
// (2026-11-27) a lens asked for by BROWSER's page is worn on the page framed in that tab only, and only one the extension has.
assert.ok(read('worker.js').includes("if (message?.see !== 'lens' || !LENS_IDS.includes(message.lens)) return;") && read('worker.js').includes('await putLens({ tabId: tab, frameIds: [frameId] }, lens)'), 'a lens on the framed page in that tab, of the lenses it has');
assert.deepEqual(manifest.externally_connectable, { matches: ['https://debaser.site/*'] });
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'; object-src 'none'/);
const id = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const ownEye = require('./see-extension-out/lib/seeing/own-eye.js');
assert.equal(ownEye.EXTENSION_ID, id, 'the site asks for the extension with this key');
assert.ok(read('README.md').includes(id));

for (const file of files) {
  if (file.endsWith('.png')) continue;
  const text = read(file);
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(text), file);
  if (!/\.(?:js|html)$/.test(file)) continue;
  assert.ok(!/document\.cookie|chrome\.cookies|type=["']?password|\.value\b.*password|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|importScripts|XMLHttpRequest|\bfetch\(|WebSocket/i.test(text), `${file}: no cookies, passwords, markup from words, remote code or requests of its own`);
  for (const src of text.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(!/^https?:|^\/\//.test(src[1]), file);
}
const worker = read('worker.js');
assert.deepEqual([...worker.matchAll(/message\.see === '(\w+)'/g)].map((each) => each[1]).slice(0, 8), ['ping', 'theme', 'open', 'has', 'settings', 'sites', 'newest', 'reload']);
// (2026-11-27) `has`: whether the one page it is asked about is on the list, and no more than a few sites asked about: never the list.
assert.ok(worker.includes('void mayAsk(site).then(async (may) => answer(may ? { on: await isAllowed(read), site } : { on: null }));'), 'whether the one page is on the list, and nothing else');
assert.ok(/if \(asked\.sites\.length >= ASKED_MOST\) return false;/.test(worker) && /chrome\.storage\.session\.set\(\{ asked \}\)/.test(worker), 'a few sites an hour, counted while the browser is open, not while the worker is awake');
const external = worker.slice(worker.indexOf('onMessageExternal'), worker.indexOf('chrome.runtime.onMessage.addListener'));
assert.ok(!/allowedSites|chrome\.tabs\.query|chrome\.permissions|\bpages?\b.*answer/.test(external), 'the site is never told a site or a page');
// Its whole contents, whatever the machine does with line ends.
const whole = crypto.createHash('sha256');
for (const file of [...files].sort()) whole.update(file + '\n').update(read(file)).update('\n');
const now = whole.digest('hex');
const versions = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension-versions.json'), 'utf8'));
assert.equal(versions[manifest.version], now, `the extension changed: give it a new version in its manifest, and add "${manifest.version}": "${now}" to extension-versions.json (a version already there is never changed)`);
try {
  const published = JSON.parse(require('node:child_process').execFileSync('git', ['show', 'origin/main:extension-versions.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  for (const [version, hash] of Object.entries(published)) assert.equal(versions[version], hash, `${version} is out in the world already: what changed needs a new version`);
} catch (error) {
  if (error.code === 'ERR_ASSERTION') throw error;
}
assert.match(worker, /sender\.origin !== 'https:\/\/debaser\.site'\) return;/, 'who is speaking is asked first');
// (2026-11-27, on purpose) BROWSER's own tab on debaser.site may frame an added site too, asked for by that page or the site itself.
assert.ok(worker.includes('condition: { tabIds, initiatorDomains: [chrome.runtime.id, new URL(SITE).hostname, ...sites], requestDomains: sites, excludedRequestDomains'), "only in the machine's own tabs and BROWSER's, only added sites");
assert.ok(worker.includes('sites.length === 0 || tabIds.length === 0 ? [] :') && worker.includes('const tabIds = [...new Set([...machines.values(), ...browsers.values()])];'), 'and no rule at all with no machine and no BROWSER open');
assert.match(worker, /port\.sender\?\.url\?\.startsWith\(chrome\.runtime\.getURL\('machine\.html'\)\) !== true/, "a tab is the machine's only while the machine's own page is in it");
assert.ok(!/updateDynamicRules|rule_resources/.test(worker + JSON.stringify(manifest)), 'the rule lasts as long as the browser is open');
assert.match(read('machine.html'), /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"/, 'a site in the frame cannot move the machine');
assert.ok(!/allow-top-navigation/.test(read('machine.html')));

(async () => {
  // What the site serves of it.
  const served = require('./see-extension-out/lib/seeing/server/extension-files.js');
  const E = require('./see-extension-out/lib/seeing/extension.js');
  process.chdir(ROOT);
  assert.deepEqual([...served.EXTENSION_FILES].sort(), [...files].sort(), 'every file of it, and no other');
  const list = await served.extensionList();
  assert.deepEqual(E.listFrom(JSON.parse(JSON.stringify(list))), list);
  assert.equal(list.version, manifest.version);
  for (const { name, size, sha256 } of list.files) assert.deepEqual([size, sha256], [Buffer.byteLength(read(name)), crypto.createHash('sha256').update(read(name)).digest('hex')], name);
  for (const bad of ['../package.json', 'manifest.json/..', '.env.local', 'nothing.js', '']) assert.equal(await served.extensionFile(bad), null, bad);
  const zip = await served.extensionZip();
  assert.equal(zip.name, `debaser-extension-${manifest.version}.zip`);
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'see-zip-'));
  fs.writeFileSync(path.join(dir, 'it.zip'), zip.bytes);
  // Opened by Windows' own unzip, not by our reading of the format.
  if (process.platform === 'win32') {
    require('node:child_process').execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(dir, 'it.zip')}' -DestinationPath '${path.join(dir, 'out')}'`]);
    for (const file of files) assert.ok(fs.readFileSync(path.join(dir, 'out', 'debaser-extension', file)).equals(Buffer.from(read(file))), `${file} comes out as it went in`);
  }
  // (2026-11-27) The stores' copy: the same files, its manifest without the key (a store gives its own id).
  const storeZip = await served.extensionZip(true);
  assert.equal(storeZip.name, `debaser-extension-store-${manifest.version}.zip`);
  fs.writeFileSync(path.join(dir, 'store.zip'), storeZip.bytes);
  if (process.platform === 'win32') {
    require('node:child_process').execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(dir, 'store.zip')}' -DestinationPath '${path.join(dir, 'store')}'`]);
    const { key: _key, ...rest } = manifest;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'store', 'debaser-extension', 'manifest.json'), 'utf8')), rest, "the store's manifest is the same but for the key");
    for (const file of files) if (file !== 'manifest.json') assert.ok(fs.readFileSync(path.join(dir, 'store', 'debaser-extension', file)).equals(Buffer.from(read(file))), `${file} in the store's copy`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  // (2026-11-27) The version before this one, so a store's copy one behind is let be: from the record of versions, in order.
  const versions = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'extension-versions.json'), 'utf8')));
  assert.equal(list.previous, versions[versions.indexOf(manifest.version) - 1], 'the version before');
  assert.equal(E.listFrom({ ...list, previous: '<b>' }).previous, undefined, 'and only a version');
  // The stores' ids: empty until Luke sends them, and then an id's shape (32 letters a to p), nothing else.
  const ids = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'seeing', 'extension-ids.ts'), 'utf8');
  for (const name of ['CHROME_STORE_ID', 'EDGE_STORE_ID']) assert.match(ids, new RegExp(`export const ${name} = '(?:[a-p]{32})?';`), name);
  for (const bad of [null, {}, { ...list, version: 'x' }, { ...list, files: [] }, { ...list, files: [{ ...list.files[0], name: '../x.js' }] }, { ...list, files: [{ ...list.files[0], name: 'a/b.js' }] }, { ...list, files: [...list.files, list.files[0]] }, { ...list, files: list.files.filter((each) => each.name !== 'manifest.json') }, { ...list, files: list.files.map((each) => ({ ...each, sha256: 'x' })) }, { ...list, files: list.files.map((each) => ({ ...each, name: each.name.replace('.js', '.exe') })) }]) assert.equal(E.listFrom(bad), null, JSON.stringify(bad)?.slice(0, 80));
  for (const [one, other, is] of [['0.2.0', '0.1.0', true], ['0.1.0', '0.2.0', false], ['0.10.0', '0.9.9', true], ['1.0', '1.0.0', false], ['1.0.0.1', '1.0', true]]) assert.equal(E.isNewer(one, other), is, one);
  // (2026-11-27) A store's copy one version behind is let be while the store checks the new one; older, or the zip's, still updates first.
  const judged = { version: '0.7.1', previous: '0.7.0', files: [] };
  for (const [found, kind, checking] of [
    [null, 'missing', false],
    [{ version: '0.7.1', from: 'zip' }, 'current', false],
    [{ version: '0.7.0', from: 'zip' }, 'old', false],
    [{ version: '0.7.0', from: 'chrome' }, 'current', true],
    [{ version: '0.7.0', from: 'edge' }, 'current', true],
    [{ version: '0.6.0', from: 'chrome' }, 'old', false],
    [{ version: '0.7.1', from: 'edge' }, 'current', false],
  ]) assert.deepEqual(E.judgeVersion(found, judged), { kind, checking }, JSON.stringify(found));
  assert.deepEqual(E.judgeVersion({ version: '0.7.0', from: 'chrome' }, { ...judged, previous: undefined }), { kind: 'old', checking: false }, 'not knowing the version before: old');
  assert.equal(await E.idOfKey(manifest.key), id);
  assert.equal(await E.idOfKey('not a key!'), null);
  // (2026-11-27, Luke: "generate a text icon for debaser") Its icons: the manifest names them, each a PNG of its size, and the list carries them.
  const sizes = { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' };
  assert.deepEqual(manifest.icons, sizes);
  assert.deepEqual(manifest.action.default_icon, { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png' });
  for (const [size, file] of Object.entries(sizes)) {
    const png = read(file);
    assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === Number(size) && png.readUInt32BE(20) === Number(size), `${file} is a ${size} x ${size} PNG`);
  }
  assert.equal(list.files.filter((each) => each.name.endsWith('.png')).length, 4, 'and the list carries all four, byte for byte');

  // The updater, on a pretend folder: the last version in it, with one file changed.
  const bytesOf = (text) => (typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text));
  const folderOf = (holds, trouble = {}) => {
    const disk = new Map(Object.entries(holds).map(([name, text]) => [name, bytesOf(text)]));
    let closes = 0;
    return {
      disk,
      name: 'debaser-extension',
      removeEntry: async (name) => void disk.delete(name),
      getFileHandle: async (name, { create = false } = {}) => {
        if (!create && !disk.has(name)) throw new Error('NotFoundError');
        // As a browser does: a file that is made is there, empty, before it is written.
        if (!disk.has(name)) disk.set(name, new Uint8Array());
        return {
          getFile: async () => ({ size: disk.get(name).byteLength, arrayBuffer: async () => disk.get(name).slice().buffer }),
          createWritable: async () => {
            if (trouble.open === name) throw new Error('NotAllowedError');
            let held = new Uint8Array();
            return {
              write: async (data) => { if (trouble.write === name) throw new Error('QuotaExceededError'); held = data; },
              close: async () => { closes += 1; if (trouble.close === closes) throw new Error('AbortError'); disk.set(name, held); },
              abort: async () => undefined,
            };
          },
        };
      },
    };
  };
  const text = (folder) => Object.fromEntries([...folder.disk].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]));
  const oldFiles = Object.fromEntries(files.map((file) => [file, file === 'manifest.json' ? read(file).replace(manifest.version, '0.0.9') : `old ${file}`]));
  oldFiles['mine.txt'] = 'a file of the reader\'s own';
  const fetched = async (name) => bytesOf(read(name));
  const good_ = folderOf(oldFiles);
  assert.deepEqual(await E.writeUpdate(good_, list, fetched), { ok: true });
  assert.deepEqual(text(good_), { ...Object.fromEntries(files.map((file) => [file, asText(read(file))])), 'mine.txt': oldFiles['mine.txt'] }, "the build's files, and nothing else touched");
  const unchanged = async (folder, fetching, why) => {
    const answer = await E.writeUpdate(folder, list, fetching);
    assert.equal(answer.ok, false, why);
    assert.deepEqual(text(folder), folder.was, `${why}: the old one is as it was`);
    return answer.reason;
  };
  const make = (holds, trouble) => Object.assign(folderOf(holds, trouble), { was: holds });
  assert.match(await unchanged(make({ 'manifest.json': JSON.stringify({ key: 'AAAA' }) }), fetched, 'another extension'), /ISN'T THE EXTENSION'S FOLDER/);
  assert.match(await unchanged(make({ 'a.txt': 'x' }), fetched, 'a folder with no manifest'), /ISN'T/);
  assert.match(await unchanged(make({ 'manifest.json': 'not json' }), fetched, 'a manifest that is not one'), /ISN'T/);
  assert.match(await unchanged(make(oldFiles), async (name) => (name === 'worker.js' ? bytesOf(read(name) + ' ') : fetched(name)), 'a tampered file'), /worker\.js IS NOT WHAT IT SHOULD BE/);
  assert.match(await unchanged(make(oldFiles), async (name) => (name === 'sites.js' ? bytesOf('x'.repeat(read(name).length)) : fetched(name)), 'the right size and the wrong words'), /sites\.js IS NOT/);
  assert.match(await unchanged(make(oldFiles), async (name) => (name === 'lens.js' ? null : fetched(name)), 'a file that does not come'), /DID NOT COME/);
  assert.match(await unchanged(make(oldFiles), async () => { throw new Error('offline'); }, 'no line'), /DID NOT COME/);
  assert.match(await unchanged(make(oldFiles, { open: 'panel.js' }), fetched, 'no leave to write'), /WOULDN'T WRITE/);
  assert.match(await unchanged(make(oldFiles, { write: 'manifest.json' }), fetched, 'no room'), /WOULDN'T WRITE/);
  const fewer = Object.fromEntries(Object.entries(oldFiles).filter(([name]) => name !== 'sites.js'));
  assert.match(await unchanged(make(fewer, { write: 'manifest.json' }), fetched, 'a file that is new in this version'), /WOULDN'T WRITE/);
  assert.match(await unchanged(make(fewer, { close: files.length }), fetched, 'the same, stopped at the last swap'), /PUT BACK/);
  for (const close of [1, 4, files.length]) assert.match(await unchanged(make(oldFiles, { close }), fetched, `stopped at swap ${close}`), /THE OLD ONE WAS PUT BACK/);
  // (2026-11-27) The first time, into a folder the reader picks: written whole when it is empty, and never over anything of the reader's.
  const listed = (folder) => Object.assign(folder, { keys: async function* () { yield* [...folder.disk.keys()]; } });
  const fresh_ = listed(folderOf({ 'desktop.ini': '[the computer]' }));
  assert.deepEqual(await E.writeUpdate(fresh_, list, fetched, true), { ok: true });
  assert.deepEqual(text(fresh_), { ...Object.fromEntries(files.map((file) => [file, asText(read(file))])), 'desktop.ini': '[the computer]' }, 'into an empty folder, the build whole');
  for (const [holds, why] of [[{ 'mine.txt': 'x' }, "a folder of the reader's"], [{ 'manifest.json': JSON.stringify({ key: 'AAAA' }) }, "another extension's folder"]]) {
    const folder = listed(make(holds));
    assert.match((await E.writeUpdate(folder, list, fetched, true)).reason ?? '', /ISN'T EMPTY/, why);
    assert.deepEqual(text(folder), holds, `${why}: nothing written`);
  }
  assert.match((await E.writeUpdate(make({}), list, fetched, true)).reason ?? '', /ISN'T EMPTY/, "a folder that can't be looked into is not taken for empty");
  assert.deepEqual(await E.writeUpdate(listed(folderOf(oldFiles)), list, fetched, true), { ok: true }, 'its own folder (a zip loaded before) is written as an update');
  assert.equal(await E.isEmptyFolder(listed(folderOf({ 'Thumbs.db': 'x', '.DS_Store': 'x' }))), true);

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
  const pure = (name) => new Function(`${new RegExp(`export (function ${name}[\\s\\S]*?\\n\\})`).exec(worker)[1]} return ${name};`)();
  const settingsFrom = pure('settingsFrom');
  assert.deepEqual(settingsFrom({ lens: 'reader', wear: false, sites: ['x'] }), { lens: 'reader', wear: false });
  for (const bad of [null, 'x', {}, { lens: 'x', wear: true }, { lens: 'reader', wear: 'yes' }]) assert.equal(settingsFrom(bad), null);
  assert.deepEqual(ownEye.OWN_EYE_LENSES.map(([each]) => each), ['standard', 'reader', 'xray', 'lowfi', 'yours']);
  const newer = pure('newer');
  for (const [one, other, is] of [['0.3.0', '0.2.0', true], ['0.2.0', '0.2.0', false], ['<b>', '0.1', false], ['9', '10', false], ['0.10', '0.9', true]]) assert.equal(newer(one, other), is, one);
  console.log(`the extension: no site until it is added, ${sites.NEVER_HOSTS.length + sites.NEVER_NAMES.length} never framed, ${THEMES.length} themes worn`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
