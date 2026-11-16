/*
 * FORUMBITS (Luke's list 4, from a Claude test run he passed on). On a LOCAL mock dev server only (core.md, "Test
 * locally"): no sign-in, no database; the live database is blocked and the run fails if anything asked it.
 *
 *   node scripts/drive-forumbits.cjs --base http://localhost:<port> [--out Temp/browse/forumbits]
 *
 *   1. A post written `**bold** *italic* https://example.com/x #testtag` shows bold, italic, a link that opens in a
 *      new tab with noopener, and #testtag as a link to the board's tag filter; TESTTAG is among the post's tags.
 *   2. PREFERENCES, saved open on top of "+ NEW POST", is moved off it when the board opens (Luke's 4B); it stays open
 *      across a page change and is still off the key back on the board; dragged onto the key, it hops off.
 *   3. The profile tab: the house account by name, an unknown id as plain words, never the id.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3319');
const OUT = opt('--out', join('Temp', 'browse', 'forumbits'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

async function newPage(browser, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    live += 1;
    return route.abort();
  });
  if (init !== undefined) await context.addInitScript(init.script, init.arg);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`  ..  console error: ${msg.text().slice(0, 200)}`); });
  return { context, page, liveHits: () => live };
}

async function until(what, read, test, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await read();
    if (test(last)) return last;
    await sleep(200);
  }
  throw new Error(`timed out: ${what} (last: ${JSON.stringify(last)})`);
}

/** A box by selector; `NEW_POST` is found by its words, so the drive reads the same key on the old code. */
const box = (page, selector) =>
  page.evaluate((sel) => {
    const element =
      sel === 'NEW_POST'
        ? [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '+ NEW POST' && b.closest('[role="dialog"]') === null) ?? null
        : document.querySelector(sel);
    if (element === null) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);
const overlap = (a, b) => a !== null && b !== null && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const NEW_POST = 'NEW_POST';
const PREFS = '[data-dock-window="preferences"]';

async function formatting(browser) {
  console.log('post formatting and #tags');
  const { context, page, liveHits } = await newPage(browser);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '+ NEW POST' }).waitFor({ timeout: 90000 });
  await sleep(1000);
  await page.getByRole('button', { name: '+ NEW POST' }).click();
  await page.locator('#new-post-title').fill('Formatting drive');
  await page.locator('#new-post-body').fill('**bold words** and *slanted* see https://example.com/x. #testtag');
  await page.getByText('AUTO TAGS:').waitFor({ timeout: 5000 });
  assert.ok((await page.getByRole('dialog', { name: 'NEW POST' }).innerText()).toLowerCase().includes('testtag'), 'the composer shows #testtag will be filed');
  pass('the composer lists TESTTAG among the tags it will file');
  await page.getByRole('button', { name: '[ FILE POST ]' }).click();

  const row = page.locator('details').filter({ hasText: 'Formatting drive' }).first();
  await row.waitFor({ timeout: 10000 });
  const summary = row.locator(':scope > summary');
  // A new post may come up open: fold it to read the collapsed row's band, then open it again.
  if ((await row.getAttribute('open')) !== null) await summary.click();
  await until('the row folds', () => row.getAttribute('open'), (v) => v === null, 5000);
  const collapsed = await summary.evaluate((element) => element.textContent ?? '');
  assert.ok(collapsed.includes('bold words and slanted'), `the collapsed row carries the words: ${collapsed}`);
  assert.doesNotMatch(collapsed, /\*\*|\*slanted/, `the collapsed row shows no stars: ${collapsed}`);
  pass('the collapsed row shows the words without stars');
  await summary.click();
  await row.locator('strong', { hasText: 'bold words' }).waitFor({ timeout: 5000 });
  assert.equal(await row.locator('em', { hasText: 'slanted' }).count(), 1, 'italic');
  const link = row.locator('a[href="https://example.com/x"]');
  assert.equal(await link.count(), 1, 'the link');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.match((await link.getAttribute('rel')) ?? '', /noopener/);
  assert.match((await link.getAttribute('rel')) ?? '', /noreferrer/);
  const tag = row.locator('a[href="/forum#tag-testtag"]', { hasText: '#testtag' });
  assert.equal(await tag.count(), 1, 'the #tag in the words links to the tag filter');
  const text = await row.innerText();
  assert.doesNotMatch(text, /\*\*bold|\*slanted\*/, 'no stars on screen');
  assert.ok(/TESTTAG|tag:testtag|user:testtag/i.test(text), `the post wears its tag: ${text.slice(0, 300)}`);
  pass('the open post shows bold, italic, a safe new-tab link, a #tag link, and wears TESTTAG');
  await page.screenshot({ path: join(OUT, 'post.png') });

  // The #tag filters the board to it.
  await tag.click();
  await until('the board narrows to TESTTAG', () => page.locator('body').innerText(), (t) => /testtag/i.test(t) && t.includes('Formatting drive'), 8000);
  pass('pressing #testtag filters the board to the post');
  assert.equal(liveHits(), 0, 'nothing reached the live database');
  await context.close();
}

async function preferences(browser) {
  console.log('PREFERENCES keeps off + NEW POST');
  // Saved open, on top of where + NEW POST sits on a 1440 x 900 screen (where the test run found it).
  const seeded = { x: 880, y: 120, w: 384, h: 620 };
  const layout = { standard: { screen: { w: 1440, h: 900 }, windows: { preferences: { rect: seeded, group: null, open: true, restore: null } }, order: ['preferences'] } };
  const { context, page, liveHits } = await newPage(browser, {
    script: (saved) => {
      try {
        if (sessionStorage.getItem('forumbits.seeded') === null) {
          localStorage.setItem('debaser.windows.guest.v1', saved);
          sessionStorage.setItem('forumbits.seeded', '1');
        }
      } catch {}
    },
    arg: JSON.stringify(layout),
  });
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '+ NEW POST' }).waitFor({ timeout: 90000 });
  await page.locator(PREFS).waitFor({ timeout: 15000 });
  const key = await box(page, NEW_POST);
  const seededBox = { left: seeded.x, top: seeded.y, right: seeded.x + seeded.w, bottom: seeded.y + seeded.h };
  assert.ok(overlap(seededBox, key), `the saved place covers + NEW POST (key ${JSON.stringify(key)}): the test means something`);
  await until('PREFERENCES moves off + NEW POST', async () => [await box(page, PREFS), await box(page, NEW_POST)], ([p, k]) => p !== null && !overlap(p, k), 5000);
  const moved = await box(page, PREFS);
  assert.ok(Math.round(moved.right - moved.left) === seeded.w, `it keeps its width: ${JSON.stringify(moved)}`);
  pass(`PREFERENCES opens off + NEW POST (moved to ${Math.round(moved.left)},${Math.round(moved.top)})`);
  await page.screenshot({ path: join(OUT, 'prefs-board.png') });

  // Another page, by the top bar (no reload): still open.
  await page.locator('a[href="/media"]').first().click();
  await page.waitForURL(/\/media/, { timeout: 30000 });
  await page.locator(PREFS).waitFor({ timeout: 10000 });
  pass('PREFERENCES stays open on the next page');
  await page.locator('a[href="/forum"]').first().click();
  await page.waitForURL(/\/forum/, { timeout: 30000 });
  await page.getByRole('button', { name: '+ NEW POST' }).waitFor({ timeout: 30000 });
  await sleep(1200);
  assert.ok(!overlap(await box(page, PREFS), await box(page, NEW_POST)), 'back on the board it is still off the key');
  pass('back on the board, still open and still off + NEW POST');

  // Dragged by its title line onto the key, it hops off when dropped.
  const title = page.locator(`${PREFS} .cursor-move`).first();
  const titleBox = (await title.count()) > 0 ? await title.boundingBox() : null;
  const p = await box(page, PREFS);
  const grabX = titleBox !== null ? titleBox.x + 40 : p.left + 40;
  const grabY = titleBox !== null ? titleBox.y + titleBox.height / 2 : p.top + 10;
  const k = await box(page, NEW_POST);
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 20, grabY + 5, { steps: 3 });
  await page.mouse.move(k.left - 30 + (grabX - p.left), k.top - 10 + (grabY - p.top), { steps: 10 });
  const during = await box(page, PREFS);
  await page.mouse.up();
  if (overlap(during, k)) {
    await until('it hops off after the drop', async () => [await box(page, PREFS), await box(page, NEW_POST)], ([a, b]) => !overlap(a, b), 3000);
    pass('dragged onto + NEW POST, it hops off when dropped');
  } else {
    console.log(`  ..  the drag did not reach the key (window at ${JSON.stringify(during)}); drop step not shown`);
  }
  await page.screenshot({ path: join(OUT, 'prefs-after-drop.png') });
  assert.equal(liveHits(), 0, 'nothing reached the live database');
  await context.close();
}

async function profileTitles(browser) {
  console.log('profile tab titles');
  const { context, page, liveHits } = await newPage(browser);
  await page.goto(`${BASE}/profile/debaser-site`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'DEBASER.SITE - Profile :: debaser.site');
  pass('the house account\'s tab: "DEBASER.SITE - Profile :: debaser.site"');
  const id = '44661640-1234-4abc-8def-0123456789ab';
  await page.goto(`${BASE}/profile/${id}`, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  assert.equal(title, 'DEBASER.SITE - Profile');
  assert.ok(!title.includes('44661640'));
  pass('an account the server cannot name: "DEBASER.SITE - Profile", no id');
  assert.equal(liveHits(), 0, 'nothing reached the live database');
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run'] });
  try {
    if (!args.includes('--skip-post')) await formatting(browser);
    await preferences(browser);
    await profileTitles(browser);
  } finally {
    await browser.close();
  }
  console.log(`DRIVE PASSED: ${passed} steps`);
})().catch((error) => {
  console.error(`DRIVE FAILED after ${passed} steps:`, error.message);
  process.exit(1);
});
