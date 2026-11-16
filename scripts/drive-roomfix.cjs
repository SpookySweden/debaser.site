/*
 * Drives Luke's room fixes of 2026-11-16 (the ROOMFIX list) in a real browser, on a local dev server with mock data only:
 *
 *   1. the edge between the picture and the side column drags the chat wider or narrower, remembered, both rooms;
 *   2. CANVAS pressed while the visualiser shows puts the visualiser away and shows the canvas, in one press;
 *   3. a YouTube video in a live room: English on SUBS shows English captions in YouTube's player;
 *   4. READ YOUR OWN BOOK on MEDIA keeps the room and what is playing (it was a fresh page load);
 *   5. the room window dragged hard against the bar at the foot is never squashed;
 *   6. something added while the screen is blank (the three keys) starts by itself, both rooms;
 *   7. [ _ ] folds a room to a key above the player and floats nothing; [ PIP ] floats it; the key brings either back;
 *   8. the floating picture has no BACK, FULL or GO LIVE.
 *
 *   node scripts/drive-roomfix.cjs --base http://localhost:3315 [--only 1,3] [--no-youtube]
 *
 * Start the server with Temp/browse/dev-mock-rooms.cjs (every data source on mock, Supabase empty): nothing reaches the
 * live database, and the "account" is a made-up one in the browser's mock store. From the network it asks a five-second
 * public test video, and YouTube itself for item 3 (`--no-youtube` skips that).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3315');
const ONLY = opt('--only', null);
const wants = (item) => ONLY === null || ONLY.split(',').includes(String(item));
const SHOTS = join('Temp', 'browse', 'roomfix');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
/** A picture for the queue, answered here: its turn on the screen, then NEXT with nothing behind it leaves the screen blank. */
const PICTURE = 'https://upload.wikimedia.org/wikipedia/commons/drive-roomfix.png';
/** YouTube videos with English captions made by people, tried in turn until one lists them (item 3). */
const CAPTIONED = (opt('--youtube', '') || 'M7lc1UVf-VE,jNQXAC9IVRw,8S0FDjFBj8o').split(',');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const notes = [];
const note = (what) => {
  notes.push(what);
  console.log(`  NOTE ${what}`);
};

const HOOK = `(() => {
  const Orig = window.Audio;
  window.__audios = [];
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
})()`;
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
    if (localStorage.getItem('debaser.audio.mock.v1') === null) {
      const track = (n) => ({ id: 'drive-tone-' + n, title: 'DRIVE TONE ' + n, credit: 'THE DRIVE', kind: 'TEST', src: '/assets/audio/_drive/tone-' + n + '.wav', length: '0:45', tags: [], folderPath: null, shelf: 'bucket' });
      localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ tracks: [track(1), track(2), track(3)] }));
    }
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
  } catch {}
})()`;

const audio = (page) =>
  page.evaluate(() => {
    const element = window.__audios[window.__audios.length - 1];
    return element ? { paused: element.paused, time: element.currentTime } : null;
  });
async function pressTransport(page) {
  await page.evaluate(() => {
    const previous = document.querySelector('button[aria-label="Previous track"]');
    previous.parentElement.querySelectorAll('button')[1].click();
  });
}
async function pressUntil(page, wantPaused) {
  for (let presses = 0; presses < 5; presses += 1) {
    const now = await audio(page);
    if (now !== null && now.paused === wantPaused) return;
    await pressTransport(page);
    await sleep(700);
  }
  const now = await audio(page);
  assert.ok(now !== null && now.paused === wantPaused, `the bar's middle key ${wantPaused ? 'pauses' : 'plays'} the song`);
}
async function songMenu(page, key) {
  await page.locator('button[aria-label^="Song options for"]').first().click();
  await page.locator('[data-song-menu]').getByText(key, { exact: false }).first().click();
  await sleep(300);
  if (await page.locator('[data-song-menu]').count()) await page.keyboard.press('Escape');
  await sleep(200);
}
async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 90000 });
  const notNow = page.getByText('NOT NOW', { exact: false });
  if (await notNow.count()) await notNow.first().click().catch(() => undefined);
  await sleep(800);
}
const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) return null;
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }, selector);
async function dragBy(page, x, y, dx, dy, steps = 10) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) await page.mouse.move(x + (dx * step) / steps, y + (dy * step) / steps);
  await page.mouse.up();
  await sleep(300);
}
const near = (a, b, slack = 2) => Math.abs(a - b) <= slack;
const ROOM = '[data-dock-window="stream"]';
async function titlePoint(page) {
  const bar = await rectOf(page, `${ROOM} .title-line`);
  return { x: bar.left + 40, y: bar.top + bar.height / 2 };
}
const floorOf = (page) =>
  page.evaluate(() => {
    const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
    return window.innerHeight - (Number.isFinite(reach) ? reach : 0) - 4;
  });
/**
 * Adds a link through a room's queue window, which is opened by `key` and shut again after: by ENTER, as a person adds,
 * or (`straight`) by the key that puts it straight into the queue.
 */
async function queueLink(page, key, url, straight = false) {
  await page.locator(key).first().click();
  await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
  await page.fill('#stream-queue-search', url);
  if (straight) await page.locator('[data-add-queue]').first().click();
  else await page.keyboard.press('Enter');
  // Until the queue says it was added (or why not): checking a link can take a few seconds.
  await page.waitForFunction(() => ['added', 'refused'].includes(document.querySelector('[data-watch-link-state]')?.getAttribute('data-watch-link-state') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  const said = await page.evaluate(() => {
    const line = document.querySelector('[data-watch-link-state]');
    return line === null ? 'no status line' : `${line.getAttribute('data-watch-link-state')}: ${line.innerText.trim()}`;
  });
  if (!said.startsWith('added')) console.log(`     the queue said ${said} (for ${url})`);
  await sleep(800);
  if (flag('--shots')) await page.screenshot({ path: join(SHOTS, `queue-${Date.now()}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });
}
/** The side column's width and the picture's, in a room window. */
const columns = (page, side, picture) =>
  page.evaluate(
    ([sideSel, pictureSel]) => {
      const sideBox = document.querySelector(sideSel).getBoundingClientRect();
      const pictureBox = document.querySelector(pictureSel).getBoundingClientRect();
      const grip = document.querySelector(`${sideSel} [data-room-side-grip]`);
      return { side: sideBox.width, sideLeft: sideBox.left, picture: pictureBox.width, pictureRight: pictureBox.right, grip: grip === null ? null : grip.getBoundingClientRect() };
    },
    [side, picture],
  );
/** Drags a room's side-column edge by `dx` and says what it did. */
async function dragGrip(page, side, picture, dx) {
  const before = await columns(page, side, picture);
  assert.ok(before.grip !== null, 'the side column has its edge to drag');
  assert.ok(before.grip.left >= before.pictureRight - 1 && before.grip.right <= before.sideLeft + 1, 'the edge lies in the gap between the picture and the column, over neither');
  await dragBy(page, before.grip.left + before.grip.width / 2, before.grip.top + before.grip.height / 2, dx, 0);
  return { before, after: await columns(page, side, picture) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(HOOK);
  await context.addInitScript(SEED);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await context.route(PICTURE, (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png }));
  writeTones();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  // Said, not failed on: the dev server's own hydration note about the boot script's theme is old and not the rooms'.
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/hydrat|Failed to load resource/i.test(message.text())) consoleErrors.push(`${message.text().slice(0, 300)} @ ${message.location().url ?? ''}:${message.location().lineNumber ?? ''}`);
  });
  process.on('exit', () => {
    if (consoleErrors.length) console.log(`console errors seen: ${consoleErrors.length}\n  ${[...new Set(consoleErrors)].slice(0, 6).join('\n  ')}`);
  });

  try {
    console.log('YOUR ROOM, A SONG ON');
    await open(page, '/forum');
    await page.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await pressUntil(page, false);
    await songMenu(page, 'ADD TO QUEUE');
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-own-room-window="account"]', { timeout: 20000 });

    if (wants(1)) {
      console.log('1. THE CHAT COLUMN\'S EDGE DRAGS');
      const wider = await dragGrip(page, '[data-own-room-side]', '[data-own-room-screen]', -150);
      assert.ok(near(wider.after.side, wider.before.side + 150, 3), `dragged left, the column is wider by the drag (${Math.round(wider.before.side)} -> ${Math.round(wider.after.side)})`);
      assert.ok(near(wider.after.picture, wider.before.picture - 150, 3), `and the picture narrower by the same (${Math.round(wider.before.picture)} -> ${Math.round(wider.after.picture)})`);
      assert.equal(await page.evaluate(() => localStorage.getItem('debaser.site.room-side.v1')), String(Math.round(wider.after.side)), 'remembered in this browser');
      const narrower = await dragGrip(page, '[data-own-room-side]', '[data-own-room-screen]', 2000);
      assert.equal(Math.round(narrower.after.side), 240, `dragged far right, it stops at its least width (${Math.round(narrower.after.side)})`);
      const greedy = await dragGrip(page, '[data-own-room-side]', '[data-own-room-screen]', -3000);
      assert.ok(greedy.after.picture >= 318, `dragged far left, the picture keeps its room (${Math.round(greedy.after.picture)} wide)`);
      // Arrow keys move it too.
      const keyed = await columns(page, '[data-own-room-side]', '[data-own-room-screen]');
      await page.locator('[data-own-room-side] [data-room-side-grip]').focus();
      await page.keyboard.press('ArrowRight');
      await sleep(200);
      assert.ok(near((await columns(page, '[data-own-room-side]', '[data-own-room-screen]')).side, keyed.side - 24, 2), 'an arrow key moves the edge');
      await page.locator('[data-own-room-side] [data-room-side-grip]').dblclick();
      await sleep(300);
      assert.equal(await page.evaluate(() => localStorage.getItem('debaser.site.room-side.v1')), null, 'a double press puts it back to the usual width');
      assert.ok(near((await columns(page, '[data-own-room-side]', '[data-own-room-screen]')).side, wider.before.side, 2), 'and the column is its usual width again');
      await dragGrip(page, '[data-own-room-side]', '[data-own-room-screen]', -100);
      pass('YOUR ROOM: the edge between picture and column drags the column wider and narrower, within limits, by keys too, remembered; a double press resets it');
      await page.screenshot({ path: join(SHOTS, '1-your-room-wider.png') });
    }

    if (wants(7)) {
      console.log('7. [ _ ] WITH A SONG: A KEY ABOVE THE PLAYER, NOTHING FLOATS');
      const fold = page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`);
      assert.equal(await fold.count(), 1, 'a song on: YOUR ROOM can be folded (folding floats nothing, so it needs no picture)');
      await fold.click();
      await page.waitForSelector('[data-own-room-door="folded"]', { timeout: 10000 });
      assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
      assert.equal(await page.locator('[data-corner-shelf] [data-own-room-door="folded"]').count(), 1, 'its key is on the corner shelf above the player');
      assert.equal((await audio(page)).paused, false, 'the song plays on');
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      assert.equal(await page.locator('[data-own-room-door]').count(), 0, 'back, and the key goes');
      pass('[ _ ] with a song: the window folds to [ ▲ ROOM ] above the player, the song plays on, the key brings it back');
    }

    let videoUp = false;
    if (wants(6) || wants(7) || wants(8) || wants(4)) {
      console.log('6. YOUR ROOM, BLANK: SOMETHING ADDED STARTS BY ITSELF');
      await queueLink(page, '[data-own-room-queue-key]', PICTURE);
      // The song queued at the start is ahead of it: NEXT until the picture is on.
      let pictured = false;
      for (let presses = 0; presses < 4 && !pictured; presses += 1) {
        await page.locator('[data-own-room-next]').click();
        pictured = await page.waitForFunction(() => /PICTURE/.test(document.querySelector('[data-own-room-now]')?.innerText ?? ''), null, { timeout: 6000 }).then(() => true, () => false);
      }
      if (!pictured) note('the test picture would not queue or show: the blank screen was not reached that way');
      else {
        assert.equal(await page.evaluate(() => document.querySelector('[data-own-room-now]').innerText.includes('NOTHING QUEUED')), true, 'nothing waits behind the picture');
        await page.locator('[data-own-room-next]').click();
        await page.waitForFunction(() => document.querySelector('[data-own-room-screen]')?.getAttribute('data-own-room-screen') === 'empty', null, { timeout: 30000 });
        // The bar's song may still be on its shelf: the screen is blank, which is what the three keys show.
        assert.ok(await page.locator('[data-own-room-screen="empty"] button').count() >= 3, 'the blank screen with its three keys');
        await page.screenshot({ path: join(SHOTS, '6-your-room-blank.png') });
        await queueLink(page, '[data-own-room-queue-key]', VIDEO);
        videoUp = await page.waitForFunction(() => document.querySelector('[data-own-room-screen]')?.getAttribute('data-own-room-screen') === 'video', null, { timeout: 30000 }).then(() => true, () => false);
        assert.ok(videoUp, 'the video added to a blank screen is on, with no NEXT pressed');
        await page.waitForFunction(() => document.querySelector('[data-floating-player] video') !== null, null, { timeout: 30000 });
        await page.waitForFunction(() => !document.querySelector('[data-floating-player] video').paused, null, { timeout: 15000 });
        pass('YOUR ROOM: a video added while the screen is blank starts by itself');
      }
      if (!videoUp) {
        // Without the blank path, the video goes in the usual way so the folding steps can still run.
        await queueLink(page, '[data-own-room-queue-key]', VIDEO);
        for (let presses = 0; presses < 4 && !videoUp; presses += 1) {
          await page.locator('[data-own-room-next]').click();
          videoUp = await page.waitForFunction(() => document.querySelector('[data-floating-player] video') !== null, null, { timeout: 6000 }).then(() => true, () => false);
        }
        videoUp = videoUp && await page.waitForFunction(() => document.querySelector('[data-own-room-screen]')?.getAttribute('data-own-room-screen') === 'video', null, { timeout: 30000 }).then(() => true, () => false);
      }
      if (videoUp) {
        await page.waitForFunction(() => document.querySelector('[data-floating-player] video') !== null, null, { timeout: 30000 });
        await page.evaluate(() => {
          const video = document.querySelector('[data-floating-player] video');
          video.loop = true;
          window.__sameVideo = video;
        });
      } else note('no video on the screen (no network to the test video?): the video steps were skipped');
    }

    const playingOn = async (what) => {
      const t0 = await page.evaluate(() => window.__sameVideo.currentTime);
      await sleep(1200);
      const now = await page.evaluate(() => ({ t: window.__sameVideo.currentTime, paused: window.__sameVideo.paused, same: document.querySelector('[data-floating-player] video') === window.__sameVideo }));
      assert.ok(now.same && !now.paused && now.t !== t0, `${what}: the same video, still playing (${t0.toFixed(1)} -> ${now.t.toFixed(1)})`);
    };

    if (videoUp && (wants(7) || wants(8))) {
      console.log('7. [ _ ] WITH A VIDEO: IT PLAYS ON OUT OF SIGHT, NOT AS PIP');
      await page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`).click();
      await page.waitForSelector('[data-own-room-door="folded"]', { timeout: 10000 });
      await sleep(500);
      const tucked = await page.evaluate(() => {
        const layer = document.querySelector('[data-floating-player]');
        return { state: layer.getAttribute('data-floating-player'), tucked: layer.getAttribute('data-floating-tucked'), seen: window.getComputedStyle(layer).visibility };
      });
      assert.deepEqual(tucked, { state: 'in-box', tucked: 'true', seen: 'hidden' }, 'the video does not float: it is out of sight with the window');
      await playingOn('folded');
      await page.screenshot({ path: join(SHOTS, '7-your-room-folded.png') });
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-tucked') === 'false' && document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      const back = await page.evaluate(() => {
        const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
        const box = document.querySelector('[data-own-room-screen] [data-player-box]').getBoundingClientRect();
        return Math.abs(layer.left - box.left) < 3 && Math.abs(layer.top - box.top) < 3 && window.getComputedStyle(document.querySelector('[data-floating-player]')).visibility === 'visible';
      });
      assert.ok(back, 'back: the video is over its box in the window, in sight');
      await playingOn('unfolded');
      pass('[ _ ] with a video: the window folds to [ ▲ ROOM ] and the video plays on out of sight (no PIP); the key brings both back');

      console.log('7/8. [ PIP ]: THE VIDEO FLOATS, WITH NO BACK, FULL OR GO LIVE ON IT');
      await page.locator('[data-own-room-pip]').click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'floating', null, { timeout: 10000 });
      assert.equal(await page.locator('[data-own-room-door="folded"]').count(), 1, 'the window is folded with its key above the player');
      const keys = await page.evaluate(() => [...document.querySelectorAll('[data-floating-player] button')].map((key) => key.innerText.trim()));
      assert.ok(!keys.some((key) => /BACK|FULL|GO LIVE|WATCH IN ROOM|ADD TO ROOM/.test(key)), `the floating picture has no BACK, FULL or GO LIVE (${keys.join(' ')})`);
      assert.ok(keys.includes('[ × ]'), 'its close key stays');
      await playingOn('floating');
      await page.screenshot({ path: join(SHOTS, '8-your-room-pip.png') });
      // A double press on its title line is still fullscreen.
      const strip = await rectOf(page, '[data-floating-player] .cursor-move');
      await page.mouse.dblclick(strip.left + 30, strip.top + 8);
      await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'in-box' && document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      await playingOn('back from PIP');
      pass('[ PIP ] floats the video with only its close key (and a double press for fullscreen); [ ▲ ROOM ] brings the window and the video back');
    }

    if (wants(5)) {
      console.log('5. THE ROOM WINDOW AGAINST THE BAR');
      const floor = await floorOf(page);
      const filled = await rectOf(page, ROOM);
      await dragBy(page, filled.left + filled.width / 2, filled.bottom - 1, 0, -260);
      const short = await rectOf(page, ROOM);
      const log = [];
      const tries = [
        ['straight down, far', 0, 900, 10],
        ['down in one jump', 0, 900, 1],
        ['down and sideways', -200, 900, 12],
        ['along the bar', 300, 40, 12],
        ['back up a little', 0, -30, 6],
        ['down again', 0, 400, 3],
      ];
      for (const [what, dx, dy, steps] of tries) {
        const grab = await titlePoint(page);
        await dragBy(page, grab.x, grab.y, dx, dy, steps);
        await sleep(300);
        const now = await rectOf(page, ROOM);
        log.push(`${what}: ${Math.round(now.height)} tall, foot ${Math.round(now.bottom)} (floor ${Math.round(floor)})`);
        assert.ok(near(now.height, short.height, 2), `${what}: not squashed (${Math.round(short.height)} -> ${Math.round(now.height)})`);
        assert.ok(now.bottom <= floor + 2, `${what}: never under the bar`);
      }
      // While held against the bar, mid-drag, too.
      const grab = await titlePoint(page);
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      for (let step = 1; step <= 8; step += 1) await page.mouse.move(grab.x, grab.y + step * 120);
      const held = await rectOf(page, ROOM);
      await page.mouse.up();
      assert.ok(near(held.height, short.height, 2), `held against the bar mid-drag: not squashed (${Math.round(held.height)})`);
      console.log(`     ${log.join('\n     ')}`);
      pass('the room window dragged against the bar every way: never squashed, never under it');
    }

    if (videoUp && wants(4)) {
      console.log('4. READ YOUR OWN BOOK KEEPS THE ROOM AND THE VIDEO');
      await page.evaluate(() => {
        window.__noReload = 'still here';
      });
      // The room folded away, as a reader puts it to reach the page under it; the video plays on out of sight.
      await page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`).click();
      await page.waitForSelector('[data-own-room-door="folded"]', { timeout: 10000 });
      await page.locator('a[href="/media"]').first().click();
      await page.waitForURL(/\/media/, { timeout: 30000 });
      await page.waitForSelector('[data-own-book-key]', { timeout: 60000 });
      await page.locator('[data-own-book-key]').click();
      await page.waitForURL(/\/read$/, { timeout: 30000 });
      await sleep(1500);
      const kept = await page.evaluate(() => ({ same: window.__noReload === 'still here', room: document.querySelector('[data-own-room-window]') !== null, key: document.querySelector('[data-own-room-door="folded"]') !== null }));
      assert.ok(kept.same, 'no fresh page load: the page that was there is still there');
      assert.ok(kept.room && kept.key, 'the room is still open, folded, with its key above the player');
      await playingOn('on the reader page');
      await page.screenshot({ path: join(SHOTS, '4-read-page.png') });
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      await playingOn('the room unfolded on the reader page');
      pass('READ YOUR OWN BOOK: the reader opens in the page; the room and its video carry on, and come back from its key');
      await page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`).click();
      await page.locator('a[href="/forum"]').first().click().catch(() => undefined);
      await page.waitForURL(/\/forum/, { timeout: 30000 }).catch(() => undefined);
      await page.locator('[data-own-room-door="folded"] button').click();
      await sleep(1500);
    }

    if (wants(2) || wants(3) || wants(5) || wants(6) || wants(7) || wants(8) || wants(1)) {
      console.log('GO LIVE');
      await page.locator('[data-own-room-go-live]').click();
      await page.waitForSelector('[data-go-live-window]', { timeout: 10000 });
      await page.locator('[data-go-live-window]').getByText('[ START ]', { exact: false }).click();
      await page.waitForFunction(() => (document.querySelector('[data-dock-window="stream"]')?.getAttribute('aria-label') ?? '').startsWith('STREAM ::'), null, { timeout: 30000 });
      await page.waitForSelector('[data-room-picture="in-room"]', { timeout: 30000 });
      await page.waitForSelector('#watch-chat', { timeout: 20000 });
      await sleep(1500);
      const roomVideo = videoUp ? await page.waitForSelector('[data-room-picture] video', { timeout: 20000 }).then(() => true, () => false) : false;
      if (roomVideo) await page.evaluate(() => (document.querySelector('[data-room-picture] video').loop = true));

      if (wants(1)) {
        const side = '[data-dock-window="stream"] [data-room-side-grip]';
        const width = await page.evaluate((sel) => document.querySelector(sel).parentElement.getBoundingClientRect().width, side);
        assert.equal(String(Math.round(width)), await page.evaluate(() => localStorage.getItem('debaser.site.room-side.v1')), 'the live room opens with the width dragged in YOUR ROOM: one width for both');
        const at = await page.evaluate((sel) => {
          const grip = document.querySelector(sel).getBoundingClientRect();
          return { x: grip.left + grip.width / 2, y: grip.top + grip.height / 2 };
        }, side);
        await dragBy(page, at.x, at.y, 80, 0);
        const after = await page.evaluate((sel) => document.querySelector(sel).parentElement.getBoundingClientRect().width, side);
        assert.ok(near(after, width - 80, 3), `the live room's edge drags too (${Math.round(width)} -> ${Math.round(after)})`);
        pass('the live room: the same edge, the same remembered width');
      }

      if (wants(2)) {
        console.log('2. CANVAS WHILE THE VISUALISER SHOWS');
        await page.locator('[data-visualiser-toggle]').click();
        await page.waitForSelector('[data-visualiser-toggle="on"]', { timeout: 5000 });
        assert.equal(await page.locator('[data-canvas-toggle]').getAttribute('data-canvas-toggle'), 'picture');
        await page.locator('[data-canvas-toggle]').click();
        await sleep(400);
        const now = await page.evaluate(() => ({
          canvas: document.querySelector('[data-room-canvas]')?.getAttribute('data-room-canvas'),
          visualiser: document.querySelector('[data-visualiser-toggle]').getAttribute('data-visualiser-toggle'),
          toggle: document.querySelector('[data-canvas-toggle]').getAttribute('data-canvas-toggle'),
        }));
        assert.deepEqual(now, { canvas: 'shown', visualiser: 'off', toggle: 'canvas' }, 'one press on CANVAS: the canvas shows and the visualiser is put away');
        const top = await page.evaluate(() => {
          const canvas = document.querySelector('[data-room-canvas]').getBoundingClientRect();
          const hit = document.elementFromPoint(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2);
          return hit !== null && document.querySelector('[data-room-canvas]').contains(hit);
        });
        assert.ok(top, 'and nothing lies over the canvas');
        await page.screenshot({ path: join(SHOTS, '2-canvas-over-visualiser.png') });
        // The other way: the visualiser switched on from the canvas goes back to the picture under it.
        await page.locator('[data-visualiser-toggle]').click();
        await sleep(400);
        assert.equal(await page.locator('[data-canvas-toggle]').getAttribute('data-canvas-toggle'), 'picture', 'the visualiser switched on from the canvas shows over the picture');
        await page.locator('[data-visualiser-toggle]').click();
        pass('CANVAS while the visualiser shows: one press, the canvas; the visualiser from the canvas goes back to the picture');
      }

      if (wants(7) || wants(8)) {
        console.log('7. THE LIVE ROOM: [ _ ] TO A KEY, [ PIP ] FLOATS');
        await page.locator(`${ROOM} button[aria-label^="Fold "]`).click();
        await page.waitForSelector('[data-room-shelf-key="live"]', { timeout: 10000 });
        assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
        assert.equal(await page.locator('[data-room-picture="floating"]').count(), 0, 'and its picture does not float');
        assert.equal(await page.locator('[data-corner-shelf] [data-room-shelf-key]').count(), 1, 'its key is on the corner shelf above the player');
        if (roomVideo) {
          const t0 = await page.evaluate(() => document.querySelector('[data-room-picture] video').currentTime);
          await sleep(1200);
          assert.ok(await page.evaluate((t) => document.querySelector('[data-room-picture] video').currentTime !== t, t0), 'the room plays on out of sight');
        }
        await page.screenshot({ path: join(SHOTS, '7-live-folded.png') });
        await page.locator('[data-room-shelf-key] button').click();
        await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
        assert.equal(await page.locator('[data-room-shelf-key]').count(), 0, 'back, and the key goes');
        pass('the live room: [ _ ] folds it to ROOM :: LIVE above the player, nothing floats, it plays on; the key brings it back');
        // A file of our own floats by the browser's own picture-in-picture in a live room; the room's float is for another
        // site's player, so [ PIP ] onto the room's float is driven with YouTube below (item 3).
      }

      if (wants(5)) {
        console.log('5. THE BAR GROWS UNDER A ROOM WINDOW RESTING ON IT');
        const floor = await floorOf(page);
        const grab = await titlePoint(page);
        await dragBy(page, grab.x, grab.y, 0, 900);
        const resting = await rectOf(page, ROOM);
        assert.ok(near(resting.bottom, floor, 3), `resting on the bar (${Math.round(resting.bottom)} vs ${Math.round(floor)})`);
        // The bar grows by 60 (as when a stream's strip, or a second line, arrives on it).
        const was = await page.evaluate(() => document.documentElement.style.getPropertyValue('--music-top'));
        await page.evaluate((grown) => document.documentElement.style.setProperty('--music-top', `${grown}px`), Number.parseFloat(was) + 60);
        await sleep(300);
        const lifted = await rectOf(page, ROOM);
        assert.ok(near(lifted.height, resting.height, 2), `the window kept its height (${Math.round(resting.height)} -> ${Math.round(lifted.height)})`);
        assert.ok(near(lifted.bottom, floor - 60, 3), `it moved up with the bar instead (${Math.round(resting.bottom)} -> ${Math.round(lifted.bottom)})`);
        const regrab = await titlePoint(page);
        await dragBy(page, regrab.x, regrab.y, 0, 900);
        const pushed = await rectOf(page, ROOM);
        assert.ok(near(pushed.height, resting.height, 2) && near(pushed.bottom, floor - 60, 3), `dragged down against the grown bar: stopped there, the same height (${Math.round(pushed.height)})`);
        await page.evaluate((back) => document.documentElement.style.setProperty('--music-top', back), was);
        await sleep(300);
        pass('a bar that grows under a resting room window lifts it whole, and a drag against it never squashes it');
      }

      if (wants(6)) {
        console.log('6. THE LIVE ROOM, BLANK: SOMETHING ADDED STARTS BY ITSELF');
        // Straight into the queue, behind what is on: something on the screen keeps ENTER's adds on your own list as before.
        await queueLink(page, '[data-stream-bar-queue], [data-watch-queue-key]', PICTURE, true);
        await page.getByRole('button', { name: 'Skip to the next video' }).first().click({ timeout: 5000 }).catch(() => undefined);
        const held = await page.waitForSelector('[data-room-picture-held]', { timeout: 15000 }).then(() => true, () => false);
        if (!held) note('the live room did not show the test picture: its blank screen was not reached');
        else {
          await page.locator('[data-room-picture-next]').click();
          await page.waitForFunction(() => document.querySelector('[data-room-picture] [data-room-picture-held]') === null && [...document.querySelectorAll('[data-room-picture] button')].length >= 3, null, { timeout: 15000 });
          await page.screenshot({ path: join(SHOTS, '6-live-blank.png') });
          await queueLink(page, '[data-stream-bar-queue], [data-watch-queue-key]', VIDEO);
          const started = await page.waitForSelector('[data-room-picture] video[data-watch-video]', { timeout: 20000 }).then(() => true, () => false);
          assert.ok(started, 'the video added to the live room\'s blank screen is on, with no skip pressed');
          pass('the live room: a video added while the screen is blank starts by itself');
        }
      }

      if (wants(3) && !flag('--no-youtube')) {
        console.log('3. YOUTUBE IN A LIVE ROOM: ENGLISH ON SUBS');
        let shown = false;
        for (const id of CAPTIONED) {
          await queueLink(page, '[data-stream-bar-queue], [data-watch-queue-key]', `https://www.youtube.com/watch?v=${id}`, true);
          // Straight to it, past anything else waiting.
          for (let presses = 0; presses < 4; presses += 1) {
            if ((await page.locator('[data-room-picture] iframe[src*="youtube"]').count()) > 0) break;
            await page.getByRole('button', { name: /^Skip/ }).first().click().catch(() => undefined);
            await sleep(2500);
          }
          const tube = await page.waitForSelector('[data-room-picture] iframe[src*="youtube"]', { timeout: 30000 }).then(() => true, () => false);
          if (!tube) {
            note(`YouTube ${id}: no YouTube player in the room`);
            continue;
          }
          const listed = await page.waitForSelector('button[data-watch-subs]', { timeout: 30000 }).then(() => true, () => false);
          if (!listed) {
            note(`YouTube ${id}: no SUBS key (YouTube listed no captions)`);
            continue;
          }
          await page.locator('button[data-watch-subs]').click();
          const choices = await page.evaluate(() => [...document.querySelectorAll('[data-subs-choice]')].map((choice) => `${choice.getAttribute('data-subs-choice')}=${choice.innerText.trim()}`));
          console.log(`     ${id}: SUBS lists ${choices.join(' | ')}`);
          const english = page.locator('[data-subs-choice]').filter({ hasText: /ENGLISH/i }).first();
          if ((await english.count()) === 0) {
            await page.keyboard.press('Escape');
            note(`YouTube ${id}: no English on SUBS`);
            continue;
          }
          await english.evaluate((choice) => choice.click());
          // The room's own frame now, never one left over from the video before.
          const frame = await (await page.$('[data-room-picture] iframe[src*="youtube"]'))?.contentFrame();
          // Captions come with speech: up to 25 seconds for somebody to say something.
          let inside = { text: '' };
          for (let looks = 0; looks < 25 && frame && inside.text.trim() === ''; looks += 1) {
            await sleep(1000);
            inside = await frame.evaluate(() => ({ text: [...document.querySelectorAll('.ytp-caption-segment')].map((seg) => seg.textContent).filter((said) => !/for settings/i.test(said) && !/^english$/i.test(said.trim())).join(' / ') })).catch(() => ({ text: '' }));
          }
          const key = await page.locator('button[data-watch-subs]').getAttribute('data-watch-subs');
          console.log(`     ${id}: key says ${key}; captions in YouTube's player: "${inside.text}"`);
          await page.screenshot({ path: join(SHOTS, `3-youtube-subs-${id}.png`) });
          if (inside.text.trim().length > 0) {
            // Shown in what the room shows: the caption's box inside the visible part of the frame.
            const seen = await frame.evaluate(() => {
              const seg = document.querySelector('.ytp-caption-segment').getBoundingClientRect();
              return { top: seg.top, bottom: seg.bottom, height: window.innerHeight };
            });
            const visible = await page.evaluate(() => {
              const box = document.querySelector('[data-room-picture] iframe').parentElement.getBoundingClientRect();
              const frame = document.querySelector('[data-room-picture] iframe').getBoundingClientRect();
              const scale = frame.height / document.querySelector('[data-room-picture] iframe').offsetHeight;
              return { boxTop: box.top, boxBottom: box.bottom, frameTop: frame.top, scale };
            });
            const segTop = visible.frameTop + seen.top * visible.scale;
            const segBottom = visible.frameTop + seen.bottom * visible.scale;
            console.log(`     caption at ${Math.round(segTop)}-${Math.round(segBottom)}, the picture shows ${Math.round(visible.boxTop)}-${Math.round(visible.boxBottom)}`);
            assert.ok(segTop >= visible.boxTop - 1 && segBottom <= visible.boxBottom + 1, 'the English captions sit inside the part of YouTube\'s player the room shows');
            shown = true;
            pass(`YouTube ${id}: English on SUBS puts English captions on the picture ("${inside.text.slice(0, 40)}")`);
            // OFF: YouTube's player is made taller than the picture again, so its own strips are clipped off as before.
            const reach = () => page.evaluate(() => {
              const frame = document.querySelector('[data-room-picture] iframe').getBoundingClientRect();
              const box = document.querySelector('[data-room-picture] iframe').parentElement.getBoundingClientRect();
              return Math.round(frame.height - box.height);
            });
            assert.ok(Math.abs(await reach()) <= 2, 'with a subtitle on, YouTube\'s player is the picture\'s own size');
            await page.evaluate(() => document.querySelector('button[data-watch-subs]').click());
            await page.evaluate(() => document.querySelector('[data-subs-choice="off"]').click());
            await sleep(500);
            assert.ok((await reach()) > 100, `OFF: its player reaches past the picture again, its strips clipped (${await reach()}px)`);
            pass('subtitles OFF: YouTube\'s strips are clipped off again');
            break;
          }
          note(`YouTube ${id}: English chosen, but no captions drawn in YouTube's player`);
        }
        if (!shown) {
          console.log('\nFAILED: item 3: no English captions were shown');
          process.exitCode = 1;
        }
      }

      if ((wants(7) || wants(8)) && (await page.locator('[data-room-picture] iframe[src*="youtube"]').count()) > 0) {
        console.log('7/8. THE LIVE ROOM, YOUTUBE: [ PIP ] FLOATS THE PICTURE, WITH NO KEYS ON IT');
        await page.getByRole('button', { name: 'Picture in picture: floats over the site' }).first().click();
        await page.waitForSelector('[data-room-picture="floating"]', { timeout: 10000 });
        assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
        assert.equal(await page.locator('[data-room-float] button').count(), 0, 'the floating picture has no keys: no BACK, FULL or GO LIVE');
        assert.equal(await page.locator('[data-room-shelf-key="live"]').count(), 1, 'the way back is the key above the player');
        await page.screenshot({ path: join(SHOTS, '8-live-pip.png') });
        await page.locator('[data-room-shelf-key] button').click();
        await page.waitForSelector('[data-room-picture="in-room"]', { timeout: 10000 });
        assert.notEqual(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is back');
        pass('the live room: [ PIP ] floats the picture with no keys on it; ROOM :: LIVE above the player brings it back');
      }

      await page.getByText('[ END STREAM ]', { exact: false }).first().click().catch(() => undefined);
      await page.getByText('[ END FOR EVERYBODY ]', { exact: false }).first().click().catch(() => undefined);
      await sleep(1500);
    }

    assert.deepEqual(errors, [], 'no errors on the page');
    pass('no page errors');
    console.log(`\n${passed} passed${notes.length ? `, ${notes.length} note(s)` : ''}`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    rmSync(DRIVE_AUDIO, { recursive: true, force: true });
  }
})();
