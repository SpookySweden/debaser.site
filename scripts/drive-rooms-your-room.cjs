/*
 * Drives your room in a real browser (SPEC-rooms-your-room.md, rewritten for SPEC-rooms-perpetual.md on 2026-11-16, list 3):
 * your room is the live room's own window now, so this drives that window as your room: the cover card for a song, the
 * room's PLAY and seek on the bar's song and on a video in the room's own player, FULL with the picture its own shape and the
 * chosen background round it, `[ BKG ]` in the corner (off and on), bars found in a letterboxed file and trimmed, the window
 * lifting off the music bar as one piece, `[ _ ]` folding it to its key above the player, GO LIVE in place, a YouTube row
 * opening in your room with FULL and `[ BKG ]` on its frame, and phone width. Not in `npm run checks`: it needs a running site.
 *
 *   node scripts/drive-rooms-your-room.cjs --base http://localhost:3003
 *
 * For a local dev server on mock data only (Temp/browse/dev-mock-rooms.cjs: every data source on mock and Supabase empty, so
 * nothing reaches the live database). It signs nobody up: the "account" is a made-up one in the browser's mock store. It asks
 * the network for a five-second public test video and, if it is there, YouTube's player (`--no-video` skips every step that
 * needs a video). Set the background to try with `--backdrop <name>`.
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
/**
 * Part 4's test pictures, made here so nothing with bars has to be found on the internet: a six-second clip, 320 by 180, with
 * black bars 24 lines deep above and below a moving picture (played as one of the site's "own" files: it is served to the
 * browser at an Internet Archive file server's address, which the site may read pixels from, and never asked of the
 * Archive), and three stills with bars all round (40 a side, 20 above and below), answered for YouTube's.
 */
const LETTERBOX = 'https://ia800100.us.archive.org/0/items/debaser-drive/letterbox.webm';
const CLIP_BARS = 24 / 180;
const STILL_BARS = { x: 41 / 320, y: 21 / 180 };
async function makeTestPictures(context) {
  const maker = await context.newPage();
  await maker.setContent('<canvas id="c" width="320" height="180"></canvas>');
  const made = await maker.evaluate(async () => {
    const canvas = document.getElementById('c');
    const pen = canvas.getContext('2d');
    const paint = (t, x, y) => {
      pen.fillStyle = '#000';
      pen.fillRect(0, 0, 320, 180);
      pen.fillStyle = '#7a8ea0';
      pen.fillRect(x, y, 320 - 2 * x, 180 - 2 * y);
      pen.fillStyle = '#f2e9c8';
      pen.fillRect(x + 10 + ((t * 37) % 150), y + 14, 60, 50);
      pen.fillStyle = '#c0504d';
      pen.fillRect(x + 24, y + 80 + ((t * 5) % 20), 110, 18);
    };
    const stills = [0, 1, 2].map((n) => {
      paint(n * 3, 40, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    let t = 0;
    paint(0, 0, 24);
    const recorder = new MediaRecorder(canvas.captureStream(20), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 900000 });
    const parts = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    const timer = setInterval(() => {
      t += 1;
      paint(t / 4, 0, 24);
    }, 50);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    return { stills, clip: btoa(binary) };
  });
  await maker.close();
  return { stills: made.stills.map((still) => Buffer.from(still, 'base64')), clip: Buffer.from(made.clip, 'base64') };
}

/** `--backdrop sand` (or fluid, starfield, mystify, tile) runs it with that background chosen; without, the default. */
const BACKDROP = opt('--backdrop', null);

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

/**
 * Part 3 (fullscreen): what the fullscreen box holds. The surround, the picture in it (its place and shape), the chosen
 * background drawn in the surround, and whether the picture is over it. Null when nothing is fullscreen.
 */
const stagedNow = (page, pictureSelector) =>
  page.evaluate((selector) => {
    const box = document.fullscreenElement;
    if (box === null) return null;
    const surround = box.matches('.stage-surround') ? box : box.querySelector('.stage-surround');
    const picture = box.querySelector(selector);
    if (surround === null || picture === null) return { missing: surround === null ? 'the surround' : 'the picture' };
    const rect = (element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const stages = [...surround.querySelectorAll(':scope > .backdrop-stage, :scope > .backdrop-stage-tile')];
    const canvas = surround.querySelector(':scope > .backdrop-stage canvas');
    let drawn = -1;
    if (canvas !== null) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      drawn = 0;
      for (let at = 4; at < data.length; at += 4) if (data[at] !== data[0] || data[at + 1] !== data[1] || data[at + 2] !== data[2]) drawn += 1;
    }
    // A frame trimmed of its bars is bigger than what shows of it (part 4): what shows is the frame less the share cut from each edge.
    const whole = rect(picture);
    const [cutX, cutY] = (picture.getAttribute('data-backdrop-inset') ?? '').split(' ').map(Number);
    const dx = cutX > 0 ? whole.width * cutX : 0;
    const dy = cutY > 0 ? whole.height * cutY : 0;
    const at = { left: whole.left + dx, top: whole.top + dy, right: whole.right - dx, bottom: whole.bottom - dy, width: whole.width - 2 * dx, height: whole.height - 2 * dy };
    const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
    // Just outside what shows, where a bar hangs: nothing of the frame is there to see or to press.
    const beside = dy > 6 && at.top - 5 >= 0 ? [at.left + at.width / 2, at.top - 5] : dx > 6 && at.left - 5 >= 0 ? [at.left - 5, at.top + at.height / 2] : null;
    const outside = beside === null ? null : document.elementFromPoint(beside[0], beside[1]);
    // The room the picture has: the surround less the strip the site's own keys take along its foot.
    const inner = rect(surround);
    const foot = parseFloat(window.getComputedStyle(surround).paddingBottom) || 0;
    inner.bottom -= foot;
    inner.height -= foot;
    const bar = box.querySelector('[data-floating-stage-bar]');
    return {
      screen: { w: window.innerWidth, h: window.innerHeight },
      box: rect(box),
      surround: inner,
      picture: at,
      whole,
      cut: [cutX > 0 ? cutX : 0, cutY > 0 ? cutY : 0],
      view: window.getComputedStyle(picture).objectViewBox ?? '',
      barsGone: outside === null ? null : outside !== picture && !picture.contains(outside),
      key: box.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') ?? null,
      bar: bar === null ? null : rect(bar),
      stages: stages.map((stage) => stage.getAttribute('data-backdrop-scene') ?? (stage.classList.contains('aquarium-stage') ? 'aquarium' : 'unknown')),
      fish: surround.querySelectorAll('.aquarium-stage .aquarium-fish').length,
      drawn,
      onTop: hit !== null && (hit === picture || picture.contains(hit)),
      solid: picture.matches('[data-backdrop-solid]') || picture.querySelector('[data-backdrop-solid]') !== null,
      press: surround.hasAttribute('data-backdrop-press'),
      under: Number(window.getComputedStyle(stages[0] ?? surround).zIndex),
    };
  }, pictureSelector);

/** Holds what part 3 promises of a fullscreen picture of this shape, with this background chosen. */
function assertStaged(now, shape, chosen, what) {
  assert.ok(now !== null, `${what}: something is fullscreen`);
  assert.equal(now.missing, undefined, `${what}: the fullscreen box has ${now.missing}`);
  assert.ok(near(now.box.width, now.screen.w) && near(now.box.height, now.screen.h), `${what}: the box fills the screen (${now.box.width}x${now.box.height})`);
  const is = now.picture.width / now.picture.height;
  assert.ok(Math.abs(is - shape) / shape < 0.015, `${what}: the picture is the video's own shape (${is.toFixed(3)}, wanted ${shape.toFixed(3)})`);
  assert.ok(near(now.picture.width, now.surround.width, 3) || near(now.picture.height, now.surround.height, 3), `${what}: as large as fits (${Math.round(now.picture.width)}x${Math.round(now.picture.height)} in ${Math.round(now.surround.width)}x${Math.round(now.surround.height)})`);
  assert.ok(now.picture.width <= now.surround.width + 1 && now.picture.height <= now.surround.height + 1, `${what}: and never larger than its surround`);
  assert.ok(near(now.picture.left - now.surround.left, now.surround.right - now.picture.right, 3) && near(now.picture.top - now.surround.top, now.surround.bottom - now.picture.bottom, 3), `${what}: in the middle (left ${Math.round(now.picture.left - now.surround.left)}, right ${Math.round(now.surround.right - now.picture.right)}, above ${Math.round(now.picture.top - now.surround.top)}, below ${Math.round(now.surround.bottom - now.picture.bottom)})`);
  assert.deepEqual(now.stages, [chosen], `${what}: the chosen background, and only it, is drawn in the surround`);
  assert.ok(now.under < 0, `${what}: under everything in the box`);
  assert.ok(now.onTop, `${what}: the picture is over it`);
  if (chosen === 'aquarium') assert.ok(now.fish > 0, `${what}: the sea has its fish (${now.fish})`);
  // A copy on a stage starts from nothing each time: SAND has only a few grains in the air two seconds in, where the strips are narrow.
  else if (chosen !== 'tile') assert.ok(now.drawn > 5, `${what}: the background is drawing (${now.drawn} cells)`);
  assert.ok(now.solid, `${what}: the picture is marked solid for the background`);
  assert.ok(now.press, `${what}: a press on the surround reaches the background`);
  assert.equal(now.key, 'on', `${what}: [ BKG ] is in the corner, pressed in`);
  if (now.barsGone !== null) assert.ok(now.barsGone, `${what}: where a trimmed bar hangs, nothing of the frame is left to see or press`);
  if (now.bar !== null) assert.ok(now.picture.bottom <= now.bar.top + 1 && near(now.bar.bottom, now.screen.h, 2), `${what}: the site's keys are along the foot, under the picture`);
  return `${Math.round(now.picture.width)}x${Math.round(now.picture.height)} on ${now.screen.w}x${now.screen.h}, ${chosen} round it`;
}

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
/** One of the room's keys by what it is read as: under the picture, or on the music bar while the bar shows the room. */
const roomKey = (page, label) => page.locator(`${ROOM} [data-watch-bar] button[aria-label="${label}"], [data-stream-bar] button[aria-label="${label}"]`).first();
const floorOf = (page) =>
  page.evaluate(() => {
    const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
    return window.innerHeight - (Number.isFinite(reach) ? reach : 0) - 4;
  });

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(HOOK);
  await context.addInitScript(SEED);
  if (BACKDROP !== null) await context.addInitScript(`try { localStorage.setItem('debaser.site.backdrop.v2', ${JSON.stringify(BACKDROP)}); } catch (error) {}`);
  // YouTube says its video is 4:3, whatever it is: the frame must take the shape it is told (part 3).
  const pictures = await makeTestPictures(context);
  assert.ok(pictures.clip.length > 20000, `the letterboxed test clip was made (${pictures.clip.length} bytes)`);
  await context.route(LETTERBOX, (route) => route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'access-control-allow-origin': '*' }, body: pictures.clip }));
  await context.route(/^https:\/\/i\.ytimg\.com\/vi\/[^/]+\/mq[123]\.jpg$/, (route) => {
    const which = Number(/mq([123])\.jpg$/.exec(route.request().url())[1]) - 1;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: pictures.stills[which] });
  });
  await context.route('https://www.youtube.com/oembed**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'video', title: 'A video said to be 4:3', width: 200, height: 150 }) }),
  );
  writeTones();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const withVideo = !flag('--no-video');

  try {
    // Rewritten on purpose 2026-11-16 (list 3, ROOMS item 4): since SPEC-rooms-perpetual.md your room IS the live room's
    // window (the old look-alike, OwnRoomWindow.tsx, is unused), so every step below runs in that window: its own players,
    // its keys (under the picture, or on the music bar while the bar shows the room), its FULL with the background round
    // the picture and [ BKG ] in the corner. What the old frame was checked for is checked here on the room itself.
    console.log('YOUR ROOM IS THE LIVE ROOM\'S WINDOW (a song on)');
    await open(page, '/forum');
    await page.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await pressUntil(page, false);
    await songMenu(page, 'ADD TO QUEUE');
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 1, null, { timeout: 10000 });
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    assert.equal(await page.locator(ROOM).count(), 0, 'playing a song opens no window by itself (Luke, Q6 A)');
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector(`[data-main-room-live="private"]`, { timeout: 20000 });
    assert.match(await titleOf(page), /'S ROOM$/, 'the window is your room, by your name');
    assert.notEqual(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'it opens as a window, not folded');
    assert.equal(await page.locator('[data-own-room-window]').count(), 0, 'not the old look-alike window');
    const frame = await page.evaluate(() => {
      const box = (sel) => {
        const element = document.querySelector(sel);
        if (element === null) return null;
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return {
        picture: box('[data-dock-window="stream"] [data-room-picture]'),
        queueKey: box('[data-dock-window="stream"] [data-watch-queue-key]'),
        cog: box('[data-dock-window="stream"] [data-room-settings-key]'),
        chat: box('#watch-chat'),
        cover: document.querySelector('[data-dock-window="stream"] [data-room-picture] [data-cover-card]') !== null,
        badge: document.querySelector('[data-dock-window="stream"] .title-line').innerText,
      };
    });
    assert.ok(frame.cover, 'a song on: the screen is its cover card');
    assert.ok(frame.queueKey.left >= frame.picture.right - 1, 'the side column is beside the picture');
    assert.ok(near(frame.queueKey.top, frame.cog.top, 6) && frame.cog.left > frame.queueKey.right, '[ QUEUE ] and the cog head the side column, on one line');
    assert.ok(frame.chat !== null && frame.chat.top > frame.queueKey.bottom, 'the chat is in the column (with nobody else in, it says so)');
    assert.ok(frame.badge.includes('PRIVATE'), 'and it says PRIVATE');
    pass('YOUR ROOM: the live room\'s own window, the cover card on its screen, [ QUEUE ] and the cog heading the column, chat, PRIVATE');
    await page.screenshot({ path: join(SHOTS, 'your-room-song.png') });

    // The room steers the bar's one audio element as it steers a video: its PLAY key pauses and plays the song.
    await roomKey(page, 'Pause').click();
    await page.waitForFunction(() => window.__audios[window.__audios.length - 1].paused, null, { timeout: 5000 });
    await roomKey(page, 'Play').click();
    await page.waitForFunction(() => !window.__audios[window.__audios.length - 1].paused, null, { timeout: 5000 });
    pass('the room\'s PLAY key pauses and plays the bar\'s song');

    await page.locator(`${ROOM} [data-watch-queue-key]`).click();
    await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
    assert.ok(await page.locator('[data-queue-state="queued"]').count(), 'the queue window shows what waits');
    pass('[ QUEUE ] opens the room\'s queue as its own window');
    let videoQueued = false;
    if (withVideo) {
      await page.fill('#stream-queue-search', VIDEO);
      await page.keyboard.press('Enter');
      videoQueued = await page.waitForFunction(() => document.querySelectorAll('[data-queue-state="queued"]').length >= 2, null, { timeout: 30000 }).then(() => true, () => false);
      if (!videoQueued) note('the test video could not be queued (no network to its host?): every step that needs a video was skipped');
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });

    if (videoQueued) {
      console.log('A VIDEO ON YOUR SCREEN: the room\'s own player');
      // The queued song first, then the video: two presses of next.
      await roomKey(page, 'Skip to the next video').click();
      await sleep(1500);
      await roomKey(page, 'Skip to the next video').click();
      await page.waitForFunction(() => {
        const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
        return video !== null && /flower\.webm/.test(video.currentSrc || video.src) && video.currentTime > 0.3;
      }, null, { timeout: 30000 });
      await page.evaluate(() => {
        const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
        video.loop = true;
        window.__roomVideo = video;
      });
      assert.equal(await page.locator('[data-floating-player] video').count(), 0, 'nothing floats: the room has its own player');
      assert.ok(await page.evaluate(() => window.__audios[window.__audios.length - 1].paused), 'the song gave way to the video');
      await roomKey(page, 'Pause').click();
      await page.waitForFunction(() => window.__roomVideo.paused, null, { timeout: 5000 });
      await setRange(page, '[data-watch-bar] input[aria-label="Seek"], [data-stream-bar] input[aria-label="Seek"]', 3);
      await page.waitForFunction(() => Math.abs(window.__roomVideo.currentTime - 3) < 0.6, null, { timeout: 5000 });
      await roomKey(page, 'Play').click();
      await page.waitForFunction(() => !window.__roomVideo.paused, null, { timeout: 5000 });
      pass('next put the video on the room\'s own screen; PLAY, pause and seek reach it; nothing floats');
      await page.screenshot({ path: join(SHOTS, 'your-room-video.png') });

      console.log('FULL IN YOUR ROOM: the picture its own shape, the chosen background round it, [ BKG ] in the corner');
      const chosen = await page.getAttribute('html', 'data-backdrop');
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.querySelector('.stage-surround') !== null, null, { timeout: 8000 });
      await sleep(2500);
      const fileShape = await page.evaluate(() => window.__roomVideo.videoWidth / window.__roomVideo.videoHeight);
      const fileNow = await stagedNow(page, 'video');
      const fileFull = assertStaged(fileNow, fileShape, chosen, 'your room, our own file');
      assert.ok(fileNow.surround.bottom < fileNow.box.bottom - 10, 'the room\'s keys are along the foot of the screen, under the surround');
      assert.ok(await page.evaluate(() => document.fullscreenElement.querySelector('video') === window.__roomVideo && !window.__roomVideo.paused), 'the same player, still playing: nothing reloaded');
      await page.screenshot({ path: join(SHOTS, `full-your-room-${chosen}.png`) });
      pass(`FULL in your room: ${fileFull}; the room's keys under it`);

      // [ BKG ] off: the video as it is, no background. On again: the background round it, as before. Remembered either way.
      await page.locator('[data-stage-bkg]').click();
      await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') === 'off', null, { timeout: 8000 });
      await sleep(600);
      const plain = await page.evaluate(() => {
        const box = document.fullscreenElement;
        return {
          stages: box.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length,
          kept: window.localStorage.getItem('debaser.site.stage-bkg.v1'),
          same: box.querySelector('video') === window.__roomVideo && !window.__roomVideo.paused,
          full: document.fullscreenElement !== null,
        };
      });
      assert.deepEqual(plain, { stages: 0, kept: 'off', same: true, full: true }, '[ BKG ] off: still fullscreen, no background, remembered, the same player playing');
      await page.screenshot({ path: join(SHOTS, `full-your-room-bkg-off-${chosen}.png`) });
      await page.locator('[data-stage-bkg]').click();
      await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') === 'on', null, { timeout: 8000 });
      await sleep(1500);
      assertStaged(await stagedNow(page, 'video'), fileShape, chosen, 'your room, [ BKG ] on again');
      assert.equal(await page.evaluate(() => window.localStorage.getItem('debaser.site.stage-bkg.v1')), 'on', 'and that is remembered');
      pass('[ BKG ] in the corner of your room\'s fullscreen: off is the plain video, on is the background round it; the player never reloads');
      await page.getByRole('button', { name: 'Leave fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.stage-surround') === null, null, { timeout: 8000 });
      await sleep(600);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length), 0, 'out of fullscreen, the copy of the background is gone');
      assert.ok(await page.evaluate(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] video') === window.__roomVideo), 'and the room has the same player');
      pass('out of fullscreen: back in the window, the background gone, the same player');

      console.log('BARS IN A FILE THE ROOM PLAYS: read from its picture as it plays, trimmed in fullscreen');
      await page.locator(`${ROOM} [data-watch-queue-key]`).click();
      await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
      const queuedBefore = await page.locator('[data-queue-state="queued"]').count();
      await page.fill('#stream-queue-search', LETTERBOX);
      await page.keyboard.press('Enter');
      const boxedQueued = await page.waitForFunction((was) => document.querySelectorAll('[data-queue-state="queued"]').length === was + 1, queuedBefore, { timeout: 30000 }).then(() => true, () => false);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });
      assert.ok(boxedQueued, 'the letterboxed test clip was queued');
      await roomKey(page, 'Skip to the next video').click();
      await page.waitForFunction(() => {
        const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
        return video !== null && (video.currentSrc || video.src).includes('letterbox.webm') && video.videoWidth > 0;
      }, null, { timeout: 20000 });
      await page.evaluate(() => {
        const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
        video.loop = true;
        window.__roomVideo = video;
        void video.play();
      });
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.querySelector('.stage-surround') !== null, null, { timeout: 8000 });
      await page.waitForFunction(() => document.fullscreenElement?.querySelector('video')?.hasAttribute('data-stage-trim') === true, null, { timeout: 20000 });
      await sleep(2500);
      const roomCut = await page.evaluate(() => Number(document.fullscreenElement.querySelector('video').getAttribute('data-stage-trim').split(' ')[1]));
      assert.ok(Math.abs(roomCut - CLIP_BARS) < 0.02, `the bars it found are the bars it has (${(roomCut * 100).toFixed(1)}% above and below; they are ${(CLIP_BARS * 100).toFixed(1)}%)`);
      const roomShape = await page.evaluate(() => window.__roomVideo.videoWidth / window.__roomVideo.videoHeight);
      const boxedFull = assertStaged(await stagedNow(page, 'video'), roomShape / (1 - 2 * roomCut), chosen, 'your room, a letterboxed file');
      await page.screenshot({ path: join(SHOTS, `full-your-room-letterbox-${chosen}.png`) });
      await page.getByRole('button', { name: 'Leave fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.stage-surround') === null, null, { timeout: 8000 });
      await sleep(600);
      pass(`bars in a file in your room: found from its picture as it plays and trimmed in fullscreen (${boxedFull})`);
    }

    console.log('THE ROOM WINDOW LIFTS OFF THE MUSIC BAR');
    const floor = await floorOf(page);
    // List 4 (Luke, 2026-11-16: "start the your room more smaller"): it opens clear of the bar, and is dragged onto it here.
    const opened = await rectOf(page, ROOM);
    assert.ok(opened.bottom < floor - 10, `opened smaller, its foot clear of the music bar (${opened.bottom} vs ${floor})`);
    const start = await titlePoint(page);
    await dragBy(page, start.x, start.y, 0, 700);
    const rested = await rectOf(page, ROOM);
    assert.ok(near(rested.bottom, floor, 3) && near(rested.height, opened.height), `dragged down, its foot rests on the music bar, not squashed (${rested.bottom} vs ${floor})`);
    // List 4: the window fits its picture by itself (room-fit.ts), so it can be little taller than its least height; made
    // taller by its top edge first, so the foot has room to come up by the pull below.
    await dragBy(page, rested.left + rested.width / 2, rested.top, 0, -260);
    const filled = await rectOf(page, ROOM);
    assert.ok(near(filled.bottom, floor, 3) && filled.height > rested.height + 200, `made taller by its top edge, its foot still on the bar (${Math.round(rested.height)} -> ${Math.round(filled.height)})`);
    await dragBy(page, filled.left + filled.width / 2, filled.bottom - 1, 0, -200);
    const short = await rectOf(page, ROOM);
    assert.ok(near(short.bottom, filled.bottom - 200, 3) && near(short.top, filled.top), `the foot came up by the pull (${filled.bottom} -> ${short.bottom})`);
    let grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, 80);
    const down = await rectOf(page, ROOM);
    assert.ok(near(down.top, short.top + 80) && near(down.height, short.height), `dragged down, it moves as one piece (top ${short.top} -> ${down.top})`);
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, -60);
    const up = await rectOf(page, ROOM);
    assert.ok(near(up.top, down.top - 60) && near(up.height, down.height), `dragged up, the whole window lifts (top ${down.top} -> ${up.top})`);
    assert.ok(up.bottom < floor - 100, `and its foot is well clear of the bar (${Math.round(floor - up.bottom)}px above it)`);
    await sleep(1500);
    const stayed = await rectOf(page, ROOM);
    assert.ok(near(stayed.top, up.top, 0.5) && near(stayed.bottom, up.bottom, 0.5), 'it stays where it is put');
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, 0, 700);
    const onBar = await rectOf(page, ROOM);
    assert.ok(near(onBar.bottom, floor, 3) && near(onBar.height, up.height), `dragged far down, its foot stops at the bar and it is not squashed (foot ${onBar.bottom}, floor ${floor})`);
    grab = await titlePoint(page);
    await dragBy(page, grab.x, grab.y, -10, -90);
    const lifted = await rectOf(page, ROOM);
    assert.ok(near(lifted.top, onBar.top - 90) && near(lifted.left, onBar.left - 10) && near(lifted.height, onBar.height), `off the bar again, in one piece (top ${onBar.top} -> ${lifted.top})`);
    if (videoQueued) assert.ok(await page.evaluate(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] video') === window.__roomVideo), 'the video went with the window, the same element still');
    pass('the room window: resized by its foot, dragged down and up as one piece, off the bar and staying there, never under the bar');

    console.log('[ _ ] FOLDS YOUR ROOM TO ITS KEY ABOVE THE PLAYER; IT PLAYS ON');
    await page.locator(`${ROOM} button[aria-label^="Fold "]`).click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
    assert.equal(await page.locator('[data-room-picture="floating"]').count(), 0, 'nothing floats');
    if (videoQueued) {
      const at = await page.evaluate(() => window.__roomVideo.currentTime);
      await sleep(1200);
      assert.ok(await page.evaluate((was) => window.__roomVideo.currentTime !== was && !window.__roomVideo.paused, at), 'the video plays on out of sight');
    }
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
    const back = await rectOf(page, ROOM);
    assert.ok(near(back.top, lifted.top) && near(back.left, lifted.left) && near(back.height, lifted.height), 'the key brings the window back where it was');
    if (videoQueued) assert.ok(await page.evaluate(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] video') === window.__roomVideo), 'never reloaded');
    pass('[ _ ] folds your room to its key above the player, playing on; the key brings it back where it was');

    console.log('GO LIVE: THE SAME ROOM, IN THE SAME WINDOW, WHERE IT STANDS');
    const before = await page.evaluate(() => {
      const box = (sel) => {
        const { left, top, right, bottom, width, height } = document.querySelector(sel).getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return { window: box('[data-dock-window="stream"]'), picture: box('[data-dock-window="stream"] [data-room-picture]'), queueKey: box('[data-dock-window="stream"] [data-watch-queue-key]') };
    });
    await page.locator('[data-main-room-live="private"]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 10000 });
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
    await sleep(1200);
    const after = await page.evaluate(() => {
      const box = (sel) => {
        const element = document.querySelector(sel);
        if (element === null) return null;
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return {
        window: box('[data-dock-window="stream"]'),
        picture: box('[data-dock-window="stream"] [data-room-picture]'),
        queueKey: box('[data-dock-window="stream"] [data-watch-queue-key]'),
        badge: document.querySelector('[data-dock-window="stream"] .title-line').innerText,
        same: window.__roomVideo === undefined || document.querySelector('[data-dock-window="stream"] [data-room-picture] video') === window.__roomVideo,
      };
    });
    assert.ok(after.badge.includes('LIVE'), 'it says LIVE');
    assert.ok(after.same, 'the same player: nothing restarted');
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(after.window[side], before.window[side]), `the window did not move (${side}: ${before.window[side]} -> ${after.window[side]})`);
    for (const side of ['left', 'top', 'width']) assert.ok(near(after.picture[side], before.picture[side]), `the picture is where it was (${side})`);
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(after.queueKey[side], before.queueKey[side]), `[ QUEUE ] is where it was (${side})`);
    pass('GO LIVE: the same room in the same window, in the same place, the same player; it says LIVE');
    await page.screenshot({ path: join(SHOTS, 'your-room-went-live.png') });

    console.log('LIVE, FOLDED: ROOM :: LIVE ABOVE THE PLAYER');
    await page.locator(`${ROOM} button[aria-label^="Fold "]`).click();
    await page.waitForSelector('[data-room-shelf-key="live"]', { timeout: 10000 });
    assert.equal(await page.locator('[data-room-picture="floating"]').count(), 0, 'nothing floats');
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
    const home = await rectOf(page, ROOM);
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(home[side], after.window[side]), `where it was (${side})`);
    pass('live and folded: ROOM :: LIVE above the player, nothing floats; the key brings the window back where it was');

    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    pass('END ROOM, to leave the mock store tidy');

    if (withVideo) {
      console.log('A YOUTUBE VIDEO IN YOUR ROOM: the room\'s own YouTube player, FULL and [ BKG ]');
      // The mock MEDIA page has one row over a real YouTube video. PLAY opens it in your room (SPEC-rooms-perpetual.md),
      // in the room's own YouTube player: the keys reach it by the messages its own script sends.
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
        await page.locator('li').filter({ hasText: 'YOUTUBE · VIDEO' }).first().locator('button[aria-label^="Play "]').first().evaluate((key) => key.click());
        await page.waitForSelector(`[data-main-room-live]`, { timeout: 30000 });
        const framed = await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] iframe') !== null, null, { timeout: 30000 }).then(() => true, () => false);
        assert.equal(await page.locator('[data-floating-player] iframe').count(), 0, 'nothing floats: the room has its own player');
        if (!framed) note('YouTube\'s player did not load in the room (no network to it?): its keys were not driven');
        else {
          // The room's own YouTube player is made by YouTube's script with its keys off (`controls=0`) and no fullscreen key
          // (`fs=0`): the room's FULL is the only way to fullscreen (Luke, 2026-11-16, "Switch it off").
          const src = await page.evaluate(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] iframe').src);
          assert.ok(/[?&]controls=0/.test(src) && /[?&]fs=0/.test(src), `YouTube's player in the room draws no keys and no fullscreen key of its own (${src.slice(0, 120)})`);
          pass('a YouTube row\'s PLAY opened your room with the room\'s own YouTube player: no keys of YouTube\'s, no fullscreen key of its own');
          const spoke = await page.waitForFunction(() => window.__said.some((info) => info.playerState === 1), null, { timeout: 60000 }).then(() => true, () => false);
          if (!spoke) note('YouTube\'s player did not play here (no network to it, or it asked for a press): FULL on it was not driven');
          else {
            await page.evaluate(() => {
              window.__frame = document.querySelector('[data-dock-window="stream"] [data-room-picture] iframe');
            });
            const chosen = await page.getAttribute('html', 'data-backdrop');
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
            await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.querySelector('.stage-surround') !== null, null, { timeout: 8000 });
            // The picture is the room's embed box (YouTube's frame is laid out inside it, a little larger, to hide its chrome).
            // Its three stills (answered here) have bars all round: found, the box is the stills' 16:9 less those bars.
            const trimmed = await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-watch-embed]')?.hasAttribute('data-stage-trim') === true, null, { timeout: 20000 }).then(() => true, () => false);
            await sleep(2500);
            const tubeNow = await stagedNow(page, '[data-watch-embed]');
            if (trimmed) {
              const cut = await page.evaluate(() => document.fullscreenElement.querySelector('[data-watch-embed]').getAttribute('data-stage-trim').split(' ').map(Number));
              assert.ok(Math.abs(cut[0] - STILL_BARS.x) < 0.01 && Math.abs(cut[1] - STILL_BARS.y) < 0.01, `the bars in YouTube's stills were found (${cut.map((part) => (part * 100).toFixed(1) + '%').join(' a side, ')})`);
              const tubeShape = ((16 / 9) * (1 - 2 * cut[0])) / (1 - 2 * cut[1]);
              pass(`FULL on YouTube in your room: ${assertStaged(tubeNow, tubeShape, chosen, 'your room, YouTube with bars in its stills')}; the bars in its stills trimmed off`);
            } else {
              note('YouTube\'s stills were not read in the room (its oEmbed shape is used instead): the trim was not proved here');
              pass(`FULL on YouTube in your room: ${assertStaged(tubeNow, 4 / 3, chosen, 'your room, YouTube (4:3 by its oEmbed answer)')}`);
            }
            await page.screenshot({ path: join(SHOTS, `full-your-room-youtube-${chosen}.png`) });
            await page.locator('[data-stage-bkg]').click();
            await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') === 'off', null, { timeout: 8000 });
            await sleep(600);
            const plainTube = await page.evaluate(() => {
              const box = document.fullscreenElement;
              return { stages: box.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length, same: box.querySelector('iframe') === window.__frame };
            });
            assert.deepEqual(plainTube, { stages: 0, same: true }, '[ BKG ] off on YouTube: no background, the same frame');
            await page.locator('[data-stage-bkg]').click();
            await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') === 'on', null, { timeout: 8000 });
            await sleep(1200);
            assert.ok(await page.evaluate(() => document.fullscreenElement.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length === 1 && document.fullscreenElement.querySelector('iframe') === window.__frame), '[ BKG ] on again: the background is back, the same frame');
            pass('[ BKG ] on YouTube in your room: off is the plain video, on is the background round it; the frame never reloads');
            await page.getByRole('button', { name: 'Leave fullscreen', exact: true }).first().click();
            await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
          }
        }
        await page.locator('[data-main-room-end="first"]').first().click().catch(() => undefined);
        await page.locator('[data-main-room-end="confirm"]').first().click().catch(() => undefined);
      }
    }

    console.log('PHONE WIDTH: nothing scrolls sideways with your room open');
    // A song started at desktop width (the bar's keys are laid out for it), then the page narrowed.
    await open(page, '/forum');
    await pressUntil(page, false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 15000 });
    // Pressed in the page: a first-visit sheet (PRIVACY) lies over the door at this width.
    await page.evaluate(() => document.querySelector('[data-own-room-door] button').click());
    await page.waitForSelector(`[data-main-room-live]`, { timeout: 20000 });
    await sleep(800);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(sideways <= 1, `no sideways scroll at 390 (${sideways}px over)`);
    const stacked = await page.evaluate(() => {
      const picture = document.querySelector('[data-dock-window="stream"] [data-room-picture]').getBoundingClientRect();
      const queue = document.querySelector('[data-dock-window="stream"] [data-watch-queue-key]').getBoundingClientRect();
      return queue.top >= picture.bottom - 1;
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
