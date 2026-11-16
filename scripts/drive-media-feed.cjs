/*
 * Drives MEDIA's default feed (SPEC-media-feed.md) in a real browser, on a local dev server with mock data only:
 *
 *   1. /media with nothing searched draws PICKED FOR YOU in blocks of 12, reading in places 4 and 10 of each block,
 *      never more than 2 reading rows in 12, and no YOUR YOUTUBE rows for a visitor;
 *   2. a reading row has its outlet key, opening in a new tab on a listed address, and no DISCUSS;
 *   3. LOAD MORE adds rows below and the rows already drawn stay where they were;
 *   4. a reload the same day draws the same first block;
 *   5. a search still shows no reading rows (searches are unchanged).
 *
 *   node scripts/drive-media-feed.cjs --base http://localhost:3317
 *
 * Start the server with Temp/browse/dev-mock-feed.cjs (every data source on mock, Supabase empty). The drive aborts any
 * request to Supabase and fails if one was tried.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317');
const SHOTS = join('Temp', 'browse', 'media-feed');
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const ROWS = 'ul[aria-label="Items picked for you"] > li';
const readRows = (page) =>
  page.$$eval(ROWS, (items) =>
    items.map((li) => ({
      id: li.querySelector('p[id^="web-row-"]')?.id ?? '',
      lane: li.getAttribute('data-feed-lane'),
      reading: li.getAttribute('data-reading'),
      outlet: li.querySelector('[data-outlet-key]')?.textContent ?? null,
      href: li.querySelector('[data-outlet-key]')?.getAttribute('href') ?? null,
      target: li.querySelector('[data-outlet-key]')?.getAttribute('target') ?? null,
      discuss: li.querySelector('[data-discuss-key]') !== null,
    })),
  );

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let supabaseTried = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    supabaseTried += 1;
    return route.abort();
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));

  // 1. The first blocks.
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForSelector(`${ROWS}[data-feed-lane]`, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const rows = await readRows(page);
  console.log(`  rows drawn: ${rows.length}; lanes: ${rows.slice(0, 24).map((row) => (row.reading ? `R:${row.reading}` : row.lane)).join(' ')}`);
  assert.ok(rows.length >= 12, `at least one whole block (${rows.length})`);
  assert.ok(rows.every((row) => row.lane !== null), 'every row says which source placed it');
  pass('PICKED FOR YOU draws the mixed feed');
  for (let start = 0; start + 12 <= rows.length; start += 12) {
    const block = rows.slice(start, start + 12);
    assert.ok(block.filter((row) => row.lane === 'reading').length <= 2, `block ${start / 12 + 1}: at most 2 reading rows`);
    assert.equal(block[3].lane, 'reading', `block ${start / 12 + 1}: place 4 is reading`);
    assert.equal(block[9].lane, 'reading', `block ${start / 12 + 1}: place 10 is reading`);
  }
  pass('reading sits in places 4 and 10 of every block, never more than 2 in 12');
  assert.ok(!rows.some((row) => row.lane === 'youtube'), 'a visitor gets no YOUR YOUTUBE rows');
  pass('no YOUR YOUTUBE rows for a visitor');
  const kinds = new Set(rows.filter((row) => row.reading).map((row) => row.reading));
  assert.ok(kinds.size >= 2, `the reading kinds take turns (${[...kinds].join(', ')})`);
  pass(`the reading kinds take turns: ${[...kinds].join(', ')}`);

  // 2. A reading row's keys.
  const reading = rows.filter((row) => row.reading);
  for (const row of reading) {
    assert.ok(row.outlet && /^\[ .+ ↗ \]$/.test(row.outlet), `${row.id}: an outlet key (${row.outlet})`);
    assert.equal(row.target, '_blank', `${row.id}: opens in a new tab`);
    assert.ok(row.href && row.href.startsWith('https://'), `${row.id}: an https link (${row.href})`);
    assert.equal(row.discuss, false, `${row.id}: no DISCUSS`);
  }
  pass(`reading rows: outlet key, new tab, https, no DISCUSS (${reading.map((row) => row.outlet).slice(0, 4).join(' ')})`);
  await page.screenshot({ path: join(SHOTS, 'feed-1440.png'), fullPage: false });

  // 3. LOAD MORE.
  const before = rows.map((row) => row.id);
  const more = page.getByRole('button', { name: '[ LOAD MORE ]' });
  if ((await more.count()) > 0) {
    await more.click();
    await page.waitForFunction((count) => document.querySelectorAll('ul[aria-label="Items picked for you"] > li').length > count, before.length, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const after = (await readRows(page)).map((row) => row.id);
    assert.deepEqual(after.slice(0, before.length), before, 'the rows already drawn stay where they were');
    pass(`LOAD MORE added ${after.length - before.length} rows below; the ${before.length} drawn did not move`);
  } else {
    console.log('  NOTE no LOAD MORE: the mock stream fits on one page');
  }

  // 4. Same list on a reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${ROWS}[data-feed-lane]`, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const again = (await readRows(page)).map((row) => row.id);
  assert.deepEqual(again.slice(0, 12), before.slice(0, 12), 'the first block is the same on a reload');
  pass('a reload the same day draws the same first block');

  // 5. A search is unchanged: no reading rows.
  await page.fill('#web-search', 'mock');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const searched = await page.$$eval('li[data-reading]', (items) => items.length);
  assert.equal(searched, 0, 'a search shows no reading rows');
  pass('a search shows no reading rows');

  assert.equal(supabaseTried, 0, 'nothing tried to reach Supabase');
  pass('nothing reached Supabase');
  assert.deepEqual(problems, [], `no page errors: ${problems.join(' | ')}`);
  pass('no page errors');
  await browser.close();
  console.log(`drive-media-feed: ${passed} passed`);
})().catch((error) => {
  console.log(`FAIL ${error && error.message ? error.message : error}`);
  process.exit(1);
});
