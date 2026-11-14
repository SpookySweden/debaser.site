/*
 * Drives the stream room's music visualiser in a real browser (Luke's list, P3, 2026-11-14): starts a private room as
 * kept test account A, queues a site song, switches the visualiser on, and reads whether the picture follows the sound
 * and whether the sliders change it. Not in `npm run checks`: it needs a running site, a network and a browser.
 *
 *   node scripts/drive-visualiser.cjs --base http://localhost:<port> --privacy open [--out Temp/browse/player] [--reduced] [--keep-room]
 *
 * **Run it on a local dev server, not the live site** (core.md, "Test locally", 2026-11-14: live browser drives slowed the
 * site for everyone). On a dev server started from `.env.local` the room is a mock (`--privacy open`: its mock private room
 * asks the host to join), but the sign-in and the board are the real ones, so GO LIVE still posts one real board thread by
 * TEST ACCOUNT A each run: run it as few times as the proof needs and list those threads for Luke. It has no fully mock
 * mode yet (it signs in as the kept test account). Against the live site (`--base https://debaser-site.vercel.app`) it also
 * leaves an ended room; that is only for what a local run can't prove.
 * It records no sound: the page's own copy of the song is only measured, as the visualiser itself does.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, GL_ARGS, installSession, loadEnv, signInTestAccount } = require('./browser.cjs');
const { readPng } = require('./png-read.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3311');
const OUT = opt('--out', join('Temp', 'browse', 'player'));
const WIDTH = Number(opt('--width', '1440'));
const HEIGHT = Number(opt('--height', '1000'));
const TAG = opt('--tag', 'vis');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/**
 * Run before the page's own scripts: keeps the bar's `new Audio()` in reach, and counts how the page listens (every
 * copy taken of an element's sound, every node made from one), measuring the loudness each node carries.
 */
const INSTRUMENTS = `
window.__audios = [];
window.__taps = { captures: 0, nodes: [] };
(() => {
  const Orig = window.Audio;
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
  window.__song = () => window.__audios.find((a) => a.currentSrc !== '' && a.currentSrc.split('#')[0] !== location.href.split('#')[0]);
  const capture = HTMLMediaElement.prototype.captureStream;
  if (capture) HTMLMediaElement.prototype.captureStream = function (...args) { window.__taps.captures += 1; return capture.apply(this, args); };
  const measure = (context, node, how) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    const data = new Uint8Array(1024);
    window.__taps.nodes.push({ how, made: Date.now(), level: () => { analyser.getByteTimeDomainData(data); let sum = 0; for (const v of data) sum += ((v - 128) / 128) ** 2; return Math.sqrt(sum / 1024); } });
  };
  for (const [name, how] of [['createMediaStreamSource', 'stream'], ['createMediaElementSource', 'element']]) {
    const make = AudioContext.prototype[name];
    AudioContext.prototype[name] = function (...args) { const node = make.apply(this, args); measure(this, node, how); return node; };
  }
})();
`;

/** What the visualiser's box says about itself, and what the newest listening node carries. */
const reading = () => {
  const box = document.querySelector('[data-visualiser]');
  const nodes = window.__taps.nodes;
  const newest = nodes[nodes.length - 1];
  return {
    hearing: box ? box.getAttribute('data-visualiser') : null,
    shown: box ? box.getAttribute('data-visualiser-level') : null,
    captures: window.__taps.captures,
    nodes: nodes.length,
    newest: newest ? Number(newest.level().toFixed(3)) : null,
    loudestOfAll: nodes.length ? Number(Math.max(...nodes.map((node) => node.level())).toFixed(3)) : null,
    time: window.__song() ? Number(window.__song().currentTime.toFixed(1)) : null,
    paused: window.__song() ? window.__song().paused : null,
  };
};

/** How different two pictures of the canvas are: the mean distance between their pixels, 0 to 255. */
let shots = 0;
async function canvasShot(page) {
  shots += 1;
  const file = join(OUT, `${TAG}-canvas-${shots}.png`);
  // The top half of the picture only: the keys and the sliders sit over its foot.
  const box = await page.locator('[data-visualiser] canvas').boundingBox();
  await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.floor(box.height / 2) } });
  const read = readPng(file);
  if (read.error) throw new Error(`could not read ${file}: ${read.error}`);
  return read;
}
/** Every colour value of a picture, alpha left out. */
function* values(shot) {
  for (let i = 0; i < shot.pixels.length; i += shot.channels) {
    yield shot.pixels[i];
    yield shot.pixels[i + 1];
    yield shot.pixels[i + 2];
  }
}
function difference(a, b) {
  if (a.width !== b.width || a.height !== b.height) return -1;
  const other = values(b);
  let sum = 0;
  let count = 0;
  for (const value of values(a)) {
    sum += Math.abs(value - other.next().value);
    count += 1;
  }
  return Number((sum / count).toFixed(2));
}
function brightness(a) {
  let sum = 0;
  let count = 0;
  for (const value of values(a)) {
    sum += value;
    count += 1;
  }
  return Number((sum / count).toFixed(2));
}

(async () => {
  loadEnv();
  process.loadEnvFile('.env.production');
  process.loadEnvFile(opt('--env-test', '.env.test'));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', ...GL_ARGS] });
  let roomId = null;
  let page = null;
  try {
    // --mobile: a phone, which is shown the 1280px desktop fitted to its width (app/layout.tsx).
    const phone = flag('--mobile') ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {};
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion: flag('--reduced') ? 'reduce' : 'no-preference', ...phone });
    page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
    const account = await signInTestAccount('A');
    if (account.error) throw new Error(`sign-in: ${account.error}`);
    await installSession(page, account);
    await page.addInitScript({ content: INSTRUMENTS });
    await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
    // Headless Chrome reports no mouse until the first move, and the site would treat it as a phone.
    await page.mouse.move(300, 300);
    await page.waitForSelector('[data-cytube-go-live]', { timeout: 60000 });
    await sleep(1500);
    const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
    if ((await close.count()) > 0) await close.click();

    // 1. A private room.
    const goLive = page.locator('[data-cytube-go-live]');
    const fresh = (await goLive.getAttribute('data-cytube-go-live')) === 'new';
    await goLive.click();
    if (fresh) {
      const dialog = page.locator('[data-go-live-window]');
      await dialog.waitFor();
      // The name and topic are only asked when a video comes along; this room starts empty and private.
      if ((await dialog.locator('[data-go-live-name]').count()) > 0) await dialog.locator('[data-go-live-name]').fill('DRIVE VISUALISER');
      if ((await dialog.locator('[data-go-live-topic]').count()) > 0) await dialog.locator('[data-go-live-topic]').fill('A test room, to be deleted');
      await dialog.locator(`[data-room-privacy="${opt('--privacy', 'private')}"]`).click();
      await dialog.locator('[data-go-live-start]').click();
    }
    const room = page.locator('[data-dock-window="stream"]');
    await room.waitFor({ timeout: 45000 });
    await sleep(2500);
    // A private room asks even its host to join before it shows anything.
    const joinKey = room.getByRole('button', { name: '[ JOIN ]' });
    if ((await joinKey.count()) > 0) {
      await joinKey.click();
      await sleep(2500);
    }
    await page.screenshot({ path: `${OUT}/${TAG}-room.png` });
    roomId = await page.evaluate(() => new URLSearchParams(location.search).get('watch'));
    pass(`a ${opt('--privacy', 'private')} room is open (${fresh ? 'new' : 'one this account already hosted'}; id ${roomId})`);

    // 2. A site song into the queue: the empty screen's MUSIC key opens the queue searched for music.
    const music = room.getByRole('button', { name: /MUSIC/ }).first();
    await music.click();
    await page.waitForSelector('[data-add-queue]', { timeout: 45000 });
    await sleep(1000);
    await page.screenshot({ path: join(OUT, `${TAG}-queue.png`) });
    const add = page.locator('[data-add-queue]').first();
    const label = await add.getAttribute('aria-label');
    await add.click();
    await page.waitForFunction(() => window.__song() !== undefined && !window.__song().paused && window.__song().currentTime > 0.5, null, { timeout: 60000 });
    const song = await page.evaluate(() => ({ src: new URL(window.__song().currentSrc).host, crossorigin: window.__song().getAttribute('crossorigin') }));
    pass(`a song plays in the room (${label}; from ${song.src}; crossorigin ${song.crossorigin})`);
    const shut = page.getByRole('dialog').getByRole('button', { name: /^Close / });
    if ((await shut.count()) > 0) await shut.first().click();
    await sleep(500);

    // 3. The visualiser on.
    await room.locator('[data-visualiser-toggle]').click();
    const accept = page.getByRole('button', { name: '[ I UNDERSTAND, SHOW IT ]' });
    await accept.waitFor({ timeout: 10000 }).catch(() => undefined);
    if ((await accept.count()) > 0) {
      await page.screenshot({ path: join(OUT, `${TAG}-warning.png`) });
      await accept.click();
      pass('the flashing-lights warning came first');
    }
    await page.waitForSelector('[data-visualiser] canvas', { timeout: 30000 });
    await sleep(6000);

    // With "reduce motion" asked of the device (--reduced): one still picture, and it says so.
    if (flag('--reduced')) {
      const one = await canvasShot(page);
      await sleep(2500);
      const two = await canvasShot(page);
      const note = await page.locator('[data-visualiser] [role="status"]').innerText();
      console.log(`      reduce motion: two pictures 2.5 seconds apart differ by ${difference(one, two)}; mean light ${brightness(two)}; it says "${note}"`);
      await page.screenshot({ path: join(OUT, `${TAG}-still.png`) });
      assert.equal(await page.locator('[data-visualiser]').getAttribute('data-visualiser-still'), 'yes');
      assert.equal(difference(one, two), 0, 'nothing moves');
      assert.ok(brightness(two) > 3, 'and the still is a picture, not a black box');
      assert.match(note, /A STILL PICTURE \(REDUCE MOTION IS ON\)/);
      pass('under "reduce motion" it shows one still picture and says so');
      console.log(`\ndrive-visualiser: ${passed} passed`);
      return;
    }

    // 4. Does it follow the sound? Twelve seconds of readings.
    const seen = [];
    for (let i = 0; i < 24; i += 1) {
      await sleep(500);
      seen.push(await page.evaluate(reading));
    }
    console.log('      playing:  ' + seen.map((r) => `${r.newest}`).join(' '));
    console.log('      shown:    ' + seen.map((r) => `${r.shown}`).join(' '));
    console.log(`      hearing ${seen[seen.length - 1].hearing}; copies taken of the sound: ${seen[0].captures} -> ${seen[seen.length - 1].captures}; listening nodes made: ${seen[0].nodes} -> ${seen[seen.length - 1].nodes}`);
    const silentWhilePlaying = seen.filter((r) => r.newest === 0).length;
    console.log(`      readings where the node it listens through carried nothing: ${silentWhilePlaying} of ${seen.length}`);
    await page.screenshot({ path: join(OUT, `${TAG}-playing.png`) });
    const loud = await canvasShot(page);

    if (flag('--before')) {
      console.log('      (--before: reporting only, no assertions)');
    } else {
      assert.equal(seen[seen.length - 1].hearing, 'listening', 'it says it is listening');
      assert.ok(seen[seen.length - 1].captures - seen[0].captures === 0, 'it takes one copy of the sound and keeps it, not a new one every two seconds');
      assert.ok(seen.filter((r) => r.newest > 0).length >= seen.length * 0.8, 'the node it listens through carries the song');
      assert.ok(seen.some((r) => Number(r.shown) > 0), 'and the level it shows moves off zero');
      pass('the visualiser hears the song, through one kept copy of its sound');
    }

    // 5. Paused, the sound it hears drops to nothing; playing again, it comes back.
    await page.evaluate(() => window.__song().pause());
    await sleep(1500);
    const quiet = [];
    for (let i = 0; i < 6; i += 1) {
      await sleep(400);
      quiet.push(await page.evaluate(reading));
    }
    console.log('      paused:   ' + quiet.map((r) => `${r.newest}/${r.shown}`).join(' '));
    const still = await canvasShot(page);
    await page.screenshot({ path: join(OUT, `${TAG}-paused.png`) });
    await page.evaluate(() => window.__song().play());
    await sleep(2500);
    const back = [];
    for (let i = 0; i < 6; i += 1) {
      await sleep(400);
      back.push(await page.evaluate(reading));
    }
    console.log('      again:    ' + back.map((r) => `${r.newest}/${r.shown}`).join(' '));
    console.log(`      picture, playing against paused: ${difference(loud, still)} (0 = the same picture)`);
    if (!flag('--before')) {
      assert.ok(quiet.slice(-3).every((r) => r.newest === 0 || r.newest < 0.002), 'paused, it hears nothing');
      assert.ok(quiet.slice(-2).every((r) => Number(r.shown) === 0), 'and shows a level of nothing');
      assert.ok(back.some((r) => r.newest > 0) && back.some((r) => Number(r.shown) > 0), 'playing again, it hears again');
      pass('loud and quiet: the level it shows follows the song (playing, paused, playing again)');
    }

    // 6. The sliders.
    if (!flag('--before')) {
      const picture = await page.locator('[data-visualiser]').boundingBox();
      await page.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 3);
      // A press on the picture brings the keys back: on a phone there is no pointer to move.
      await page.mouse.click(picture.x + picture.width / 2, picture.y + picture.height / 3);
      const key = page.locator('[data-visualiser-sliders-key]');
      const keyBefore = await key.boundingBox();
      assert.equal(await key.getAttribute('aria-expanded'), 'false');
      await key.click();
      assert.equal(await key.getAttribute('aria-expanded'), 'true', 'the SLIDERS key says it is open');
      const keyAfter = await key.boundingBox();
      assert.ok(Math.abs(keyBefore.x - keyAfter.x) < 1 && Math.abs(keyBefore.y - keyAfter.y) < 1, 'opening the sliders does not move the key under the pointer');
      pass('[ SLIDERS ] opens them over the picture, and the key stays under the pointer');
      const sliders = page.locator('[data-visualiser] input[type="range"]');
      const count = await sliders.count();
      assert.ok(count >= 4, `four sliders at least: ${count}`);
      const names = [];
      for (let i = 0; i < count; i += 1) names.push(await sliders.nth(i).getAttribute('aria-label'));
      pass(`sliders, each with a name: ${names.join(', ')}`);
      for (let i = 0; i < count; i += 1) {
        const box = await sliders.nth(i).boundingBox();
        assert.ok(box !== null && box.height >= 24, `${names[i]} is tall enough to grab: ${box && box.height}`);
      }
      await page.screenshot({ path: join(OUT, `${TAG}-sliders.png`) });

      // Brightness: all the way down, the picture goes dark; back up, it returns.
      const bright = page.locator('[data-visualiser] input[data-visualiser-slider="brightness"]');
      const before = brightness(await canvasShot(page));
      await bright.focus();
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowLeft');
      await sleep(800);
      const dim = brightness(await canvasShot(page));
      console.log(`      brightness slider: the picture's mean light ${before} -> ${dim} (${await bright.getAttribute('aria-valuetext')})`);
      assert.ok(dim < before * 0.75, 'the brightness slider, by keyboard, darkens the picture');
      await page.screenshot({ path: join(OUT, `${TAG}-dim.png`) });
      pass('BRIGHTNESS by the arrow keys darkens the picture');

      // React: at nothing, the level it feeds the picture is flat; at full, it is not.
      const react = page.locator('[data-visualiser] input[data-visualiser-slider="react"]');
      await react.focus();
      await page.keyboard.press('Home');
      await sleep(2500);
      const flat = [];
      for (let i = 0; i < 6; i += 1) {
        await sleep(300);
        flat.push(Number(await page.evaluate(() => document.querySelector('[data-visualiser]').getAttribute('data-visualiser-fed'))));
      }
      await page.keyboard.press('End');
      await sleep(2500);
      const full = [];
      for (let i = 0; i < 6; i += 1) {
        await sleep(300);
        full.push(Number(await page.evaluate(() => document.querySelector('[data-visualiser]').getAttribute('data-visualiser-fed'))));
      }
      console.log(`      react slider: what the picture is fed at nothing ${flat.join(' ')}; at full ${full.join(' ')}`);
      assert.ok(Math.max(...flat) === 0, 'REACT at nothing feeds the picture no sound');
      assert.ok(Math.max(...full) > 0, 'REACT at full feeds it the song');
      pass('REACT changes how much of the song reaches the picture');

      // Remembered in this browser, and RESET brings the defaults back.
      const kept = await page.evaluate(() => window.localStorage.getItem('debaser-visualiser-settings'));
      assert.ok(kept !== null && /brightness/.test(kept), 'the settings are kept in this browser');
      await page.locator('[data-visualiser] [data-visualiser-reset]').click();
      await sleep(400);
      const after = await page.evaluate(() => [...document.querySelectorAll('[data-visualiser] input[type="range"]')].map((input) => `${input.getAttribute('data-visualiser-slider')}=${input.value}`).join(' '));
      console.log(`      after RESET: ${after}`);
      assert.equal(Number(await bright.inputValue()), 100, 'RESET puts brightness back');
      pass('the sliders are remembered in this browser, and RESET brings the defaults back');
      await page.screenshot({ path: join(OUT, `${TAG}-after-reset.png`) });
    }

    console.log(`\ndrive-visualiser: ${passed} passed`);
  } catch (error) {
    if (page) await page.screenshot({ path: join(OUT, `${TAG}-failed.png`) }).catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  } finally {
    // The room is ended either way, so nothing is left live.
    if (page && !flag('--keep-room')) {
      try {
        const end = page.getByRole('button', { name: '[ END STREAM ]' }).last();
        if ((await end.count()) > 0) {
          await end.click();
          await page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click();
          await sleep(1500);
          console.log(`  the room was ended (id ${roomId}); its record and board thread remain: list them for Luke`);
        } else console.log(`  NO END STREAM KEY FOUND: the room (id ${roomId}) may still be live`);
      } catch (error) {
        console.log(`  could not end the room (id ${roomId}): ${String(error).slice(0, 160)}`);
      }
    }
    await browser.close();
  }
})();
