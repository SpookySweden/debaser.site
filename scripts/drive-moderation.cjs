/*
 * Moderation on the local MOCK server (SPEC-moderation.md): report, block, hide, the log, a ban and its appeal, seen by each person.
 *
 *   node scripts/dev-mock-live.cjs 3318                      a local server, every switch on mock, no live database
 *   node scripts/drive-moderation.cjs --base http://localhost:3318 [--headed]
 *
 * One browser plays three people by switching the mock store's session: DRIVE B writes a post, DRIVE C reports B, blocks B and
 * unblocks B, and the mock house account (the mock store's moderator) reads REPORTS, hides B's post, bans B; B sees the hidden mark,
 * the ban and appeals. Everything lives in that throwaway browser's storage: nothing reaches the live site, and a request to it fails
 * the run. Screenshots go to Temp/browse/moderation-*.png.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3318').replace(/\/$/, '');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok    ${what}`);
};

const HOUSE = 'debaser-site';
const B = 'drive-b';
const C = 'drive-c';
const POST_TITLE = 'MODERATION DRIVE POST';
const now = new Date().toISOString();
const person = (id, name) => ({ id, email: `${id}@example.test`, displayName: name, createdAt: now, salt: 'drive', secretHash: 'drive' });

/** The mock stores' first state: B and C as accounts, and B's post with C's reply on the board. */
const SEED = {
  'debaser.auth.mock.v1': { users: [person(B, 'DRIVE B'), person(C, 'DRIVE C')], sessionUserId: C, bannedIds: [] },
  'debaser.forum.ugc.v2': {
    version: 2,
    threads: [
      {
        id: 'drive-thread-1',
        title: POST_TITLE,
        body: 'a post for the moderation drive',
        author: { id: B, displayName: 'DRIVE B' },
        createdAt: now,
        anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
        tags: [],
        comments: [],
        origin: 'user',
      },
    ],
    pins: [],
  },
};

async function as(page, who) {
  await page.evaluate(
    ([key, id]) => {
      const state = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      state.sessionUserId = id;
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    ['debaser.auth.mock.v1', who],
  );
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await sleep(2500);
  for (const text of ['NOT NOW', '[ KEEP THESE SETTINGS ]', '[ I NEVER HAD ONE ]']) {
    const key = page.getByText(text, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  await sleep(500);
}

/** The board's post, opened so its keys show. */
async function openPost(page) {
  await open(page, '/forum');
  const title = page.getByText(POST_TITLE, { exact: false }).first();
  await title.waitFor({ timeout: 30000 });
  await title.click();
  await sleep(800);
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `moderation-${name}.png`) });
const mockModeration = (page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('debaser.moderation.mock.v1') ?? '{}'));

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let live = 0;
  await page.route(/supabase\.(co|in)\/|api\.debaser\.site|debaser-site\.vercel\.app|\/\/debaser\.site\//, (route) => {
    live += 1;
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    // Seed, as C.
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((seed) => {
      window.localStorage.clear();
      for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, JSON.stringify(value));
    }, SEED);

    /* --- C reports B from B's profile ------------------------------------------------------------------------------- */
    await open(page, `/profile/${B}`);
    await page.locator('[data-block-key]').first().waitFor({ timeout: 30000 });
    pass("C sees [ BLOCK ] and [ REPORT ] on B's profile");
    await page.locator('[data-report-key]').first().click();
    await page.getByRole('radio', { name: /SPAM/ }).click();
    await page.locator('textarea').last().fill('drive: posting the same thing everywhere');
    await page.getByRole('button', { name: 'SEND REPORT' }).click();
    await page.getByText('REPORT SENT.').waitFor({ timeout: 10000 });
    await shot(page, '1-report-sent');
    const afterReport = await mockModeration(page);
    assert.equal(afterReport.reports?.length, 1, 'the report is stored');
    assert.equal(afterReport.reports[0].accountId, B);
    pass('C reports B: SPAM, with a line, and sees REPORT SENT');
    assert.equal(await page.locator('[data-reports-key]').count(), 0, 'REPORTS is not on the bar for somebody who is not a moderator');
    assert.equal(await page.locator('[data-mod-tools-key]').count(), 0, 'no MOD badge for somebody who is not a moderator');
    pass('C (not a moderator) has no REPORTS key and no MOD badge');

    /* --- C blocks B, then unblocks from PRIVACY -------------------------------------------------------------------- */
    await open(page, '/forum');
    await page.getByText(POST_TITLE, { exact: false }).first().waitFor({ timeout: 30000 });
    await open(page, `/profile/${B}`);
    await page.locator('[data-block-key]').first().click();
    await page.locator('[data-block-key]').first().click();
    await page.locator('[data-blocked-card]').waitFor({ timeout: 10000 });
    await shot(page, '2-blocked-card');
    pass("blocking takes two presses, and B's profile becomes YOU BLOCKED THIS PERSON");
    await open(page, '/forum');
    await sleep(1500);
    assert.equal(await page.getByText(POST_TITLE, { exact: false }).count(), 0, "B's post is gone from C's board");
    pass("B's post is gone from C's board");
    await open(page, '/account?tab=privacy');
    const list = page.locator('[data-blocked-list]');
    await list.getByText('DRIVE B').waitFor({ timeout: 15000 });
    await shot(page, '3-privacy-blocked');
    pass('PRIVACY lists DRIVE B under BLOCKED');
    await list.getByRole('button', { name: '[ UNBLOCK ]' }).click();
    await list.getByText('NOBODY.').waitFor({ timeout: 10000 });
    await open(page, '/forum');
    await page.getByText(POST_TITLE, { exact: false }).first().waitFor({ timeout: 30000 });
    pass("unblocking from PRIVACY brings B's post back");

    /* --- the moderator: REPORTS, dismiss, hide --------------------------------------------------------------------- */
    await as(page, HOUSE);
    await open(page, '/forum');
    const reportsKey = page.locator('[data-reports-key]');
    await reportsKey.waitFor({ timeout: 15000 });
    assert.match(await reportsKey.innerText(), /REPORTS\s*1/, 'the key says one is waiting');
    pass('the moderator has REPORTS on the bar, with 1 waiting');
    await reportsKey.click();
    await page.getByText('drive: posting the same thing everywhere').waitFor({ timeout: 10000 });
    await shot(page, '4-reports-open');
    pass("REPORTS shows the report: who, the reason, the reporter's words");
    await page.getByRole('button', { name: '[ DISMISS ]' }).click();
    await page.getByText('NOTHING WAITING.').waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: /LOG/ }).click();
    await page.getByText(/DISMISSED A REPORT ON/).waitFor({ timeout: 10000 });
    pass('DISMISS empties OPEN, and the LOG has it');
    await reportsKey.click();

    // The moderator tools start hidden (Luke, 2026-11-20: "make the settings hidden by default instead of covering the page");
    // the [ ⛨ MOD ] key after the name, top right, shows and hides them, and the choice is remembered.
    await openPost(page);
    assert.equal(await page.getByText('[ ADMIN ]', { exact: true }).count(), 0, 'no ADMIN row while the tools are hidden');
    assert.equal(await page.locator('[data-hide-key]').count(), 0, 'no HIDE key while the tools are hidden');
    const modKey = page.locator('[data-mod-tools-key]');
    assert.equal(await modKey.getAttribute('aria-pressed'), 'false');
    await shot(page, '5a-tools-hidden');
    pass('the moderator tools start hidden: no ADMIN row, no HIDE; [ ⛨ MOD ] sits after the name');
    await modKey.click();
    await page.locator('[data-hide-key]').first().waitFor({ timeout: 10000 });
    assert.equal(await modKey.getAttribute('aria-pressed'), 'true');
    await openPost(page);
    await page.locator('[data-hide-key]').first().waitFor({ timeout: 10000 });
    pass('[ ⛨ MOD ] shows them, and they stay shown after a reload');

    await page.locator('[data-hide-key]').first().click();
    await page.locator('input[id^="hide-reason-thread-"]').fill('off topic');
    await page.getByRole('button', { name: '[ CONFIRM HIDE ]' }).click();
    await page.locator('[data-hidden-mark]').first().waitFor({ timeout: 10000 });
    assert.match(await page.locator('[data-hidden-mark]').first().innerText(), /\[ HIDDEN \] off topic/);
    await shot(page, '5-moderator-hidden');
    pass('the moderator hides the post, and still sees it marked [ HIDDEN ] off topic');

    /* --- C no longer sees it; B sees why --------------------------------------------------------------------------- */
    await as(page, C);
    await open(page, '/forum');
    await sleep(1500);
    assert.equal(await page.getByText(POST_TITLE, { exact: false }).count(), 0, 'a hidden post is gone for everybody else');
    pass('C no longer sees the hidden post');
    await as(page, B);
    await openPost(page);
    await page.locator('[data-hidden-mark]').first().waitFor({ timeout: 10000 });
    assert.match(await page.locator('[data-hidden-mark]').first().innerText(), /HIDDEN BY A MODERATOR: off topic/);
    await shot(page, '6-author-hidden');
    pass('B, the author, still sees it: HIDDEN BY A MODERATOR: off topic');

    /* --- unhide, ban, appeal --------------------------------------------------------------------------------------- */
    await as(page, HOUSE);
    await openPost(page);
    await page.locator('[data-unhide-key]').first().click();
    await sleep(800);
    assert.equal(await page.locator('[data-hidden-mark]').count(), 0, 'UNHIDE takes the mark off');
    pass('UNHIDE puts it back');
    await page.getByRole('button', { name: '[ BAN ]' }).first().click();
    await page.locator('input[id^="ban-reason-"]').fill('drive ban');
    await page.getByRole('button', { name: '[ CONFIRM BAN ]' }).click();
    await sleep(1000);
    const afterBan = await mockModeration(page);
    assert.ok(afterBan.log.some((entry) => entry.action === 'ban' && entry.targetAccountId === B), 'the ban is in the log');
    pass('the moderator bans B with a reason, and the log has it');

    await as(page, B);
    await open(page, '/account?tab=privacy');
    const notice = page.locator('[data-banned-notice]');
    await notice.waitFor({ timeout: 15000 });
    assert.match(await notice.innerText(), /\[ BANNED \] drive ban/);
    await notice.getByRole('button', { name: '[ APPEAL ]' }).click();
    await notice.locator('textarea').fill('drive: sorry, it will not happen again');
    await notice.getByRole('button', { name: '[ SEND APPEAL ]' }).click();
    await notice.getByText('YOUR APPEAL IS WAITING.').waitFor({ timeout: 10000 });
    await shot(page, '7-banned-appeal');
    pass('B sees [ BANNED ] drive ban, appeals, and is told it is waiting');

    await as(page, HOUSE);
    await open(page, '/forum');
    await page.locator('[data-reports-key]').click();
    await page.getByText('drive: sorry, it will not happen again').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '[ UNBAN ]' }).click();
    await page.getByText('NOTHING WAITING.').waitFor({ timeout: 10000 });
    pass('the appeal reaches REPORTS, and UNBAN answers it');

    assert.equal(live, 0, `the drive reached the live site ${live} times`);
    pass('nothing reached the live site');
    const ours = errors.filter((message) => /moderat|report|block/i.test(message));
    assert.deepEqual(ours, [], `page errors: ${ours.join(' | ')}`);
    console.log(`moderation drive: ${passed} passed`);
  } catch (error) {
    await shot(page, 'failed').catch(() => undefined);
    console.error(error);
    if (errors.length > 0) console.error('page errors:', errors.slice(0, 5));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
