/*
 * Drives BROWSER and REMOTE on the shelf (Luke, 2026-11-23: "Add remote control and a browser button to the shelf, mark both as wip"),
 * in a real browser on a local dev server with mock data only: BROWSER, tagged WIP, is there for everybody and opens /browser; REMOTE,
 * tagged WIP, is the owner's alone, and opens their room with the list of machines, whether the room was shut, open or folded.
 *
 *   node scripts/dev-mock-live.cjs 3318
 *   node scripts/drive-shelf-keys.cjs --base http://localhost:3318
 *
 * "Is the engine there?" is answered yes in the browser; no real machine is connected to.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3318';
const SHOTS = join('Temp', 'browse', 'shelf-keys');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const seed = (id) => `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: '${id}', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    localStorage.setItem('debaser-companion', JSON.stringify({ computer: false, phone: false }));
  } catch {}
})()`;

async function visit(browser, id) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (id !== null) await context.addInitScript(seed(id));
  await context.route(/supabase\.(co|in)/, (route) => route.abort());
  await context.route(/\/api\/screens\//, (route) => {
    const url = new URL(route.request().url());
    if (id === 'debaser-site' && url.pathname === '/api/screens/host' && !url.search.includes('server')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, settings: null, drive: false }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-shelf-browser]', { timeout: 120000 });
  await sleep(2500);
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(2500);
  return { page, context, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--mute-audio'] });
  let page = null;
  try {
    for (const [who, id] of [['a visitor', null], ['somebody signed in', 'drive-user']]) {
      const seen = await visit(browser, id);
      page = seen.page;
      assert.match(await page.locator('[data-shelf-browser]').innerText(), /BROWSER[\s\S]*WIP/);
      assert.equal(await page.locator('[data-shelf-remote]').count(), 0, `${who} has no REMOTE`);
      await seen.context.close();
      pass(`${who}: BROWSER, WIP; no REMOTE`);
    }
    const owner = await visit(browser, 'debaser-site');
    page = owner.page;
    const fits = await page.evaluate(() => ['[data-shelf-browser]', '[data-shelf-remote]'].map((key) => { const words = document.querySelector(`${key} > span`); return words !== null && words.scrollWidth <= words.clientWidth; }));
    assert.deepEqual(fits, [true, true], 'both keys, with their WIP, fit the panel');
    assert.match(await page.locator('[data-shelf-remote]').innerText(), /REMOTE[\s\S]*WIP/);
    await page.locator('[data-shelf-remote]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, '1-shelf.png') });
    pass('the owner: REMOTE too, WIP, both fitting the panel');
    const list = page.locator('[data-dock-window="stream"] [data-remote-choices]');
    // Pressed as a script: the mock's first-visit PRIVACY window lies over the panel.
    await page.evaluate(() => document.querySelector('[data-shelf-remote]').click());
    await list.waitFor({ state: 'visible', timeout: 20000 });
    assert.ok((await page.locator('[data-remote-choice="engine"]').count()) === 1, 'with the machine that answers');
    const inside = await page.evaluate(() => {
      const box = document.querySelector('[data-dock-window="stream"]').getBoundingClientRect();
      return [...document.querySelectorAll('[data-remote-choices], [data-remote-choices] *')].every((each) => each.getBoundingClientRect().left >= box.left && each.getBoundingClientRect().right <= box.right);
    });
    await page.screenshot({ path: join(SHOTS, '2-list.png') });
    assert.ok(inside, 'the whole list is inside the room, machine names and all');
    pass('pressed with the room shut: the room opens on its list of machines');
    await page.locator('[data-remote-choice="engine"]').click();
    await page.waitForSelector('[data-room-screen]', { timeout: 15000 });
    await page.locator('[data-screen-toggle="on"]').first().click();
    await page.waitForSelector('[data-screen-toggle="off"]', { timeout: 5000 });
    pass('the list works: the view comes on, and goes');
    await page.evaluate(() => document.querySelector('[data-shelf-remote]').click());
    await list.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-screen-toggle="off"]').first().click();
    pass('pressed with the room open: the list again');
    await page.locator('[data-dock-window="stream"] button[aria-label^="Fold "]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') === 'true', null, { timeout: 5000 });
    await page.evaluate(() => document.querySelector('[data-shelf-remote]').click());
    await list.waitFor({ state: 'visible', timeout: 10000 });
    pass('pressed with the room folded: it unfolds, with the list');
    await page.evaluate(() => document.querySelector('[data-shelf-browser]').click());
    await page.waitForURL(/\/browser/, { timeout: 60000 });
    pass('BROWSER opens /browser');
    assert.deepEqual(owner.errors, [], `no page errors (${owner.errors.join(' | ')})`);
    console.log(`\nPASSED ${passed}`);
  } catch (failure) {
    await page?.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(`\nFAILED after ${passed}: ${failure.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
