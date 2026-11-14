/*
 * A profile's COMMENTS as a newswire you can drive (Luke, 2026-11-14), in a real browser. Not in `npm run checks`: it
 * signs in as kept TEST ACCOUNT A and looks at A's own profile, where the owner always sees the comments.
 *
 *   node scripts/drive-profile-comments.cjs [--base https://debaser-site.vercel.app] [--seed] [--headed]
 *
 * `--seed` first files three comments on A's own profile through the site's own comment window, if fewer than three
 * are there (they stay: a delete is Luke's call; they are hidden from visitors while A's PROFILE COMMENTS switch is
 * off). Without it the drive writes nothing.
 *
 *   a. the line moves by itself; b. it holds still under the pointer and moves again when the pointer leaves;
 *   c. the hold key stops it (aria-pressed) and starts it; d. the arrows step to a comment's own start, at once, and
 *   the line then holds; e. the keyboard arriving on a row stops it; f. pressing a comment's words opens the full list
 *   with that comment in view and marked, without leaving the page; g. a wire row's address (`#profile-comments`)
 *   opens the list on arrival; h. reduced motion: one whole comment, nothing moving, the arrows step through them;
 *   i. a phone: the page has no sideways scroll. Screenshots in Temp/browse/profile/comments-*.png, dark then bright.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const SHOTS = join('Temp', 'browse', 'profile');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const SLIDER = '[data-comment-slider]';
const SECTION = '#profile-comments';

async function open(browser, account, { theme = null, ...options } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript((picked) => {
    window.localStorage.setItem('debaser.lost-account.never.v1', '1');
    if (picked !== null) window.localStorage.setItem('debaser.site.theme.v1', picked);
  }, theme);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return page;
}

async function toComments(page, base, id, hash = '') {
  await page.goto(`${base}/profile/${id}${hash}`, { waitUntil: 'domcontentloaded' });
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
  await page.waitForSelector(SECTION, { timeout: 60000 });
}

/** How far the line has gone, in pixels (0 when nothing is moving it). */
const lineAt = (page) =>
  page.evaluate(() => {
    const line = document.querySelector('[data-comment-slider] [data-slider-copy="0"]')?.parentElement;
    if (!line) return null;
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(line).transform);
    return Math.round(-matrix.m41);
  });

const rowStarts = (page) =>
  page.evaluate(() => Array.from(document.querySelector('[data-comment-slider] [data-slider-copy="0"]').children, (row) => row.offsetLeft));

async function seed(page, base, id) {
  await toComments(page, base, id);
  await sleep(4000);
  // The fold's own count is the cheapest reading of how many are there.
  const count = Number.parseInt(((await page.locator(`${SECTION} button[aria-expanded]`).first().textContent()) ?? '').replace(/[^\d]/g, ''), 10) || 0;
  if (count >= 3) {
    console.log(`  seed: ${count} comments already there, nothing filed`);
    return;
  }
  const words = [
    'SLIDER DRIVE one: a short hello on this profile.',
    'SLIDER DRIVE two: a longer remark, long enough that the line has to carry it past the edge of the strip before all of it has been read.',
    'SLIDER DRIVE three: the last of the three.',
  ];
  for (const text of words.slice(count)) {
    await page.getByRole('button', { name: 'comment', exact: true }).click();
    await page.getByRole('menuitem', { name: /general/ }).click();
    const box = page.getByPlaceholder('Comment...').last();
    await box.fill(text);
    await page.getByRole('button', { name: '[ FILE COMMENT ]' }).last().click();
    await sleep(2500);
    const closeKey = page.getByRole('button', { name: /^Close / }).last();
    if ((await closeKey.count()) > 0) await closeKey.click().catch(() => undefined);
    await sleep(500);
    console.log(`  seed: filed "${text.slice(0, 24)}..."`);
  }
}

async function main() {
  const a = await signInTestAccount('A');
  if (a.error) throw new Error(`sign-in A: ${a.error}`);
  const id = a.userId;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });

  try {
    const page = await open(browser, a);
    if (args.includes('--seed')) await seed(page, BASE, id);

    await toComments(page, BASE, id);
    await page.waitForSelector(`${SLIDER}[data-comment-slider="moving"]`, { timeout: 60000 });
    await page.mouse.move(700, 120);
    await page.locator(SLIDER).scrollIntoViewIfNeeded();
    await sleep(500);

    /* a. it moves */
    const a0 = await lineAt(page);
    await sleep(1500);
    const a1 = await lineAt(page);
    assert.ok(a1 !== a0, `the line moves by itself (${a0} -> ${a1})`);
    pass(`the line moves by itself (${a0}px -> ${a1}px in 1.5 s)`);
    await page.screenshot({ path: join(SHOTS, 'comments-desktop-dark.png') });

    /* b. the pointer holds it */
    const strip = await page.locator(`${SLIDER} [data-slider-copy="0"]`).evaluate((list) => {
      const box = list.parentElement.parentElement.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.mouse.move(strip.x, strip.y);
    await sleep(300);
    const b0 = await lineAt(page);
    await sleep(1500);
    const b1 = await lineAt(page);
    assert.equal(b1, b0, 'the line holds still under the pointer');
    pass('the line holds still under the pointer');
    await page.mouse.move(700, 120);
    await sleep(1200);
    assert.notEqual(await lineAt(page), b1, 'and moves again when the pointer leaves');
    pass('and moves again when the pointer leaves');

    /* c. the hold key */
    const hold = page.locator(SLIDER).getByRole('button', { name: 'Hold the comments still' });
    assert.equal(await hold.getAttribute('aria-pressed'), 'false');
    await hold.click();
    await page.mouse.move(700, 120);
    assert.equal(await hold.getAttribute('aria-pressed'), 'true', 'the hold key says it is down');
    await sleep(300);
    const c0 = await lineAt(page);
    await sleep(1500);
    assert.equal(await lineAt(page), c0, 'held: the line stays put with the pointer away');
    pass('the hold key stops the line (aria-pressed="true"), pointer away');
    await hold.click();
    await page.mouse.move(700, 120);
    await sleep(1200);
    assert.notEqual(await lineAt(page), c0, 'pressed again, it moves');
    pass('pressed again, the line moves');

    /* d. the arrows */
    const starts = await rowStarts(page);
    assert.ok(starts.length >= 2, 'at least two comments to step between');
    const next = page.locator(SLIDER).getByRole('button', { name: 'Next comment' });
    const previous = page.locator(SLIDER).getByRole('button', { name: 'Previous comment' });
    await next.click();
    await page.mouse.move(700, 120);
    const d0 = await lineAt(page);
    assert.ok(starts.includes(d0), `a step lands exactly on a comment's start (${d0} in ${JSON.stringify(starts)})`);
    await sleep(1500);
    assert.equal(await lineAt(page), d0, 'and the line holds there with the pointer away');
    pass(`[ ▶ ] steps to a comment's own start (${d0}px) at once, and the line holds there`);
    await next.click();
    const d1 = await lineAt(page);
    assert.equal(d1, starts[(starts.indexOf(d0) + 1) % starts.length], 'the next press is the next comment');
    await previous.click();
    assert.equal(await lineAt(page), d0, 'and [ ◀ ] goes back one');
    pass('[ ▶ ] again is the next comment, and [ ◀ ] goes back one');
    await page.screenshot({ path: join(SHOTS, 'comments-desktop-stepped.png') });

    /* e. the keyboard */
    await hold.focus();
    await page.keyboard.press('Tab'); // the next arrow
    await page.keyboard.press('Tab'); // into the line
    const focusedInLine = await page.evaluate(() => document.activeElement?.closest('[data-slider-copy="0"]') !== null);
    assert.ok(focusedInLine, 'Tab from the keys goes into the line (the first copy)');
    await page.mouse.move(700, 120);
    await sleep(8600); // past the step's hold
    const e0 = await lineAt(page);
    await sleep(1500);
    assert.equal(await lineAt(page), e0, 'the line holds while the keyboard is inside it');
    pass('the keyboard arriving on a row holds the line, past any step hold');
    const tabStops = await page.evaluate(() => document.querySelectorAll('[data-slider-copy="1"] a:not([tabindex="-1"]), [data-slider-copy="1"] button:not([tabindex="-1"])').length);
    assert.equal(tabStops, 0, 'the copy that makes the loop seamless has no tab stops');
    pass('the second copy of the rows is skipped by Tab');

    /* f. pressing a comment's words */
    const address = page.url();
    const words = page.locator(`${SLIDER} [data-slider-copy="0"] a[href="#profile-comments"]`).nth(1);
    const wanted = ((await words.textContent()) ?? '').replace(/^"|"$/g, '').replace(/\.\.\.$/, '');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur());
    await words.click({ force: true });
    await page.waitForFunction(() => document.querySelector('#profile-comments ul li.outline-dotted') !== null, null, { timeout: 5000, polling: 50 });
    await page.screenshot({ path: join(SHOTS, 'comments-desktop-opened-at.png') });
    const opened = await page.evaluate(() => {
      const marked = document.querySelector('#profile-comments ul li.outline-dotted');
      const box = marked.getBoundingClientRect();
      const fold = document.querySelector('#profile-comments button[aria-expanded]');
      return { text: marked.textContent, inView: box.top >= 0 && box.bottom <= window.innerHeight, fold: fold.getAttribute('aria-expanded'), index: [...marked.parentElement.children].indexOf(marked) };
    });
    assert.equal(opened.fold, 'true', 'the full list is open');
    assert.ok(opened.inView, 'the comment is in view');
    assert.equal(opened.index, 1, 'and it is the comment that was pressed (the second in the list)');
    assert.ok(opened.text.includes(wanted.slice(0, 30)), `the marked row carries the words that were pressed ("${wanted.slice(0, 30)}")`);
    assert.equal(page.url(), address, 'the page did not go anywhere');
    pass(`pressing a comment's words ("${wanted.slice(0, 24)}...") opens the full list with that comment in view and marked`);

    /* g. a wire row's address */
    await toComments(page, BASE, id, '#profile-comments');
    await page.waitForFunction(() => document.querySelector('#profile-comments button[aria-expanded="true"]') !== null, null, { timeout: 15000 });
    pass('arriving at #profile-comments (a wire row\'s address) opens the full list');

    /* bright theme */
    const bright = await open(browser, a, { theme: 'default' });
    await toComments(bright, BASE, id);
    await bright.waitForSelector(`${SLIDER}[data-comment-slider="moving"]`, { timeout: 60000 });
    await bright.locator(SLIDER).scrollIntoViewIfNeeded();
    await sleep(1500);
    const scheme = await bright.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await bright.screenshot({ path: join(SHOTS, 'comments-desktop-bright.png') });
    console.log(`  --  bright capture taken (data-theme="${scheme}")`);
    await bright.context().close();

    /* h. reduced motion */
    const still = await open(browser, a, { reducedMotion: 'reduce' });
    await toComments(still, BASE, id);
    await still.waitForSelector(`${SLIDER}[data-comment-slider="still"] li`, { timeout: 60000 });
    await sleep(3000);
    await still.locator(SLIDER).scrollIntoViewIfNeeded();
    const h = await still.evaluate(() => {
      const slider = document.querySelector('[data-comment-slider]');
      const strip = slider.querySelector('ul').parentElement;
      return {
        rows: slider.querySelectorAll('li').length,
        holdKey: [...slider.querySelectorAll('button')].some((key) => key.getAttribute('aria-label') === 'Hold the comments still'),
        fits: strip.scrollWidth <= strip.clientWidth + 1,
        text: slider.querySelector('li').textContent,
      };
    });
    assert.equal(h.rows, 1, 'reduced motion shows one comment');
    assert.equal(h.holdKey, false, 'with no hold key: nothing moves to be held');
    assert.ok(h.fits, 'and the whole of it fits in the strip (it wraps, nothing is cut)');
    await still.screenshot({ path: join(SHOTS, 'comments-desktop-reduced-motion.png') });
    await still.locator(SLIDER).getByRole('button', { name: 'Next comment' }).click();
    const h2 = await still.evaluate(() => document.querySelector('[data-comment-slider] li').textContent);
    assert.notEqual(h2, h.text, 'the arrow steps to another comment');
    pass('reduced motion: one whole comment, nothing moving, the arrows step through them');
    await still.context().close();

    /* i. a phone */
    const phone = await open(browser, a, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await toComments(phone, BASE, id);
    await phone.waitForSelector(SLIDER, { timeout: 60000 });
    await sleep(2500);
    await phone.locator(SLIDER).scrollIntoViewIfNeeded();
    const wide = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    assert.ok(wide.page <= wide.screen + 1, `no sideways scroll on a phone (${wide.page} in ${wide.screen})`);
    await phone.screenshot({ path: join(SHOTS, 'comments-phone-dark.png') });
    await phone.locator(SLIDER).getByRole('button', { name: 'Next comment' }).tap();
    pass(`a phone: the slider is drawn, steps on a tap, and the page has no sideways scroll (${wide.page}px in ${wide.screen}px)`);
    await phone.context().close();

    console.log(`${passed} proofs passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED after ${passed} proofs: ${error.message}`);
  process.exit(1);
});
