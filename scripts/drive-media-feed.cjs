/*
 * Drives MEDIA's default feed (SPEC-media-feed.md) in a real browser, on a local dev server with mock data only:
 *
 *   1. /media with nothing searched draws PICKED FOR YOU in blocks of 12, reading in places 4 and 10 of each block,
 *      never more than 2 reading rows in 12, and no YOUR YOUTUBE rows for a visitor;
 *   2. a reading row has its outlet key, opening in a new tab on a listed address, and no DISCUSS;
 *   3. LOAD MORE adds rows below and the rows already drawn stay where they were;
 *   4. a reload the same day draws the same first block;
 *   5. a search still shows no reading rows (searches are unchanged);
 *   6. (list 3) with `--pool-ready`: NEW TO YOU rows in places 6 and 12 and PEOPLE'S PICKS in place 7 once the catalogue
 *      has answered, and LOAD MORE is really pressed (`--need-more` fails the run without it);
 *   7. (list 3) WHERE FROM's READING group: its keys in the panel, NEWS shows news alone, a search in TECH finds tech alone,
 *      and POPULAR under a reading kind says PAPER: NO POPULARITY ORDER.
 *
 *   node scripts/drive-media-feed.cjs --base http://localhost:3316 --pool-ready --need-more
 *
 * Start the server with Temp/browse/dev-mock-feed.cjs (every data source on mock, Supabase empty). The drive aborts any
 * request to Supabase and fails if one was tried. For steps 3 and 6, Temp/browse/dev-mock-media.cjs does the same with
 * NEXT_PUBLIC_WEB_MOCK_PAGE=12: the mock stream is 22 rows, one page, so LOAD MORE never shows without smaller pages.
 * `--pool-ready`: the mock catalogue has 40 tagged rows, under the 10,000 that DISCOVER and RECOMMENDED wait for
 * (tag-station/picks.ts POOL_TARGET), so on a plain mock site NEW TO YOU and PEOPLE'S PICKS are always empty and their
 * places go to FOR YOU. The flag raises the catalogue's tagged count in this drive's browser only (its answer from
 * /api/tag-station/graph, nothing else changed), so the two lanes can be seen drawing.
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
  let poolRaised = 0;
  if (args.includes('--pool-ready')) {
    await context.route(/\/api\/tag-station\/graph/, async (route) => {
      const response = await route.fetch();
      const graph = await response.json();
      poolRaised += 1;
      await route.fulfill({ response, json: { ...graph, tagged: Math.max(graph.tagged ?? 0, 10_000) } });
    });
  }
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
  let drawn = before;
  if ((await more.count()) > 0) {
    // Up to three presses (list 3): each adds below, and nothing drawn before any press moves.
    for (let press = 1; press <= 3 && (await more.count()) > 0; press += 1) {
      const shownBefore = drawn;
      await more.click();
      await page.waitForFunction((count) => document.querySelectorAll('ul[aria-label="Items picked for you"] > li').length > count, shownBefore.length, { timeout: 60_000 });
      await page.waitForTimeout(1500);
      drawn = (await readRows(page)).map((row) => row.id);
      assert.deepEqual(drawn.slice(0, shownBefore.length), shownBefore, `press ${press}: the rows already drawn stay where they were`);
      pass(`LOAD MORE press ${press} added ${drawn.length - shownBefore.length} rows below; the ${shownBefore.length} drawn did not move`);
    }
    await page.screenshot({ path: join(SHOTS, 'feed-more-1440.png'), fullPage: true });
  } else if (args.includes('--need-more')) {
    throw new Error('no LOAD MORE key (start the server with Temp/browse/dev-mock-media.cjs)');
  } else {
    console.log('  NOTE no LOAD MORE: the mock stream fits on one page');
  }

  // 6. NEW TO YOU and PEOPLE'S PICKS on screen (list 3; `--pool-ready`, see the header).
  if (args.includes('--pool-ready')) {
    assert.ok(poolRaised > 0, 'the catalogue was asked (and its count raised in this browser)');
    const all = await readRows(page);
    console.log(`  after LOAD MORE: ${all.length} rows; lanes: ${all.map((row) => (row.reading ? `R:${row.reading}` : row.lane)).join(' ')}`);
    const at = (lane) => all.map((row, index) => (row.lane === lane ? index % 12 : null)).filter((place) => place !== null);
    const fresh = at('new');
    const people = at('people');
    assert.ok(fresh.length > 0, 'NEW TO YOU rows are drawn');
    assert.ok(people.length > 0, "PEOPLE'S PICKS rows are drawn");
    // PEOPLE'S PICKS only ever takes its own place. NEW TO YOU holds places 6 and 12 of every whole block from the first one
    // it joins (a late source joins from the next block not yet started); once FOR YOU runs dry (the mock stream is 22
    // rows) it takes FOR YOU's places too, as the fill order says, so it is not held to 6 and 12 alone.
    assert.ok(people.every((place) => place === 6), `PEOPLE'S PICKS sits in place 7 (${people.map((p) => p + 1)})`);
    const firstNew = all.findIndex((row) => row.lane === 'new');
    for (let start = Math.floor(firstNew / 12) * 12; start + 12 <= all.length; start += 12) {
      if (start + 5 < firstNew) continue;
      assert.equal(all[start + 5].lane, 'new', `block ${start / 12 + 1}: place 6 is NEW TO YOU`);
      assert.equal(all[start + 11].lane, 'new', `block ${start / 12 + 1}: place 12 is NEW TO YOU`);
    }
    pass(`NEW TO YOU (${fresh.length} rows, places ${[...new Set(fresh.map((p) => p + 1))]}) and PEOPLE'S PICKS (${people.length}, place ${[...new Set(people.map((p) => p + 1))]}) drawn`);
    const titles = await page.$$eval('ul[aria-label="Items picked for you"] > li[data-feed-lane="new"], ul[aria-label="Items picked for you"] > li[data-feed-lane="people"]', (items) =>
      items.slice(0, 4).map((li) => `${li.getAttribute('data-feed-lane')}: ${(li.querySelector('p[id^="web-row-"]')?.textContent ?? '').slice(0, 60)}`),
    );
    console.log(`  e.g. ${titles.join(' | ')}`);
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

  // 7. WHERE FROM's READING group (list 3).
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  // The rows mean the page has hydrated: a press before that lands on the server's markup and does nothing.
  await page.waitForSelector(`${ROWS}[data-feed-lane]`, { timeout: 120_000 });
  if ((await page.getAttribute('[data-filters-key]', 'aria-expanded')) !== 'true') await page.click('[data-filters-key]');
  await page.waitForSelector('#media-filters-panel:not([hidden])', { timeout: 30_000 });
  const groupText = await page.$eval('#media-filters-panel', (panel) => panel.textContent ?? '');
  assert.ok(/READING:\s*\[ PAPERS \]\s*\[ NEWS \]\s*\[ LONG READS \]\s*\[ TECH \]/.test(groupText), `the panel has READING: PAPERS NEWS LONG READS TECH (${groupText.slice(groupText.indexOf('BOOKS:'), groupText.indexOf('BOOKS:') + 160)})`);
  pass('WHERE FROM shows READING: [ PAPERS ] [ NEWS ] [ LONG READS ] [ TECH ]');
  await page.getByRole('button', { name: 'Source: NEWS' }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label] > li[data-reading]').length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const newsRows = await page.$$eval('ul[aria-label^="Items"] > li[data-view], ul[aria-label^="Results"] > li[data-view]', (items) => items.map((li) => li.getAttribute('data-reading')));
  assert.ok(new URL(page.url()).searchParams.get('in') === 'news', `the address says in=news (${page.url()})`);
  assert.ok(newsRows.length > 0 && newsRows.every((kind) => kind === 'news'), `NEWS shows news alone (${newsRows.join(',')})`);
  assert.equal(await page.getByRole('button', { name: 'Source: NEWS' }).getAttribute('aria-pressed'), 'true', 'and its key is pressed');
  await page.screenshot({ path: join(SHOTS, 'reading-news-1440.png'), fullPage: false });
  pass(`NEWS: ${newsRows.length} news rows and nothing else; the key is pressed and the address says in=news`);
  await page.goto(`${BASE}/media?q=hackaday&in=tech`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label] > li[data-reading]').length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const techRows = await page.$$eval('ul[aria-label^="Items"] > li[data-view], ul[aria-label^="Results"] > li[data-view]', (items) => items.map((li) => [li.getAttribute('data-reading'), li.querySelector('[data-outlet-key]')?.textContent ?? '']));
  assert.ok(techRows.length > 0 && techRows.every(([kind]) => kind === 'tech'), `a search in TECH finds tech alone (${JSON.stringify(techRows)})`);
  pass(`"hackaday" in TECH: ${techRows.length} tech rows (${[...new Set(techRows.map(([, key]) => key))].join(' ')})`);
  await page.goto(`${BASE}/media?in=paper&sort=popular`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=PAPER: NO POPULARITY ORDER', { timeout: 60_000 });
  pass('POPULAR under PAPERS says PAPER: NO POPULARITY ORDER');

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
