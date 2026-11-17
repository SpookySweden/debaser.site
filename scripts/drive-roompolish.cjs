/*
 * Drives ROOMPOLISH (Luke's list, 2026-11-17) in a real browser, on a local dev server with mock data only:
 *
 *   1. Your room's cog: the bar's [ GO LIVE ] opens the cog on WHO CAN JOIN (the keyboard on the picked choice); GO LIVE there
 *      puts the room live; [ ● LIVE ] opens it on GO PRIVATE; END ROOM is in the cog (two presses) and nowhere on the bar.
 *   2. The picture's keys as video-player marks: FULL [ ⤢ ], leaving fullscreen [ ⤡ ], PIP [ ⧉ ], each drawn by this browser's
 *      fonts (not an empty box), with its words in its name and tooltip; close-ups saved for reading.
 *   3. The visualiser and canvas keys: [ VIS ] and [ CANVAS ], shown as the room opens, still there at 4:50 without the pointer,
 *      gone at 5:05, back at once when the pointer comes over the picture, and back for a key reached by the keyboard. A fake
 *      clock stands in for the five minutes.
 *   4. A signed-out visitor's own room: its cog says LOG IN for going live, and its END ROOM ends it.
 *
 *   node scripts/drive-roompolish.cjs --base http://localhost:3320 [--browser chrome|edge] [--only 1,2,3,4]
 *
 * Start the server with every data source on mock and Supabase empty (Temp/browse/dev-mock-rooms.cjs, as drive-roomui's
 * header says): nothing reaches the live database (any request to it fails the run), and the account is a made-up one in the
 * browser's mock store. From the network it asks only a five-second public test video.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3320');
const BROWSER = opt('--browser', 'chrome');
const ONLY = opt('--only', null);
const wants = (item) => ONLY === null || ONLY.split(',').includes(String(item));
const SHOTS = join('Temp', 'browse', 'roompolish');
mkdirSync(SHOTS, { recursive: true });
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((path) => existsSync(path));
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const ROOM = '[data-dock-window="stream"]';
const COG = '[data-room-settings]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const ITEM = `{ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
const withItem = `const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]');
    if (!items.some((item) => item.id === 'drive-video')) {
      items.push(${ITEM});
      localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    }`;
const SIGNED_IN = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    ${withItem}
  } catch {}
})()`;
const VISITOR = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    delete kept.sessionUserId;
    localStorage.setItem('debaser.auth.mock.v1', JSON.stringify(kept));
    ${withItem}
  } catch {}
})()`;

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
  for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]', '[ I NEVER HAD ONE ]']) {
    const key = page.getByText(text, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(800);
}
async function pressPlay(page) {
  await page.waitForFunction(() => {
    const play = document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']');
    if (play !== null) return true;
    const shut = [...document.querySelectorAll('button[aria-expanded="false"]')];
    (shut.find((button) => button.textContent.includes('DRIVE VIDEO')) ?? shut.find((button) => button.textContent.includes('[+] VIDEOS')))?.click();
    return false;
  }, null, { timeout: 60000, polling: 500 });
  await page.evaluate(() => document.querySelector('button[aria-label=\'Play "DRIVE VIDEO" here\']').click());
}
/** Opens your room with the drive's video playing in it. */
async function roomWithVideo(page) {
  await open(page, '/files?kind=video');
  await pressPlay(page);
  await page.waitForSelector(`${ROOM} video[data-watch-video]`, { timeout: 60000 });
  await page.waitForSelector('[data-main-room-live]', { timeout: 30000 });
}
async function closeCog(page) {
  if ((await page.locator(COG).count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction((cog) => document.querySelector(cog) === null, COG, { timeout: 5000 });
}
/**
 * Whether this browser draws `text` with a real glyph: drawn in the key's own font on a canvas, it must differ from the box a
 * font draws for a character nobody has (U+FFFF), and from nothing at all.
 */
const drawnHere = (page, selector, text) =>
  page.evaluate(
    ([sel, mark]) => {
      const key = document.querySelector(sel);
      const font = getComputedStyle(key).font;
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 60;
      const pen = canvas.getContext('2d');
      const paint = (what) => {
        pen.clearRect(0, 0, 120, 60);
        pen.font = font;
        pen.fillStyle = '#000';
        pen.textBaseline = 'middle';
        pen.fillText(what, 10, 30);
        return Array.from(pen.getImageData(0, 0, 120, 60).data.filter((_, at) => at % 4 === 3)).join(',');
      };
      const blank = paint('');
      return [...mark].filter((ch) => ch.trim() !== '').map((ch) => {
        const glyph = paint(ch);
        return { ch, drawn: glyph !== blank && glyph !== paint('\uFFFF') && glyph !== paint('\u{10FFFD}') };
      });
    },
    [selector, text],
  );

(async () => {
  const executablePath = BROWSER === 'edge' ? EDGE : findChrome();
  assert.ok(executablePath, `no ${BROWSER} on this machine`);
  console.log(`browser: ${BROWSER} (${executablePath})`);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const live = [];
  const errors = [];
  const newPage = async (seed, { clock = false } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(seed);
    await context.route(/supabase\.(co|in)/, (route) => {
      live.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    if (clock) await page.clock.install();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };
  try {
    if (wants(1)) {
      console.log('1. YOUR ROOM\'S COG: WHO CAN JOIN AND END ROOM');
      const page = await newPage(SIGNED_IN);
      await roomWithVideo(page);
      assert.equal(await page.locator('[data-main-room-end]').count(), 0, 'no END ROOM anywhere while the cog is shut (the bar has none)');
      assert.equal(await page.locator('[data-main-room-live="private"]').count(), 1, 'GO LIVE is on the bar');
      await page.locator('[data-main-room-live="private"]').click();
      await page.waitForSelector(`${COG} [data-main-room-who]`, { timeout: 10000 });
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-main-room-privacy'));
      assert.equal(focused, 'private', 'the keyboard is on WHO CAN JOIN, on the picked choice (PRIVATE)');
      assert.equal(await page.locator(`${COG} [data-main-room-end="first"]`).count(), 1, 'END ROOM is in the cog');
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-1-cog-private.png`) });
      pass('the bar\'s [ GO LIVE ] opens the cog on WHO CAN JOIN (PRIVATE picked, the keyboard on it); END ROOM is in the cog, not on the bar');

      await page.locator(`${COG} [data-main-room-start]`).click();
      await page.waitForSelector('[data-main-room-live="live"]', { timeout: 15000 });
      await page.waitForFunction((cog) => /YOUR ROOM IS LIVE\./.test(document.querySelector(`${cog} [data-main-room-said]`)?.textContent ?? ''), COG, { timeout: 5000 });
      assert.equal(await page.locator(`${COG} [data-main-room-private]`).count(), 1, 'live: GO PRIVATE is offered');
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-1-cog-live.png`) });
      await closeCog(page);
      // The cog key on its own opens the cog at the top: the GO LIVE ask was forgotten when it shut.
      await page.locator(`${ROOM} [data-room-settings-key]`).click();
      await page.waitForSelector(`${COG} [data-main-room-who]`, { timeout: 10000 });
      await sleep(400);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-main-room-privacy') ?? null), null, 'a plain press of the cog does not jump to WHO CAN JOIN');
      await closeCog(page);
      pass('GO LIVE in the cog put the room live and said so; GO PRIVATE is there now; the cog key alone opens the cog at the top');

      await page.locator('[data-main-room-live="live"]').click();
      await page.waitForSelector(`${COG} [data-main-room-private]`, { timeout: 10000 });
      await page.locator(`${COG} [data-main-room-private]`).click();
      await page.waitForSelector('[data-main-room-live="private"]', { timeout: 15000 });
      pass('[ ● LIVE ] opens the cog; GO PRIVATE there takes the room off the lists');

      await page.locator(`${COG} [data-main-room-end="first"]`).click();
      await page.waitForSelector(`${COG} [data-main-room-end="confirm"]`, { timeout: 5000 });
      await page.locator(`${COG} [data-main-room-end="confirm"]`).click();
      await page.waitForFunction((room) => document.querySelector(room) === null, ROOM, { timeout: 15000 });
      pass('END ROOM in the cog, pressed twice, ends the room and closes its window');
      await page.context().close();
    }

    if (wants(2)) {
      console.log('2. THE PICTURE\'S KEYS AS VIDEO-PLAYER MARKS');
      const page = await newPage(SIGNED_IN);
      await roomWithVideo(page);
      // The keys sit under the picture, or on the music bar while it shows the room.
      const full = page.locator('[data-room-full="enter"]').first();
      await full.waitFor({ timeout: 15000 });
      assert.equal((await full.innerText()).trim(), '[ ⤢ ]');
      assert.equal(await full.getAttribute('aria-label'), 'Fullscreen');
      assert.equal(await full.getAttribute('title'), 'Full screen');
      const pip = page.locator('[data-room-pip]').first();
      assert.equal((await pip.innerText()).trim(), '[ ⧉ ]');
      assert.match((await pip.getAttribute('aria-label')) ?? '', /^Picture in picture/);
      assert.match((await pip.getAttribute('title')) ?? '', /^Picture in picture/);
      const marks = [...(await drawnHere(page, '[data-room-full="enter"]', '⤢⤡')), ...(await drawnHere(page, '[data-room-pip]', '⧉'))];
      assert.ok(marks.every((mark) => mark.drawn), `each mark is drawn by ${BROWSER}'s fonts, not a box: ${JSON.stringify(marks)}`);
      const bar = await page.locator('[data-room-full="enter"]').first().evaluate((key) => {
        const box = key.closest('[data-watch-bar]').getBoundingClientRect();
        return { x: box.left, y: box.top, width: box.width, height: box.height };
      });
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-2-bar.png`), clip: bar });
      pass(`FULL [ ⤢ ] and PIP [ ⧉ ] on the bar, named and tipped in words, each drawn by ${BROWSER}'s own fonts`);

      await full.click();
      await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
      const leave = page.locator('[data-room-full="leave"]').first();
      await leave.waitFor({ timeout: 8000 });
      assert.equal((await leave.innerText()).trim(), '[ ⤡ ]');
      assert.equal(await leave.getAttribute('aria-label'), 'Leave fullscreen');
      assert.equal(await leave.getAttribute('title'), 'Leave full screen');
      const fullBar = await leave.evaluate((key) => {
        const box = key.closest('[data-watch-bar]').getBoundingClientRect();
        return { x: box.left, y: box.top, width: box.width, height: box.height };
      });
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-2-bar-fullscreen.png`), clip: fullBar });
      await leave.click();
      await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
      pass('fullscreen, the key reads [ ⤡ ] (Leave fullscreen) and takes you out');
      await page.context().close();
    }

    if (wants(3)) {
      console.log('3. THE VISUALISER AND CANVAS KEYS: QUIET, AND GONE AFTER FIVE MINUTES');
      const page = await newPage(SIGNED_IN, { clock: true });
      await roomWithVideo(page);
      const corner = `${ROOM} [data-room-corner-keys]`;
      const state = () =>
        page.evaluate((sel) => {
          const box = document.querySelector(sel);
          return { said: box.getAttribute('data-room-corner-keys'), opacity: getComputedStyle(box).opacity, text: box.innerText.replace(/\s+/g, ' ').trim() };
        }, corner);
      assert.deepEqual(await state(), { said: 'shown', opacity: '1', text: '[ VIS ] [ CANVAS ]' }, 'shown as the room opens, as [ VIS ] and [ CANVAS ]');
      // (2026-11-17: VIS and CANVAS are words again, so there are no symbol glyphs in the corner to check the fonts for.)
      const cornerBox = await page.locator(corner).boundingBox();
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-3-corner.png`), clip: { x: cornerBox.x - 40, y: cornerBox.y - 10, width: cornerBox.width + 50, height: cornerBox.height + 20 } });
      // The pointer away from the picture, then the clock on.
      await page.mouse.move(5, 5);
      await page.clock.fastForward('04:50');
      assert.equal((await state()).said, 'shown', 'still there at 4:50 without the pointer');
      await page.clock.fastForward('00:15');
      assert.deepEqual(await state(), { said: 'hidden', opacity: '0', text: '[ VIS ] [ CANVAS ]' }, 'gone at 5:05, in its place');
      assert.equal(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).pointerEvents, corner), 'none', 'gone, they take no press');
      pass('[ VIS ] and [ CANVAS ] show as the room opens; without the pointer over the picture they stay at 4:50 and are gone at 5:05');

      const picture = await page.locator(`${ROOM} [data-room-picture]`).boundingBox();
      await page.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 2);
      assert.deepEqual(await state(), { said: 'shown', opacity: '1', text: '[ VIS ] [ CANVAS ]' }, 'back at once with the pointer over the picture');
      await page.clock.fastForward('04:00');
      await page.mouse.move(picture.x + picture.width / 2 + 20, picture.y + picture.height / 2);
      await page.clock.fastForward('04:00');
      assert.equal((await state()).said, 'shown', 'a pointer moving over the picture keeps them (4 + 4 minutes, moved between)');
      await page.clock.fastForward('05:05');
      await page.clock.fastForward('05:05');
      assert.equal((await state()).said, 'shown', "and resting still over it (10 minutes): Luke's 'not hovering' is what hides them");
      pass('the pointer over the picture brings them back at once, and keeps them while it is there, moving or still');

      await page.mouse.move(5, 5);
      await page.clock.fastForward('05:05');
      assert.equal((await state()).said, 'hidden');
      await page.keyboard.press('Shift');
      await page.locator(`${corner} [data-visualiser-toggle]`).focus();
      const keyboard = await page.evaluate((sel) => ({ opacity: getComputedStyle(document.querySelector(sel)).opacity, focusVisible: document.querySelector(`${sel} [data-visualiser-toggle]`).matches(':focus-visible') }), corner);
      assert.deepEqual(keyboard, { opacity: '1', focusVisible: true }, 'a key reached by the keyboard shows them');
      pass('hidden, a key reached by the keyboard shows them both');
      await page.context().close();
    }

    if (wants(4)) {
      console.log('4. A SIGNED-OUT VISITOR\'S OWN ROOM: THE COG SAYS LOG IN, AND ENDS IT');
      const page = await newPage(VISITOR);
      await roomWithVideo(page);
      assert.equal(await page.locator('[data-main-room-end]').count(), 0, 'no END ROOM on the bar');
      await page.locator(`${ROOM} [data-room-settings-key]`).click();
      await page.waitForSelector('[data-visitor-room-settings]', { timeout: 10000 });
      assert.match(await page.locator('[data-visitor-room-settings]').innerText(), /LOG IN FIRST[\s\S]*\[ LOG IN \][\s\S]*\[ END ROOM \]/);
      assert.equal(await page.locator('[data-visitor-room-settings] [data-main-room-who]').count(), 0, 'no WHO CAN JOIN');
      await page.screenshot({ path: join(SHOTS, `${BROWSER}-4-visitor-cog.png`) });
      await closeCog(page);
      // The bar's GO LIVE opens the same cog.
      await page.locator('[data-main-room-live="private"]').click();
      await page.waitForSelector('[data-visitor-room-settings]', { timeout: 10000 });
      await page.locator('[data-visitor-room-settings] [data-main-room-end="first"]').click();
      await page.locator('[data-visitor-room-settings] [data-main-room-end="confirm"]').click();
      await page.waitForFunction((room) => document.querySelector(room) === null, ROOM, { timeout: 15000 });
      pass('signed out: the cog (and the bar\'s GO LIVE) says LOG IN for going live and holds END ROOM, which ends the room');
      await page.context().close();
    }

    assert.deepEqual(live, [], 'nothing asked the live database');
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`drive-roompolish (${BROWSER}): ${passed} passed`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
