/*
 * OWN EYE inside BROWSER's own tab (Luke, 2026-11-27: "not open in a new tab but inside a 'new tab' inside of debasers browser module"), with real
 * cookies on pretend https sites: the extension as it is, but for debaser.site being a pretend site this script serves, and the pretend shop already
 * let (a browser's own "allow" box can't be pressed by a script). Signs in to nothing real.
 *
 *   node scripts/drive-see-own-frame.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

let passed = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  passed += 1;
  console.log(`  ok  ${what}`);
};
const SANDBOX = /OWN_FRAME_SANDBOX = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'app/components/seeing/SeeingOwnFrame.tsx'), 'utf8'))[1];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-own-frame-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=pretend', '-addext', 'subjectAltName=DNS:*.shoptrial.test,DNS:*.machinesite.test,DNS:accounts.google.com'], { stdio: 'ignore' });
  const asked = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (request, answer) => {
    const host = request.headers.host.split(':')[0];
    asked.push(`${host}${request.url}`);
    const guarded = { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };
    if (host === 'www.machinesite.test') return answer.writeHead(200, { 'content-type': 'text/html' }).end('<title>BROWSER</title><p>the pretend BROWSER page');
    if (host === 'accounts.google.com') return answer.writeHead(200, guarded).end('<title>Sign in</title><p id=signin>sign in');
    if (request.url === '/signin') return answer.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['session=1; SameSite=None; Secure; Path=/', 'lax=1; SameSite=Lax; Secure; Path=/'] }).end('in');
    if (request.url === '/leave') return answer.writeHead(200, guarded).end('<script>try { top.location.href = "https://www.shoptrial.test/escaped"; } catch (error) {} try { document.title = String(parent.document.title); } catch (error) { document.title = error.name; }</script><p id=left>leaving');
    return answer.writeHead(200, guarded).end(`<title>Shop ${request.url}</title><p id=cookie>${request.headers.cookie ?? 'signed out'}</p><a id=next href="/second">second</a>`);
  });
  await new Promise((done) => server.listen(443, '127.0.0.1', done));

  const extension = path.join(dir, 'extension');
  fs.cpSync(path.join(__dirname, '..', 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://shoptrial.test/*', 'https://*.shoptrial.test/*'];
  manifest.externally_connectable.matches = ['https://www.machinesite.test/*'];
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['sites.js', 'frame.js', 'act.js', 'worker.js']) {
    const text = fs.readFileSync(path.join(extension, file), 'utf8');
    fs.writeFileSync(path.join(extension, file), text.replaceAll('https://debaser.site', 'https://www.machinesite.test'));
  }

  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    executablePath: findChrome(),
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP *.shoptrial.test 127.0.0.1, MAP *.machinesite.test 127.0.0.1, MAP accounts.google.com 127.0.0.1', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--ignore-certificate-errors'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log('  ..  page error:', error.message.slice(0, 160)));
    // Signed in on the shop, in its own tab, as a reader would be.
    await page.goto('https://www.shoptrial.test/signin');
    await page.goto('https://www.shoptrial.test/');
    ok((await page.locator('#cookie').innerText()).includes('session=1'), 'signed in to the pretend shop in an ordinary tab');

    await page.goto('https://www.machinesite.test/');
    const frameOf = (src) =>
      page.evaluate(
        ([where, sandbox]) =>
          new Promise((done) => {
            document.querySelector('iframe')?.remove();
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', sandbox);
            frame.src = where;
            frame.onload = () => setTimeout(done, 400);
            document.body.append(frame);
          }),
        [src, SANDBOX],
      );
    const inner = () => page.frames().find((each) => each.parentFrame() === page.mainFrame());
    const drawn = async () => (await inner()?.locator('#cookie').innerText({ timeout: 1500 }).catch(() => null)) ?? null;

    await frameOf('https://www.shoptrial.test/');
    ok((await drawn()) === null, 'with no BROWSER page held open to the extension, the shop keeps its no-framing rule');

    // BROWSER's page holds itself open to the extension, as SeeingMachine does.
    const told = [];
    await page.exposeFunction('heard', (message) => told.push(message));
    await page.evaluate((extensionId) => {
      window.held = chrome.runtime.connect(extensionId, { name: 'browser' });
      window.held.onMessage.addListener((message) => window.heard(message));
    }, id);
    await page.waitForTimeout(800);
    await frameOf('https://www.shoptrial.test/');
    const cookie = await drawn();
    ok(cookie !== null, "held open, an added site is shown in BROWSER's tab");
    ok(cookie.includes('session=1') && !cookie.includes('lax=1'), `signed in where the site's sign-in is meant to work inside another site; a Lax cookie stays home (${cookie})`);
    await page.waitForTimeout(500);
    ok(told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/'), 'and the extension tells BROWSER where it is');
    await inner().locator('#next').click();
    await page.waitForTimeout(1200);
    ok(told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/second') && (await drawn()) !== null, 'a link followed inside it is followed, and told');

    await frameOf('https://accounts.google.com/');
    ok((await inner()?.locator('#signin').count().catch(() => 0)) === 0, 'a sign-in page is never shown inside it (D1)');
    await frameOf('https://www.shoptrial.test/leave');
    await page.waitForTimeout(800);
    ok(page.url() === 'https://www.machinesite.test/' && !asked.includes('www.shoptrial.test/escaped'), "the framed site can't move BROWSER's page");
    ok((await inner().title()) === 'SecurityError', "nor read it");

    // Another page, not held open: refused as before.
    const other = await context.newPage();
    await other.goto('https://www.machinesite.test/');
    await other.evaluate((sandbox) => new Promise((done) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', sandbox);
      frame.src = 'https://www.shoptrial.test/';
      frame.onload = () => setTimeout(done, 400);
      document.body.append(frame);
    }), SANDBOX);
    const otherFrame = other.frames().find((each) => each.parentFrame() === other.mainFrame());
    ok((await otherFrame?.locator('#cookie').count().catch(() => 0)) === 0, 'another tab of the same site, not held open, is refused as it always was');
    await other.close();

    await page.evaluate(() => window.held.disconnect());
    await page.waitForTimeout(800);
    await frameOf('https://www.shoptrial.test/');
    ok((await drawn()) === null, 'and the leave goes when BROWSER lets go');
    console.log(`\n${passed} passed`);
  } finally {
    await context.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
