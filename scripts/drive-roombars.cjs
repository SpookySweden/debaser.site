/*
 * ROOMBARS (Luke, 2026-11-21: "When full screening video make it so that the bottom bar goes away after a few seconds of no mouse
 * movement. Allowing clicking on the thumbnail in media tab to auto open the video in the room, in the settings cog at the bottom
 * of the player bar, add a toggle for the full screen, pause play, skip etc to be a bar at the bottom of the viewport as well as
 * the player bar. Off by default but on for moldavius figtree by default as she requested it"), in a real browser, on a local dev
 * server with mock data only:
 *
 *   1. Fullscreen from the bar's FULL key, the pointer left resting on the bar: the bar goes after 3 s all the same, the pointer
 *      with it; a key press brings it back at once.
 *   2. MEDIA: a press on a card's picture is PLAY (its key turns to CLOSE, the player opens); the picture's `i` still opens
 *      DETAILS and plays nothing; a playing card's picture no longer plays or closes anything.
 *   3. `[ KEYS IN THE PICTURE ]` in the player bar's options: off by default (no keys over the picture); on, the picture carries
 *      the playback keys along its foot (FULL, PIP, the sound, where it is) as well as the bar under it; they go after 3 s still
 *      and come back on a move; FULL there fullscreens the room, where only the room's own bar lies over the picture; the
 *      choice survives a reload.
 *   4. Signed in as moldavius figtree's account id (mock sign-in): the keys are there with nothing chosen; her OFF wins, is saved
 *      to her (mock) settings row, and survives a reload.
 *
 *   node scripts/drive-roombars.cjs --base http://localhost:3315 [--only 1,2,3,4] [--verbose]
 *
 * Start the server with every data source on mock and Supabase empty (as Temp/browse/dev-mock-rooms.cjs does): any request to a
 * Supabase address or api.debaser.site fails the run. From the network it asks only a five-second public test video (and, for
 * MEDIA, whatever player the mock card's platform loads).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3315';
const VERBOSE = args.includes('--verbose');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const SHOTS = join('Temp', 'browse', 'roombars');
mkdirSync(SHOTS, { recursive: true });
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
const ROOM = '[data-dock-window="stream"]';
const BAR = '[data-watch-bar="shown"]';
const PICTURE_KEYS = '[data-room-picture-keys]';
const FIGTREE = 'a887588b-1dd2-4be3-9c9f-9897ec492c31';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const part = (n) => ONLY === null || ONLY.includes(String(n));

const ITEM = `{ id: 'drive-video', kind: 'video', bucket: '', path: '', src: '${VIDEO}', sha256: 'drive-video', bytes: 1, mime: 'video/webm', length: '0:05', title: 'DRIVE VIDEO', credit: 'THE DRIVE', tags: [], source: 'upload', uploadedBy: null, uploadedByLabel: 'THE DRIVE', createdAt: new Date().toISOString() }`;
/** A mock sign-in as `id` (the mock keeps its people in this browser), and the catalogue's test video. */
const seed = (id, name) => `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: '${id}', email: 'drive-${id.slice(0, 8)}@debaser.site', displayName: '${name}', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
    const items = JSON.parse(localStorage.getItem('debaser.media.items.v1') ?? '[]');
    if (!items.some((item) => item.id === 'drive-video')) {
      items.push(${ITEM});
      localStorage.setItem('debaser.media.items.v1', JSON.stringify(items));
    }
  } catch {}
})()`;

async function dismissAsks(page) {
  for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]', '[ I NEVER HAD ONE ]', '[ SKIP ]']) {
    const key = page.getByText(text, { exact: false });
    if (await key.count()) await key.first().click({ timeout: 2000 }).catch(() => undefined);
  }
}

async function roomWithVideo(page) {
  await page.goto(`${BASE}/files?kind=video`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
  await dismissAsks(page);
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

/** The player bar's options (its cog, or `[ OPTIONS ]` on the docked bar), the keys-in-the-picture switch's state, then shut. */
async function optionsToggle(page, press) {
  const cog = page.locator('button[title="Player options"]:visible, button:has-text("[ OPTIONS ]"):visible').first();
  await cog.click({ timeout: 10000 });
  const toggle = page.locator('[data-keys-in-picture-toggle]');
  await toggle.waitFor({ timeout: 8000 }).catch(async (error) => {
    await page.screenshot({ path: join(SHOTS, 'options-not-open.png') });
    console.log('  --  options did not open; buttons:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button[title="Player options"], [data-stream-bar-options]')].map((b) => [b.textContent, b.getBoundingClientRect().y]))));
    throw error;
  });
  const before = await toggle.getAttribute('data-keys-in-picture-toggle');
  if (press) await toggle.click();
  const after = await toggle.getAttribute('data-keys-in-picture-toggle');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-keys-in-picture-toggle]', { state: 'detached', timeout: 5000 });
  return { before, after, text: await Promise.resolve(after) };
}

const barState = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const key = el.querySelector('button');
    return { awake: el.getAttribute('data-watch-bar-awake') ?? el.getAttribute('data-room-picture-keys'), opacity: style.opacity, position: style.position, bottom: Math.round(box.bottom), height: Math.round(box.height), keyPress: key === null ? null : getComputedStyle(key).pointerEvents };
  }, sel);

(async () => {
  const executablePath = findChrome();
  assert.ok(executablePath, 'no Chrome on this machine');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const live = [];
  const errors = [];
  const newPage = async (id, name) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(seed(id, name));
    await context.route(/supabase\.(co|in)|api\.debaser\.site/, (route) => {
      live.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (VERBOSE && message.type() === 'error') console.log(`  ..  console error: ${message.text().includes("404") ? "404" : message.text().slice(0, 4000)}`);
    });
    return page;
  };
  try {
    if (part(1) || part(3)) {
      const page = await newPage('drive-user', 'TEST DRIVE');
      await roomWithVideo(page);

      if (part(1)) {
        console.log('1. FULLSCREEN: THE BAR GOES WITH THE POINTER RESTING ON IT');
        // The room bar, or the music bar while it shows the stream: the FULL key either way.
        await page.locator('[data-room-full="enter"]').first().click();
        await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
        assert.equal((await barState(page, BAR)).awake, 'awake', 'fullscreen starts with the bar showing');
        // The pointer comes to rest on the bar (as after pressing FULL there), then stays still.
        const strip = await page.locator(BAR).boundingBox();
        await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
        await sleep(3600);
        let bar = await barState(page, BAR);
        assert.equal(bar.awake, 'asleep', 'the pointer resting on the bar no longer keeps it: gone after 3 s still');
        assert.equal(bar.opacity, '0');
        assert.equal(bar.keyPress, 'none', 'its keys take no press while gone');
        const cursor = await page.evaluate((s) => getComputedStyle(document.querySelector(s).parentElement).cursor, BAR);
        assert.equal(cursor, 'none', 'the pointer goes with it');
        await page.screenshot({ path: join(SHOTS, '1-fullscreen-asleep.png') });
        pass('after FULL, the pointer still on the bar for 3.6 s: the bar is gone, keys unpressable, pointer hidden');
        await page.keyboard.press('Shift');
        bar = await barState(page, BAR);
        assert.equal(bar.awake, 'awake', 'a key press brings it back');
        assert.equal(bar.opacity, '1');
        pass('a key press brings it back at once');
        await page.mouse.move(700, 400);
        await sleep(3600);
        assert.equal((await barState(page, BAR)).awake, 'asleep');
        await page.mouse.move(710, 410);
        assert.equal((await barState(page, BAR)).awake, 'awake');
        pass('still over the picture: gone after 3 s; a move: back at once');
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
        await sleep(300);
      }

      if (part(3)) {
        console.log('3. KEYS IN THE PICTURE');
        // The test video is five seconds long: after part 1 it has ended and the room shows nothing (no keys there), so on again.
        if (part(1)) await roomWithVideo(page);
        assert.equal(await page.locator(PICTURE_KEYS).count(), 0, 'off by default: no keys over the picture');
        pass('off by default: the picture carries no keys');
        const turned = await optionsToggle(page, true);
        assert.deepEqual([turned.before, turned.after], ['off', 'on'], 'the switch reads OFF, then ON');
        await page.waitForSelector(`${ROOM} [data-room-picture] ${PICTURE_KEYS}`, { timeout: 10000 }).catch(async (error) => {
          console.log('  --  not found:', JSON.stringify(await page.evaluate(() => ({ stored: localStorage.getItem('debaser.room.keys-in-picture.v1'), any: document.querySelectorAll('[data-room-picture-keys]').length, join: document.querySelector('[data-watch-join]') !== null, pictures: [...document.querySelectorAll('[data-room-picture]')].map((el) => el.getAttribute('data-room-picture')), corner: document.querySelector('[data-room-corner-keys]') !== null }))));
          throw error;
        });
        const picture = await page.locator(`${ROOM} [data-room-picture]`).boundingBox();
        await page.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 2);
        let keys = await barState(page, PICTURE_KEYS);
        assert.equal(keys.awake, 'awake');
        assert.equal(keys.position, 'absolute', 'over the picture');
        assert.ok(Math.abs(keys.bottom - Math.round(picture.y + picture.height)) <= 1, `along the picture's foot (${keys.bottom} vs ${Math.round(picture.y + picture.height)})`);
        const inside = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return { full: el.querySelector('[data-room-full]') !== null, pip: el.querySelector('[data-room-pip]') !== null, sound: el.querySelector('[aria-label*="ound" i], [aria-label*="ute" i], [aria-label*="olume" i]') !== null, clock: el.querySelector('[data-watch-clock]') !== null, quality: el.textContent.includes('QUALITY') || el.textContent.includes('SUBS') };
        }, PICTURE_KEYS);
        assert.ok(inside.full && inside.clock, `FULL and where it is are in the picture's keys ${JSON.stringify(inside)}`);
        assert.ok(inside.sound, 'the sound key is there');
        assert.ok(!inside.quality, 'QUALITY and SUBS stay on the bar');
        assert.ok((await page.locator(BAR).count()) > 0 || (await page.locator('[data-stream-bar]').count()) > 0, 'the player bar is still there as well');
        await page.screenshot({ path: join(SHOTS, '3-keys-in-picture.png') });
        pass(`on: the picture's foot carries the keys (FULL, PIP ${inside.pip ? 'yes' : 'not offered for this file'}, the sound, the clock), the bar stays`);
        await sleep(3600);
        keys = await barState(page, PICTURE_KEYS);
        assert.equal(keys.awake, 'asleep', 'gone after 3 s still');
        assert.equal(keys.opacity, '0');
        assert.equal(keys.keyPress, 'none');
        await page.mouse.move(picture.x + picture.width / 2 + 10, picture.y + picture.height / 2);
        assert.equal((await barState(page, PICTURE_KEYS)).awake, 'awake');
        pass('over the picture they go after 3 s still and come back on a move');
        await page.locator(`${PICTURE_KEYS} [data-room-full="enter"]`).click();
        await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 8000 });
        await sleep(300);
        assert.equal(await page.locator(PICTURE_KEYS).count(), 0, 'fullscreen: only the room bar lies over the picture');
        assert.equal((await barState(page, BAR)).position, 'absolute');
        pass("FULL in the picture's keys fullscreens the room, where only the room's own bar lies over the picture");
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 8000 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
        await sleep(2000);
        await dismissAsks(page);
        const again = await optionsToggle(page, false);
        assert.equal(again.after, 'on', 'the choice survives a reload');
        pass('the choice survives a reload');
      }
      await page.context().close();
    }

    if (part(2)) {
      console.log('2. MEDIA: THE PICTURE PLAYS');
      const page = await newPage('drive-user', 'TEST DRIVE');
      await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
      await dismissAsks(page);
      await page.waitForSelector('li [data-thumb-play]', { timeout: 120000 });
      await dismissAsks(page);
      // A card whose PLAY plays a player (not the music bar): its key's play half reads PLAY.
      const index = await page.evaluate(() => [...document.querySelectorAll('li:has([data-thumb-play])')].findIndex((li) => li.querySelector('[data-split-half="play"]')?.textContent.includes('PLAY')));
      assert.ok(index >= 0, 'a card with a picture and a PLAY key');
      const card = page.locator('li:has([data-thumb-play])').nth(index);
      const title = await card.locator('p[id]').first().textContent();
      await card.locator('[data-thumb-info]').click();
      await page.waitForSelector('[role="dialog"]:not([data-nextjs-dialog])', { timeout: 5000 });
      assert.match(await card.locator('[data-split-half="play"]').textContent(), /PLAY/, 'the `i` played nothing');
      pass(`the picture's i opens DETAILS and plays nothing ("${title.trim().slice(0, 40)}")`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role="dialog"]:not([data-nextjs-dialog])', { state: 'detached', timeout: 5000 });
      const thumb = await card.locator('[data-thumb-play]').boundingBox();
      // PLAY on a video MEDIA can put in a room puts it on in your own room (SPEC-rooms-perpetual.md): the room opens with it on.
      const start = title.trim().slice(0, 18);
      await page.mouse.click(thumb.x + 8, thumb.y + thumb.height - 8);
      await page.waitForFunction((words) => [...document.querySelectorAll('[data-stream-bar-screen], [data-dock-window="stream"]')].some((el) => el.textContent.includes(words)), start, { timeout: 20000 });
      assert.ok((await page.locator('[data-dock-window="stream"] [data-room-picture]').count()) > 0, 'the room is open with its picture');
      await page.screenshot({ path: join(SHOTS, '2-media-thumb-played.png') });
      pass(`a press on the picture puts it on in your room, as PLAY does ("${start}" on the room's bar)`);
      await page.context().close();

      // The same card's PLAY key, in a fresh browser, for the comparison: the same room, the same video on.
      const page2 = await newPage('drive-user', 'TEST DRIVE');
      await page2.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
      await page2.waitForSelector('li [data-thumb-play]', { timeout: 120000 });
      await sleep(1500);
      await dismissAsks(page2);
      const card2 = page2.locator('li:has([data-thumb-play])').filter({ hasText: start }).first();
      await card2.locator('[data-split-half="play"]').click();
      await page2.waitForFunction((words) => [...document.querySelectorAll('[data-stream-bar-screen], [data-dock-window="stream"]')].some((el) => el.textContent.includes(words)), start, { timeout: 20000 });
      pass('its PLAY key does the same: the room opens with it on');
      await page2.context().close();
    }

    if (part(4)) {
      console.log("4. MOLDAVIUS FIGTREE'S DEFAULT");
      const page = await newPage(FIGTREE, 'MOLDAVIUS FIGTREE');
      await roomWithVideo(page);
      await page.waitForSelector(`${ROOM} ${PICTURE_KEYS}`, { timeout: 10000 });
      assert.equal(await page.evaluate(() => localStorage.getItem('debaser.room.keys-in-picture.v1')), null, 'nothing was stored: it is the code default');
      pass('her account, nothing chosen: the keys are in the picture');
      const turned = await optionsToggle(page, true);
      assert.deepEqual([turned.before, turned.after], ['on', 'off']);
      assert.equal(await page.locator(PICTURE_KEYS).count(), 0, 'her OFF wins');
      await sleep(1600);
      const row = await page.evaluate((id) => JSON.parse(localStorage.getItem('debaser.user-settings.mock.v1') ?? '{}')[id]?.settings?.keys?.keysInPicture ?? null, FIGTREE);
      assert.equal(row, '0', 'her choice is saved to her (mock) settings row');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-bar-queue], [data-stream-bar]', { timeout: 120000 });
      await sleep(2000);
      await dismissAsks(page);
      assert.equal((await optionsToggle(page, false)).after, 'off', 'still off after a reload');
      pass('her OFF wins, is saved to her settings row, and survives a reload');
      await page.context().close();
    }

    assert.deepEqual(live, [], 'nothing reached a live database');
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`roombars drive passed (${passed} steps); captures in ${SHOTS}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
