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
    // Updated on purpose 2026-11-16 (Luke's ROOMFIX list, item 7): [ _ ] folds to a key above the player and floats nothing,
    // so a song on has it too (scripts/drive-roomfix.cjs drives it).
    assert.equal(await page.locator(`${ROOM} button[aria-label^="Fold "]`).count(), 1, 'a song on: YOUR ROOM can be folded away');
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

      console.log('FULL: the box goes fullscreen, the picture its own shape, the chosen background round it');
      const chosen = await page.getAttribute('html', 'data-backdrop');
      await page.locator('[data-own-room-full]').click();
      await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.getAttribute('data-floating-stage') === 'full', null, { timeout: 8000 });
      await sleep(2500);
      const fileShape = await page.evaluate(() => window.__sameVideo.videoWidth / window.__sameVideo.videoHeight);
      const fileFull = assertStaged(await stagedNow(page, 'video'), fileShape, chosen, 'your room, our own file');
      assert.ok(await page.evaluate(() => document.fullscreenElement.querySelector('video') === window.__sameVideo && !window.__sameVideo.paused), 'the same player, still playing: nothing reloaded');
      await page.screenshot({ path: join(SHOTS, `full-file-${chosen}.png`) });
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('[data-floating-stage]').getAttribute('data-floating-stage') === 'in-place', null, { timeout: 8000 });
      await sleep(600);
      const back = await page.evaluate(() => {
        const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
        const box = document.querySelector('[data-own-room-screen] [data-player-box]').getBoundingClientRect();
        const video = document.querySelector('[data-floating-player] video').getBoundingClientRect();
        return {
          over: Math.abs(layer.left - box.left) < 3 && Math.abs(layer.top - box.top) < 3 && Math.abs(layer.width - box.width) < 3,
          fills: Math.abs(video.width - layer.width) < 3 && Math.abs(video.height - layer.height) < 3,
          stages: document.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length,
          same: document.querySelector('[data-floating-player] video') === window.__sameVideo && !window.__sameVideo.paused,
        };
      });
      assert.ok(back.over && back.fills, 'out of fullscreen, the video is over its box again and fills it');
      assert.equal(back.stages, 0, 'and the copy of the background that was round it is gone');
      assert.ok(back.same, 'the same player, still playing');
      pass(`FULL on your room's own file: ${fileFull}; back as it was, never reloaded`);

      // A double press on our own file is the same key: the box, never the browser's own fullscreen of the bare video (black bars).
      const fileAt = await page.evaluate(() => {
        const at = window.__sameVideo.getBoundingClientRect();
        return { x: at.left + at.width / 2, y: at.top + at.height / 3 };
      });
      await page.mouse.dblclick(fileAt.x, fileAt.y, { delay: 30 });
      await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
      await sleep(800);
      assert.equal(await page.evaluate(() => document.fullscreenElement.getAttribute('data-floating-stage')), 'full', 'a double press on our own file puts its box in fullscreen, not the bare video');
      // On the surround (the strip above the picture), a double press is the way out.
      const strip = await page.evaluate(() => document.fullscreenElement.querySelector('video').getBoundingClientRect().top);
      assert.ok(strip > 20, `there is a strip of background above the picture to press (${Math.round(strip)} pixels)`);
      await page.mouse.dblclick(700, strip / 2, { delay: 30 });
      await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
      await sleep(600);
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo), 'the same player still');
      pass('a double press on our own file: its box in fullscreen with the background; a double press on the surround comes back');

      console.log('BARS IN A FILE THE SITE PLAYS ITSELF: read from its picture as it plays, trimmed in fullscreen');
      const waitingWas = await barQueue(page);
      await page.locator('[data-own-room-queue-key]').click();
      await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
      await page.fill('#stream-queue-search', LETTERBOX);
      await page.keyboard.press('Enter');
      const boxedQueued = await page.waitForFunction((was) => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === was + 1, waitingWas, { timeout: 30000 }).then(() => true, () => false);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });
      assert.ok(boxedQueued, 'the letterboxed test clip was queued');
      await page.locator('[data-own-room-next]').click();
      await page.waitForFunction(() => {
        const video = document.querySelector('[data-floating-player] video');
        return video !== null && video.currentSrc.includes('letterbox.webm') && video.videoWidth > 0;
      }, null, { timeout: 20000 });
      await page.evaluate(() => {
        const video = document.querySelector('[data-floating-player] video');
        video.loop = true;
        window.__sameVideo = video;
        void video.play();
      });
      assert.equal(await page.evaluate(() => window.__sameVideo.crossOrigin), 'anonymous', 'a file from a host that allows it is asked for the way its picture may be read');
      // Two looks at the picture, at least a second of video apart, before anything is trimmed.
      await sleep(6500);
      await page.locator('[data-own-room-full]').click();
      await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.getAttribute('data-floating-stage') === 'full', null, { timeout: 8000 });
      await page.waitForFunction(() => /inset/.test(window.getComputedStyle(window.__sameVideo).objectViewBox ?? ''), null, { timeout: 15000 });
      await sleep(1500);
      const boxedNow = await stagedNow(page, 'video');
      const cut = Number(/inset\(([\d.]+)%/.exec(boxedNow.view)[1]) / 100;
      assert.ok(Math.abs(cut - CLIP_BARS) < 0.02, `the bars it found are the bars it has (${(cut * 100).toFixed(1)}% above and below; they are ${(CLIP_BARS * 100).toFixed(1)}%)`);
      const boxedFull = assertStaged(boxedNow, 16 / 9 / (1 - 2 * cut), chosen, 'your room, a letterboxed file');
      assert.equal(boxedNow.bar, null, "our own file keeps the browser's controls: no second bar of keys");
      assert.ok(await page.evaluate(() => document.fullscreenElement.querySelector('video') === window.__sameVideo && !window.__sameVideo.paused), 'the same player, still playing');
      await page.screenshot({ path: join(SHOTS, `full-letterbox-${chosen}.png`) });
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('[data-floating-stage]').getAttribute('data-floating-stage') === 'in-place', null, { timeout: 8000 });
      await sleep(600);
      assert.ok(await page.evaluate(() => !/inset/.test(window.getComputedStyle(window.__sameVideo).objectViewBox ?? '') && document.querySelector('[data-stage-bkg]') === null), 'out of fullscreen the picture is whole again, and the key is gone');
      pass(`bars in our own file: found from its picture as it plays and trimmed in fullscreen (${boxedFull}); whole again outside`);
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
      // Updated on purpose 2026-11-16 (Luke's ROOMFIX list, items 7 and 8): [ _ ] folds the window to [ ▲ ROOM ] above the
      // player and the video plays on out of sight; [ PIP ] floats it; the floating picture has no BACK; the key brings it back.
      console.log('[ _ ] FOLDS TO [ ▲ ROOM ]; [ PIP ] FLOATS THE VIDEO; THE KEY ABOVE THE PLAYER IS THE WAY BACK');
      await page.locator(`${ROOM} button[aria-label="Fold YOUR ROOM away"]`).click();
      await page.waitForSelector('[data-own-room-door="folded"]', { timeout: 10000 });
      assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the window is tucked away');
      assert.equal(await page.locator('[data-floating-player]').getAttribute('data-floating-tucked'), 'true', 'the video does not float: it plays on out of sight');
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo && !window.__sameVideo.paused), 'the same video, still playing');
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true' && document.querySelector('[data-floating-player]')?.getAttribute('data-floating-tucked') === 'false', null, { timeout: 10000 });
      await page.locator('[data-own-room-pip]').click();
      await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'floating', null, { timeout: 10000 });
      assert.equal(await page.locator('[data-floating-player]').getByRole('button', { name: /^Back to where/ }).count(), 0, 'the floating picture has no BACK');
      const grips = await page.evaluate(() => [...document.querySelectorAll('[data-floating-player] [data-float-grip]')].map((grip) => Math.round(grip.getBoundingClientRect().width) + 'x' + Math.round(grip.getBoundingClientRect().height)));
      assert.equal(grips.length, 8, 'the floating picture has its eight grips');
      assert.equal(grips.filter((size) => size === '20x20').length, 4, `its four corner grips are 20px squares, where a window's are 12px (${grips.join(' ')})`);
      await page.screenshot({ path: join(SHOTS, 'your-room-pip.png') });
      await page.locator('[data-own-room-door="folded"] button').click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true' && document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'in-box', null, { timeout: 10000 });
      const back = await rectOf(page, ROOM);
      assert.ok(near(back.top, lifted.top) && near(back.left, lifted.left) && near(back.height, lifted.height), '[ ▲ ROOM ] brings the window back where it was');
      assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] video') === window.__sameVideo), 'never reloaded');
      pass('[ _ ] folds the window to [ ▲ ROOM ], the video out of sight; [ PIP ] floats it with no BACK; the key brings both back');
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

    if (videoQueued) {
      console.log('THE LIVE ROOM, FULL: the picture and its bar fill the screen, the background round the picture');
      const chosen = await page.getAttribute('html', 'data-backdrop');
      await page.waitForFunction(() => (document.querySelector('[data-room-picture] video')?.videoWidth ?? 0) > 0, null, { timeout: 20000 });
      await page.evaluate(() => {
        window.__roomVideo = document.querySelector('[data-room-picture] video');
      });
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.querySelector('.stage-surround') !== null, null, { timeout: 8000 });
      // The room's own player reads its picture too: the clip it carried over is letterboxed, and two looks agree within seconds.
      await page.waitForFunction(() => document.fullscreenElement?.querySelector('video')?.hasAttribute('data-stage-trim') === true, null, { timeout: 20000 });
      await sleep(2500);
      const roomCut = await page.evaluate(() => Number(document.fullscreenElement.querySelector('video').getAttribute('data-stage-trim').split(' ')[1]));
      assert.ok(Math.abs(roomCut - CLIP_BARS) < 0.02, `the live room found the clip's bars (${(roomCut * 100).toFixed(1)}% above and below)`);
      const roomShape = await page.evaluate(() => window.__roomVideo.videoWidth / window.__roomVideo.videoHeight);
      const roomNow = await stagedNow(page, 'video');
      const roomFull = assertStaged(roomNow, roomShape / (1 - 2 * roomCut), chosen, 'the live room');
      assert.ok(roomNow.surround.bottom < roomNow.box.bottom - 10, `the bar of keys is along the foot of the screen, under the surround (${Math.round(roomNow.surround.bottom)} of ${Math.round(roomNow.box.bottom)})`);
      assert.ok(await page.evaluate(() => document.fullscreenElement.querySelector('video') === window.__roomVideo), 'the same player: nothing reloaded');
      await page.screenshot({ path: join(SHOTS, `full-room-${chosen}.png`) });
      await page.getByRole('button', { name: 'Leave fullscreen', exact: true }).first().click();
      await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector('.stage-surround') === null, null, { timeout: 8000 });
      await sleep(600);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length), 0, 'out of fullscreen, the copy of the background is gone');
      assert.ok(await page.evaluate(() => document.querySelector('[data-room-picture] video') === window.__roomVideo), 'and the room has the same player');
      pass(`FULL in the live room: ${roomFull}, the bar under it; back as it was`);
    }

    // Updated on purpose 2026-11-16 (Luke's ROOMFIX list, item 7): [ _ ] folds the live room to ROOM :: LIVE above the player
    // and floats nothing. A file of our own in a live room floats only by the browser's own picture-in-picture, so the room's
    // floating picture (dragged by the picture, its grips, no keys) is driven with YouTube in scripts/drive-floating-player.cjs
    // and scripts/drive-roomfix.cjs; what follows the fold here is kept for a room whose picture does float.
    console.log('THE LIVE ROOM: [ _ ] FOLDS IT TO ROOM :: LIVE ABOVE THE PLAYER');
    await page.locator(`${ROOM} button[aria-label^="Fold "]`).click();
    await page.waitForSelector('[data-room-shelf-key="live"]', { timeout: 10000 });
    assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true');
    assert.equal(await page.locator('[data-room-picture="floating"]').count(), 0, 'nothing floats');
    assert.equal(await page.locator('[data-own-room-door]').count(), 0);
    pass('the live room folded: ROOM :: LIVE above the player, nothing floats');
    if (await page.locator('[data-room-picture="floating"]').count()) {
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
    pass('the live room\'s floating picture drags by the picture and by its title line, resizes by a bigger corner grip');
    }
    await page.screenshot({ path: join(SHOTS, 'live-room-folded.png') });
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForSelector('[data-room-picture="in-room"]', { timeout: 10000 });
    assert.notEqual(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'the key brings the room\'s window back');
    const home = await rectOf(page, ROOM);
    for (const side of ['left', 'top', 'width', 'height']) assert.ok(near(home[side], after.window[side]), `where it was (${side})`);
    pass('ROOM :: LIVE above the player brings the room\'s window back where it was');

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
        // YouTube's own fullscreen key is switched off (Luke, 2026-11-16): the browser is told the frame may not go fullscreen
        // by itself, so `[ FULL ]` and a double press are the way, and those show the background (part 3).
        const may = await page.evaluate(() => {
          const frame = document.querySelector('[data-floating-player] iframe');
          return { allow: frame.getAttribute('allow') ?? '', attribute: frame.hasAttribute('allowfullscreen'), policy: typeof frame.featurePolicy?.allowsFeature === 'function' ? frame.featurePolicy.allowsFeature('fullscreen') : null };
        });
        assert.ok(!/fullscreen/i.test(may.allow) && !may.attribute, `YouTube's frame is not allowed its own fullscreen (allow="${may.allow}")`);
        if (may.policy !== null) assert.equal(may.policy, false, 'and the browser agrees: fullscreen is not permitted from inside the frame');
        pass(`YouTube's own fullscreen key is off: its frame has no permission for it (allow="${may.allow}")`);
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

          const chosen = await page.getAttribute('html', 'data-backdrop');
          await page.locator('[data-own-room-full]').click();
          await page.waitForFunction(() => document.fullscreenElement !== null && document.fullscreenElement.getAttribute('data-floating-stage') === 'full', null, { timeout: 8000 });
          // Its three stills (answered here) have bars all round: the frame is 16:9, as the stills are, with those bars hung outside.
          await page.waitForFunction(() => document.fullscreenElement?.querySelector('iframe')?.hasAttribute('data-backdrop-inset') === true, null, { timeout: 15000 });
          await sleep(2500);
          const tubeNow = await stagedNow(page, 'iframe');
          assert.ok(Math.abs(tubeNow.cut[0] - STILL_BARS.x) < 0.01 && Math.abs(tubeNow.cut[1] - STILL_BARS.y) < 0.01, `the bars in YouTube's stills were found (${tubeNow.cut.map((part) => (part * 100).toFixed(1) + '%').join(' a side, ')} above and below)`);
          assert.ok(Math.abs(tubeNow.whole.width / tubeNow.whole.height - 16 / 9) < 0.02, "YouTube's frame itself stays 16:9, so its player draws the picture as it always does");
          const tubeShape = ((16 / 9) * (1 - 2 * tubeNow.cut[0])) / (1 - 2 * tubeNow.cut[1]);
          const tubeFull = assertStaged(tubeNow, tubeShape, chosen, 'your room, YouTube with bars in its stills');
          assert.ok(tubeNow.barsGone === true, 'and its bars are outside what shows');
          assert.ok(tubeNow.bar !== null, "the site's own keys are along the foot: YouTube's are cut off with its bars");
          await page.screenshot({ path: join(SHOTS, `full-youtube-${chosen}.png`) });

          // The site's keys in fullscreen drive YouTube's player, and show what it says back. YouTube is still catching up
          // from the seek above some of the time (it did once here, and a pause sent then was never answered): wait for it to
          // be playing by its own word before pressing anything.
          await page.waitForFunction(() => document.querySelector('[data-stage-play]')?.getAttribute('data-stage-play') === 'playing', null, { timeout: 45000 });
          await sleep(1500);
          await page.evaluate(() => {
            window.__said = [];
          });
          await page.locator('[data-floating-stage-bar] [data-stage-play]').click();
          await page.waitForFunction(() => window.__said.some((info) => info.playerState === 2) && document.querySelector('[data-stage-play]').getAttribute('data-stage-play') === 'paused', null, { timeout: 15000 });
          await page.locator('[data-floating-stage-bar] [data-stage-play]').click();
          await page.waitForFunction(() => window.__said.some((info) => info.playerState === 1) && document.querySelector('[data-stage-play]').getAttribute('data-stage-play') === 'playing', null, { timeout: 15000 });
          await sleep(1500);
          assert.ok(await page.evaluate(() => document.fullscreenElement !== null), 'a pause and a play from the bar is not a double press: still fullscreen');
          pass("the site's keys along the foot of the fullscreen box pause and play YouTube's player");

          // [ BKG ] off: the video as its player shows it, nothing trimmed, no background. On again: as it was.
          await page.locator('[data-stage-bkg]').click();
          await page.waitForFunction(() => document.fullscreenElement?.querySelector('[data-stage-bkg]')?.getAttribute('data-stage-bkg') === 'off', null, { timeout: 8000 });
          await sleep(600);
          const plain = await page.evaluate(() => {
            const box = document.fullscreenElement;
            const frame = box.querySelector('iframe').getBoundingClientRect();
            return {
              stages: box.querySelectorAll('.backdrop-stage, .backdrop-stage-tile').length,
              fills: Math.abs(frame.width - window.innerWidth) < 3 && Math.abs(frame.height - window.innerHeight) < 3,
              cut: box.querySelector('iframe').hasAttribute('data-backdrop-inset'),
              bar: box.querySelector('[data-floating-stage-bar]') !== null,
              kept: window.localStorage.getItem('debaser.site.stage-bkg.v1'),
              same: box.querySelector('iframe') === window.__frame && window.__loads === window.__loadsAtStart,
            };
          });
          assert.deepEqual(plain, { stages: 0, fills: true, cut: false, bar: false, kept: 'off', same: true }, '[ BKG ] off: no background, the frame fills the screen whole, no second bar of keys, remembered, and the same frame');
          await page.screenshot({ path: join(SHOTS, `full-youtube-bkg-off-${chosen}.png`) });
          await page.locator('[data-stage-bkg]').click();
          await page.waitForFunction(() => document.fullscreenElement?.querySelector('iframe')?.hasAttribute('data-backdrop-inset') === true, null, { timeout: 8000 });
          await sleep(1200);
          assertStaged(await stagedNow(page, 'iframe'), tubeShape, chosen, 'your room, YouTube, [ BKG ] on again');
          assert.equal(await page.evaluate(() => window.localStorage.getItem('debaser.site.stage-bkg.v1')), 'on', 'and that is remembered');
          pass('[ BKG ] in the corner: off is the plain video, on is the background with the bars trimmed; the frame never reloads');
          await page.evaluate(() => document.exitFullscreen());
          await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
          await sleep(600);
          assert.ok(await page.evaluate(() => document.querySelector('[data-floating-player] iframe') === window.__frame && window.__loads === window.__loadsAtStart), 'in and out of fullscreen, the same frame, never reloaded');
          pass(`FULL on YouTube's frame: ${tubeFull}; the bars in its stills are trimmed off`);
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
