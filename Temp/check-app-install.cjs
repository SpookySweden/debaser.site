/**
 * debaser.site can be installed as an app (Luke, 2026-11-28: "Yes, yellow text icon"). The browser itself is asked, over its
 * DevTools protocol, what manifest the page has and why it could not be installed; then each icon is fetched and measured.
 *
 *   node Temp/check-app-install.cjs                    the local build (`npm run build` first); starts its own `next start` on :3217 if none is up
 *   node Temp/check-app-install.cjs --url <origin>     any local copy (use http://localhost:<port>)
 *   node Temp/check-app-install.cjs --browser msedge   one named browser (otherwise Chrome, or Edge where there is no Chrome)
 *
 * The manifest is app/manifest.ts; its icons are public/app-icon-*.png, made by scripts/make-text-icon.cjs.
 * What it cannot show: a real install, or whether an installed copy starts a room's sound without a press.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3217;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const BASE = (arg('--url') ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const ONLY_BROWSER = arg('--browser');
// A page with the root layout and nothing to read from a database.
const PAGE = `${BASE}/privacy`;

async function up() {
  try {
    return (await fetch(PAGE)).ok;
  } catch {
    return false;
  }
}

/** A browser with a real (throwaway) profile: in Playwright's ordinary context the browser answers "in-incognito". */
async function open(profile) {
  const channels = ONLY_BROWSER ? [ONLY_BROWSER] : ['chrome', 'msedge'];
  let refused;
  for (const channel of channels) {
    try {
      return { channel, context: await chromium.launchPersistentContext(profile, { channel, headless: true }) };
    } catch (error) {
      refused = error;
    }
  }
  throw refused;
}

(async () => {
  let server = null;
  if (!arg('--url') && !(await up())) {
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let attempt = 0; attempt < 40 && !(await up()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const profile = mkdtempSync(path.join(os.tmpdir(), 'debaser-install-'));
  let context = null;
  try {
    assert.ok(await up(), `nothing is serving ${PAGE} (run npm run build first)`);
    const opened = await open(profile);
    context = opened.context;
    // Nothing leaves for the live database or anywhere else, whatever the server's settings.
    await context.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(PAGE, { waitUntil: 'load', timeout: 90000 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');

    const { url, errors, data } = await cdp.send('Page.getAppManifest');
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    const said = installabilityErrors.map((error) => [error.errorId, ...error.errorArguments.map((a) => a.value)].join(' '));
    assert.ok(url, `the page has a manifest (the browser found none; it says: ${said.join(', ') || 'nothing'})`);
    assert.deepEqual(errors, [], 'the browser reads the manifest without complaint');
    assert.deepEqual(said, [], 'the browser finds nothing in the way of installing: ' + said.join(', '));

    const manifest = JSON.parse(data);
    assert.equal(manifest.name, 'DEBASER.SITE', 'the app is named for the site');
    assert.equal(manifest.display, 'standalone', 'it opens in its own window');
    assert.equal(new URL(manifest.start_url, url).href, `${BASE}/`, 'it starts at the front of the site');
    assert.equal(new URL(manifest.scope, url).href, `${BASE}/`, 'the whole site is inside the app');
    assert.ok(!(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((all) => all.length))), 'no service worker (a cache could serve an old site)');

    const wanted = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']];
    assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), wanted, 'the icons an install needs');
    for (const icon of manifest.icons) {
      const answer = await fetch(new URL(icon.src, url));
      assert.equal(answer.status, 200, `${icon.src} is served`);
      assert.equal(answer.headers.get('content-type'), 'image/png', `${icon.src} is a PNG`);
      const bytes = Buffer.from(await answer.arrayBuffer());
      assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes, `${icon.src} is the size the manifest says`);
    }
    console.log(`  ok    ${opened.channel} ${context.browser()?.version() ?? ''}: installable (no errors), DEBASER.SITE, standalone, ${manifest.icons.length} icons at their sizes`);
  } finally {
    if (context) await context.close();
    if (server) server.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
