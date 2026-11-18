/*
 * SPEC-forum-v3.md part 2 (the user_settings table, Luke's typed OK 2026-11-17: "Yes, create it"), driven on a LOCAL mock
 * dev server only (Temp/browse/dev-mock-forumux.cjs: every switch on mock, sign-in mock, Supabase address empty). Live
 * hosts are blocked and counted. The mock's "database" is this browser's storage (`debaser.user-settings.mock.v1`), so a
 * second machine is a second browser context that is handed the first one's row.
 *
 *   node scripts/drive-forum-v3-part2.cjs --base http://localhost:<port> [--only settings|marks|made] [--out Temp/browse/forum-v3-part2]
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'forum-v3-part2'));
const ONLY = opt('--only', null);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const ME = { id: 'sync-me', name: 'SYNCREADER' };
const OTHER = { id: 'sync-other', name: 'ZEPHYRFRIEND' };
const ROW_KEY = 'debaser.user-settings.mock.v1';

/** Runs in the page before its own scripts, once per context (a reload keeps what the page changed). */
function seed({ me, other, signedIn, browser, row, extra, marks }) {
  if (window.localStorage.getItem('v3-seeded') !== null) return;
  window.localStorage.setItem('v3-seeded', '1');
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // The DESK has opened by itself today already, so it does not cover the board.
  window.localStorage.setItem('debaser.desk.opened-day.v1', `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(me), user(other)], sessionUserId: signedIn ? me.id : null, bannedIds: [] }));
  const profile = (person) => ({ userId: person.id, displayName: person.name, bio: '', tags: [], comments: [], updatedAt: at(1), privacySeen: true });
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile(me), [other.id]: profile(other) } }));
  const board = (id, title, author, minutes, comments = []) => ({
    id, title, body: `Words of ${title}.`, author, createdAt: at(minutes),
    anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, tags: [], comments, origin: 'user',
  });
  window.localStorage.setItem('debaser.forum.ugc.v2', JSON.stringify({ version: 2, pins: [], threads: [
    board('theirs', 'Marmalade sketches', { id: other.id, displayName: other.name }, 30, [
      { id: 'theirs-r1', threadId: 'theirs', body: 'and a second page', author: { id: other.id, displayName: other.name }, createdAt: at(10), tags: [] },
    ]),
    board('older', 'Panel thumbnails', { id: other.id, displayName: other.name }, 90),
    board('fresh', 'Inking the cover', { id: other.id, displayName: other.name }, 5),
  ] }));
  // This browser's own read marks: post id -> how many minutes ago it was opened.
  if (marks) {
    window.localStorage.setItem('debaser.forum.read.v1', JSON.stringify({ version: 1, accounts: { [me.id]: Object.fromEntries(Object.entries(marks).map(([id, minutes]) => [id, at(minutes)])) } }));
  }
  for (const [key, value] of Object.entries(browser ?? {})) window.localStorage.setItem(key, value);
  if (row !== null && row !== undefined) window.localStorage.setItem('debaser.user-settings.mock.v1', row);
  for (const [key, value] of Object.entries(extra ?? {})) window.localStorage.setItem(key, value);
}

async function newContext(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { me: ME, other: OTHER, row: null, browser: {}, extra: {}, marks: null, ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  return { context, page, liveHits: () => live };
}

async function forumReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 180000 });
  await sleep(2500);
}
const readRow = (page) => page.evaluate((key) => {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}, ROW_KEY);
const html = (page, name) => page.evaluate((attr) => document.documentElement.getAttribute(attr), name);

async function settingsPart(browser, totals) {
  console.log('5. SETTINGS FOLLOW THE ACCOUNT (F1B, F2A)');
  // The first machine: its own looks, signed in to an account that has no row yet.
  const first = await newContext(browser, {
    signedIn: true,
    browser: { 'debaser.site.theme.v2': 'sherbet-pink', 'debaser.site.cursor.v2': 'cat', 'debaser.site.backdrop.v2': 'tile' },
  });
  let page = first.page;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  let row = (await readRow(page))[ME.id];
  check(row !== undefined, 'signing in with no row yet makes one');
  check(row?.settings?.keys?.theme === 'sherbet-pink' && row?.settings?.keys?.cursor === 'cat', "it starts from this browser's choices, so nobody's look is wiped", JSON.stringify(row?.settings?.keys ?? {}).slice(0, 140));
  check(await html(page, 'data-theme') === 'sherbet-pink', 'and the page keeps its own theme');
  await page.screenshot({ path: join(OUT, "settings-first-before.png") });
  console.log("  ..  wire keys:", await page.locator("[data-wire-pause]").count());
  await page.locator("[data-wire-pause]").first().click();
  await page.getByRole('button', { name: 'GALLERY', exact: true }).first().click();
  await sleep(1800);
  row = (await readRow(page))[ME.id];
  check(row?.settings?.keys?.wirePaused === '1', 'stopping the newswire saves to the account (gathered for a second)', String(row?.settings?.keys?.wirePaused));
  check(/"view":"gallery"/.test(row?.settings?.keys?.forumPlace ?? ''), "and so does the board's tab", String(row?.settings?.keys?.forumPlace));
  const saved = JSON.stringify(await readRow(page));
  await page.screenshot({ path: join(OUT, 'settings-first.png') });
  totals.live += first.liveHits();
  await first.context.close();

  // The second machine: different looks of its own, handed the account's row.
  const second = await newContext(browser, { signedIn: true, row: saved, browser: { 'debaser.site.theme.v2': 'dark', 'debaser.site.cursor.v2': 'white' } });
  page = second.page;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  check(await html(page, 'data-theme') === 'sherbet-pink', "a second machine signed in takes the account's theme", String(await html(page, 'data-theme')));
  check(await html(page, 'data-cursor') === 'cat', 'and its cursor', String(await html(page, 'data-cursor')));
  check(await html(page, 'data-backdrop') === 'tile', 'and its background', String(await html(page, 'data-backdrop')));
  check(await page.locator('[data-wire-pause]').getAttribute('aria-pressed') === 'true', 'the newswire is stopped there too');
  check(await page.getByRole('button', { name: 'GALLERY', exact: true }).first().getAttribute('aria-pressed') === 'true', 'and the board opens on GALLERY');
  check(new URL(page.url()).searchParams.get('view') === 'gallery', 'with the address saying so', page.url());
  await page.screenshot({ path: join(OUT, 'settings-second.png') });
  totals.live += second.liveHits();
  await second.context.close();

  // A link names its own place: it wins over the account's memory.
  const linked = await newContext(browser, { signedIn: true, row: saved });
  page = linked.page;
  await page.goto(`${BASE}/forum?view=streams`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  check(await page.getByRole('button', { name: 'STREAMS', exact: true }).first().getAttribute('aria-pressed') === 'true', 'a link to STREAMS still opens STREAMS', page.url());
  totals.live += linked.liveHits();
  await linked.context.close();

  // Signed out, the browser keeps its own.
  const visitor = await newContext(browser, { signedIn: false, row: saved, browser: { 'debaser.site.theme.v2': 'dark' } });
  page = visitor.page;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  check(await html(page, 'data-theme') === 'dark', "signed out, the browser keeps its own theme", String(await html(page, 'data-theme')));
  totals.live += visitor.liveHits();
  await visitor.context.close();
}

const feedNew = (page) => page.getByRole('button', { name: /^FEED/ }).first().getAttribute('data-new');

async function marksPart(browser, totals) {
  console.log('6. READ MARKS FOLLOW THE ACCOUNT (F1B)');
  // The first machine: has read the old post; the two newer ones are NEW.
  const first = await newContext(browser, { signedIn: true, marks: { older: 80 } });
  let page = first.page;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  check(await feedNew(page) === '2 NEW', 'the first machine starts with two posts NEW', String(await feedNew(page)));
  await page.locator('#thread-theirs summary').first().click();
  await sleep(1200);
  let row = (await readRow(page))[ME.id];
  check(row?.read_marks?.theirs === undefined, 'opening a post saves nothing to the account at once', JSON.stringify(row?.read_marks ?? {}));
  await sleep(4500);
  row = (await readRow(page))[ME.id];
  check(typeof row?.read_marks?.theirs === 'string', 'a few seconds after the last post opened, the batch is saved', Object.keys(row?.read_marks ?? {}).join(','));
  check(typeof row?.read_marks?.older === 'string', "and it carries this browser's earlier reading too");
  const saved = JSON.stringify(await readRow(page));
  totals.live += first.liveHits();
  await first.context.close();

  // The second machine: had read only the old post; handed the account's row.
  const second = await newContext(browser, { signedIn: true, row: saved, marks: { older: 80 } });
  page = second.page;
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await forumReady(page);
  check(await feedNew(page) === '1 NEW', 'on the second machine, the post read on the first is no longer NEW', String(await feedNew(page)));
  await page.locator('#thread-fresh summary').first().click();
  await sleep(300);
  // Leaving the tab sends what is waiting at once, without the few seconds' wait.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(500);
  row = (await readRow(page))[ME.id];
  check(typeof row?.read_marks?.fresh === 'string', 'leaving the tab saves the reading straight away', Object.keys(row?.read_marks ?? {}).join(','));
  check(await feedNew(page) === null, 'and nothing on the feed is NEW now', String(await feedNew(page)));
  totals.live += second.liveHits();
  await second.context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const totals = { live: 0 };
  try {
    if (ONLY === null || ONLY === 'settings') await settingsPart(browser, totals);
    if (ONLY === null || ONLY === 'marks') await marksPart(browser, totals);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL the run stopped: ${error.message.split('\n').slice(0, 14).join(' / ')}`);
  } finally {
    await browser.close();
  }
  check(totals.live === 0, 'nothing reached the live site', `${totals.live} requests`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
