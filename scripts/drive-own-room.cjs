/*
 * Drives your own room in a real browser (SPEC-rooms-queues.md, phase 1): the queue that survives a reload, the bar's
 * QUEUE key and window, a video taking its turn between songs, and a visitor's room kept in the browser. Not in
 * `npm run checks`: it needs a running site.
 *
 *   node scripts/drive-own-room.cjs --base http://localhost:3315
 *
 * For a local dev server on mock data only (start it with NEXT_PUBLIC_SUPABASE_URL empty, so nothing reaches the live
 * database). It signs nobody up: the "account" is a made-up one in the browser's mock store. The one thing it asks
 * of the network is a five-second public test video, for the step where a video takes its turn (`--no-video` skips it).
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

/**
 * A mock site has no songs on its shelf, so the drive brings three: quiet 45-second tones written into
 * `assets/audio/_drive/` (served by the site's own asset route, taken away again at the end) and listed in the mock
 * shelf's own store in the browser.
 */
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
  writeFileSync(join(DRIVE_AUDIO, 'picture.png'), Buffer.from(PICTURE_PNG, 'base64'));
}
/** A plain one-colour PNG of any size, made here: the drive's outside pictures (a good one, and one too wide to show). */
function pngOf(width, height) {
  const zlib = require('node:zlib');
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (bytes) => {
    let r = 0xffffffff;
    for (const byte of bytes) r = table[(r ^ byte) & 255] ^ (r >>> 8);
    return (r ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** An 8 by 8 one-colour PNG: the smallest picture a browser will draw. */
const PICTURE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGOoxwEYhpYEADfzX0Hh3xezAAAAAElFTkSuQmCC';
const SEED = `(() => {
  try {
    if (localStorage.getItem('debaser.media.items.v1') === null) {
      localStorage.setItem('debaser.media.items.v1', JSON.stringify([{ id: 'drive-picture-1', kind: 'image', bucket: '', path: '', src: '/assets/audio/_drive/picture.png', sha256: 'd'.repeat(64), bytes: 75, mime: 'image/png', width: 8, height: 8, length: '', title: 'DRIVE PICTURE', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }]));
    }
    if (localStorage.getItem('debaser.audio.mock.v1') !== null) return;
    const track = (n) => ({ id: 'drive-tone-' + n, title: 'DRIVE TONE ' + n, credit: 'THE DRIVE', kind: 'TEST', src: '/assets/audio/_drive/tone-' + n + '.wav', length: '0:45', tags: [], folderPath: null, shelf: 'bucket' });
    localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ tracks: [track(1), track(2), track(3)] }));
  } catch {}
})()`;

const audio = (page) =>
  page.evaluate(() => {
    const element = window.__audios[window.__audios.length - 1];
    return element ? { paused: element.paused, time: element.currentTime, src: new URL(element.src, location.href).pathname, ended: element.ended } : null;
  });

/** The rooms this browser's own store holds (the mock tables; a visitor's room lives there on the live site too). */
const tables = (page) =>
  page.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
    return kept.rooms
      .filter((room) => room.origin === 'music')
      .map((room) => {
        const rows = kept.queue.filter((entry) => entry.roomId === room.id);
        const on = rows.find((entry) => entry.id === room.currentEntryId);
        return {
          id: room.id,
          hostId: room.hostId,
          endedAt: room.endedAt,
          isPublic: room.isPublic,
          privacy: room.privacy,
          isPlaying: room.isPlaying,
          position: room.positionSeconds,
          updatedAt: room.updatedAt,
          on: on ? (on.link ? on.link.url : on.mediaItemId) : null,
          waiting: rows.filter((entry) => entry.playedAt === null).sort((a, b) => a.position - b.position).map((entry) => (entry.link ? entry.link.title : entry.mediaItemId)),
          played: rows.filter((entry) => entry.playedAt !== null).length,
        };
      });
  });

const barQueue = (page) => page.evaluate(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue') ?? -1));

async function pressTransport(page) {
  await page.evaluate(() => {
    // The pad is three keys in a row: previous, the one cell that shows the state, next.
    const previous = document.querySelector('button[aria-label="Previous track"]');
    previous.parentElement.querySelectorAll('button')[1].click();
  });
}

/**
 * The middle cell walks playing -> paused -> looping -> playing, and a fresh bar starts on "looping, not playing", so
 * the drive presses until the sound is what it wants rather than counting presses.
 */
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

async function pressNext(page) {
  await page.evaluate(() => document.querySelector('button[aria-label="Next track"]').click());
}

async function songMenu(page, key) {
  await page.locator('button[aria-label^="Song options for"]').first().click();
  await page.locator('[data-song-menu]').getByText(key, { exact: false }).first().click();
  await sleep(300);
  // The panel stays open after a press: shut it so the next step starts clean.
  if (await page.locator('[data-song-menu]').count()) await page.keyboard.press('Escape');
  await sleep(200);
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 60000 });
  // A fresh browser is offered an old account back: not this drive's business.
  const notNow = page.getByText('NOT NOW', { exact: false });
  if (await notNow.count()) await notNow.first().click().catch(() => undefined);
  await sleep(800);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(HOOK);
  await context.addInitScript(SEED);
  writeTones();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    console.log('A VISITOR: the room lives in the browser');
    await open(page, '/forum');
    assert.equal(await barQueue(page), 0, 'the bar has a QUEUE key, with nothing waiting');
    pass('the bar has [ QUEUE ], empty');
    assert.deepEqual(await tables(page), [], 'nothing is written before anything plays');
    pass('nothing is kept before the first press');

    const shelfKey = await page.evaluate(() => [...document.querySelectorAll('a, button')].map((key) => key.textContent.replace(/\s+/g, ' ').trim()).find((text) => /QUEUE ?\]$/.test(text) && text.includes('↻')) ?? null);
    assert.ok(shelfKey && !shelfKey.includes('QUEUES'), `the SHELF key reads QUEUE (${shelfKey})`);
    pass(`the SHELF key reads ${shelfKey}`);

    await page.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await pressUntil(page, false);
    await sleep(800);
    let rooms = await tables(page);
    assert.equal(rooms.length, 1, 'the first play starts the room');
    assert.ok(rooms[0].hostId.startsWith('visitor:'), "it is the visitor's own");
    assert.equal(rooms[0].isPublic, false, 'never public');
    assert.equal(rooms[0].privacy, 'private');
    const first = await audio(page);
    assert.equal(rooms[0].on, first.src, 'what the bar plays is what the room has on');
    assert.equal(rooms[0].isPlaying, true);
    pass('the first play starts a private room, with that song on');

    // Left playing: nothing is written on a clock.
    const stamp = rooms[0].updatedAt;
    await sleep(15000);
    rooms = await tables(page);
    assert.equal(rooms[0].updatedAt, stamp, 'fifteen seconds of playing wrote nothing');
    assert.ok((await audio(page)).time > 10, 'and the song really was playing');
    pass('15 seconds of playing: the room was not written once');

    await pressUntil(page, true);
    rooms = await tables(page);
    const paused = await audio(page);
    assert.equal(paused.paused, true);
    assert.equal(rooms[0].isPlaying, false, 'pause is written');
    assert.ok(Math.abs(rooms[0].position - paused.time) < 1.5, `at the place it was paused (${rooms[0].position} vs ${paused.time})`);
    pass('pause is written once, with where the song was');

    await pressUntil(page, false);
    rooms = await tables(page);
    assert.equal(rooms[0].isPlaying, true, 'resume is written');
    assert.equal(rooms[0].played, 1, 'and it is still the same play');
    pass('resume is written, and it is the same play');

    await songMenu(page, 'ADD TO QUEUE');
    assert.equal(await barQueue(page), 1, 'ADD TO QUEUE puts it on the room queue');
    rooms = await tables(page);
    assert.equal(rooms[0].waiting.length, 1);
    pass('ADD TO QUEUE: one thing waiting, on the bar key and in the room');

    console.log('THE POP-UP AND THE ROOM WINDOW (a song on)');
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    assert.equal((await page.locator('[data-own-room-door] button').innerText()).trim(), '[ ▲ ROOM ]', 'the pop-up says what it is in words');
    pass('with something on, [ ▲ ROOM ] is above the bar');
    await page.locator('[data-own-room-door] button').click();
    // Updated on purpose 2026-11-16 (list 3, SPEC-rooms-perpetual.md): a visitor's room opens in the live room's own
    // window, as an account's does; the old look-alike (OwnRoomWindow.tsx) is unused. Where chat would be it says JUST YOU
    // HERE and LOG IN (nobody can join a room kept in a browser). scripts/drive-rooms-your-room.cjs holds the window in full.
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 15000 });
    assert.equal(await page.locator('[data-own-room-window]').count(), 0, 'not the old look-alike window');
    assert.equal(await page.locator('[data-dock-window="stream"]').getAttribute('aria-label'), 'YOUR ROOM', 'the window is YOUR ROOM');
    assert.ok(await page.locator('[data-dock-window="stream"] [data-room-picture] [data-cover-card]').count(), 'a song on: the screen is its cover card');
    assert.ok((await page.locator('[data-visitor-room-alone]').innerText()).includes('JUST YOU HERE'), 'where a live room has its chat, it says JUST YOU HERE');
    assert.ok((await page.locator('[data-visitor-room-alone]').innerText()).includes('LOG IN'), 'a visitor is told to log in to share it, chat and go live');
    assert.ok(await page.locator('[data-dock-window="stream"] [data-watch-queue-key]').count(), 'the queue is behind [ QUEUE ], in the side column');
    assert.equal((await audio(page)).paused, false, 'and the song plays on');
    pass('the pop-up opens your room in the live room\'s window: the cover card, [ QUEUE ], JUST YOU HERE with LOG IN; the song plays on');
    await page.screenshot({ path: join(SHOTS, 'own-room-window-song.png') });
    await page.locator('[data-dock-window="stream"] button[aria-label^="Fold "]').click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    assert.equal((await audio(page)).paused, false, 'folded, the song plays on');
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
    pass('a song on: [ _ ] folds the window to its key above the player, the song plays on, and the key brings it back');
    // Your room is never left by closing its window: its X folds it too (SPEC-rooms-perpetual.md).
    await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    assert.equal((await audio(page)).paused, false, 'closing the window stops nothing');
    pass('the window\'s X folds your room away, playing on, with its key above the player');

    await page.locator('[data-bar-queue]').click();
    await page.waitForSelector('[data-own-room="browser"]', { timeout: 15000 });
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim()));
    assert.deepEqual(tabs, ['[ UP NEXT ]', '[ PLAYLISTS ]', '[ RADI-OH ]'], 'the queue window has UP NEXT, PLAYLISTS and RADI-OH (answer 9A)');
    // Signed out, PLAYLISTS says to log in: a playlist is an account's.
    await page.getByRole('tab', { name: /PLAYLISTS/ }).click();
    await page.waitForSelector('[data-queue-playlists="signed-out"]', { timeout: 10000 });
    await page.getByRole('tab', { name: /UP NEXT/ }).click();
    assert.ok(await page.locator('[data-own-room-note="visitor"]').count(), 'and tells a visitor it is kept in this browser');
    const states = await page.evaluate(() => [...document.querySelectorAll('[data-own-queue] [data-queue-state]')].map((row) => row.getAttribute('data-queue-state')));
    assert.ok(states.includes('now') && states.includes('queued'), `the queue shows what is on and what waits (${states.join(',')})`);
    pass('the QUEUE window: UP NEXT (what is on, what waits) and RADI-OH');
    await page.screenshot({ path: join(SHOTS, 'own-queue-visitor.png') });

    if (!flag('--no-video')) {
      console.log('A VIDEO TAKES ITS TURN');
      await page.fill('#stream-queue-search', VIDEO);
      await page.keyboard.press('Enter');
      const queued = await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 2, null, { timeout: 30000 }).then(() => true, () => false);
      if (!queued) {
        note('the test video could not be queued (no network to its host?): the video steps were skipped');
      } else {
        // Updated on purpose 2026-11-16 (list 3, SPEC-rooms-perpetual.md): your room plays a video in the room's own player
        // (its window is open, or folded with its key above the bar), never in the floating player.
        pass('a pasted video link goes straight into your own queue');
        // Song first in the queue, then the video: move on twice.
        await pressNext(page);
        await sleep(1200);
        assert.equal(await barQueue(page), 1, 'NEXT took the queued song');
        assert.equal((await audio(page)).paused, false, 'and the bar plays it');
        await pressNext(page);
        await page.waitForFunction(() => {
          const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
          return video !== null && /flower\.webm/.test(video.currentSrc || video.src) && video.currentTime > 0.2 && !video.paused;
        }, null, { timeout: 20000 });
        assert.equal((await audio(page)).paused, true, "the video's turn: the bar goes quiet");
        assert.equal(await page.locator('[data-floating-player] video').count(), 0, 'nothing floats: the room plays it');
        rooms = await tables(page);
        assert.equal(rooms[0].on, VIDEO, 'the room has the video on');
        pass('NEXT: the song, then the video in the room\'s own player (the window folded), the song quiet, nothing floating');

        await page.locator('button[aria-label^="Close QUEUE"]').click().catch(() => undefined);
        await sleep(1000);
        const mark = await page.evaluate(() => {
          const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
          video.loop = true;
          window.__sameVideo = video;
          return { time: video.currentTime };
        });
        await page.locator('[data-room-shelf-key] button').click();
        await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
        await sleep(1000);
        const inRoom = await page.evaluate(() => {
          const video = document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]');
          const at = video.getBoundingClientRect();
          const top = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
          return { same: video === window.__sameVideo, time: video.currentTime, paused: video.paused, seen: top !== null && (top === video || video.parentElement.contains(top)) };
        });
        assert.ok(inRoom.same, 'it is the same player element: nothing was loaded again');
        assert.ok(!inRoom.paused && inRoom.time >= mark.time - 0.5, 'still playing, from where it was');
        assert.ok(inRoom.seen, 'and is seen in the window');
        pass('the key above the player opens your room and the same video is on its screen: not restarted');
        await page.screenshot({ path: join(SHOTS, 'own-room-window-video.png') });
        await page.locator('[data-dock-window="stream"] button[aria-label^="Fold "]').click();
        await sleep(1000);
        const folded = await page.evaluate(() => ({ same: document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]') === window.__sameVideo, playing: !window.__sameVideo.paused, floating: document.querySelectorAll('[data-floating-player] video').length }));
        assert.deepEqual(folded, { same: true, playing: true, floating: 0 }, 'folded: the same element plays on out of sight, nothing floats');
        await page.locator('[data-room-shelf-key] button').click();
        await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
        await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
        await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
        assert.ok(await page.evaluate(() => document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]') === window.__sameVideo && !window.__sameVideo.paused), 'X: folded the same way, the same element still playing');
        pass('folding and closing the room window never reloads the video');
        await page.evaluate(() => {
          window.__sameVideo.loop = false;
        });

        // Something behind the video: when the video ends, it starts by itself.
        await page.evaluate(() => window.__sameVideo.pause());
        await songMenu(page, 'ADD TO QUEUE');
        assert.equal(await barQueue(page), 1);
        await page.evaluate(() => {
          const video = window.__sameVideo;
          video.currentTime = Math.max(0, video.duration - 0.4);
          void video.play();
        });
        await page.waitForFunction(() => !window.__audios[window.__audios.length - 1].paused && document.querySelector('[data-dock-window="stream"] [data-room-picture] video[data-watch-video]') === null, null, { timeout: 15000 });
        assert.equal(await barQueue(page), 0);
        pass('the video ended: the next thing (a song) started by itself, and the screen gave way to it');
      }
    }

    console.log('A RELOAD: the room is back, paused');
    await songMenu(page, 'ADD TO QUEUE');
    const before = (await tables(page))[0];
    const waitingBefore = await barQueue(page);
    assert.ok(waitingBefore >= 1);
    await open(page, '/forum');
    await page.waitForFunction((count) => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === count, waitingBefore, { timeout: 20000 });
    pass(`after a reload the queue is still there (${waitingBefore} waiting)`);
    await sleep(1500);
    const back = await audio(page);
    assert.ok(back === null || back.paused, 'nothing starts by itself');
    if (before.on && before.on.startsWith('/')) {
      assert.ok(back !== null && back.src === before.on, `the bar is back on the room's song (${back?.src} vs ${before.on})`);
      pass("the bar is back on the room's song, paused");
    }

    console.log('LOGGING IN: the browser queue joins the account');
    await page.evaluate(() => {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    });
    await open(page, '/forum');
    await page.waitForFunction((count) => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === count, waitingBefore, { timeout: 20000 });
    await sleep(800);
    rooms = await tables(page);
    const account = rooms.find((room) => room.hostId === 'drive-user');
    const visitor = rooms.find((room) => room.hostId.startsWith('visitor:'));
    assert.ok(account, "the account has a room of its own now");
    assert.equal(account.isPublic, false);
    assert.equal(account.waiting.length, waitingBefore, 'holding what the visitor had queued');
    assert.equal(visitor.waiting.length, 0, "and the browser's queue is emptied");
    pass('logged in: the account has its own private room, with what was queued in the browser');
    await page.locator('[data-bar-queue]').click();
    await page.waitForSelector('[data-own-room="account"]', { timeout: 15000 });
    assert.equal(await page.locator('[data-own-room-note="visitor"]').count(), 0, 'no "kept in this browser" line for an account');
    assert.ok(await page.locator('[data-playlist-keys]').count(), 'an account can save its queue as a playlist');
    pass('the queue window for an account: no browser-only line, and SAVE AS PLAYLIST, LOAD A PLAYLIST, CLEAR');

    console.log('A PLAYLIST IS A SAVED QUEUE: save a mixed queue, clear it, load it back whole');
    const queueTitles = async () => (await tables(page)).find((room) => room.hostId === 'drive-user').waiting;
    // A video beside the song(s) already waiting, so the queue is mixed.
    const beforePaste = await barQueue(page);
    await page.fill('#stream-queue-search', VIDEO);
    await page.keyboard.press('Enter');
    const pasted = await page.waitForFunction((was) => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === was + 1, beforePaste, { timeout: 30000 }).then(() => true, () => false);
    if (!pasted) note('the test video did not join the queue in this run (already waiting, or no network to its host): the save and load below may hold songs only');
    const mixed = await queueTitles();
    assert.ok(mixed.length > 0, 'something is waiting to be saved');
    await page.locator('[data-save-playlist]').click();
    await page.locator('[data-save-playlist-name]').fill('DRIVE MIX');
    await page.locator('[data-save-playlist-go]').click();
    await page.waitForFunction(() => /SAVED AS DRIVE MIX/.test(document.querySelector('[data-playlist-said]')?.textContent ?? ''), null, { timeout: 15000 });
    assert.deepEqual(await queueTitles(), mixed, 'saving leaves the queue as it was');
    pass(`SAVE AS PLAYLIST: saved as DRIVE MIX, and the queue is as it was (${mixed.length} waiting)`);
    await page.locator('[data-clear-queue]').click();
    assert.deepEqual(await queueTitles(), mixed, 'one press of CLEAR clears nothing');
    await page.locator('[data-clear-queue]').click();
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 0, null, { timeout: 15000 });
    assert.deepEqual(await queueTitles(), [], 'the second press empties what waits');
    pass('CLEAR: two presses, and nothing is waiting');
    await page.locator('[data-load-playlist]').click();
    await page.locator('[data-load-pick="DRIVE MIX"]').click();
    await page.waitForFunction((count) => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) >= count, mixed.length, { timeout: 15000 });
    const loaded = await queueTitles();
    assert.deepEqual(loaded.slice(-mixed.length), mixed, 'the playlist comes back whole, in order');
    pass(`LOAD A PLAYLIST: the queue is back (${loaded.length} waiting, the saved ${mixed.length} in order)`);
    // The PLAYLISTS tab lists it, with every item.
    await page.getByRole('tab', { name: /PLAYLISTS/ }).click();
    await page.waitForSelector('[data-playlist="DRIVE MIX"]', { timeout: 15000 });
    await page.locator('[data-playlist="DRIVE MIX"] [data-playlist-open]').click();
    const listed = await page.locator('[data-playlist="DRIVE MIX"] [data-playlist-item]').count();
    assert.ok(listed >= mixed.length, `the PLAYLISTS tab lists what was saved (${listed} items)`);
    assert.ok(await page.locator('[data-playlist="DRIVE MIX"] [data-playlist-play]').count(), 'with PLAY');
    assert.ok(await page.locator('[data-playlist="DRIVE MIX"] [data-playlist-queue]').count(), 'and + QUEUE');
    pass(`the PLAYLISTS tab lists DRIVE MIX with its ${listed} items, PLAY and + QUEUE`);
    await page.screenshot({ path: join(SHOTS, 'queue-playlists.png') });
    await page.getByRole('tab', { name: /UP NEXT/ }).click();
    await page.screenshot({ path: join(SHOTS, 'own-queue-account.png') });

    // Updated on purpose 2026-11-16 (list 3, SPEC-rooms-perpetual.md): signed in, your room opens in the live room's window
    // and its last key is [ GO LIVE ]: one press opens WHO CAN JOIN on this same room, and nothing starts.
    await page.locator('button[aria-label^="Close QUEUE"]').click();
    await pressUntil(page, false);
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 15000 });
    const roomsBeforeMenu = (await tables(page)).length;
    await page.locator('[data-main-room-live="private"]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 10000 });
    assert.equal((await tables(page)).length, roomsBeforeMenu, 'opening the menu starts no room');
    pass('signed in: GO LIVE in your room\'s window opens WHO CAN JOIN on this same room, and starts nothing by itself');
    await page.locator('[data-main-room-who] button', { hasText: 'CANCEL' }).click();

    console.log('THE LINK: COPY, JOIN, REFRESH, REMOVE (one browser, the mock accounts taking turns)');
    const asAccount = async (id, name) => {
      await page.evaluate(
        ([userId, displayName]) => {
          const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
          const user = { id: userId, email: `${userId}@debaser.site`, displayName, createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
          localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== userId), user], sessionUserId: userId }));
        },
        [id, name],
      );
    };
    const secretOf = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{}').links ?? {})[0] ?? null);
    const memberRows = (roomId) => page.evaluate((id) => (JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{}').members ?? []).filter((row) => row.roomId === id), roomId);
    const ownerRoom = (await tables(page)).find((room) => room.hostId === 'drive-user').id;
    assert.ok(!(await memberRows(ownerRoom)).some((row) => row.userId !== 'drive-user' && row.removedAt === null), 'nobody has joined yet');
    assert.equal(await secretOf(), null, 'and there is no link until its owner asks for one');
    await page.locator('[data-dock-window="stream"] [data-room-settings-key]').click();
    await page.waitForSelector('[data-room-own-join]', { timeout: 10000 });
    await page.locator('[data-room-copy-link]').click();
    await page.waitForFunction(() => /COPIED|COULD NOT COPY/.test(document.querySelector('[data-room-copy-link]')?.textContent ?? ''), null, { timeout: 10000 });
    const secret = await secretOf();
    assert.ok(typeof secret === 'string' && secret.length >= 32, 'COPY LINK makes the link');
    assert.ok(await page.locator('[data-room-refresh-link="ask"]').count(), 'REFRESH LINK sits beside COPY LINK');
    pass('the owner: the cog in the room window, COPY LINK makes a secret link, REFRESH LINK beside it');
    await page.screenshot({ path: join(SHOTS, 'own-room-settings-link.png') });

    await asAccount('drive-friend', 'TEST FRIEND');
    await open(page, `/forum?join=${'x'.repeat(40)}`);
    await page.waitForSelector('[data-join-by-link="dead"]', { timeout: 15000 });
    pass('a wrong link: THAT LINK DOES NOT WORK ANY MORE');
    await open(page, `/forum?join=${secret}`);
    await page.waitForSelector('[data-dock-window="stream"]', { timeout: 20000 });
    // Chat before live (SPEC-rooms-perpetual.md, migration change 7): a link joiner has the chat box now.
    await page.waitForSelector('#watch-chat', { timeout: 20000 });
    assert.ok(!(await page.url()).includes('join='), 'the secret does not stay in the address');
    assert.ok((await memberRows(ownerRoom)).some((row) => row.userId === 'drive-friend' && row.removedAt === null), 'the friend is a member now');
    const joinedTitle = await page.locator('[data-dock-window="stream"]').getAttribute('aria-label');
    // The mock site has no profile for a made-up account, so the name reads ANONYMOUS there; on the real site it is the owner's.
    assert.ok(/'S ROOM$/.test(joinedTitle ?? '') && !/STREAM|MUSIC/.test(joinedTitle ?? ''), `the window is named as the owner's room (${joinedTitle})`);
    pass("somebody signed in with the link joins: the owner's room opens, with its chat");
    await page.screenshot({ path: join(SHOTS, 'own-room-joined-by-link.png') });

    await page.evaluate(() => {
      const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1'));
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, sessionUserId: null }));
    });
    await open(page, `/forum?join=${secret}`);
    await page.waitForSelector('[data-join-by-link="signed-out"]', { timeout: 15000 });
    pass('signed out, the link asks you to log in and lets nobody in');

    await asAccount('drive-user', 'TEST DRIVE');
    await open(page, '/forum');
    await pressUntil(page, false);
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-room-settings-key]', { timeout: 15000 });
    await page.locator('[data-dock-window="stream"] [data-room-settings-key]').click();
    await page.waitForSelector('[data-room-remove="drive-friend"]', { timeout: 10000 });
    pass('the owner sees TEST FRIEND is in, in the cog\'s list with REMOVE');
    await page.locator('[data-room-refresh-link="ask"]').click();
    assert.ok((await page.locator('[data-room-refresh-state]').innerText()).includes('PEOPLE ALREADY IN STAY'), 'the consequence is said before the refresh');
    await page.locator('[data-room-refresh-link="confirm"]').click();
    await page.waitForSelector('[data-room-refresh-state="done"]', { timeout: 10000 });
    const fresh = await secretOf();
    assert.ok(fresh !== secret && typeof fresh === 'string', 'REFRESH LINK makes a new secret');
    assert.ok((await memberRows(ownerRoom)).some((row) => row.userId === 'drive-friend' && row.removedAt === null), 'and puts nobody out');
    pass('REFRESH LINK makes a new link and puts nobody out');
    await page.locator('[data-room-remove="drive-friend"]').click();
    await page.waitForFunction(() => document.querySelector('[data-room-remove="drive-friend"]') === null, null, { timeout: 10000 });
    assert.ok((await memberRows(ownerRoom)).some((row) => row.userId === 'drive-friend' && row.removedAt !== null), 'REMOVE takes them out');
    pass('REMOVE in the settings takes the friend out');

    await asAccount('drive-stranger', 'TEST STRANGER');
    await open(page, `/forum?join=${secret}`);
    await page.waitForSelector('[data-join-by-link="dead"]', { timeout: 15000 });
    assert.ok(!(await memberRows(ownerRoom)).some((row) => row.userId === 'drive-stranger'), 'the old link let nobody new in');
    pass('after the refresh the old link is dead for somebody new');
    await asAccount('drive-user', 'TEST DRIVE');

    // Updated on purpose 2026-11-16 (list 3, SPEC-rooms-perpetual.md): GO LIVE no longer makes a new room and carries the
    // song and queue into it; it announces the room you are in, so nothing moves, nothing restarts, and GO PRIVATE takes it
    // off the lists again with everything as it was.
    console.log('GO LIVE: THE SAME ROOM GOES ON THE LISTS; NOTHING MOVES; GO PRIVATE TAKES IT OFF');
    /** The stream rooms this account hosts (there should be none now). */
    const streams = () => page.evaluate(() => (JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).filter((room) => room.origin === 'stream' && room.hostId === 'drive-user' && room.endedAt === null));
    const mine = async () => (await tables(page)).find((room) => room.hostId === 'drive-user' && room.endedAt === null);
    const mainRoomRow = () => page.evaluate(() => (JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).find((room) => room.origin === 'music' && room.hostId === 'drive-user' && room.endedAt === null) ?? null);
    /** Counts every time the bar's player is moved or stopped, from now. */
    const watchBar = () =>
      page.evaluate(() => {
        const element = window.__audios[window.__audios.length - 1];
        window.__jolts = { seeks: 0, pauses: 0 };
        if (window.__joltsOn === element) return;
        window.__joltsOn = element;
        element.addEventListener('seeking', () => (window.__jolts.seeks += 1));
        element.addEventListener('pause', () => (window.__jolts.pauses += 1));
      });
    const jolts = () => page.evaluate(() => window.__jolts);

    await open(page, '/forum');
    await pressUntil(page, false);
    if ((await mine()).waiting.length === 0) await songMenu(page, 'ADD TO QUEUE');
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) > 0, null, { timeout: 10000 });
    const alone = await mine();
    const roomBefore = await mainRoomRow();
    assert.equal(roomBefore.isPublic, false, 'not live yet');
    assert.ok(await page.locator('[data-go-live-key]').count(), 'GO LIVE is on the bar');
    await sleep(1200);
    await watchBar();
    const atStart = await audio(page);
    assert.ok(atStart !== null && !atStart.paused, 'the song is playing');
    await page.locator('[data-go-live-key]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 20000 });
    assert.equal((await streams()).length, 0, 'the key opens your own room on WHO CAN JOIN and makes no other room');
    const opening = await jolts();
    const opened = await audio(page);
    assert.ok(!opened.paused && opened.src === atStart.src, 'the song plays on behind the menu');
    // The room's window, opening, puts the song where the room says it is: noted, not held (it is the window, not GO LIVE).
    if (opening.seeks > 0 || opening.pauses > 0) note(`opening your room's window moved the bar's song ${opening.seeks} time(s) (${atStart.time.toFixed(1)}s before, ${opened.time.toFixed(1)}s after)`);
    pass('GO LIVE on the bar opens your own room on WHO CAN JOIN, and starts nothing by itself');
    await watchBar();
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
    await sleep(2500);
    const liveRoom = await mainRoomRow();
    assert.equal(liveRoom.id, roomBefore.id, 'the same room');
    assert.equal(liveRoom.isPublic, true, 'now on the lists');
    assert.equal(liveRoom.privacy, 'private', 'PRIVATE, as the menu had picked');
    assert.equal((await streams()).length, 0, 'no stream room was made');
    assert.deepEqual((await mine()).waiting, alone.waiting, 'the queue is as it was');
    const carried = await audio(page);
    const jolted = await jolts();
    assert.ok(!carried.paused && carried.src === atStart.src && carried.time > atStart.time, `the same song played on (${atStart.time.toFixed(1)}s -> ${carried.time.toFixed(1)}s)`);
    assert.deepEqual(jolted, { seeks: 0, pauses: 0 }, `the bar's player was never moved or stopped (${JSON.stringify(jolted)})`);
    pass(`START: the same room went live with the same queue, and the song played on with no gap (${atStart.time.toFixed(1)}s -> ${carried.time.toFixed(1)}s)`);
    await page.screenshot({ path: join(SHOTS, 'go-live-same-room.png') });

    await watchBar();
    const atPrivate = await audio(page);
    await page.locator('[data-main-room-live="live"]').first().click();
    await page.waitForSelector('[data-main-room-private]', { timeout: 10000 });
    await page.locator('[data-main-room-private]').click();
    await page.waitForSelector('[data-main-room-live="private"]', { timeout: 15000 });
    await sleep(1500);
    const privateAgain = await mainRoomRow();
    assert.equal(privateAgain.id, roomBefore.id, 'still the same room');
    assert.equal(privateAgain.isPublic, false, 'off the lists');
    assert.deepEqual((await mine()).waiting, alone.waiting, 'the queue is as it was');
    const afterPrivate = await audio(page);
    assert.ok(!afterPrivate.paused && afterPrivate.src === atPrivate.src && afterPrivate.time > atPrivate.time, 'the song plays on');
    assert.deepEqual(await jolts(), { seeks: 0, pauses: 0 }, 'never moved or stopped');
    pass('GO PRIVATE: the same room off the lists, the queue as it was, the song playing on');
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    pass('END ROOM ends it; the next thing you play makes a new room');

    console.log('A PICTURE TAKES ITS TURN: queued from FILES, held until NEXT, alone and live');
    /** The room this account hosts live, with what it has on, as the store holds it. */
    const liveNow = () =>
      page.evaluate(() => {
        const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
        const room = kept.rooms.find((held) => held.origin === 'music' && held.isPublic && held.hostId === 'drive-user' && held.endedAt === null);
        if (room === undefined) return null;
        const on = kept.queue.find((entry) => entry.id === room.currentEntryId);
        return { on: on ? (on.link ? on.link.kind : 'file') : null, updatedAt: room.updatedAt, waiting: kept.queue.filter((entry) => entry.roomId === room.id && entry.playedAt === null && entry.inQueue).length };
      });
    const queuePictureFromFiles = async () => {
      await open(page, '/files?kind=image');
      // The pictures are filed in folds: the test picture is under OTHER PICTURES.
      await page.getByText('OTHER PICTURES', { exact: false }).first().click();
      await page.waitForSelector('[data-queue-picture="idle"]', { timeout: 30000 });
      // Pressed in the page: the QUEUE window, still open from the step before, sits over the row.
      await page.evaluate(() => document.querySelector('[data-queue-picture="idle"]').click());
      await page.waitForSelector('[data-queue-picture="queued"]', { timeout: 15000 });
    };
    // Start from an empty queue, so the order is known: the picture, then a song.
    await open(page, '/forum');
    await page.locator('[data-bar-queue]').click();
    await page.waitForSelector('[data-playlist-keys]', { timeout: 15000 });
    if ((await barQueue(page)) > 0) {
      await page.locator('[data-clear-queue]').click();
      await page.locator('[data-clear-queue]').click();
      await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 0, null, { timeout: 15000 });
    }
    await queuePictureFromFiles();
    assert.deepEqual((await mine()).waiting, ['DRIVE PICTURE'], '+ QUEUE on a FILES picture puts it on your queue');
    pass('+ QUEUE on a FILES picture: it is on your own queue');
    await pressUntil(page, false);
    await songMenu(page, 'ADD TO QUEUE');
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 2, null, { timeout: 10000 });
    await pressNext(page);
    await page.waitForSelector('[data-queued-picture="shown"]', { timeout: 15000 });
    await page.waitForSelector('[data-bar-screen="picture"]', { timeout: 10000 });
    assert.equal((await audio(page)).paused, true, 'the picture is a stop: the song is quiet');
    assert.ok((await page.locator('[data-bar-screen="picture"]').innerText()).includes('HELD'), 'the bar says HELD where the time would be');
    const drew = await page.evaluate(() => {
      const image = document.querySelector('[data-queued-picture="shown"] img');
      return image !== null && image.complete && image.naturalWidth > 0;
    });
    assert.ok(drew, 'the picture is drawn');
    await sleep(7000);
    assert.equal(await page.locator('[data-queued-picture="shown"]').count(), 1, 'seven seconds on, it is still there: no timer');
    assert.equal((await audio(page)).paused, true, 'and nothing behind it has started');
    pass('the picture took its turn on your screen and held it: the bar says PICTURE and HELD, nothing behind it played');
    await page.screenshot({ path: join(SHOTS, 'own-picture-held.png') });
    await page.locator('[data-bar-picture-next]').click();
    await page.waitForFunction(() => document.querySelector('[data-queued-picture]') === null && !window.__audios[window.__audios.length - 1].paused, null, { timeout: 15000 });
    pass('NEXT on the bar: the picture comes off and the song behind it starts');

    // Live (updated on purpose 2026-11-16, list 3): your own room goes live with the song on and the picture waiting behind it;
    // NEXT puts it on the room's stage, where it is held.
    await queuePictureFromFiles();
    await open(page, '/forum');
    await pressUntil(page, false);
    await page.locator('[data-go-live-key]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 20000 });
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 30000 });
    await page.waitForFunction(() => {
      const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
      const room = kept.rooms.find((held) => held.origin === 'music' && held.isPublic && held.hostId === 'drive-user' && held.endedAt === null);
      return room !== undefined && kept.queue.some((entry) => entry.roomId === room.id && entry.playedAt === null && entry.link && entry.link.kind === 'picture');
    }, null, { timeout: 20000 });
    await sleep(1500);
    // The room's own skip key (under its picture, or on the music bar while the bar shows the room).
    await page.evaluate(() => document.querySelector('[data-watch-bar] button[aria-label="Skip to the next video"], [data-stream-bar] button[aria-label="Skip to the next video"]').click());
    await page.waitForSelector('[data-room-picture-held]', { timeout: 20000 });
    await page.waitForSelector('[data-room-picture-held] [data-queued-picture="shown"]', { timeout: 10000 });
    assert.ok(await page.locator('[data-room-picture-next]').count(), 'the host has NEXT under the picture');
    const heldAt = await liveNow();
    assert.equal(heldAt.on, 'picture', 'the room has the picture on');
    assert.equal((await audio(page)).paused, true, 'and the song has stopped for it');
    await sleep(8000);
    const stillHeld = await liveNow();
    assert.equal(stillHeld.on, 'picture', 'eight seconds on, the room is still on the picture');
    assert.ok(Date.parse(stillHeld.updatedAt) > Date.parse(heldAt.updatedAt), "the host's beat kept the room live while it was held");
    pass('live: the picture is on the stage, held, with NEXT for the host, and the room stays live on it');
    await page.screenshot({ path: join(SHOTS, 'live-picture-held.png') });
    await page.locator('[data-room-picture-next]').click();
    await page.waitForFunction(() => {
      const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
      const room = kept.rooms.find((held) => held.origin === 'music' && held.isPublic && held.hostId === 'drive-user' && held.endedAt === null);
      return room !== undefined && room.currentEntryId === null;
    }, null, { timeout: 15000 });
    assert.equal(await page.locator('[data-room-picture-held]').count(), 0, 'the picture is off the stage');
    pass('NEXT with nothing behind it: the picture comes off and the screen goes back to black');
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => {
      const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
      return !kept.rooms.some((held) => held.origin === 'music' && held.isPublic && held.hostId === 'drive-user' && held.endedAt === null);
    }, null, { timeout: 20000 });

    console.log('OUTSIDE PICTURES: every guard at ADD, covered for anybody else until SHOW, and our server never asked');
    // A made-up public host, answered here by the drive: nothing leaves this machine, and every request to it is counted.
    const OUTSIDE = 'https://pictures.drive-test.example';
    const outsideAsked = [];
    const ourServerAsked = [];
    context.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(OUTSIDE)) outsideAsked.push(`${request.method()} ${url.slice(OUTSIDE.length)}`);
      else if (url.startsWith(BASE) && url.includes('drive-test')) ourServerAsked.push(url);
    });
    const open8 = { 'access-control-allow-origin': '*', 'content-type': 'image/png' };
    await context.route(`${OUTSIDE}/**`, async (route) => {
      const request = route.request();
      const name = new URL(request.url()).pathname;
      if (name === '/heavy.png' && request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...open8, 'content-length': String(20 * 1024 * 1024) } });
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: open8 });
      if (name === '/wide.png') return route.fulfill({ status: 200, headers: open8, body: pngOf(5000, 2) });
      if (name === '/slow.png') {
        await sleep(11000);
        return route.fulfill({ status: 200, headers: open8, body: pngOf(8, 8) }).catch(() => undefined);
      }
      if (name === '/page') return route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<p>not a picture</p>' });
      return route.fulfill({ status: 200, headers: open8, body: pngOf(8, 8) });
    });
    const paste = async (address) => {
      await page.fill('#stream-queue-search', address);
      await page.keyboard.press('Enter');
    };
    const refusedWith = async (words, timeout = 15000) => {
      await page.waitForFunction((wanted) => (document.querySelector('[data-watch-link-state="refused"]')?.textContent ?? '').includes(wanted), words, { timeout });
    };

    await open(page, '/forum');
    // The QUEUE window may still be open from the steps before: its key is a switch.
    await sleep(800);
    if ((await page.locator('[data-playlist-keys]').count()) === 0) await page.locator('[data-bar-queue]').click();
    await page.waitForSelector('[data-playlist-keys]', { timeout: 15000 });
    if ((await barQueue(page)) > 0) {
      await page.locator('[data-clear-queue]').click();
      await page.locator('[data-clear-queue]').click();
      await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 0, null, { timeout: 15000 });
    }
    await paste(`${OUTSIDE}/logo.svg`);
    await refusedWith('SVG');
    await paste('https://192.168.1.10/cat.png');
    await refusedWith('PUBLIC WEB ADDRESS');
    assert.deepEqual(outsideAsked, [], 'an SVG and a private address are refused by the address alone: nothing was asked of any server');
    pass('an SVG link and a private-network address are refused as typed, with no request made');
    await paste(`${OUTSIDE}/heavy.png`);
    await refusedWith('TOO BIG');
    pass('a picture its server says is 20 MB is refused: 10 MB AT MOST');
    await paste(`${OUTSIDE}/wide.png`);
    await refusedWith('TOO LARGE');
    pass('a picture 5,000 pixels wide is refused: 4096 A SIDE AT MOST');
    await paste(`${OUTSIDE}/slow.png`);
    await refusedWith("WOULDN'T LOAD", 25000);
    pass("a picture that takes longer than 8 seconds is refused: WOULDN'T LOAD");
    await paste(`${OUTSIDE}/page`);
    await refusedWith('NOT A VIDEO OR PICTURE LINK');
    pass('a page that is no picture is refused');
    assert.equal(await barQueue(page), 0, 'none of them reached the queue');

    await paste(`${OUTSIDE}/good.png`);
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 1, null, { timeout: 20000 });
    assert.ok((await page.locator('[data-own-room]').innerText()).includes('OUTSIDE :: good.png'), 'it is marked OUTSIDE in the queue');
    pass('a good outside picture is queued, and marked OUTSIDE in the queue');
    // Taken out again by its adder (here the owner, who holds the crown), then queued again for its turn.
    await page.locator('[data-own-room] button[aria-label^="Take ▣ OUTSIDE :: good.png out"]').first().click();
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 0, null, { timeout: 10000 });
    pass('it can be taken out again before it shows');
    await paste(`${OUTSIDE}/good.png`);
    await page.waitForFunction(() => Number(document.querySelector('[data-bar-queue]')?.getAttribute('data-bar-queue')) === 1, null, { timeout: 20000 });
    await pressNext(page);
    await page.waitForSelector('[data-queued-picture="outside-shown"]', { timeout: 20000 });
    assert.ok((await page.locator('[data-outside-mark]').innerText()).includes('FROM OUTSIDE THE SITE :: PICTURES.DRIVE-TEST.EXAMPLE'), 'on the screen it is marked as from outside, with its host');
    assert.equal(await page.locator('[data-queued-picture="outside-shown"] img').getAttribute('referrerpolicy'), 'no-referrer', 'shown with no referrer');
    pass('for whoever added it, it shows at once, marked FROM OUTSIDE THE SITE with its host, with no referrer');
    assert.deepEqual(ourServerAsked, [], 'our own server was never asked about the picture');
    pass('our own server made no request for the picture: no optimiser, no proxy');
    await page.screenshot({ path: join(SHOTS, 'outside-picture-shown.png') });

    // Somebody else: joins by the owner's link, and gets it covered. Their browser asks the outside host nothing until SHOW.
    // Updated on purpose 2026-11-16 (list 3): END ROOM earlier gave the owner a new room, so the link is the new room's,
    // copied from its cog now (a link belongs to one room; the old room's let nobody in once it ended).
    const roomNow = (await mine()).id;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.evaluate(() => document.querySelector('[data-own-room-door] button, [data-room-shelf-key] button')?.click());
    await page.waitForSelector('[data-dock-window="stream"] [data-room-settings-key]', { timeout: 20000 });
    await page.locator('[data-dock-window="stream"] [data-room-settings-key]').click();
    await page.waitForSelector('[data-room-copy-link]', { timeout: 10000 });
    await page.locator('[data-room-copy-link]').click();
    await page.waitForFunction((id) => typeof (JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{}').links ?? {})[id] === 'string', roomNow, { timeout: 10000 });
    const linkNow = await page.evaluate((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).links[id], roomNow);
    assert.ok(typeof linkNow === 'string', "the owner's link to the room the picture is in");
    await asAccount('drive-viewer', 'TEST VIEWER');
    // Somebody else is in another browser: this one forgets what the owner pasted, as theirs never knew it.
    await page.evaluate(() => localStorage.removeItem('debaser.outside-pictures.v1'));
    const askedBefore = outsideAsked.length;
    await open(page, `/forum?join=${linkNow}`);
    await page.waitForSelector('[data-dock-window="stream"]', { timeout: 20000 });
    await page.waitForSelector('[data-queued-picture="outside-covered"]', { timeout: 20000 });
    await sleep(3000);
    assert.equal(outsideAsked.length, askedBefore, `covered: the viewer's browser asked the outside host nothing (${outsideAsked.slice(askedBefore).join(', ')})`);
    assert.ok((await page.locator('[data-queued-picture="outside-covered"]').innerText()).includes('PICTURE FROM PICTURES.DRIVE-TEST.EXAMPLE'), 'the cover names the host');
    assert.ok(await page.locator('[data-outside-always]').count(), 'with ALWAYS SHOW IN THIS ROOM beside SHOW');
    assert.ok(await page.locator('[data-room-picture-waiting]').count(), 'and WAITING FOR THE HOST, not NEXT');
    pass("for somebody else it arrives covered, naming its host, and their browser asked that host nothing");
    await page.screenshot({ path: join(SHOTS, 'outside-picture-covered.png') });
    await page.locator('[data-outside-show]').click();
    await page.waitForSelector('[data-queued-picture="outside-shown"]', { timeout: 20000 });
    assert.ok(outsideAsked.length > askedBefore, 'SHOW is what makes the request');
    assert.ok(outsideAsked.slice(askedBefore).every((asked) => asked === 'GET /good.png'), `and only for the picture itself (${outsideAsked.slice(askedBefore).join(', ')})`);
    pass('SHOW loads it: the first request their browser makes to that host');
    assert.deepEqual(ourServerAsked, [], 'our own server was still never asked');

    // Preferences: NEVER means it is not loaded at all, and there is no key to load it.
    await page.evaluate(() => localStorage.setItem('debaser.outside-pictures.v1', JSON.stringify({ mode: 'never', rooms: [] })));
    const beforeNever = outsideAsked.length;
    await open(page, `/forum?watch=${roomNow}`);
    await page.waitForSelector('[data-queued-picture="outside-off"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-outside-show]').count(), 0, 'NEVER: no SHOW key');
    await sleep(1500);
    assert.equal(outsideAsked.length, beforeNever, 'and nothing asked');
    pass('OUTSIDE PICTURES: NEVER in Preferences: named, not loaded, no key');
    await page.evaluate(() => localStorage.removeItem('debaser.outside-pictures.v1'));
    await asAccount('drive-user', 'TEST DRIVE');
    await context.unroute(`${OUTSIDE}/**`);

    console.log('THE PRIVACY PAGE');
    await page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('Your room: what you are playing and your queue are saved to your account'), null, { timeout: 30000 });
    pass('the privacy page has the room line');
    assert.ok((await page.evaluate(() => document.body.innerText)).includes('A picture added from outside the site is loaded from wherever it lives, only after you press SHOW'), 'and the line about outside pictures');
    pass('the privacy page has the outside-picture line');

    console.log('PHONE WIDTH: nothing scrolls sideways');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/forum');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(sideways <= 1, `no sideways scroll at 390 (${sideways}px over)`);
    pass('no sideways scroll at 390 wide');

    assert.deepEqual(errors, [], 'no errors on the page');
    pass('no page errors');
    console.log(`\n${passed} passed${notes.length ? `, ${notes.length} note(s)` : ''}`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'own-room-failed.png') }).catch(() => undefined);
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    rmSync(DRIVE_AUDIO, { recursive: true, force: true });
  }
})();
