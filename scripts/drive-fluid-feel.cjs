/*
 * FLUID's feel in a real browser (list 4, 2026-11-16). Not in `npm run checks`: it needs a running site.
 * `Temp/check-backdrop-fluid.cjs` holds the simulation's own arithmetic; this holds what only a page can show.
 *
 *   node scripts/drive-fluid-feel.cjs --base http://localhost:3321
 *
 * For a local dev server on mock data only (NEXT_PUBLIC_SUPABASE_URL empty: nothing reaches the live database; the drive
 * also refuses every request to Supabase). It signs nobody in. Held here:
 *   1. where the windows are reaches the water every step while a window can move (a press held, a title bar dragged),
 *      and only twice a second while the page sits still (Luke: "the tick rate for those movements also need to be
 *      increased"; it was twice a second, always);
 *   2. the site window put away with ink round it: the space it left shows ink within moments, not a black square
 *      (Luke: "the fluid ... creativeley disperses so that its not leaving this jarring black square briefly");
 *   3. your room opened, fullscreened and back, then closed with its X (which folds it, playing on): the water no longer
 *      goes round where it was - a press there makes ink (Luke: "fluid seems to obey a closed room winodw sometimes").
 *
 * `--keep` leaves the drive's tones in assets/audio/_drive/ (they are removed at the end otherwise).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3321';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** How many of the background's cells inside a box of screen pixels show ink, and how many cells there are. */
const drawn = (page, box) =>
  page.evaluate((within) => {
    const canvas = document.querySelector('.backdrop-canvas');
    const cell = Math.round(parseFloat(canvas.style.width) / canvas.width);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = { count: 0, cells: 0 };
    for (let y = Math.max(0, Math.floor(within.y / cell)); y < Math.min(canvas.height, Math.ceil((within.y + within.height) / cell)); y += 1) {
      for (let x = Math.max(0, Math.floor(within.x / cell)); x < Math.min(canvas.width, Math.ceil((within.x + within.width) / cell)); x += 1) {
        seen.cells += 1;
        const at = (y * canvas.width + x) * 4;
        if (data[at + 3] !== 0 && data[at] + data[at + 1] + data[at + 2] >= 24) seen.count += 1;
      }
    }
    return seen;
  }, box);

/** Counts how often the site window's box is measured: the background is the only thing on the page that measures it. */
const COUNT = `(() => {
  const measure = Element.prototype.getBoundingClientRect;
  window.__frameMeasured = 0;
  Element.prototype.getBoundingClientRect = function () {
    if (this.getAttribute && this.getAttribute('data-site-window') === 'frame') window.__frameMeasured += 1;
    return measure.call(this);
  };
})()`;

/** The bar's one audio element, made outside the page's tree (as scripts/drive-own-room.cjs keeps it). */
const HOOK = `(() => {
  const Orig = window.Audio;
  window.__audios = [];
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
})()`;

/** A mock site has no songs, so the drive brings three quiet tones (as scripts/drive-own-room.cjs does). */
const DRIVE_AUDIO = join('assets', 'audio', '_drive');
function writeTones() {
  mkdirSync(DRIVE_AUDIO, { recursive: true });
  const rate = 8000;
  const seconds = 45;
  for (const [index, pitch] of [220, 330, 440].entries()) {
    const samples = Buffer.alloc(rate * seconds);
    for (let at = 0; at < samples.length; at += 1) samples[at] = 128 + Math.round(6 * Math.sin((2 * Math.PI * pitch * at) / rate));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + samples.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write('data', 36);
    header.writeUInt32LE(samples.length, 40);
    writeFileSync(join(DRIVE_AUDIO, `tone-${index + 1}.wav`), Buffer.concat([header, samples]));
  }
}
const SEED = `(() => {
  try {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('debaser.site.backdrop.v2', 'fluid');
      sessionStorage.setItem('seeded', '1');
    }
    if (localStorage.getItem('debaser.audio.mock.v1') !== null) return;
    const track = (n) => ({ id: 'drive-tone-' + n, title: 'DRIVE TONE ' + n, credit: 'THE DRIVE', kind: 'TEST', src: '/assets/audio/_drive/tone-' + n + '.wav', length: '0:45', tags: [], folderPath: null, shelf: 'bucket' });
    localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ tracks: [track(1), track(2), track(3)] }));
  } catch {}
})()`;

const audio = (page) =>
  page.evaluate(() => {
    const element = window.__audios[window.__audios.length - 1];
    return element ? { paused: element.paused } : null;
  });
async function musicFace(page) {
  await page.evaluate(() => document.querySelector('[data-stream-bar-swap="stream"]')?.click());
  await page.waitForSelector('[data-bar-queue]', { timeout: 10000 });
}
/** The bar's middle key walks playing -> paused -> looping: pressed until the song plays. */
async function play(page) {
  for (let presses = 0; presses < 5; presses += 1) {
    const now = await audio(page);
    if (now !== null && now.paused === false) return;
    await musicFace(page);
    await page.evaluate(() => document.querySelector('button[aria-label="Previous track"]').parentElement.querySelectorAll('button')[1].click());
    await sleep(700);
  }
  assert.equal((await audio(page))?.paused, false, 'a song plays');
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(COUNT);
  await context.addInitScript(HOOK);
  await context.addInitScript(SEED);
  let supabase = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    supabase += 1;
    return route.abort();
  });
  writeTones();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${BASE}/forum`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForSelector('.backdrop-canvas', { timeout: 60000 });
    const notNow = page.getByText('NOT NOW', { exact: false });
    if (await notNow.count()) await notNow.first().click().catch(() => undefined);
    await sleep(2000);
    const frame = await page.locator('[data-site-window="frame"]').boundingBox();
    assert.ok(frame !== null && frame.x >= 60, `there is bare desk beside the site window (${frame && Math.round(frame.x)} pixels)`);

    console.log('1. HOW OFTEN THE WINDOWS REACH THE WATER');
    await page.mouse.move(5, 450);
    await sleep(1500);
    let before = await page.evaluate(() => window.__frameMeasured);
    await sleep(2000);
    const idle = (await page.evaluate(() => window.__frameMeasured)) - before;
    assert.ok(idle >= 2 && idle <= 6, `the page sitting still: the windows are measured about twice a second (${idle} times in 2 seconds)`);
    pass(`sitting still: measured ${idle} times in 2 seconds`);
    // A press held and moved: what dragging a window's title bar is to the page.
    await page.mouse.move(frame.x / 2, 300);
    await page.mouse.down();
    before = await page.evaluate(() => window.__frameMeasured);
    for (let n = 0; n < 40; n += 1) {
      await page.mouse.move(frame.x / 2 + Math.sin(n / 4) * 30, 300 + n * 5);
      await sleep(50);
    }
    const busy = (await page.evaluate(() => window.__frameMeasured)) - before;
    await page.mouse.up();
    assert.ok(busy >= 40, `a press held and moved: the windows are measured every step (${busy} times in about 2 seconds)`);
    pass(`while a press is held: measured ${busy} times in about 2 seconds (it was 4)`);

    console.log('2. THE SITE WINDOW PUT AWAY WITH INK ROUND IT');
    // Ink is stirred all round the window's edge, a cell or two off it.
    for (let lap = 0; lap < 2; lap += 1) {
      const corners = [[frame.x - 12, frame.y + 40], [frame.x + frame.width + 12, frame.y + 40], [frame.x + frame.width + 12, frame.y + frame.height - 40], [frame.x - 12, frame.y + frame.height - 40]];
      for (let side = 0; side < 4; side += 1) {
        const [from, to] = [corners[side], corners[(side + 1) % 4]];
        for (let n = 0; n <= 12; n += 1) {
          await page.mouse.move(from[0] + ((to[0] - from[0]) * n) / 12, from[1] + ((to[1] - from[1]) * n) / 12);
          await sleep(25);
        }
      }
    }
    await page.mouse.move(5, 450);
    const space = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const edge = await drawn(page, { x: frame.x - 40, y: frame.y, width: 30, height: frame.height });
    assert.ok(edge.count > edge.cells * 0.15, `there is ink beside the window (${edge.count} of ${edge.cells} cells)`);
    const shots = args.includes('--shots');
    if (shots) await page.screenshot({ path: join('Temp', 'browse', 'fluid-close-0.png') });
    await page.locator('[data-hide-window-key]').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-site-hidden') === 'on', null, { timeout: 8000 });
    await sleep(350);
    const soon = await drawn(page, space);
    if (shots) await page.screenshot({ path: join('Temp', 'browse', 'fluid-close-1.png') });
    await sleep(900);
    const later = await drawn(page, space);
    if (shots) await page.screenshot({ path: join('Temp', 'browse', 'fluid-close-2.png') });
    // (Before list 4 the space stayed black until ink drifted in by itself: a handful of cells by now.)
    assert.ok(soon.count > 120, `a third of a second after it went, ink is already in the space it left (${soon.count} of ${soon.cells} cells)`);
    assert.ok(later.count > 60, `and a second on it is still there, moving through (${later.count} cells)`);
    pass(`put away: ink runs into the space at once (${soon.count} cells after a third of a second, ${later.count} a second on), no black square`);

    console.log('3. YOUR ROOM: OPENED, FULLSCREEN AND BACK, CLOSED');
    // The site window stays put away: the room is then the only thing in the middle of the page that could be solid.
    await play(page);
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 15000 });
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-dock-window="stream"]', { timeout: 15000 });
    await sleep(1500);
    const room = await page.locator('[data-dock-window="stream"]').boundingBox();
    assert.ok(room !== null && room.width > 200, 'your room is open');
    const spot = { x: Math.round(room.x + room.width / 2), y: Math.round(room.y + room.height / 2) };
    // Fullscreen and back (the room's own [ FULL ] key shows for a video; a song's room is fullscreened the same way).
    const full = await page.evaluate(async () => {
      try {
        await document.querySelector('[data-dock-window="stream"]').requestFullscreen();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const was = document.fullscreenElement !== null;
        await document.exitFullscreen();
        return was;
      } catch {
        return false;
      }
    });
    await sleep(1200);
    console.log(`  (fullscreen ${full ? 'entered and left' : 'refused by this headless browser; the rest runs without it'})`);
    await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') === 'true', null, { timeout: 10000 });
    assert.equal((await audio(page))?.paused, false, 'closing your room folds it: the song plays on');
    await sleep(1500);
    const quiet = await drawn(page, { x: spot.x - 40, y: spot.y - 40, width: 80, height: 80 });
    await page.mouse.click(spot.x, spot.y);
    await sleep(500);
    const pressed = await drawn(page, { x: spot.x - 40, y: spot.y - 40, width: 80, height: 80 });
    assert.ok(pressed.count > quiet.count + 10, `a press where the closed room was makes ink there (${quiet.count} cells, then ${pressed.count}): nothing of it is solid`);
    pass('your room closed (folded, playing on): the water takes no notice of where it was');

    assert.equal(supabase, 0, 'nothing reached for Supabase');
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`\n${passed} passed`);
  } catch (failure) {
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (!args.includes('--keep')) rmSync(DRIVE_AUDIO, { recursive: true, force: true });
  }
})();
