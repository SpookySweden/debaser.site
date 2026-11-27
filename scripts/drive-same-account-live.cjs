/*
 * One account on two devices, on the LIVE site, short (Luke, 2026-11-27; the local proof is scripts/drive-same-account.cjs): what
 * only the real sign-in and the real Realtime can show. TEST ACCOUNT A is signed in on two separate browser profiles (two devices).
 *
 *   1. Device 1 puts the live catalogue's ten-second test video on in A's own room ([ WATCH IN ROOM ]), loops and pauses it;
 *      device 2 opens on the same paused place and follows; device 1 leads.
 *   2. Play on device 2 plays device 1, together; device 2 leads now.
 *   3. A pause on device 2 pauses device 1.
 *   The room is left paused.
 *
 *   node "<notes>/heavy-step.cjs" SYNC --live -- node scripts/drive-same-account-live.cjs
 *
 * Kept test account A only (scripts/browser.cjs, password from the gitignored .env.test). It writes what playing writes: A's own
 * room's place, and the video filed in A's room queue (printed at the end for the check-in file). It deletes nothing.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'https://debaser.site';
const SHOTS = join('Temp', 'browse', 'same-account-live');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const stage = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    return video === null ? null : { time: video.currentTime, paused: video.paused, role: video.getAttribute('data-watch-video') };
  });
async function until(page, what, check, timeout) {
  const end = Date.now() + timeout;
  let held = null;
  while (Date.now() < end) {
    held = await stage(page);
    if (held !== null && check(held)) return held;
    await sleep(400);
  }
  throw new Error(`${what}: never happened (last: ${JSON.stringify(held)})`);
}
async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 90000 });
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(1000);
}

(async () => {
  const a = await signInTestAccount('A');
  if (a.error) throw new Error(`sign-in: ${a.error}`);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const one = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const two = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const first = await one.newPage();
  await installSession(first, a);
  const errors = [];
  first.on('pageerror', (error) => errors.push(`1: ${error.message}`));
  let title = null;
  let second = null;

  try {
    console.log('1. DEVICE 2 FOLLOWS DEVICE 1');
    await open(first, '/files?kind=video');
    // The live catalogue's video is a ten-second test signal: it is put on with [ WATCH IN ROOM ], looped, and paused early, so
    // the steps below have time before its end.
    title = await first.waitForFunction(() => {
      const key = [...document.querySelectorAll('button')].find((button) => button.textContent.replace(/\s+/g, ' ').trim() === '[ WATCH IN ROOM ]');
      if (key !== undefined) {
        const row = key.closest('li, article, div');
        key.click();
        return (row?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60);
      }
      [...document.querySelectorAll('button[aria-expanded="false"]')].find((button) => button.textContent.includes('[+] VIDEOS'))?.click();
      return false;
    }, null, { timeout: 60000, polling: 1000 }).then((handle) => handle.jsonValue());
    await until(first, 'device 1 plays it', (held) => !held.paused && held.time > 0.5, 60000);
    await first.evaluate(() => {
      const loop = document.querySelector('[data-room-loop="off"]');
      if (loop !== null) loop.click();
      document.querySelector('[data-dock-window="stream"] video[data-watch-video]').pause();
    });
    await until(first, 'device 1 paused', (held) => held.paused, 10000);
    // Device 2 opens the same page with your room's window, as it comes back on a device where it was open.
    const notes = await first.evaluate(() => ({ shown: localStorage.getItem('debaser.site.own-room-shown.v1'), open: localStorage.getItem('debaser.site.room-window-open.v1') }));
    second = await two.newPage();
    await installSession(second, a);
    await second.addInitScript((held) => {
      if (held.shown) localStorage.setItem('debaser.site.own-room-shown.v1', held.shown);
      if (held.open) localStorage.setItem('debaser.site.room-window-open.v1', held.open);
    }, notes);
    second.on('pageerror', (error) => errors.push(`2: ${error.message}`));
    await open(second, '/files?kind=video');
    const heard1 = await stage(first);
    const heard2 = await until(second, 'device 2 opens on the same place, paused', (held) => held.paused && Math.abs(held.time - heard1.time) < 1, 45000);
    await sleep(3000);
    console.log(`    1: ${heard1.time.toFixed(1)}s ${heard1.role}   2: ${heard2.time.toFixed(1)}s ${(await stage(second)).role}`);
    assert.deepEqual([(await stage(first)).role, (await stage(second)).role], ['host', 'viewer'], 'device 1 leads, device 2 follows');
    assert.equal((await stage(first)).paused, true, 'opening device 2 did not start or move device 1');
    pass(`device 2 opened on ${title}, at device 1's paused place, and follows it`);

    console.log('2. PLAY ON DEVICE 2');
    await second.evaluate(() => void document.querySelector('[data-dock-window="stream"] video[data-watch-video]').play());
    await until(first, 'device 1 plays with device 2', (held) => !held.paused, 10000);
    await sleep(1500);
    const [now1, now2] = [await stage(first), await stage(second)];
    console.log(`    1: ${now1.time.toFixed(1)}s ${now1.role}   2: ${now2.time.toFixed(1)}s ${now2.role}`);
    assert.ok(Math.abs(now1.time - now2.time) < 2.5, `together (${now1.time.toFixed(1)}s and ${now2.time.toFixed(1)}s)`);
    assert.deepEqual([now1.role, now2.role], ['viewer', 'host'], 'device 2 leads now');
    pass('play on device 2 played device 1, together, and device 2 leads');

    console.log('3. A PAUSE ON DEVICE 2');
    await second.evaluate(() => document.querySelector('[data-dock-window="stream"] video[data-watch-video]').pause());
    await until(first, 'device 1 pauses with device 2', (held) => held.paused, 10000);
    pass('pausing on device 2 paused device 1');
    await first.screenshot({ path: join(SHOTS, 'device-1.png') });
    assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
    console.log(`\nPASSED ${passed}`);
  } catch (error) {
    console.error(`\nFAILED after ${passed}: ${error.message}`);
    try {
      console.error(`    1: ${JSON.stringify(await stage(first))}   2: ${second === null ? '-' : JSON.stringify(await stage(second))}`);
      await first.screenshot({ path: join(SHOTS, 'fail-1.png') });
      if (second !== null) await second.screenshot({ path: join(SHOTS, 'fail-2.png') });
    } catch {}
    process.exitCode = 1;
  } finally {
    console.log(`LEFT: in TEST ACCOUNT A's own room, ${title ?? 'a FILES video'} filed in its queue, the room paused.`);
    await browser.close();
  }
})();
