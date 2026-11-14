/*
 * A profile's BOARD ACTIVITY in a real browser: folded by default, and every row lands on its own post or reply
 * (Luke, 2026-11-14). Not in `npm run checks`: it signs in as kept TEST ACCOUNT A. It only looks and presses links:
 * nothing is written to the database (beyond the profile visit any visit records).
 *
 *   node scripts/drive-profile-rows.cjs --person <account id> [--thread <id>] [--comment <id>]
 *        [--base https://debaser-site.vercel.app] [--mobile] [--headed] [--address-only]
 *
 * `--person` is somebody with posts and replies on the board (never acted as: only their public page is read).
 *   1. the board opened cold at `/forum#thread-<id>` and at `/forum#comment-<id>` (the ids given, ideally old ones that
 *      are not on the board's first page): the post is on screen, open and marked; the reply is on screen and marked;
 *   2. the person's profile: BOARD ACTIVITY is shut (its key says so, no rows drawn); pressed, it is open with rows;
 *   3. the oldest post row pressed: the board shows that post, open, in view, marked, and says which page it is on;
 *   4. back on the profile, a reply row pressed: that reply is in view and marked.
 * `--address-only` stops after step 1, which is the part that can be run against a site from before the change.
 * Screenshots in Temp/browse/profile/rows-*.png.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const PERSON = opt('--person', '');
const THREAD = opt('--thread', '');
const COMMENT = opt('--comment', '');
const MOBILE = args.includes('--mobile');
const TAG = MOBILE ? 'phone' : 'desktop';
const SHOTS = join('Temp', 'browse', 'profile');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

async function open(browser, account) {
  const context = await browser.newContext(
    MOBILE
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1440, height: 900 } },
  );
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return page;
}

/** Waits for the element to wear the jump's mark, then says where it is and what the board shows around it. */
async function landed(page, domId, what) {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.classList.contains('animate-flash') === true,
    domId,
    { timeout: 45000, polling: 50 },
  ).catch(() => {
    throw new Error(`${what}: never marked (no element #${domId} wearing the flash within 45 s)`);
  });
  pass(`${what}: marked (the flash and its dotted ring)`);
  // The picture is taken while the ring is still on it.
  await page.screenshot({ path: join(SHOTS, `rows-${TAG}-${what.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) });

  const seen = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const box = el.getBoundingClientRect();
    const article = el.closest('article') ?? el;
    const details = article.querySelector('details');
    const readout = [...document.querySelectorAll('nav[aria-label="Board pages"] span')]
      .map((span) => span.textContent ?? '')
      .find((text) => /^\d+-\d+ OF \d+$/.test(text.trim()));
    const middle = window.innerHeight / 2;
    return {
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      height: window.innerHeight,
      inView: box.bottom > 0 && box.top < window.innerHeight && ((box.top >= 0 && box.bottom <= window.innerHeight) || (box.top <= middle && box.bottom >= middle)),
      open: details === null ? null : details.open,
      readout: readout ?? null,
    };
  }, domId);
  assert.ok(seen.inView, `${what}: in view (top ${seen.top}, bottom ${seen.bottom}, screen ${seen.height})`);
  pass(`${what}: in view (top ${seen.top}px of ${seen.height}px)`);
  assert.equal(seen.open, true, `${what}: its post is open`);
  pass(`${what}: its post is open; the board's foot reads "${seen.readout}"`);
  return seen;
}

async function main() {
  assert.ok(PERSON.length > 0, 'pass --person <account id>');
  const a = await signInTestAccount('A');
  if (a.error) throw new Error(`sign-in A: ${a.error}`);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });

  try {
    const page = await open(browser, a);
    let laterPage = false;

    /* 1. cold addresses */
    if (THREAD.length > 0) {
      await page.goto(`${BASE}/forum#thread-${THREAD}`, { waitUntil: 'domcontentloaded' });
      const seen = await landed(page, `thread-${THREAD}`, 'cold post address');
      if (seen.readout !== null && !seen.readout.startsWith('1-')) laterPage = true;
    }
    if (COMMENT.length > 0) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.goto(`${BASE}/forum#comment-${COMMENT}`, { waitUntil: 'domcontentloaded' });
      const seen = await landed(page, `comment-${COMMENT}`, 'cold reply address');
      if (seen.readout !== null && !seen.readout.startsWith('1-')) laterPage = true;
    }
    if (args.includes('--address-only')) {
      console.log(`${passed} proofs passed (addresses only; a post beyond the first page: ${laterPage ? 'yes' : 'NO'})`);
      return;
    }

    /* 2. the profile: shut, then open */
    await page.goto(`${BASE}/profile/${PERSON}`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('[data-board-activity]');
    await section.waitFor({ timeout: 60000 });
    // Give the board's posts time to arrive: the rows are read out of them.
    await sleep(6000);
    assert.equal(await section.getAttribute('data-board-activity'), 'shut', 'BOARD ACTIVITY starts shut');
    const key = section.getByRole('button', { name: /SHOW/ });
    assert.equal(await key.getAttribute('aria-expanded'), 'false', 'its key says it is folded away');
    assert.equal(await section.locator('a[href^="/forum#"]').count(), 0, 'no rows are drawn while it is shut');
    pass('BOARD ACTIVITY is shut on arrival: one key, aria-expanded="false", no rows');
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `rows-${TAG}-activity-shut.png`) });

    await key.click();
    assert.equal(await section.getAttribute('data-board-activity'), 'open');
    assert.equal(await section.getByRole('button', { name: /HIDE/ }).getAttribute('aria-expanded'), 'true');
    const rowCount = await section.locator('a[href^="/forum#"]').count();
    assert.ok(rowCount > 0, 'rows are drawn once it is open');
    pass(`BOARD ACTIVITY opens on one press: aria-expanded="true", ${rowCount} rows`);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `rows-${TAG}-activity-open.png`) });

    // Everything they have done, so the oldest row is reachable.
    for (let i = 0; i < 20; i += 1) {
      const more = section.getByRole('button', { name: /MORE/ });
      if ((await more.count()) === 0) break;
      await more.click();
    }
    const hrefs = await section.locator('a[href^="/forum#"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const posts = hrefs.filter((href) => href.startsWith('/forum#thread-'));
    const replies = hrefs.filter((href) => href.startsWith('/forum#comment-'));
    console.log(`  rows: ${posts.length} posts, ${replies.length} replies`);
    assert.ok(posts.length > 0, 'the person has at least one post row');

    /* 3. the oldest post row */
    const oldest = posts[posts.length - 1];
    await section.locator(`a[href="${oldest}"]`).click();
    await page.waitForURL(/\/forum#thread-/, { timeout: 30000 });
    const post = await landed(page, oldest.slice('/forum#'.length), 'post row pressed');
    if (post.readout !== null && !post.readout.startsWith('1-')) laterPage = true;

    /* 4. a reply row */
    if (replies.length > 0) {
      await page.goto(`${BASE}/profile/${PERSON}`, { waitUntil: 'domcontentloaded' });
      await section.waitFor({ timeout: 60000 });
      await sleep(6000);
      await section.getByRole('button', { name: /SHOW/ }).click();
      for (let i = 0; i < 20; i += 1) {
        const more = section.getByRole('button', { name: /MORE/ });
        if ((await more.count()) === 0) break;
        await more.click();
      }
      const oldestReply = replies[replies.length - 1];
      await section.locator(`a[href="${oldestReply}"]`).click();
      await page.waitForURL(/\/forum#comment-/, { timeout: 30000 });
      const reply = await landed(page, oldestReply.slice('/forum#'.length), 'reply row pressed');
      if (reply.readout !== null && !reply.readout.startsWith('1-')) laterPage = true;
    } else {
      console.log('  --  no reply rows on this profile: the reply press was not driven');
    }

    assert.ok(laterPage, 'at least one landing was on a later page of the board (pick an older post or reply)');
    pass('at least one landing was beyond the board\'s first page');
    console.log(`${passed} proofs passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED after ${passed} proofs: ${error.message}`);
  process.exit(1);
});
