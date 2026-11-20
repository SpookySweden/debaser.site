/*
 * Room chat on the DISCUSS page (SPEC-room-chat-discuss.md, Luke 2026-11-16) in a real browser, against a LOCAL dev server on
 * mock accounts and mock data. It never touches the live site (the Supabase host is blocked, and the run fails if anything
 * tried it) and leaves nothing: the rooms it needs are written into the test browser's own storage.
 *
 *   start the server with every switch on mock and the Supabase address and key empty (from a node launcher, see core.md), then
 *   node scripts/drive-room-chat-discuss.cjs --base http://localhost:3355 [--headed]
 *
 *   1. a MEDIA result's DISCUSS shows the line said over it in a private, ended room, with its name and IN ROOM · 02:14;
 *      a line said while nothing played, and one from a room whose host switched CHAT ON DISCUSSION off, are not there;
 *   2. MY ROOM CHAT ON DISCUSSION PAGES switched off in the PRIVACY switches takes the line away.
 *   (between them, ROOMCHAT 2026-11-17) another person's line said in a private room shows to this reader, who was not in
 *      it, as ANON-<n> with PRIVATE ROOM and no name; once this reader is a member it shows the name; a line said in an open
 *      room shows the name to anyone.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = (args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3355').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.log('This drive is for a local dev server on mock data only (core.md: test locally, not on the live site).');
  process.exit(2);
}
const ok = (what) => console.log(`  ok  ${what}`);
const PERSON = 'mock-test-account';

function seed() {
  (window.localStorage.setItem('debaser.lost-account.never.v1', '1'), window.localStorage.setItem('debaser.tour.v1', 'skipped'));
  if (window.localStorage.getItem('debaser.auth.mock.v1') === null) {
    window.localStorage.setItem(
      'debaser.auth.mock.v1',
      JSON.stringify({ users: [{ id: 'mock-test-account', email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }], sessionUserId: 'mock-test-account', bannedIds: [] }),
    );
  }
}

/** Two ended rooms in this browser's mock store: one private with its switch on, one with it off, each with chat over `ref`. */
function rooms(ref) {
  const at = (minutes) => new Date(Date.UTC(2026, 10, 16, 1, minutes)).toISOString();
  const room = (id, chatOnDiscuss) => ({
    id, originalHostId: 'mock-test-account', originalHostLabel: 'TEST ACCOUNT (MOCK)', hostId: 'mock-test-account', forumThreadId: null,
    currentEntryId: null, positionSeconds: 0, isPlaying: false, startedAt: at(0), updatedAt: at(30), endedAt: at(30), origin: 'stream',
    isPublic: true, privacy: 'private', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true, chatOnDiscuss,
  });
  const entry = (id, roomId) => ({ id, roomId, position: 0, inQueue: true, mediaItemId: null, link: { url: 'https://example.invalid/v', kind: 'embed', title: 'A THING' }, series: null, webRef: ref, addedBy: 'mock-test-account', addedAt: at(1), playedAt: at(1), playIndex: 0 });
  const line = (id, roomId, queueEntryId, body, minutes, seconds) => ({ id, roomId, queueEntryId, mediaItemId: null, authorId: 'mock-test-account', authorLabel: 'TEST ACCOUNT (MOCK)', body, mediaSeconds: seconds, createdAt: at(minutes) });
  return {
    rooms: [room('drive-room-on', true), room('drive-room-off', false)],
    queue: [entry('drive-entry-on', 'drive-room-on'), entry('drive-entry-off', 'drive-room-off')],
    messages: [
      line('drive-line-shown', 'drive-room-on', 'drive-entry-on', 'SAID OVER THE THING', 5, 134),
      line('drive-line-nothing-on', 'drive-room-on', null, 'SAID WITH NOTHING ON', 6, 0),
      line('drive-line-switched-off', 'drive-room-off', 'drive-entry-off', 'SAID IN A ROOM WITH THE SWITCH OFF', 7, 10),
    ],
    crowns: [], members: [], passwords: {}, attempts: [], privateRows: [],
  };
}

/**
 * ROOMCHAT (Luke 2026-11-17): another person's rooms over `ref`, one private (its line stamped private) and one open. `member`
 * puts this reader in the private one.
 */
function othersRooms(ref, member) {
  const at = (minutes) => new Date(Date.UTC(2026, 10, 16, 2, minutes)).toISOString();
  const room = (id, privacy) => ({
    id, originalHostId: 'drive-other', originalHostLabel: 'SOMEONE ELSE', hostId: 'drive-other', forumThreadId: null,
    currentEntryId: null, positionSeconds: 0, isPlaying: false, startedAt: at(0), updatedAt: at(30), endedAt: at(30), origin: 'stream',
    isPublic: true, privacy, clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true, chatOnDiscuss: true,
  });
  const entry = (id, roomId) => ({ id, roomId, position: 0, inQueue: true, mediaItemId: null, link: { url: 'https://example.invalid/v', kind: 'embed', title: 'A THING' }, series: null, webRef: ref, addedBy: 'drive-other', addedAt: at(1), playedAt: at(1), playIndex: 0 });
  const line = (id, roomId, queueEntryId, body, minutes, seconds) => ({ id, roomId, queueEntryId, mediaItemId: null, authorId: 'drive-other', authorLabel: 'SOMEONE ELSE', body, mediaSeconds: seconds, createdAt: at(minutes) });
  return {
    rooms: [room('drive-room-private', 'private'), room('drive-room-open', 'open')],
    queue: [entry('drive-entry-private', 'drive-room-private'), entry('drive-entry-open', 'drive-room-open')],
    messages: [
      line('drive-line-private', 'drive-room-private', 'drive-entry-private', 'SAID IN A PRIVATE ROOM', 5, 61),
      line('drive-line-open', 'drive-room-open', 'drive-entry-open', 'SAID IN AN OPEN ROOM', 6, 75),
    ],
    crowns: [],
    members: [
      { roomId: 'drive-room-private', userId: 'drive-other', label: 'SOMEONE ELSE', removedAt: null },
      ...(member ? [{ roomId: 'drive-room-private', userId: PERSON, label: 'TEST ACCOUNT (MOCK)', removedAt: null }] : []),
    ],
    passwords: {}, attempts: [], privateRows: ['drive-entry-private', 'drive-line-private'],
  };
}

/** The feed's order changes between loads, so the rooms are written for whichever result is first, before its pen opens. */
async function discussLines(page, member) {
  const { pen, ref } = await openDiscuss(page);
  await page.evaluate((stored) => window.localStorage.setItem('debaser.watch.v1', JSON.stringify(stored)), othersRooms(ref, member));
  await pen.click();
  const lines = page.locator('[data-room-chat-line]');
  await lines.first().waitFor({ timeout: 15_000 }).catch(async (failure) => {
    await page.screenshot({ path: 'Temp/browse/roomchat-drive-fail.png' });
    throw failure;
  });
  await page.waitForTimeout(500);
  return Promise.all((await lines.all()).map(async (one) => ({ text: (await one.innerText()).replace(/\s+/g, ' '), anonymous: (await one.getAttribute('data-room-chat-anonymous')) !== null })));
}

async function openDiscuss(page) {
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForSelector('[data-row-keys]', { timeout: 120_000 });
  const keep = page.getByText('[ KEEP THESE SETTINGS ]');
  await keep.waitFor({ timeout: 8_000 }).then(() => keep.click(), () => undefined);
  // The whole result: since MEDIACARD (2026-11-17) the arrow opens an area of its own under the keys, where the pen is.
  const row = page.locator('li[data-view]').filter({ has: page.locator('[data-more-keys]') }).first();
  await row.locator('[data-more-keys]').click();
  const pen = row.locator('[data-discuss-key]');
  await pen.waitFor();
  const ref = await pen.getAttribute('data-discuss-ref');
  return { row, pen, ref };
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed') });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\//, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 300)}`));
  await page.mouse.move(700, 200);

  // The feed's order changes between loads (ROOMCHAT 2026-11-17): each step writes its rooms for the result on screen, before its pen opens.
  let { pen, ref } = await openDiscuss(page);
  assert.ok(ref, 'the pen says which result it is');
  await page.evaluate(({ tables }) => window.localStorage.setItem('debaser.watch.v1', JSON.stringify(tables)), { tables: rooms(ref) });
  await pen.click();
  const lines = page.locator('[data-room-chat-line]');
  await lines.first().waitFor({ timeout: 15_000 });
  const words = (await lines.allInnerTexts()).map((text) => text.replace(/\s+/g, ' '));
  assert.equal(words.length, 1, `one line: ${JSON.stringify(words)}`);
  assert.ok(words[0].includes('SAID OVER THE THING') && words[0].includes('IN ROOM · 02:14') && words[0].includes('TEST ACCOUNT (MOCK)'), words[0]);
  ok(`DISCUSS on ${ref}: ${words[0]}`);
  ok('a line said with nothing on, and one from a room with CHAT ON DISCUSSION off, are not there');

  // ROOMCHAT: a private room's line, to a reader who was not in it, then to one who was; an open room's line to anyone.
  const outside = await discussLines(page, false);
  assert.equal(outside.length, 2, JSON.stringify(outside));
  const [privateLine, openLine] = outside;
  assert.ok(privateLine.anonymous && /^ANON-\d+ PRIVATE ROOM /.test(privateLine.text) && privateLine.text.includes('SAID IN A PRIVATE ROOM') && privateLine.text.includes('IN ROOM · 01:01'), privateLine.text);
  assert.ok(!privateLine.text.includes('SOMEONE ELSE'), `no name to an outsider: ${privateLine.text}`);
  assert.ok(!openLine.anonymous && openLine.text.startsWith('SOMEONE ELSE ') && !openLine.text.includes('PRIVATE ROOM') && openLine.text.includes('IN ROOM · 01:15'), openLine.text);
  await page.locator('[data-room-chat-anonymous]').first().screenshot({ path: 'Temp/browse/roomchat-outsider-line.png' }).catch(() => undefined);
  ok(`not in the private room: ${privateLine.text}`);
  ok(`an open room's line, named: ${openLine.text}`);
  const inside = await discussLines(page, true);
  assert.equal(inside.length, 2, JSON.stringify(inside));
  assert.ok(!inside[0].anonymous && inside[0].text.startsWith('SOMEONE ELSE PRIVATE ROOM · NAME SHOWN TO ITS MEMBERS'), inside[0].text);
  ok(`a member of the private room: ${inside[0].text}`);

  // MY ROOM CHAT ON DISCUSSION PAGES, off.
  await page.goto(`${BASE}/account?tab=privacy`, { waitUntil: 'domcontentloaded' });
  const mine = page.getByRole('button', { name: /^MY ROOM CHAT ON DISCUSSION PAGES: ON/ }).first();
  await mine.waitFor({ timeout: 60_000 });
  await mine.click();
  await page.getByRole('button', { name: /^MY ROOM CHAT ON DISCUSSION PAGES: OFF/ }).first().waitFor();
  ok('MY ROOM CHAT ON DISCUSSION PAGES switched off');
  ({ pen, ref } = await openDiscuss(page));
  await page.evaluate(({ tables }) => window.localStorage.setItem('debaser.watch.v1', JSON.stringify(tables)), { tables: rooms(ref) });
  await pen.click();
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('[data-room-chat-line]').count(), 0, 'their line is gone');
  ok('and their line is gone from DISCUSS');

  assert.equal(live, 0, 'nothing reached the live site');
  ok('nothing reached the live site');
  await browser.close();
  console.log(`\nroom chat on DISCUSS: OK (as ${PERSON}, on ${BASE})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
