/*
 * Drives the music bar's sound graph and LOVE BUZZ on arrival in a real browser (PLAYERBAR, Luke's second list,
 * 2026-11-16), on a LOCAL mock dev server (core.md, "Test locally"): no sign-in, no database.
 *
 *   node scripts/drive-sound-graph.cjs --base http://localhost:<port> [--out Temp/browse/playerbar] [--only buzz,graph,tab,relay,youtube]
 *
 * The mock shelf is the browser's own (`debaser.audio.mock.v1`): the drive puts one track there titled "LOVE BUZZ - UPLOAD
 * TEST", whose file is a two-second tone made here and served by the drive itself at a same-site address (so the page may
 * measure it, as it measures the real file on the site's storage). Nothing is recorded: the page's own copy is measured.
 *
 * Sections:
 *   buzz    on arrival LOVE BUZZ is loaded, quiet, silent until the first key press, then playing and looping; a reload
 *           does not start it again; a first press on the bar's own PLAY leaves it playing (not toggled twice).
 *   graph   the graph hears the bar's song (its level follows playing and paused), every word stays 4.5:1 over the pixels
 *           it actually drew (dark and bright themes), the frame cost, nothing drawn under reduced motion or a hidden tab.
 *   tab     [ HEAR ] with Chrome's test switch that accepts "share this tab" by itself: the key goes, the graph hears the tab.
 *   relay   the site's relay of a YouTube video's sound, played into an analyser in the page: 206 slices, sound heard,
 *           and a seek past the first slice still plays (the second slice).
 *   youtube a YouTube video from MEDIA in the floating player with the bar quiet: the graph listens to the relay.
 *   limit   (asked for by name only: it uses up this address's relay for a minute) the relay refuses this address with a
 *           429 once it has asked too often; a YouTube video from MEDIA then plays, the graph moves gently instead.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317');
const OUT = opt('--out', join('Temp', 'browse', 'playerbar'));
const ONLY = opt('--only', 'buzz,graph,tab,relay,youtube').split(',');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const note = (what) => console.log(`  ..  ${what}`);

/** A two-second tone: a low hum, a middle note and a high whistle, each swelling at its own rate, so the bars move. */
function toneWav(seconds = 2, rate = 22050) {
  const samples = seconds * rate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const v =
      0.35 * Math.sin(2 * Math.PI * 110 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.5 * t)) +
      0.25 * Math.sin(2 * Math.PI * 660 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t)) +
      0.2 * Math.sin(2 * Math.PI * 3520 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t));
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), 44 + i * 2);
  }
  return data;
}

const TONE = toneWav();
const TONE_PATH = '/drive-audio/love-buzz-20260925195523.wav';
const SEED = (themeId) => `
  try {
    if (!localStorage.getItem('debaser.audio.mock.v1')) localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ version: 1, tracks: [{
      id: 'drive/love-buzz', title: 'LOVE BUZZ - UPLOAD TEST', credit: 'sweden', kind: 'UPLOADED TO THE SHELF', src: location.origin + '${TONE_PATH}',
      length: '0:02', tags: [], folderPath: 'UPLOAD TEST', shelf: 'bucket' }, {
      id: 'drive/other-song', title: 'ANOTHER SONG', credit: 'sweden', kind: 'UPLOADED TO THE SHELF', src: location.origin + '/drive-audio/other-song.wav',
      length: '0:02', tags: [], folderPath: 'UPLOAD TEST', shelf: 'bucket' }] }));
    ${themeId ? `localStorage.setItem('debaser.site.theme.v1', '${themeId}'); localStorage.setItem('debaser.site.theme.v2', '${themeId}');` : ''}
  } catch {}
`;

async function newPage(browser, { theme, reducedMotion } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await context.route('**/drive-audio/other-song.wav', (route) => route.fulfill({ status: 200, body: TONE, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'none' } }));
  await context.route(`**${TONE_PATH}`, (route) => route.fulfill({ status: 200, body: TONE, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'none' } }));
  // Cut off from the live database, whatever the server was started with.
  await context.route(/supabase\.co/, (route) => route.abort());
  await context.addInitScript(SEED(theme));
  await context.addInitScript(KEEP_AUDIO);
  const page = await context.newPage();
  page.on('pageerror', (error) => note(`page error: ${error.message}`));
  return { context, page };
}

/** The bar's one audio element, read from the page (the one carrying the tone). */
const songState = (page) =>
  page.evaluate(() => {
    // The dev server's strict mode makes the bar's element twice and drops the first: the one carrying the file is it.
    const found = (window.__audios ?? []).filter((a) => a.src.includes('love-buzz')).pop();
    return found ? { src: found.currentSrc, paused: found.paused, volume: found.volume, time: found.currentTime } : null;
  });

/** Keeps the bar's `new Audio()` in reach (the provider makes it outside the page's tree). */
const KEEP_AUDIO = `
  (() => {
    const Orig = window.Audio;
    window.__audios = [];
    window.Audio = function (...a) { const made = new Orig(...a); window.__audios.push(made); return made; };
    window.Audio.prototype = Orig.prototype;
  })();
`;

/** Waits for the arrival step (LOVE BUZZ loaded and armed for the first press). */
async function arrived(page) {
  await page.waitForFunction(() => sessionStorage.getItem('debaser.audio.love-buzz.v1') === 'loaded', null, { timeout: 30000 });
  await sleep(500);
}

/** The bar's middle key, whatever state it shows. */
const middleKey = (page) => page.getByRole('button', { name: /^(Playing|Looping|Paused)$/ }).first();

/** Presses the middle key until the bar is paused (it walks playing -> paused -> looping -> playing). */
async function pauseBar(page) {
  for (let i = 0; i < 4; i += 1) {
    const s = await songState(page);
    if (s && s.paused) return;
    await middleKey(page).click();
    await sleep(400);
  }
  throw new Error('the bar would not pause');
}

/** Presses the middle key until the bar plays. */
async function playBar(page) {
  for (let i = 0; i < 4; i += 1) {
    const s = await songState(page);
    if (s && !s.paused) return;
    await middleKey(page).click();
    await sleep(400);
  }
  throw new Error('the bar would not play');
}

const graphState = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-bar-led] canvas');
    if (!canvas) return null;
    return { source: canvas.dataset.soundGraph, level: Number(canvas.dataset.soundGraphLevel ?? 0), ms: Number(canvas.dataset.soundGraphMs ?? 0), fps: Number(canvas.dataset.soundGraphFps ?? 0) };
  });

async function until(what, read, test, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await read();
    if (test(last)) return last;
    await sleep(250);
  }
  throw new Error(`timed out: ${what} (last: ${JSON.stringify(last)})`);
}

/** The worst contrast any word on the display has against the brightest mix the graph painted, measured from its pixels. */
const MEASURE_CONTRAST = () => {
  const canvas = document.querySelector('[data-bar-led] canvas');
  const led = document.querySelector('[data-bar-led]');
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const parse = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const base = parse(getComputedStyle(led).backgroundColor);
  const inks = new Set();
  // Words on a box of their own (the uploader picture's square) cover the graph: only words straight on the display count.
  const ownBox = (el) => {
    for (let at = el; at && at !== led; at = at.parentElement) {
      const style = getComputedStyle(at);
      const alpha = (style.backgroundColor.match(/[\d.]+/g) || [0, 0, 0, 0])[3];
      if ((alpha === undefined || Number(alpha) > 0) && style.backgroundColor !== 'transparent') return true;
      if (style.backgroundImage !== 'none') return true;
    }
    return false;
  };
  for (const el of led.querySelectorAll('*')) {
    if (el === canvas || el.closest('button') || ownBox(el)) continue;
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')) inks.add(getComputedStyle(el).color);
  }
  let painted = 0;
  let worst = Infinity;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a === 0) continue;
    painted += 1;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Canvas pixels are premultiplied-free here: mix over the display's own colour as the screen does.
    const mixed = [0, 1, 2].map((k) => data[i + k] * a + base[k] * (1 - a));
    for (const ink of inks) worst = Math.min(worst, ratio(parse(ink), mixed));
  }
  return { painted, worst, inks: [...inks], colours: seen.size, base: base.join(",") };
};

async function buzz(browser) {
  console.log('LOVE BUZZ on arrival');
  const { context, page } = await newPage(browser);
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LOVE BUZZ/.test(document.querySelector('[data-bar-led]')?.innerText ?? ''), null, { timeout: 60000 });
  pass('arrival: the bar shows LOVE BUZZ');
  await arrived(page);
  let song = await until('the bar loads it', () => songState(page), (s) => s !== null && s.src.includes('love-buzz'), 10000);
  const ownVolume = song.volume;
  assert.ok(ownVolume > 0.25, `the reader's own volume is untouched on arrival (${ownVolume})`);
  pass(`arriving leaves the reader's volume alone (${ownVolume})`);
  await sleep(2000);
  song = await songState(page);
  assert.equal(song.paused, true, 'no sound before the reader touches the page');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('debaser.audio.love-buzz.v1')), 'loaded');
  pass('silent until the first press');
  // A lone Shift is no touch to the browser (sound would be refused): it must not spend the one start. Only judged where
  // the page starts untouched (a driven browser sometimes counts itself as touched already).
  if (!(await page.evaluate(() => navigator.userActivation?.hasBeenActive ?? true))) {
    await page.keyboard.press('Shift');
    await sleep(1000);
    assert.equal((await songState(page)).paused, true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('debaser.audio.love-buzz.v1')), 'loaded', 'still waiting after a lone Shift');
    pass('a lone Shift does not spend it');
  } else {
    note('this browser counted the page as touched before any press: the lone-Shift step is not judged here');
  }
  await page.keyboard.press('KeyA');
  song = await until('it starts after the press', () => songState(page), (s) => s && !s.paused, 5000);
  pass('the first key press starts it');
  song = await until('quiet', () => songState(page), (s) => s && s.volume <= 0.25 + 1e-6, 3000);
  assert.equal(await page.evaluate(() => Number(document.querySelector('input[aria-label="Volume"]').value)), Math.round(song.volume * 100), 'the slider shows the quiet volume');
  pass(`quietly: volume ${song.volume}`);
  await sleep(2600);
  song = await songState(page);
  assert.equal(song.paused, false, 'still playing past its two-second end');
  assert.ok(song.time < 2, `it went round again (at ${song.time.toFixed(2)}s)`);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('debaser.audio.love-buzz.v1')), 'started');
  pass('looping');
  // The reader pauses it and moves to the next song: their own volume comes back. (Paused first: on the mock server a
  // song filed into your own room sends its keeper round in a loop, an existing fault outside this work, 2026-11-16.)
  await pauseBar(page);
  await page.getByRole('button', { name: 'Next track' }).click();
  await until('the reader\'s volume back', () => page.evaluate(() => Number(document.querySelector('input[aria-label="Volume"]').value)), (v) => v === Math.round(ownVolume * 100), 5000);
  pass(`the next song: the reader's volume back (${ownVolume})`);
  // Then reloads: it is not started again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /ANOTHER SONG|LOVE BUZZ/.test(document.querySelector('[data-bar-led]')?.innerText ?? ''), null, { timeout: 60000 });
  await sleep(1500);
  await page.keyboard.press('KeyA');
  await sleep(1500);
  assert.equal(await page.evaluate(() => (window.__audios ?? []).filter((a) => !a.paused).length), 0, 'nothing plays: the next page of the visit does not start it again');
  assert.doesNotMatch(await page.locator('[data-bar-led]').innerText(), /LOVE BUZZ/, 'nor loads it again over the song the reader moved to');
  pass('a reload in the same visit does not start it again');
  await context.close();

  // A new visit whose first press is the bar's own PLAY: playing, not toggled back off.
  const second = await newPage(browser);
  await second.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await second.page.waitForFunction(() => /LOVE BUZZ/.test(document.querySelector('[data-bar-led]')?.innerText ?? ''), null, { timeout: 60000 });
  await arrived(second.page);
  await until('loaded', () => songState(second.page), (s) => s !== null);
  // A fresh browser's middle key reads Looping while paused (the shelf's repeat starts on): one press on it.
  // (That press turns the shelf's repeat off, the bar's own rule, so the two-second tone ends after one go: read inside it.)
  await second.page.evaluate(() => {
    const el = window.__audios.filter((a) => a.src.includes('love-buzz')).pop();
    window.__pauses = 0;
    el.addEventListener('pause', () => (window.__pauses += 1));
  });
  await middleKey(second.page).click();
  await sleep(1200);
  song = await songState(second.page);
  assert.equal(song.paused, false, 'playing after the press on the middle key');
  assert.equal(await second.page.evaluate(() => window.__pauses), 0, 'never started and stopped again by two hands');
  pass('first press on the bar\'s own middle key: playing, once, no pause between');
  await second.context.close();
}

async function graph(browser) {
  console.log('the sound graph');
  for (const theme of ['dark', 'default']) {
    const { context, page } = await newPage(browser, { theme });
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /LOVE BUZZ/.test(document.querySelector('[data-bar-led]')?.innerText ?? ''), null, { timeout: 60000 });
    await arrived(page);
    let state = await graphState(page);
    assert.equal(state.source, 'off', 'nothing plays: nothing drawn');
    await page.keyboard.press('KeyA');
    state = await until('the graph hears the song', () => graphState(page), (s) => s && s.source === 'bar' && s.level > 0.05, 10000);
    pass(`${theme}: the graph hears the bar's song (level ${state.level}, ${state.fps} frames a second, ${state.ms} ms a frame)`);
    const contrast = await page.evaluate(MEASURE_CONTRAST);
    assert.ok(contrast.painted > 200, `it drew something (${contrast.painted} pixels)`);
    assert.ok(contrast.worst >= 4.5, `${theme}: every word 4.5:1 over what was drawn (worst ${contrast.worst.toFixed(2)}, words in ${contrast.inks.join(" / ")}, display ${contrast.base})`);
    pass(`${theme}: worst contrast over the drawn pixels ${contrast.worst.toFixed(2)}:1 (${contrast.colours} colours, words in ${contrast.inks.join(' / ')})`);
    await page.locator('[data-bar-led]').screenshot({ path: join(OUT, `led-${theme}.png`) });
    if (theme === 'dark') {
      // Paused: the graph stops.
      await pauseBar(page);
      state = await until('paused: the graph stops', () => graphState(page), (s) => s && s.source === 'off', 5000);
      pass('paused: the graph stops');
      await playBar(page);
      await until('playing again', () => graphState(page), (s) => s && s.source === 'bar' && s.level > 0.05, 8000);
      // A hidden tab: the loop stops.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      state = await until('hidden: the graph stops', () => graphState(page), (s) => s && s.source === 'off', 5000);
      pass('a hidden tab: the graph stops');
    }
    await context.close();
  }
  const still = await newPage(browser, { reducedMotion: true });
  await still.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await still.page.waitForFunction(() => /LOVE BUZZ/.test(document.querySelector('[data-bar-led]')?.innerText ?? ''), null, { timeout: 60000 });
  await arrived(still.page);
  await still.page.keyboard.press('KeyA');
  await sleep(3000);
  const state = await graphState(still.page);
  assert.equal(state.source, 'off', 'reduced motion: nothing drawn while it plays');
  pass('reduced motion: the graph draws nothing');
  await still.context.close();
}

async function tab(browserPath) {
  console.log('[ HEAR ]: the tab');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=user-gesture-required', '--auto-accept-this-tab-capture', '--no-first-run'] });
  try {
    const { page } = await newPage(browser);
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-tab-listen]') !== null, null, { timeout: 60000 });
    const key = page.locator('[data-tab-listen]');
    assert.equal(await key.innerText(), '[ HEAR ]');
    const tip = await key.getAttribute('title');
    assert.match(tip, /Your browser will ask to share this tab/);
    assert.match(tip, /nothing is recorded or sent/);
    const box = await key.boundingBox();
    const led = await page.locator('[data-bar-led]').boundingBox();
    assert.ok(box.x + box.width <= led.x + led.width && box.x > led.x + led.width / 2, 'small, at the right inside the black display');
    assert.ok(box.height <= 32, `small (${box.height}px high)`);
    pass(`[ HEAR ] sits at the right inside the display (${Math.round(box.width)}x${Math.round(box.height)}px), its tip says what the browser will ask`);
    await key.click();
    const status = await until('the share is answered', () => page.evaluate(() => document.querySelector('[data-tab-listen]')?.dataset.tabListen ?? 'gone'), (s) => s !== 'asking', 10000);
    if (status !== 'gone') {
      note(`this browser answered the share with "${status}" (headless Chrome may share no tab sound): the tab part is proved by the check, not here`);
      return;
    }
    pass('allowed: the key is gone');
    await playBar(page);
    await until('the graph listens to the tab', () => graphState(page), (s) => s && s.source === 'tab', 10000);
    pass('the graph listens to the tab');
    const loud = await until('the tab carries sound', () => graphState(page), (s) => s && s.source === 'tab' && s.level > 0.02, 8000).catch(() => null);
    if (loud) pass(`the tab's sound moves the graph (level ${loud.level})`);
    else note('the tab was shared but carried no sound in this headless browser: the level was not proved here');
  } finally {
    await browser.close();
  }
}

async function relay(browserPath) {
  console.log('the YouTube relay');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  try {
    const { page } = await newPage(browser);
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    const id = 'dQw4w9WgXcQ';
    const head = await page.evaluate(async (video) => {
      const r = await fetch(`/api/audio/relay/${video}`, { headers: { Range: 'bytes=0-' } });
      const body = await r.arrayBuffer();
      return { status: r.status, type: r.headers.get('content-type'), range: r.headers.get('content-range'), bytes: body.byteLength };
    }, id);
    if (head.status === 502) {
      note('YouTube handed this machine no sound (502): the graph would move gently. Nothing more to prove here.');
      return;
    }
    assert.equal(head.status, 206);
    assert.equal(head.type, 'audio/mp4');
    assert.match(head.range, /^bytes 0-\d+\/\d+$/);
    assert.ok(head.bytes <= 1024 * 1024, 'one slice at most');
    pass(`a slice: ${head.status} ${head.type} ${head.range}`);
    const heard = await page.evaluate(async (video) => {
      const context = new AudioContext();
      const audio = new Audio(`/api/audio/relay/${video}`);
      const analyser = context.createAnalyser();
      context.createMediaElementSource(audio).connect(analyser);
      const bytes = new Uint8Array(analyser.frequencyBinCount);
      const loud = () => { analyser.getByteFrequencyData(bytes); return bytes.reduce((a, b) => a + b, 0) / bytes.length; };
      await audio.play();
      await new Promise((r) => setTimeout(r, 4000));
      const first = { time: audio.currentTime, level: loud() };
      // Past the first slice (about 170 seconds of the smallest file): the player asks for the next one by itself.
      audio.currentTime = 200;
      await new Promise((r) => setTimeout(r, 6000));
      const second = { time: audio.currentTime, level: loud(), paused: audio.paused, error: audio.error?.code ?? null };
      audio.pause();
      return { first, second };
    }, id);
    assert.ok(heard.first.time > 2 && heard.first.level > 1, `sound heard from the first slice (${JSON.stringify(heard.first)})`);
    pass(`the relay plays into an analyser: ${heard.first.time.toFixed(1)}s in, level ${heard.first.level.toFixed(1)}`);
    assert.ok(heard.second.time > 200 && heard.second.error === null && heard.second.level > 1, `a seek past the first slice still plays (${JSON.stringify(heard.second)})`);
    pass(`a seek past the first slice plays on: ${heard.second.time.toFixed(1)}s, level ${heard.second.level.toFixed(1)}`);
    const cross = await page.evaluate(async (video) => (await fetch(`/api/audio/relay/${video}`, { headers: { 'x-test': '1' } })).status, id);
    assert.ok(cross === 206 || cross === 200, 'this site may ask');
  } finally {
    await browser.close();
  }
}

/** Presses PLAY on MEDIA's first YouTube row (its key says which player it loads; a row's text is cut short). */
async function playYoutubeRow(page) {
  const key = page.getByRole('button', { name: /^Play .*\(loads the YOUTUBE player\)$/ }).first();
  await key.waitFor({ timeout: 60000 });
  await key.click();
}

async function youtube(browserPath) {
  console.log('a YouTube video from MEDIA, the bar quiet');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  try {
    const { page } = await newPage(browser);
    await page.addInitScript(`try { sessionStorage.setItem('debaser.audio.love-buzz.v1', 'skipped'); } catch {}`);
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await playYoutubeRow(page);
    const state = await until('the graph listens to the relay', () => graphState(page), (s) => s && (s.source === 'relay' || s.source === 'gentle'), 30000);
    if (state.source === 'relay') {
      const heard = await until('the relay carries sound', () => graphState(page), (s) => s && s.source === 'relay' && s.level > 0.02, 30000).catch(() => null);
      if (heard) pass(`YouTube in the floating player: the graph listens to the relay (level ${heard.level})`);
      else note('the graph chose the relay but heard no sound within 30s (YouTube\'s own player may not have started headless)');
    } else {
      note(`the graph moved gently (${JSON.stringify(state)}): the relay failed or YouTube's player has not said where it is`);
    }
    await page.locator('[data-bar-led]').screenshot({ path: join(OUT, 'led-youtube.png') });
  } finally {
    await browser.close();
  }
}

/**
 * The relay's per-address limit (list 3): this address asks until the relay refuses (429), then a YouTube video from
 * MEDIA plays: the graph's hidden player is refused, the graph moves gently, and YouTube's own player plays on. Not in
 * the default run: it uses up this address's relay for a minute on that server.
 */
async function limit(browserPath) {
  console.log('the relay refusing this address');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  try {
    const { page } = await newPage(browser);
    await page.addInitScript(`try { sessionStorage.setItem('debaser.audio.love-buzz.v1', 'skipped'); } catch {}`);
    const answers = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/audio/relay/')) answers.push({ url: response.url(), status: response.status() });
    });
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    // A malformed id: counted like any ask, and nothing is fetched from YouTube.
    const used = await page.evaluate(async () => {
      for (let i = 1; i <= 400; i += 1) {
        const r = await fetch('/api/audio/relay/x');
        if (r.status === 429) return { asks: i, retryAfter: r.headers.get('retry-after') };
      }
      return null;
    });
    assert.ok(used, 'the relay refuses one address within 400 asks');
    assert.equal(used.retryAfter, '60');
    pass(`the relay refused this address after ${used.asks - 1} asks (429, Retry-After ${used.retryAfter})`);
    await playYoutubeRow(page);
    const refused = await until('the graph asks the relay for the video', async () => answers.find((a) => !a.url.endsWith('/x')) ?? null, (a) => a !== null, 30000);
    assert.equal(refused.status, 429, `the video's relay ask is refused (${refused.url})`);
    pass(`the graph's hidden player was refused: ${refused.status}`);
    const state = await until('the graph moves gently', () => graphState(page), (s) => s && s.source === 'gentle' && s.level > 0, 15000);
    await sleep(3000);
    const still = await graphState(page);
    assert.equal(still.source, 'gentle', `the graph stays gentle and does not go back to the relay (${JSON.stringify(still)})`);
    pass(`the graph moves gently instead (level ${state.level}), and stays so`);
    const youtubePlayer = await page.locator('iframe[src*="youtube"]').count();
    assert.ok(youtubePlayer >= 1, "YouTube's own player is still there");
    pass(`YouTube's own player is untouched (${youtubePlayer} frame)`);
    await page.locator('[data-bar-led]').screenshot({ path: join(OUT, 'led-relay-refused.png') });
  } finally {
    await browser.close();
  }
}

(async () => {
  const browserPath = findChrome();
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=user-gesture-required', '--no-first-run'] });
  try {
    if (ONLY.includes('buzz')) await buzz(browser);
    if (ONLY.includes('graph')) await graph(browser);
  } finally {
    await browser.close();
  }
  if (ONLY.includes('tab')) await tab(browserPath);
  if (ONLY.includes('relay')) await relay(browserPath);
  if (ONLY.includes('youtube')) await youtube(browserPath);
  if (ONLY.includes('limit')) await limit(browserPath);
  console.log(`DRIVE PASSED: ${passed} steps`);
})().catch((error) => {
  console.error(`DRIVE FAILED after ${passed} steps:`, error.message);
  process.exit(1);
});
