/*
 * One thing plays at a time, and an audio row's PLAY uses the music bar (MISC, Luke's list 4, items 5 and 6, from a test
 * run he passed on: "Two things played at once. I started an Internet Archive audio item, then a YouTube video, and the
 * audio kept running underneath the video." and "Audio "Play" doesn't use the music player ... it opened a separate
 * Internet Archive player in the list."). On a LOCAL mock dev server only (core.md, "Test locally"): no sign-in, no
 * database; the live database is blocked.
 *
 *   node scripts/drive-one-at-a-time.cjs --base http://localhost:<port> [--out Temp/browse/one-at-a-time]
 *
 *   1. An Internet Archive audio row's PLAY plays in the music bar: the bar's own audio element sounds, and no Archive
 *      player opens in the list.
 *   2. Then a video's PLAY (it opens in your room): the bar's audio pauses.
 *   3. Then the bar's PLAY again: the room's video gives way (it is no longer playing).
 *   4. An audio row whose files cannot be found: PLAY says so and offers the Archive's own page; it never opens the
 *      Archive's player in the list, and the bar keeps what it had.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3326');
const OUT = opt('--out', join('Temp', 'browse', 'one-at-a-time'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

/** A two-second tone, served for every Archive file the bar asks for, so the bar really plays without the network. */
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
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return data;
}
const TONE = toneWav();

/** Keeps the bar's `new Audio()` in reach (the provider makes it outside the page's tree). */
const KEEP_AUDIO = `
  (() => {
    const Orig = window.Audio;
    window.__audios = [];
    window.Audio = function (...a) { const made = new Orig(...a); window.__audios.push(made); return made; };
    window.Audio.prototype = Orig.prototype;
  })();
`;

const barSounding = (page) => page.evaluate(() => (window.__audios ?? []).some((a) => !a.paused && a.currentSrc.includes('/api/web/audio/')));

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

async function newPage(browser, { failFiles = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    live += 1;
    return route.abort();
  });
  // The bar's files: a tone for each (the redirect to the Archive is the server's; the sound is all the drive needs).
  await context.route(/\/api\/web\/audio\/internet_archive\/[^/]+\/\d+$/, (route) => route.fulfill({ status: 200, body: TONE, headers: { 'Content-Type': 'audio/wav' } }));
  if (failFiles) {
    await context.route(/\/api\/web\/audio\/internet_archive\/[^/]+$/, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: 'No playable file.' }), headers: { 'Content-Type': 'application/json' } }),
    );
  } else {
    await context.route(/\/api\/web\/audio\/internet_archive\/[^/]+$/, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ title: 'A real recording', creator: 'Mock', files: [{ title: 'One', seconds: 2 }] }), headers: { 'Content-Type': 'application/json' } }),
    );
  }
  await context.addInitScript(KEEP_AUDIO);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('debaser.audio.love-buzz.v1', 'skipped');
      sessionStorage.setItem('debaser.audio.love-buzz.v1', 'skipped');
    } catch {}
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  return { context, page, liveHits: () => live };
}

const audioRow = (page) => page.locator('li').filter({ hasText: 'a real recording' }).filter({ hasText: 'AUDIO' }).first();
// A YouTube row: its player in your room takes orders (a site's embed with no player to ask cannot be paused by anyone).
const videoRow = (page) => page.locator('li').filter({ hasText: 'a real YouTube video' }).filter({ hasText: '▶ PLAY' }).first();
const archivePlayerInList = (page) => page.evaluate(() => [...document.querySelectorAll('li iframe, li [data-player-box]')].length + document.querySelectorAll('iframe[src*="archive.org/embed"]').length);

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output', '--no-first-run'] });
  try {
    if (!args.includes('--no-file-only')) await oneAtATime(browser);
    await noFile(browser);
  } finally {
    await browser.close();
  }
  console.log(`DRIVE PASSED: ${passed} steps`);
})().catch((error) => {
  console.error(`DRIVE FAILED after ${passed} steps:`, error.message);
  process.exit(1);
});

async function oneAtATime(browser) {
  {
    console.log('one thing at a time');
    const { context, page, liveHits } = await newPage(browser);
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await audioRow(page).waitFor({ timeout: 90000 });
    await sleep(1500);
    await audioRow(page).getByRole('button', { name: /in the music player/ }).click();
    await until('the bar plays the Archive audio', () => barSounding(page), (v) => v === true, 15000);
    assert.equal(await archivePlayerInList(page), 0, "no Archive player opened in the list");
    pass("an Archive audio row's PLAY plays in the music bar, nothing opens in the list");

    await videoRow(page).getByRole('button', { name: /^Play "/ }).click();
    await page.waitForSelector('[data-stream-bar-screen], [data-watch-window], [data-dock-window="stream"]', { timeout: 30000 });
    await until("the bar's audio pauses for the video", () => barSounding(page), (v) => v === false, 8000);
    await until(
      "the room's YouTube video plays",
      () => page.evaluate(() => [...document.querySelectorAll('[data-watch-bar="music"] button')].map((b) => b.getAttribute('aria-label') ?? b.innerText).join(' | ')),
      (k) => /Pause/.test(k),
      30000,
    );
    pass("a video's PLAY (in your room): the bar's audio pauses");
    await page.screenshot({ path: join(OUT, 'video-on.png') });

    // The other way round: the room folded away to get at the list (it plays on), then the audio row's PLAY again.
    await page.locator('[data-dock-window="stream"] button', { hasText: '[ _ ]' }).first().click();
    await sleep(800);
    await audioRow(page).getByRole('button', { name: /in the music player/ }).click();
    await until('the bar plays again', () => barSounding(page), (v) => v === true, 10000).catch(async (error) => {
      console.log('  ..  row:', (await audioRow(page).innerText()).replace(/\s+/g, ' ').slice(0, 200));
      console.log('  ..  bar:', await page.evaluate(() => (document.querySelector('[data-stream-bar], [data-bar-led]')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200)));
      console.log('  ..  audios:', JSON.stringify(await page.evaluate(() => (window.__audios ?? []).map((a) => ({ src: a.currentSrc.slice(-40), paused: a.paused, err: a.error?.code ?? null })))));
      await page.screenshot({ path: join(OUT, 'again-failed.png') });
      throw error;
    });
    // The room's own play key reads the room's state: playing shows ❚❚, paused shows ▶.
    const roomKey = await until(
      "the room's video gives way",
      () => page.evaluate(() => {
        const keys = [...document.querySelectorAll('[data-watch-bar="music"] button')].map((b) => (b.getAttribute('aria-label') ?? b.innerText).replace(/\s+/g, ' '));
        return keys.join(' | ');
      }),
      (k) => /\bPlay\b|▶ \]|\[ ▶/.test(k) && !/Pause|❚❚/.test(k),
      12000,
    );
    assert.equal(await barSounding(page), true, 'and the bar plays on');
    pass(`the audio's PLAY over the room's video: the video pauses (room keys: ${roomKey.slice(0, 90)})`);
    assert.equal(liveHits(), 0, 'nothing reached the live database');
    await context.close();
  }
}

async function noFile(browser) {
  {
    console.log('an audio row whose files cannot be found');
    const failing = await newPage(browser, { failFiles: true });
    await failing.page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await audioRow(failing.page).waitFor({ timeout: 90000 });
    await sleep(1500);
    await audioRow(failing.page).getByRole('button', { name: /in the music player/ }).click();
    await until('the row says so', () => audioRow(failing.page).innerText(), (t) => /NO PLAYABLE FILE/.test(t), 10000);
    assert.equal(await archivePlayerInList(failing.page), 0, "the Archive's player never opens in the list");
    assert.equal(await barSounding(failing.page), false);
    const out = await audioRow(failing.page).locator('a[data-bar-play-elsewhere]').getAttribute('href');
    assert.match(out ?? '', /^https:\/\/archive\.org\/details\//, "and offers the Archive's own page");
    pass(`no file: the row says NO PLAYABLE FILE and offers the Archive's page (${out}), no player in the list`);
    await audioRow(failing.page).screenshot({ path: join(OUT, 'no-file.png') });
    await failing.context.close();
  }
}
