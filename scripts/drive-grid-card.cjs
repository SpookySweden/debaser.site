/*
 * MEDIA's GRID cards (list 4, GRIDCARD; Luke, 2026-11-17, from his laptop: "the details of the video such as youtube- video -
 * date should take one line then the rest of the buttons too should be one line fitting the < . > on the end of the play
 * and queue buttons"). On a local dev server with mock data only, at several window widths, every GRID card on /media:
 *
 *   1. its facts line (KIND · DATE since MEDIACARD, 2026-11-17: the source waits behind the arrow) is ONE line, inside the
 *      card, never under 13px;
 *   2. its keys (`[ ▶ PLAY | + QUEUE | ▾ ]`, the arrow drawn inside the key) sit on ONE line, inside the card;
 *   3. LIST view is untouched: its rows still put the facts and the keys on one line where they fit, as before.
 *
 *   node scripts/drive-grid-card.cjs --base http://localhost:3321 [--shots]
 *
 * Start the server with every data source on mock and the Supabase address and key empty (a node launcher, see
 * Temp/browse/dev-mock-gridcard.cjs). The drive aborts any request to Supabase and fails if one was tried.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3321');
const SHOTS = join('Temp', 'browse', 'grid-card');
mkdirSync(SHOTS, { recursive: true });
// The laptop's MEDIA window (about 1065 wide, cards about 185), the narrowest 4-across window, a common laptop, the desktop.
const WIDTHS = (opt('--widths', '1024,1065,1280,1366,1920')).split(',').map(Number);

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/** Each card's facts and keys, measured in the page: the tops of what is drawn, and whether it stays inside the card. */
const measure = (page) =>
  page.$$eval('li[data-view="grid"]', (cards) =>
    cards
      .filter((li) => li.querySelector('[data-row-facts]') && li.offsetParent !== null)
      .map((li) => {
        const card = li.getBoundingClientRect();
        const facts = li.querySelector('[data-row-facts]');
        const keys = li.querySelector('[data-row-keys]');
        const boxes = (el) =>
          [...el.querySelectorAll('*')]
            .filter((n) => n.children.length === 0 || n.matches('button, a'))
            .map((n) => n.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
        // A line of text can wrap inside one span: its client rects say so.
        const lineTops = (el) => {
          const tops = new Set();
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top + r.height / 2));
          }
          return [...tops];
        };
        const spread = (tops) => (tops.length === 0 ? 0 : Math.max(...tops) - Math.min(...tops));
        const factsTops = lineTops(facts);
        const keyBoxes = boxes(keys);
        const keyMid = keyBoxes.map((r) => Math.round(r.top + r.height / 2));
        const smallest = Math.min(...[facts, ...facts.querySelectorAll('*'), ...keys.querySelectorAll('*')].map((n) => parseFloat(getComputedStyle(n).fontSize)));
        const right = Math.max(...[...boxes(facts), ...keyBoxes].map((r) => r.right));
        return {
          title: li.querySelector('p[id^="web-row-"]')?.textContent?.slice(0, 30) ?? '',
          width: Math.round(card.width),
          facts: facts.textContent,
          factsShown: facts.scrollWidth <= facts.clientWidth + 1 ? 'whole' : 'cut',
          factsSpread: spread(factsTops),
          keys: keys.textContent,
          keysSpread: spread(keyMid),
          split: keys.querySelector('[data-split-key]') !== null,
          // With the rest folded, every key on the line: the arrow included.
          shut: keys.querySelector('[data-more-keys="shut"]') !== null,
          inside: right <= card.right + 1,
          smallest,
        };
      }),
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
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.localStorage.setItem('debaser.media.view.v1', 'grid'));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('li[data-view="grid"] [data-row-facts]', { timeout: 90_000 });
    await page.waitForTimeout(800);
    const cards = await measure(page);
    assert.ok(cards.length >= 4, `at least four GRID cards at ${width} (found ${cards.length})`);
    const widths = cards.map((c) => c.width);
    console.log(`window ${width}: ${cards.length} cards, ${Math.min(...widths)}-${Math.max(...widths)}px wide`);
    const bad = (key) => cards.filter(key);
    const factsBad = bad((c) => c.factsSpread > 3);
    check(factsBad.length === 0, `facts on one line in every card${factsBad.length ? `: ${factsBad.slice(0, 3).map((c) => `"${c.facts}" (${c.width}px)`).join(', ')}` : ''}`);
    const playCards = cards.filter((c) => c.split && c.shut);
    const keysBad = playCards.filter((c) => c.keysSpread > 3);
    // Luke's laptop card holds `[ ▶ PLAY│+ QUEUE ]` on one line today, so it is at least 159px wide; the joined key needs about
    // 156. Narrower than that (a 1024 window: 149) it may fold inside the card, as before, but never spill out of it.
    if (Math.min(...widths) < 158) console.log(`       cards under 158px: PLAY | QUEUE may take two lines here (inside the card)`);
    else check(playCards.length >= 4 && keysBad.length === 0, `PLAY | QUEUE and the arrow on one line in every card that has them (${playCards.length - keysBad.length}/${playCards.length})${keysBad.length ? `: ${keysBad.slice(0, 3).map((c) => `"${c.keys}" (${c.width}px)`).join(', ')}` : ''}`);
    const otherWrapped = cards.filter((c) => !c.split && c.keysSpread > 3);
    if (otherWrapped.length) console.log(`       not PLAY | QUEUE, two lines: ${otherWrapped.map((c) => `"${c.keys}"`).join(', ')}`);
    const outside = bad((c) => !c.inside);
    check(outside.length === 0, `facts and keys stay inside the card${outside.length ? `: ${outside.slice(0, 3).map((c) => c.title).join(', ')}` : ''}`);
    const small = bad((c) => c.smallest < 13);
    check(small.length === 0, `nothing under 13px${small.length ? `: ${small[0].smallest}px` : ''}`);
    const cut = cards.filter((c) => c.factsShown === 'cut').length;
    if (cut) console.log(`       ${cut} card(s) cut the facts line with an ellipsis`);
    if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, `grid-${width}.png`) });
  }

  // LIST view untouched: the facts and the keys still share their row's line at the desktop width.
  await page.evaluate(() => window.localStorage.setItem('debaser.media.view.v1', 'list'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('li[data-view="list"] [data-row-facts]', { timeout: 90_000 });
  await page.waitForTimeout(800);
  const listRows = await page.$$eval('li[data-view="list"]', (rows) =>
    rows
      .filter((li) => li.querySelector('[data-row-facts]') && li.querySelector('[data-row-keys] button'))
      .map((li) => {
        const f = li.querySelector('[data-row-facts]').getBoundingClientRect();
        const k = li.querySelector('[data-row-keys]').getBoundingClientRect();
        const fs = getComputedStyle(li.querySelector('[data-row-facts]'));
        return { sameLine: Math.abs(f.top + f.height / 2 - (k.top + k.height / 2)) < 6, wrap: fs.flexWrap, ellipsis: fs.textOverflow };
      }),
  );
  check(listRows.length > 0 && listRows.every((r) => r.sameLine), `LIST: facts and keys share one line (${listRows.filter((r) => r.sameLine).length}/${listRows.length})`);
  check(listRows.every((r) => r.wrap === 'wrap' && r.ellipsis !== 'ellipsis'), 'LIST: the facts line still wraps as before, never cut');
  if (args.includes('--shots')) await page.screenshot({ path: join(SHOTS, 'list-1440.png') });

  await browser.close();
  check(supabaseTried === 0, `no request reached Supabase (${supabaseTried})`);
  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `ok: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
