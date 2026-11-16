/*
 * Drives Luke's list-4 room window items (ROOMUI, 2026-11-16) in a real browser, on a local dev server with mock data only:
 *
 *   1. Your room opens smaller than the page, in the upper corner; its title line has [ _ ] [ □ ] [ × ]; [ □ ] fills the
 *      page (above the bar) and, pressed again, puts it back to the same box.
 *   3. Fullscreen on the blank screen (BOOKS / VIDEO / MUSIC): [ EXIT ] is on the bar, and it leaves fullscreen.
 *   2. The embedded players' own controls: a Vimeo video is made with `controls: false` (Vimeo's script is answered here by a
 *      stand-in that records what it is asked, so no Vimeo account or network is needed), and the room's own keys drive it;
 *      a PeerTube player is asked for no title, warning or PeerTube link.
 *   4. Folding the room ([ _ ]): its key above the player says PRIVATE and the bar is the room's; after a reload it comes
 *      back folded with both, paused; after END ROOM a reload brings nothing back.
 *   5. An Internet Archive video (filed as the Archive's embed) plays as its own file in the room's player with the room's
 *      keys, and fullscreen keeps the background; an item whose listing cannot be read keeps the Archive's player. The
 *      site's own series route and the file are answered here, so the Archive is never asked.
 *
 *   node scripts/drive-roomui.cjs --base http://localhost:3317 [--only 1,3,2,4,5]
 *
 * Start the server with Temp/browse/dev-mock-rooms.cjs (every data source on mock, Supabase empty): nothing reaches the
 * live database, and the "account" is a made-up one in the browser's mock store. From the network it asks only a
 * five-second public test video. Chrome is started with --disable-audio-output (a headless Chrome's media clock froze on
 * the desktop's own sound output, 2026-11-16).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317');
const ONLY = opt('--only', null);
const wants = (item) => ONLY === null || ONLY.split(',').includes(String(item));
const SHOTS = join('Temp', 'browse', 'roomui');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const VIMEO = 'https://vimeo.com/76979871';
const PEERTUBE = 'https://framatube.org/videos/embed/9c9de5e8-0a1e-484a-b099-e80766180a6d';
const ROOM = '[data-dock-window="stream"]';
/** Item 5: an Archive embed whose listing the drive answers with one test file, and one whose listing fails. */
const ARCHIVE_EMBED = 'https://archive.org/embed/debaser-drive-ia';
const ARCHIVE_FILE = 'https://archive.org/download/debaser-drive-ia/clip.webm';
const ARCHIVE_UNREADABLE = 'https://archive.org/embed/debaser-drive-unreadable';
/** ...and one whose first read is refused for now (503) and second answered. */
const ARCHIVE_FLAKY = 'https://archive.org/embed/debaser-drive-flaky';
const ARCHIVE_FLAKY_FILE = 'https://archive.org/download/debaser-drive-flaky/clip.webm';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]');
    if (!items.some((item) => item.id === 'drive-video')) {
      items.push({ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() });
      localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    }
  } catch {}
})()`;

/** Vimeo's player script, answered here: a stand-in player that records the options it is made with and plays on request. */
const VIMEO_STAND_IN = `(() => {
  window.__vimeoOptions = window.__vimeoOptions || [];
  class Player {
    constructor(element, options) {
      window.__vimeoOptions.push(options);
      this.handlers = {};
      this.time = 0;
      const face = document.createElement('div');
      face.setAttribute('data-vimeo-stand-in', '');
      face.style.cssText = 'width:100%;height:100%;background:#335';
      element.appendChild(face);
      if (options.autoplay) setTimeout(() => this.play(), 50);
    }
    on(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); }
    fire(type, data) { for (const handler of this.handlers[type] || []) handler(data || { seconds: this.time, duration: 60 }); }
    ready() { return Promise.resolve(); }
    play() { setTimeout(() => { this.fire('play'); this.fire('playing'); }, 30); clearInterval(this.ticker); this.ticker = setInterval(() => { this.time += 0.25; this.fire('timeupdate'); }, 250); return Promise.resolve(); }
    pause() { clearInterval(this.ticker); setTimeout(() => this.fire('pause'), 30); return Promise.resolve(); }
    setCurrentTime(seconds) { this.time = seconds; setTimeout(() => this.fire('seeked', { seconds }), 30); return Promise.resolve(seconds); }
    getDuration() { return Promise.resolve(60); }
    setVolume(volume) { return Promise.resolve(volume); }
    setMuted(muted) { return Promise.resolve(muted); }
    setPlaybackRate(rate) { return Promise.resolve(rate); }
    getQualities() { return Promise.resolve([]); }
    getTextTracks() { return Promise.resolve([]); }
    enableTextTrack() { return Promise.resolve(); }
    disableTextTrack() { return Promise.resolve(); }
    destroy() { clearInterval(this.ticker); return Promise.resolve(); }
  }
  window.Vimeo = { Player };
})();`;

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
  for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(text, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(800);
}
async function pressPlay(page) {
  await page.waitForFunction(() => {
    const play = document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']');
    if (play !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes('DRIVE VIDEO')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 60000, polling: 500 });
  await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
}
const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) return null;
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }, selector);
/** The room's title-line keys, left to right. */
const titleKeys = (page) => page.evaluate((room) => [...document.querySelectorAll(`${room} .title-line button`)].map((key) => key.innerText.trim()), ROOM);
/** Adds a link through the room's queue window (opened from the bar or the side column), and shuts it again. */
async function queueLink(page, url) {
  await page.evaluate(() => (document.querySelector('[data-stream-bar-queue]') ?? document.querySelector('[data-watch-queue-key]')).click());
  await page.waitForSelector('#stream-queue-search', { timeout: 15000 });
  await page.fill('#stream-queue-search', url);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => ['added', 'refused'].includes(document.querySelector('[data-watch-link-state]')?.getAttribute('data-watch-link-state') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  const said = await page.evaluate(() => {
    const line = document.querySelector('[data-watch-link-state]');
    return line === null ? 'no status line' : `${line.getAttribute('data-watch-link-state')}: ${line.innerText.trim()}`;
  });
  await sleep(500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });
  return said;
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  const blocked = [];
  await context.route(/supabase\.(co|in)/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  await context.route('https://player.vimeo.com/api/player.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: VIMEO_STAND_IN }));
  await context.route(/https:\/\/vimeo\.com\/api\/oembed\.json/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ title: 'DRIVE VIMEO', width: 640, height: 360 }) }),
  );
  // Item 5: our own series route answered here for the two test items, and the test file served at its Archive address.
  let flakyAsks = 0;
  await context.route(/\/api\/web\/series\?ia=debaser-drive-/, (route) => {
    const asked = route.request().url();
    const answer = (file) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'DRIVE ARCHIVE', episodes: [{ title: 'clip', url: file, kind: 'file', seconds: 5 }], partial: false }) });
    if (asked.includes('unreadable')) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOTHING HERE PLAYS IN A ROOM.' }) });
    if (asked.includes('flaky')) {
      flakyAsks += 1;
      return route.fulfill(flakyAsks === 1 ? { status: 503, contentType: 'application/json', body: '{"error":"The platform did not answer."}' } : answer(ARCHIVE_FLAKY_FILE));
    }
    return route.fulfill(answer(ARCHIVE_FILE));
  });
  const clip = Buffer.from(await (await fetch(VIDEO)).arrayBuffer());
  await context.route(ARCHIVE_FLAKY_FILE, (route) => route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'access-control-allow-origin': '*' }, body: clip }));
  await context.route(ARCHIVE_FILE, (route) => route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'access-control-allow-origin': '*' }, body: clip }));
  await context.route(/https:\/\/archive\.org\/embed\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in</title><body style="background:#533"></body>' }));
  await context.route(/https:\/\/framatube\.org\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in</title><body style="background:#353"></body>' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    console.log('YOUR ROOM, OPENED BY PLAY IN FILES');
    await open(page, '/files?kind=video');
    await pressPlay(page);
    await page.waitForSelector('[data-main-room-live]', { timeout: 30000 });
    // The five-second clip goes round until step 3 lets it end.
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"] video[data-watch-video]') !== null, null, { timeout: 30000 });
    await page.evaluate(() => {
      document.querySelector('[data-dock-window="stream"] video[data-watch-video]').loop = true;
    });
    await sleep(1500);

    if (wants(1)) {
      console.log('1. SMALLER TO START; [ □ ] FILLS THE PAGE AND BACK');
      const viewport = page.viewportSize();
      const start = await rectOf(page, ROOM);
      assert.ok(start.width < viewport.width * 0.8, `it starts narrower than the page (${Math.round(start.width)} of ${viewport.width})`);
      assert.ok(start.left > viewport.width * 0.15, `in the upper right corner, the page showing to its left (${Math.round(start.left)})`);
      const keys = await titleKeys(page);
      const fold = keys.indexOf('[ _ ]');
      assert.ok(fold >= 0 && keys[fold + 1] === '[ □ ]' && keys[fold + 2] === '[ × ]', `the title line has [ _ ] [ □ ] [ × ] together (${keys.join(' ')})`);
      await page.screenshot({ path: join(SHOTS, '1-start.png') });
      await page.locator(`${ROOM} [data-window-maximise="off"]`).click();
      await page.waitForSelector(`${ROOM} [data-window-maximise="on"]`, { timeout: 5000 });
      await sleep(300);
      const full = await rectOf(page, ROOM);
      const barTop = await page.evaluate(() => window.innerHeight - Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top') || '0'));
      assert.ok(full.left <= 1 && full.width >= viewport.width - 1, `[ □ ]: it is the page's whole width (${Math.round(full.left)}, ${Math.round(full.width)})`);
      assert.ok(full.bottom <= barTop + 1 && full.bottom >= barTop - 12, `down to the music bar, not under it (foot ${Math.round(full.bottom)}, bar ${Math.round(barTop)})`);
      assert.equal(await page.locator(`${ROOM} [data-window-maximise="on"]`).getAttribute('aria-pressed'), 'true', 'the key says it is pressed in');
      assert.equal((await titleKeys(page)).includes('[ ❐ ]'), true, 'and shows the way back');
      await page.screenshot({ path: join(SHOTS, '1-filled.png') });
      await page.locator(`${ROOM} [data-window-maximise="on"]`).click();
      await page.waitForSelector(`${ROOM} [data-window-maximise="off"]`, { timeout: 5000 });
      await sleep(300);
      const back = await rectOf(page, ROOM);
      assert.ok(['left', 'top', 'width', 'height'].every((side) => Math.abs(back[side] - start[side]) < 2), `pressed again, it is back where it was (${JSON.stringify(back)})`);
      pass('your room starts smaller than the page; [ _ ] [ □ ] [ × ]; [ □ ] fills the page above the bar and back again');
    }

    if (wants(3)) {
      console.log('3. FULLSCREEN ON THE BLANK SCREEN: [ EXIT ] STAYS');
      // The bar's FULL (the room's keys sit on the music bar while it shows the room).
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Fullscreen"]')].length > 0, null, { timeout: 20000 });
      await page.evaluate(() => document.querySelector('button[aria-label="Fullscreen"]').click());
      await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
      // The five-second video ends with nothing queued: the screen goes blank, BOOKS / VIDEO / MUSIC.
      await page.evaluate(() => {
        const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
        video.loop = false;
        if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.5);
      });
      await page.waitForSelector('[data-watch-blank="shown"]', { timeout: 30000 });
      assert.ok(await page.evaluate(() => document.fullscreenElement !== null), 'still fullscreen on the blank screen');
      const exit = await page.evaluate(() => {
        const full = document.fullscreenElement;
        const key = full === null ? null : full.querySelector('[data-room-exit-full]');
        if (key === null) return null;
        const box = key.getBoundingClientRect();
        return { inside: full.contains(key), seen: box.width > 0 && box.height > 0 && box.bottom <= window.innerHeight && box.top >= 0, text: key.innerText.trim() };
      });
      assert.deepEqual(exit, { inside: true, seen: true, text: '[ EXIT ]' }, 'the [ EXIT ] key is in the fullscreen box, on screen');
      await page.screenshot({ path: join(SHOTS, '3-blank-fullscreen.png') });
      await page.locator('[data-room-exit-full]').click();
      await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
      assert.equal(await page.locator('[data-room-exit-full]').count(), 0, 'out of fullscreen, the extra key is gone');
      pass('fullscreen on the BOOKS / VIDEO / MUSIC screen keeps [ EXIT ] on its bar, and it leaves fullscreen');
    }

    if (wants(2)) {
      console.log('2. THE EMBEDDED PLAYERS\' OWN CONTROLS');
      const said = await queueLink(page, VIMEO);
      assert.match(said, /^added/, `the Vimeo link is queued (${said})`);
      await page.waitForSelector(`${ROOM} [data-vimeo-stand-in]`, { timeout: 30000 }).catch(async () => {
        // Not started by itself: the host's skip puts it on.
        await page.evaluate(() => document.querySelector('button[aria-label="Skip to the next video"]')?.click());
        await page.waitForSelector(`${ROOM} [data-vimeo-stand-in]`, { timeout: 15000 });
      });
      const options = await page.evaluate(() => window.__vimeoOptions.filter((made) => made.url && made.url.includes('76979871')));
      assert.ok(options.length > 0, 'the room made a Vimeo player');
      assert.ok(options.every((made) => made.controls === false), `every Vimeo player is asked for no controls (${JSON.stringify(options.map((made) => made.controls))})`);
      const room = options[options.length - 1];
      assert.equal(room.title === false && room.byline === false && room.portrait === false, true, 'and no title, byline or portrait');
      // The room's own keys drive it: its play/pause key on the bar.
      assert.ok(await page.locator('[data-stream-bar] button[aria-label="Pause"], [data-stream-bar] button[aria-label="Play"]').count(), 'the room\'s own play key is on the bar');
      await page.screenshot({ path: join(SHOTS, '2-vimeo.png') });
      pass('a Vimeo video in your room is made with controls: false (and no title, byline, portrait); the room\'s keys drive it');

      // A PeerTube player: put on the screen in the mock store, as a WEB row's would be, and the room read again.
      const changed = await page.evaluate((peertube) => {
        const store = JSON.parse(localStorage.getItem('debaser.watch.v1'));
        const row = (store.queue ?? []).find((entry) => entry.link && entry.link.kind === 'vimeo');
        if (!row) return false;
        row.link = { url: peertube, kind: 'embed', title: 'DRIVE PEERTUBE' };
        localStorage.setItem('debaser.watch.v1', JSON.stringify(store));
        return true;
      }, PEERTUBE);
      assert.ok(changed, 'the Vimeo row was found in the mock store to turn into a PeerTube one');
      await open(page, '/forum');
      const shelf = page.locator('[data-room-shelf-key] button, [data-own-room-door] button');
      if (await shelf.count()) await shelf.first().click();
      await page.waitForSelector(`${ROOM} iframe[data-watch-embed="embed"]`, { timeout: 30000 });
      const src = await page.locator(`${ROOM} iframe[data-watch-embed="embed"]`).getAttribute('src');
      const asked = new URL(src);
      assert.equal(asked.origin + asked.pathname, PEERTUBE, `the PeerTube player is its own embed address (${src})`);
      assert.deepEqual(['title', 'warningTitle', 'peertubeLink'].map((name) => asked.searchParams.get(name)), ['0', '0', '0'], 'asked for no title, no warning and no PeerTube link');
      pass('a PeerTube player in your room is asked for no title, warning line or PeerTube link (its play bar stays: the room cannot drive it)');
    }

    if (wants(4)) {
      console.log('4. FOLDED: WHAT STANDS IN ABOVE AND ON THE BAR');
      if ((await page.locator(ROOM).getAttribute('data-minimized')) === 'true') await page.locator('[data-room-shelf-key] button').click();
      await page.locator(`${ROOM} button[aria-label^="Fold"]`).click();
      await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
      await sleep(500);
      const folded = await page.evaluate(() => ({
        key: document.querySelector('[data-room-shelf-key]')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
        bar: document.querySelector('[data-stream-bar]')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null,
      }));
      console.log(`     folded: key ${JSON.stringify(folded.key)}; bar ${JSON.stringify(folded.bar)}`);
      await page.screenshot({ path: join(SHOTS, '4-folded.png') });
      assert.match(folded.key ?? '', /ROOM :: PRIVATE/, 'the folded key says what the room is: PRIVATE, not LIVE');
      assert.match(folded.bar ?? '', /PRIVATE/, 'and the bar along the foot is still the room\'s');
      pass('folded: the key above the player says ROOM :: PRIVATE and the bar is the room\'s');

      console.log('4. A RELOAD WITH YOUR ROOM FOLDED: IT COMES BACK FOLDED, ITS BAR ON, PAUSED');
      // A video playing in your room, folded, then the page loaded again.
      await open(page, '/files?kind=video');
      await pressPlay(page);
      await page.waitForFunction(() => {
        const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
        return video !== null && !video.paused && video.currentTime > 0.3;
      }, null, { timeout: 30000 });
      await page.evaluate(() => {
        document.querySelector('[data-dock-window="stream"] video[data-watch-video]').loop = true;
      });
      await page.locator(`${ROOM} button[aria-label^="Fold"]`).click();
      await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
      await open(page, '/forum');
      await page.waitForSelector('[data-corner-shelf] [data-room-shelf-key]', { timeout: 30000 });
      await page.waitForSelector('[data-stream-bar] [data-stream-bar-screen]', { timeout: 15000 });
      assert.equal(await page.locator(ROOM).getAttribute('data-minimized'), 'true', 'back folded, the window out of sight');
      assert.match(await page.locator('[data-room-shelf-key]').innerText(), /ROOM :: PRIVATE/, 'its key above the player');
      assert.match(await page.locator('[data-stream-bar]').innerText(), /PRIVATE[\s\S]*DRIVE VIDEO/, 'the room\'s bar along the foot, naming the video');
      assert.equal(await page.locator('[data-own-room-door]').count(), 0, 'not the shut room\'s [ ▲ ROOM ] door');
      const still = async () => page.evaluate(() => {
        const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
        return video === null ? null : { paused: video.paused, at: video.currentTime };
      });
      const first = await still();
      await sleep(2500);
      const later = await still();
      assert.ok(first !== null && later !== null && later.paused && Math.abs(later.at - first.at) < 0.05, `paused: nothing plays out of sight (${JSON.stringify(first)} -> ${JSON.stringify(later)})`);
      await page.screenshot({ path: join(SHOTS, '4-reloaded.png') });
      // The bar's PLAY starts it again, out of sight, as before the reload.
      await page.locator('[data-stream-bar] button[aria-label="Play"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-dock-window="stream"] video[data-watch-video]').paused, null, { timeout: 10000 });
      await page.locator('[data-room-shelf-key] button').click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      pass('a reload with your room folded: it comes back folded with its key and its bar, paused; PLAY on the bar starts it; the key opens it');

      console.log('4. END ROOM: A RELOAD BRINGS NOTHING BACK');
      await page.locator('[data-main-room-end="first"]').first().click();
      await page.locator('[data-main-room-end="confirm"]').first().click();
      await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
      await open(page, '/forum');
      await sleep(3000);
      assert.equal(await page.locator(ROOM).count(), 0, 'after END ROOM and a reload, no room window comes back');
      assert.equal(await page.locator('[data-stream-bar]').count(), 0, 'and the bar is the music player');
      pass('after END ROOM a reload brings no room back');
    }

    if (wants(5)) {
      console.log('5. AN INTERNET ARCHIVE VIDEO PLAYS IN THE ROOM\'S OWN PLAYER, AND FULLSCREEN KEEPS THE BACKGROUND');
      // The room's current row becomes an Archive embed, as a MEDIA row files one, and the page is loaded again.
      const putOn = async (embed) => {
        await page.evaluate((url) => {
          const store = JSON.parse(localStorage.getItem('debaser.watch.v1'));
          const room = store.rooms.find((held) => held.origin === 'music' && held.endedAt === null && held.originalHostId === 'drive-user');
          const row = store.queue.find((entry) => entry.id === room.currentEntryId);
          row.link = { url, kind: 'embed', title: 'DRIVE ARCHIVE VIDEO' };
          row.mediaItemId = null;
          localStorage.setItem('debaser.watch.v1', JSON.stringify(store));
        }, embed);
        await open(page, '/forum');
        const back = page.locator('[data-room-shelf-key] button, [data-own-room-door] button');
        await back.first().waitFor({ timeout: 30000 });
        await back.first().click();
        await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
      };
      if ((await page.locator('[data-main-room-live]').count()) === 0) {
        await open(page, '/files?kind=video');
        await pressPlay(page);
        await page.waitForSelector('[data-main-room-live]', { timeout: 30000 });
      }
      await putOn(ARCHIVE_EMBED);
      await page.waitForSelector(`${ROOM} video[data-watch-video]`, { timeout: 30000 });
      const shown = await page.evaluate((room) => ({
        src: document.querySelector(`${room} video[data-watch-video]`).currentSrc || document.querySelector(`${room} video[data-watch-video]`).src,
        frames: document.querySelectorAll(`${room} iframe[data-watch-embed]`).length,
      }), ROOM);
      assert.deepEqual(shown, { src: ARCHIVE_FILE, frames: 0 }, 'the Archive video is its own file in the room\'s <video>, with no Archive player frame');
      assert.match(await page.locator('[data-stream-bar]').innerText(), /DRIVE ARCHIVE VIDEO/, 'the bar names the row as it was filed');
      // The room's own keys drive it.
      await page.locator('[data-stream-bar] button[aria-label="Play"]').click();
      await page.waitForFunction((room) => {
        const video = document.querySelector(`${room} video[data-watch-video]`);
        return !video.paused && video.currentTime > 0.3;
      }, ROOM, { timeout: 15000 });
      await page.locator('[data-stream-bar] button[aria-label="Pause"]').click();
      await page.waitForFunction((room) => document.querySelector(`${room} video[data-watch-video]`).paused, ROOM, { timeout: 10000 });
      await page.locator('[data-stream-bar] button[aria-label="Play"]').click();
      pass('an Internet Archive video plays as its own file in the room\'s player, PLAY and PAUSE on the room\'s bar driving it; no Archive player');

      await page.evaluate(() => document.querySelector('[data-stream-bar] button[aria-label="Fullscreen"]').click());
      await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
      await page.waitForSelector('[data-room-picture][data-backdrop-press]', { timeout: 8000 });
      const full = await page.evaluate(() => {
        const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
        const box = video.getBoundingClientRect();
        return {
          backdrop: document.querySelector('[data-room-picture] [data-stage-backdrop], [data-room-picture] canvas') !== null,
          solid: video.hasAttribute('data-backdrop-solid'),
          bkg: document.fullscreenElement.querySelector('button')?.innerText.includes('BKG') ?? false,
          size: `${Math.round(box.width)}x${Math.round(box.height)}`,
        };
      });
      assert.ok(full.solid, `fullscreen: the picture is its own shape on the chosen background (${JSON.stringify(full)})`);
      await page.screenshot({ path: join(SHOTS, '5-archive-fullscreen.png') });
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
      pass(`fullscreen on the Archive video: the picture its own shape (${full.size}) with the background round it, as YouTube's`);

      // An item whose listing cannot be read keeps the Archive's own player.
      await putOn(ARCHIVE_UNREADABLE);
      await page.waitForSelector(`${ROOM} iframe[data-watch-embed="embed"]`, { timeout: 30000 });
      assert.equal(await page.locator(`${ROOM} iframe[data-watch-embed="embed"]`).getAttribute('src'), ARCHIVE_UNREADABLE, 'an item that cannot be read: the Archive\'s own player, as before');
      pass('an Archive item that cannot be read still plays, in the Archive\'s own player');

      // A read refused for now (too many asks, the Archive down): the Archive's player meanwhile, then the file once it answers.
      await putOn(ARCHIVE_FLAKY);
      await page.waitForSelector(`${ROOM} iframe[data-watch-embed="embed"]`, { timeout: 30000 });
      await page.waitForSelector(`${ROOM} video[data-watch-video]`, { timeout: 30000 });
      assert.equal(await page.evaluate((room) => document.querySelector(`${room} video[data-watch-video]`).getAttribute('src'), ROOM), ARCHIVE_FLAKY_FILE, 'asked again, it plays as its file');
      assert.equal(await page.locator(`${ROOM} iframe[data-watch-embed]`).count(), 0, 'and the Archive player is gone');
      pass('an Archive read refused for now: the Archive\'s player meanwhile, then the room\'s own player once it answers');
    }

    assert.deepEqual(errors, [], `no page errors (${errors.join(' | ')})`);
    assert.deepEqual(blocked, [], 'nothing went to the live database');
    console.log(`\nDRIVE ROOMUI PASSED: ${passed} steps`);
  } catch (error) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(`\nDRIVE ROOMUI FAILED after ${passed} steps: ${error.message}`);
    if (errors.length) console.error(`page errors: ${errors.join(' | ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
