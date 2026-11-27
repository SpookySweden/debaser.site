/*
 * BROWSER's extension, OWN EYE (SPEC-seeing-machine.md, phase 4), in a real browser with a throwaway profile, on pretend sites this script
 * serves: the files in extension/ as they are, but for the two pretend sites being already let (a browser's own "allow" box can't be pressed
 * by a script) and the local pretend site standing in for debaser.site. Signs in to nothing.
 *
 *   node scripts/drive-see-extension.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

let passed = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  passed += 1;
  console.log(`  ok  ${what}`);
};
const STORY = `<title>Shop</title><nav>menu</nav><article><h1>The shop</h1>${'<p>Words about the shop, with commas, and more words, so that there is a main text to be found here by the reader. </p>'.repeat(6)}</article><video src="/film.mp4" title="The film"></video><a href="/second">second</a>`;

(async () => {
  const asked = [];
  const server = http.createServer((request, answer) => {
    const host = request.headers.host.split(':')[0];
    asked.push({ host, url: request.url, cookie: request.headers.cookie ?? '' });
    const headers = { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };
    if (host === 'www.machinesite.test') return answer.writeHead(200, { 'content-type': 'text/html' }).end('<title>site</title><p>the site');
    if (request.url === '/signin') return answer.writeHead(200, { ...headers, 'set-cookie': 'strict=1; SameSite=Strict; Path=/' }).end('in');
    if (request.url === '/leave') return answer.writeHead(200, headers).end('<script>try { top.location.href = "http://www.shoptrial.test/escaped"; } catch (error) {}</script><p>leaving');
    if (request.url === '/second') return answer.writeHead(200, headers).end('<title>Second</title><h1>Second</h1>');
    return answer.writeHead(200, headers).end(`${STORY}<p id=cookie>${request.headers.cookie ?? 'signed out'}</p>`);
  });
  await new Promise((done) => server.listen(80, '127.0.0.1', done));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-own-eye-'));
  const extension = path.join(dir, 'extension');
  fs.cpSync(path.join(__dirname, '..', 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://shoptrial.test/*', 'https://*.shoptrial.test/*', 'http://shoptrial.test/*', 'http://*.shoptrial.test/*'];
  manifest.externally_connectable.matches = ['http://www.machinesite.test/*'];
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const swap = (file, from, to) => {
    const text = fs.readFileSync(path.join(extension, file), 'utf8');
    assert.ok(text.includes(from), `${file} holds ${from}`);
    fs.writeFileSync(path.join(extension, file), text.replaceAll(from, to));
  };
  swap('worker.js', 'https://debaser.site', 'http://www.machinesite.test');
  swap('act.js', 'https://debaser.site', 'http://www.machinesite.test');

  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), { executablePath: findChrome(), headless: false, viewport: { width: 1280, height: 800 }, args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP *.shoptrial.test 127.0.0.1, MAP *.machinesite.test 127.0.0.1', '--disable-features=DisableLoadExtensionCommandLineSwitch'], ignoreDefaultArgs: ['--disable-extensions'] });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    ok(id === require('node:fs').readFileSync(path.join(__dirname, '..', 'app/lib/seeing/own-eye.ts'), 'utf8').match(/EXTENSION_ID = '([a-p]{32})'/)[1], 'it wears the id the site asks for');
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log('  ..  page error:', error.message.slice(0, 200)));

    // The site speaking to it.
    await page.goto('http://www.machinesite.test/');
    const say = (message) => page.evaluate(([to, what]) => new Promise((done) => chrome.runtime.sendMessage(to, what, (answer) => done(answer ?? null))), [id, message]);
    ok((await say({ see: 'ping' }))?.see === 'pong', 'it answers the site');
    ok((await say({ see: 'theme', theme: { paper: 'url(x)' } }))?.ok === false, 'a theme that is not colours is refused');
    const theme = { paper: '#102030', ink: '#ffffff', accent: '#ffff00', quiet: '#eeeeee', fault: '#aa0000', faultInk: '#ffffff', sun: '#ffff00', scheme: 'dark' };
    ok((await say({ see: 'theme', theme }))?.ok === true, 'one that is, is worn');
    await page.goto('http://www.shoptrial.test/signin');
    ok((await page.evaluate(() => typeof chrome?.runtime?.sendMessage)) === 'undefined', 'no other site can speak to it');

    // The machine.
    const machine = async (address) => {
      await page.goto('about:blank');
      await page.goto(`chrome-extension://${id}/machine.html${address === undefined ? '' : `#see=${encodeURIComponent(address)}`}`);
      await page.waitForTimeout(1500);
    };
    const inner = () => page.frames().find((each) => each.parentFrame() === page.mainFrame());
    const status = () => page.locator('#status').innerText();
    await machine('http://www.shoptrial.test/');
    ok(/OWN EYE/.test(await status()), `a site that was added is shown: ${await status()}`);
    ok((await inner().locator('#cookie').innerText()) === 'strict=1', 'signed in, its strictest cookie sent');
    ok((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(16, 32, 48)', "the machine wears the site's theme");
    for (const [name, label] of [['READER', 'READER'], ['X-RAY', 'X-RAY'], ['LOW-FI', 'LOW-FI'], ['YOUR THEME', 'YOUR THEME']]) {
      await page.getByRole('button', { name: `[ ${name} ]`, exact: true }).click();
      await page.waitForTimeout(400);
      ok((await status()).includes(`LENS: ${label}`), `${name} is put on`);
      if (name === 'LOW-FI') ok((await inner().evaluate(() => getComputedStyle(document.querySelector('article p')).color)) === 'rgb(255, 255, 255)', 'in the theme');
    }
    await page.getByRole('button', { name: '[ STANDARD ]', exact: true }).click();
    await page.waitForTimeout(300);
    ok((await inner().evaluate(() => document.getElementById('debaser-see'))) === null, 'STANDARD takes it all off');
    await page.locator('#media').click();
    await page.waitForTimeout(400);
    ok(/The film/.test(await page.locator('#beside').innerText()), 'MEDIA lists what it plays');
    const [room] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: '[ TO THE ROOM ↗ ]' }).first().click()]);
    ok(/^http:\/\/www\.machinesite\.test\/browser#media=http%3A%2F%2Fwww\.shoptrial\.test%2Ffilm\.mp4&title=The%20film$/.test(room.url()), 'and a press takes it to the site, where it waits');
    await room.close();
    await page.bringToFront();
    await inner().getByRole('link', { name: 'second' }).click();
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => document.getElementById('address').value.endsWith('/second'), null, { timeout: 6000 }).catch(async () => console.log('  ..', inner()?.url(), asked.slice(-3)));
    ok((await page.locator('#address').inputValue()) === 'http://www.shoptrial.test/second', 'a link is followed, and the box says so');
    await machine('http://www.shoptrial.test/leave');
    await page.waitForTimeout(1000);
    ok(page.url().startsWith('chrome-extension://') && !asked.some((each) => each.url === '/escaped'), 'a site in the frame cannot move the machine');
    const before = asked.length;
    await machine('http://www.othersite.test/');
    ok((await page.locator('#door').innerText()).includes('ADD othersite.test') && asked.length === before, 'a site that was not added is not asked for: the machine asks first');
    await machine('https://accounts.google.com/');
    ok(/NEVER SHOWN/.test(await page.locator('#door').innerText()) && (await page.locator('#page').getAttribute('src')) === null, 'a sign-in page is never framed');
    await page.locator('#sites').click();
    await page.waitForTimeout(300);
    ok(/shoptrial\.test/.test(await page.locator('#beside').innerText()), 'SITES lists what was added');

    // The frame's header rule is for the machine alone.
    await page.goto('http://www.machinesite.test/');
    await page.evaluate(() => {
      const other = document.createElement('iframe');
      other.src = 'http://www.shoptrial.test/';
      document.body.append(other);
    });
    await page.waitForTimeout(1200);
    const framed = page.frames().find((each) => each.parentFrame() === page.mainFrame());
    ok(framed === undefined || (await framed.evaluate(() => document.querySelector('article')).catch(() => null)) === null, "another page framing the same site is refused as it always was");

    // The tab the machine was in has no leave once it is gone from it.
    const rules = () => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules().then((all) => all.length)).catch(() => -1);
    ok((await rules()) === 0, 'with no machine open there is no rule');
    await machine('http://www.shoptrial.test/');
    ok((await rules()) > 0, 'with one, there is');
    await page.goto('http://www.machinesite.test/');
    await page.waitForTimeout(600);
    ok((await rules()) === 0, 'and it goes with the machine, whatever is opened in that tab next');

    // Settings, its badge, and reading itself again when its folder has been written to (2026-11-23).
    await page.goto('http://www.machinesite.test/');
    ok(JSON.stringify((await say({ see: 'settings' }))?.settings) === '{"lens":"standard","wear":true}', 'its settings, as they come');
    ok((await say({ see: 'settings', settings: { lens: 'reader', wear: false } }))?.settings.lens === 'reader', 'changed by the site');
    ok((await say({ see: 'settings', settings: { lens: 'x', wear: 1 } }))?.settings.lens === 'reader', 'and only to what they can be');
    await machine('http://www.shoptrial.test/');
    ok((await status()).includes('LENS: READER'), 'a page opens in the lens that was set');
    ok((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(16, 32, 48)', "and without the site's theme when that is off");
    await page.goto('http://www.machinesite.test/');
    await say({ see: 'settings', settings: { lens: 'standard', wear: true } });
    await say({ see: 'newest', version: '99.0.0' });
    await page.waitForTimeout(200);
    ok((await worker.evaluate(() => chrome.action.getBadgeText({}))) === 'NEW', 'its key in the bar says when there is a newer one');
    await say({ see: 'newest', version: manifest.version });
    await page.waitForTimeout(200);
    ok((await worker.evaluate(() => chrome.action.getBadgeText({}))) === '', 'and stops when there is not');
    const [sitesPage] = await Promise.all([context.waitForEvent('page'), say({ see: 'sites' })]);
    await sitesPage.waitForTimeout(1200);
    ok(/shoptrial\.test/.test(await sitesPage.locator('#beside').innerText()), 'its sites are listed in its own page, not told to the site');
    await sitesPage.close();
    await page.bringToFront();
    const newer = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    newer.version = '9.9.9';
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(newer));
    ok((await say({ see: 'ping' }))?.version === manifest.version, 'written to, it is still the old one');
    ok((await say({ see: 'reload' }))?.ok === true, 'asked by the site to read itself again');
    await page.waitForTimeout(3000);
    ok((await say({ see: 'ping' }))?.version === '9.9.9', 'it is the new one, with nothing pressed in the browser');
    ok(JSON.stringify((await say({ see: 'settings' }))?.settings) === '{"lens":"standard","wear":true}', 'with its settings');
    await machine('http://www.shoptrial.test/');
    ok(/OWN EYE/.test(await status()), 'and the sites it was let');

    // Asked by the site whether the page in front is on its list: that one, and never the list.
    await page.goto('http://www.machinesite.test/');
    const has = await say({ see: 'has', address: 'http://www.shoptrial.test/a' });
    ok(has?.on === true && has?.site === 'shoptrial.test', 'the site asks whether the page in front is on its list');
    ok((await say({ see: 'has', address: 'https://www.youtube.com/watch?v=x' }))?.on === false, 'and hears no for one that is not');
    ok((await say({ see: 'has', address: 'javascript:alert(1)' }))?.on === null, 'and nothing for what is no page');
    for (let i = 0; i < 40; i += 1) await say({ see: 'has', address: `https://s${i}.example/` });
    ok((await say({ see: 'has', address: 'https://fresh.example/' }))?.on === null, 'nor for more than a few sites an hour, so the list can not be gone through');
    ok((await say({ see: 'has', address: 'http://www.shoptrial.test/b' }))?.on === true, 'though one already asked about still is');

    // The panel.
    await page.goto(`chrome-extension://${id}/panel.html`);
    await page.waitForTimeout(800);
    ok(/PRESS THE MACHINE/.test(await page.locator('#where').innerText()), 'the panel says when there is no page to look at');
    ok(await page.locator('#add').isHidden(), 'and has no ADD then');
    console.log(`\n${passed} passed`);
  } finally {
    await context.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
