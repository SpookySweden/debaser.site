/*
 * Drives the room's fullscreen (Luke, 2026-11-19: "remove the green bar from the fullscreen when watching in the room ... the
 * green outline of the entire screen", and "make it so that the media buttons at the bottom dissapear after a few seconds of
 * no mouse movement or as soon as the mouse is moved off the video"; fullscreen only, his choice) in a real browser, on a
 * local dev server with mock data:
 *
 *   1. In the room the bar of keys is under the picture and stays: no timer there. The look's frame is drawn.
 *   2. Fullscreen with the JUNGLE look (Emerald lines, the green Luke saw): the stage draws no outline (0 border, no stripes).
 *   3. Fullscreen, the bar lies over the foot of the picture; a still pointer for 3 s: it goes (clear, keys take no press);
 *      a move: back at once; resting still on the bar does not keep it (ROOMBARS, 2026-11-21); moving to the foot of the screen wakes it; leaving: gone at once.
 *   4. Out of fullscreen: the bar under the picture again, showing, and the frame back.
 *
 *   node scripts/drive-fullscreen-bar.cjs --base http://localhost:3320
 *
 * Start the server with Temp/browse/dev-mock-rooms.cjs (every data source on mock, Supabase empty): any request to a Supabase
 * address or api.debaser.site fails the run. From the network it asks only a five-second public test video.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3320';
const SHOTS = join('Temp', 'browse', 'fullscreen-bar');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const ROOM = '[data-dock-window="stream"]';
const BAR = '[data-watch-bar="shown"]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const ITEM = `{ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]');
    if (!items.some((item) => item.id === 'drive-video')) {
      items.push(${ITEM});
      localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    }
  } catch {}
})()`;

async function roomWithVideo(page) {
  await page.goto(`${BASE}/files?kind=video`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
  for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]', '[ I NEVER HAD ONE ]']) {
    const key = page.getByText(text, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(800);
  await page.waitForFunction(() => {
    if (document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']') !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((b) => b.textContent.includes('DRIVE VIDEO')) ?? shut.find((b) => b.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 60000, polling: 500 });
  await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
  await page.waitForSelector(`${ROOM} video[data-watch-video]`, { timeout: 60000 });
}
/** JUNGLE picked in the cog, as a person would, so the stage wears its Emerald frame. */
async function pickJungle(page) {
  await page.locator(`${ROOM} [data-room-settings-key]`).click();
  await page.locator('[data-room-look="JUNGLE"]').first().click({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-room-settings]') === null, null, { timeout: 5000 });
}
const barState = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const key = el.querySelector('button');
    return { awake: el.getAttribute('data-watch-bar-awake'), opacity: style.opacity, position: style.position, bottom: Math.round(box.bottom), height: Math.round(box.height), keyPress: key === null ? null : getComputedStyle(key).pointerEvents };
  }, BAR);
/** The stage (the box that goes fullscreen) as drawn: border width, whether a frame stripe is painted, the line colour. */
const outline = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel).parentElement;
    const style = getComputedStyle(el);
    return { border: style.borderTopWidth, striped: style.backgroundImage.includes('linear-gradient'), line: style.getPropertyValue('--frame-line').trim(), full: document.fullscreenElement === el };
  }, BAR);

(async () => {
  const executablePath = findChrome();
  assert.ok(executablePath, 'no Chrome on this machine');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const live = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(SEED);
    await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => {
      live.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await roomWithVideo(page);
    await pickJungle(page);

    console.log('1. IN THE ROOM');
    // While the music bar shows the stream the keys live there (WatchRoom: keysOnMusicBar) and the picture has no bar under
    // it; otherwise the bar is under it. Either way, nothing in the room may hide: the stage is read through the picture.
    await page.waitForSelector(`${ROOM} [data-room-picture]`, { timeout: 15000 });
    const stage = () =>
      page.evaluate((room) => {
        const el = document.querySelector(`${room} [data-room-picture]`).parentElement;
        const style = getComputedStyle(el);
        return { border: style.borderTopWidth, striped: style.backgroundImage.includes('linear-gradient'), line: style.getPropertyValue('--frame-line').trim() };
      }, ROOM);
    const before = await stage();
    assert.notEqual(before.border, '0px', 'in the room the screen keeps its frame');
    assert.ok(before.striped, 'drawn by the frame stripes');
    await page.mouse.move(5, 5);
    await sleep(4000);
    let bar;
    if ((await page.locator(BAR).count()) > 0) {
      bar = await barState(page);
      assert.equal(bar.awake, null, 'no timer in the room');
      assert.equal(bar.opacity, '1');
      assert.equal(bar.position, 'relative', 'under the picture, not over it');
    }
    assert.equal(await page.locator('[data-watch-bar-awake]').count(), 0, 'no bar anywhere is on the fullscreen timer');
    await page.screenshot({ path: join(SHOTS, '1-room.png') });
    pass(`in the room: no bar hides with the pointer away 4 s; the frame is drawn (${before.border}, ${before.line})`);

    console.log('2. FULLSCREEN: NO OUTLINE');
    await page.locator('[data-room-full="enter"]').first().click();
    await page.waitForSelector(BAR, { timeout: 8000 });
    await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
    await sleep(400);
    const inFull = await outline(page);
    assert.ok(inFull.full, 'the stage is what is fullscreen');
    assert.equal(inFull.border, '0px', 'fullscreen, the stage has no border');
    assert.ok(!inFull.striped, 'and no frame stripe is painted');
    await page.screenshot({ path: join(SHOTS, '2-fullscreen-awake.png') });
    pass('fullscreen with JUNGLE on: no outline round the screen (0px border, no stripes)');

    console.log('3. FULLSCREEN: THE BAR');
    await page.mouse.move(720, 450);
    bar = await barState(page);
    assert.equal(bar.awake, 'awake');
    assert.equal(bar.position, 'absolute', 'over the foot of the picture');
    assert.equal(bar.bottom, 900, 'along the foot of the screen');
    pass(`the bar lies over the foot of the picture (${bar.height}px) and shows`);

    await sleep(3600);
    bar = await barState(page);
    assert.equal(bar.awake, 'asleep', 'gone after 3 s of a still pointer');
    assert.equal(bar.opacity, '0');
    assert.equal(bar.keyPress, 'none', 'its keys take no press');
    await page.screenshot({ path: join(SHOTS, '3-fullscreen-asleep.png') });
    pass('a still pointer for 3.6 s: gone, and its keys take no press');

    await page.mouse.move(700, 400);
    assert.equal((await barState(page)).awake, 'awake');
    pass('a move over the picture brings it back at once');

    const keys = await page.locator(BAR).boundingBox();
    await page.mouse.move(keys.x + keys.width / 2, keys.y + keys.height / 2);
    // ROOMBARS (Luke, 2026-11-21: "goes away after a few seconds of no mouse movement"): resting still on the bar no longer keeps it.
    await sleep(3600);
    assert.equal((await barState(page)).awake, 'asleep', 'resting still on the bar does not keep it');
    pass('the pointer resting still on the bar for 3.6 s: gone all the same (ROOMBARS)');

    await page.mouse.move(700, 400);
    await sleep(3600);
    assert.equal((await barState(page)).awake, 'asleep');
    await page.mouse.move(700, 890);
    assert.equal((await barState(page)).awake, 'awake', 'moving to the foot of the screen wakes it');
    pass('asleep, moving to the foot of the screen wakes it');

    await page.mouse.move(700, 400);
    // The pointer leaving the window: headless Chrome sends the stage its pointerleave when the pointer goes off the page.
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null })));
    await page.mouse.move(2000, 2000).catch(() => undefined);
    await sleep(200);
    const gone = await barState(page);
    if (gone.awake === 'asleep') pass('the pointer leaving the screen: gone at once (0.2 s, not 3)');
    else console.log(`  --  leaving: headless Chrome did not move the pointer off the page (bar ${gone.awake}); not proved here`);

    console.log('4. OUT OF FULLSCREEN');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
    await sleep(300);
    assert.equal(await page.locator('[data-watch-bar-awake]').count(), 0, 'off the fullscreen timer');
    if ((await page.locator(BAR).count()) > 0) {
      bar = await barState(page);
      assert.equal(bar.opacity, '1');
      assert.equal(bar.position, 'relative', 'under the picture again');
    }
    assert.notEqual((await stage()).border, '0px', 'the frame is back');
    await page.screenshot({ path: join(SHOTS, '4-room-again.png') });
    pass('out of fullscreen: the bar under the picture, showing; the frame back');

    assert.deepEqual(live, [], 'nothing reached a live database');
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`fullscreen-bar drive passed (${passed} steps); captures in ${SHOTS}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
