/*
 * SPEC-forum-v3.md part 1 (Luke, 2026-11-17: "Yes, build part 1"): YOUR DESK and the one SEARCH box, driven on a LOCAL
 * mock dev server only (Temp/browse/dev-mock-forumux.cjs: every switch on mock, sign-in mock, Supabase address empty).
 * Live hosts are blocked and counted. The outside platforms' search is the dev server's own route (it may answer or say
 * it did not); both are fine here, only that the OUTSIDE group says one or the other.
 *
 *   node scripts/drive-desk-search.cjs --base http://localhost:<port> [--out Temp/browse/desk-search]
 */
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'desk-search'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
const check = (ok, what, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` :: ${detail}` : ''}`);
};

const ME = { id: 'desk-me', name: 'DESKREADER' };
const OTHER = { id: 'desk-other', name: 'ZEPHYRFRIEND' };

function seed({ me, other, signedIn, accountDeskOff = false }) {
  if (window.localStorage.getItem('ds-seeded') !== null) return;
  window.localStorage.setItem('ds-seeded', '1');
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  (window.localStorage.setItem('debaser.lost-account.never.v1', '1'), window.localStorage.setItem('debaser.tour.v2', 'skipped'));
  if (signedIn) {
    const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true });
    window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(me), user(other)], sessionUserId: me.id, bannedIds: [] }));
    // The account's settings row (forum v3 part 2) with AUTO POP-UP off, as another computer would have saved it.
    if (accountDeskOff) window.localStorage.setItem('debaser.user-settings.mock.v1', JSON.stringify({ [me.id]: { settings: { keys: { deskAuto: '0' } } } }));
    const profile = (person) => ({ userId: person.id, displayName: person.name, bio: '', tags: [], comments: [], updatedAt: at(1), privacySeen: true });
    window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile(me), [other.id]: profile(other) } }));
    window.localStorage.setItem('debaser.notifications.mock.v1', JSON.stringify({ version: 1, items: [
      { id: 'n1', userId: me.id, kind: 'reply', actorId: other.id, actorName: other.name, threadId: 'mine', threadTitle: 'Panel thumbnails', body: 'the third one reads best', gameId: null, inviteId: null, recommendationId: null, createdAt: at(5), readAt: null },
    ] }));
  }
  const board = (id, title, author, minutes, comments = []) => ({
    id, title, body: `Words of ${title}.`, author, createdAt: at(minutes),
    anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, tags: [], comments, origin: 'user',
  });
  window.localStorage.setItem('debaser.forum.ugc.v2', JSON.stringify({ version: 2, pins: [], threads: [
    board('mine', 'Panel thumbnails', { id: me.id, displayName: me.name }, 60, [
      { id: 'mine-r1', threadId: 'mine', body: 'the third one reads best', author: { id: other.id, displayName: other.name }, createdAt: at(5), tags: [] },
    ]),
    board('theirs', 'Marmalade sketches', { id: other.id, displayName: other.name }, 30),
    { ...board('links-lore', 'Corridor theory', { id: other.id, displayName: other.name }, 20), body: 'read /lore/the-glass-corridor first' },
  ] }));
  const room = { id: 'room-live', originalHostId: other.id, originalHostLabel: other.name, hostId: other.id, forumThreadId: null, currentEntryId: null, positionSeconds: 0, isPlaying: true, startedAt: at(10), updatedAt: new Date(now).toISOString(), endedAt: null, origin: 'stream', isPublic: true, privacy: 'open', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true };
  window.localStorage.setItem('debaser.watch.v1', JSON.stringify({ rooms: [room], queue: [], messages: [], crowns: [], members: [], passwords: {}, attempts: [], privateRows: [] }));
}

async function newContext(browser, signedIn, accountDeskOff = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let live = 0;
  await context.route(/supabase\.(co|in)\/|debaser-site\.vercel\.app|api\.debaser\.site/, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript(seed, { me: ME, other: OTHER, signedIn, accountDeskOff });
  return { context, liveHits: () => live };
}

async function forumReady(page) {
  await page.getByRole('button', { name: '+ NEW POST' }).first().waitFor({ timeout: 180000 });
  await sleep(2500);
}
const desk = (page) => page.locator('[data-desk]');
const deskDay = 'debaser.desk.opened-day.v1';
/** Yesterday as the last day the desk opened by itself, so the next visit is the first of a new day. */
const newDay = (page) => page.evaluate((key) => window.localStorage.setItem(key, '2000-01-01'), deskDay);
const closeDeskWindow = async (page) => {
  await page.locator('[data-dock-window="desk"] [aria-label="Close DESK"]').click({ timeout: 5000 });
  await sleep(400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let liveTotal = 0;
  try {
    console.log('1. YOUR DESK (D1A+, D2A, D3A)');
    let { context, liveHits } = await newContext(browser, true);
    let page = await context.newPage();
    // A stop inside part 1 is counted and the account part still runs.
    try {
    page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await desk(page).count()) === 1, 'the first visit to the forum today opens the DESK by itself');
    const sections = await page.locator('[data-desk-section]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-desk-section')));
    check(sections.includes('replies'), 'REPLIES TO YOU is there (a reply is waiting)', sections.join(','));
    check(sections.includes('live'), 'LIVE NOW is there (a room is on)', sections.join(','));
    const replyText = (await page.locator('[data-desk-section="replies"]').textContent()).replace(/\s+/g, ' ');
    check(/ZEPHYRFRIEND REPLIED/.test(replyText) && /Panel thumbnails/.test(replyText) && /1 NEW/.test(replyText), 'it says who replied, where, and that it is new', replyText.slice(0, 120));
    check(/IS STREAMING/.test(await page.locator('[data-desk-section="live"]').textContent()), 'LIVE NOW names the stream');
    check(!sections.includes('reading'), 'an empty section is not drawn (no book started)', sections.join(','));
    // Calmer (Luke, 2026-11-21): beside the side panel, not over it, small, and never over + NEW POST.
    const deskBox = await page.locator('[data-dock-window="desk"]').boundingBox();
    const panelBox = await page.locator('[data-side-panel]').boundingBox().catch(() => null);
    const postBox = await page.getByRole('button', { name: '+ NEW POST' }).first().boundingBox();
    check(deskBox !== null && panelBox !== null && deskBox.x + deskBox.width <= panelBox.x + 1, 'the DESK sits beside the side panel, not over it', JSON.stringify({ deskBox, panelBox }));
    check(deskBox !== null && deskBox.width <= 420, 'and it is small (no wider than 420)', String(deskBox?.width));
    const overPost = deskBox !== null && postBox !== null && deskBox.x < postBox.x + postBox.width && deskBox.x + deskBox.width > postBox.x && deskBox.y < postBox.y + postBox.height && deskBox.y + deskBox.height > postBox.y;
    check(!overPost, 'and it leaves + NEW POST in sight');
    check((await page.locator('[data-dock-window="desk"] [data-desk-auto="on"]').count()) === 1, 'its title line carries AUTO POP-UP, on by default');
    await page.screenshot({ path: join(OUT, 'desk.png') });
    await page.locator('[data-desk-section="replies"] [aria-controls]').click({ timeout: 5000 });
    await sleep(300);
    await closeDeskWindow(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await desk(page).count()) === 0, 'a second visit the same day does not open it again');
    check((await page.locator('nav [data-desk-key]').count()) === 0, 'the top bar has no DESK key now');
    check((await page.locator('[data-side-panel] [data-desk-key]').count()) === 1, 'the side panel has it, on the shelf above the bell');
    await page.locator('[data-side-panel] [data-desk-key]').click({ timeout: 5000 });
    await sleep(800);
    check((await desk(page).count()) === 1, 'the DESK key by the bell opens it');
    check((await page.locator('[data-desk-section="replies"]:not([data-folded])').count()) === 0, 'and the folded section stays folded');
    await page.locator('[data-desk-section="replies"] [aria-controls]').click({ timeout: 5000 });
    await closeDeskWindow(page);
    await page.locator('[data-side-panel] button[aria-label^="Notifications:"]').click({ timeout: 5000 });
    await sleep(400);
    await page.locator('[data-bell-desk]').click({ timeout: 5000 });
    await sleep(800);
    check((await desk(page).count()) === 1, "the bell's menu opens it too ([ ▭ DESK ])");
    // Shut from the shelf's key, it spends only `?desk=1`: the board keeps its own address (code-reviewer, 2026-11-21).
    await closeDeskWindow(page);
    await page.goto(`${BASE}/forum?view=gallery&desk=1`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    await page.locator('[data-side-panel] [data-desk-key]').click({ timeout: 5000 });
    await sleep(1500);
    const kept = new URL(page.url()).searchParams;
    check((await desk(page).count()) === 0 && kept.get('view') === 'gallery' && kept.get('desk') === null, "shut from the shelf, it drops ?desk=1 and keeps the board's view", page.url());
    await page.locator('[data-side-panel] [data-desk-key]').click({ timeout: 5000 });
    await sleep(800);

    // AUTO POP-UP off: the next day's first visit does not open it, and the choice goes to the account's settings.
    await page.locator('[data-dock-window="desk"] [data-desk-auto]').click({ timeout: 5000 });
    await sleep(1800);
    check((await page.locator('[data-desk-auto="off"]').count()) === 1, 'AUTO POP-UP turns off');
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('debaser.user-settings.mock.v1') ?? '{}')['desk-me']?.settings?.keys?.deskAuto ?? null);
    check(saved === '0', "and it is saved with the account's settings", String(saved));
    await closeDeskWindow(page);
    await newDay(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await desk(page).count()) === 0, 'AUTO POP-UP off: the first visit of a new day does not open it');
    await page.locator('[data-side-panel] [data-desk-key]').click({ timeout: 5000 });
    await sleep(800);
    check((await desk(page).count()) === 1, 'but its key still opens it');
    await page.locator('[data-dock-window="desk"] [data-desk-auto]').click({ timeout: 5000 });
    await sleep(300);
    await closeDeskWindow(page);
    await newDay(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await desk(page).count()) === 1, 'AUTO POP-UP back on: the next new day opens it again');
    await page.locator('[data-desk-section="live"] a').first().click({ timeout: 5000 });
    await sleep(1500);
    check((await desk(page).count()) === 0, 'pressing a line goes there and closes the desk');
    check(new URL(page.url()).searchParams.get('watch') === 'room-live', "LIVE NOW's line joins the room", page.url());
    } catch (error) {
      failed += 1;
      console.log(`  FAIL part 1 stopped: ${error.message.split('\n')[0]}`);
    }
    liveTotal += liveHits();
    await context.close();

    console.log('1b. AUTO POP-UP follows the account');
    ({ context, liveHits } = await newContext(browser, true, true));
    page = await context.newPage();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await desk(page).count()) === 0, "a browser that never had the desk: the account's AUTO POP-UP off holds, nothing opens by itself");
    await page.locator('[data-side-panel] [data-desk-key]').click({ timeout: 5000 }).catch(() => null);
    await sleep(800);
    check((await page.locator('[data-desk-auto="off"]').count()) === 1, 'and its switch reads OFF here too');
    liveTotal += liveHits();
    await context.close();
    ({ context, liveHits } = await newContext(browser, true));
    page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));

    console.log('2. ONE SEARCH BOX (S1B, S2A)');
    await page.goto(`${BASE}/forum?view=gallery`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+k');
    await sleep(700);
    check((await page.locator('#site-search-box').count()) === 1, 'Ctrl+K opens the SEARCH window');
    const searchFor = async (words) => {
      await page.locator('#site-search-box').fill(words);
      await page.locator('#site-search-box').press('Enter');
      await sleep(900);
    };
    await searchFor('marmalade');
    const posts = await page.locator('[data-search-group="POSTS & REPLIES"]').textContent().catch(() => '');
    check(/Marmalade sketches/.test(posts), 'POSTS & REPLIES finds a post by its title', posts.slice(0, 80));
    await searchFor('zephyr');
    const people = await page.locator('[data-search-group="PEOPLE"]').textContent().catch(() => '');
    check(/ZEPHYRFRIEND/.test(people), 'PEOPLE finds a person', people.slice(0, 80));
    await searchFor('glass corridor');
    const docs = await page.locator('[data-search-group="DOCS & LORE"]').textContent().catch(() => '');
    check(/THE GLASS CORRIDOR/.test(docs), 'DOCS & LORE finds a lore page', docs.slice(0, 80));
    const groups = await page.locator('[data-search-group]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-search-group')));
    check(groups[groups.length - 1] === 'OUTSIDE', 'OUTSIDE comes after the site\'s own groups', groups.join(','));
    await page.waitForFunction(() => !/ASKING THE OUTSIDE/.test(document.querySelector('[data-search-group="OUTSIDE"]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => null);
    const outside = (await page.locator('[data-search-group="OUTSIDE"]').textContent()).replace(/\s+/g, ' ');
    check(!/ASKING THE OUTSIDE/.test(outside), 'and it answers, with results or a plain line', outside.slice(0, 100));
    await page.screenshot({ path: join(OUT, 'search.png') });
    await searchFor('marmalade');
    await page.locator('[data-search-group="POSTS & REPLIES"] a').first().click();
    await sleep(2500);
    check((await page.locator('#site-search-box').count()) === 0, 'pressing a result closes the window');
    check(await page.locator('#thread-theirs details[open]').count() === 1, 'and opens the post on the board');
    await page.locator('[data-search-key]').click();
    await sleep(600);
    check((await page.locator('#site-search-box').count()) === 1, 'the top bar\'s ⌕ SEARCH key opens it too');
    console.log('2b. TALKED ABOUT IN (S4A)');
    await page.goto(`${BASE}/lore/the-glass-corridor`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-talked-about]').first().waitFor({ timeout: 90000 }).catch(() => null);
    const talk = (await page.locator('[data-talked-about]').first().textContent().catch(() => '')) ?? '';
    check(/TALKED ABOUT IN:/.test(talk) && /Corridor theory/.test(talk), 'a lore page names the thread that links it', talk.slice(0, 100));
    const talkHref = await page.locator('[data-talked-about] a').first().getAttribute('href').catch(() => null);
    check(talkHref === '/forum#thread-links-lore', 'and the name opens that thread on the board', String(talkHref));
    await page.screenshot({ path: join(OUT, 'talked-about.png') });
    liveTotal += liveHits();
    await context.close();

    console.log('3. A visitor');
    ({ context, liveHits } = await newContext(browser, false));
    page = await context.newPage();
    await page.goto(`${BASE}/forum?desk=1`, { waitUntil: 'domcontentloaded' });
    await forumReady(page);
    check((await page.locator('[data-desk-key]').count()) === 0, 'a visitor has no DESK key');
    check((await desk(page).count()) === 0, 'and ?desk=1 opens nothing for them');
    check((await page.locator('[data-search-key]').count()) === 1, 'but can search');
    liveTotal += liveHits();
    await context.close();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL the run stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  check(liveTotal === 0, 'nothing reached the live site', `${liveTotal} requests`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
