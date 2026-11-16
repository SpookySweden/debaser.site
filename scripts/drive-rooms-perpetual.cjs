/*
 * Drives the perpetual room (SPEC-rooms-perpetual.md) in a real browser, on a local dev server with mock data only:
 *
 *   1. PLAY on a video in FILES opens your main room's window (the live room's window), the video on its screen, playing;
 *      nothing floats. The window says PRIVATE and its last key is [ GO LIVE ].
 *   2. While private, a paused room writes nothing on a clock (no beat).
 *   3. [ GO LIVE ] -> START announces the SAME room: same id, still your main room, a record on the board; the picture
 *      keeps playing in the same player, not restarted. The key says [ ● LIVE ], and now the host's beat runs.
 *   4. [ ● LIVE ] -> [ GO PRIVATE ] takes it off again.
 *   5. The window's X folds your room away and it plays on; the key above the player brings it back.
 *   6. [ END ROOM ] twice ends it and closes the window; the next PLAY makes a new main room with a new id.
 *   7. In somebody else's room, PLAY asks first (Luke, Q2 A): CANCEL keeps you there; PLAY IN YOUR ROOM leaves theirs.
 *
 *   8-9. The bar's GO LIVE opens your own room; a reload while live brings it back folded, its beat on.
 *  10. [ WATCH IN ROOM ] puts the video on in your own room and opens WHO CAN JOIN on it: no separate room (list 3).
 *  11. A friend's server row and a free copy (KINO's WATCH list) open in your room on PLAY (list 3). The server list in
 *      app/lib/web/media-servers.ts is empty today, so this step needs two test servers put between its SERVERS markers on
 *      the dev server's copy only (those of scripts/web-media-test-servers.cjs), never committed; `--no-servers` skips it.
 *  12. Signed out: the same room window, kept in this browser, JUST YOU HERE and LOG IN where chat is (list 3).
 *
 *   node scripts/drive-rooms-perpetual.cjs --base http://localhost:3317
 *
 * Chrome is started with --disable-audio-output: on the desktop (2026-11-16) a headless Chrome's media clock froze on the
 * machine's own sound output, so videos sat at 0:00 while "playing".
 *
 * Start the server with Temp/browse/dev-mock-rooms.cjs (every data source on mock, Supabase empty): nothing reaches the
 * live database, and the "account" is a made-up one in the browser's mock store. From the network it asks only a
 * five-second public test video. Handing on and the 45-second take-over need two accounts at once, which the mock store
 * cannot hold in one browser: Temp/check-rooms-perpetual.cjs holds those rules on the store itself.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317');
const SHOTS = join('Temp', 'browse', 'rooms-perpetual');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';

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

/** Signed out: the drive's video in the catalogue, and nobody signed in to the mock. */
const VISITOR_SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    delete kept.sessionUserId;
    localStorage.setItem('debaser.auth.mock.v1', JSON.stringify(kept));
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]');
    if (!items.some((item) => item.id === 'drive-video')) {
      items.push({ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() });
      localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    }
  } catch {}
})()`;

/** The mock watch store, as the page keeps it. */
const tables = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}'));
const mainRooms = async (page) => (await tables(page)).rooms.filter((room) => room.origin === 'music' && room.originalHostId === 'drive-user');
const openMain = async (page) => (await mainRooms(page)).find((room) => room.endedAt === null) ?? null;

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 120000 });
  const notNow = page.getByText('NOT NOW', { exact: false });
  if (await notNow.count()) await notNow.first().click().catch(() => undefined);
  // A first visit's PRIVACY window: kept as it is.
  const keep = page.getByText('[ KEEP THESE SETTINGS ]', { exact: false });
  if (await keep.count()) await keep.first().click().catch(() => undefined);
  await sleep(800);
}
async function pressPlay(page) {
  // The catalogue has read its files: either the category list or the video's row is drawn.
  await page.waitForFunction(() => /VIDEOS\s*\(\d+\)|\[\+\] VIDEOS|DRIVE VIDEO/.test(document.body.innerText), null, { timeout: 30000 });
  const category = page.locator('a, button', { hasText: /VIDEOS\s*\(\d+\)/ });
  if (await category.count()) {
    await category.first().click();
    await page.waitForURL(/[?&](kind|cat)=/, { timeout: 15000 }).catch(() => undefined);
    await sleep(1500);
    if (process.env.DRIVE_DEBUG) console.log('  after the category:', page.url(), await page.locator('button[aria-expanded]').allInnerTexts());
  }
  const fold = page.getByText('[+] VIDEOS', { exact: false });
  if (await fold.count()) await fold.first().click().catch(() => undefined);
  // The row opens to show its PLAY. Pressed in the page itself: the list may be drawn again mid-click.
  await page.waitForFunction(() => {
    const play = document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']');
    if (play !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes('DRIVE VIDEO')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 60000, polling: 500 });
  await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
}
const roomVideo = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
    return video === null ? null : { src: video.currentSrc || video.src, time: video.currentTime, paused: video.paused, same: window.__sameVideo === video };
  });

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(SEED);
  // Mock data only: should anything still be pointed at the live database, it never gets there.
  const blocked = [];
  await context.route(/supabase\.(co|in)/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    console.log('1. PLAY IN FILES OPENS YOUR ROOM');
    await open(page, '/files?kind=video');
    await pressPlay(page);
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 30000 });
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
      return video !== null && video.currentTime > 0.3 && !video.paused;
    }, null, { timeout: 30000 });
    const first = await openMain(page);
    assert.notEqual(first, null, 'a main room was made');
    assert.equal(first.isPublic, false, 'private');
    assert.equal(await page.locator('[data-floating-player] video, [data-floating-player] iframe').count(), 0, 'nothing floats');
    assert.match((await roomVideo(page)).src, /flower\.webm/, 'the video is on the room\'s own screen');
    // The name is the profile's (the mock has none for the made-up account, so it says ANONYMOUS).
    assert.match(await page.locator('[data-dock-window="stream"]').innerText(), /'S ROOM\s+PRIVATE/, 'the window is a person\'s room, PRIVATE');
    await page.screenshot({ path: join(SHOTS, '1-private.png') });
    pass('PLAY opened your room\'s window with the video playing on its screen; nothing floats; it is private');

    console.log('2. PRIVATE: NO BEAT');
    await page.evaluate(() => {
      const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
      video.loop = true;
      window.__sameVideo = video;
      video.pause();
    });
    await sleep(1500);
    const pausedAt = (await openMain(page)).updatedAt;
    await sleep(7000);
    assert.equal((await openMain(page)).updatedAt, pausedAt, 'paused and private: nothing written for 7 seconds');
    pass('a private room writes on play, pause and seek only: no 3-second beat');

    console.log('3. GO LIVE: THE SAME ROOM, NOTHING RESTARTS');
    await page.evaluate(() => void document.querySelector('[data-dock-window="stream"] video[data-watch-video]').play());
    await sleep(1500);
    const before = (await roomVideo(page)).time;
    await page.locator('[data-main-room-live="private"]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 10000 });
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
    const live = await openMain(page);
    assert.equal(live.id, first.id, 'the same room');
    assert.equal(live.isPublic, true, 'announced');
    assert.equal(live.privacy, 'private', 'WHO CAN JOIN: PRIVATE, as picked first');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('debaser.watch.v1')).rooms.find((room) => room.id === id)?.forumThreadId != null, first.id, { timeout: 15000 });
    const after = await roomVideo(page);
    assert.equal(after.same, true, 'the same player: not a new room, not a new element');
    assert.ok(after.time >= before - 0.5 || after.time < 1, 'it played on from where it was');
    pass('GO LIVE announced the same room in place, filed its board record, and the picture played on');

    await page.evaluate(() => document.querySelector('[data-dock-window="stream"] video[data-watch-video]').pause());
    await sleep(1500);
    const liveAt = (await openMain(page)).updatedAt;
    await sleep(7000);
    assert.notEqual((await openMain(page)).updatedAt, liveAt, 'live: the host\'s beat writes even while paused');
    pass('live, the host\'s 3-second beat runs');

    console.log('4. GO PRIVATE');
    await page.locator('[data-main-room-live="live"]').first().click();
    await page.waitForSelector('[data-main-room-private]', { timeout: 10000 });
    await page.locator('[data-main-room-private]').click();
    await page.waitForSelector('[data-main-room-live="private"]', { timeout: 15000 });
    assert.equal((await openMain(page)).isPublic, false);
    assert.equal((await openMain(page)).id, first.id, 'still the same room');
    pass('GO PRIVATE took the same room off the lists again');

    console.log('5. X FOLDS YOUR ROOM; IT PLAYS ON');
    await page.evaluate(() => void document.querySelector('[data-dock-window="stream"] video[data-watch-video]').play());
    await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    assert.equal((await openMain(page)).endedAt, null, 'not ended');
    const folded = await roomVideo(page);
    assert.notEqual(folded, null, 'the room is still drawn, folded away');
    await sleep(1200);
    assert.ok((await roomVideo(page)).time !== folded.time, 'and its video plays on');
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live]', { timeout: 10000 });
    pass('X folds your room to the key above the player and it plays on; the key brings it back');

    console.log('6. END ROOM, THEN A NEW ROOM');
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    const ended = (await mainRooms(page)).find((room) => room.id === first.id);
    assert.notEqual(ended.endedAt, null, 'the room ended');
    await pressPlay(page);
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 30000 });
    const second = await openMain(page);
    assert.notEqual(second, null);
    assert.notEqual(second.id, first.id, 'a new room');
    pass('END ROOM ended it and closed the window; the next PLAY made a new main room');

    console.log('7. IN SOMEBODY ELSE\'S ROOM, PLAY ASKS FIRST');
    await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem('debaser.watch.v1'));
      const at = new Date().toISOString();
      store.rooms = store.rooms.filter((room) => room.id !== 'drive-other-room');
      store.rooms.push({ id: 'drive-other-room', originalHostId: 'drive-other', originalHostLabel: 'SOMEBODY', hostId: 'drive-other', forumThreadId: null, currentEntryId: null, positionSeconds: 0, isPlaying: false, startedAt: at, updatedAt: at, endedAt: null, origin: 'stream', isPublic: true, privacy: 'open', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true });
      localStorage.setItem('debaser.watch.v1', JSON.stringify(store));
    });
    await open(page, '/files?kind=video&watch=drive-other-room');
    // Their room's window (a stream: its title says STREAM ::, never "'S ROOM").
    await page.waitForFunction(() => /STREAM ::/.test(document.querySelector('[data-dock-window="stream"]')?.textContent ?? ''), null, { timeout: 30000 });
    // Their room's window covers the page; the video's row is still drawn under it, and pressed there.
    if (process.env.DRIVE_DEBUG) {
      await sleep(3000);
      console.log('  under their room:', page.url(), await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /DRIVE VIDEO|VIDEOS/.test(b.textContent) || /DRIVE VIDEO/.test(b.getAttribute('aria-label') ?? '')).map((b) => `${b.getAttribute('aria-expanded')} ${b.getAttribute('aria-label')} ${b.textContent.trim().slice(0, 40)}`)));
    }
    await pressPlay(page);
    await page.waitForSelector('[data-play-ask]', { timeout: 10000 });
    await page.locator('[data-play-ask-cancel]').click();
    await page.waitForFunction(() => document.querySelector('[data-play-ask]') === null, null, { timeout: 5000 });
    assert.equal(await page.locator('[data-main-room-live]').count(), 0, 'CANCEL: still in their room');
    // While asked, and after CANCEL, the video plays on where it was pressed: nothing is lost.
    assert.equal(await page.locator('button[aria-label=\'Close the player for "DRIVE VIDEO"\']').count(), 1, 'CANCEL: the video still plays in its row');
    await page.evaluate(() => document.querySelector('button[aria-label=\'Close the player for "DRIVE VIDEO"\']').click());
    await pressPlay(page);
    await page.waitForSelector('[data-play-ask-mine]', { timeout: 10000 });
    await page.locator('[data-play-ask-mine]').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live]', { timeout: 30000 });
    pass('in somebody else\'s room PLAY asked first; CANCEL kept you there; PLAY IN YOUR ROOM left theirs for yours');

    console.log('8. THE BAR\'S [ GO LIVE ] OPENS YOUR OWN ROOM ON WHO CAN JOIN');
    const mineNow = await openMain(page);
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    const roomsBefore = (await tables(page)).rooms.length;
    await page.locator('[data-go-live-key]').first().click();
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 20000 });
    await page.waitForSelector('[data-main-room-who]', { timeout: 10000 });
    const fresh = await openMain(page);
    assert.notEqual(fresh, null, 'your room, written now though nothing was played');
    assert.notEqual(fresh.id, mineNow.id, 'a new one after END ROOM');
    assert.equal((await tables(page)).rooms.filter((room) => room.origin === 'stream' && room.originalHostId === 'drive-user').length, 0, 'no separate stream room was made');
    assert.equal((await tables(page)).rooms.length, roomsBefore + 1, 'one room more: your own');
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
    assert.equal((await openMain(page)).isPublic, true);
    pass('the bar\'s GO LIVE opened your own room on WHO CAN JOIN, and START put that same room live');

    console.log('9. A RELOAD WHILE LIVE: THE ROOM COMES BACK FOLDED, AND ITS BEAT GOES ON');
    const liveRoom = await openMain(page);
    await open(page, '/forum');
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 30000 });
    await sleep(2000);
    const beatAt = (await openMain(page)).updatedAt;
    await sleep(7000);
    const after9 = await openMain(page);
    assert.equal(after9.id, liveRoom.id, 'still your room');
    assert.equal(after9.isPublic, true, 'still live');
    assert.notEqual(after9.updatedAt, beatAt, 'the host\'s beat runs again after the reload');
    pass('reloaded while live, your room came back folded above the player and its beat carried on');

    console.log('10. [ WATCH IN ROOM ] USES YOUR OWN ROOM (list 3)');
    // Your live room from step 9, ended first, so WATCH IN ROOM finds no room to add to and starts in your own.
    await page.locator('[data-room-shelf-key] button').click();
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    await open(page, '/files?kind=video');
    await pressPlay(page);
    await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 30000 });
    const roomsAt10 = (await tables(page)).rooms.length;
    const ownAt10 = await openMain(page);
    const playsAt10 = (await tables(page)).queue.filter((entry) => entry.roomId === ownAt10.id && entry.mediaItemId === 'drive-video' && entry.playedAt !== null).length;
    // Folded away, so the row's key is in reach; the room plays on.
    await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    // Pressed in the page itself: a first visit's PRIVACY window may sit over the row.
    await page.waitForSelector('[data-watch-in-room="start"]', { timeout: 20000 });
    await page.evaluate(() => document.querySelector('[data-watch-in-room="start"]').click());
    await page.waitForSelector('[data-main-room-who]', { timeout: 20000 });
    assert.equal((await tables(page)).rooms.filter((room) => room.origin === 'stream' && room.originalHostId === 'drive-user').length, 0, 'no separate stream room');
    assert.equal((await tables(page)).rooms.length, roomsAt10, 'no room made at all');
    assert.equal((await openMain(page)).id, ownAt10.id, 'your own room');
    // Put on as a new play in your room (the clip is five seconds long, so it is read from the room, not the screen).
    await page.waitForFunction(
      ([roomId, before]) => JSON.parse(localStorage.getItem('debaser.watch.v1')).queue.filter((entry) => entry.roomId === roomId && entry.mediaItemId === 'drive-video' && entry.playedAt !== null).length > before,
      [ownAt10.id, playsAt10],
      { timeout: 15000 },
    );
    await page.locator('[data-main-room-who] button', { hasText: 'CANCEL' }).click();
    assert.equal((await openMain(page)).isPublic, false, 'CANCEL keeps it private');
    pass('[ WATCH IN ROOM ] put the video on in your own room and opened WHO CAN JOIN on it: no separate room; CANCEL keeps it private');

    if (!args.includes('--no-servers')) {
      console.log('11. A FRIEND\'S SERVER ROW AND A FREE COPY OPEN IN YOUR ROOM (list 3)');
      // Needs test servers in app/lib/web/media-servers.ts on the dev server (the list is empty today): see --no-servers.
      await page.route(/\/api\/web\/media\/ping/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"up":true}' }));
      await page.route(/\/api\/web\/kino\/sources/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sources: { 'movie-999999901': { watch: null, free: [{ platform: 'internet_archive', id: 'debaser-drive-film', publicDomain: true }] } } }) }),
      );
      // The server's player page and the Archive's embed, answered here: nothing is asked of either.
      await page.route(/placeholder-server1\.xyz|archive\.org\/embed/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in player</title><p>STAND-IN PLAYER</p>' }));
      await open(page, '/media?q=MOCK%20FILM%2001');
      await page.waitForFunction(() => /MOCK FILM 01/i.test(document.body.innerText), null, { timeout: 60000 });
      const watchKey = page.locator('button', { hasText: /\[ ▶ WATCH|\[ WATCH/ }).first();
      if (await watchKey.count()) await watchKey.evaluate((key) => key.click());
      const onServer = page.locator('button[aria-label^="Play \\"MOCK FILM 01"][aria-label*="SERVER 1"]').first();
      await onServer.waitFor({ timeout: 20000 });
      await onServer.evaluate((key) => key.click());
      await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live]', { timeout: 30000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-dock-window="stream"] iframe')].some((frame) => /placeholder-server1\.xyz/.test(frame.src)), null, { timeout: 20000 });
      assert.equal(await page.locator('[data-floating-player] iframe').count(), 0, 'nothing floats');
      const serverEntry = (await tables(page)).queue.find((entry) => entry.roomId === (ownAt10.id) && entry.link?.url?.includes('placeholder-server1.xyz'));
      assert.ok(serverEntry, 'filed in your room as a play');
      pass('a friend\'s server row: PLAY opened your room with the server\'s player in the room\'s frame; nothing floats');

      await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
      await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
      const freeKey = page.locator('[data-free-copy="internet_archive"] button', { hasText: 'FREE ON' }).first();
      await freeKey.waitFor({ timeout: 20000 });
      await freeKey.evaluate((key) => key.click());
      await page.waitForSelector('[data-dock-window="stream"] [data-main-room-live]', { timeout: 30000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-dock-window="stream"] iframe')].some((frame) => /archive\.org\/embed\/debaser-drive-film/.test(frame.src)), null, { timeout: 20000 });
      assert.equal(await page.locator('[data-floating-player] iframe').count(), 0, 'nothing floats');
      pass('a free copy (KINO\'s WATCH list): PLAY opened your room with the Archive\'s player on its screen; nothing floats');
    }

    console.log('12. SIGNED OUT: THE SAME ROOM WINDOW, KEPT IN THIS BROWSER (list 3)');
    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await visitorContext.addInitScript(VISITOR_SEED);
    await visitorContext.route(/supabase\.(co|in)/, (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });
    const visitor = await visitorContext.newPage();
    visitor.on('pageerror', (error) => errors.push(error.message));
    await open(visitor, '/files?kind=video');
    await pressPlay(visitor);
    await visitor.waitForSelector('[data-dock-window="stream"] [data-main-room-live="private"]', { timeout: 30000 });
    await visitor.waitForFunction(() => {
      const video = document.querySelector('[data-dock-window="stream"] video[data-watch-video]');
      return video !== null && video.currentTime > 0.3 && !video.paused;
    }, null, { timeout: 30000 });
    assert.equal(await visitor.locator('[data-own-room-window]').count(), 0, 'not the old look-alike window');
    assert.equal(await visitor.locator('[data-floating-player] video').count(), 0, 'nothing floats');
    const visitorText = await visitor.locator('[data-dock-window="stream"]').innerText();
    assert.match(visitorText, /YOUR ROOM\s+PRIVATE/, 'the window is YOUR ROOM, PRIVATE');
    assert.match(await visitor.locator('[data-visitor-room-alone]').innerText(), /JUST YOU HERE[\s\S]*LOG IN/, 'where chat would be: JUST YOU HERE and LOG IN');
    assert.equal(await visitor.locator('[data-dock-window="stream"] input[placeholder^="Say"]').count(), 0, 'no chat box');
    assert.equal(await visitor.locator('[data-dock-window="stream"] button', { hasText: 'CANVAS' }).count(), 0, 'no canvas key');
    // The room's keys, under its picture or on the music bar: PIP and FULL among them, as in any room.
    assert.match(await visitor.locator('body').innerText(), /\[ PIP \][\s\S]*\[ FULL \]/, 'the room\'s keys: PIP and FULL');
    const visitorRooms = await visitor.evaluate(() => JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms.filter((room) => room.origin === 'music' && room.endedAt === null));
    assert.equal(visitorRooms.length, 1, 'one room');
    assert.match(visitorRooms[0].hostId, /^visitor:/, 'the visitor\'s own, in this browser');
    await visitor.screenshot({ path: join(SHOTS, '12-visitor.png') });
    await visitor.locator('[data-main-room-live="private"]').first().click();
    await visitor.waitForSelector('[data-main-room-log-in]', { timeout: 10000 });
    assert.equal(await visitor.locator('[data-main-room-who]').count(), 0, 'no WHO CAN JOIN for a visitor');
    await visitor.locator('[data-main-room-log-in] button', { hasText: 'CANCEL' }).click();
    // X folds it and it plays on; the key above the player brings it back.
    await visitor.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await visitor.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    await visitor.locator('[data-room-shelf-key] button').click();
    await visitor.waitForSelector('[data-dock-window="stream"] [data-main-room-live]', { timeout: 10000 });
    pass('signed out: PLAY opened the same room window (YOUR ROOM, PRIVATE), playing; JUST YOU HERE and LOG IN where chat is; no canvas; GO LIVE asks to log in; it folds and comes back; kept in this browser');
    await visitorContext.close();

    const real = errors.filter((message) => !/ResizeObserver|hydrat/i.test(message));
    assert.deepEqual(real, [], 'no page errors');
    assert.deepEqual(blocked, [], 'nothing asked the live database');
    console.log(`drive-rooms-perpetual: ${passed} passed`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(failure);
    if (errors.length > 0) console.error('page errors:', errors.slice(0, 5));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
