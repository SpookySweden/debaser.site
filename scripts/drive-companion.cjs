/*
 * Drives the companion along the bottom of the site (SPEC-companion.md, "How it's proven") in real browsers. Not in
 * `npm run checks`: it needs the kept test accounts.
 *
 *   node scripts/drive-companion.cjs --base https://debaser-site.vercel.app [--env-test <path>] [--quick] [--headed]
 *
 * As TEST ACCOUNT A, companion switched on in Preferences:
 *   1. on /forum, /media and /users, the companion's box is checked twice a second for 60 s in all: it stands on the strip,
 *      never overlaps a music bar key or anything it should step around, and every music bar key is still the thing a
 *      click at its middle lands on;
 *   2. it dances while the music bar plays;
 *   3. it falls asleep after a minute with nothing happening, and wakes when the pointer moves;
 *   4. it hops with a `!` when TEST ACCOUNT B sends A a message;
 *   5. A and B in one stream room each see the other's companion with its owner's name; A's presence messages in one
 *      minute are counted from the websocket;
 *   6. screenshots at desktop and phone width (the phone with its own switch on).
 * It starts one stream room as A (ended at the close) and sends one comms message from B to A: both are printed so they
 * can be cleared.
 *
 * --quick skips the 60 s sleep wait and the minute of counting (for trying the drive itself, not for the proof).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, loadEnv, signInTestAccount, testAccountClient } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const QUICK = flag('--quick');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const left = [];

const COMPANION_ON = JSON.stringify({ computer: true, phone: true, character: null });

async function person(browser, letter, { phone = false } = {}) {
  const account = await signInTestAccount(letter);
  if (account.error) throw new Error(`sign-in ${letter}: ${account.error}`);
  const context = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } },
  );
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error (${letter}): ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return { page, account };
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** Switches the companion on through Preferences, as a person would. */
async function switchOn(page) {
  const settings = page.getByRole('button', { name: /SETTINGS/ }).first();
  await settings.click();
  await page.getByRole('menuitem', { name: 'Open preferences' }).click();
  const section = page.locator('[data-companion-preferences]');
  await section.waitFor({ timeout: 15000 });
  await section.getByRole('button', { name: /^\[ ON \]$/ }).click();
  assert.equal(await section.getByRole('button', { name: /^\[ ON \]$/ }).getAttribute('aria-pressed'), 'true');
  await page.locator('[data-dock-window="preferences"]').getByRole('button', { name: /^Close / }).click();
  await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 10000 });
}

/** Opens the music bar if it is folded to its tile. */
async function openBar(page) {
  const tile = page.locator('span[data-companion-avoid] > button').first();
  if ((await tile.count()) > 0 && (await tile.isVisible())) await tile.click();
  await sleep(500);
}

/** One reading of the strip: the companion's box against the bar's keys and everything it steps around. */
function readStrip() {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null || own.style.visibility !== 'visible') return { drawn: false };
  const box = own.getBoundingClientRect();
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  const floor = window.innerHeight - bar;
  const overlaps = (r) => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
  const keys = [...document.querySelectorAll('[data-stream-bar] button, .fixed.bottom-0 button, [data-companion-avoid] button')].filter((key) => {
    const r = key.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const hitKeys = keys.filter((key) => overlaps(key.getBoundingClientRect())).map((key) => key.getAttribute('aria-label') || key.textContent.trim());
  const avoid = [...document.querySelectorAll('[data-companion-avoid], [data-floating-player="floating"]')].filter((el) => overlaps(el.getBoundingClientRect())).length;
  // Every bar key is what a click at its middle lands on: nothing of the companion's is on top of it.
  const covered = keys
    .filter((key) => {
      const r = key.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return at !== null && own.contains(at);
    })
    .map((key) => key.getAttribute('aria-label') || key.textContent.trim());
  return { drawn: true, bottom: Math.round(box.bottom), floor: Math.round(floor), left: Math.round(box.left), keys: keys.length, hitKeys, avoid, covered, mood: own.dataset.mood };
}

async function watchStrip(page, seconds, label) {
  const moods = new Set();
  let samples = 0;
  let keys = 0;
  const xs = new Set();
  for (let i = 0; i < seconds * 2; i += 1) {
    const r = await page.evaluate(readStrip);
    if (!r.drawn) {
      await sleep(500);
      continue;
    }
    samples += 1;
    keys = Math.max(keys, r.keys);
    moods.add(r.mood);
    xs.add(r.left);
    assert.ok(Math.abs(r.bottom - r.floor) <= 1, `${label}: stands on the strip (bottom ${r.bottom}, floor ${r.floor})`);
    assert.deepEqual(r.hitKeys, [], `${label}: overlaps a music bar key`);
    assert.equal(r.avoid, 0, `${label}: overlaps something it should step around`);
    assert.deepEqual(r.covered, [], `${label}: a bar key would not take a click`);
    // Move the pointer now and then, low and high, so it chases and wanders.
    if (i % 8 === 0) await page.mouse.move(100 + ((i * 97) % 1200), i % 16 === 0 ? 860 : 300);
    await sleep(500);
  }
  assert.ok(samples >= seconds, `${label}: drawn in most readings (${samples})`);
  pass(`${label}: ${samples} readings over ${seconds} s, ${keys} bar keys, always on the strip, never over a key, every key clickable; moods ${[...moods].join(' ')}; ${xs.size} places`);
}

async function mood(page) {
  return page.evaluate(() => document.querySelector('[data-companion="own"]')?.dataset.mood ?? null);
}

async function waitMood(page, wanted, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await mood(page)) === wanted) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  loadEnv();
  process.loadEnvFile('.env.production');
  process.loadEnvFile(opt('--env-test', '.env.test'));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  let a = null;
  let roomId = null;
  try {
    console.log('A: switching the companion on');
    a = await person(browser, 'A');
    const rooms = [];
    a.page.on('request', (request) => {
      if (request.method() === 'POST' && /\/rest\/v1\/watch_rooms\b/.test(request.url())) {
        try {
          const body = JSON.parse(request.postData() ?? '{}');
          if (typeof body.id === 'string') rooms.push(body.id);
        } catch {
          // Not the row.
        }
      }
    });
    await a.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await clearPrivacyWindow(a.page);
    await switchOn(a.page);
    pass('Preferences > COMPANION > [ ON ] puts it on the strip');

    console.log('Several pages, the bar open');
    await openBar(a.page);
    await watchStrip(a.page, 20, '/forum');
    for (const page of ['/media', '/users']) {
      await a.page.goto(`${BASE}${page}`, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      await clearPrivacyWindow(a.page);
      await openBar(a.page);
      await watchStrip(a.page, 20, page);
    }
    await a.page.screenshot({ path: join(SHOTS, 'companion-desktop.png') });

    console.log('It dances while the music bar plays');
    await a.page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await openBar(a.page);
    const play = a.page.locator('button[aria-label^="Play"]').first();
    await play.waitFor({ timeout: 30000 });
    await play.click();
    await a.page.mouse.move(700, 200);
    assert.ok(await waitMood(a.page, 'dance', 8000), `dances while playing (mood ${await mood(a.page)})`);
    await a.page.screenshot({ path: join(SHOTS, 'companion-dance.png') });
    pass('the music bar playing: it dances');
    // Pause it again (the cycle key: playing -> paused).
    await a.page.locator('.fixed.bottom-0 button[title="PAUSE"], .fixed.bottom-0 button[title="Pause"]').first().click().catch(() => undefined);
    await a.page.evaluate(() => document.querySelectorAll('audio').forEach((audio) => audio.pause()));
    await sleep(1500);

    if (!QUICK) {
      console.log('It falls asleep with nothing happening, and wakes');
      await a.page.mouse.move(700, 200);
      assert.ok(await waitMood(a.page, 'sit', 40000), `sits after 30 s (mood ${await mood(a.page)})`);
      pass('30 s with nothing happening: it sits');
      assert.ok(await waitMood(a.page, 'sleep', 40000), `sleeps after 60 s (mood ${await mood(a.page)})`);
      await a.page.screenshot({ path: join(SHOTS, 'companion-asleep.png') });
      pass('60 s with nothing happening: it sleeps');
      await a.page.mouse.move(600, 300);
      await sleep(400);
      assert.notEqual(await mood(a.page), 'sleep');
      pass('the pointer moving wakes it');
    }

    console.log('B messages A: A\'s companion hops with a `!`');
    const b = await person(browser, 'B');
    const { client: asB } = await testAccountClient('B');
    await a.page.evaluate(() => {
      window.__companionMark = 0;
      const mark = document.querySelector('[data-companion="own"] [data-companion-mark]');
      new MutationObserver(() => {
        if (mark.style.visibility === 'visible') window.__companionMark += 1;
      }).observe(mark, { attributes: true, attributeFilter: ['style'] });
    });
    // The way comms opens a direct thread and sends into it (app/lib/comms/supabase-comms-repository.ts).
    const idA = a.account.userId;
    const idB = b.account.userId;
    const [low, high] = idA <= idB ? [idA, idB] : [idB, idA];
    const thread = `dm:${low}|${high}`;
    const opened = await asB.from('comms_threads').upsert({ id: thread, participant_a: low, participant_b: high, kind: 'dm', name: '' }, { onConflict: 'id', ignoreDuplicates: true });
    assert.equal(opened.error, null, opened.error?.message);
    const sent = await asB
      .from('comms_messages')
      .insert({ thread_id: thread, author_id: idB, author_name: 'TEST ACCOUNT B', body: 'companion drive: a test message, to be deleted' })
      .select('id')
      .single();
    assert.equal(sent.error, null, sent.error?.message);
    left.push(`comms message ${sent.data.id} (B to A, thread ${thread})`);
    await a.page.waitForFunction(() => window.__companionMark > 0, null, { timeout: 20000 });
    pass('a message from B: the `!` goes up over A\'s companion');

    console.log('A and B in one stream room');
    await a.page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await a.page.waitForFunction(() => document.querySelector('[data-watch-in-room="start"]') !== null || document.querySelector('button[aria-label^="Play"]') !== null, null, { timeout: 45000 });
    await clearPrivacyWindow(a.page);
    const row = a.page.locator('li').filter({ hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first();
    await row.locator('button[aria-label^="Play"]').first().click();
    await a.page.waitForSelector('[data-floating-player] iframe', { timeout: 20000 });
    await sleep(3000);
    await a.page.locator('[data-watch-in-room="start"]').first().click();
    const dialog = a.page.getByRole('dialog', { name: 'WATCH IN ROOM' });
    await dialog.waitFor();
    await dialog.locator('[data-go-live-name]').fill('COMPANION DRIVE');
    await dialog.locator('[data-go-live-topic]').fill('A test room, to be deleted');
    await dialog.locator('[data-room-privacy="open"]').click();
    await dialog.locator('[data-go-live-start]').click();
    await a.page.waitForSelector('[data-room-picture]', { timeout: 30000 });
    roomId = rooms.at(-1) ?? null;
    assert.ok(roomId, 'the room was written');
    left.push(`stream room ${roomId} (ended at the close; its record and board thread stay)`);
    await a.page.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / }).click();

    // B, companion on too, joins by the room's link.
    await b.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await clearPrivacyWindow(b.page);
    await switchOn(b.page);
    let frames = 0;
    a.page.on('websocket', () => undefined);
    const counting = { on: false };
    const cdp = await a.page.context().newCDPSession(a.page);
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      if (counting.on && /"event":"presence"/.test(response.payloadData) && /"companion"/.test(response.payloadData)) frames += 1;
    });
    await b.page.goto(`${BASE}/forum?watch=${roomId}`, { waitUntil: 'domcontentloaded' });
    await b.page.waitForSelector('[data-room-picture]', { timeout: 30000 });
    await b.page.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / }).click();
    const nameA = await a.page.evaluate(() => document.querySelector('[data-companion="own"]')?.getAttribute('aria-label'));
    assert.equal(nameA, 'Your companion');
    await b.page.waitForSelector('[data-companion="room"]', { timeout: 30000 });
    await a.page.waitForSelector('[data-companion="room"]', { timeout: 30000 });
    const seenByB = await b.page.locator('[data-companion="room"]').first().getAttribute('aria-label');
    const seenByA = await a.page.locator('[data-companion="room"]').first().getAttribute('aria-label');
    assert.match(seenByB, /TEST ACCOUNT A/i);
    assert.match(seenByA, /TEST ACCOUNT B/i);
    pass(`each sees the other's companion: B sees "${seenByB}", A sees "${seenByA}"`);
    await b.page.locator('[data-companion="room"]').first().hover();
    await sleep(300);
    await b.page.screenshot({ path: join(SHOTS, 'companion-room-b.png') });
    await a.page.screenshot({ path: join(SHOTS, 'companion-room-a.png') });

    const minute = QUICK ? 15 : 60;
    counting.on = true;
    for (let i = 0; i < minute; i += 5) {
      await a.page.mouse.move(200 + ((i * 131) % 1000), i % 10 === 0 ? 880 : 300);
      await sleep(5000);
    }
    counting.on = false;
    pass(`A's companion said ${frames} presence messages in ${minute} s in the room (never per frame: ${minute * 10} frames were drawn)`);
    assert.ok(frames < minute * 2, `under two a second (${frames})`);

    // The room ends, for everybody.
    await a.page.locator('[data-watch-tv-box] button').click().catch(() => undefined);
    await sleep(800);
    await a.page.getByRole('button', { name: '[ END STREAM ]' }).last().click();
    await a.page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click();
    await sleep(1500);
    pass('the room ended');
    await asB.auth.signOut({ scope: 'local' });
    await b.page.context().close();

    console.log('Phone width, its own switch on');
    const phone = await person(browser, 'A', { phone: true });
    await phone.page.addInitScript((value) => window.localStorage.setItem('debaser-companion', value), COMPANION_ON);
    await phone.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await clearPrivacyWindow(phone.page);
    await phone.page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 15000 });
    await sleep(1500);
    const onPhone = await phone.page.evaluate(readStrip);
    assert.ok(onPhone.drawn, 'drawn on the phone');
    assert.deepEqual(onPhone.hitKeys, []);
    await phone.page.screenshot({ path: join(SHOTS, 'companion-phone.png') });
    pass('phone width: on the strip, over no key');
    await phone.page.context().close();

    console.log(`\n${passed} passed. Screenshots in ${SHOTS}/companion-*.png`);
  } catch (error) {
    if (a !== null) await a.page.screenshot({ path: join(SHOTS, 'companion-failed.png') }).catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (left.length > 0) console.log(`Left to clear:\n  ${left.join('\n  ')}`);
    await browser.close();
  }
})();
