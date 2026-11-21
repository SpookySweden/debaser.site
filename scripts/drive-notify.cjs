/*
 * SPEC-notifications.md phase 1, driven on a LOCAL mock dev server only (scripts/dev-mock-live.cjs: every switch on mock,
 * sign-in mock, Supabase address empty). Live hosts are blocked and counted. The mock feed is this browser's storage
 * (`debaser.notifications.mock.v1`); a second tab of the same browser files a notification, which the first hears through
 * the storage event, as the database's channel would tell it.
 *
 *   node scripts/drive-notify.cjs --base http://localhost:<port> [--out Temp/browse/notify]
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3318');
const OUT = opt('--out', join('Temp', 'browse', 'notify'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const ME = { id: 'notify-me', name: 'BELLREADER' };
const OTHER = { id: 'notify-other', name: 'ZEPHYRFRIEND' };
const FEED = 'debaser.notifications.mock.v1';
const SETTINGS = 'debaser.notify-settings.mock.v1';

function seed({ me, other, theme }) {
  if (window.localStorage.getItem('notify-seeded') !== null) return;
  window.localStorage.setItem('notify-seeded', '1');
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  window.localStorage.setItem('debaser.desk.opened-day.v1', `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  if (theme) window.localStorage.setItem('debaser.site.theme.v2', theme);
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(me), user(other)], sessionUserId: me.id, bannedIds: [] }));
  const profile = (person) => ({ userId: person.id, displayName: person.name, bio: '', tags: [], comments: [], updatedAt: at(1), privacySeen: true });
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile(me), [other.id]: profile(other) } }));
  // History: already in the feed when the page opens, so no balloon for it.
  window.localStorage.setItem('debaser.notifications.mock.v1', JSON.stringify({ version: 1, items: [
    { id: 'old-reply', userId: me.id, kind: 'reply', actorId: other.id, actorName: other.name, threadId: null, threadTitle: 'Panel thumbnails', body: 'nice inks', createdAt: at(60), readAt: at(50) },
  ] }));
}

/** What another tab does when a notification is filed for ME: the mock's stand-in for the database's channel. */
function file(page, note) {
  return page.evaluate(([key, row]) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? '{"version":1,"items":[]}');
    state.items.push({ createdAt: new Date().toISOString(), readAt: null, threadId: null, gameId: null, inviteId: null, recommendationId: null, href: null, roomId: null, ...row });
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [FEED, note]);
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app|api\.debaser\.site/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { me: ME, other: OTHER, theme: options.theme ?? null });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && process.env.NOTIFY_CONSOLE) console.log(`  ..  console error: ${message.text().slice(0, 4000).replace(/s+/g, " ")}`);
  });
  return { context, page, liveHits: () => live };
}

async function forumReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 180000 });
  await sleep(2500);
}

const balloon = (page) => page.locator('[data-notification-balloon]');

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let live = 0;
  try {
    console.log('1. THE BALLOON (4A)');
    const one = await newContext(browser);
    const page = one.page;
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await balloon(page).count()) === 0, 'what was in the feed already is history: no balloon');

    const other = await one.context.newPage();
    await other.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await file(other, { id: 'n-letter', userId: ME.id, kind: 'letter', actorId: OTHER.id, actorName: OTHER.name, threadTitle: 'SUMMER SCRAPS', body: 'for you', recommendationId: 'rec-1' });
    await balloon(page).waitFor({ timeout: 10000 }).catch(() => undefined);
    const text = (await balloon(page).textContent().catch(() => '')) ?? '';
    check(/ZEPHYRFRIEND SENT YOU A LETTER "SUMMER SCRAPS"/.test(text), 'a letter arriving pops up a balloon', text.slice(0, 120));
    check(/\[ OPEN \]/.test(text) && /\[ × \]/.test(text), 'with OPEN and close keys');
    const box = await balloon(page).boundingBox();
    check(box !== null && box.x + box.width > 1440 - 40 && box.y + box.height > 900 - 200, 'at the bottom right', JSON.stringify(box));
    await page.screenshot({ path: join(OUT, 'balloon-dark.png') });

    await balloon(page).hover();
    await sleep(7000);
    check((await balloon(page).count()) === 1, 'it stays while the pointer is on it');
    await page.mouse.move(200, 200);
    await sleep(7000);
    check((await balloon(page).count()) === 0, 'and goes 6 seconds after the pointer leaves');

    console.log('2. SEVERAL AT ONCE, AND THE BELL MENU');
    await file(other, { id: 'n-comic', userId: ME.id, kind: 'comic', actorId: null, actorName: 'DEBASER', threadTitle: '5 NEW PAGES IN CHAPTER 3', body: '', href: '/forum' });
    await sleep(300);
    await file(other, { id: 'n-live', userId: ME.id, kind: 'live', actorId: OTHER.id, actorName: OTHER.name, threadTitle: 'LATE SHOW', body: '', roomId: 'room-gone' });
    await balloon(page).waitFor({ timeout: 10000 }).catch(() => undefined);
    const two = (await balloon(page).textContent().catch(() => '')) ?? '';
    check(/ZEPHYRFRIEND WENT LIVE "LATE SHOW"/.test(two), 'the newest shows first', two.slice(0, 120));
    check(/\[ \+1 MORE \]/.test(two), 'the rest read +1 MORE');
    await page.screenshot({ path: join(OUT, 'balloon-more.png') });
    await balloon(page).getByRole('button', { name: '[ +1 MORE ]' }).click();
    await sleep(800);
    const menu = (await page.locator('text=MARK ALL READ').first().locator('xpath=ancestor::div[contains(@class,"frame")][1]').textContent().catch(() => '')) ?? '';
    check(/LETTER/.test(menu) && /COMIC/.test(menu) && /LIVE/.test(menu), 'the bell menu opens with every kind', menu.slice(0, 200));
    check(/WAS LIVE/.test(menu), "a room that isn't on any more says WAS LIVE");
    check(/5 NEW PAGES IN CHAPTER 3/.test(menu) && /SUMMER SCRAPS/.test(menu), 'with their titles');
    check((await balloon(page).count()) === 0, '+1 MORE spends the balloons');
    await page.screenshot({ path: join(OUT, 'menu.png') });
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 120);

    console.log('3. PREFERENCES: THE SWITCHES (5B)');
    await page.getByRole('button', { name: 'Profile settings' }).first().click();
    await page.getByRole('menuitem', { name: /PREFERENCES/ }).first().click();
    const section = page.locator('[data-notification-switches]');
    await section.waitFor({ timeout: 10000 }).catch(() => undefined);
    check((await section.count()) === 1, 'PREFERENCES has a NOTIFICATIONS section');
    const pressed = async (key) => page.locator(`[data-notify-switch="${key}"]`).getAttribute('aria-pressed');
    check((await pressed('replies')) === 'true' && (await pressed('comic')) === 'false', 'everything starts on except COMIC NEW PAGES');
    await page.locator('[data-notify-switch="balloons"]').click();
    await sleep(500);
    check((await pressed('balloons')) === 'false', 'BALLOONS goes off');
    const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}'), SETTINGS);
    check(stored[ME.id]?.prefs?.balloons === false, 'and is saved to the account', JSON.stringify(stored[ME.id] ?? {}).slice(0, 160));
    check((await pressed('weeklyEmail')) === 'false', 'WEEKLY EMAIL starts off (6A)');
    await page.locator('[data-notify-switch="weeklyEmail"]').click();
    await sleep(500);
    const weekly = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}'), SETTINGS);
    check((await pressed('weeklyEmail')) === 'true' && weekly[ME.id]?.prefs?.weeklyEmail === true, 'pressed, it is on and saved');
    await page.locator('[data-notification-switches]').screenshot({ path: join(OUT, 'switches.png') });
    await file(other, { id: 'n-quiet', userId: ME.id, kind: 'reply', actorId: OTHER.id, actorName: OTHER.name, threadTitle: 'QUIET', body: 'shh' });
    await sleep(2500);
    check((await balloon(page).count()) === 0, 'with BALLOONS off nothing pops up');
    const bell = (await page.getByRole('button', { name: /Notifications:/ }).first().getAttribute('aria-label').catch(() => '')) ?? '';
    check(/NEW/.test(bell), 'the bell still has it', bell);

    console.log('3b. THE UNSUBSCRIBE PAGE (10A)');
    // A local mock server has no database behind it, so the page must say plainly that it didn't go through.
    await page.goto(`${BASE}/unsubscribe?t=11111111-2222-3333-4444-555555555555`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-unsubscribe="error"], [data-unsubscribe="off"]').first().waitFor({ timeout: 120000 }).catch(() => undefined);
    const shown = (await page.locator('[data-unsubscribe]').textContent().catch(() => '')) ?? '';
    check(/WEEKLY EMAIL/.test(shown) && /NOT SET UP|DID NOT|OFF/.test(shown), 'the unsubscribe page opens and answers', shown.slice(0, 120));
    await page.screenshot({ path: join(OUT, 'unsubscribe.png') });

    console.log('4. TELL ME WHEN LIVE (2C)');
    await page.goto(`${BASE}/profile/${OTHER.id}`, { waitUntil: 'domcontentloaded' });
    const key = page.locator('[data-live-watch]');
    await key.waitFor({ timeout: 120000 }).catch(() => undefined);
    // Luke, 2026-11-21: a notification key (the site's notices glyph) that lights up when pressed.
    check((await key.textContent().catch(() => '')) === '[ ☼ ]' && (await key.getAttribute('aria-label')) === 'Tell me when they go live', "a notification key on somebody else's profile");
    const restFill = await key.evaluate((node) => getComputedStyle(node).backgroundColor);
    await key.click();
    await sleep(500);
    const litFill = await key.evaluate((node) => getComputedStyle(node).backgroundColor);
    check((await key.textContent()) === '☼' && (await key.getAttribute('aria-pressed')) === 'true' && litFill !== restFill && !/rgba\(0, 0, 0, 0\)|transparent/.test(litFill), 'pressed, it lights up', `${restFill} -> ${litFill}`);
    const picks = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '{}'), SETTINGS);
    check(JSON.stringify(picks[ME.id]?.watches) === JSON.stringify([OTHER.id]), 'and the pick is saved', JSON.stringify(picks[ME.id]?.watches));
    await page.screenshot({ path: join(OUT, 'profile-key.png') });
    await key.click();
    await sleep(500);
    const offPicks = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '{}'), SETTINGS);
    check((await key.textContent()) === '[ ☼ ]' && (await key.getAttribute('aria-pressed')) === 'false' && JSON.stringify(offPicks[ME.id]?.watches ?? []) === '[]', 'pressed again, it goes dark and the pick is gone');
    await page.goto(`${BASE}/profile/${ME.id}`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    check((await page.locator('[data-live-watch]').count()) === 0, 'not on your own profile');
    live += one.liveHits();
    await one.context.close();

    console.log('5. BRIGHT THEME, AND PHONE WIDTH');
    for (const [theme, width, name] of [['default', 1440, 'balloon-bright.png'], [null, 390, 'balloon-phone.png']]) {
      const ctx = await newContext(browser, { theme, width });
      await ctx.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
      await sleep(width < 768 ? 12000 : 0);
      if (width >= 768) await forumReady(ctx.page);
      const filer = await ctx.context.newPage();
      await filer.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
      await ctx.page.bringToFront();
      await file(filer, { id: `n-${name}`, userId: ME.id, kind: 'letter', actorId: OTHER.id, actorName: OTHER.name, threadTitle: 'SUMMER SCRAPS', body: '', recommendationId: 'rec-2' });
      await balloon(ctx.page).waitFor({ timeout: 10000 }).catch(() => undefined);
      check((await balloon(ctx.page).count()) === 1, `the balloon shows (${theme ?? 'dark'}, ${width} wide)`);
      const sideways = await ctx.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(!sideways, `no sideways scroll at ${width}`);
      await ctx.page.screenshot({ path: join(OUT, name) });
      live += ctx.liveHits();
      await ctx.context.close();
    }
  } finally {
    await browser.close();
  }
  check(live === 0, 'nothing reached the live site', `${live} blocked`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
