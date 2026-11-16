/*
 * Drives ROOMSYNC's list-4 items (Luke, 2026-11-16) in a real browser, on a local dev server with mock data only:
 *
 *   1. Going back in your room: [ ◀◀ ] in the room's keys starts what played before; a played row in the QUEUE window is a
 *      press that plays it again, where it stands in the list (nothing copied, nothing re-ordered); the music bar's own
 *      back arrow does the same; [ ↻ ] (the bar's loop key while you host) loops what is on: at its end it starts again
 *      instead of the room moving on, and off again the room moves on.
 *   2. Going from your own room into somebody else's: your room holds where you were, paused; leaving theirs puts you back
 *      in yours, its window as you left it, the video waiting at that spot.
 *   4. A picture in room chat: a GIPHY address is drawn as the picture and held up by your companion (never said as words
 *      in its bubble); an outside picture address you sent shows for you at once in the chat and over your companion.
 *
 *   node scripts/drive-roomsync.cjs --base http://localhost:3318
 *
 * Start the server with every data source on mock and Supabase EMPTY (Temp/browse/dev-mock-*.cjs is the pattern), so
 * nothing reaches the live database: the account is a made-up one in the browser's mock store. From the network it asks
 * only MDN's five-second public test video; the picture addresses are answered here with a tiny GIF and PNG. Item 3 (the
 * presence limit) is Temp/check-presence-pace.cjs: the mock store has no Realtime server to shut a channel.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3318';
const SHOTS = join('Temp', 'browse', 'roomsync');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const GIPHY = 'https://media.giphy.com/media/roomsyncdrive/giphy.gif';
const OUTSIDE = 'https://pictures.example.org/drive/cat.png';
// Plain grey test cards, answered for the picture addresses so nothing leaves the machine for them (made here, no artwork).
const zlib = require('node:zlib');
function testCard(width, height, grey) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height, grey);
  for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const GIF = testCard(120, 80, 160);
const PNG = testCard(90, 90, 96);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const item = (id, title) =>
  `{ id: '${id}', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: '${id}', bytes: 1, mime: 'video/webm', length: '0:05', title: '${title}', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => held.id !== 'drive-video' && held.id !== 'drive-video-2');
    items.push(${item('drive-video', 'DRIVE VIDEO')}, ${item('drive-video-2', 'DRIVE VIDEO TWO')});
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    // The companion out on this computer (its placeholder figure: the mock account has no SHOWN character).
    localStorage.setItem('debaser-companion', JSON.stringify({ computer: true, phone: false }));
  } catch {}
})()`;

const tables = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}'));
const ownRoom = async (page) => (await tables(page)).rooms.find((room) => room.origin === 'music' && room.originalHostId === 'drive-user' && room.endedAt === null) ?? null;
const rowsOf = async (page, roomId) => (await tables(page)).queue.filter((row) => row.roomId === roomId);
const roomVideo = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    return video === null ? null : { time: video.currentTime, paused: video.paused, ended: video.ended };
  });
const press = (page, selector) => page.evaluate((wanted) => document.querySelector(wanted).click(), selector);

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
/** PLAY on a row of FILES' video list, pressed in the page itself (the room's window may cover it, the list may redraw). */
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
async function send(page, words) {
  await page.locator('#watch-chat').fill(words);
  await page.locator('[data-watch-send]').click();
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
  await context.route(/media\.giphy\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: GIF }));
  await context.route(/pictures\.example\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    console.log('1. GOING BACK IN YOUR ROOM');
    await open(page, '/files?kind=video');
    await pressPlay(page, 'DRIVE VIDEO');
    await page.waitForSelector('[data-main-room-live]', { timeout: 30000 });
    await sleep(1500);
    await pressPlay(page, 'DRIVE VIDEO TWO');
    await page.waitForFunction(() => true);
    await sleep(2500);
    const mine = await ownRoom(page);
    let rows = await rowsOf(page, mine.id);
    assert.equal(rows.length, 2, `two rows in your room's queue (${rows.length})`);
    const first = rows.find((row) => row.playIndex === 0);
    const second = rows.find((row) => row.playIndex === 1);
    assert.ok(first && second, 'both played, in order');
    assert.equal((await ownRoom(page)).currentEntryId, second.id, 'the second is on');
    const order = rows.map((row) => `${row.id}:${row.playIndex}`).sort().join(',');

    // The room's own back key.
    await page.waitForSelector('[data-room-back]:not([disabled])', { timeout: 10000 });
    await press(page, '[data-room-back]');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.some((room) => room.currentEntryId === id), first.id, { timeout: 10000 });
    rows = await rowsOf(page, mine.id);
    assert.equal(rows.length, 2, 'nothing copied');
    assert.equal(rows.map((row) => `${row.id}:${row.playIndex}`).sort().join(','), order, 'nothing re-ordered');
    pass('[ ◀◀ ] in your room started what played before, where it stands in the list');

    // A played row in the QUEUE window.
    await press(page, '[data-stream-bar-queue]');
    await page.waitForSelector(`[data-queue-replay="${second.id}"]`, { timeout: 15000 });
    assert.equal(await page.locator(`[data-queue-replay="${first.id}"]`).count(), 0, 'what is on is not a replay press');
    await page.screenshot({ path: join(SHOTS, '1-queue.png') });
    await press(page, `[data-queue-replay="${second.id}"]`);
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.some((room) => room.currentEntryId === id), second.id, { timeout: 10000 });
    assert.equal((await rowsOf(page, mine.id)).map((row) => `${row.id}:${row.playIndex}`).sort().join(','), order, 'still nothing copied or re-ordered');
    pass('a played row in the QUEUE window is a press that plays it again in your room');
    await page.keyboard.press('Escape');
    await sleep(500);
    const closeQueue = page.locator('[data-dock-window] button[aria-label^="Close QUEUE"], [data-dock-window] button[aria-label^="Close Queue"]');
    if (await closeQueue.count()) await closeQueue.first().click().catch(() => undefined);

    // The music bar's own back arrow (TV turns the bar to the music player).
    await press(page, '[data-stream-bar-swap="stream"]');
    await page.waitForSelector('button[aria-label="Previous track"]', { timeout: 10000 });
    await press(page, 'button[aria-label="Previous track"]');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.some((room) => room.currentEntryId === id), first.id, { timeout: 10000 });
    if (process.env.DRIVE_DEBUG) {
      for (let tick = 0; tick < 8; tick += 1) {
        await sleep(500);
        const room = await ownRoom(page);
        console.log('    after back:', room.currentEntryId === first.id ? 'first' : room.currentEntryId === second.id ? 'second' : room.currentEntryId, room.positionSeconds, room.isPlaying, JSON.stringify(await roomVideo(page)));
      }
    }
    pass('the music bar\'s back arrow went back to what played before, in the room');
    await press(page, '[data-stream-bar-swap="music"]');
    await page.waitForSelector('[data-room-loop]', { timeout: 10000 });

    // Loop: on, it starts again at its end; off, the room moves on.
    await press(page, '[data-room-loop]');
    await page.waitForSelector('[data-room-loop="on"]', { timeout: 5000 });
    await press(page, '[data-stream-bar-swap="stream"]');
    await page.waitForSelector('button[aria-label="Previous track"]', { timeout: 10000 });
    await page.screenshot({ path: join(SHOTS, '1-bar-looping.png') });
    await press(page, '[data-stream-bar-swap="music"]');
    await page.waitForSelector('[data-room-loop="on"]', { timeout: 5000 });
    let wrapped = false;
    let seenLate = false;
    for (let tick = 0; tick < 40 && !wrapped; tick += 1) {
      await sleep(500);
      const video = await roomVideo(page);
      if (process.env.DRIVE_DEBUG) console.log('   ', JSON.stringify(video), (await ownRoom(page)).currentEntryId === first.id ? 'first' : (await ownRoom(page)).currentEntryId === second.id ? 'second' : (await ownRoom(page)).currentEntryId);
      if (video !== null && video.time > 3.5) seenLate = true;
      if (seenLate && video !== null && video.time < 2 && !video.paused) wrapped = true;
    }
    assert.ok(wrapped, 'looping: the video ran to its end and started again');
    assert.equal((await ownRoom(page)).currentEntryId, first.id, 'still the same row');
    pass('[ ↻ ] looped what was on: at its end it started again, the room did not move on');
    await press(page, '[data-room-loop]');
    await page.waitForSelector('[data-room-loop="off"]', { timeout: 5000 });
    // Off: at the end of the replayed row, the room carries on with what is still queued; nothing is, so it goes black.
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.some((room) => room.origin === 'music' && room.endedAt === null && room.currentEntryId === null), null, { timeout: 15000 });
    pass('loop off: at its end the room moved on (nothing queued: the black screen)');

    console.log('2. YOUR ROOM WAITS WHILE YOU ARE IN SOMEBODY ELSE\'S');
    await press(page, `[data-room-back]`);
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.some((room) => room.currentEntryId === id && room.isPlaying), second.id, { timeout: 10000 });
    await sleep(2000);
    const before = await roomVideo(page);
    assert.ok(before !== null && before.time > 0.5 && !before.paused, `your room's video is playing (${JSON.stringify(before)})`);
    await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem('debaser.watch.v1'));
      const at = new Date().toISOString();
      store.rooms = store.rooms.filter((room) => room.id !== 'drive-other-room');
      store.rooms.push({ id: 'drive-other-room', originalHostId: 'drive-other', originalHostLabel: 'SOMEBODY', hostId: 'drive-other', forumThreadId: null, currentEntryId: null, positionSeconds: 0, isPlaying: false, startedAt: at, updatedAt: at, endedAt: null, origin: 'stream', isPublic: true, privacy: 'open', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true });
      localStorage.setItem('debaser.watch.v1', JSON.stringify(store));
      // A link to their room followed inside the site, as a [ TV ] key would be.
      history.pushState(null, '', '/files?kind=video&watch=drive-other-room');
    });
    await page.waitForFunction(() => /STREAM ::/.test(document.querySelector('[data-dock-window="stream"]')?.getAttribute('aria-label') ?? ''), null, { timeout: 30000 });
    const held = await ownRoom(page);
    assert.equal(held.isPlaying, false, 'your room was paused as you went');
    assert.equal(held.currentEntryId, second.id, "on what you were watching (from the black screen, back went to the last thing played)");
    assert.ok(held.positionSeconds > 0.4, `at the spot you were at (${held.positionSeconds})`);
    await sleep(3000);
    await press(page, '[data-dock-window="stream"] button[aria-label^="Close"]');
    await page.waitForFunction(() => /'S ROOM/.test(document.querySelector('[data-dock-window="stream"]')?.getAttribute('aria-label') ?? ''), null, { timeout: 15000 });
    await page.waitForSelector('[data-dock-window="stream"] video[data-watch-video]', { timeout: 15000 });
    await sleep(2000);
    const back = await roomVideo(page);
    assert.ok(back !== null && back.paused, `your room's video waits, paused (${JSON.stringify(back)})`);
    assert.ok(Math.abs(back.time - held.positionSeconds) < 1, `where you left it (${back.time} against ${held.positionSeconds})`);
    await page.screenshot({ path: join(SHOTS, '2-back-home.png') });
    pass('leaving their room put you back in yours, its window open as you left it, the video paused at your spot');

    console.log('4. A PICTURE IN ROOM CHAT IS HELD UP BY YOUR COMPANION');
    await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 20000 });
    await send(page, GIPHY);
    await page.waitForSelector(`[data-dock-window="stream"] [data-watch-message] img[src="${GIPHY}"]`, { timeout: 10000 });
    await page.waitForSelector(`[data-companion-held-of="drive-user"][data-companion-held="shown"] img[src="${GIPHY}"]`, { state: 'attached', timeout: 5000 });
    await sleep(400);
    const place = await page.evaluate(() => {
      const held = document.querySelector('[data-companion-held-of="drive-user"]').getBoundingClientRect();
      const figure = document.querySelector('[data-companion="own"]').getBoundingClientRect();
      return { held: held.toJSON(), figure: figure.toJSON(), visible: getComputedStyle(document.querySelector('[data-companion-held-of="drive-user"]')).visibility, width: innerWidth };
    });
    assert.equal(place.visible, 'visible', 'the held picture is showing');
    assert.ok(place.held.top >= 0 && place.held.right <= place.width && place.held.width > 60, `whole, inside the screen (${JSON.stringify(place.held)})`);
    // Over its head where there is room; held out at its side where there is none (a room window's top edge), never over it.
    const over = place.held.bottom <= place.figure.top + 1 && place.held.left < place.figure.right && place.held.right > place.figure.left;
    const beside = place.held.top < place.figure.bottom && (Math.abs(place.held.left - place.figure.right) <= 8 || Math.abs(place.figure.left - place.held.right) <= 8);
    assert.ok(over || beside, `held up by its companion, over it or at its side (${JSON.stringify(place.held)} by ${JSON.stringify(place.figure)})`);
    const said = await page.evaluate(() => document.querySelector('[data-companion="own"]').textContent);
    assert.ok(!said.includes('giphy'), 'its bubble does not say the address');
    await page.screenshot({ path: join(SHOTS, '4-gif-held.png') });
    pass('a GIPHY address in chat: drawn as the picture, held up over your companion, never said as words');
    await send(page, OUTSIDE);
    await page.waitForSelector('[data-dock-window="stream"] [data-watch-message] [data-queued-picture="outside-shown"]', { timeout: 15000 });
    await page.waitForSelector('[data-companion-held-of="drive-user"][data-companion-held="outside"] img', { state: 'attached', timeout: 15000 });
    assert.equal(await page.locator(`[data-dock-window="stream"] [data-watch-message]:has-text("${OUTSIDE}")`).count(), 0, 'no address as text in the chat');
    await page.screenshot({ path: join(SHOTS, '4-outside-held.png') });
    pass('an outside picture you sent shows for you at once, in the chat and held up over your companion');
    await send(page, 'just words');
    await page.waitForFunction(() => document.querySelector('[data-companion-held-of="drive-user"]') === null, null, { timeout: 5000 });
    pass('a line of words takes the picture\'s place');

    assert.deepEqual(errors, [], `no page errors (${errors.join(' | ')})`);
    assert.deepEqual(blocked, [], 'nothing reached for the live database');
    console.log(`\n${passed} passed`);
  } catch (error) {
    console.error('FAILED:', error.message);
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    if (errors.length > 0) console.error('page errors:', errors.join(' | '));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
