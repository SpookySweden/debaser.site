/*
 * The room model (SPEC-rooms-perpetual.md) where only two real accounts in real time can show it, on the LIVE site, short:
 *
 *   1. JOINING BY LINK, CHAT BEFORE LIVE: A's own room is made (the bar's GO LIVE, then CANCEL: still private), A copies its
 *      link from the cog, B opens it and is in A's room; B says a line in its chat and A sees it arrive.
 *   2. THE 45-SECOND TAKE-OVER: A goes live (WHO CAN JOIN: PRIVATE, so only the link lets anybody in), then A's tab closes.
 *      B, still in, is handed the room by the database only after 45 quiet seconds (a reload never loses you your room),
 *      and the room becomes B's stream room: nobody's main room.
 *   3. HANDED ON WHEN THE HOST LEAVES: A comes back into the room; B leaves it (the window's X, then LEAVE); A hosts.
 *   Then A ends it (END STREAM), so nothing is left live.
 *
 *   node "<notes>/heavy-step.cjs" ROOMS --live -- node scripts/drive-rooms-live.cjs
 *
 * In the steps "A" hosts and "B" joins; by default TEST ACCOUNT B hosts and A joins (`--host`, `--guest`). Kept test accounts A and B only (scripts/browser.cjs, password from the gitignored .env.test). It writes: A's room and
 * its link, B's member row, one chat line, one board record (GO LIVE files one, for a room's first time live). It deletes
 * nothing: the ids are printed for the check-in file. Database reads are the accounts' own (read-only selects).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount, testAccountClient } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app');
const HOST = opt('--host', 'B');
const GUEST = opt('--guest', 'A');
const SHOTS = join('Temp', 'browse', 'rooms-live');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const left = [];

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bar-queue]', { timeout: 90000 });
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(1000);
}

(async () => {
  // "A" in the steps is the host, "B" the one who joins: TEST ACCOUNT B hosts and A joins, because B is a removed member of
  // A's own room (kept so on purpose since 2026-11-15, HANDOFF.md) and can never come back into it by its link.
  const a = await signInTestAccount(HOST);
  const b = await signInTestAccount(GUEST);
  if (a.error || b.error) throw new Error(`sign-in: ${a.error ?? b.error}`);
  const db = await testAccountClient(HOST);
  /** A room as the database holds it (A's own read: A hosts it or is in it). */
  const roomRow = async (id) => (await db.client.from('watch_rooms').select('id, host_id, original_host_id, origin, is_public, privacy, ended_at, forum_thread_id').eq('id', id).single()).data;

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-audio-output'] });
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await contextA.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await installSession(pageA, a);
  await installSession(pageB, b);
  const errors = [];
  for (const page of [pageA, pageB]) page.on('pageerror', (error) => errors.push(error.message));
  let roomId = null;

  try {
    console.log('1. JOINING BY LINK, CHAT BEFORE LIVE');
    await open(pageA, '/forum');
    await pageA.locator('[data-go-live-key]').first().click();
    await pageA.waitForSelector('[data-main-room-who]', { timeout: 30000 });
    await pageA.locator('[data-main-room-who] button', { hasText: 'CANCEL' }).click();
    await pageA.locator('[data-dock-window="stream"] [data-room-settings-key]').click();
    await pageA.waitForSelector('[data-room-copy-link]', { timeout: 15000 });
    await pageA.locator('[data-room-copy-link]').click();
    await pageA.waitForFunction(() => /COPIED/.test(document.querySelector('[data-room-copy-link]')?.textContent ?? ''), null, { timeout: 15000 });
    const link = await pageA.evaluate(() => navigator.clipboard.readText());
    const secret = new URL(link).searchParams.get('join');
    assert.ok(secret !== null && secret.length >= 32, 'COPY LINK gave a link with its secret');
    await pageA.keyboard.press('Escape');
    const mine = (await db.client.from('watch_rooms').select('id').eq('original_host_id', db.id).eq('origin', 'music').is('ended_at', null).single()).data;
    roomId = mine.id;
    left.push(`watch_rooms ${roomId} (the host's main room, then handed on)`);
    assert.equal((await roomRow(roomId)).is_public, false, 'private');

    await open(pageB, `/forum?join=${secret}`);
    await pageB.waitForSelector('[data-dock-window="stream"] #watch-chat', { timeout: 30000 });
    const said = `ROOMS LIVE DRIVE ${new Date().toISOString().slice(11, 19)}`;
    await pageB.fill('#watch-chat', said);
    await pageB.keyboard.press('Enter');
    await pageA.waitForFunction((words) => [...document.querySelectorAll('[data-watch-message]')].some((line) => line.textContent.includes(words)), said, { timeout: 30000 });
    left.push(`watch_messages: one line by the guest in ${roomId} ("${said}")`);
    left.push(`watch_room_members: the guest in ${roomId}`);
    left.push(`watch_room_links: A's link for ${roomId}`);
    await pageA.screenshot({ path: join(SHOTS, '1-chat-by-link.png') });
    pass('B joined A\'s private room by its link and said a line in its chat; A saw it arrive');

    console.log('2. THE 45-SECOND TAKE-OVER');
    await pageA.locator('[data-main-room-live="private"]').first().click();
    await pageA.waitForSelector('[data-main-room-who]', { timeout: 15000 });
    await pageA.locator('[data-main-room-start]').click();
    await pageA.waitForSelector('[data-main-room-live="live"]', { timeout: 30000 });
    await sleep(4000);
    const live = await roomRow(roomId);
    assert.equal(live.is_public, true, 'live');
    assert.equal(live.privacy, 'private', 'PRIVATE: only the link lets anybody in');
    if (live.forum_thread_id) left.push(`forum thread ${live.forum_thread_id} (the room's board record, filed at GO LIVE)`);
    // A's tab dies: no LEAVE, no goodbye. B's tab asks to take over every two seconds; the database says no until 45 quiet seconds.
    const closedAt = Date.now();
    await pageA.close({ runBeforeUnload: false });
    await sleep(30000);
    const at30 = await roomRow(roomId);
    assert.equal(at30.host_id, a.userId, '30 seconds after A\'s tab closed, the room is still A\'s');
    await pageB.waitForFunction(() => /IS HOSTING NOW/.test(document.querySelector('[data-dock-window="stream"]')?.textContent ?? ''), null, { timeout: 45000 });
    const tookAfter = (Date.now() - closedAt) / 1000;
    const taken = await roomRow(roomId);
    assert.equal(taken.host_id, b.userId, 'B hosts it now');
    assert.equal(taken.origin, 'stream', 'and it is a stream room now: nobody\'s main room');
    // The database counts 45 quiet seconds from the host's last beat, which is every 3 seconds: up to 3 before the tab closed.
    assert.ok(tookAfter >= 42 && tookAfter < 75, `about 45 seconds after the host's last beat (${tookAfter.toFixed(0)}s after the tab closed)`);
    await pageB.screenshot({ path: join(SHOTS, '2-taken-over.png') });
    pass(`A's tab closed with the room live: it was still A's at 30 seconds, and B took it over at ${tookAfter.toFixed(0)}s; it is B's stream room now`);

    console.log('3. HANDED ON WHEN THE HOST LEAVES');
    pageA = await contextA.newPage();
    pageA.on('pageerror', (error) => errors.push(error.message));
    await open(pageA, `/forum?watch=${roomId}`);
    await pageA.waitForSelector('[data-dock-window="stream"] #watch-chat', { timeout: 30000 });
    await sleep(5000);
    await pageB.locator('[data-dock-window="stream"] button[aria-label^="Close"]').first().click();
    // A host closing a live room with somebody in it is asked: LEAVE (they host), END STREAM, or STAY.
    const handKey = pageB.locator('[role="alertdialog"][aria-label="Leave the stream"] button', { hasText: '[ LEAVE ]' }).first();
    await handKey.waitFor({ timeout: 15000 });
    assert.match(await pageB.locator('[role="alertdialog"][aria-label="Leave the stream"]').innerText(), new RegExp(`TEST ACCOUNT ${HOST} WILL HOST`), 'it names who will host');
    await handKey.click();
    await pageA.waitForFunction(() => /IS HOSTING NOW/.test(document.querySelector('[data-dock-window="stream"]')?.textContent ?? ''), null, { timeout: 30000 });
    assert.equal((await roomRow(roomId)).host_id, a.userId, 'A hosts it again');
    pass('B left the live room with A still in it: it passed to A at once');

    await pageA.getByText('[ END STREAM ]', { exact: false }).first().click();
    await pageA.getByText('[ END FOR EVERYBODY ]', { exact: false }).first().click();
    await sleep(3000);
    assert.notEqual((await roomRow(roomId)).ended_at, null, 'ended');
    pass('A ended it: nothing is left live');

    const real = errors.filter((message) => !/ResizeObserver|hydrat/i.test(message));
    assert.deepEqual(real, [], 'no page errors');
    console.log(`drive-rooms-live: ${passed} passed`);
  } catch (failure) {
    for (const [name, page] of [['A', pageA], ['B', pageB]]) await page.screenshot({ path: join(SHOTS, `failed-${name}.png`) }).catch(() => undefined);
    console.error(failure);
    if (errors.length > 0) console.error('page errors:', errors.slice(0, 5));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await db.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    console.log('LEFT BEHIND (not deleted):');
    for (const row of left) console.log(`  - ${row}`);
  }
})();
