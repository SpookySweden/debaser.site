/*
 * One account on two devices in your own room (Luke, 2026-11-27: "issues with my streams being synced on multiple devices logged
 * into the same account, they dont seem to try to be synced"; his answers 1A "last one touched", 2A "follow live"). Two tabs of one
 * browser signed in to the same mock account are two devices to the room: each has its own key in the room's presence, as a PC and
 * a laptop do, and the mock store carries the room's writes between them as Realtime does.
 *
 *   1. Device A plays a video in your room; device B opens and FOLLOWS it (same video, same place, playing). Exactly one leads.
 *   2. A press on B's player (pause) is B's: B leads, and A pauses with it.
 *   3. A jump on B (to 1:30): A jumps there too.
 *   4. A press on A (play): A leads again, and B plays with it.
 *   5. PLAY on another video in FILES on B: both devices put it on.
 *   6. [ ◀◀ ] in the room on A: both go back to the first video.
 *   7. Your room with no window open (2A): B's bar follows A's bar (a song put on, paused, played).
 *      Then the bar's volume follows both ways, and a tab opened after takes it (Luke, 2026-11-27: "Yes, it follows"; "Take current volume on join").
 *   9. The room's speaker key (volume line, MUTE) on either device moves the other's sound, and nothing else's (Luke, 2026-11-27);
 *      a device that comes in after takes the sound the others have.
 *  10. YouTube in the room: a pause inside its own player, the room's PLAY and the speaker key follow between the devices.
 *  11. LUKE'S SERVER (a stand-in speaking the bridge's remote): the same.
 *
 *   node scripts/drive-same-account.cjs --base http://localhost:3317   (--only-players for 9-11, --only-bar for 7)
 *
 * Start the server with every data source on mock and Supabase EMPTY (`node scripts/dev-mock-live.cjs 3317`), so nothing reaches
 * the live database. Nothing is fetched from the network for the media: the drive answers its own test sound (a quiet three-minute
 * tone, made here) at a made-up address.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3317';
const SHOTS = join('Temp', 'browse', 'same-account');
mkdirSync(SHOTS, { recursive: true });

/** A quiet tone as a WAV file, `seconds` long (8 kHz, 8-bit mono): long enough to pause and jump in. */
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
const LONG_TWO = tone(180, 330);
const SOUND = 'https://drive-media.example.org/same-account';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const item = (id, title, file) =>
  `{ id: '${id}', kind: 'video', bucket: '', path: '', src: '${SOUND}/${file}', sha256: '${id}', bytes: 1, mime: 'video/webm', length: '3:00', title: '${title}', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => !String(held.id).startsWith('same-account-'));
    items.push(${item('same-account-1', 'SAME ACCOUNT ONE', 'one.wav')}, ${item('same-account-2', 'SAME ACCOUNT TWO', 'two.wav')});
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
  } catch {}
})()`;

const tables = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}'));
const ownRoom = async (page) => (await tables(page)).rooms.find((room) => room.origin === 'music' && room.originalHostId === 'drive-user' && room.endedAt === null) ?? null;
/** The room window's player on this device: its file, place, whether it plays, and whether this device leads (`host`). */
const stage = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    return video === null ? null : { src: video.currentSrc || video.src, time: video.currentTime, paused: video.paused, role: video.getAttribute('data-watch-video') };
  });
const onStage = async (page) => {
  const held = await stage(page);
  return held === null ? 'no player' : `${held.src.split('/').pop()} ${held.time.toFixed(1)}s ${held.paused ? 'paused' : 'playing'} (${held.role})`;
};

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
/** PLAY on a row of FILES' video list, pressed in the page itself. */
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
/** Waits for `check(stage)` on this device, saying what it saw when it gives up. */
/** The drive's own test sounds, answered in ranges as a real file server does: a browser can jump only in a file it may ask for part of. */
async function serveMedia(context) {
  await context.route(/drive-media\.example\.org/, (route) => {
    const body = /two\.wav$/.test(route.request().url()) ? LONG_TWO : LONG;
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    if (range === null) return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body });
    const from = Number(range[1]);
    const to = range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { ...headers, 'Content-Range': `bytes ${from}-${to}/${body.length}` }, body: body.subarray(from, to + 1) });
  });
}

/* --- 7: the music bar, with no room window (2A) --------------------------------------------------------------------- */

/** Keeps hold of the bar's one audio element, which is made outside the page's tree (as drive-own-room.cjs). */
const HOOK = `(() => {
  const Orig = window.Audio;
  window.__audios = [];
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
})()`;
/** Two songs on the mock shelf, the drive's own tones. */
const SHELF = `(() => {
  try {
    const track = (n, file) => ({ id: 'same-account-tone-' + n, title: 'SAME TONE ' + n, credit: 'THE DRIVE', kind: 'TEST', src: '${SOUND}/' + file, length: '3:00', tags: [], folderPath: null, shelf: 'bucket' });
    localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ tracks: [track(1, 'tone-one.wav'), track(2, 'tone-two.wav')] }));
  } catch {}
})()`;
const bar = (page) =>
  page.evaluate(() => {
    const element = window.__audios[window.__audios.length - 1];
    return element ? { file: element.src.split('/').pop(), time: element.currentTime, paused: element.paused, volume: element.volume } : null;
  });
const onBar = async (page) => {
  const held = await bar(page);
  return held === null ? 'no bar' : `${held.file} ${held.time.toFixed(1)}s ${held.paused ? 'paused' : 'playing'}`;
};
/** The music bar's own volume line (0-100), not the room's. */
const BAR_SLIDER = `[...document.querySelectorAll('input[aria-label="Volume"]')].find((held) => held.closest('[data-dock-window="stream"], [data-stream-bar]') === null && held.offsetParent !== null)`;
const setBarVolume = (page, value) =>
  page.evaluate(([wanted, find]) => {
    const input = eval(find);
    if (input === undefined) throw new Error('no bar volume line');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(wanted));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value, BAR_SLIDER]);
async function barVolumeUntil(page, wanted) {
  await page.waitForFunction(([value, find]) => {
    const input = eval(find);
    return input !== undefined && Number(input.value) === value;
  }, [wanted, BAR_SLIDER], { timeout: 8000 });
}
async function barUntil(page, what, check, timeout = 10000) {
  const end = Date.now() + timeout;
  let held = null;
  while (Date.now() < end) {
    held = await bar(page);
    if (held !== null && check(held)) return held;
    await sleep(250);
  }
  throw new Error(`${what}: never happened (last: ${held === null ? 'no bar' : JSON.stringify(held)})`);
}
/** The bar's middle key (it walks playing -> paused -> looping), pressed until the sound is what the step wants. */
async function barKeyUntil(page, wantPaused) {
  for (let presses = 0; presses < 5; presses += 1) {
    const now = await bar(page);
    if (now !== null && now.paused === wantPaused) return;
    await page.evaluate(() => document.querySelector('button[aria-label="Previous track"]').parentElement.querySelectorAll('button')[1].click());
    await sleep(700);
  }
  throw new Error(`the bar's middle key never ${wantPaused ? 'paused' : 'played'} it (${await onBar(page)})`);
}

async function barStep(browser, errors) {
  console.log('7. YOUR ROOM ON THE MUSIC BAR, NO WINDOW (2A)');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.addInitScript(SHELF);
  await context.addInitScript(HOOK);
  if (process.env.DRIVE_DEBUG) {
    await context.addInitScript(() => {
      for (const name of ['play', 'pause']) {
        const original = HTMLMediaElement.prototype[name];
        HTMLMediaElement.prototype[name] = function (...rest) {
          if (this instanceof HTMLAudioElement) console.log('[lead] media ' + name, (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).map((line) => line.trim().replace(/(http[^)]*)/, '')).join(' < '));
          return original.apply(this, rest);
        };
      }
    });
  }
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => route.abort());
  await serveMedia(context);
  try {
    const a = await context.newPage();
    a.on('pageerror', (error) => errors.push(`bar A: ${error.message}`));
    if (process.env.DRIVE_DEBUG) a.on('console', (message) => message.text().startsWith('[lead]') && console.log('    A', message.text().slice(0, 160)));
    await open(a, '/forum');
    await a.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await barKeyUntil(a, false);
    await barUntil(a, 'A plays the first song', (held) => !held.paused && held.time > 3, 15000);
    const b = await context.newPage();
    b.on('pageerror', (error) => errors.push(`bar B: ${error.message}`));
    if (process.env.DRIVE_DEBUG) b.on('console', (message) => message.text().startsWith('[lead]') && console.log('    B', message.text().slice(0, 160)));
    await open(b, '/forum');
    await b.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    // A page that opens finds your room paused where it is (a browser allows no sound without a press): on the same song.
    await barUntil(b, 'B has the same song', (held) => held.file === 'tone-one.wav', 15000);
    console.log(`    A: ${await onBar(a)}   B: ${await onBar(b)}`);

    await barKeyUntil(a, true);
    await barKeyUntil(a, false);
    const heardB = await barUntil(b, 'B plays along when A plays', (held) => !held.paused, 8000);
    const heardA = await bar(a);
    console.log(`    A: ${await onBar(a)}   B: ${await onBar(b)}`);
    assert.ok(Math.abs(heardA.time - heardB.time) < 2.5, `B is where A is (${heardA.time.toFixed(1)}s and ${heardB.time.toFixed(1)}s)`);
    pass('A played the bar: B, which had opened paused, played along at the same place');

    await barKeyUntil(b, true);
    await barUntil(a, 'A pauses with B', (held) => held.paused, 8000);
    pass('pausing the bar on B paused A');

    await barKeyUntil(b, false);
    await barUntil(a, 'A plays with B', (held) => !held.paused, 8000);
    await b.evaluate(() => document.querySelector('button[aria-label="Next track"]').click());
    await barUntil(a, 'A moves on to the second song', (held) => held.file === 'tone-two.wav', 10000);
    await barUntil(b, 'B is on the second song', (held) => held.file === 'tone-two.wav', 10000);
    console.log(`    A: ${await onBar(a)}   B: ${await onBar(b)}`);
    pass('NEXT on B\'s bar moved A on to the same song');

    await setBarVolume(a, 35);
    await barUntil(b, 'B\'s bar goes to 35% with A', (held) => near(held.volume, 0.35), 8000);
    await barVolumeUntil(b, 35);
    await setBarVolume(b, 60);
    await barUntil(a, 'A\'s bar goes to 60% with B', (held) => near(held.volume, 0.6), 8000);
    pass('the bar\'s volume moved on A moved B\'s, and back the other way');
    await setBarVolume(a, 25);
    await barUntil(b, 'B\'s bar at 25%', (held) => near(held.volume, 0.25), 8000);
    const c = await context.newPage();
    c.on('pageerror', (error) => errors.push(`bar C: ${error.message}`));
    await open(c, '/forum');
    await c.waitForFunction(() => window.__audios.length > 0, null, { timeout: 20000 });
    await barUntil(c, 'C, opened after, takes 25%', (held) => near(held.volume, 0.25), 12000);
    await barVolumeUntil(c, 25);
    pass('a tab opened after came in with the bar at 25%, the volume the others had');
  } catch (error) {
    for (const [index, page] of context.pages().entries()) console.error(`    ${index === 0 ? 'A' : 'B'}: ${await onBar(page).catch(() => '?')}`);
    throw error;
  } finally {
    await context.close();
  }
}

/* --- 8: LUKE'S SERVER (Jellyfin) kept in step (3A), with --jellyfin <a local copy of the bridge> --------------------------- */

/** Jellyfin's player inside this page's server frame: where it is, or null before it has one. */
async function jellyfin(page) {
  const frame = page.frames().find((candidate) => candidate.url().startsWith('https://media.debaser.site/web/'));
  if (frame === undefined) return null;
  return frame.evaluate(() => {
    const video = document.querySelector('video');
    return video === null ? null : { time: video.currentTime, paused: video.paused, ready: video.readyState, src: (video.currentSrc || video.src).slice(0, 120), error: video.error && video.error.code };
  }).catch(() => null);
}
async function jellyfinUntil(page, what, check, timeout) {
  const end = Date.now() + timeout;
  let held = null;
  while (Date.now() < end) {
    held = await jellyfin(page);
    if (held !== null && check(held)) return held;
    await sleep(500);
  }
  throw new Error(`${what}: never happened (last: ${JSON.stringify(held)})`);
}
/** The room's own play/pause key on this device, pressed in the page. */
/** (The key's word follows the player a moment after it changes, so it is waited for, up to five seconds.) */
const pressRoomKey = async (page, label) => {
  await page
    .waitForFunction((wanted) => [...document.querySelectorAll(`button[aria-label="${wanted}"]`)].some((button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null), label, { timeout: 5000 })
    .catch(() => undefined);
  return page.evaluate((wanted) => {
    const key = [...document.querySelectorAll(`button[aria-label="${wanted}"]`)].find((button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null);
    if (key === undefined) {
      const there = [...document.querySelectorAll('[data-dock-window="stream"] button[aria-label], [data-stream-bar] button[aria-label]')].map((button) => button.getAttribute('aria-label'));
      throw new Error(`no ${wanted} key (the room's keys here: ${there.join(', ')})`);
    }
    key.click();
  }, label);
};

async function jellyfinStep(browser, errors, bridge) {
  console.log("8. LUKE'S SERVER (JELLYFIN) ON BOTH DEVICES (3A)");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => route.abort());
  await serveMedia(context);
  // The server's pages come from the local copy of the bridge (it lets this local site frame them and carries the new remote);
  // the film itself, pictures and Jellyfin's code come from the live bridge as they do for everyone.
  // Only those pages are caught: a film's ranged requests stall when a browser's requests are caught (seen here, 2026-11-27).
  await context.route(/^https:\/\/media\.debaser\.site\/(web\/(index\.html)?([?#].*)?$|debaser\/)/, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${bridge}${url.pathname}${url.search}` });
    return route.fulfill({ response });
  });
  const film = { url: 'https://media.debaser.site/debaser/play/movie/10378', kind: 'embed', title: 'BIG BUCK BUNNY' };
  try {
    const a = await context.newPage();
    a.on('pageerror', (error) => errors.push(`server A: ${error.message}`));
    await open(a, '/files?kind=video');
    await pressPlay(a, 'SAME ACCOUNT ONE');
    await until(a, 'A has its room', (held) => held.src.endsWith('one.wav'), 20000);
    // The film is put on in the room as KINO's WATCH key puts it there: a queue row with the server's address, on now.
    await a.evaluate((link) => {
      const tables = JSON.parse(localStorage.getItem('debaser.watch.v1'));
      const room = tables.rooms.find((held) => held.origin === 'music' && held.endedAt === null);
      const at = new Date().toISOString();
      const id = crypto.randomUUID();
      tables.queue.push({ id, roomId: room.id, position: 99, inQueue: true, mediaItemId: null, link, series: null, addedBy: room.hostId, addedAt: at, playedAt: at, playIndex: 9 });
      Object.assign(room, { currentEntryId: id, positionSeconds: 0, isPlaying: false, updatedAt: at });
      localStorage.setItem('debaser.watch.v1', JSON.stringify(tables));
    }, film);
    await a.reload({ waitUntil: 'domcontentloaded' });
    await a.waitForSelector('[data-server-remote="on"]', { timeout: 60000 });
    const b = await context.newPage();
    b.on('pageerror', (error) => errors.push(`server B: ${error.message}`));
    await open(b, '/files?kind=video');
    await b.waitForSelector('[data-server-remote="on"]', { timeout: 60000 });
    pass('both devices\' server frames said hello: the room drives Jellyfin');

    await pressRoomKey(a, 'Play');
    const heardA = await jellyfinUntil(a, 'Jellyfin plays on A', (held) => !held.paused && held.time > 1, 60000);
    const heardB = await jellyfinUntil(b, 'Jellyfin plays on B', (held) => !held.paused && held.time > 1, 60000);
    await sleep(4000);
    const [nowA, nowB] = [await jellyfin(a), await jellyfin(b)];
    console.log(`    A: ${nowA.time.toFixed(1)}s ${nowA.paused ? 'paused' : 'playing'}   B: ${nowB.time.toFixed(1)}s ${nowB.paused ? 'paused' : 'playing'}   (first heard ${heardA.time.toFixed(1)} / ${heardB.time.toFixed(1)})`);
    assert.ok(Math.abs(nowA.time - nowB.time) < 3, `together (${nowA.time.toFixed(1)}s and ${nowB.time.toFixed(1)}s)`);
    pass('PLAY on A started the film in Jellyfin on both devices, together');

    await pressRoomKey(b, 'Pause');
    await jellyfinUntil(a, 'A pauses with B', (held) => held.paused, 10000);
    pass('PAUSE on B paused Jellyfin on A');

    // A jump made in Jellyfin's own player on B (its own seek bar does this to its video).
    const frameB = b.frames().find((candidate) => candidate.url().startsWith('https://media.debaser.site/web/'));
    await frameB.evaluate(() => {
      document.querySelector('video').currentTime = 300;
    });
    await jellyfinUntil(a, 'A jumps to 5:00 with B', (held) => Math.abs(held.time - 300) < 3, 20000);
    pass("a jump to 5:00 in Jellyfin's own player on B moved Jellyfin on A there too");

    // And A's room key plays both again from there.
    await pressRoomKey(a, 'Play');
    await jellyfinUntil(b, 'B plays on from 5:00 with A', (held) => !held.paused && held.time > 300, 20000);
    pass('PLAY on A played both on from 5:00');
    await a.screenshot({ path: join(SHOTS, 'server-a.png') });
  } finally {
    await context.close();
  }
}

/* --- 9-11: the speaker key follows your devices, and play/pause on YouTube and LUKE'S SERVER (Luke, 2026-11-27: "when two of the
   same account are watching media in a room, make sure the pause play and volume controls are all synced") ---------------------- */

/**
 * YouTube's IFrame Player API, stood in for: a player that keeps its own clock, takes play, pause, jumps and the volume as YouTube's
 * does and says its state the same way. Each one made is kept on `window.__yt` so the drive can read it and press inside it.
 */
const FAKE_YT = `(() => {
  window.__yt = [];
  const STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 };
  window.YT = {
    PlayerState: STATE,
    Player: function (element, options) {
      const player = this;
      let base = 0, since = null, volume = 100, muted = false, gone = false;
      const now = () => (since === null ? base : base + (Date.now() - since) / 1000);
      const say = (data) => setTimeout(() => !gone && options.events.onStateChange({ data }), 30);
      Object.assign(player, {
        videoId: options.videoId,
        playVideo() { if (since === null) { since = Date.now(); say(STATE.playing); } },
        pauseVideo() { if (since !== null) { base = now(); since = null; say(STATE.paused); } },
        seekTo(seconds) { base = seconds; if (since !== null) since = Date.now(); },
        getCurrentTime: now,
        getDuration: () => 600,
        setVolume(next) { volume = next; },
        mute() { muted = true; },
        unMute() { muted = false; },
        setPlaybackRate() {},
        getVideoData: () => ({ isLive: false }),
        destroy() { gone = true; since = null; },
        state: () => ({ time: now(), paused: since === null, volume, muted, gone }),
      });
      const frame = document.createElement('iframe');
      frame.setAttribute('data-fake-youtube', options.videoId);
      element.replaceWith(frame);
      window.__yt.push(player);
      setTimeout(() => !gone && options.events.onReady(), 50);
    },
  };
  const ready = window.onYouTubeIframeAPIReady;
  if (typeof ready === 'function') ready();
})()`;

/**
 * LUKE'S SERVER, stood in for: a page at the server's address that speaks the bridge's remote (app/lib/watch/jellyfin-player.ts)
 * over a plain player of the drive's own tone, so the room drives it as it drives Jellyfin.
 */
const SERVER_PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<video id="v" src="${SOUND}/server.wav" style="width:100%;height:100%"></video>
<script>
  const video = document.getElementById('v');
  const say = (event) => parent.postMessage({ debaser: 'debaser-jellyfin', event, ready: video.readyState > 0, time: video.currentTime, duration: video.duration || 0, paused: video.paused, ended: video.ended }, '*');
  for (const event of ['play', 'playing', 'pause', 'seeked', 'ended', 'waiting']) video.addEventListener(event, () => say(event));
  setInterval(() => say('time'), 500);
  addEventListener('message', (message) => {
    const order = message.data;
    if (!order || order.debaser !== 'debaser-jellyfin') return;
    if (order.cmd === 'play') video.play().catch(() => say('blocked'));
    if (order.cmd === 'pause') video.pause();
    if (order.cmd === 'seek') video.currentTime = order.seconds;
    if (order.cmd === 'rate') video.playbackRate = order.rate;
    if (order.cmd === 'volume') { video.volume = order.volume; video.muted = order.muted; }
    if (order.cmd === 'state') say('state');
  });
  say('hello');
</script></body></html>`;

/** The room's own volume line on this device (the room window's, or the room's keys on the music bar). */
const slider = (page) =>
  page.evaluate(() => {
    const input = [...document.querySelectorAll('input[aria-label="Volume"]')].find((held) => held.closest('[data-dock-window="stream"], [data-stream-bar]') !== null && held.offsetParent !== null);
    return input === undefined ? null : Number(input.value);
  });
/** Moves this device's volume line to `value`, as a hand on it does. */
const setSlider = (page, value) =>
  page.evaluate((wanted) => {
    const input = [...document.querySelectorAll('input[aria-label="Volume"]')].find((held) => held.closest('[data-dock-window="stream"], [data-stream-bar]') !== null && held.offsetParent !== null);
    if (input === undefined) throw new Error('no volume line');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(wanted));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
/** The room's file player's sound on this device. */
const sound = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    return video === null ? null : { volume: video.volume, muted: video.muted };
  });
async function waitFor(what, read, check, timeout = 8000) {
  const end = Date.now() + timeout;
  let held = null;
  while (Date.now() < end) {
    held = await read();
    if (held !== null && check(held)) return held;
    await sleep(250);
  }
  throw new Error(`${what}: never happened (last: ${JSON.stringify(held)})`);
}
const near = (a, b) => Math.abs(a - b) < 0.02;
/** The newest stand-in YouTube player on this device. */
const youtube = (page) => page.evaluate(() => (window.__yt && window.__yt.length > 0 ? window.__yt[window.__yt.length - 1].state() : null));
/** The stand-in server's player on this device. */
async function server(page) {
  const frame = page.frames().find((candidate) => candidate.url().startsWith('https://media.debaser.site/debaser/'));
  if (frame === undefined) return null;
  return frame.evaluate(() => {
    const video = document.getElementById('v');
    return video === null ? null : { time: video.currentTime, paused: video.paused, volume: video.volume, muted: video.muted };
  }).catch(() => null);
}
/** Puts `link` on in your room now, playing, as a PLAY in the page does, and tells every tab the room changed. */
const putOnNow = (page, link) =>
  page.evaluate((wanted) => {
    const tables = JSON.parse(localStorage.getItem('debaser.watch.v1'));
    const room = tables.rooms.find((held) => held.origin === 'music' && held.endedAt === null);
    const at = new Date().toISOString();
    const id = crypto.randomUUID();
    tables.queue.push({ id, roomId: room.id, position: 99, inQueue: true, mediaItemId: null, link: wanted, series: null, addedBy: room.hostId, addedAt: at, playedAt: at, playIndex: 9 });
    Object.assign(room, { currentEntryId: id, positionSeconds: 0, isPlaying: true, updatedAt: at });
    localStorage.setItem('debaser.watch.v1', JSON.stringify(tables));
    const wire = new BroadcastChannel('debaser-watch');
    wire.postMessage({ type: 'changed', roomId: room.id });
    wire.close();
  }, link);

async function playersStep(browser, errors) {
  console.log('9. THE SPEAKER KEY FOLLOWS YOUR DEVICES (a file)');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => route.abort());
  await serveMedia(context);
  await context.route(/^https:\/\/www\.youtube\.com\/iframe_api/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_YT }));
  await context.route(/^https:\/\/www\.youtube\.com\/oembed/, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"title":"A YOUTUBE VIDEO","width":640,"height":360}' }));
  await context.route(/^https:\/\/(i\.ytimg\.com|www\.youtube-nocookie\.com)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(/^https:\/\/media\.debaser\.site\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: SERVER_PAGE }));
  try {
    const a = await context.newPage();
    a.on('pageerror', (error) => errors.push(`players A: ${error.message}`));
    await open(a, '/files?kind=video');
    await pressPlay(a, 'SAME ACCOUNT ONE');
    await until(a, 'A plays the first video', (held) => held.src.endsWith('one.wav') && !held.paused, 20000);
    const b = await context.newPage();
    b.on('pageerror', (error) => errors.push(`players B: ${error.message}`));
    await open(b, '/files?kind=video');
    await until(b, 'B has the first video', (held) => held.src.endsWith('one.wav'), 20000);
    // Both devices hear each other in the room's presence first (a device alone keeps its own line shut).
    await sleep(2500);

    await setSlider(a, 0.4);
    await waitFor('B\'s sound goes to 0.4 with A', () => sound(b), (held) => near(held.volume, 0.4) && !held.muted);
    await waitFor('B\'s volume line shows 0.4', () => slider(b), (held) => near(held, 0.4));
    pass('the volume line moved on A: B\'s sound and B\'s line went there too');

    await pressRoomKey(a, 'Mute');
    await waitFor('B mutes with A', () => sound(b), (held) => held.muted);
    await pressRoomKey(b, 'Unmute');
    await waitFor('A unmutes with B', () => sound(a), (held) => !held.muted && near(held.volume, 0.4));
    pass('MUTE on A muted B, and UNMUTE on B brought A\'s sound back');

    await setSlider(b, 0.7);
    await waitFor('A\'s sound goes to 0.7 with B', () => sound(a), (held) => near(held.volume, 0.7));
    // What is not yours or not this room's never moves it: a word for another room on your line, and a word on another account's line.
    await a.evaluate(() => {
      const mine = new BroadcastChannel('debaser-watch:account:drive-user');
      mine.postMessage({ kind: 'volume', roomId: 'another-room', volume: 0.1, muted: false });
      mine.close();
      const theirs = new BroadcastChannel('debaser-watch:account:somebody-else');
      theirs.postMessage({ kind: 'volume', roomId: 'any', volume: 0.1, muted: true });
      theirs.close();
    });
    await sleep(1500);
    const kept = [await sound(a), await sound(b)];
    assert.ok(kept.every((held) => near(held.volume, 0.7) && !held.muted), `nobody else's word moved it (${JSON.stringify(kept)})`);
    assert.equal((await stage(a)).paused || (await stage(b)).paused, false, 'the volume never paused either device');
    pass('B\'s line moved A; a word for another room, or on another account\'s line, moved neither');

    // Luke's answer, "Take current volume on join": A goes to 20% and mutes, then a third device comes in.
    await setSlider(a, 0.2);
    await pressRoomKey(a, 'Mute');
    await waitFor('B has 20% and muted from A', () => sound(b), (held) => near(held.volume, 0.2) && held.muted);
    const c = await context.newPage();
    c.on('pageerror', (error) => errors.push(`players C: ${error.message}`));
    await open(c, '/files?kind=video');
    await until(c, 'C has the first video', (held) => held.src.endsWith('one.wav'), 20000);
    await waitFor('C, which came in after, takes 20% and muted', () => sound(c), (held) => near(held.volume, 0.2) && held.muted, 12000);
    await waitFor('C\'s volume line shows it muted', () => slider(c), (held) => held === 0);
    pass('a device that came in after A had 20% and muted came in at 20% and muted');
    await c.close();
    await sleep(2500);
    await pressRoomKey(a, 'Unmute');
    await setSlider(a, 0.7);
    await waitFor('B back at 0.7 and unmuted', () => sound(b), (held) => near(held.volume, 0.7) && !held.muted);

    console.log('10. YOUTUBE ON BOTH DEVICES');
    await putOnNow(a, { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', kind: 'youtube', title: 'A YOUTUBE VIDEO' });
    await waitFor('A\'s YouTube plays', () => youtube(a), (held) => !held.gone && !held.paused && held.time > 1, 20000);
    await waitFor('B\'s YouTube plays', () => youtube(b), (held) => !held.gone && !held.paused && held.time > 1, 20000);
    assert.equal((await youtube(b)).volume, 70, 'B\'s YouTube took the room\'s volume');
    // A press inside YouTube's own player on B (its play key does this to its player).
    await b.evaluate(() => window.__yt[window.__yt.length - 1].pauseVideo());
    await waitFor('A\'s YouTube pauses with B', () => youtube(a), (held) => held.paused, 8000);
    pass('a pause inside YouTube\'s own player on B paused YouTube on A');
    await pressRoomKey(a, 'Play');
    await waitFor('B\'s YouTube plays with A', () => youtube(b), (held) => !held.paused, 8000);
    pass('PLAY on A\'s room key played YouTube on B');
    await setSlider(a, 0.3);
    await waitFor('B\'s YouTube goes to 30 with A', () => youtube(b), (held) => held.volume === 30, 8000);
    await pressRoomKey(b, 'Mute');
    await waitFor('A\'s YouTube mutes with B', () => youtube(a), (held) => held.muted, 8000);
    await pressRoomKey(b, 'Unmute');
    await waitFor('A\'s YouTube unmutes with B', () => youtube(a), (held) => !held.muted, 8000);
    pass('the volume line and MUTE moved YouTube on the other device');

    console.log("11. LUKE'S SERVER ON BOTH DEVICES (a stand-in that speaks the bridge's remote)");
    await putOnNow(a, { url: 'https://media.debaser.site/debaser/play/movie/7', kind: 'embed', title: 'A FILM ON THE SERVER' });
    await a.waitForSelector('[data-server-remote="on"]', { timeout: 30000 });
    await b.waitForSelector('[data-server-remote="on"]', { timeout: 30000 });
    await waitFor('A\'s server player plays', () => server(a), (held) => !held.paused && held.time > 1, 20000);
    await waitFor('B\'s server player plays', () => server(b), (held) => !held.paused && held.time > 1, 20000);
    assert.ok(near((await server(b)).volume, 0.3), 'B\'s server player took the room\'s volume');
    const frameB = b.frames().find((candidate) => candidate.url().startsWith('https://media.debaser.site/debaser/'));
    await frameB.evaluate(() => document.getElementById('v').pause());
    await waitFor('A\'s server player pauses with B', () => server(a), (held) => held.paused, 10000);
    pass('a pause inside the server\'s own player on B paused it on A');
    await pressRoomKey(a, 'Play');
    await waitFor('B\'s server player plays with A', () => server(b), (held) => !held.paused, 10000);
    pass('PLAY on A\'s room key played the server\'s player on B');
    await setSlider(b, 0.55);
    await waitFor('A\'s server player goes to 0.55 with B', () => server(a), (held) => near(held.volume, 0.55), 8000);
    pass('the volume line on B moved the server\'s player on A');
    await a.screenshot({ path: join(SHOTS, 'players-a.png') });
  } finally {
    await context.close();
  }
}

async function until(page, what, check, timeout = 10000) {
  const end = Date.now() + timeout;
  let held = null;
  while (Date.now() < end) {
    held = await stage(page);
    if (held !== null && check(held)) return held;
    await sleep(250);
  }
  throw new Error(`${what}: never happened (last: ${held === null ? 'no player' : JSON.stringify(held)})`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  const blocked = [];
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  await serveMedia(context);
  const a = await context.newPage();
  const errors = [];
  a.on('pageerror', (error) => errors.push(`A: ${error.message}`));
  if (process.env.DRIVE_DEBUG) a.on('console', (message) => message.text().startsWith('[lead]') && console.log('    A', message.text()));

  try {
    if (args.includes('--jellyfin')) {
      await jellyfinStep(browser, errors, args[args.indexOf('--jellyfin') + 1]);
      console.log(`\nPASSED ${passed}`);
      return;
    }
    if (args.includes('--only-players')) {
      await playersStep(browser, errors);
      assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
      console.log(`\nPASSED ${passed}`);
      return;
    }
    if (args.includes('--only-bar')) {
      await barStep(browser, errors);
      console.log(`
PASSED ${passed}`);
      return;
    }
    console.log('1. DEVICE B FOLLOWS DEVICE A');
    await open(a, '/files?kind=video');
    await pressPlay(a, 'SAME ACCOUNT ONE');
    await until(a, 'A plays the first video', (held) => held.src.endsWith('one.wav') && !held.paused && held.time > 3, 20000);
    const b = await context.newPage();
    b.on('pageerror', (error) => errors.push(`B: ${error.message}`));
    if (process.env.DRIVE_DEBUG) b.on('console', (message) => message.text().startsWith('[lead]') && console.log('    B', message.text()));
    await open(b, '/files?kind=video');
    // Your room's window comes back open on a page that opens (it was open on A): B's room window, with the same video.
    await until(b, 'B has the first video', (held) => held.src.endsWith('one.wav'), 20000);
    for (let tick = 0; tick < 8; tick += 1) {
      await sleep(500);
      if (process.env.DRIVE_DEBUG) { const room = await ownRoom(a); console.log(`    A: ${await onStage(a)}   B: ${await onStage(b)}   room ${room.positionSeconds.toFixed(1)} ${room.isPlaying}`); }
    }
    const [heldA, heldB] = [await stage(a), await stage(b)];
    console.log(`    A: ${await onStage(a)}   B: ${await onStage(b)}`);
    assert.ok(!heldA.paused && !heldB.paused, 'both play');
    assert.ok(Math.abs(heldA.time - heldB.time) < 2, `B is where A is (${heldA.time.toFixed(1)}s and ${heldB.time.toFixed(1)}s)`);
    assert.ok(heldA.time > 6, `A carried on from where it was, not from the top (${heldA.time.toFixed(1)}s)`);
    assert.deepEqual([heldA.role, heldB.role], ['host', 'viewer'], 'A leads, B follows');
    pass('B opened on the same video, at the same place, playing, and follows A');

    console.log('2. A PRESS ON B LEADS');
    await b.evaluate(() => document.querySelector('[data-dock-window="stream"] video[data-watch-video]').pause());
    await until(a, 'A pauses with B', (held) => held.paused, 6000);
    await sleep(1500);
    console.log(`    A: ${await onStage(a)}   B: ${await onStage(b)}`);
    assert.equal((await stage(b)).paused, true, 'B stays paused');
    assert.equal((await ownRoom(a)).isPlaying, false, 'the room says paused');
    assert.deepEqual([(await stage(a)).role, (await stage(b)).role], ['viewer', 'host'], 'B leads now');
    pass('pausing on B paused A, and B leads');

    console.log('3. A JUMP ON B');
    await b.evaluate(() => {
      document.querySelector('[data-dock-window="stream"] video[data-watch-video]').currentTime = 90;
    });
    await until(a, 'A jumps to 1:30', (held) => Math.abs(held.time - 90) < 2, 6000);
    pass('jumping to 1:30 on B moved A there too');

    console.log('4. A PRESS ON A LEADS AGAIN');
    await a.evaluate(() => void document.querySelector('[data-dock-window="stream"] video[data-watch-video]').play());
    await until(b, 'B plays with A', (held) => !held.paused, 6000);
    await sleep(2500);
    const [againA, againB] = [await stage(a), await stage(b)];
    console.log(`    A: ${await onStage(a)}   B: ${await onStage(b)}`);
    assert.ok(Math.abs(againA.time - againB.time) < 2, 'together');
    assert.deepEqual([againA.role, againB.role], ['host', 'viewer'], 'A leads again');
    pass('pressing play on A played B, and A leads again');

    console.log('5. PLAY ON ANOTHER VIDEO, ON B');
    await pressPlay(b, 'SAME ACCOUNT TWO');
    await until(a, 'A puts the second video on', (held) => held.src.endsWith('two.wav') && !held.paused, 15000);
    await until(b, 'B has the second video', (held) => held.src.endsWith('two.wav') && !held.paused, 15000);
    await sleep(2500);
    console.log(`    A: ${await onStage(a)}   B: ${await onStage(b)}`);
    assert.ok(Math.abs((await stage(a)).time - (await stage(b)).time) < 2, 'together on the second');
    pass('PLAY in FILES on B put the second video on both devices');

    console.log('6. [ ◀◀ ] ON A');
    await a.waitForSelector('[data-room-back]:not([disabled])', { timeout: 10000 });
    await a.evaluate(() => document.querySelector('[data-room-back]').click());
    await until(b, 'B goes back to the first video', (held) => held.src.endsWith('one.wav') && !held.paused, 15000);
    await until(a, 'A is on the first video', (held) => held.src.endsWith('one.wav'), 15000);
    pass('the room\'s back key on A took both devices back to the first video');
    await a.screenshot({ path: join(SHOTS, 'a.png') });
    await b.screenshot({ path: join(SHOTS, 'b.png') });
    await context.close();

    await barStep(browser, errors);
    await playersStep(browser, errors);

    assert.deepEqual(blocked, [], 'nothing reached the live database');
    assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
    console.log(`\nPASSED ${passed}`);
  } catch (error) {
    console.error(`\nFAILED after ${passed}: ${error.message}`);
    try {
      for (const page of context.pages()) console.error(`    ${page === a ? 'A' : 'B'}: ${await onStage(page)}`);
      const room = await ownRoom(a);
      console.error(`    room: ${room.positionSeconds} ${room.isPlaying ? 'playing' : 'paused'} on ${room.currentEntryId}`);
      await a.screenshot({ path: join(SHOTS, 'fail-a.png') });
    } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
