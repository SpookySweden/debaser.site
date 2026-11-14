/*
 * The companion taking part in what you are doing (Luke, 2026-11-14, step 2), in a real browser as TEST ACCOUNT A. Not in
 * `npm run checks`: it needs the kept test accounts.
 *
 *   node scripts/drive-companion-scenes.cjs --base https://debaser-site.vercel.app [--headed] [--env-test <path>]
 *
 *   1. typing: keys typed into the board's SEARCH box make it type along with `...` over its head, and it stops a moment
 *      after the last key;
 *   2. the arcade: with a solo game of noughts and crosses on screen it sits and watches, in view beside the arcade's
 *      window (never behind it); the game lost on purpose, it slumps;
 *   3. a video: with one playing in the floating player it sits and watches, facing it;
 *   4. a book: with one open at /read it sits and reads along, the book's art slot on its lap, and its head flicks when
 *      the page turns.
 *
 * It writes nothing of its own. The reader saves A's place in the book it opens, as it does for anyone reading.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, loadEnv, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const BOOK = 'books:OL46170130W-pg7256';
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

function readOwn() {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null || own.style.visibility !== 'visible') return null;
  const box = own.getBoundingClientRect();
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const typing = own.querySelector('[data-companion-typing]');
  const book = own.querySelector('[data-companion-book]');
  return {
    left: Math.round(box.left),
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    w: Math.round(box.width),
    h: Math.round(box.height),
    mood: own.dataset.mood,
    motion: own.dataset.motion ?? null,
    facing: own.dataset.facing,
    // In view: the figure is what a look at its middle finds, or it is letting presses through to a key it stands over
    // (it is still drawn in front of that key; only the press goes past it).
    inView: at !== null && (own.contains(at) || getComputedStyle(own).pointerEvents === 'none'),
    yielding: getComputedStyle(own).pointerEvents === 'none',
    under: at === null || own.contains(at) ? null :(at.closest('[data-dock-window]')?.getAttribute('data-dock-window') ?? at.tagName.toLowerCase()),
    // Keys it stands over that would not take a press at their middle: the figure is what is there instead.
    covers: [...document.querySelectorAll('button, a[href], input, [role="slider"]')]
      .filter((key) => {
        const r = key.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) return false;
        const cx = Math.min(Math.max(r.left + r.width / 2, box.left + 1), box.right - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, box.top + 1), box.bottom - 1);
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
        const top = document.elementFromPoint(cx, cy);
        return top !== null && own.contains(top);
      })
      .map((key) => key.getAttribute('aria-label') || key.textContent.trim().slice(0, 24) || key.tagName.toLowerCase()),
    typing: typing !== null && getComputedStyle(typing).visibility === 'visible',
    book: book !== null && getComputedStyle(book).display !== 'none',
    bookSlot: book?.querySelector('span')?.getAttribute('title') ?? null,
  };
}

async function waitFor(page, test, ms, every = 120) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await page.evaluate(readOwn);
    if (now !== null && test(now)) return now;
    await sleep(every);
  }
  return null;
}

async function motionsOver(page, ms) {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await page.evaluate(readOwn);
    if (now !== null && seen[seen.length - 1] !== now.motion) seen.push(now.motion);
    await sleep(90);
  }
  return seen;
}

async function closeUp(page, name) {
  const now = await page.evaluate(readOwn);
  if (now === null) return;
  const view = page.viewportSize();
  const x = Math.max(0, Math.min(view.width - 300, Math.round(now.left + now.w / 2 - 150)));
  const y = Math.max(0, Math.min(view.height - 200, Math.round(now.bottom - 170)));
  await page.screenshot({ path: join(SHOTS, `companion-${name}-close.png`), clip: { x, y, width: 300, height: 200 } });
}

async function settle(page) {
  // Headless Chrome reports no mouse until the first move, and the site would take it for a phone.
  await page.mouse.move(700, 300);
  await sleep(2500);
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
  await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 20000 });
  await page.mouse.move(700, 300);
}

/** The board as the page says it: nine of 'X', 'O' or null. */
const readBoard = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label^="Cell "]')].map((cell) => {
      const label = cell.getAttribute('aria-label') ?? '';
      return label.endsWith(', X') ? 'X' : label.endsWith(', O') ? 'O' : null;
    }),
  );
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** A move for X that tries to lose: never finishing its own line, never blocking the other side's. */
function losingMove(board) {
  const empty = board.map((cell, index) => (cell === null ? index : -1)).filter((index) => index >= 0);
  const wins = (cell) => LINES.some((line) => line.includes(cell) && line.every((i) => i === cell || board[i] === 'X'));
  const blocks = (cell) => LINES.some((line) => line.includes(cell) && line.filter((i) => board[i] === 'O').length === 2);
  return empty.find((cell) => !wins(cell) && !blocks(cell)) ?? empty.find((cell) => !wins(cell)) ?? empty[0];
}

(async () => {
  loadEnv();
  process.loadEnvFile('.env.production');
  process.loadEnvFile(opt('--env-test', '.env.test'));
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !flag('--headed'),
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const account = await signInTestAccount('A');
    if (account.error) throw new Error(`sign-in A: ${account.error}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
    await installSession(page, account);

    console.log('Typing along');
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const search = page.getByPlaceholder('SEARCH').first();
    await search.click();
    await page.mouse.move(700, 300);
    const typed = motionsOver(page, 2600);
    await page.keyboard.type('hello there companion', { delay: 110 });
    const whileTyping = await page.evaluate(readOwn);
    const seen = await typed;
    assert.ok(seen.includes('type'), `it types along (saw ${seen.join(' ')})`);
    assert.equal(whileTyping.motion, 'type');
    assert.equal(whileTyping.typing, true, '`...` over its head while it types');
    await closeUp(page, 'typing');
    const after = await waitFor(page, (now) => now.motion !== 'type', 4000);
    assert.ok(after, 'it stops a moment after the last key');
    assert.equal(after.typing, false);
    await search.fill('');
    pass(`typing into the board's SEARCH box: it types along with "..." over its head, and stops after the last key (${seen.join(', ')})`);

    console.log('The arcade');
    await page.goto(`${BASE}/forum?arcade=1`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.locator('[data-dock-window="arcade"]').getByRole('button', { name: '[ PLAY SOLO ]' }).first().click();
    await page.waitForSelector('button[aria-label^="Cell "]', { timeout: 15000 });
    await page.mouse.move(700, 300);
    const watching = await waitFor(page, (now) => now.motion === 'watch', 5000);
    assert.ok(watching, 'with a game on screen it sits and watches');
    assert.ok(watching.inView, `in view beside the arcade's window, not behind it (under ${watching.under})`);
    await page.screenshot({ path: join(SHOTS, 'companion-arcade.png') });
    await closeUp(page, 'arcade');
    pass(`a solo game on screen: it sits and watches, in view at ${watching.left},${watching.bottom}`);
    let result = null;
    let slumped = [];
    for (let game = 0; game < 4 && result !== 'lost'; game += 1) {
      for (let move = 0; move < 5; move += 1) {
        const board = await readBoard(page);
        const text = await page.locator('[data-dock-window="arcade"]').innerText();
        if (/O WINS|YOU WIN|DRAW/.test(text) || board.every((cell) => cell !== null)) break;
        const cell = losingMove(board);
        const reacting = motionsOver(page, 2600);
        await page.locator(`button[aria-label^="Cell ${cell + 1},"]`).click();
        await page.mouse.move(700, 300);
        slumped = await reacting;
      }
      const text = await page.locator('[data-dock-window="arcade"]').innerText();
      result = /O WINS/.test(text) ? 'lost' : /YOU WIN/.test(text) ? 'won' : 'drawn';
      if (result !== 'lost') {
        // A draw (or, somehow, a win): another game.
        const again = page.locator('[data-dock-window="arcade"]').getByRole('button', { name: /REMATCH|AGAIN|NEW GAME/i }).first();
        if ((await again.count()) > 0) await again.click();
        else break;
        await sleep(600);
      }
    }
    assert.equal(result, 'lost', 'the game was lost on purpose');
    assert.ok(slumped.includes('slump'), `it slumps at the loss (saw ${slumped.join(' ')})`);
    pass(`the game lost: it slumps (${slumped.join(', ')})`);
    await page.locator('[data-dock-window="arcade"]').getByRole('button', { name: /^Close / }).click();

    console.log('A video');
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.waitForFunction(() => document.querySelector('button[aria-label^="Play"]') !== null, null, { timeout: 45000 });
    const row = page.locator('li').filter({ hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first();
    await row.locator('button[aria-label^="Play"]').first().click();
    await page.waitForSelector('[data-floating-player] iframe', { timeout: 20000 });
    await page.mouse.move(700, 300);
    const viewing = await waitFor(page, (now) => now.motion === 'watch', 6000);
    assert.ok(viewing, 'with a video up it sits and watches');
    assert.ok(viewing.inView, `in view (under ${viewing.under})`);
    const player = await page.evaluate(() => {
      const box = document.querySelector('[data-floating-player]').getBoundingClientRect();
      return box.left + box.width / 2;
    });
    assert.equal(viewing.facing, player >= viewing.left + viewing.w / 2 ? 'right' : 'left', 'facing the video');
    await page.screenshot({ path: join(SHOTS, 'companion-video.png') });
    await closeUp(page, 'video');
    pass(`a video playing: it sits and watches, facing it (${viewing.facing})`);

    console.log('A book');
    await page.goto(`${BASE}/read/${BOOK}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.waitForSelector('[data-reader-percent]', { timeout: 90000 });
    // A book A has already started asks where to open it: from where it was.
    const where = page.getByRole('dialog', { name: 'Where to open the book' });
    if (await where.isVisible().catch(() => false)) await where.getByRole('button').first().click();
    await page.mouse.move(700, 300);
    const reading = await waitFor(page, (now) => now.motion === 'read', 8000);
    if (reading === null) console.log(`  (it is: ${JSON.stringify(await page.evaluate(readOwn))})`);
    assert.ok(reading, 'with a book open it sits and reads along');
    assert.equal(reading.book, true, 'its book (an art slot) is on its lap');
    assert.match(reading.bookSlot ?? '', /companion-book\.gif/, "the slot points at Luke's drawing, not at anything drawn by code");
    assert.ok(reading.inView, `in view (under ${reading.under})`);
    await page.screenshot({ path: join(SHOTS, 'companion-reading.png') });
    await closeUp(page, 'reading');
    pass('a book open at /read: it sits and reads along, the book slot on its lap');
    // The reader's own keys and seek bar run along the foot of the screen, under its strip: sitting over one, it lets a
    // press through to it. Led by the pointer to each end and the middle of the bar, a second for it to notice, then looked at.
    const spots = [];
    for (let hop = 0; hop < 3; hop += 1) {
      const from = await page.evaluate(readOwn);
      const spot = from.left > 720 ? from.left - 240 : from.left + 300;
      await page.mouse.move(spot, reading.bottom - 30, { steps: 3 });
      await sleep(5000);
      // Up into the book's own page, whose moves the companion cannot hear: it lets the pointer be, and sits back down.
      await page.mouse.move(700, 300);
      const sat = await waitFor(page, (now) => now.motion === 'read', 12000);
      if (sat === null) console.log(`  (led to ${spot}, it is: ${JSON.stringify(await page.evaluate(readOwn))})`);
      assert.ok(sat, 'it sits to read again where the pointer led it');
      await sleep(900);
      const there = await page.evaluate(readOwn);
      assert.deepEqual(there.covers, [], `sitting at ${there.left}, it blocks a press on ${there.covers.join(', ')}`);
      spots.push(there.left);
    }
    pass(`sitting over the reader's page keys and seek bar (at ${spots.join(', ')}), it lets every press through to them`);
    const turning = motionsOver(page, 1800);
    await page.keyboard.press('ArrowRight');
    const turned = await turning;
    assert.ok(turned.includes('flick'), `its head flicks at the page turn (saw ${turned.join(' ')})`);
    const back = await waitFor(page, (now) => now.motion === 'read', 3000);
    assert.ok(back, 'and it reads on');
    pass(`a page turned: ${turned.join(', ')}`);
    await context.close();

    console.log(`\n${passed} passed. Screenshots in ${SHOTS}/companion-*.png`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
