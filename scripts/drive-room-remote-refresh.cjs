/*
 * Drives two room changes (Luke, 2026-11-22) in a real browser, on a local dev server with mock data only:
 *
 *   1. "when remote controlling in the room on fullscreen, we dont need the player bar at the bottom of the screen": with the
 *      room's REMOTE view on screen, the room's fullscreen has no bar of keys over the picture's foot, however the pointer
 *      moves or keys are pressed, and the pointer is never hidden with it. The remote's own SETTINGS > LEAVE FULLSCREEN is
 *      the way out, and leaving brings the keys back. A video's fullscreen keeps its bar, as before.
 *      And (2026-11-23) "when using remote, there is no full screen button, appearing only when you stream a video": with
 *      nothing on in the room, the REMOTE view still has the room's FULL key, and it works.
 *   2. "on a refresh, the open room is not collapsed and stays open on the screen if it was open": your room's window open
 *      before a reload is open after it, where it was and as big; folded before, folded after.
 *
 *   node scripts/dev-mock-live.cjs 3315        (in another terminal: every data source on mock, Supabase EMPTY)
 *   node scripts/drive-room-remote-refresh.cjs --base http://localhost:3315
 *
 * The REMOTE key shows only when an engine answers for its owner: here the site's "is the engine there" question is answered
 * "yes" in the browser, so the view can be chosen with no engine running (its picture then says it cannot connect, which is
 * all this needs). Keys reaching a real engine are not driven here: nothing in their path was changed.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3315';
const SHOTS = join('Temp', 'browse', 'room-remote-refresh');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';

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
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]').filter((held) => held.id !== 'drive-video');
    items.push(${item('drive-video', 'DRIVE VIDEO')});
    localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    localStorage.setItem('debaser-companion', JSON.stringify({ computer: false, phone: false }));
  } catch {}
})()`;

const ROOM = '[data-dock-window="stream"]';

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
/** What the fullscreen box holds: the room's bar of keys, the remote view, and whether the pointer is hidden. */
const fullState = (page) =>
  page.evaluate(() => {
    const full = document.fullscreenElement;
    if (full === null) return null;
    return {
      bar: full.querySelectorAll('[data-watch-bar]').length,
      pictureBar: full.querySelectorAll('[data-picture-bar], [data-watch-picture-bar]').length,
      remote: full.querySelectorAll('[data-room-screen]').length,
      cursorHidden: full.classList.contains('cursor-none'),
      awake: full.querySelector('[data-watch-bar]')?.getAttribute('data-watch-bar-awake') ?? null,
    };
  });
const windowBox = (page) =>
  page.evaluate((selector) => {
    const box = document.querySelector(selector);
    if (box === null) return null;
    const rect = box.getBoundingClientRect();
    return { minimized: box.getAttribute('data-minimized') === 'true', x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
  }, ROOM);

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  const blocked = [];
  await context.route(/supabase\.(co|in)/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  // "Is the engine there?" answered yes for THE PC only; every other remote question is answered "no".
  await context.route(/\/api\/screens\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/screens/host' && !url.search.includes('server')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, settings: null, drive: false }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    console.log('SETUP: your room with a video on');
    await open(page, '/files?kind=video');
    await pressPlay(page, 'DRIVE VIDEO');
    await page.waitForSelector('[data-main-room-live]', { timeout: 30000 });
    await page.waitForSelector(`${ROOM} video[data-watch-video]`, { timeout: 30000 });
    await sleep(1500);

    console.log('1. FULLSCREEN WITH THE REMOTE VIEW');
    // A video's fullscreen first: its bar is there, as before.
    await page.locator('[data-room-full="enter"]').first().click();
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 10000 });
    await page.mouse.move(700, 500);
    await page.mouse.move(720, 520);
    await sleep(300);
    let state = await fullState(page);
    assert.ok(state.bar === 1 && state.awake === 'awake', `a video's fullscreen keeps its bar (${JSON.stringify(state)})`);
    pass("a video's fullscreen still has the room's bar over the picture's foot");
    await page.locator('[data-room-full="leave"]').first().click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 10000 });

    // The REMOTE view: THE PC.
    await page.locator(`${ROOM} [data-screen-toggle="off"]`).first().click();
    await page.locator('[data-remote-choice="engine"]').click();
    await page.waitForSelector(`${ROOM} [data-room-screen]`, { timeout: 15000 });
    await page.waitForSelector(`${ROOM} [data-screen-toggle="on"]`, { timeout: 5000 });
    const fullKey = page.locator('[data-room-full="enter"]');
    assert.ok((await fullKey.count()) > 0, 'the FULL key is there under the remote view');
    await fullKey.first().click();
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 10000 });
    await sleep(300);
    state = await fullState(page);
    assert.equal(state.remote, 1, 'the remote view is what is fullscreen');
    assert.equal(state.bar, 0, `no bar over the remote view's fullscreen (${JSON.stringify(state)})`);
    // Pointer moves and key presses woke the bar before; they wake nothing now.
    for (let step = 0; step < 6; step += 1) await page.mouse.move(300 + step * 120, 860 - step * 10);
    await page.keyboard.press('a');
    await page.keyboard.press('Shift');
    await sleep(300);
    state = await fullState(page);
    assert.ok(state.bar === 0 && state.pictureBar === 0, `still no bar after the pointer moves along the foot and keys are pressed (${JSON.stringify(state)})`);
    await sleep(4500);
    state = await fullState(page);
    assert.equal(state.cursorHidden, false, 'the pointer is never hidden with a bar that is not there');
    await page.screenshot({ path: join(SHOTS, '1-remote-fullscreen.png') });
    pass("the remote view's fullscreen has no player bar, whatever the pointer and keys do, and the pointer stays");

    // The way out: the remote's own SETTINGS > LEAVE FULLSCREEN.
    await page.locator('[data-screen-settings-key]').click();
    await page.locator('[data-screen-fullscreen]').click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 10000 });
    // The five-second video may have ended by now, so its FULL key may have gone with it: the room's own keys are the sign.
    await page.waitForSelector('[data-room-loop], [data-room-back]', { state: 'visible', timeout: 5000 });
    pass("SETTINGS > LEAVE FULLSCREEN leaves it, and the room's keys are back");

    // Nothing on: the five-second video has ended and been taken off, the REMOTE view is still the screen.
    await page.waitForSelector(`${ROOM} video[data-watch-video]`, { state: 'detached', timeout: 30000 });
    await page.waitForSelector(`${ROOM} [data-room-screen]`, { timeout: 5000 });
    await page.waitForSelector(`${ROOM} [data-screen-toggle="on"]`, { timeout: 5000 });
    await sleep(500);
    assert.equal(await page.locator('[data-room-full="enter"]:visible').count(), 1, 'one FULL key with the remote on and nothing playing');
    await page.locator('[data-room-full="enter"]:visible').click();
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 10000 });
    await sleep(300);
    state = await fullState(page);
    assert.ok(state.remote === 1 && state.bar === 0, `the remote view is fullscreen, with no bar (${JSON.stringify(state)})`);
    await page.screenshot({ path: join(SHOTS, '1b-remote-fullscreen-nothing-on.png') });
    if ((await page.locator('[data-screen-fullscreen]').count()) === 0) await page.locator('[data-screen-settings-key]').click();
    await page.locator('[data-screen-fullscreen]').click();
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 10000 });
    assert.equal(await page.locator('[data-room-full="enter"]:visible').count(), 1, 'and the key is back after leaving');
    pass('with nothing playing, the remote view has one FULL key; it goes fullscreen with no bar and comes back');

    // Back to the picture for part 2.
    await page.locator('[data-screen-settings-key]').click().catch(() => undefined);
    await page.locator(`${ROOM} [data-screen-toggle="on"]`).first().click();
    await page.waitForSelector(`${ROOM} [data-screen-toggle="off"]`, { timeout: 5000 });

    console.log('2. A REFRESH KEEPS THE ROOM OPEN');
    const before = await windowBox(page);
    assert.ok(before !== null && !before.minimized, `the room's window is open before the reload (${JSON.stringify(before)})`);
    await sleep(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(ROOM, { timeout: 60000 });
    await sleep(2500);
    let after = await windowBox(page);
    assert.ok(after !== null && !after.minimized, `open after the reload too (${JSON.stringify(after)})`);
    assert.ok(Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2 && Math.abs(after.w - before.w) <= 2 && Math.abs(after.h - before.h) <= 2, `where it was and as big (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
    await page.screenshot({ path: join(SHOTS, '2-open-after-reload.png') });
    pass('your room open before a reload is open after it, in the same place and size');

    // A second reload: the note is kept while it stays open.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(ROOM, { timeout: 60000 });
    await sleep(2500);
    after = await windowBox(page);
    assert.ok(after !== null && !after.minimized, `and after a second reload (${JSON.stringify(after)})`);
    pass('and after a second reload');

    // Folded before the reload: folded after it, its key on the shelf above the player.
    await page.locator(`${ROOM} button[aria-label^="Fold "]`).first().click();
    await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('data-minimized') === 'true', ROOM, { timeout: 5000 });
    await sleep(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(ROOM, { state: 'attached', timeout: 60000 });
    await sleep(2500);
    after = await windowBox(page);
    assert.ok(after !== null && after.minimized, `folded before, folded after (${JSON.stringify(after)})`);
    assert.ok((await page.locator('[data-room-shelf-key]').count()) > 0, 'its key is on the shelf above the player');
    pass('your room folded before a reload comes back folded, as before');

    assert.deepEqual(errors, [], `no page errors (${errors.join(' | ')})`);
    assert.deepEqual(blocked, [], 'nothing asked the live database');
    console.log(`\nPASSED ${passed}`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(`\nFAILED after ${passed}: ${failure.message}`);
    if (errors.length) console.error(`page errors: ${errors.join(' | ')}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
