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
}
const SEED = `(() => {
  try {
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
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
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
    await page.waitForSelector('[data-own-room-window="browser"]', { timeout: 15000 });
    assert.equal(await page.locator('[data-own-room-screen]').getAttribute('data-own-room-screen'), 'song', 'a song on: the screen is its cover card');
    assert.ok(await page.locator('[data-own-room-screen] [data-cover-card]').count(), 'the cover card is drawn');
    assert.ok((await page.locator('[data-own-room-alone]').innerText()).includes('JUST YOU HERE'), 'where a live room has its chat, it says JUST YOU HERE');
    assert.ok((await page.locator('[data-own-room-alone]').innerText()).includes('LOG IN'), 'a visitor is told to log in to go live');
    assert.ok(await page.locator('[data-own-room-window] [data-own-queue]').count(), 'the queue is in the room window');
    assert.equal(await page.locator('[data-stream-bar]').count(), 0, 'the bar stays the music bar: your own room is not a stream');
    assert.equal((await audio(page)).paused, false, 'and the song plays on');
    pass('the pop-up opens the room window: the cover card, the queue, JUST YOU HERE; the song plays on');
    await page.screenshot({ path: join(SHOTS, 'own-room-window-song.png') });
    await page.locator('button[aria-label="Fold YOUR ROOM away"]').click();
    await page.waitForSelector('[data-own-room-door="folded"]', { timeout: 10000 });
    pass('folded away, the same key brings it back');
    await page.locator('[data-own-room-door] button').click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="own-room"]')?.getAttribute('data-minimized') !== 'true', null, { timeout: 10000 });
    await page.locator('button[aria-label="Close YOUR ROOM"]').click();
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    assert.equal((await audio(page)).paused, false, 'closing the window stops nothing');
    pass('closing the window leaves the room playing, with its pop-up back');

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
        pass('a pasted video link goes straight into your own queue');
        // Song first in the queue, then the video: move on twice.
        await pressNext(page);
        await sleep(1200);
        assert.equal(await barQueue(page), 1, 'NEXT took the queued song');
        assert.equal((await audio(page)).paused, false, 'and the bar plays it');
        await pressNext(page);
        await page.waitForSelector('[data-floating-player]', { timeout: 15000 });
        await sleep(800);
        assert.equal((await audio(page)).paused, true, "the video's turn: the bar goes quiet");
        assert.ok(await page.locator('[data-bar-screen]').count(), 'and the bar names the video');
        rooms = await tables(page);
        assert.equal(rooms[0].on, VIDEO, 'the room has the video on');
        pass('NEXT: the song, then the video on the screen, named on the bar, the song quiet');
        await page.screenshot({ path: join(SHOTS, 'own-video-on.png') });

        // P2: the pop-up opens the room window, and the same video is its screen without starting again.
        await page.locator('button[aria-label^="Close QUEUE"]').click().catch(() => undefined);
        await sleep(1500);
        const mark = await page.evaluate(() => {
          const video = document.querySelector('[data-floating-player] video');
          video.loop = true;
          window.__sameVideo = video;
          return { time: video.currentTime, state: document.querySelector('[data-floating-player]').getAttribute('data-floating-player') };
        });
        assert.equal(mark.state, 'floating', 'with no row of its own on this page the video floats');
        await page.locator('[data-own-room-door] button').click();
        await page.waitForSelector('[data-own-room-screen="video"]', { timeout: 15000 });
        await sleep(1200);
        const inRoom = await page.evaluate(() => {
          const layer = document.querySelector('[data-floating-player]');
          const video = layer.querySelector('video');
          const box = document.querySelector('[data-own-room-screen] [data-player-box]').getBoundingClientRect();
          const at = layer.getBoundingClientRect();
          const top = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
          return {
            state: layer.getAttribute('data-floating-player'),
            same: video === window.__sameVideo,
            time: video.currentTime,
            paused: video.paused,
            over: Math.abs(at.left - box.left) < 3 && Math.abs(at.top - box.top) < 3 && Math.abs(at.width - box.width) < 3,
            seen: top !== null && layer.contains(top),
          };
        });
        assert.equal(inRoom.state, 'in-box', "the video sits in the room window's screen");
        assert.ok(inRoom.over, 'exactly over its box');
        assert.ok(inRoom.seen, 'and is drawn over the window, not under it');
        assert.ok(inRoom.same, 'it is the same player element: nothing was loaded again');
        assert.ok(!inRoom.paused, 'still playing');
        pass("the pop-up opens the room window and the same video is its screen: not restarted, drawn over the window");
        await page.screenshot({ path: join(SHOTS, 'own-room-window-video.png') });
        await page.locator('button[aria-label="Fold YOUR ROOM away"]').click();
        await sleep(1000);
        const folded = await page.evaluate(() => ({ state: document.querySelector('[data-floating-player]').getAttribute('data-floating-player'), same: document.querySelector('[data-floating-player] video') === window.__sameVideo }));
        assert.equal(folded.state, 'floating', 'the window folded away: the video floats again');
        assert.ok(folded.same, 'still the same element');
        await page.locator('[data-own-room-door] button').click();
        await page.waitForFunction(() => document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player') === 'in-box', null, { timeout: 10000 });
        await page.locator('button[aria-label="Close YOUR ROOM"]').click();
        await sleep(800);
        const shut = await page.evaluate(() => ({ state: document.querySelector('[data-floating-player]')?.getAttribute('data-floating-player'), same: document.querySelector('[data-floating-player] video') === window.__sameVideo }));
        assert.ok(shut.state === 'floating' && shut.same, 'the window shut: the video floats, the same element still');
        pass('folding and closing the room window never reloads the video');
        await page.evaluate(() => {
          window.__sameVideo.loop = false;
        });

        // Something behind the video: when the video ends, it starts by itself.
        await page.evaluate(() => document.querySelector('[data-floating-player] video')?.pause());
        await songMenu(page, 'ADD TO QUEUE');
        assert.equal(await barQueue(page), 1);
        await page.evaluate(() => {
          const video = document.querySelector('[data-floating-player] video');
          video.currentTime = Math.max(0, video.duration - 0.4);
          void video.play();
        });
        await page.waitForFunction(() => document.querySelector('[data-floating-player]') === null && !window.__audios[window.__audios.length - 1].paused, null, { timeout: 15000 });
        assert.equal(await barQueue(page), 0);
        pass('the video ended: the next thing (a song) started by itself, and the screen closed');
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

    // Signed in, the room window's JUST YOU HERE panel has GO LIVE: one press opens the menu, and nothing starts.
    await page.locator('button[aria-label^="Close QUEUE"]').click();
    await pressUntil(page, false);
    await page.waitForSelector('[data-own-room-door="shut"]', { timeout: 10000 });
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-own-room-window="account"]', { timeout: 15000 });
    await page.locator('[data-own-room-go-live]').click();
    await page.waitForFunction(() => document.body.innerText.includes('WHO CAN JOIN'), null, { timeout: 10000 });
    assert.equal((await tables(page)).filter((room) => room.hostId === 'drive-user').length, 1, 'opening the menu starts no room');
    pass('signed in: GO LIVE in the room window opens the WHO CAN JOIN menu, and starts nothing by itself');
    await page.keyboard.press('Escape');
    await page.locator('button[aria-label="Close YOUR ROOM"]').click().catch(() => undefined);

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
    await open(page, '/forum');
    await pressUntil(page, false);
    await page.locator('[data-own-room-door] button').click();
    await page.waitForSelector('[data-own-room-window="account"]', { timeout: 15000 });
    assert.equal(await page.locator('[data-own-room-alone]').getAttribute('data-own-room-alone'), 'alone', 'nobody has joined yet');
    assert.equal(await secretOf(), null, 'and there is no link until its owner asks for one');
    await page.locator('[data-own-room-settings]').click();
    await page.waitForSelector('[data-room-own-join]', { timeout: 10000 });
    await page.locator('[data-room-copy-link]').click();
    await page.waitForFunction(() => /COPIED|COULD NOT COPY/.test(document.querySelector('[data-room-copy-link]')?.textContent ?? ''), null, { timeout: 10000 });
    const secret = await secretOf();
    assert.ok(typeof secret === 'string' && secret.length >= 32, 'COPY LINK makes the link');
    assert.ok(await page.locator('[data-room-refresh-link="ask"]').count(), 'REFRESH LINK sits beside COPY LINK');
    const ownerRoom = (await tables(page)).find((room) => room.hostId === 'drive-user').id;
    pass('the owner: settings in the room window, COPY LINK makes a secret link, REFRESH LINK beside it');
    await page.screenshot({ path: join(SHOTS, 'own-room-settings-link.png') });

    await asAccount('drive-friend', 'TEST FRIEND');
    await open(page, `/forum?join=${'x'.repeat(40)}`);
    await page.waitForSelector('[data-join-by-link="dead"]', { timeout: 15000 });
    pass('a wrong link: THAT LINK DOES NOT WORK ANY MORE');
    await open(page, `/forum?join=${secret}`);
    await page.waitForSelector('[data-dock-window="stream"]', { timeout: 20000 });
    await page.waitForSelector('[data-watch-no-chat]', { timeout: 20000 });
    assert.ok(!(await page.url()).includes('join='), 'the secret does not stay in the address');
    assert.ok((await memberRows(ownerRoom)).some((row) => row.userId === 'drive-friend' && row.removedAt === null), 'the friend is a member now');
    const joinedTitle = await page.locator('[data-dock-window="stream"]').getAttribute('aria-label');
    // The mock site has no profile for a made-up account, so the name reads ANONYMOUS there; on the real site it is the owner's.
    assert.ok(/'S ROOM$/.test(joinedTitle ?? '') && !/STREAM|MUSIC/.test(joinedTitle ?? ''), `the window is named as the owner's room (${joinedTitle})`);
    pass("somebody signed in with the link joins: the owner's room opens, with no chat box");
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
    await page.waitForSelector('[data-own-room-alone="joined"]', { timeout: 15000 });
    assert.ok((await page.locator('[data-own-room-joined]').innerText()).includes('TEST FRIEND'), 'the owner sees who is in by their link');
    await page.locator('[data-own-room-settings]').click();
    await page.locator('[data-room-refresh-link="ask"]').click();
    assert.ok((await page.locator('[data-room-refresh-state]').innerText()).includes('PEOPLE ALREADY IN STAY'), 'the consequence is said before the refresh');
    await page.locator('[data-room-refresh-link="confirm"]').click();
    await page.waitForSelector('[data-room-refresh-state="done"]', { timeout: 10000 });
    const fresh = await secretOf();
    assert.ok(fresh !== secret && typeof fresh === 'string', 'REFRESH LINK makes a new secret');
    assert.ok((await memberRows(ownerRoom)).some((row) => row.userId === 'drive-friend' && row.removedAt === null), 'and puts nobody out');
    pass('the owner sees TEST FRIEND is in; REFRESH LINK makes a new link and puts nobody out');
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

    console.log("GO LIVE: what is on and the queue go into tonight's room; END STREAM brings back what is left");
    /** The live rooms this account hosts, as the store holds them. */
    const streams = () =>
      page.evaluate(() => {
        const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
        return kept.rooms
          .filter((room) => room.origin === 'stream' && room.hostId === 'drive-user')
          .map((room) => {
            const rows = kept.queue.filter((entry) => entry.roomId === room.id);
            const on = rows.find((entry) => entry.id === room.currentEntryId);
            return {
              id: room.id,
              privacy: room.privacy,
              endedAt: room.endedAt,
              position: room.positionSeconds,
              isPlaying: room.isPlaying,
              on: on ? (on.link ? on.link.url : on.mediaItemId) : null,
              waiting: rows.filter((entry) => entry.playedAt === null && entry.inQueue).sort((a, b) => a.position - b.position).map((entry) => (entry.link ? entry.link.title : entry.mediaItemId)),
            };
          });
      });
    const mine = async () => (await tables(page)).find((room) => room.hostId === 'drive-user');
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
    assert.equal((await streams()).filter((room) => room.endedAt === null).length, 0, 'not live yet');
    assert.ok(await page.locator('[data-go-live-key]').count(), 'GO LIVE is on the bar');
    await page.locator('[data-go-live-key]').first().click();
    await page.waitForSelector('[data-go-live-window]', { timeout: 10000 });
    assert.equal((await streams()).filter((room) => room.endedAt === null).length, 0, 'the key opens the menu and starts nothing');
    pass('GO LIVE on the bar opens the WHO CAN JOIN menu, and starts nothing by itself');
    await sleep(1200);
    await watchBar();
    const atStart = await audio(page);
    assert.ok(atStart !== null && !atStart.paused, 'the song plays on behind the menu');
    await page.locator('[data-go-live-window]').getByText('[ START ]', { exact: false }).click();
    await page.waitForSelector('[data-dock-window="stream"]', { timeout: 30000 });
    await sleep(2500);
    let live = (await streams()).filter((room) => room.endedAt === null);
    assert.equal(live.length, 1, 'START makes one new room');
    assert.equal(live[0].privacy, 'private', 'PRIVATE, as the menu had picked');
    assert.equal(live[0].on, atStart.src, 'what was on is the first play');
    assert.deepEqual(live[0].waiting, alone.waiting, 'the queue is behind it, in order');
    pass(`START: a new private room with the song on and the queue behind it (${alone.waiting.length} waiting)`);
    const carried = await audio(page);
    const jolted = await jolts();
    assert.ok(!carried.paused && carried.src === atStart.src, 'the same song is still playing');
    assert.ok(carried.time > atStart.time, `it carried on (${atStart.time.toFixed(1)}s -> ${carried.time.toFixed(1)}s)`);
    assert.deepEqual(jolted, { seeks: 0, pauses: 0 }, `the bar's player was never moved or stopped (${JSON.stringify(jolted)})`);
    pass(`the song carried across with no gap (${atStart.time.toFixed(1)}s -> ${carried.time.toFixed(1)}s, never moved, never stopped)`);
    assert.deepEqual((await mine()).waiting, alone.waiting, 'your own room is left untouched while you are live');
    // In a live room the bar is the stream's own strip; its TV key turns it back to the music player's face.
    assert.ok(await page.locator('[data-stream-bar]').count(), "the bar is the stream's");
    // Pressed in the page: the dev server's own corner badge sits over the bar's left end.
    await page.evaluate(() => document.querySelector('[data-stream-bar-swap="stream"]').click());
    await page.waitForSelector('[data-bar-queue]', { timeout: 10000 });
    assert.equal(await barQueue(page), live[0].waiting.length, "the bar's count is the live room's queue");
    assert.equal(await page.locator('[data-go-live-key]').count(), 0, 'no GO LIVE key while you are live');
    await page.locator('[data-bar-queue]').click();
    await page.waitForSelector('[data-own-room="live"]', { timeout: 15000 });
    pass("live: your own room is untouched, and the bar's count and the QUEUE window are the live room's");
    await page.screenshot({ path: join(SHOTS, 'go-live-carried.png') });
    await page.locator('button[aria-label^="Close QUEUE"]').click();

    // The room moves on to the next thing, so what is left differs from what went in.
    await pressNext(page);
    await page.waitForFunction(
      (was) => {
        const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
        const room = kept.rooms.find((held) => held.origin === 'stream' && held.hostId === 'drive-user' && held.endedAt === null);
        return room !== undefined && kept.queue.filter((entry) => entry.roomId === room.id && entry.playedAt === null && entry.inQueue).length === was - 1;
      },
      live[0].waiting.length,
      { timeout: 15000 },
    );
    await sleep(2500);
    live = (await streams()).filter((room) => room.endedAt === null);
    const songOn = typeof live[0].on === 'string' && live[0].on.startsWith('/assets/audio/');
    note(`at END STREAM the live room had ${songOn ? 'a song' : 'a video'} on and ${live[0].waiting.length} waiting`);
    await watchBar();
    const atEnd = await audio(page);
    await page.locator('[data-dock-window="stream"]').getByText('[ END STREAM ]', { exact: false }).first().click();
    await page.locator('[data-dock-window="stream"]').getByText('[ END FOR EVERYBODY ]', { exact: false }).first().click();
    await page.waitForFunction(
      () => {
        const kept = JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[],"queue":[]}');
        return !kept.rooms.some((held) => held.origin === 'stream' && held.hostId === 'drive-user' && held.endedAt === null);
      },
      null,
      { timeout: 20000 },
    );
    await sleep(2500);
    const home = await mine();
    assert.deepEqual(home.waiting, live[0].waiting, 'your own queue is what was still waiting in the live room');
    assert.equal(home.on, live[0].on, 'what was on is on in your own room');
    pass(`END STREAM: your own queue is what was left (${home.waiting.length} waiting), and what was on is on in your room`);
    if (songOn) {
      const after = await audio(page);
      const endJolts = await jolts();
      assert.ok(!after.paused && after.src === atEnd.src && after.time > atEnd.time, `the song carries on for you alone (${atEnd.time.toFixed(1)}s -> ${after.time.toFixed(1)}s)`);
      assert.deepEqual(endJolts, { seeks: 0, pauses: 0 }, `and was never moved or stopped (${JSON.stringify(endJolts)})`);
      assert.ok(home.isPlaying && Math.abs(home.position - atEnd.time) < 8, `your room says where it has got to (${home.position}s)`);
      pass(`the song carried on with no gap after END STREAM (${atEnd.time.toFixed(1)}s -> ${after.time.toFixed(1)}s)`);
    } else {
      await page.waitForSelector('[data-floating-player]', { timeout: 15000 });
      pass('the video carried on in the floating player after END STREAM');
    }
    await page.waitForSelector('[data-go-live-key]', { timeout: 10000 });
    pass('GO LIVE is back on the bar');
    await page.screenshot({ path: join(SHOTS, 'go-live-ended.png') });

    console.log('THE PRIVACY PAGE');
    await page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('Your room: what you are playing and your queue are saved to your account'), null, { timeout: 30000 });
    pass('the privacy page has the room line');

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
