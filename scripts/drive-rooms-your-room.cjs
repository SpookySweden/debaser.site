/*
 * Drives SPEC-rooms-your-room.md, parts 1 and 2, in a real browser: YOUR ROOM in the live room's frame with keys that
 * work, GO LIVE turning that window into the live room where it stands, the room window lifted off the music bar as one
 * piece, `[ _ ]` as PIP with the way back on the picture, the folded tile gone, and the floating picture dragged by the
 * picture. Not in `npm run checks`: it needs a running site.
 *
 *   node scripts/drive-rooms-your-room.cjs --base http://localhost:3003
 *
 * For a local dev server on mock data only (start it with NEXT_PUBLIC_SUPABASE_URL empty and every data source on
 * mock, so nothing reaches the live database). It signs nobody up: the "account" is a made-up one in the browser's mock
 * store. The one thing it asks of the network is a five-second public test video (`--no-video` skips every step that
 * needs a video, which is most of the PIP proof).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3003');
const SHOTS = join('Temp', 'browse', 'rooms');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';

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

/** Keeps hold of the bar's one audio element, which is made outside the page's tree. */
const HOOK = `(() => {
  const Orig = window.Audio;
  window.__audios = [];
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
})()`;

/** Three quiet 45-second tones for the mock shelf, as `drive-own-room.cjs` brings them, and a made-up account signed in. */
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
const barQueue = (page) => page.evaluate(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue') ?? -1));

async function pressTransport(page) {
  await page.evaluate(() => {
    const previous = document.querySelector('button[aria-label="Previous track"]');
    previous.parentElement.querySelectorAll('button')[1].click();
  });
}
/** The bar's middle cell walks playing -> paused -> looping -> playing: pressed until the sound is what is wanted. */
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

/** A box on the page, in screen pixels, or null. */
const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) return null;
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }, selector);
/** A range input moved the way a hand moves it: through the element's own setter, so React hears the change. */
const setRange = (page, selector, value) =>
  page.evaluate(
    ([sel, to]) => {
      const input = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(to));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [selector, value],
  );
/** A drag with the mouse, in steps, as a hand makes it. */
async function dragBy(page, x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10);
  await page.mouse.up();
  await sleep(300);
}
const near = (a, b, slack = 2) => Math.abs(a - b) <= slack;

const ROOM = '[data-dock-window="stream"]';
const titleOf = (page) => page.locator(ROOM).getAttribute('aria-label');
/** Where a room window's title line can be pressed without pressing a key: well left of its keys. */
async function titlePoint(page) {
  const bar = await rectOf(page, `${ROOM} .title-line`);
  return { x: bar.left + 40, y: bar.top + bar.height / 2 };
}
/** How far down the screen a room window's foot may reach: the music bar's top, less the quarter-rem gap. */
const floorOf = (page) =>
  page.evaluate(() => {
    const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
    return window.innerHeight - (Number.isFinite(reach) ? reach : 0) - 4;
  });

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(HOOK);
  await context.addInitScript(SEED);
  writeTones();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const withVideo = !flag('--no-video');

  try {
    console.log('YOUR ROOM, IN THE LIVE ROOM\'S FRAME (a song on)');
    await open(page, '/forum');
    await page.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await pressUntil(page, false);
    await songMenu(page, 'ADD TO QUEUE');
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 1, null, { timeout: 10000 });
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    assert.equal(await page.locator(ROOM).count(), 0, 'playing a song opens no window by itself');
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-own-room-window="account"]', { timeout: 20000 });
    assert.equal(await titleOf(page), 'YOUR ROOM');
    assert.notEqual(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'it opens as a window, not folded');

    const frame = await page.evaluate(() => {
      const box = (sel) => {
        const element = document.querySelector(sel);
        if (element === null) return null;
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return {
        screen: box('[data-own-room-screen]'),
        bar: box('[data-own-room-bar]'),
        side: box('[data-own-room-side]'),
        queueKey: box('[data-own-room-queue-key]'),
        cog: box('[data-own-room-settings]'),
        alone: box('[data-own-room-alone]'),
        goLive: box('[data-own-room-go-live]'),
        keys: [...document.querySelectorAll('[data-own-room-bar] button, [data-own-room-bar] input')].map((key) => key.getAttribute('aria-label')),
        disabled: document.querySelectorAll('[data-own-room-window] button:disabled').length,
        queueInWindow: document.querySelectorAll('[data-own-room-window] [data-own-queue]').length,
        screenIs: document.querySelector('[data-own-room-screen]').getAttribute('data-own-room-screen'),
        words: document.querySelector('[data-own-room-alone]').innerText,
        queueWords: document.querySelector('[data-own-room-queue-key]').innerText.trim(),
      };
    });
    assert.equal(frame.screenIs, 'song', 'a song on: the screen is its cover card');
    assert.ok(frame.bar !== null, 'there is a bar of keys');
    assert.ok(near(frame.bar.top, frame.screen.bottom) && near(frame.bar.left, frame.screen.left) && near(frame.bar.width, frame.screen.width), 'the bar of keys is under the picture, as wide as it');
    assert.ok(frame.side.left >= frame.screen.right, 'the side column is beside the picture');
    assert.equal(frame.queueWords, '[ QUEUE ]');
    assert.ok(near(frame.queueKey.top, frame.cog.top, 6) && frame.cog.left > frame.queueKey.right, '[ QUEUE ] and the cog head the side column, on one line');
    assert.ok(frame.queueKey.bottom <= frame.alone.top && frame.alone.left >= frame.side.left - 1, 'JUST YOU HERE is under them, where a live room has its chat');
    assert.ok(frame.words.includes('JUST YOU HERE') && frame.goLive !== null && frame.goLive.top > frame.alone.top, 'with GO LIVE in it');
    assert.deepEqual(frame.keys, ['Pause', 'Seek', 'Skip to the next in your queue'], 'a song: PLAY, the seek line and next, as a live room\'s bar has for a song');
    assert.equal(frame.disabled, 0, 'nothing is drawn disabled');
    assert.equal(frame.queueInWindow, 0, 'the queue is not stacked in the window any more: it is behind [ QUEUE ]');
    assert.equal(await page.locator(`${ROOM} button[aria-label^="Fold "]`).count(), 0, 'a song has no picture to put out, so no [ _ ]');
    assert.equal(await page.locator('[data-stream-bar]').count(), 0, 'the bar stays the music bar: your own room is not a stream');
    pass('YOUR ROOM: the picture with the bar of keys under it, the side column with [ QUEUE ] and the cog, JUST YOU HERE and GO LIVE where chat would be');
    await page.screenshot({ path: join(SHOTS, 'your-room-frame-song.png') });

    await page.locator('[data-own-room-play]').click();
    await page.waitForFunction(() => window.__audios[window.__audios.length - 1].paused, null, { timeout: 5000 });
    assert.equal(await page.locator('[data-own-room-play]').getAttribute('aria-label'), 'Play', 'the key says what a press will do');
    await page.locator('[data-own-room-play]').click();
    await page.waitForFunction(() => !window.__audios[window.__audios.length - 1].paused, null, { timeout: 5000 });
    // The mock site's own asset route answers no byte ranges, so the browser cannot land a seek in these test tones:
    // what is held is that the line asks the bar's player to move (a real song's host answers ranges).
    await page.evaluate(() => {
      window.__seeks = 0;
      window.__audios[window.__audios.length - 1].addEventListener('seeking', () => (window.__seeks += 1));
    });
    await setRange(page, '[data-own-room-bar] input[aria-label="Seek"]', 20);
    await page.waitForFunction(() => window.__seeks > 0, null, { timeout: 5000 });
    pass('the song\'s keys work: PLAY pauses and plays the bar\'s song, and the seek line moves it');

    await page.locator('[data-own-room-queue-key]').click();
    await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
    assert.ok(await page.locator('[data-queue-state="queued"]').count(), 'the queue window shows what waits');
    pass('[ QUEUE ] opens the queue as its own window, as in a live room');
    let videoQueued = false;
    if (withVideo) {
      await page.fill('#stream-queue-search', VIDEO);
      await page.keyboard.press('Enter');
      videoQueued = await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 2, null, { timeout: 30000 }).then(() => true, () => false);
      if (!videoQueued) note('the test video could not be queued (no network to its host?): every step that needs a video was skipped');
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });

    await page.locator('[data-own-room-next]').click();
    await sleep(1500);
    assert.equal(await barQueue(page), videoQueued ? 1 : 0, 'next on the room\'s bar took the queued song');
    assert.equal((await audio(page)).paused, false, 'and it plays');
    pass('next under the picture starts what is queued');

    if (videoQueued) {
      console.log('A VIDEO ON YOUR SCREEN: the keys drive the site\'s one player');
      await page.locator('[data-own-room-next]').click();
      await page.waitForSelector('[data-own-room-screen="video"]', { timeout: 20000 });
      await page.waitForSelector('[data-floating-player] video', { timeout: 20000 });
      await page.evaluate(() => {
        const video = document.querySelector('[data-floating-player] video');
        video.loop = true;
        window.__sameVideo = video;
      });
      await page.waitForFunction(() => document.querySelector('[data-own-room-bar] input[aria-label="Seek"]') !== null, null, { timeout: 20000 });
      await sleep(800);
      const video = await page.evaluate(() => {
        const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
        const box = document.querySelector('[data-own-room-screen] [data-player-box]').getBoundingClientRect();
        const bar = document.querySelector('[data-own-room-bar]').getBoundingClientRect();
        return {
          keys: [...document.querySelectorAll('[data-own-room-bar] button, [data-own-room-bar] input')].map((key) => key.getAttribute('aria-label')),
          over: Math.abs(layer.left - box.left) < 3 && Math.abs(layer.top - box.top) < 3 && Math.abs(layer.width - box.width) < 3,
          barUnder: Math.abs(bar.top - box.bottom) < 3,
          state: document.querySelector('[data-floating-player]').getAttribute('data-floating-player'),
        };
      });
      assert.equal(video.state, 'in-box', 'the video sits in the room window\'s screen');
      assert.ok(video.over && video.barUnder, 'exactly over its box, the bar of keys right under it');
      assert.deepEqual(video.keys, ['Pause', 'Seek', 'Mute', 'Volume', 'Picture in picture: floats over the site', 'Fullscreen'], 'a video: PLAY, seek, sound, PIP, FULL (no next with nothing waiting, no END, nothing disabled)');
      await page.locator('[data-own-room-play]').click();
      await page.waitForFunction(() => window.__sameVideo.paused, null, { timeout: 5000 });
      await page.waitForFunction(() => document.querySelector('[data-own-room-play]').getAttribute('aria-label') === 'Play', null, { timeout: 5000 });
      await setRange(page, '[data-own-room-bar] input[aria-label="Seek"]', 3);
      await page.waitForFunction(() => Math.abs(window.__sameVideo.currentTime - 3) < 0.5, null, { timeout: 5000 });
      await page.locator('[data-own-room-play]').click();
      await page.waitForFunction(() => !window.__sameVideo.paused, null, { timeout: 5000 });
      await page.locator('[data-own-room-bar] button[aria-label="Mute"]').click();
      await page.waitForFunction(() => window.__sameVideo.muted, null, { timeout: 5000 });
      await page.locator('[data-own-room-bar] button[aria-label="Unmute"]').click();
      await page.waitForFunction(() => !window.__sameVideo.muted, null, { timeout: 5000 });
      await setRange(page, '[data-own-room-bar] input[aria-label="Volume"]', 0.5);
      await page.waitForFunction(() => Math.abs(window.__sameVideo.volume - 0.5) < 0.01, null, { timeout: 5000 });
      // A press on the player's own controls is heard by the key too: paused in the player, the key offers PLAY.
      await page.evaluate(() => window.__sameVideo.pause());
      await page.waitForFunction(() => document.querySelector('[data-own-room-play]').getAttribute('aria-label') === 'Play', null, { timeout: 5000 });
      await page.evaluate(() => void window.__sameVideo.play());
      await page.waitForFunction(() => document.querySelector('[data-own-room-play]').getAttribute('aria-label') === 'Pause', null, { timeout: 5000 });
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo), 'the same player element throughout: nothing reloaded');
      pass('the video\'s keys work on the one floating player: PLAY, seek, mute, volume; and the PLAY key follows the player\'s own controls');
      await page.screenshot({ path: join(SHOTS, 'your-room-frame-video.png') });
    }

    console.log('THE ROOM WINDOW LIFTS OFF THE MUSIC BAR');
    const floor = await floorOf(page);
    const filled = await rectOf(page, ROOM);
    assert.ok(near(filled.bottom, floor, 3), `opened, its foot rests on the music bar (${filled.bottom} vs ${floor})`);
    // Its foot is pulled up by the grip on it: the window gets shorter at once, from where the foot is drawn.
    await dragBy(page, filled.left + filled.width / 2, filled.bottom - 1, 0, -200);
    const short = await rectOf(page, ROOM);
    assert.ok(near(short.bottom, filled.bottom - 200, 3) && near(short.top, filled.top), `the foot came up by the pull (${filled.bottom} -> ${short.bottom})`);
    let grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, 80);
    const down = await rectOf(page, ROOM);
    assert.ok(near(down.top, short.top + 80) && near(down.height, short.height), `dragged down, it moves as one piece (top ${short.top} -> ${down.top}, height ${short.height} -> ${down.height})`);
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, -60);
    const up = await rectOf(page, ROOM);
    assert.ok(near(up.top, down.top - 60) && near(up.height, down.height), `dragged up, the whole window lifts (top ${down.top} -> ${up.top}, height ${down.height} -> ${up.height})`);
    assert.ok(up.bottom < floor - 100, `and its foot is well clear of the bar (${Math.round(floor - up.bottom)}px above it)`);
    await sleep(1500);
    const stayed = await rectOf(page, ROOM);
    assert.ok(near(stayed.top, up.top, 0.5) && near(stayed.bottom, up.bottom, 0.5), 'it stays where it is put');
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, 700);
    const onBar = await rectOf(page, ROOM);
    assert.ok(near(onBar.bottom, floor, 3) && near(onBar.height, up.height), `dragged far down, its foot stops at the bar and it is not squashed (foot ${onBar.bottom}, floor ${floor}, height ${onBar.height})`);
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, -10, -90);
    const lifted = await rectOf(page, ROOM);
    assert.ok(near(lifted.top, onBar.top - 90) && near(lifted.left, onBar.left - 10) && near(lifted.height, onBar.height), `off the bar again, in one piece (top ${onBar.top} -> ${lifted.top})`);
    if (videoQueued) {
      const follows = await page.evaluate(() => {
        const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
        const box = document.querySelector('[data-own-room-screen] [data-player-box]').getBoundingClientRect();
        return { over: Math.abs(layer.left - box.left) < 3 && Math.abs(layer.top - box.top) < 3, same: document.querySelector('[data-floating-player] video') === window.__sameVideo };
      });
      assert.ok(follows.over && follows.same, 'the video went with the window, the same element still');
    }
    pass('the room window: resized by its foot, dragged down and up as one piece, off the bar and staying there, never under the bar');
    await page.screenshot({ path: join(SHOTS, 'your-room-lifted.png') });

    if (videoQueued) {
      console.log('[ _ ] IS PIP: the video floats, and the way back is on it');
      await page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`).click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'floating', null, { timeout: 10000 });
      assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo && !window.__sameVideo.paused), 'the same video, still playing');
      assert.equal(await page.locator('[data-own-room-door]').count(), 0, 'no [ ▲ ROOM ] tile for a folded room');
      assert.equal(await page.locator('[data-watch-tv-box]').count(), 0, 'and no folded tile above the bar');
      const grips = await page.evaluate(() => [...document.querySelectorAll('[data-floating-player] [data-float-grip]')].map((grip) => Math.round(grip.getBoundingClientRect().width) + 'x' + Math.round(grip.getBoundingClientRect().height)));
      assert.equal(grips.length, 8, 'the floating picture has its eight grips');
      assert.equal(grips.filter((size) => size === '20x20').length, 4, `its four corner grips are 20px squares, where a window's are 12px (${grips.join(' ')})`);
      await page.screenshot({ path: join(SHOTS, 'your-room-pip.png') });
      await page.locator('[data-floating-player]').getByRole('button', { name: /^Back to where/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true' && document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'in-box', null, { timeout: 10000 });
      const back = await rectOf(page, ROOM);
      assert.ok(near(back.top, lifted.top) && near(back.left, lifted.left) && near(back.height, lifted.height), 'BACK on the floating picture brings the window back where it was');
      await page.locator('[data-own-room-pip]').click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'floating' && document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') === 'true', null, { timeout: 10000 });
      await page.locator('[data-floating-player]').getByRole('button', { name: /^Back to where/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo), 'never reloaded');
      pass('[ _ ] and [ PIP ] tuck the window away and float the video; BACK on the picture is the way back; no folded tile');
    }

    console.log('GO LIVE: the same window becomes the live room, where it stands');
    const before = await page.evaluate(() => {
      const box = (sel) => {
        const { left, top, right, bottom, width, height } = document.querySelector(sel).getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return { window: box('[data-dock-window="stream"]'), screen: box('[data-own-room-screen]'), side: box('[data-own-room-side]'), queueKey: box('[data-own-room-queue-key]') };
    });
    await page.locator('[data-own-room-go-live]').click();
    await page.waitForSelector('[data-go-live-window]', { timeout: 10000 });
    assert.equal(await titleOf(page), 'YOUR ROOM', 'one press opens the menu and starts nothing');
    await page.locator('[data-go-live-window]').getByText('[ START ]', { exact: false }).click();
    await page.waitForFunction(() => (document.querySelector('[data-dock-window="stream"]')?.getAttribute('aria-label') ?? '').startsWith('STREAM ::'), null, { timeout: 30000 });
    await page.waitForSelector('[data-room-picture="in-room"]', { timeout: 30000 });
    await page.waitForSelector('#watch-chat', { timeout: 20000 });
    await sleep(1500);
    if (videoQueued) {
      await page.waitForSelector('[data-room-picture] video', { timeout: 20000 });
      await page.evaluate(() => {
        document.querySelector('[data-room-picture] video').loop = true;
      });
    }
    const after = await page.evaluate(() => {
      const box = (sel) => {
        const element = document.querySelector(sel);
        if (element === null) return null;
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return {
        window: box('[data-dock-window="stream"]'),
        picture: box('[data-room-picture]'),
        queueKey: box('[data-watch-queue-key]'),
        minimized: document.querySelector('[data-dock-window="stream"]').getAttribute('data-minimized'),
        badge: document.querySelector('[data-dock-window="stream"] .title-line').innerText,
      };
    });
    assert.notEqual(after.minimized, 'true', 'the live room opens as a window, not folded and not as PIP');
    assert.ok(after.badge.includes('LIVE'), 'and says LIVE');
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(after.window[side], before.window[side]), `the window did not move (${side}: ${before.window[side]} -> ${after.window[side]})`);
    for (const side of ['left', 'top', 'width']) assert.ok(near(after.picture[side], before.screen[side]), `the picture is where it was (${side}: ${before.screen[side]} -> ${after.picture[side]})`);
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(after.queueKey[side], before.queueKey[side]), `[ QUEUE ] is where it was (${side}: ${before.queueKey[side]} -> ${after.queueKey[side]})`);
    pass('GO LIVE: the same window, in the same place, the picture and [ QUEUE ] where they were; chat arrives and it says LIVE');
    await page.screenshot({ path: join(SHOTS, 'your-room-went-live.png') });

    console.log('THE LIVE ROOM: [ _ ] IS PIP, THE PICTURE IS A HANDLE, THE TILE IS GONE');
    await page.locator(`${ROOM} button[aria-label^="Fold "]`).click();
    await page.waitForSelector('[data-room-picture="floating"]', { timeout: 10000 });
    assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true');
    assert.equal(await page.locator('[data-watch-tv-box]').count(), 0, 'no folded tile above the bar');
    assert.equal(await page.locator('[data-own-room-door]').count(), 0);
    assert.equal(await page.locator('[data-room-float] button').count(), 1, 'the picture has one key');
    assert.equal(await page.locator('[data-room-float]').getByRole('button', { name: 'Back to the room' }).count(), 1, 'and it is the way back');
    const roomGrips = await page.evaluate(() => [...document.querySelectorAll('[data-room-picture] [data-float-grip]')].map((grip) => Math.round(grip.getBoundingClientRect().width) + 'x' + Math.round(grip.getBoundingClientRect().height)));
    assert.equal(roomGrips.filter((size) => size === '20x20').length, 4, `four 20px corner grips (${roomGrips.join(' ')})`);
    await page.evaluate(() => {
      window.__roomPlayer = document.querySelector('[data-room-picture] video, [data-room-picture] iframe');
    });
    const float = await rectOf(page, '[data-room-picture]');
    // By the picture: a press in the middle of it, well under the title line.
    await dragBy(page, float.left + float.width / 2, float.top + float.height / 2 + 20, 220, -160);
    const moved = await rectOf(page, '[data-room-picture]');
    assert.ok(near(moved.left, float.left + 220, 3) && near(moved.top, float.top - 160, 3), `dragged by the picture, it moves (${Math.round(float.left)},${Math.round(float.top)} -> ${Math.round(moved.left)},${Math.round(moved.top)})`);
    assert.ok(near(moved.width, float.width) && near(moved.height, float.height), 'the same size');
    // A press that does not travel is still a press: nothing moves.
    await page.mouse.click(moved.left + moved.width / 2, moved.top + moved.height / 2 + 20);
    await sleep(300);
    const still = await rectOf(page, '[data-room-picture]');
    assert.ok(near(still.left, moved.left, 0.5) && near(still.top, moved.top, 0.5), 'a press without a drag moves nothing');
    // By the title line still.
    const strip = await rectOf(page, '[data-room-float]');
    await dragBy(page, strip.left + 30, strip.top + strip.height / 2, -50, 40);
    const byLine = await rectOf(page, '[data-room-picture]');
    assert.ok(near(byLine.left, still.left - 50, 3) && near(byLine.top, still.top + 40, 3), 'and by its title line, as before');
    // A corner grip, by its outer part.
    await dragBy(page, byLine.right + 4, byLine.bottom + 4, 60, 40);
    const bigger = await rectOf(page, '[data-room-picture]');
    assert.ok(near(bigger.width, byLine.width + 60, 3) && near(bigger.height, byLine.height + 40, 3), `a corner grip resizes it (${Math.round(byLine.width)}x${Math.round(byLine.height)} -> ${Math.round(bigger.width)}x${Math.round(bigger.height)})`);
    assert.ok(await page.evaluate(() => window.__roomPlayer === null || window.__roomPlayer === document.querySelector('[data-room-picture] video, [data-room-picture] iframe')), 'the room\'s player was never rebuilt');
    pass('the live room folded: its picture floats, drags by the picture and by its title line, resizes by a bigger corner grip; BACK is its one key; no tile');
    await page.screenshot({ path: join(SHOTS, 'live-room-pip.png') });
    await page.locator('[data-room-float]').getByRole('button', { name: 'Back to the room' }).click();
    await page.waitForSelector('[data-room-picture="in-room"]', { timeout: 10000 });
    assert.notEqual(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'BACK brings the room\'s window back');
    const home = await rectOf(page, ROOM);
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(home[side], after.window[side]), `where it was (${side})`);
    pass('BACK on the floating picture brings the room\'s window back where it was');

    // The stream's own strip is on the bar now, taller or shorter than the music bar: the window still lifts.
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 30, -40);
    const liveLifted = await rectOf(page, ROOM);
    assert.ok(near(liveLifted.top, home.top - 40) && near(liveLifted.height, home.height), 'the live room\'s window moves as one piece too');
    pass('the live room\'s window lifts the same way');

    await page.getByText('[ END STREAM ]', { exact: false }).first().click();
    await page.getByText('[ END FOR EVERYBODY ]', { exact: false }).first().click();
    await page.waitForFunction(
      () => {
        const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
        return !kept.rooms.some((held) => held.origin === 'stream' && held.hostId === 'drive-user' && held.endedAt === null);
      },
      null,
      { timeout: 20000 },
    );
    pass('END STREAM, to leave the mock store tidy');

    if (withVideo) {
      console.log('A YOUTUBE VIDEO ON YOUR SCREEN: its frame takes the same keys, by message');
      // The mock MEDIA page has one row over a real YouTube video. Its player is YouTube's own frame: the keys reach it
      // by the messages its own script sends, and what it says back is all this can know of it.
      await open(page, '/media');
      const listed = await page.waitForFunction(() => [...document.querySelectorAll('li')].some((row) => /YOUTUBE · VIDEO/.test(row.innerText)), null, { timeout: 45000 }).then(() => true, () => false);
      if (!listed) note('no YouTube row on the mock MEDIA page: the YouTube keys were not driven');
      else {
        await page.evaluate(() => {
          window.__said = [];
          window.addEventListener('message', (event) => {
            if (!/youtube/.test(event.origin)) return;
            try {
              const said = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (said && said.info) window.__said.push(said.info);
            } catch {
              // Not for us.
            }
          });
        });
        await page.locator('li').filter({ hasText: 'YOUTUBE · VIDEO' }).first().locator('button[aria-label^="Play "]').first().click();
        await page.waitForSelector('[data-floating-player] iframe', { timeout: 20000 });
        await page.evaluate(() => {
          window.__frame = document.querySelector('[data-floating-player] iframe');
          window.__loads = 0;
          window.__frame.addEventListener('load', () => (window.__loads += 1));
        });
        await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 15000 });
        await page.locator('[data-own-room-door] button').click();
        await page.waitForSelector('[data-own-room-screen="video"]', { timeout: 20000 });
        // Playing by YouTube's own word (its state 1), not by what the key assumes before the player has spoken.
        const spoke = await page
          .waitForFunction(() => window.__said.some((info) => info.playerState === 1) && document.querySelector('[data-own-room-bar] input[aria-label="Seek"]') !== null && document.querySelector('[data-own-room-play="playing"]') !== null, null, { timeout: 60000 })
          .then(() => true, () => false);
        if (!spoke) note('YouTube\'s player did not play or say its clock here (no network to it, or it asked for a press): its keys were not driven');
        else {
          const keys = await page.evaluate(() => [...document.querySelectorAll('[data-own-room-bar] button, [data-own-room-bar] input')].map((key) => key.getAttribute('aria-label')));
          assert.ok(['Pause', 'Seek', 'Mute', 'Volume', 'Picture in picture: floats over the site', 'Fullscreen'].every((label) => keys.includes(label)), `YouTube has the same keys as our own file (${keys.join(', ')})`);
          // The frame's first load may land after the listener went on: reloads are counted from here, with it playing.
          await page.evaluate(() => {
            window.__loadsAtStart = window.__loads;
          });
          await page.locator('[data-own-room-play]').click();
          await page.waitForSelector('[data-own-room-play="paused"]', { timeout: 15000 });
          assert.ok(await page.evaluate(() => window.__said.some((info) => info.playerState === 2)), 'YouTube says it paused');
          await page.locator('[data-own-room-play]').click();
          await page.waitForSelector('[data-own-room-play="playing"]', { timeout: 15000 });
          // A pause and a play in quick succession is how a double press on YouTube's picture is heard from outside, and a
          // double press is FULL. The room's own key must not set that off (it did: found here, 2026-11-16).
          await sleep(1500);
          assert.equal(await page.evaluate(() => document.fullscreenElement === null), true, 'a quick pause and play from the key is not a double press: nothing went fullscreen');
          await setRange(page, '[data-own-room-bar] input[aria-label="Seek"]', 120);
          await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-own-room-bar] [data-watch-clock]').getAttribute('data-watch-clock')) - 123) < 8, null, { timeout: 20000 });
          await page.evaluate(() => {
            window.__said = [];
          });
          await page.locator('[data-own-room-bar] button[aria-label="Mute"]').click();
          await page.waitForFunction(() => window.__said.some((info) => info.muted === true), null, { timeout: 15000 });
          await page.locator('[data-own-room-bar] button[aria-label="Unmute"]').click();
          await page.waitForFunction(() => window.__said.some((info) => info.muted === false), null, { timeout: 15000 });
          await setRange(page, '[data-own-room-bar] input[aria-label="Volume"]', 0.3);
          await page.waitForFunction(() => window.__said.some((info) => info.volume === 30), null, { timeout: 15000 });
          assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] iframe') === window.__frame && window.__loads === window.__loadsAtStart), 'the same frame throughout, never reloaded');
          pass('YouTube on your screen: PLAY, seek, mute and volume reach its own player, and the keys show what it says back; never reloaded');
          await page.screenshot({ path: join(SHOTS, 'your-room-frame-youtube.png') });
        }
        await page.locator(`${ROOM} button[aria-label="Close YOUR ROOM"]`).click();
        await page.locator('[data-floating-player]').getByRole('button', { name: /^Close "/ }).click().catch(() => undefined);
      }
    }

    console.log('PHONE WIDTH: nothing scrolls sideways with your room open');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/forum');
    // After a reload the room is back, paused, with what was on: its door is there without anything being pressed.
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    // Pressed in the page: a first-visit sheet (PRIVACY) lies over the door at this width.
    await page.evaluate(() => document.querySelector('[data-own-room-door] button').click());
    await page.waitForSelector('[data-own-room-window="account"]', { timeout: 20000 });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(sideways <= 1, `no sideways scroll at 390 (${sideways}px over)`);
    const stacked = await page.evaluate(() => {
      const screen = document.querySelector('[data-own-room-screen]').getBoundingClientRect();
      const side = document.querySelector('[data-own-room-side]').getBoundingClientRect();
      return side.top >= screen.bottom - 1;
    });
    assert.ok(stacked, 'at phone width the side column is under the picture, as in a live room');
    pass('at 390 wide: no sideways scroll, the picture then the column');
    await page.screenshot({ path: join(SHOTS, 'your-room-phone.png') });

    assert.deepEqual(errors, [], 'no errors on the page');
    pass('no page errors');
    console.log(`\n${passed} passed${notes.length ? `, ${notes.length} note(s)` : ''}`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'your-room-failed.png') }).catch(() => undefined);
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    rmSync(DRIVE_AUDIO, { recursive: true, force: true });
  }
})();
