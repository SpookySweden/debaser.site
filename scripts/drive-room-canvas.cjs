/*
 * Drives your room's canvas (CANVAS, 2026-11-17) in a real browser, on a local dev server with mock data only.
 * Luke: "i drew while streaming earlier and that canvas cant be seen under canvases nor is it in my current room ...
 * make sure they are all properly accessible to everyone in the room and saved safely."
 *
 *   1. In your main room while it is PRIVATE, a stroke is kept: the room's canvas opens and the stroke is written.
 *   2. GO LIVE, a second stroke, GO PRIVATE: the canvas stays open (going private once closed it, unsaved).
 *   3. A reload: the room comes back and its canvas still shows both strokes.
 *   4. The window's X folds the room; the canvas stays open.
 *   5. END ROOM, DON'T SAVE: the canvas closes unsaved, and CANVASES lists it under PAST CANVASES, NOT SAVED, drawn
 *      from its strokes; OPEN shows it.
 *
 *   node scripts/drive-room-canvas.cjs --base http://localhost:3321
 *
 * Start the server with a launcher that puts every data source on mock and the Supabase address and key EMPTY (see
 * Temp/browse/dev-mock-aquarium.cjs on the desktop): nothing reaches the live database. Chrome runs with
 * --disable-audio-output (headless media clocks froze on the desktop's sound output, 2026-11-16).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3321');
const SHOTS = join('Temp', 'browse', 'room-canvas');
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

const watchTables = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}'));
const canvasTables = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('debaser.canvas.v1') ?? '{"canvases":[],"inputs":[]}'));
const openMain = async (page) => (await watchTables(page)).rooms.find((room) => room.origin === 'music' && room.originalHostId === 'drive-user' && room.endedAt === null) ?? null;
const canvasesOf = async (page, roomId) => {
  const tables = await canvasTables(page);
  return tables.canvases.filter((canvas) => canvas.roomId === roomId).map((canvas) => ({ ...canvas, inputs: tables.inputs.filter((input) => input.canvasId === canvas.id).length }));
};

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 120000 });
  const notNow = page.getByText('NOT NOW', { exact: false });
  if (await notNow.count()) await notNow.first().click().catch(() => undefined);
  const keep = page.getByText('[ KEEP THESE SETTINGS ]', { exact: false });
  if (await keep.count()) await keep.first().click().catch(() => undefined);
  await sleep(800);
}
async function pressPlay(page) {
  await page.waitForFunction(() => /VIDEOS\s*\(\d+\)|\[\+\] VIDEOS|DRIVE VIDEO/.test(document.body.innerText), null, { timeout: 30000 });
  const category = page.locator('a, button', { hasText: /VIDEOS\s*\(\d+\)/ });
  if (await category.count()) {
    await category.first().click();
    await page.waitForURL(/[?&](kind|cat)=/, { timeout: 15000 }).catch(() => undefined);
    await sleep(1500);
  }
  const fold = page.getByText('[+] VIDEOS', { exact: false });
  if (await fold.count()) await fold.first().click().catch(() => undefined);
  await page.waitForFunction(() => {
    const play = document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']');
    if (play !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes('DRIVE VIDEO')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 60000, polling: 500 });
  await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
}
async function closeCog(page) {
  if ((await page.locator('[data-room-settings]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-room-settings]') === null, null, { timeout: 5000 });
}

/** The canvas shown over the picture (the CANVAS key), then one stroke dragged across it at `row` (0..1 of its height). */
async function drawStroke(page, row) {
  if ((await page.locator('[data-room-canvas="shown"]').count()) === 0) await page.locator('[data-dock-window="stream"] [data-canvas-toggle]').first().click();
  await page.waitForSelector('[data-room-canvas="shown"]', { timeout: 10000 });
  const box = await page.locator('[data-room-canvas="shown"] canvas').first().boundingBox();
  assert.ok(box !== null && box.width > 50, 'the canvas is drawn');
  const y = box.y + box.height * row;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(box.x + box.width * (0.25 + step * 0.04), y, { steps: 2 });
  await page.mouse.up();
}
/** How many pixels of the room's canvas are painted. */
const painted = (page) =>
  page.evaluate(() => {
    const element = document.querySelector('[data-room-canvas] canvas');
    if (element === null) return -1;
    const data = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
    return count;
  });

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(SEED);
  const blocked = [];
  await context.route(/supabase\.(co|in)/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    console.log('1. A STROKE IN YOUR PRIVATE ROOM IS KEPT');
    await open(page, '/files?kind=video');
    await pressPlay(page);
    await page.waitForSelector('[data-main-room-live="private"]', { timeout: 30000 });
    const room = await openMain(page);
    assert.notEqual(room, null, 'your main room');
    assert.equal(room.isPublic, false, 'private');
    await drawStroke(page, 0.3);
    await page.waitForFunction(
      (id) => {
        const tables = JSON.parse(localStorage.getItem('debaser.canvas.v1') ?? '{"canvases":[],"inputs":[]}');
        const canvas = tables.canvases.find((entry) => entry.roomId === id && entry.closedAt === null);
        return canvas !== undefined && tables.inputs.some((input) => input.canvasId === canvas.id);
      },
      room.id,
      { timeout: 15000 },
    ).catch(() => undefined);
    const first = (await canvasesOf(page, room.id)).filter((canvas) => canvas.closedAt === null);
    assert.equal(first.length, 1, `the room's canvas opened while private (canvases: ${JSON.stringify(await canvasesOf(page, room.id))})`);
    assert.ok(first[0].inputs >= 1, 'and the stroke was written');
    const canvasId = first[0].id;
    await page.screenshot({ path: join(SHOTS, '1-private-stroke.png') });
    pass('drawing in your room while it is private opens its canvas and writes the stroke');

    console.log('2. GO LIVE, A STROKE, GO PRIVATE: THE CANVAS STAYS OPEN');
    await page.locator('[data-main-room-live="private"]').first().click();
    await page.waitForSelector('[data-main-room-who]', { timeout: 10000 });
    await page.locator('[data-main-room-start]').click();
    await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
    await closeCog(page);
    await drawStroke(page, 0.6);
    await sleep(3500);
    await page.locator('[data-main-room-live="live"]').first().click();
    await page.waitForSelector('[data-main-room-private]', { timeout: 10000 });
    await page.locator('[data-main-room-private]').click();
    await page.waitForSelector('[data-main-room-live="private"]', { timeout: 15000 });
    await closeCog(page);
    await sleep(2500);
    const after = (await canvasesOf(page, room.id)).find((canvas) => canvas.id === canvasId);
    assert.equal(after.closedAt, null, 'going private did not close the canvas');
    assert.ok(after.inputs >= 2, `both strokes are written (${after.inputs})`);
    assert.equal((await canvasesOf(page, room.id)).length, 1, 'still the one canvas');
    pass('GO LIVE then GO PRIVATE: the same canvas, still open, with both strokes');

    console.log('3. A RELOAD: THE ROOM\'S CANVAS COMES BACK');
    await open(page, '/forum');
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 30000 });
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForSelector('[data-main-room-live]', { timeout: 15000 });
    if ((await page.locator('[data-room-canvas="shown"]').count()) === 0) await page.locator('[data-dock-window="stream"] [data-canvas-toggle]').first().click();
    await page.waitForSelector('[data-room-canvas="shown"]', { timeout: 10000 });
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-room-canvas] canvas');
      if (element === null) return false;
      const data = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
      return false;
    }, null, { timeout: 15000 });
    assert.ok((await painted(page)) > 20, 'the strokes are drawn');
    await page.screenshot({ path: join(SHOTS, '3-after-reload.png') });
    pass('after a reload your room shows its canvas with the strokes on it');

    console.log('4. X FOLDS THE ROOM; THE CANVAS STAYS OPEN');
    await page.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    await page.waitForSelector('[data-room-shelf-key]', { timeout: 10000 });
    await sleep(1500);
    assert.equal((await canvasesOf(page, room.id)).find((canvas) => canvas.id === canvasId).closedAt, null, 'still open');
    await page.locator('[data-room-shelf-key] button').click();
    await page.waitForSelector('[data-main-room-live]', { timeout: 10000 });
    pass('folding the room leaves its canvas open');

    console.log('5. END ROOM, DON\'T SAVE: CANVASES STILL HAS IT');
    if ((await page.locator('[data-room-end-section]').count()) === 0) await page.locator('[data-room-settings-key]').first().click();
    await page.locator('[data-main-room-end="first"]').first().click();
    await page.locator('[data-main-room-end="confirm"]').first().click();
    await page.waitForSelector('[data-canvas-ask="close"]', { timeout: 10000 });
    await page.locator('[data-canvas-ask="close"] button', { hasText: "DON'T SAVE" }).click();
    await page.waitForFunction(() => document.querySelector('[data-dock-window="stream"]') === null, null, { timeout: 15000 });
    const closed = (await canvasesOf(page, room.id)).find((canvas) => canvas.id === canvasId);
    assert.notEqual(closed.closedAt, null, 'END ROOM closed it');
    assert.equal(closed.savedAt, null, 'unsaved');
    await open(page, '/stream?tab=canvases');
    await page.waitForSelector(`[data-past-canvas="${canvasId}"]`, { timeout: 20000 });
    const row = await page.locator(`[data-past-canvas="${canvasId}"]`).innerText();
    assert.match(row, /NOT SAVED/, `the row says NOT SAVED (${row.replace(/\s+/g, ' ')})`);
    await page.waitForFunction((id) => {
      const element = document.querySelector(`[data-past-canvas="${id}"] canvas`);
      if (element === null) return false;
      const data = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
      return false;
    }, canvasId, { timeout: 15000 });
    // A first visit's PRIVACY window may have come up over the list by now: put away as it is.
    const privacy = page.locator('[data-dock-window="privacy-first-look"] button', { hasText: /KEEP (IT PRIVATE|THESE SETTINGS)/ });
    if (await privacy.count()) await privacy.first().click();
    await page.locator(`[data-past-canvas="${canvasId}"] button`, { hasText: '[ OPEN ]' }).click();
    await page.waitForSelector('[data-stream-art-window]', { timeout: 10000 });
    assert.match(await page.locator('[data-stream-art-window]').innerText(), /NOBODY SAVED THIS ONE/, 'the window says nobody saved it');
    await page.screenshot({ path: join(SHOTS, '5-past-canvases.png') });
    pass('after END ROOM without saving, CANVASES lists the drawing under PAST CANVASES, drawn from its strokes, and OPEN shows it');

    assert.deepEqual(blocked, [], 'nothing went to the live database');
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`\nroom canvas drive: ${passed} passed`);
  } catch (failure) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.error(`\nFAILED after ${passed} passed: ${failure.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
