/*
 * Two devices of one account when one has NOT been touched (Luke, 2026-11-28: "video and control going out of sync when one is
 * paused or muted and the video not waking up automatically when clicked play on another signed in device").
 *
 * drive-same-account.cjs launches Chrome with every autoplay allowed and reads both tabs with Playwright, whose reads count as a
 * touch. This drive keeps the browser's real rule (a page nobody has touched may not start a video with sound) and reads device B
 * only through the debugger with `userGesture: false`, so B stays untouched until a step says otherwise. Each tab has its own
 * "touched" state, as two devices do.
 *
 *   node scripts/drive-device-wake.cjs --base http://localhost:3341 [--only file|server|bar|youtube|allowed]
 *
 * Start the server with every data source on mock (`node scripts/dev-mock-live.cjs 3341`). YouTube is the real one; LUKE'S SERVER
 * is a stand-in page running the real remote script out of the bridge on SERVER.
 */
const { chromium } = require('playwright-core');
const { readFileSync, existsSync } = require('node:fs');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3341';
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const BRIDGE = 'G:/MEDIA-HOST/debaser-bridge/bridge.cjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const failed = [];
function check(ok, what, seen) {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${what}`);
  } else {
    failed.push(what);
    console.log(`  FAIL  ${what}   [${typeof seen === 'string' ? seen : JSON.stringify(seen)}]`);
  }
}

/** A quiet tone as a WAV file (8 kHz, 8-bit mono). */
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
const SOUND = 'https://drive-media.example.org/wake';
const TONE = tone(180, 220);

const item = `{ id: 'wake-1', kind: 'video', bucket: '', path: '', src: '${SOUND}/one.wav', sha256: 'wake-1', bytes: 1, mime: 'video/webm', length: '3:00', title: 'WAKE ONE', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => held.id !== 'wake-1');
    items.push(${item});
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
  } catch {}
})()`;
const SHELF = `(() => {
  try {
    localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ tracks: [{ id: 'wake-tone', title: 'WAKE TONE', credit: 'THE DRIVE', kind: 'TEST', src: '${SOUND}/tone.wav', length: '3:00', tags: [], folderPath: null, shelf: 'bucket' }] }));
  } catch {}
})()`;
/** Keeps hold of the bar's one audio element; hears what the server's frame and YouTube's frame say to the page. */
const HOOK = `(() => {
  if (window.top !== window) return;
  const Orig = window.Audio;
  window.__audios = [];
  window.Audio = function (...args) { const made = new Orig(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = Orig.prototype;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.drive === 'server') window.__server = event.data;
    if (/youtube(-nocookie)?\\.com$/.test(event.origin) && typeof event.data === 'string') {
      try {
        const said = JSON.parse(event.data);
        if (said.info && typeof said.info === 'object') window.__youtube = Object.assign(window.__youtube || {}, said.info);
        if (said.event && said.event !== 'infoDelivery') (window.__youtubeEvents = window.__youtubeEvents || []).push(said.event);
      } catch {}
    }
  });
})()`;

/** LUKE'S SERVER: a page with a play key that makes the player, as Jellyfin's item page does, plus the bridge's own remote. */
function serverPage() {
  const source = readFileSync(BRIDGE, 'utf8').replace(/\r\n/g, '\n');
  const from = source.indexOf('function remoteScript() {');
  const to = source.indexOf('\n}\n', from) + 2;
  const origin = new URL(BASE).origin;
  const script = new Function('FRAME_ANCESTORS', 'NS', `${source.slice(from, to)}\nreturn remoteScript();`)(origin, 'debaser-jellyfin');
  return `<!doctype html><html><body style="margin:0;background:#000">
<button class="btnPlay" style="width:80px;height:30px">PLAY</button>
<script>
  document.querySelector('.btnPlay').addEventListener('click', () => {
    if (document.querySelector('video')) return;
    const video = document.createElement('video');
    video.id = 'v';
    video.src = '${SOUND}/server.wav';
    video.autoplay = false;
    document.body.appendChild(video);
    video.play().catch(() => {});
  });
  setInterval(() => {
    const v = document.querySelector('video');
    parent.postMessage({ drive: 'server', player: !!v, paused: v ? v.paused : true, muted: v ? v.muted : false, time: v ? v.currentTime : 0, volume: v ? v.volume : 1 }, '*');
  }, 250);
</script>
<script>${script}</script></body></html>`;
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  await context.addInitScript(SHELF);
  await context.addInitScript(HOOK);
  await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => route.abort());
  await context.route(/drive-media\.example\.org/, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    if (range === null) return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body: TONE });
    const start = Number(range[1]);
    const end = range[2] === '' ? TONE.length - 1 : Math.min(Number(range[2]), TONE.length - 1);
    return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${TONE.length}` }, body: TONE.subarray(start, end + 1) });
  });
  if (existsSync(BRIDGE)) {
    const page = serverPage();
    await context.route(/^https:\/\/media\.debaser\.site\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page }));
  }
  return context;
}

/** Device A: opened and used as a person does. */
async function openA(context, path, errors) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`A: ${error.message}`));
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 180000 });
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await page.mouse.click(5, 450);
  await sleep(800);
  return page;
}
/** Device B: opened and never touched. `b.run` reads it without counting as a touch. */
async function openB(context, path, errors) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`B: ${error.message}`));
  const cdp = await context.newCDPSession(page);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  const run = async (fn, arg) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, userGesture: false, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    if (await run(() => document.querySelector('[data-bar-queue], [data-stream-bar]') !== null).catch(() => false)) break;
    await sleep(500);
  }
  await sleep(800);
  return { page, run, touched: () => run(() => navigator.userActivation.hasBeenActive) };
}
/** Device A read the plain way. */
const readerOf = (page) => (fn, arg) => page.evaluate(fn, arg ?? null);

/** What a device's screen says and does. */
const look = (run) =>
  run(() => {
    const inRoom = (button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null;
    const keys = [...document.querySelectorAll('button[aria-label]')].filter(inRoom).map((button) => button.getAttribute('aria-label'));
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    const audio = window.__audios && window.__audios.length ? window.__audios[window.__audios.length - 1] : null;
    const input = [...document.querySelectorAll('input[aria-label="Volume"]')].find((held) => inRoom(held) && held.offsetParent !== null);
    const server = document.querySelector('[data-server-remote]') !== null ? (window.__server ?? null) : null;
    const yt = window.__youtube ?? null;
    const room = (JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).find((held) => held.origin === 'music' && held.endedAt === null) ?? null;
    return {
      key: keys.includes('Pause') ? 'shows-playing' : keys.includes('Play') ? 'shows-paused' : null,
      muteKey: keys.includes('Unmute') ? 'shows-muted' : keys.includes('Mute') ? 'shows-sound' : null,
      line: input === undefined ? null : Number(input.value),
      join: document.querySelector('[data-watch-join]') !== null,
      waiting: document.querySelector('[data-watch-sound-waiting]') !== null,
      barWaiting: document.querySelector('[data-bar-sound-waiting]') !== null,
      role: video?.getAttribute('data-watch-video') ?? null,
      video: video === null ? null : { paused: video.paused, muted: video.muted, time: Math.round(video.currentTime * 10) / 10, file: video.currentSrc !== '' },
      server: server === null ? null : { player: server.player, paused: server.paused, muted: server.muted, time: Math.round(server.time * 10) / 10 },
      youtube: yt === null ? null : { state: yt.playerState, muted: yt.muted, time: Math.round((yt.currentTime ?? 0) * 10) / 10 },
      audio: audio === null ? null : { paused: audio.paused, muted: audio.muted, time: Math.round(audio.currentTime * 10) / 10, file: audio.src.split('/').pop() },
      room: room === null ? null : { playing: room.isPlaying, at: Math.round(room.positionSeconds * 10) / 10 },
    };
  });

/** Samples both devices for `seconds`, printing a line whenever either one changes. */
async function watch(label, a, b, seconds, pick) {
  console.log(`    -- ${label}`);
  let before = '';
  const start = Date.now();
  let last = null;
  while (Date.now() - start < seconds * 1000) {
    const [one, two] = [await look(a), await look(b)];
    last = { a: one, b: two };
    const line = `A ${pick(one)} | B ${pick(two)} | room ${one.room === null ? 'none' : one.room.playing ? 'playing' : 'PAUSED'}`;
    const shape = line.replace(/@[\d.]+/g, '');
    if (shape !== before) console.log(`       ${((Date.now() - start) / 1000).toFixed(1).padStart(5)}s  ${line}`);
    before = shape;
    await sleep(400);
  }
  return last;
}
const says = (seen) => `${seen.key ?? 'no-key'}${seen.join ? '+JOIN' : ''}${seen.waiting ? '+SOUND-WAITING' : ''}`;
/** Whether this device's player is silent. */
const hushed = {
  file: (seen) => seen.video !== null && seen.video.muted,
  server: (seen) => seen.server !== null && seen.server.muted,
  youtube: (seen) => seen.youtube !== null && seen.youtube.muted === true,
  bar: (seen) => seen.audio !== null && seen.audio.muted,
};
const shapes = {
  file: (seen) => `${seen.video === null ? 'no player' : `${seen.video.paused ? 'stopped' : 'RUNNING'}${seen.video.muted ? ' muted' : ''}@${seen.video.time}`} ${says(seen)} ${seen.role ?? ''}`,
  server: (seen) => `${seen.server === null || !seen.server.player ? 'no player' : `${seen.server.paused ? 'stopped' : 'RUNNING'}${seen.server.muted ? ' muted' : ''}@${seen.server.time}`} ${says(seen)}`,
  youtube: (seen) => `${seen.youtube === null ? 'no player' : `state${seen.youtube.state}${seen.youtube.muted ? ' muted' : ''}@${seen.youtube.time}`} ${says(seen)}`,
  bar: (seen) => `${seen.audio === null ? 'no bar' : `${seen.audio.paused ? 'stopped' : 'RUNNING'}${seen.audio.muted ? ' muted' : ''}@${seen.audio.time}`}`,
};
const running = {
  file: (seen) => seen.video !== null && !seen.video.paused,
  server: (seen) => seen.server !== null && seen.server.player && !seen.server.paused,
  youtube: (seen) => seen.youtube !== null && seen.youtube.state === 1,
  bar: (seen) => seen.audio !== null && !seen.audio.paused,
};

/** The room's own key on a device, pressed (a press: it counts as a touch there). */
async function press(page, label) {
  await page
    .waitForFunction((wanted) => [...document.querySelectorAll(`button[aria-label="${wanted}"]`)].some((button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null), label, { timeout: 8000 })
    .catch(() => undefined);
  await page.evaluate((wanted) => {
    const key = [...document.querySelectorAll(`button[aria-label="${wanted}"]`)].find((button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null);
    if (key === undefined) throw new Error(`no ${wanted} key`);
    key.click();
  }, label);
}
async function pressPlayInFiles(page) {
  await page.waitForFunction(() => {
    if (document.querySelector(`button[aria-label='Play "WAKE ONE" here']`) !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes('WAKE ONE')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 90000, polling: 500 });
  await page.evaluate(() => document.querySelector(`button[aria-label='Play "WAKE ONE" here']`).click());
}
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

async function until(run, kind, wanted, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (running[kind](await look(run)) === wanted) return true;
    await sleep(300);
  }
  return false;
}

const LINKS = {
  youtube: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', kind: 'youtube', title: 'A YOUTUBE VIDEO' },
  server: { url: 'https://media.debaser.site/debaser/play/movie/7', kind: 'embed', title: 'A FILM ON THE SERVER' },
};

/** One kind of video in the room window. */
async function roomKind(browser, kind, errors) {
  console.log(`\n== ${kind.toUpperCase()} in the room window`);
  const context = await newContext(browser);
  const shape = shapes[kind];
  try {
    const a = await openA(context, '/files?kind=video', errors);
    const ra = readerOf(a);
    await pressPlayInFiles(a);
    if (!(await until(ra, 'file', true, 60000))) throw new Error('A never played the first file');
    if (kind !== 'file') {
      await putOnNow(a, LINKS[kind]);
    }
    if (!(await until(ra, kind, true, 45000))) {
      console.log(`    A never played it (${shape(await look(ra))}) - this kind cannot be driven here`);
      failed.push(`${kind}: A never played`);
      return;
    }
    await sleep(1500);
    await press(a, 'Pause');
    await until(ra, kind, false, 10000);
    await sleep(1500);

    // 1. B is loaded and never touched; A presses PLAY.
    const b = await openB(context, '/files?kind=video', errors);
    await sleep(6000);
    check((await b.touched()) === false, `${kind}: B has not been touched`, await b.touched());
    await press(a, 'Play');
    let now = await watch('A presses PLAY, B never touched', ra, b.run, 14, shape);
    check((await b.touched()) === false, `${kind}: B still untouched after the drive read it`, 'touched');
    check(running[kind](now.a) && now.a.room.playing, `${kind}: A keeps playing when untouched B cannot start with sound`, shape(now.a) + ` room ${now.a.room.playing}`);
    check(running[kind](now.b), `${kind}: untouched B wakes and runs`, shape(now.b));
    check(running[kind](now.b) ? now.b.key !== 'shows-paused' : now.b.key !== 'shows-playing' || now.b.join, `${kind}: B's keys tell the truth about B`, shape(now.b));
    check(hushed[kind](now.b) && now.b.muteKey === 'shows-muted' && now.b.waiting, `${kind}: untouched B runs muted, shows muted, and says its sound is waiting`, `${shape(now.b)} ${now.b.muteKey}`);
    check(!hushed[kind](now.a) && now.a.muteKey === 'shows-sound' && !now.a.waiting, `${kind}: A's own sound is untouched by B's wait`, `${shape(now.a)} ${now.a.muteKey}`);

    // 2. A pauses and plays again with B still untouched.
    await press(a, 'Pause');
    now = await watch('A presses PAUSE', ra, b.run, 5, shape);
    check(!running[kind](now.a) && !running[kind](now.b) && now.b.key !== 'shows-playing', `${kind}: PAUSE on A stops both and B shows paused`, `A ${shape(now.a)} | B ${shape(now.b)}`);
    await press(a, 'Play');
    now = await watch('A presses PLAY again', ra, b.run, 10, shape);
    check(running[kind](now.a) && running[kind](now.b), `${kind}: PLAY again runs both`, `A ${shape(now.a)} | B ${shape(now.b)}`);

    // 3. Mute on A, then pause and play, with B untouched.
    await press(a, 'Mute');
    await sleep(1500);
    await press(a, 'Unmute');
    now = await watch('A mutes then unmutes', ra, b.run, 6, shape);
    check(running[kind](now.a) && now.a.room.playing, `${kind}: MUTE and UNMUTE on A never stop the room`, shape(now.a) + ` room ${now.a.room.playing}`);

    // 4. B is touched (a press on an empty bit of its page), then several presses from both sides.
    await b.page.mouse.click(5, 450);
    await sleep(2500);
    now = await watch('B touched once', ra, b.run, 4, shape);
    check(running[kind](now.b) === now.a.room.playing, `${kind}: after one touch B is in step`, `B ${shape(now.b)} room ${now.a.room.playing}`);
    check(!hushed[kind](now.b) && now.b.muteKey === 'shows-sound' && !now.b.waiting, `${kind}: after one touch B has its sound`, `${shape(now.b)} ${now.b.muteKey}`);
    const turns = [
      [a, 'Pause'],
      [b.page, 'Play'],
      [a, 'Pause'],
      [a, 'Play'],
      [b.page, 'Pause'],
      [b.page, 'Play'],
    ];
    for (const [index, [page, label]] of turns.entries()) {
      const who = page === a ? 'A' : 'B';
      try {
        await press(page, label);
      } catch (error) {
        check(false, `${kind}: turn ${index + 1}: ${who} has a ${label} key to press`, `${shape(await look(who === 'A' ? ra : b.run))}`);
        continue;
      }
      now = await watch(`turn ${index + 1}: ${who} presses ${label}`, ra, b.run, 4, shape);
      const want = label === 'Play';
      const key = want ? 'shows-playing' : 'shows-paused';
      check(running[kind](now.a) === want && running[kind](now.b) === want && now.a.key === key && now.b.key === key, `${kind}: turn ${index + 1}: ${who} ${label} - both pictures and both keys agree`, `A ${shape(now.a)} | B ${shape(now.b)}`);
    }

    // 5. B mutes, A pauses and plays.
    await press(b.page, 'Mute');
    await sleep(2000);
    await press(a, 'Pause');
    await sleep(3000);
    await press(a, 'Play');
    now = await watch('B muted; A pauses then plays', ra, b.run, 6, shape);
    check(running[kind](now.a) && running[kind](now.b), `${kind}: after a MUTE, PAUSE then PLAY on A runs both`, `A ${shape(now.a)} | B ${shape(now.b)}`);
    await press(a, 'Unmute').catch(() => undefined);
    await b.page.close();

    // 6. B opens while the room is already playing, never touched.
    await sleep(2500);
    const c = await openB(context, '/files?kind=video', errors);
    now = await watch('a third device opens while playing, never touched', ra, c.run, 14, shape);
    check(running[kind](now.a) && now.a.room.playing, `${kind}: A keeps playing when an untouched device joins`, shape(now.a) + ` room ${now.a.room.playing}`);
    check(running[kind](now.b), `${kind}: a device that opens while playing wakes and runs`, shape(now.b));

    // 7. Its first press is on its own speaker key: that brings its sound, and is not also "mute" for anybody.
    const spot = await c.run(() => {
      const key = [...document.querySelectorAll('button[aria-label="Unmute"]')].find((button) => button.closest('[data-dock-window="stream"], [data-stream-bar]') !== null && button.offsetParent !== null);
      if (key === undefined) return null;
      const box = key.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    check(spot !== null, `${kind}: the untouched device's speaker key shows muted`, 'no Unmute key');
    if (spot !== null) {
      await c.page.mouse.click(spot.x, spot.y);
      now = await watch('its first press is its speaker key', ra, c.run, 6, shape);
      check(!hushed[kind](now.b) && now.b.muteKey === 'shows-sound', `${kind}: pressing the speaker key first brings the sound`, `${shape(now.b)} ${now.b.muteKey}`);
      check(!hushed[kind](now.a) && now.a.muteKey === 'shows-sound' && running[kind](now.a) && now.a.room.playing, `${kind}: and mutes or stops nobody else`, `${shape(now.a)} ${now.a.muteKey}`);
    }
  } finally {
    await context.close();
  }
}

/** Your room on the music bar with no room window: sound only. */
async function barKind(browser, errors) {
  console.log('\n== SOUND ONLY on the music bar (no room window)');
  const context = await newContext(browser);
  const middle = (page) => page.evaluate(() => document.querySelector('button[aria-label="Previous track"]').parentElement.querySelectorAll('button')[1].click());
  const barTo = async (page, run, wanted) => {
    for (let presses = 0; presses < 5; presses += 1) {
      if (running.bar(await look(run)) === wanted) return true;
      await middle(page);
      await sleep(800);
    }
    return false;
  };
  try {
    const a = await openA(context, '/forum', errors);
    const ra = readerOf(a);
    await a.waitForFunction(() => window.__audios.length > 0, null, { timeout: 30000 });
    if (!(await barTo(a, ra, true))) throw new Error('A never played the bar');
    await sleep(3000);
    await barTo(a, ra, false);
    await sleep(1000);

    const b = await openB(context, '/forum', errors);
    await sleep(6000);
    check((await b.touched()) === false, 'bar: B has not been touched', 'touched');
    await barTo(a, ra, true);
    let now = await watch('A presses PLAY, B never touched', ra, b.run, 10, shapes.bar);
    check(running.bar(now.a), 'bar: A keeps playing when untouched B cannot start', shapes.bar(now.a));
    // Chrome refuses a song on an untouched page even muted (only a video may start muted), so the bar cannot wake by itself:
    // it has to say it is waiting, and start in step at the first press.
    const prompt = () => b.run(() => /PRESS (PLAY )?TO (START|JOIN)/.exec(document.body.innerText)?.[0] ?? null);
    check(now.b.barWaiting && (await prompt()) === null, 'bar: untouched B says its sound is waiting, and nothing else', `${shapes.bar(now.b)} key ${now.b.barWaiting} ${await prompt()}`);
    check(!hushed.bar(now.a) && !now.a.barWaiting, "bar: A's own sound is untouched", shapes.bar(now.a));
    await barTo(a, ra, false);
    await sleep(2000);
    await barTo(a, ra, true);
    now = await watch('A pauses and plays again', ra, b.run, 8, shapes.bar);
    check(running.bar(now.a) && now.b.barWaiting && (await prompt()) === null, 'bar: after PAUSE and PLAY, B still says only that it is waiting', `A ${shapes.bar(now.a)} | B ${shapes.bar(now.b)} key ${now.b.barWaiting}`);
    // The hardest first press: B's own play key. It must start the song here, not take the room or pause it.
    await b.page.locator('button[aria-label="Previous track"]').locator('xpath=..').locator('button').nth(1).click();
    now = await watch("B's first press is its play key", ra, b.run, 6, shapes.bar);
    check(running.bar(now.a), 'bar: that press pauses nobody', shapes.bar(now.a));
    check(running.bar(now.b) && Math.abs(now.a.audio.time - now.b.audio.time) < 1.5, 'bar: after one press B is in step', `A ${shapes.bar(now.a)} | B ${shapes.bar(now.b)}`);
    check(!hushed.bar(now.b) && !now.b.barWaiting, 'bar: after one press B has its sound', `${shapes.bar(now.b)} key ${now.b.barWaiting}`);
  } finally {
    await context.close();
  }
}

/** A browser that lets this site start sound by itself (an installed app, a site allowed by hand): nothing is muted. */
async function allowedKind(browser, errors) {
  console.log('\n== SOUND ALLOWED: the same untouched device where the browser permits sound');
  const context = await newContext(browser);
  try {
    const a = await openA(context, '/files?kind=video', errors);
    const ra = readerOf(a);
    await pressPlayInFiles(a);
    if (!(await until(ra, 'file', true, 60000))) throw new Error('A never played the first file');
    await press(a, 'Pause');
    await until(ra, 'file', false, 10000);
    const b = await openB(context, '/files?kind=video', errors);
    await sleep(6000);
    await press(a, 'Play');
    const now = await watch('A presses PLAY, B never touched', ra, b.run, 10, shapes.file);
    check(running.file(now.b) && !hushed.file(now.b) && !now.b.waiting && now.b.muteKey === 'shows-sound', 'allowed: untouched B wakes WITH sound and asks for nothing', `${shapes.file(now.b)} ${now.b.muteKey}`);
    check((await b.touched()) === false, 'allowed: B still untouched', 'touched');
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=document-user-activation-required', '--mute-audio', '--disable-audio-output'] });
  const errors = [];
  try {
    // The rule itself, proved first: an untouched page here really is refused a video with sound.
    const context = await newContext(browser);
    const probe = await openB(context, '/files?kind=video', errors);
    const refused = await probe.run((src) => {
      const video = document.createElement('video');
      video.src = src;
      return video.play().then(() => 'started', (error) => error.name);
    }, `${SOUND}/probe.wav`);
    check(refused === 'NotAllowedError', 'the browser refuses an untouched page a video with sound', refused);
    await context.close();

    for (const kind of ['file', 'server', 'youtube']) {
      if (ONLY !== null && ONLY !== kind) continue;
      if (kind === 'server' && !existsSync(BRIDGE)) continue;
      await roomKind(browser, kind, errors).catch((error) => {
        failed.push(`${kind}: ${error.message}`);
        console.log(`  FAIL  ${kind}: ${error.stack}`);
      });
    }
    if (ONLY === null || ONLY === 'bar') {
      await barKind(browser, errors).catch((error) => {
        failed.push(`bar: ${error.message}`);
        console.log(`  FAIL  bar: ${error.stack}`);
      });
    }
    if (ONLY === null || ONLY === 'allowed') {
      const allowing = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
      await allowedKind(allowing, errors)
        .catch((error) => {
          failed.push(`allowed: ${error.message}`);
          console.log(`  FAIL  allowed: ${error.stack}`);
        })
        .finally(() => allowing.close());
    }
    if (errors.length > 0) console.log(`\n  page errors: ${errors.join(' | ')}`);
    console.log(`\nPASSED ${passed}   FAILED ${failed.length}`);
    for (const what of failed) console.log(`  - ${what}`);
  } finally {
    await browser.close();
  }
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
})();
