/*
 * Drives `[ WATCH IN ROOM ]` and `[ ADD TO ROOM ]` in a real browser (SPEC-floating-player.md, part 3). Not in `npm run checks`.
 *
 *   node scripts/drive-watch-in-room.cjs --base http://localhost:3001 --mock
 *   node scripts/drive-watch-in-room.cjs --base https://debaser-site.vercel.app --env-test <path to .env.test>
 *
 * Live it signs in as kept test accounts A and B, starts two rooms as A, ends them, and prints their ids: each leaves its ended
 * record and its board thread, so list those for Luke to delete. On the mock site there is one browser and one person, so the
 * second person's part is skipped.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, loadEnv, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3001');
const MOCK = flag('--mock');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const rooms = [];

const hasVideoRow = () => [...document.querySelectorAll('li')].some((row) => /YOUTUBE/.test(row.innerText) && /\[ ▶ PLAY \]/.test(row.innerText) && /VIDEO/.test(row.innerText));
const videoRow = (page, nth = 0) => page.locator('li').filter({ has: page.getByText('YOUTUBE', { exact: true }) }).filter({ hasText: '[ ▶ PLAY ]' }).filter({ hasText: 'VIDEO' }).nth(nth);
const clock = (page) => page.evaluate(() => Number(document.querySelector('[data-watch-clock]')?.getAttribute('data-watch-clock') ?? 'NaN'));

async function person(browser, letter) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error (${letter}): ${String(error).slice(0, 200)}`));
  if (MOCK) {
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: user.id, bannedIds: [] }));
    });
  } else {
    const account = await signInTestAccount(letter);
    if (account.error) throw new Error(`sign-in ${letter}: ${account.error}`);
    await installSession(page, account);
  }
  return page;
}

/** Past the one-time PRIVACY window a new browser is shown, if it comes. */
async function clearPrivacyWindow(page) {
  const close = page.getByRole('dialog', { name: 'PRIVACY' }).getByRole('button', { name: 'Close window' });
  if ((await close.count()) > 0) await close.click();
}

async function openMedia(page) {
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(hasVideoRow, null, { timeout: 45000 });
  await sleep(1500);
  await clearPrivacyWindow(page);
}

/** `viaFloat`: the key on the float, on another page, rather than the row's. */
async function startFromRow(page, { privacy, viaFloat = false }) {
  // The video plays first, so there is a place to carry on from.
  const row = videoRow(page);
  const title = await row.locator('p').first().innerText();
  await row.locator('button[aria-label^="Play"]').first().click();
  await page.waitForSelector('[data-floating-player] iframe');
  const frame = await page.evaluate(() => document.querySelector('[data-floating-player] iframe').getAttribute('src'));
  assert.match(frame, /enablejsapi=1/);
  await sleep(9000);

  if (viaFloat) {
    await page.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'FORUM' }).click();
    await page.waitForURL(/\/forum/);
    await page.waitForSelector('[data-floating-player="floating"]');
    await sleep(800);
    await page.screenshot({ path: join(SHOTS, 'watch-in-room-float.png') });
  }
  const key = viaFloat ? page.locator('[data-floating-player] [data-watch-in-room="start"]') : page.locator('li').filter({ hasText: title }).first().locator('[data-watch-in-room="start"]');
  assert.equal((await key.innerText()).trim(), '[ WATCH IN ROOM ]');
  if (!viaFloat) assert.equal(await page.locator('li').filter({ hasText: title }).first().locator('[data-watch-in-room="add"]').count(), 0, 'one key, never both');
  if (viaFloat) pass('the float has the key, on another page');
  await key.click();
  const dialog = page.getByRole('dialog', { name: 'WATCH IN ROOM' });
  await dialog.waitFor();
  assert.equal(await page.locator('[data-watch-clock]').count(), 0, 'a press only opens the menu: no room yet');
  assert.equal(await dialog.locator('[data-room-privacy="private"]').getAttribute('aria-checked'), 'true', 'PRIVATE is already picked');
  pass('one press opens the menu, with PRIVATE picked, and starts nothing');
  await page.screenshot({ path: join(SHOTS, `watch-in-room-menu-${privacy}.png`) });
  const stillSame = await page.evaluate(() => document.querySelector('[data-floating-player] iframe') !== null);
  assert.equal(stillSame, true, 'the video plays on behind the menu');
  pass('the video plays on behind the menu');
  await dialog.locator('[data-go-live-name]').fill(`DRIVE ${privacy.toUpperCase()}`);
  await dialog.locator('[data-go-live-topic]').fill('A test room, to be deleted');
  await dialog.locator(`[data-room-privacy="${privacy}"]`).click();
  await dialog.locator('[data-go-live-start]').click();
  await page.waitForSelector('[data-room-picture] iframe', { timeout: 30000 });
  assert.equal(await page.locator('[data-floating-player]').count(), 0, 'the old player has stopped: one video at a time');
  pass('the second press starts the room, and the old player stops');
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    await sleep(500);
    samples.push((await clock(page)).toFixed(1));
  }
  console.log(`      the room's clock: ${samples.join(' ')}`);
  await page.screenshot({ path: join(SHOTS, `watch-in-room-started-${privacy}.png`) });
  const t = await clock(page);
  assert.ok(t >= 6, `the room carries on from where it had got to, not the top: ${t}s`);
  pass(`the room starts the video from where the viewer had got to (${t.toFixed(1)}s in, after 9s of watching)`);
  await page.screenshot({ path: join(SHOTS, `watch-in-room-started-${privacy}.png`) });
  return title;
}

async function foldRoom(page) {
  await page.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / }).click();
  await sleep(400);
}

async function endRoom(page) {
  const end = page.getByRole('button', { name: '[ END STREAM ]' }).last();
  await end.click();
  await page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click();
  await sleep(1500);
}

(async () => {
  if (!MOCK) {
    loadEnv();
    process.loadEnvFile('.env.production');
    process.loadEnvFile(opt('--env-test', '.env.test'));
  }
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'] });
  const seenAdds = [];
  let a = null;
  let finished = false;
  try {
    a = await person(browser, 'A');
    a.on('request', (request) => {
      const url = request.url();
      if (request.method() === 'POST' && /\/rest\/v1\/watch_rooms\b/.test(url)) {
        try {
          const body = JSON.parse(request.postData() ?? '{}');
          if (typeof body.id === 'string') rooms.push(body.id);
        } catch {
          // Not the row.
        }
      }
      if (request.method() === 'POST' && /\/rest\/v1\/watch_queue\b/.test(url)) seenAdds.push(request.postData() ?? '');
    });

    console.log('Not in a room, a PRIVATE room');
    await openMedia(a);
    await startFromRow(a, { privacy: 'private' });
    if (!MOCK) {
      const privateId = rooms.at(-1);
      assert.ok(privateId, 'the room was written');
      console.log(`  room: ${privateId}`);
      const privacy = await a.evaluate(() => document.querySelector('[data-dock-window="stream"]')?.innerText ?? '');
      assert.match(privacy, /DRIVE PRIVATE/i, 'the room took its name');
      pass('the room took the name from the menu');

      // Somebody else, with the room's link: the door, not the room.
      const b = await person(browser, 'B');
      await b.goto(`${BASE}/forum?watch=${privateId}`, { waitUntil: 'domcontentloaded' });
      await sleep(4000);
      assert.equal(await b.locator('[data-room-picture]').count(), 0, 'somebody else does not get the room without joining');
      await b.screenshot({ path: join(SHOTS, 'watch-in-room-door.png') });
      pass('it is private: somebody else with no way in sees no picture');
      await b.context().close();
    }

    console.log('Hosting: the key reads ADD TO ROOM, and goes to the back');
    await foldRoom(a);
    const queueBefore = seenAdds.length;
    const rowsAdd = a.locator('button[data-watch-in-room="add"]');
    await rowsAdd.first().waitFor({ timeout: 20000 });
    assert.equal(await a.locator('button[data-watch-in-room="start"]').count(), 0, 'one key: no WATCH IN ROOM while you can add');
    assert.equal((await rowsAdd.first().innerText()).trim(), '[ ADD TO ROOM ]');
    await rowsAdd.first().click();
    await a.waitForSelector('button[data-watch-in-room="queued"]', { timeout: 15000 });
    pass('hosting: one press on [ ADD TO ROOM ] puts it in the queue');
    if (!MOCK) {
      await sleep(500);
      assert.ok(seenAdds.length > queueBefore, 'a queue row was written');
      const row = JSON.parse(seenAdds.at(-1));
      const firstRow = JSON.parse(seenAdds[0]);
      assert.ok(row.position > firstRow.position, `at the back of the queue: ${firstRow.position} then ${row.position}`);
      assert.equal(row.in_queue, true, 'in the queue, not on a list');
      pass(`it goes to the back of the queue (place ${row.position}, after place ${firstRow.position})`);
    }
    await a.locator('[data-watch-tv-box] button').click();
    await sleep(800);
    await endRoom(a);
    pass('the room ended');

    if (!MOCK) {
      console.log('Somebody else\'s room, no crown: on your own list');
      await openMedia(a);
      await startFromRow(a, { privacy: 'open', viaFloat: true });
      const openId = rooms.at(-1);
      console.log(`  room: ${openId}`);
      const b = await person(browser, 'B');
      await b.goto(`${BASE}/forum?watch=${openId}`, { waitUntil: 'domcontentloaded' });
      await b.waitForSelector('[data-room-picture]', { timeout: 30000 });
      await sleep(3000);
      await clearPrivacyWindow(b);
      await b.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / }).click();
      await sleep(500);
      await b.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'MEDIA' }).click();
      await b.waitForURL(/\/media/);
      await b.waitForFunction(() => document.querySelector('button[data-watch-in-room="add"]') !== null, null, { timeout: 45000 });
      assert.equal((await b.locator('button[data-watch-in-room="add"]').first().innerText()).trim(), '[ ADD TO ROOM ]');
      const posted = [];
      b.on('request', (request) => {
        if (request.method() === 'POST' && /\/rest\/v1\/watch_queue\b/.test(request.url())) posted.push(request.postData() ?? '');
      });
      await b.locator('button[data-watch-in-room="add"]').first().click();
      await b.waitForSelector('button[data-watch-in-room="listed"]', { timeout: 15000 });
      assert.equal((await b.locator('button[data-watch-in-room="listed"]').first().innerText()).trim(), '[ ON YOUR LIST ]');
      assert.equal(JSON.parse(posted.at(-1)).in_queue, false, 'on the list, not in the queue');
      await b.screenshot({ path: join(SHOTS, 'watch-in-room-listed.png') });
      pass('no crown in somebody else\'s room: it goes on your own list');
      await b.context().close();
      await endRoom(a);
      pass('the room ended');
    }
    finished = true;
    await a.context().close();
    console.log(`\n${passed} proved.${rooms.length > 0 ? ` Rooms left to list for deletion: ${rooms.join(' ')}` : ''}`);
  } finally {
    // A run that stopped part way ends its room rather than leaving it on the air.
    if (!finished && a !== null) await endRoom(a).catch(() => undefined);
    await browser.close();
  }
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  if (rooms.length > 0) console.error(`Rooms left to list for deletion: ${rooms.join(' ')}`);
  process.exit(1);
});
