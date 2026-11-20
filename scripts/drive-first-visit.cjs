/*
 * FIRSTVISIT (Luke, 2026-11-20: "Gentler first visits: replace the full-page 'HAD AN ACCOUNT?' pop-up with a short guided tour
 * of the desktop"). Driven on a LOCAL mock dev server only (scripts/dev-mock-live.cjs: every switch on mock, sign-in mock,
 * Supabase address empty); live hosts are blocked and counted.
 *
 *   node scripts/drive-first-visit.cjs --base http://localhost:<port> [--out Temp/browse/first-visit]
 *
 * A visitor's first visit: seven steps on the board, each one outlining its thing; DONE remembers; a reload stays quiet.
 * SKIP and Esc remember too. MODULOS' TOUR key plays it again, from another page too. Under reduced motion the outline
 * holds still; nothing eases. An existing account is not toured; a new account is toured after its PRIVACY window, with
 * DESK in place of LOG IN. No sideways scroll at phone width while it shows.
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3351');
const OUT = opt('--out', join('Temp', 'browse', 'first-visit'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const VISITOR_STEPS = ['board', 'modules', 'search', 'login', 'modulos', 'shelf', 'music'];
const ACCOUNT_STEPS = ['board', 'modules', 'search', 'desk', 'modulos', 'shelf', 'music'];

/** Runs before every page: the seeded mock account (or none), once per context. */
function seed({ account }) {
  if (window.localStorage.getItem('fv-seeded') !== null) return;
  window.localStorage.setItem('fv-seeded', '1');
  if (account === null) return;
  const at = new Date(Date.now() - 60000).toISOString();
  const user = { id: account.id, email: `${account.id}@debaser.site`, displayName: account.name, createdAt: at, salt: '', secretHash: '', hidden: true };
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: account.id, bannedIds: [] }));
  const profile = { userId: account.id, displayName: account.name, bio: '', tags: [], comments: [], updatedAt: at, privacySeen: account.privacySeen };
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [account.id]: profile } }));
}

async function newPage(browser, { account = null, reducedMotion = 'no-preference', width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|api\.debaser\.site|\/\/debaser\.site|vercel\.app/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { account });
  const page = await context.newPage();
  return { context, page, liveHits: () => live };
}

const card = (page) => page.locator('[data-tour-card]');
const cardId = (page) => card(page).getAttribute('data-tour-card', { timeout: 2000 }).catch(() => null);
const said = (page) => page.evaluate(() => window.localStorage.getItem('debaser.tour.v1'));

async function openBoard(page, path = '/forum') {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 240000 }).catch(() => undefined);
}

async function waitForCard(page, ms = 15000) {
  return card(page).waitFor({ timeout: ms }).then(() => true, () => false);
}

/** The outline sits round the step's own thing (within the hole's margin), and the card is on screen. */
async function outlineFits(page) {
  return page.evaluate(() => {
    const outline = document.querySelector('[data-tour-outline]');
    const box = document.querySelector('[data-tour-card]');
    if (!outline || !box) return 'no outline or card';
    const id = outline.getAttribute('data-tour-outline');
    const targets = { board: '[data-tour="board"]', modules: 'nav[aria-label="Modules"]', search: '[data-search-key]', login: '[data-tour="login"]', desk: '[data-desk-key]', modulos: '[data-tour="modulos"]', shelf: '[data-tour="shelf"]', music: '[data-tour="music"]' };
    const target = [...document.querySelectorAll(targets[id])].find((el) => el.getBoundingClientRect().width > 0);
    if (!target) return `no target for ${id}`;
    const t = target.getBoundingClientRect();
    const o = outline.getBoundingClientRect();
    const c = box.getBoundingClientRect();
    const round = o.left <= t.left && o.top <= t.top && o.right >= t.right && o.bottom >= t.bottom && o.left >= t.left - 12 && o.top >= t.top - 12;
    const onScreen = c.left >= 0 && c.top >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight;
    return round && onScreen ? 'ok' : `outline ${Math.round(o.left)},${Math.round(o.top)} ${Math.round(o.width)}x${Math.round(o.height)} target ${Math.round(t.left)},${Math.round(t.top)} ${Math.round(t.width)}x${Math.round(t.height)} card on screen ${onScreen}`;
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let liveTotal = 0;

  // 1. A visitor's first visit: seven steps, DONE remembers, a reload stays quiet.
  console.log('1. a visitor\'s first visit');
  {
    const { context, page, liveHits } = await newPage(browser);
    await openBoard(page);
    check(await waitForCard(page), 'the tour opens on the board for a first visit');
    check((await page.getByRole('dialog', { name: 'HAD AN ACCOUNT?' }).count()) === 0, 'no full-page HAD AN ACCOUNT? pop-up');
    const seen = [];
    for (let i = 0; i < 9; i += 1) {
      const id = await cardId(page);
      if (id === null) break;
      seen.push(id);
      const counter = await card(page).locator('h2 + span').textContent();
      check(counter === `${seen.length}/7`, `step ${id} says ${seen.length}/7`, counter ?? '');
      const fits = await outlineFits(page);
      check(fits === 'ok', `step ${id}: outlined round its thing, card on screen`, fits === 'ok' ? '' : fits);
      const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-tour-next') ?? false);
      check(focused, `step ${id}: the main key has the focus`);
      await page.screenshot({ path: join(OUT, `visitor-${seen.length}-${id}.png`) });
      if (i === 1) {
        // BACK goes back a step and forward again.
        await card(page).getByRole('button', { name: '[ ◄ BACK ]' }).click();
        check((await cardId(page)) === 'board', 'BACK returns to the board step');
        await page.locator('[data-tour-next]').click();
      }
      await page.locator('[data-tour-next]').click();
    }
    check(JSON.stringify(seen) === JSON.stringify(VISITOR_STEPS), 'the visitor\'s seven steps, in order', seen.join(' '));
    check((await page.locator('[data-tour-layer]').count()) === 0, 'DONE closes the tour');
    check((await said(page)) === 'done', 'DONE is remembered', String(await said(page)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 120000 });
    check(!(await waitForCard(page, 6000)), 'a reload after DONE: no tour');

    // 3. MODULOS' TOUR key plays it again, from another page too.
    console.log('3. replay from MODULOS');
    await page.locator('[data-tour="modulos"]').click();
    await page.locator('[data-tour-replay]').click();
    check(await waitForCard(page), 'TOUR in MODULOS plays it again on the board');
    check((await cardId(page)) === 'board', 'from the first step');
    await page.keyboard.press('Escape');
    check((await page.locator('[data-tour-layer]').count()) === 0, 'Esc ends the replay');
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.locator('[data-tour="modulos"]').waitFor({ timeout: 120000 });
    // The page may still be waking (a press before it is ready does nothing): press until the window is there.
    for (let tries = 0; tries < 10 && (await page.locator('[data-tour-replay]').count()) === 0; tries += 1) {
      await page.locator('[data-tour="modulos"]').click();
      await sleep(2000);
    }
    await page.locator('[data-tour-replay]').click();
    await page.waitForURL(/\/forum/, { timeout: 120000 });
    check(await waitForCard(page, 60000), 'TOUR pressed on MEDIA goes to the board and plays it');
    await page.locator('[data-tour-skip]').click();
    liveTotal += liveHits();
    await context.close();
  }

  // 2. SKIP and Esc remember; nothing eases; reduced motion holds the outline still.
  console.log('2. skip, Esc, motion');
  {
    const { context, page, liveHits } = await newPage(browser);
    await openBoard(page);
    await waitForCard(page);
    const motion = await page.evaluate(() => {
      const outline = getComputedStyle(document.querySelector('.tour-outline'));
      const box = getComputedStyle(document.querySelector('[data-tour-card]'));
      return { animation: outline.animationName, timing: outline.animationTimingFunction, transition: box.transitionDuration };
    });
    check(motion.animation === 'tour-blink' && /steps/.test(motion.timing), 'the outline blinks in whole frames', `${motion.animation} ${motion.timing}`);
    check(motion.transition === '0s', 'the card has no transition', motion.transition);
    // Tab stays in the card (step 2 has NEXT, BACK and SKIP).
    await page.locator('[data-tour-next]').click();
    const inCard = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      inCard.push(await page.evaluate(() => document.activeElement?.closest('[data-tour-card]') !== null));
    }
    check(inCard.every(Boolean), 'Tab keeps the focus in the tour card', inCard.join(' '));
    // Leaving the board mid-tour and coming back starts it afresh from the first step.
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    check((await page.locator('[data-tour-layer]').count()) === 0, 'no tour on MEDIA');
    await page.locator('nav[aria-label="Modules"] a[href="/forum"]').click();
    check(await waitForCard(page, 60000), 'back on the board, the unfinished tour plays again');
    check((await cardId(page)) === 'board', 'from the first step');
    check((await card(page).locator('h2 + span').textContent()) === '1/7', 'with all seven steps');
    await page.locator('[data-tour-skip]').click();
    check((await said(page)) === 'skipped', 'SKIP is remembered');
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(!(await waitForCard(page, 8000)), 'a reload after SKIP: no tour');
    liveTotal += liveHits();
    await context.close();
  }
  {
    const { context, page, liveHits } = await newPage(browser, { reducedMotion: 'reduce' });
    await openBoard(page);
    await waitForCard(page);
    const animation = await page.evaluate(() => getComputedStyle(document.querySelector('.tour-outline')).animationName);
    check(animation === 'none', 'under reduced motion the outline holds still', animation);
    await page.locator('[data-tour-next]').click();
    await page.keyboard.press('Escape');
    check((await said(page)) === 'skipped', 'Esc on step 2 is remembered as skipped');
    liveTotal += liveHits();
    await context.close();
  }

  // 4. Accounts: an existing one is not toured; a new one is toured after PRIVACY, with DESK.
  console.log('4. accounts');
  {
    const { context, page, liveHits } = await newPage(browser, { account: { id: 'fv-old', name: 'OLDHAND', privacySeen: true } });
    await openBoard(page);
    check(!(await waitForCard(page, 10000)), 'an existing account is not toured');
    liveTotal += liveHits();
    await context.close();
  }
  {
    const { context, page, liveHits } = await newPage(browser, { account: { id: 'fv-new', name: 'NEWCOMER', privacySeen: false } });
    await openBoard(page);
    const window = page.locator('[data-dock-window="privacy-first-look"]');
    const privacyShown = await window.waitFor({ state: 'attached', timeout: 60000 }).then(() => true, () => false);
    check(privacyShown, 'a new account sees its PRIVACY window first');
    await sleep(4000);
    check((await page.locator('[data-tour-layer]').count()) === 0, 'no tour while the PRIVACY window is open');
    // DESK may open docked over it in the mock: its own key, pressed directly.
    if (privacyShown) await window.getByRole('button', { name: /KEEP (IT PRIVATE|THESE SETTINGS)/ }).dispatchEvent('click');
    check(await waitForCard(page), 'the tour starts once PRIVACY is closed');
    const sidebarShown = await page.evaluate(() => [...document.querySelectorAll('[data-tour="shelf"]')].some((el) => el.getBoundingClientRect().width > 0));
    const expected = ACCOUNT_STEPS.filter((id) => id !== 'shelf' || sidebarShown);
    const seen = [];
    for (let i = 0; i < 9; i += 1) {
      const id = await cardId(page);
      if (id === null) break;
      seen.push(id);
      const fits = await outlineFits(page);
      check(fits === 'ok', `account step ${id}: outlined round its thing`, fits === 'ok' ? '' : fits);
      if (id === 'desk') await page.screenshot({ path: join(OUT, 'account-desk.png') });
      await page.locator('[data-tour-next]').click();
    }
    check(JSON.stringify(seen) === JSON.stringify(expected), `the account's steps, DESK in place of LOG IN${sidebarShown ? '' : ' (sidebar folded by a docked window: no SHELF step)'}`, seen.join(' '));
    check((await said(page)) === 'done', 'remembered for the account');
    liveTotal += liveHits();
    await context.close();
  }

  // 5. Phone width: the tour shows without a sideways scroll.
  console.log('5. phone width');
  {
    const { context, page, liveHits } = await newPage(browser, { width: 390, height: 844 });
    await openBoard(page);
    const shown = await waitForCard(page, 20000);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(sideways <= 0, 'no sideways scroll at 390 wide', `${sideways}px over; tour ${shown ? 'shown' : 'not shown'}`);
    await page.screenshot({ path: join(OUT, 'phone.png') });
    liveTotal += liveHits();
    await context.close();
  }

  check(liveTotal === 0, 'no request reached a live host', String(liveTotal));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
