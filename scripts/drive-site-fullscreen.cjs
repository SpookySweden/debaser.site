/*
 * Drives two things Luke asked for on 2026-11-23, in a real browser on a local dev server with mock data only:
 *
 *   1. "The site itself should have a full screen button in the top right, which you can exit with f11 or escape or by pressing the
 *      button again": the key is the last thing on the top bar, on an ordinary page and on one that fills by itself; the whole site
 *      goes fullscreen; the key and F11 bring it back; a room's own fullscreen works inside it and comes back to it.
 *   2. "For results in the media tab that have no image, we need an icon which represents the type of media it is": no row says NO
 *      IMAGE; each picture-less row has the mark of its kind, in the accent ink, glowing.
 *
 *   node scripts/dev-mock-live.cjs 3316
 *   node scripts/drive-site-fullscreen.cjs --base http://localhost:3316
 *
 * Esc leaving fullscreen is the browser's own: a scripted key never reaches it, so it is not driven here.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3316';
const SHOTS = join('Temp', 'browse', 'site-fullscreen');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => held.id !== 'drive-video');
    items.push({ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() });
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    localStorage.setItem('debaser-companion', JSON.stringify({ computer: false, phone: false }));
  } catch {}
})()`;

const KEY = '[data-site-fullscreen-key]';
const full = (page) => page.evaluate(() => (document.fullscreenElement === null ? 'none' : document.fullscreenElement === document.documentElement ? 'site' : 'box'));
const waitFull = (page, wanted) =>
  page.waitForFunction((want) => (document.fullscreenElement === null ? 'none' : document.fullscreenElement === document.documentElement ? 'site' : 'box') === want, wanted, { timeout: 10000 });
async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(KEY, { state: 'attached', timeout: 120000 });
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(1500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.route(/supabase\.(co|in)/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    console.log('1. THE SITE FULLSCREEN');
    await open(page, '/files?kind=video');
    const place = await page.evaluate((key) => {
      const bar = document.querySelector('nav[aria-label="Modules"]');
      const buttons = [...bar.querySelectorAll('a, button')].filter((each) => each.getBoundingClientRect().width > 0);
      const box = document.querySelector(key).getBoundingClientRect();
      return { last: buttons[buttons.length - 1] === document.querySelector(key), gap: Math.round(bar.getBoundingClientRect().right - box.right), tall: box.height };
    }, KEY);
    assert.ok(place.last && place.gap <= 24 && place.tall >= 24, `the last key, at the right end of the top bar (${JSON.stringify(place)})`);
    await page.screenshot({ path: join(SHOTS, '1-key.png') });
    pass('the key is the last one, at the top right');
    await page.locator(KEY).click();
    await waitFull(page, 'site');
    assert.equal(await page.locator(KEY).getAttribute('data-site-fullscreen-key'), 'leave');
    assert.equal(await page.locator(KEY).getAttribute('aria-label'), 'Leave fullscreen');
    await page.screenshot({ path: join(SHOTS, '2-fullscreen.png') });
    pass('it makes the whole site fullscreen, and says how to leave');
    await page.locator(KEY).click();
    await waitFull(page, 'none');
    assert.equal(await page.locator(KEY).getAttribute('data-site-fullscreen-key'), 'enter');
    pass('pressed again, it is back');
    await page.locator(KEY).click();
    await waitFull(page, 'site');
    await page.keyboard.press('F11');
    await waitFull(page, 'none');
    pass('F11 leaves it too');

    console.log('2. A ROOM INSIDE IT');
    await page.waitForFunction(() => {
      if (document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']') !== null) return true;
      const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
      (shut.find((button) => button.textContent.includes('DRIVE VIDEO')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
      return false;
    }, null, { timeout: 60000, polling: 500 });
    await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
    await page.waitForSelector('video[data-watch-video]', { timeout: 30000 });
    const loop = page.locator('[data-room-loop="off"]');
    if (await loop.count()) await loop.first().click();
    await sleep(500);
    await page.evaluate((key) => document.querySelector(key).click(), KEY);
    await waitFull(page, 'site');
    await page.locator('[data-room-full="enter"]:visible').first().click();
    await waitFull(page, 'box');
    pass("a room's FULL key fills the screen with the room, inside the site's fullscreen");
    await page.evaluate(() => document.querySelector('[data-room-full="leave"]').click());
    await waitFull(page, 'site');
    pass('leaving it comes back to the site, still fullscreen');
    await page.evaluate((key) => document.querySelector(key).click(), KEY);
    await waitFull(page, 'none');

    console.log('3. MARKS FOR RESULTS WITH NO PICTURE');
    await open(page, '/media');
    await page.waitForSelector('[data-media-mark]', { timeout: 60000 });
    await sleep(1500);
    const marks = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-accent-ink';
      document.body.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      return [...document.querySelectorAll('[data-media-mark]')].filter((mark) => mark.getBoundingClientRect().width > 0).map((mark) => {
        const inner = mark.firstElementChild;
        const box = mark.parentElement.getBoundingClientRect();
        const shape = inner.getBoundingClientRect();
        return { kind: mark.dataset.mediaMark, drawn: mark.dataset.mediaMarkDrawn, name: mark.getAttribute('aria-label'), glow: getComputedStyle(inner).filter.includes('drop-shadow'), ink: getComputedStyle(mark).color === ink, fits: shape.width <= box.width && shape.height <= box.height && shape.width >= 8 };
      });
    });
    console.log(`    ${marks.length} marks: ${JSON.stringify(marks.reduce((all, mark) => ({ ...all, [`${mark.kind}${mark.drawn === 'yes' ? ' (drawn)' : ''}`]: (all[`${mark.kind}${mark.drawn === 'yes' ? ' (drawn)' : ''}`] ?? 0) + 1 }), {}))}`);
    assert.ok(marks.length > 0);
    for (const mark of marks) assert.ok(mark.glow && mark.ink && mark.fits && mark.name, `a mark that glows in the accent ink, fits its box and has a name (${JSON.stringify(mark)})`);
    assert.equal(await page.getByText('NO IMAGE', { exact: true }).count(), 0, 'nothing says NO IMAGE');
    await page.locator('[data-media-mark]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, '3-marks.png') });
    pass('every picture-less row has its kind\'s mark, glowing, in its box');
    assert.deepEqual(errors, [], `no page errors (${errors.join(' | ')})`);
    console.log(`\nPASSED ${passed}`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(`\nFAILED after ${passed}: ${failure.message} (fullscreen: ${await full(page).catch(() => '?')})`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
