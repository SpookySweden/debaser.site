/*
 * MODULOS lists the bar's always-on keys, and COMIC is an ordinary module (Luke, 2026-11-21: "in modulos show the other 'always
 * ons' such as 'search, desk, reports if applicable,' make comic no longer always on"). Driven on a LOCAL mock dev server only
 * (Temp/browse/dev-mock-desk.cjs: every switch on mock, sign-in mock, Supabase address empty). Live hosts are blocked and counted.
 *
 *   node scripts/drive-modulos-always.cjs --base http://localhost:<port> [--out Temp/browse/modulos-always] [--comic-starts on|off]
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3361');
const OUT = opt('--out', join('Temp', 'browse', 'modulos-always'));
/** Whether a first visit's bar should carry COMIC (Luke's answer decides; `off` is SPEC-comic Q1A reversed). */
const COMIC_STARTS = opt('--comic-starts', 'off') === 'on';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

function seed({ signedIn }) {
  if (window.localStorage.getItem('ma-seeded') !== null) return;
  window.localStorage.setItem('ma-seeded', '1');
  const at = new Date(Date.now() - 60000).toISOString();
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  // The desk's day already had, so it stays shut.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  window.localStorage.setItem('debaser.desk.opened-day.v1', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  if (!signedIn) return;
  const me = { id: 'modulos-me', name: 'MODULOSREADER' };
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [{ id: me.id, email: `${me.id}@debaser.site`, displayName: me.name, createdAt: at, salt: '', secretHash: '', hidden: true }], sessionUserId: me.id, bannedIds: [] }));
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: { userId: me.id, displayName: me.name, bio: '', tags: [], comments: [], updatedAt: at, privacySeen: true } } }));
}

async function newContext(browser, signedIn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app|api\.debaser\.site/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { signedIn });
  return { context, liveHits: () => live };
}

async function forumReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 180000 });
  await sleep(2500);
}
const barWords = (page) => page.locator('nav[aria-label="Modules"] a').allInnerTexts().then((texts) => texts.map((text) => text.trim().replace(/\s+/g, ' ')));
const openModulos = async (page) => {
  await page.locator('[data-tour="modulos"]').click({ timeout: 5000 });
  await page.locator('[data-dock-window="modules"]').waitFor({ timeout: 10000 });
  await sleep(400);
};
const alwaysRows = (page) => page.locator('[data-dock-window="modules"] [data-always-on]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-always-on')));

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let liveTotal = 0;
  try {
    console.log('1. An account');
    let { context, liveHits } = await newContext(browser, true);
    let page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    const first = await barWords(page);
    check(first.includes('COMIC') === COMIC_STARTS, `a first visit's bar ${COMIC_STARTS ? 'carries' : 'leaves out'} COMIC`, first.join(','));
    try {
      await openModulos(page);
      const rows = await alwaysRows(page);
      check(['arrows', 'search', 'desk', 'window'].every((key) => rows.includes(key)), 'MODULOS lists the always-on keys: the arrows, SEARCH, DESK, the window keys', rows.join(','));
      check(!rows.includes('reports'), 'REPORTS is not listed for someone who is not a moderator', rows.join(','));
      const lockedText = (await page.locator('[data-dock-window="modules"] [data-always-on="search"]').textContent()).replace(/\s+/g, ' ');
      check(/⌕ SEARCH/.test(lockedText) && /ALWAYS ON/.test(lockedText), 'each says ALWAYS ON', lockedText);
      check((await page.locator('[data-dock-window="modules"] [data-always-on] button:not([disabled])').count()) === 0, 'and none can be unticked');
      await page.locator('[data-dock-window="modules"] [data-always-on="window"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, 'modulos.png') });
      const comicTick = page.locator('[data-dock-window="modules"] button[role="checkbox"]', { hasText: 'COMIC' }).first();
      check((await comicTick.isDisabled()) === false && !/ALWAYS ON/.test(await comicTick.textContent()), 'COMIC is an ordinary tick');
      // Tick it on if it starts off, then off: the bar follows, and the choice is kept.
      if ((await comicTick.getAttribute('aria-checked')) !== 'true') {
        await comicTick.click();
        await sleep(500);
        check((await barWords(page)).includes('COMIC'), 'ticking COMIC puts it on the bar');
      }
      await comicTick.click();
      await sleep(500);
      check(!(await barWords(page)).includes('COMIC'), 'unticking COMIC takes it off the bar');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await forumReady(page);
      check(!(await barWords(page)).includes('COMIC'), 'and it stays off after a reload');
    } catch (error) {
      failed += 1;
      console.log(`  FAIL part 1 stopped: ${error.message.split('\n')[0]}`);
    }
    liveTotal += liveHits();
    await context.close();

    console.log('2. A visitor');
    ({ context, liveHits } = await newContext(browser, false));
    page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    try {
      await openModulos(page);
      const rows = await alwaysRows(page);
      check(rows.includes('search') && !rows.includes('desk'), 'a visitor sees SEARCH listed but no DESK (a visitor has no desk)', rows.join(','));
    } catch (error) {
      failed += 1;
      console.log(`  FAIL part 2 stopped: ${error.message.split('\n')[0]}`);
    }
    liveTotal += liveHits();
    await context.close();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL the run stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  check(liveTotal === 0, 'nothing reached the live site', `${liveTotal} requests`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
