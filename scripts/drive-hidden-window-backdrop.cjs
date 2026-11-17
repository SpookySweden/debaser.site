/*
 * The background with the site window put away (HIDE WINDOW), in a real browser. Luke, 2026-11-16: "when hiding the main
 * site window currently it results in the backround acting as if the window is still there", "it is inconsistent ... make
 * sure clicking on the backround still works too". Not in `npm run checks`: it needs a running site.
 *
 *   node scripts/drive-hidden-window-backdrop.cjs --base http://localhost:3003
 *
 * For a local dev server on mock data only. It signs nobody in and asks nothing of the network. Held here:
 *   1. FLUID: a press on the desk beside the window makes ink there; a press on the window makes none under it;
 *   2. the window put away: a press where the window was makes ink there (the press lands on the page's body now);
 *      the key on the background shows (at a width where it hides beside a window) and opens its settings;
 *   3. FILL WINDOW on and the window put away: the background runs (it used to rest as if still covered);
 *   4. SAND: with the window put away, sand poured above where the window was falls through that space;
 *   5. the window brought back: a press on it makes no ink, as before.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');
const { backdropCells } = require('./backdrop-pixels.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3003';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** How many cells of the background's grid are drawn inside a box of screen pixels, and a sum that changes when they do. */
// Read off the screen: FLUID's canvas is drawn by a thread of its own and can't be read from the page (PERF 1b).
const drawn = (page, box) => backdropCells(page, box, join('Temp', 'browse', 'hidden-window-cells.png'));
const round = (x, y, half = 60) => ({ x: x - half, y: y - half, width: half * 2, height: half * 2 });

async function open(browser, storage) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((kept) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        for (const [key, value] of Object.entries(kept)) localStorage.setItem(key, value);
        sessionStorage.setItem('seeded', '1');
      }
    } catch (error) {
      // No storage: the run fails on what it expects next.
    }
  }, storage);
  // --nothread: no OffscreenCanvas, so FLUID runs on the page (the fallback where a browser cannot hand a canvas to a thread).
  if (process.argv.includes('--nothread')) await context.addInitScript('delete HTMLCanvasElement.prototype.transferControlToOffscreen;');
  // Nothing may reach the live database from here.
  await context.route(/supabase\.co/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/forum`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.backdrop-canvas', { timeout: 60000 });
  await sleep(1500);
  return { context, page, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run'] });
  try {
    console.log('FLUID, THE WINDOW THERE');
    let { context, page, errors } = await open(browser, { 'debaser.site.backdrop.v2': 'fluid' });
    const frame = await page.locator('[data-site-window="frame"]').boundingBox();
    assert.ok(frame !== null && frame.x > 50, `there is bare desk to the left of the site window (${frame && Math.round(frame.x)} pixels)`);
    const beside = { x: Math.round(frame.x / 2), y: 450 };
    const middle = { x: 720, y: 450 };
    const besideBefore = await drawn(page, round(beside.x, beside.y, 30));
    await page.mouse.click(beside.x, beside.y);
    await sleep(500);
    const besideAfter = await drawn(page, round(beside.x, beside.y, 30));
    assert.ok(besideAfter.count > besideBefore.count + 10, `a press on the desk beside the window makes ink there (${besideBefore.count} of ${besideBefore.cells} cells, then ${besideAfter.count})`);
    const middleBefore = await drawn(page, round(middle.x, middle.y));
    await page.mouse.click(middle.x, middle.y);
    await sleep(500);
    assert.ok((await drawn(page, round(middle.x, middle.y))).count <= middleBefore.count + 5, 'a press on the window makes none under it');
    pass('the window there: presses count on the bare desk only');

    console.log('THE WINDOW PUT AWAY');
    await page.locator('[data-hide-window-key]').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-site-hidden') === 'on' && document.querySelector('[data-site-window="frame"]').getBoundingClientRect().width === 0, null, { timeout: 8000 });
    await sleep(1500);
    const awayBefore = await drawn(page, round(middle.x, middle.y));
    await page.mouse.click(middle.x, middle.y);
    await sleep(500);
    const awayAfter = await drawn(page, round(middle.x, middle.y));
    assert.ok(awayAfter.count > awayBefore.count + 10, `a press where the window was makes ink there (${awayBefore.count} cells, then ${awayAfter.count})`);
    pass('put away: a press where the window was is a press on the background');
    const key = page.locator('[data-backdrop-key]');
    assert.ok(await key.isVisible(), 'the key on the background shows, though the screen is narrower than it needs beside a window');
    await key.click();
    await page.waitForSelector('[data-dock-window="aquarium"]', { timeout: 8000 });
    await page.keyboard.press('Escape').catch(() => undefined);
    pass('put away: the key on the background shows and opens its settings');
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    console.log('FILL WINDOW ON, AND PUT AWAY');
    ({ context, page, errors } = await open(browser, { 'debaser.site.backdrop.v2': 'fluid', 'debaser.shell.fill.v1': 'on', 'debaser.shell.hidden.v1': 'on' }));
    assert.equal(await page.evaluate(() => `${document.documentElement.getAttribute('data-site-fill')} ${document.documentElement.getAttribute('data-site-hidden')}`), 'on on', 'both marks are on the page');
    await page.mouse.click(middle.x, middle.y);
    await sleep(400);
    const first = await drawn(page, { x: 0, y: 0, width: 1440, height: 900 });
    await sleep(1500);
    const later = await drawn(page, { x: 0, y: 0, width: 1440, height: 900 });
    assert.ok(first.count > 10, `the press made ink (${first.count} cells)`);
    assert.notEqual(first.sum, later.sum, 'and the ink is moving: the background runs, it does not rest as if the filled window covered it');
    pass('FILL WINDOW on and put away: the background runs and takes presses');
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    console.log('SAND, PUT AWAY');
    ({ context, page, errors } = await open(browser, { 'debaser.site.backdrop.v2': 'sand', 'debaser.shell.hidden.v1': 'on' }));
    // Poured high up, above where the window stands when it is there: it must fall on through that space.
    await page.mouse.move(middle.x, 120);
    await page.mouse.down();
    await sleep(1500);
    await page.mouse.up();
    await sleep(2500);
    const through = await drawn(page, { x: middle.x - 150, y: 500, width: 300, height: 300 });
    assert.ok(through.count > 5, `sand poured above where the window was has fallen through that space (${through.count} cells of it there)`);
    pass('SAND, put away: nothing solid is left where the window was');

    console.log('THE WINDOW BROUGHT BACK');
    await page.locator('[data-restore-window] button').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-site-hidden') === null && document.querySelector('[data-site-window="frame"]').getBoundingClientRect().width > 0, null, { timeout: 8000 });
    await sleep(2500);
    const underBefore = await drawn(page, round(middle.x, 300));
    await page.mouse.click(middle.x, 300);
    await sleep(600);
    assert.ok((await drawn(page, round(middle.x, 300))).count <= underBefore.count + 5, 'a press on the window pours nothing under it');
    pass('brought back: the window is a window again');
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    console.log(`\n${passed} passed`);
  } catch (failure) {
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
