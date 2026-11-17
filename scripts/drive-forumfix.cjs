/*
 * FORUMFIX (review fixes, 2026-11-17: findings from a Claude review run, Luke's answers). On a LOCAL dev server only
 * (core.md, "Test locally"): every data switch on mock, sign-in pointed at an address nothing answers, so a visitor
 * is signed out and nothing reaches the live project (`Temp/browse/dev-mock-forumfix.cjs`). The live hosts are
 * blocked and the run fails if anything asked them.
 *
 *   node scripts/drive-forumfix.cjs --base http://localhost:<port> [--out Temp/browse/forumfix] [--measure]
 *
 *   1. "HAD AN ACCOUNT?": [ NOT NOW ] is remembered across pages and reloads; /account never opens it over the
 *      login form (a one-line way back sits in the LOG IN box instead).
 *   2. Every forum key has a hit area of at least 24px each way (measured by asking the page what is under the
 *      pointer across a 24px square around each key's centre).
 *   3. Auto-made STREAM records stay off the main board; [ STREAMS ] lists them; a record with a reply is back.
 *   4. No reply form is built until [ REPLY ] is pressed (element count before/after); pressing it builds one.
 *   5. No request for a missing art file; the default avatar is a text face; the Google key is text.
 *   6. A plain line under "ERROR: UNREGISTERED ENTITY.".
 *
 * Each step reports and the run goes on, so the old code shows every failure at once. `--measure` prints the
 * numbers (tap offenders, element counts) without judging.
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3321');
const OUT = opt('--out', join('Temp', 'browse', 'forumfix'));
const MEASURE = args.includes('--measure');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const LOST_NEVER = 'debaser.lost-account.never.v1';
const FORUM_KEY = 'debaser.forum.ugc.v2';

/** Three auto-made stream records, one of them answered, filed in the mock board's own storage. */
function streamThreads() {
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  const record = (id, host, minutes, comments) => ({
    id,
    title: `STREAM :: ${host} :: ${at(minutes).slice(0, 10)}`,
    body: '',
    author: { id: null, displayName: host },
    createdAt: at(minutes),
    anchor: { kind: 'board', id: `watch:room-${id}`, label: 'STREAM' },
    tags: [],
    comments,
    origin: 'user',
  });
  // Five ordinary posts with replies and tags, as the review's board had.
  const post = (n) => ({
    id: `fx-post-${n}`,
    title: `Drive post ${n}`,
    body: `Words of post ${n}, with a mention of the lore.`,
    author: { id: `fx-user-${n}`, displayName: `POSTER${n}` },
    createdAt: at(10 + n),
    anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
    tags: [{ id: `tag-${n}`, label: `topic${n}`, kind: 'user', colour: 'sun' }],
    comments: [1, 2].map((k) => ({
      id: `fx-post-${n}-r${k}`,
      threadId: `fx-post-${n}`,
      body: `reply ${k} to post ${n}`,
      author: { id: `fx-replier-${k}`, displayName: `REPLIER${k}` },
      createdAt: at(8 + n - k),
      tags: [],
    })),
    origin: 'user',
  });
  return [
    ...[1, 2, 3, 4, 5].map(post),
    record('fx-stream-a', 'ALPHA', 3, []),
    record('fx-stream-b', 'BRAVO', 4, []),
    record('fx-stream-c', 'CHARLIE', 5, [
      { id: 'fx-reply-c', threadId: 'fx-stream-c', body: 'great stream', author: { id: null, displayName: 'GUEST' }, createdAt: at(1), tags: [] },
    ]),
  ];
}

async function newPage(browser, { seedStreams = false, neverHadOne = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(
    ({ seed, never, forumKey, neverKey }) => {
      try {
        if (window.sessionStorage.getItem('fx-seeded') === null) {
          window.sessionStorage.setItem('fx-seeded', '1');
          if (seed !== null) window.localStorage.setItem(forumKey, JSON.stringify({ version: 2, threads: seed, pins: [] }));
          if (never) window.localStorage.setItem(neverKey, '1');
        }
      } catch {
        // no storage
      }
    },
    { seed: seedStreams ? streamThreads() : null, never: neverHadOne, forumKey: FORUM_KEY, neverKey: LOST_NEVER },
  );
  const page = await context.newPage();
  const missing = [];
  page.on('response', (response) => {
    if (response.status() === 404 && /\/assets\//.test(response.url())) missing.push(response.url());
  });
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  return { context, page, liveHits: () => live, missing };
}

async function boardReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 120000 });
  await page.locator('article details').first().waitFor({ timeout: 30000 });
  await sleep(800);
}

const lostWindow = (page) => page.getByRole('dialog', { name: 'HAD AN ACCOUNT?' });
async function lostWindowOpen(page, wait = 4000) {
  try {
    await lostWindow(page).waitFor({ timeout: wait });
    return true;
  } catch {
    return false;
  }
}

async function item1(browser) {
  console.log('1. HAD AN ACCOUNT? remembered, never over the login form');
  const { context, page, liveHits } = await newPage(browser);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  const first = await lostWindowOpen(page, 60000);
  check(first, 'a first visit is asked once on /forum');
  if (first) await lostWindow(page).getByRole('button', { name: '[ NOT NOW ]' }).click();
  for (const path of ['/media', '/stream', '/forum']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-top-bar]').waitFor({ timeout: 60000 });
    check(!(await lostWindowOpen(page)), `after NOT NOW it stays away on ${path} (a fresh page load)`);
  }
  await context.close();

  // A new browser, straight to /account: the window must not sit on the login form.
  const fresh = await newPage(browser);
  await fresh.page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await fresh.page.locator('#signin-email, input[type="email"]').first().waitFor({ timeout: 60000 });
  check(!(await lostWindowOpen(fresh.page)), '/account opens with the login form uncovered');
  const back = fresh.page.getByRole('button', { name: /GET IT BACK/ });
  const hasBack = (await back.count()) > 0;
  check(hasBack, 'the LOG IN box carries a one-line way back to a lost account');
  if (hasBack) {
    await back.first().click();
    check(await lostWindowOpen(fresh.page), 'pressing it opens the window (asked for)');
  }
  await fresh.page.screenshot({ path: join(OUT, 'account.png') });
  check(liveHits() + fresh.liveHits() === 0, 'nothing reached the live site');
  await fresh.context.close();
}

/** Every pressable on the board that is on screen, and how much of a 24px square around its centre is its own. */
async function tapOffenders(page) {
  return page.evaluate(() => {
    const selector = 'a[href], button, summary, select, input:not([type="hidden"]), [role="button"], [tabindex]:not([tabindex="-1"])';
    const scope = document.body;
    const out = [];
    const all = [...scope.querySelectorAll(selector)];
    for (const element of all) {
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // The key's own hit area: walk out from the centre, one pixel at a time, while the pointer still lands on it.
      // A point under a fixed bar the key is not part of (the music bar, the guest strip) is that bar's, not a
      // neighbour's: the key is only partly scrolled into view, which is not its size.
      const underOverlay = (hit) => {
        for (let node = hit; node !== null && node !== document.body; node = node.parentElement) {
          if (getComputedStyle(node).position === 'fixed') return !node.contains(element);
        }
        return false;
      };
      // Likewise a point the key's own scrolling window clips away (a row half scrolled out of the board).
      const clips = [];
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.overflowY !== 'visible' || s.overflowX !== 'visible') clips.push(node.getBoundingClientRect());
      }
      const clipped = (x, y) => clips.some((c) => x < c.left || x > c.right || y < c.top || y > c.bottom);
      const mine = (x, y) => {
        if (clipped(x, y)) return true;
        const hit = document.elementFromPoint(x, y);
        return hit !== null && (hit === element || element.contains(hit) || hit.closest(selector) === element || underOverlay(hit));
      };
      if (!mine(cx, cy)) continue; // covered by something else (a menu, a window): not this pass's business
      const reach = (dx, dy) => {
        let n = 0;
        while (n < 40 && mine(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1;
        return n;
      };
      const w = reach(-1, 0) + reach(1, 0) + 1;
      const h = reach(0, -1) + reach(0, 1) + 1;
      if (w < 24 || h < 24) {
        const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.push({ tag: element.tagName.toLowerCase(), label, w, h });
      }
    }
    return { total: all.filter((e) => e.getBoundingClientRect().width > 0).length, offenders: out };
  });
}

async function item2(browser) {
  console.log('2. forum keys: 24px hit areas');
  const { context, page } = await newPage(browser, { seedStreams: true, neverHadOne: true });
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await boardReady(page);
  // Open the first post so its keys are measured too.
  await page.locator('article details > summary').first().click();
  await sleep(600);
  const { total, offenders } = await tapOffenders(page);
  console.log(`  ..  ${offenders.length} of ${total} pressables under 24px one way`);
  if (MEASURE || offenders.length > 0) for (const o of offenders.slice(0, 60)) console.log(`        ${o.tag} ${o.w}x${o.h} "${o.label}"`);
  check(offenders.length === 0, 'every key on the board can be hit across 24px each way', `${offenders.length} under`);
  await page.screenshot({ path: join(OUT, 'board.png') });
  await context.close();
}

async function item3(browser) {
  console.log('3. STREAM records off the main board');
  const { context, page } = await newPage(browser, { seedStreams: true, neverHadOne: true });
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await boardReady(page);
  const titles = async () => page.locator('article details > summary').allInnerTexts();
  // The board shows 5 a page: ask for 50, so the whole main board is read.
  const perPage = page.locator('select').filter({ has: page.locator('option[value="50"]') });
  if ((await perPage.count()) > 0) await perPage.first().selectOption('50').catch(() => {});
  await sleep(500);
  const main = (await titles()).join('\n');
  check(!/STREAM :: ALPHA/.test(main) && !/STREAM :: BRAVO/.test(main), 'unanswered stream records are not on the main board');
  check(main.includes('STREAM :: CHARLIE'), 'a stream record with a reply is on the main board');
  const key = page.getByRole('button', { name: /STREAMS/ });
  const hasKey = (await key.count()) > 0;
  check(hasKey, 'the board has a [ STREAMS ] key');
  if (hasKey) {
    await key.first().click();
    await sleep(500);
    const shown = (await titles()).join('\n');
    check(/STREAM :: ALPHA/.test(shown) && /STREAM :: BRAVO/.test(shown) && /STREAM :: CHARLIE/.test(shown), 'STREAMS lists every record');
    const rows = await page.locator('article details > summary').count();
    check(rows === 3, 'STREAMS lists only the records', `${rows} rows`);
    await key.first().click();
    await sleep(400);
    check(!/STREAM :: ALPHA/.test((await titles()).join('\n')), 'pressing it again goes back to the main board');
  }
  await context.close();
}

async function item4(browser) {
  console.log('4. reply forms built only on REPLY');
  const { context, page } = await newPage(browser, { seedStreams: true, neverHadOne: true });
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await boardReady(page);
  const count = () =>
    page.evaluate(() => {
      const articles = [...document.querySelectorAll('article')];
      return {
        threads: articles.length,
        elements: articles.reduce((sum, a) => sum + a.querySelectorAll('*').length, 0),
        page: document.querySelectorAll('*').length,
        textareas: articles.reduce((sum, a) => sum + a.querySelectorAll('textarea').length, 0),
      };
    });
  const before = await count();
  console.log(`  ..  ${before.threads} posts: ${before.elements} elements in the posts, ${before.page} on the page, ${before.textareas} reply boxes`);
  check(before.textareas === 0, 'no reply box is built in the folded posts', `${before.textareas} built`);
  const article = page.locator('article').filter({ hasText: 'Drive post' }).first();
  await article.locator('details > summary').first().click();
  await sleep(500);
  const open = await count();
  check(open.textareas === 0, 'an opened post has no reply box until REPLY', `${open.textareas}`);
  const reply = article.locator('[data-post-reply]');
  const hasReply = (await reply.count()) > 0;
  check(hasReply, 'the opened post has a [ REPLY ] key');
  if (hasReply) {
    await reply.click();
    const box = article.locator('textarea').first();
    await box.waitFor({ timeout: 5000 }).catch(() => {});
    check((await article.locator('textarea').count()) === 1, 'pressing REPLY builds the reply box');
    await box.fill('a reply from the FORUMFIX drive');
    await article.getByRole('button', { name: '[ FILE REPLY ]' }).click();
    await article.getByText('a reply from the FORUMFIX drive').first().waitFor({ timeout: 8000 }).catch(() => {});
    check((await article.getByText('a reply from the FORUMFIX drive').count()) > 0, 'filing a reply still works');
  }
  await context.close();
}

async function item56(browser) {
  console.log('5/6. no missing art requests, text face, text Google key, the plain line');
  const { context, page, missing } = await newPage(browser, { seedStreams: true, neverHadOne: true });
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await boardReady(page);
  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().waitFor({ timeout: 60000 });
  await sleep(1500);
  check(missing.length === 0, 'no request for a missing art file', missing.slice(0, 4).join(' '));
  const google = page.getByRole('button', { name: 'Log in with Google' }).first();
  const googleImg = await google.locator('img').count();
  const googleText = (await google.innerText()).trim();
  check(googleImg === 0 && /G/.test(googleText), 'the Google key is a text mark', `img ${googleImg}, text "${googleText}"`);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await boardReady(page);
  const faces = await page.locator('[data-text-face]').count();
  check(faces > 0, 'an account with no picture wears the text face', `${faces} faces`);
  const strip = page.locator('[data-top-bar]');
  const stripText = await strip.innerText();
  check(/not signed in/i.test(stripText) && /visitor/i.test(stripText), 'the guest strip says plainly you are not signed in', stripText.replace(/\s+/g, ' ').slice(0, 140));
  await page.screenshot({ path: join(OUT, 'guest-strip.png'), clip: { x: 0, y: 0, width: 1440, height: 160 } });
  check(missing.length === 0, 'still no missing art request after the board', missing.slice(0, 4).join(' '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const only = opt('--only', 'all');
    if (only === 'all' || only === '1') await item1(browser);
    if (only === 'all' || only === '2') await item2(browser);
    if (only === 'all' || only === '3') await item3(browser);
    if (only === 'all' || only === '4') await item4(browser);
    if (only === 'all' || only === '5') await item56(browser);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL the drive stopped: ${error.message.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
