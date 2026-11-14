/*
 * The site window's fullscreen key, in a real browser, signed out. It needs a running site, so the suite leaves it out; run it by hand:
 *   node Temp/check-full-window-ui.cjs --url http://localhost:3210
 *   node Temp/check-full-window-ui.cjs --url https://debaser-site.vercel.app
 * It posts nothing and saves nothing but the choice itself, in its own throwaway browser.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const argument = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const BASE = argument('--url', 'http://localhost:3210');
const OUT = argument('--out', path.join(__dirname, 'browse', 'full-window'));
fs.mkdirSync(OUT, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((file) => fs.existsSync(file));
const KEY = '[data-full-window-key]';
const STORE = 'debaser.shell.fill.v1';
const results = [];

async function passThePopUp(page) {
  const notNow = page.getByRole('button', { name: '[ NOT NOW ]' });
  await notNow.waitFor({ timeout: 2500 }).catch(() => {});
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
    await page.waitForTimeout(100);
  }
}

async function go(page, where) {
  await page.goto(`${BASE}${where}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 120000 });
  await page.waitForTimeout(700);
  await passThePopUp(page);
}

const frame = (page) => page.evaluate(() => {
  const box = document.querySelector('main > .frame').getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
});
const isFilled = async (page) => {
  const box = await frame(page);
  const width = page.viewportSize().width;
  return box.width >= width - 1;
};
const keyBox = (page) => page.locator(KEY).boundingBox();
const stored = (page) => page.evaluate((key) => localStorage.getItem(key), STORE);

async function test(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, why: error.message.split('\n').slice(0, 4).join(' ').slice(0, 400) });
  }
  const last = results[results.length - 1];
  console.log(`${last.ok ? 'PASS' : 'FAIL'}  ${last.name}${last.why ? `\n      ${last.why}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
  const fresh = async (width = 1440, height = 900, extra = {}) => {
    const context = await browser.newContext({ viewport: { width, height }, ...extra });
    return { context, page: await context.newPage() };
  };

  // Changed on purpose 2026-11-14 (Luke: "the 'fill in the window' button in the top right is pretty buggy and not very obvious so fix
  // that"). The key was four corner characters, in the title line when normal and in the top bar when filled, and filling folded the
  // side panel. It is now one worded key at the far end of the top bar in both states, and it changes the window's size only.
  await test('the key: one worded key at the far end of the top bar, a full tap target; it fills, and collapses from the same bar', async () => {
    const { context, page } = await fresh();
    await go(page, '/forum');
    assert.equal(await isFilled(page), false, 'normal to begin with');
    const key = page.locator(KEY);
    assert.equal(await key.count(), 1, 'one key');
    assert.equal(await key.getAttribute('aria-label'), 'Fill window');
    assert.equal(await key.getAttribute('aria-pressed'), 'false');
    assert.equal((await key.innerText()).trim(), '[ FILL WINDOW ]', 'it says what a press will do');
    assert.equal(await page.locator(`nav[aria-label="Modules"] ${KEY}`).count(), 1, 'it sits in the top bar');
    const before = await frame(page);
    const box = await keyBox(page);
    assert.ok(box.width >= 44 && box.height >= 44, `a full target: ${box.width}x${box.height}`);
    assert.ok(box.x + box.width <= before.right + 1 && before.right - (box.x + box.width) < 24, 'at the right of the window');
    assert.ok(box.y - before.y < 60, 'in the bar at the top of it');
    const panelBefore = await page.locator('aside').count();
    assert.equal(panelBefore, 1, 'the side panel is open to begin with');
    await page.screenshot({ path: path.join(OUT, 'normal-1440.png') });
    await key.click();
    await page.waitForTimeout(150);
    assert.equal(await isFilled(page), true, 'it fills');
    assert.equal(await stored(page), 'on');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-site-fill')), 'on', 'and marks the page');
    const after = await frame(page);
    const on = await keyBox(page);
    assert.equal(await page.locator(KEY).getAttribute('aria-label'), 'Shrink window');
    assert.equal(await page.locator(KEY).getAttribute('aria-pressed'), 'true');
    assert.equal((await page.locator(KEY).innerText()).trim(), '[ SHRINK WINDOW ]', 'and now says how to get back');
    assert.equal(await page.locator(`nav[aria-label="Modules"] ${KEY}`).count(), 1, 'still in the top bar');
    assert.ok(on.x + on.width <= after.right + 1 && after.right - (on.x + on.width) < 24, 'still at the right');
    assert.ok(on.y - after.y < 16, 'at the very top now: the title line has stood aside');
    assert.ok(on.width >= 44 && on.height >= 44);
    assert.equal(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), KEY), true, 'the cursor stays on the key');
    assert.equal(await page.locator('aside').count(), panelBefore, 'the side panel stays as it was: the key changes the size of the window and nothing else');
    await page.screenshot({ path: path.join(OUT, 'filled-1440.png') });
    await page.locator(KEY).click();
    await page.waitForTimeout(150);
    assert.equal(await isFilled(page), false, 'and collapses');
    assert.equal(await stored(page), null);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-site-fill')), null, 'the mark is gone');
    // By the keyboard: Enter on the key, and the cursor stays on it both ways.
    await page.locator(KEY).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal(await isFilled(page), true, 'Enter fills');
    assert.equal(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), KEY), true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal(await isFilled(page), false, 'Enter again collapses');
    await context.close();
  });

  await test('it stays on across pages and a reload, until collapsed; a reload paints it filled from the first frame', async () => {
    const { context, page } = await fresh();
    await go(page, '/forum');
    await page.locator(KEY).click();
    await page.waitForTimeout(100);
    // (2026-11-14) MEDIA, not PROJECTS: PROJECTS left the first-visit bar that day.
    await page.getByRole('link', { name: 'MEDIA' }).first().click();
    await page.waitForURL(/\/media/, { timeout: 60000 });
    await page.waitForTimeout(500);
    assert.equal(await isFilled(page), true, 'on another page');
    // The fault this holds (measured before the fix: 1280px wide at 118ms, 1440px at 315ms): the server's normal-sized window was
    // painted first and jumped to full size once the script had loaded. Every frame of a reload is sampled; none may be narrower.
    await context.addInitScript(() => {
      window.__frameWidths = [];
      const tick = () => {
        const element = document.querySelector('main > .frame');
        if (element) window.__frameWidths.push(Math.round(element.getBoundingClientRect().width));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await passThePopUp(page);
    assert.equal(await isFilled(page), true, 'after a reload');
    const widths = await page.evaluate(() => window.__frameWidths);
    const narrowest = Math.min(...widths);
    assert.ok(widths.length > 10, `sampled ${widths.length} frames`);
    assert.ok(narrowest >= page.viewportSize().width - 1, `filled from the first frame: the narrowest frame drawn was ${narrowest}px of ${page.viewportSize().width}`);
    assert.equal((await page.locator(KEY).innerText()).trim(), '[ SHRINK WINDOW ]');
    for (const where of ['/media', '/users', '/stream', '/projects', '/files']) {
      await go(page, where);
      assert.equal(await isFilled(page), true, `on ${where}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no sideways scroll on ${where}`);
      await page.screenshot({ path: path.join(OUT, `filled${where.replace('/', '-')}.png`) });
    }
    await context.close();
  });

  await test("a page that fills by itself hands back on leaving: normal if that's what was chosen, filled if that was", async () => {
    const { context, page } = await fresh();
    await go(page, '/forum');
    assert.equal(await isFilled(page), false);
    for (const tool of ['/beatbox', '/animate']) {
      await go(page, tool);
      assert.equal(await isFilled(page), true, `${tool} fills by itself`);
      assert.equal(await page.locator(KEY).count(), 0, 'with no key to press there');
      assert.equal(await stored(page), null, 'and nothing written down');
      await page.getByRole('link', { name: 'FORUM' }).first().click();
      await page.waitForURL(/\/forum/, { timeout: 60000 });
      await page.waitForTimeout(500);
      assert.equal(await isFilled(page), false, `out of ${tool}: normal`);
    }
    await page.locator(KEY).click();
    await page.waitForTimeout(100);
    await go(page, '/beatbox');
    await page.getByRole('link', { name: 'FORUM' }).first().click();
    await page.waitForURL(/\/forum/, { timeout: 60000 });
    await page.waitForTimeout(500);
    assert.equal(await isFilled(page), true, 'chosen before going in: still filled coming out');
    assert.equal(await stored(page), 'on');
    await page.locator(KEY).click();
    await page.waitForTimeout(100);
    assert.equal(await isFilled(page), false);
    await context.close();
  });

  await test('it leaves room for the music bar and works with what floats over the window', async () => {
    const { context, page } = await fresh();
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // The lost-account window, centred and in front, with the window filled behind it.
    await page.evaluate((key) => localStorage.setItem(key, 'on'), STORE);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const notNow = page.getByRole('button', { name: '[ NOT NOW ]' });
    if (await notNow.isVisible().catch(() => false)) {
      const box = await notNow.boundingBox();
      const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      assert.match(under ?? '', /NOT NOW/, 'the pop-up is in front');
      await page.screenshot({ path: path.join(OUT, 'filled-with-popup.png') });
      await notNow.click();
      await page.waitForTimeout(100);
    }
    assert.equal(await isFilled(page), true);
    const box = await frame(page);
    assert.ok(box.bottom <= page.viewportSize().height + 1, 'the window stays on the screen');
    const player = await page.getByText(/PLAYER/).first().boundingBox();
    assert.ok(player && box.bottom <= player.y + 12, `the music bar is below the window: ${box.bottom} and ${player?.y}`);
    // The windows that open over the desktop: the arcade, by its address, and the modules list.
    await go(page, '/forum?arcade=1');
    const arcade = page.getByText('TIC-TAC-TOE').first();
    await arcade.waitFor({ timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, 'filled-arcade.png') });
    const arcadeBox = await arcade.boundingBox().catch(() => null);
    assert.ok(arcadeBox && arcadeBox.y >= 0 && arcadeBox.y < page.viewportSize().height, 'the arcade opens in view');
    await context.close();
    const second = await fresh();
    await go(second.page, '/forum');
    await second.page.locator(KEY).click();
    await second.page.waitForTimeout(100);
    await second.page.getByRole('button', { name: 'MODULOS' }).click();
    await second.page.waitForTimeout(200);
    await second.page.screenshot({ path: path.join(OUT, 'filled-modules.png') });
    assert.ok(await second.page.getByRole('button', { name: 'MODULOS' }).first().getAttribute('aria-expanded') === 'true', 'the modules list opens');
    await second.context.close();
  });

  await test('narrow and phone: nothing breaks, and on a phone (which gets the zoomed-out desktop) the key is there', async () => {
    const { context, page } = await fresh(390, 844);
    await go(page, '/forum');
    assert.equal(await page.locator(KEY).first().isVisible(), false, 'a narrow window has no room for it to do anything');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no sideways scroll');
    await page.screenshot({ path: path.join(OUT, 'narrow-390.png') });
    await context.close();
    const phone = await fresh(390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await go(phone.page, '/forum');
    await phone.page.screenshot({ path: path.join(OUT, 'phone-normal.png') });
    await phone.page.locator(KEY).tap();
    await phone.page.waitForTimeout(200);
    await phone.page.screenshot({ path: path.join(OUT, 'phone-filled.png') });
    assert.equal(await phone.page.locator(KEY).getAttribute('aria-pressed'), 'true', 'it works by touch');
    await phone.context.close();
  });

  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed against ${BASE}`);
  if (failed.length > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
