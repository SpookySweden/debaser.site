/*
 * The room's FULL key (Luke, 2026-11-27: "we also need to address a bug with the fullscreen room button, it dissapears when
 * watching dolphin media and it can also be present without any video causing you to fullscreen the site instead of the video").
 *
 * In a real browser, on your own room's window, it puts on in turn: a video file in the room's own player, LUKE'S SERVER's player
 * (Jellyfin, stood in for by a page the drive answers) without its remote, the same with its remote saying hello, and nothing at all.
 * For each it says whether the FULL key is there, and where it is there it presses it and says what went fullscreen: the room's
 * picture, never the whole page. Then it folds the room away (its keys go to the music bar): FULL there opens the room and fills the screen with its picture in one press (Luke, "Open room + fullscreen"), and when the browser refuses, the room is open and FULL waits for a second press: the page itself never goes fullscreen.
 *
 *   node scripts/drive-room-fullscreen.cjs --base http://localhost:3321
 *
 * Start the server with every data source on mock and Supabase EMPTY (`node scripts/dev-mock-live.cjs 3321`), so nothing reaches
 * the live database. It signs nobody up: the "account" is a made-up one in the browser's mock store. No outside site is asked for
 * anything: the test sound and the stand-in server page are answered by the drive itself.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3321';
const SHOTS = join('Temp', 'browse', 'room-fullscreen');
mkdirSync(SHOTS, { recursive: true });

/** A quiet tone as a WAV file (8 kHz, 8-bit mono), long enough to still be playing while the drive looks. */
function tone(seconds, pitch) {
  const rate = 8000;
  const samples = rate * seconds;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  const body = Buffer.alloc(samples);
  for (let i = 0; i < samples; i += 1) body[i] = 128 + Math.round(6 * Math.sin((2 * Math.PI * pitch * i) / rate));
  return Buffer.concat([header, body]);
}
const LONG = tone(180, 220);
const SOUND = 'https://drive-media.example.org/room-fullscreen';

/**
 * LUKE'S SERVER's player page, stood in for. `hello` makes it speak as the bridge's remote script does (`jellyfin-player.ts`), with no
 * film started yet; without it, it is a server whose page never says it can be driven (the remote switched off, or not loaded yet).
 */
const serverPage = (hello) => `<!doctype html><html><body style="margin:0;background:#101820;color:#ddd;font:16px sans-serif">
<p style="padding:8px">STAND-IN SERVER PAGE ${hello ? '(REMOTE ON)' : '(NO REMOTE)'}</p>
${hello ? `<script>
const say = (event) => parent.postMessage({ debaser: 'debaser-jellyfin', event, ready: false, time: 0, duration: 0, paused: true, ended: false }, '*');
say('hello');
addEventListener('message', () => say('state'));
</script>` : ''}
</body></html>`;

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
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => !String(held.id).startsWith('room-full-'));
    items.push({ id: 'room-full-1', kind: 'video', bucket: '', path: '', src: '${SOUND}/one.wav', sha256: 'room-full-1', bytes: 1, mime: 'video/webm', length: '3:00', title: 'ROOM FULL ONE', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() });
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
  } catch {}
})()`;

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await page.mouse.move(400, 300);
  await sleep(800);
}
async function pressPlay(page, title) {
  await page.waitForFunction((wanted) => {
    const play = document.querySelector(`button[aria-label='Play "${wanted}" here']`);
    if (play !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes(wanted)) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, title, { timeout: 60000, polling: 500 });
  await page.evaluate((wanted) => document.querySelector(`button[aria-label='Play "${wanted}" here']`).click(), title);
}

/** Puts `link` on now in your room (null: nothing on), as KINO's WATCH key or the queue would, then reloads. */
async function putOn(page, link) {
  await page.evaluate((wanted) => {
    const tables = JSON.parse(localStorage.getItem('debaser.watch.v1'));
    const room = tables.rooms.find((held) => held.origin === 'music' && held.endedAt === null);
    const at = new Date().toISOString();
    if (wanted === null) {
      for (const row of tables.queue) if (row.roomId === room.id) row.inQueue = false;
      Object.assign(room, { currentEntryId: null, positionSeconds: 0, isPlaying: false, updatedAt: at });
    } else {
      const id = crypto.randomUUID();
      tables.queue.push({ id, roomId: room.id, position: 99, inQueue: true, mediaItemId: null, link: wanted, series: null, addedBy: room.hostId, addedAt: at, playedAt: at, playIndex: 9 });
      Object.assign(room, { currentEntryId: id, positionSeconds: 0, isPlaying: false, updatedAt: at });
    }
    localStorage.setItem('debaser.watch.v1', JSON.stringify(tables));
  }, link);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-dock-window="stream"]', { timeout: 60000 });
  await page.mouse.move(500, 300);
  await sleep(2500);
}

/** The FULL keys showing in the room (its own bar, the picture's keys, and the music bar), not counting the way out of a fullscreen. */
const fullKeys = (page) => page.evaluate(() => [...document.querySelectorAll('[data-room-full="enter"]')].filter((key) => key.getClientRects().length > 0).length);

/** Presses the first FULL key, then says what went fullscreen, and comes back out. */
async function pressFull(page, what) {
  await page.locator('[data-room-full="enter"]').first().click();
  await sleep(800);
  const full = await page.evaluate(() => {
    const box = document.fullscreenElement;
    if (box === null) return { none: true };
    return {
      root: box === document.documentElement || box === document.body,
      inRoom: box.closest('[data-dock-window="stream"]') !== null,
      seen: window.getComputedStyle(box).visibility,
      holds: box.querySelector('video, iframe') !== null,
    };
  });
  await page.screenshot({ path: join(SHOTS, `${what.replace(/[^a-z]+/gi, '-')}.png`) });
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await sleep(500);
  return full;
}
function assertPlayerFull(full, what) {
  assert.ok(!full.none, `${what}: FULL put something fullscreen`);
  assert.ok(!full.root, `${what}: FULL never puts the whole page fullscreen`);
  assert.ok(full.inRoom, `${what}: what went fullscreen is the room's picture`);
  assert.equal(full.seen, 'visible', `${what}: and it can be seen`);
  assert.ok(full.holds, `${what}: and it holds the player`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => route.abort());
  await context.route(/drive-media\.example\.org/, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    if (range === null) return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body: LONG });
    const from = Number(range[1]);
    const to = range[2] === '' ? LONG.length - 1 : Math.min(Number(range[2]), LONG.length - 1);
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { ...headers, 'Content-Range': `bytes ${from}-${to}/${LONG.length}` }, body: LONG.subarray(from, to + 1) });
  });
  // Nothing goes to the real server: its player page is the drive's stand-in, with or without the remote.
  await context.route(/^https:\/\/media\.debaser\.site\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: serverPage(route.request().url().includes('/movie/2')) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failed = 0;
  const step = async (what, run) => {
    try {
      await run();
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${what}: ${error.message.split('\n')[0]}`);
    }
  };

  try {
    console.log('ROOM FULL KEY');
    await open(page, '/files?kind=video');
    await pressPlay(page, 'ROOM FULL ONE');
    await page.waitForSelector('[data-dock-window="stream"] video[data-watch-video]', { timeout: 30000 });
    await sleep(2000);

    await step('a video file', async () => {
      assert.ok((await fullKeys(page)) > 0, 'a video file in the room: the FULL key is there');
      pass('a video file in the room: the FULL key is there');
      assertPlayerFull(await pressFull(page, 'file'), 'a video file');
      pass('a video file: FULL fullscreens the room\'s picture, not the page');
    });

    await step("LUKE'S SERVER without its remote", async () => {
      await putOn(page, { url: 'https://media.debaser.site/debaser/play/movie/10378', kind: 'embed', title: 'SERVER FILM' });
      await page.waitForSelector('[data-dock-window="stream"] iframe[data-watch-embed="server"]', { timeout: 30000 });
      assert.equal(await page.locator('[data-server-remote="on"]').count(), 0, 'the stand-in server page never said hello');
      assert.ok((await fullKeys(page)) > 0, "LUKE'S SERVER's player, not driven: the FULL key is there");
      pass("LUKE'S SERVER's player, not driven: the FULL key is there");
      assertPlayerFull(await pressFull(page, 'server-no-remote'), "LUKE'S SERVER, not driven");
      pass("LUKE'S SERVER, not driven: FULL fullscreens the room's picture, not the page");
    });

    await step("LUKE'S SERVER with its remote", async () => {
      await putOn(page, { url: 'https://media.debaser.site/debaser/play/movie/2', kind: 'embed', title: 'SERVER FILM TWO' });
      await page.waitForSelector('[data-server-remote="on"]', { timeout: 30000 });
      assert.ok((await fullKeys(page)) > 0, "LUKE'S SERVER's player, driven: the FULL key is there");
      pass("LUKE'S SERVER's player, driven: the FULL key is there");
      assertPlayerFull(await pressFull(page, 'server-remote'), "LUKE'S SERVER, driven");
      pass("LUKE'S SERVER, driven: FULL fullscreens the room's picture, not the page");
    });

    await step('nothing on', async () => {
      await putOn(page, null);
      await page.waitForSelector('[data-dock-window="stream"]', { timeout: 30000 });
      assert.equal(await fullKeys(page), 0, 'nothing on: no FULL key');
      pass('nothing on: no FULL key');
    });

    // A video on again (a file link the drive answers), the room open, for the fold.
    await putOn(page, { url: `${SOUND}/two.webm`, kind: 'file', title: 'ROOM FULL TWO' });
    await page.waitForSelector('[data-dock-window="stream"] video[data-watch-video]', { timeout: 30000 });

    const fold = async () => {
      await page.locator('[data-dock-window="stream"] button[title^="Fold away"], [data-dock-window="stream"] button[aria-label^="Fold away"]').first().click();
      await sleep(1500);
      assert.equal(await page.locator('[data-dock-window="stream"][data-minimized="true"]').count(), 1, 'the room is folded away');
    };
    const roomOpen = () => page.evaluate(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true');

    // Luke, 2026-11-27, to "What should that FULL key do while the room is folded?": "Open room + fullscreen".
    await step('folded, FULL on the music bar', async () => {
      await fold();
      const onBar = await page.locator('[data-watch-bar="music"] [data-room-full="enter"]').count();
      assert.ok(onBar > 0, 'folded: FULL is on the music bar');
      pass('folded: FULL is on the music bar');
      await page.locator('[data-watch-bar="music"] [data-room-full="enter"]').first().click();
      await sleep(800);
      const full = await page.evaluate(() => {
        const box = document.fullscreenElement;
        if (box === null) return { none: true };
        return {
          root: box === document.documentElement || box === document.body,
          inRoom: box.closest('[data-dock-window="stream"]') !== null,
          seen: window.getComputedStyle(box).visibility,
          holds: box.querySelector('video, iframe') !== null,
        };
      });
      await page.screenshot({ path: join(SHOTS, 'folded-full.png') });
      assertPlayerFull(full, 'folded, FULL on the music bar');
      pass('one press: the room\'s picture fills the screen, seen, never the page');
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
      await sleep(800);
      assert.ok(await roomOpen(), 'out of fullscreen, the room is open');
      pass('out of fullscreen, the room window is open where it was');
    });

    await step('folded, the browser refuses the fullscreen', async () => {
      await fold();
      await page.evaluate(() => {
        window.__realFull = Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('refused by the drive'));
      });
      await page.locator('[data-watch-bar="music"] [data-room-full="enter"]').first().click();
      await sleep(1000);
      const after = await page.evaluate(() => ({ full: document.fullscreenElement === null ? null : document.fullscreenElement.tagName }));
      await page.evaluate(() => (Element.prototype.requestFullscreen = window.__realFull));
      assert.equal(after.full, null, 'refused: nothing is fullscreen, the page least of all');
      assert.ok(await roomOpen(), 'refused: the room is open all the same');
      assert.ok((await fullKeys(page)) > 0, 'refused: FULL is there to press again');
      pass('refused: the room opens, nothing goes fullscreen, FULL waits for a second press');
      assertPlayerFull(await pressFull(page, 'second-press'), 'the second press');
      pass('the second press fullscreens the room\'s picture');
    });

    assert.deepEqual(errors, [], `no errors on the page (${errors.join(' | ')})`);
  } finally {
    await browser.close();
  }
  console.log(`\nPASSED ${passed}${failed ? `, FAILED ${failed}` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
