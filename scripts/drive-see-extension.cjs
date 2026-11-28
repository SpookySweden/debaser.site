/*
 * BROWSER's extension, OWN EYE (SPEC-seeing-machine.md, phase 4), in a real browser with a throwaway profile, on pretend sites this script
 * serves: the files in extension/ as they are, but for the two pretend sites being already let (a browser's own "allow" box can't be pressed
 * by a script) and the local pretend site standing in for debaser.site. Signs in to nothing.
 *
 *   node scripts/drive-see-extension.cjs
 *   STORE_SHOTS=docs/extension-store node scripts/drive-see-extension.cjs     (also the Chrome Web Store's pictures, 1280 x 800, of the real thing)
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
    // One policy holding both its no-framing line and its script-safety rules (decision 67).
    if (request.url === '/mixed') return answer.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "frame-ancestors 'none'; script-src 'none'" }).end(`${STORY}<p id=cookie>mixed</p>`);
    return answer.writeHead(200, headers).end(`${STORY}<p id=cookie>${request.headers.cookie ?? 'signed out'}</p>`);
  });
  await new Promise((done) => server.listen(80, '127.0.0.1', done));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-own-eye-'));
  const extension = path.join(dir, 'extension');
  fs.cpSync(path.join(__dirname, '..', 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://shoptrial.test/*', 'https://*.shoptrial.test/*', 'http://shoptrial.test/*', 'http://*.shoptrial.test/*', 'https://tiktok.com/*', 'https://*.tiktok.com/*'];
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
      if (process.env.STORE_SHOTS) await page.screenshot({ path: path.join(process.env.STORE_SHOTS, `store-${name.toLowerCase().replace(/[^a-z]+/g, '-')}.png`) });
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

    // OWN EYE as the browser itself: the page in an ordinary tab, not the machine's frame; the machine's own page only when asked for.
    await page.goto('http://www.machinesite.test/');
    const [plain] = await Promise.all([context.waitForEvent('page'), say({ see: 'open', address: 'http://www.shoptrial.test/second' })]);
    await plain.waitForLoadState('domcontentloaded');
    ok(plain.url() === 'http://www.shoptrial.test/second', 'the site opens a page in an ordinary tab of the reader\'s browser');
    ok((await plain.evaluate(() => document.cookie)) === 'strict=1' || /strict=1/.test(await plain.locator('body').innerText()), 'signed in as they are there');
    await plain.close();
    const [inMachine] = await Promise.all([context.waitForEvent('page'), say({ see: 'open', address: 'http://www.shoptrial.test/', in: 'machine' })]);
    ok(inMachine.url().startsWith(`chrome-extension://${id}/machine.html`), "and the machine's own page when that is asked for");
    await inMachine.close();
    // A site that stops itself in a frame (YouTube's videos played white there): the machine sends it to an ordinary tab.
    await page.goto(`chrome-extension://${id}/machine.html#see=${encodeURIComponent('https://www.youtube.com/watch?v=x')}`);
    await page.waitForTimeout(1200);
    ok(/STOPS ITSELF IN A FRAME/.test(await page.locator('#door').innerText()) && (await page.locator('#page').getAttribute('src')) === null, 'YouTube is never framed: OPEN IT IN A TAB');
    // The morning's gaps (Luke, 2026-11-27). G2: BROWSER's ADD key for such a site lands here, so the adding is done here and not nowhere.
    const youtubeDoor = await page.locator('#door').innerText();
    ok(/\[ OPEN IT IN A TAB \]/.test(youtubeDoor) && /\[ ADD youtube\.com \]/.test(youtubeDoor) && /\[ ADD ALL OF GOOGLE \]/.test(youtubeDoor), `and the ADD key that brought the reader here is here: this site, or all of its company (${youtubeDoor.replace(/\s+/g, ' ').slice(0, 160)})`);
    ok(/NOT ADDED: youtube\.com/.test(await page.locator('#status').innerText()), 'the status line says it is not added yet');
    // G3: every key of the machine's page says what it does and why when the pointer rests on it; G4: the server's eye is named for what it is.
    const bare = await page.locator('button').evaluateAll((keys) => keys.filter((each) => each.title.length < 30).map((each) => each.textContent));
    ok(bare.length === 0 && (await page.locator('button').count()) >= 14, `every key on the machine's page has hover words (${bare.join(' ')})`);
    ok((await page.locator('#server').innerText()) === '[ SERVER EYE: SIGNED OUT, ON DEBASER.SITE ↗ ]', "and the way to the server's eye says what it is");
    // A site of that kind already on the list (the drive's manifest lets tiktok.com, as a press would): no key that leads nowhere, in words.
    await page.goto('about:blank');
    await page.goto(`chrome-extension://${id}/machine.html#see=${encodeURIComponent('https://www.tiktok.com/')}`);
    await page.waitForTimeout(1200);
    const listedDoor = await page.locator('#door').innerText();
    ok(/✓ tiktok\.com IS ON THE LIST/.test(listedDoor) && !/\[ ADD /.test(listedDoor) && /\[ OPEN IT IN A TAB \]/.test(listedDoor), 'once it is on the list the page says so, and offers no ADD');

    // A site that shares its sign-in offers the whole company, named before the press; SITES offers each company and IMPORT.
    await page.goto('about:blank');
    await page.goto(`chrome-extension://${id}/machine.html#see=${encodeURIComponent('https://www.google.com/maps')}`);
    await page.waitForTimeout(1200);
    const googleDoor = await page.locator('#door').innerText();
    ok(/\[ ADD google\.com \]/.test(googleDoor) && /GOOGLE SIGNS YOU IN TO google\.com, youtube\.com, gmail\.com/.test(googleDoor) && /\[ ADD ALL OF GOOGLE \]/.test(googleDoor), `a Google site offers itself, and all of Google's sites in one press, named first (${googleDoor.replace(/s+/g, ' ').slice(0, 200)})`);
    await page.locator('#sites').click();
    await page.waitForTimeout(500);
    const sitesView = await page.locator('#beside').innerText();
    if (process.env.STORE_SHOTS) await page.screenshot({ path: path.join(process.env.STORE_SHOTS, 'store-sign-ins.png') });
    ok(/ADD A SIGN-IN/.test(sitesView) && /\[ GOOGLE \]/.test(sitesView) && /\[ MICROSOFT \]/.test(sitesView) && /\[ IMPORT FROM THIS BROWSER \]/.test(sitesView), 'SITES offers each sign-in, and IMPORT FROM THIS BROWSER');
    ok((await context.serviceWorkers().at(-1).evaluate(() => chrome.permissions.contains({ permissions: ['history'] }))) === false, "and holds no leave to read the browser's history until IMPORT is pressed");
    // ALLOW EVERY SITE (Luke, 2026-11-27: "One optional key (Recommended)"): off until pressed, said in words, and what adding by name costs.
    const everyRow = await page.locator('#every').innerText();
    const everyKey = page.locator('#every button');
    ok(/^EVERY SITE: OFF\. ONLY THE SITES ADDED BY NAME, BELOW, ARE SHOWN\./.test(everyRow) && (await everyKey.innerText()) === '[ ALLOW EVERY SITE ]', `SITES says every site is off, with its one key (${everyRow.replace(/\s+/g, ' ').slice(0, 90)})`);
    const everyWords = await everyKey.getAttribute('title');
    ok(/Off until you press this/.test(everyWords) && /stop at their first line, reading and sending nothing/.test(everyWords) && /Sign-in pages, banks and payments are still never shown/.test(everyWords), 'its hover words say what it lets, what then runs on every page, and what is still never shown');
    ok(/^ADDED BY NAME: A SITE ADDED BY NAME IS SHOWN EVEN WHEN THAT MEANS SWITCHING OFF ITS OWN SCRIPT-SAFETY RULES/.test(await page.locator('#named-cost').innerText()), 'and the page says what adding a site by name costs');
    ok((await context.serviceWorkers().at(-1).evaluate(() => chrome.permissions.contains({ origins: ['https://*/*'] }))) === false, 'it holds no leave for every site until that key is pressed');

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
    const bareInPanel = await page.locator('button:not([hidden])').evaluateAll((keys) => keys.filter((each) => each.title.length < 30).map((each) => each.textContent));
    ok(bareInPanel.length === 0 && (await page.locator('#server').innerText()) === '[ SERVER EYE: SIGNED OUT, ON DEBASER.SITE ↗ ]', `every key in the panel has hover words too, and its server's eye says what it is (${bareInPanel.join(' ')})`);
    await context.close();

    // ---- A copy that holds the leave for every site, as the press on [ ALLOW EVERY SITE ] and the browser's own box would give ----
    console.log('\nEVERY SITE ALLOWED (no site added by name)');
    const extensionEvery = path.join(dir, 'extension-every');
    fs.cpSync(path.join(__dirname, '..', 'extension'), extensionEvery, { recursive: true });
    const manifestEvery = JSON.parse(fs.readFileSync(path.join(extensionEvery, 'manifest.json'), 'utf8'));
    manifestEvery.host_permissions = ['https://*/*', 'http://*/*'];
    manifestEvery.externally_connectable.matches = ['http://www.machinesite.test/*'];
    fs.writeFileSync(path.join(extensionEvery, 'manifest.json'), JSON.stringify(manifestEvery));
    for (const file of ['worker.js', 'act.js']) fs.writeFileSync(path.join(extensionEvery, file), fs.readFileSync(path.join(extensionEvery, file), 'utf8').replaceAll('https://debaser.site', 'http://www.machinesite.test'));
    const every = await chromium.launchPersistentContext(path.join(dir, 'profile-every'), { executablePath: findChrome(), headless: false, viewport: { width: 1280, height: 800 }, args: ['--headless=new', `--disable-extensions-except=${extensionEvery}`, `--load-extension=${extensionEvery}`, '--host-resolver-rules=MAP *.shoptrial.test 127.0.0.1, MAP *.othersite.test 127.0.0.1, MAP *.machinesite.test 127.0.0.1', '--disable-features=DisableLoadExtensionCommandLineSwitch'], ignoreDefaultArgs: ['--disable-extensions'] });
    try {
      let [workerEvery] = every.serviceWorkers();
      workerEvery ??= await every.waitForEvent('serviceworker', { timeout: 20000 });
      const idEvery = new URL(workerEvery.url()).host;
      const tab = await every.newPage();
      tab.on('pageerror', (error) => console.log('  ..  page error:', error.message.slice(0, 200)));
      const open = async (address, wait = 1500) => {
        await tab.goto('about:blank');
        await tab.goto(`chrome-extension://${idEvery}/machine.html#see=${encodeURIComponent(address)}`);
        await tab.waitForTimeout(wait);
      };
      const within = () => tab.frames().find((each) => each.parentFrame() === tab.mainFrame());
      const doorWords = async () => ((await tab.locator('#door').isHidden()) ? '' : (await tab.locator('#door').innerText()).replace(/\s+/g, ' '));
      await open('http://www.othersite.test/');
      ok(/OWN EYE/.test(await tab.locator('#status').innerText()) && (await within()?.locator('#cookie').innerText().catch(() => null)) === 'signed out' && !/\[ ADD /.test(await doorWords()), 'a site that was never added is shown at once, with no ADD step');
      // Its policy mixes framing with script-safety rules: left whole, so it stays out, and the page says why and offers both ways on.
      await open('http://www.othersite.test/mixed', 4500);
      const mixedDoor = await doorWords();
      ok(/IT DIDN'T SHOW HERE\. EITHER THIS SITE ONLY SHOWS INSIDE ANOTHER WITH ITS OWN SCRIPT-SAFETY RULES SWITCHED OFF, WHICH \[ ALLOW EVERY SITE \] NEVER DOES/.test(mixedDoor) && /\[ OPEN IT IN A TAB \]/.test(mixedDoor) && /\[ ADD othersite\.test \]/.test(mixedDoor), `a page that only shows with its script-safety rules off is not shown, and says so, with a tab or ADD by name (${mixedDoor.slice(0, 120)})`);
      ok(/switching off its own script-safety rules/.test(await tab.getByRole('button', { name: '[ ADD othersite.test ]' }).getAttribute('title')), "and that ADD key's hover words say what adding by name costs");
      // What never changes: YouTube and its kind still open in a tab, a sign-in page is never framed.
      await open('https://www.youtube.com/watch?v=x');
      const tubeDoor = await doorWords();
      ok(/STOPS ITSELF IN A FRAME/.test(tubeDoor) && /✓ EVERY SITE IS ALLOWED/.test(tubeDoor) && !/\[ ADD /.test(tubeDoor) && (await tab.locator('#page').getAttribute('src')) === null && /^ALLOWED: youtube\.com/.test(await tab.locator('#status').innerText()), 'YouTube still opens in a tab, and its page offers no ADD: every site is allowed');
      await open('https://accounts.google.com/');
      ok(/NEVER SHOWN/.test(await doorWords()) && (await tab.locator('#page').getAttribute('src')) === null, 'a sign-in page is still never framed');
      await tab.locator('#sites').click();
      await tab.waitForTimeout(500);
      ok(/^EVERY SITE: ON\./.test(await tab.locator('#every').innerText()) && (await tab.locator('#every button').innerText()) === '[ TAKE IT BACK ]' && /NO SITE ADDED BY NAME\./.test(await tab.locator('#beside').innerText()), 'SITES says every site is on, with the key that takes it back, and that no site is added by name');
      ok(/Sites you added by name stay on the list/.test(await tab.locator('#every button').getAttribute('title')), 'whose hover words say the sites added by name stay');
      await tab.goto('http://www.machinesite.test/');
      const ask = (address) => tab.evaluate(([to, about]) => new Promise((done) => chrome.runtime.sendMessage(to, { see: 'has', address: about }, (answer) => done(answer ?? null))), [idEvery, address]);
      ok(JSON.stringify(await ask('http://www.othersite.test/a')) === JSON.stringify({ on: true, site: 'othersite.test', named: false }), 'the site is told the page may be shown, and that its site is not on the list by name');
      for (let i = 0; i < 40; i += 1) await ask(`https://s${i}.example/`);
      ok(JSON.stringify(await ask('https://fresh.example/')) === JSON.stringify({ on: true, site: 'fresh.example', named: null, every: true }), 'past the few sites an hour it still hears that every site may be shown, and nothing of the list');
    } finally {
      await every.close();
    }
    console.log(`\n${passed} passed`);
  } finally {
    await context.close().catch(() => undefined);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
