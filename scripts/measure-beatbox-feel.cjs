/*
 * How quick the beat box feels: the time from a press to the change being on screen, in a real browser, on a slowed machine as well
 * as a fast one. Not a check, since timings vary by machine; run it by hand before and after a change and compare:
 *   node scripts/measure-beatbox-feel.cjs --url https://debaser-site.vercel.app --out Temp/browse/bb-feel-before.json
 * A person holds a mouse button for about 80ms, so the mouse is driven that way: a note that waits for the button to come up shows it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const argument = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const BASE = argument('--url', 'https://debaser-site.vercel.app');
const OUT = argument('--out', null);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((file) => fs.existsSync(file));
const HOLD_MS = 80;
const TIMES = 24;
const NOTES = '[role="grid"][aria-label^="Notes"]';
const BARS = '[role="grid"][aria-label^="Bars"]';

// Keeps a stamp for each press, and for the moment after it that the page changed and then painted.
const watch = () => {
  window.__feel = { press: 0, changed: [], painted: [] };
  const stamp = () => {
    window.__feel.press = performance.now();
    window.__feel.waiting = true;
  };
  addEventListener('pointerdown', stamp, true);
  addEventListener('keydown', stamp, true);
  const observer = new MutationObserver(() => {
    const feel = window.__feel;
    if (!feel.waiting) return;
    feel.waiting = false;
    const press = feel.press;
    feel.changed.push(performance.now() - press);
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => feel.painted.push(performance.now() - press);
      channel.port2.postMessage(0);
    });
  });
  observer.observe(document.querySelector('.debaser-beatbox'), { subtree: true, attributes: true, childList: true, attributeFilter: ['aria-selected', 'tabindex', 'style', 'class'] });
};

const summary = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return { times: sorted.length, typical: Math.round(sorted[Math.floor(sorted.length / 2)]), worst: Math.round(sorted[sorted.length - 1]) };
};

const take = (page) => page.evaluate(() => {
  const { changed, painted } = window.__feel;
  window.__feel.changed = [];
  window.__feel.painted = [];
  window.__feel.waiting = false;
  return { changed, painted };
});

async function measure(browser, throttle) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/beatbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(NOTES, { timeout: 120000 });
  await page.waitForTimeout(1000);
  // Signed out, a "HAD AN ACCOUNT?" window comes first.
  const notNow = page.getByRole('button', { name: '[ NOT NOW ]' });
  await notNow.waitFor({ timeout: 2500 }).catch(() => {});
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(watch);
  const results = {};
  const record = async (name) => {
    await page.waitForTimeout(120);
    const { painted } = await take(page);
    results[name] = summary(painted);
  };
  const quiet = async () => {
    await page.waitForTimeout(60);
    await page.evaluate(() => { window.__feel.waiting = false; });
  };

  // Placing a note with the mouse, and taking it away again: each press timed.
  const cells = () => page.locator(`${NOTES} [role="gridcell"]`);
  // Only squares in view, since the canvas draws a few past its edges. It takes the ones it needs, spread out.
  const boxes = await page.evaluate(({ notes, times }) => {
    const view = document.querySelector(notes).parentElement.getBoundingClientRect();
    const all = [...document.querySelectorAll(`${notes} [role="gridcell"]`)].map((cell) => cell.getBoundingClientRect()).filter((box) => box.top >= view.top + 40 && box.bottom <= view.bottom && box.left >= view.left && box.right <= view.right);
    return Array.from({ length: times }, (_, index) => {
      const box = all[Math.floor((index * all.length) / times)];
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
  }, { notes: NOTES, times: TIMES });
  for (const box of boxes) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await quiet();
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  await record('mouse: press to note showing');

  // The keyboard's way.
  await page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`).focus();
  await quiet();
  for (let i = 0; i < TIMES; i += 1) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
  }
  await record('keyboard: Enter to note showing');
  for (let i = 0; i < TIMES; i += 1) {
    await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(60);
  }
  await record('keyboard: arrow to cursor moved');

  // Picking a bar.
  const bars = page.locator(`${BARS} [role="gridcell"]`);
  const barBoxes = [];
  for (let i = 0; i < 8; i += 1) barBoxes.push(await bars.nth(i).boundingBox());
  for (let i = 0; i < TIMES; i += 1) {
    const box = barBoxes[i % 8];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await quiet();
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  await record('mouse: press to bar picked');

  // Moving a window: each small move of the mouse.
  await page.locator('[data-window-key="sounds"]').click();
  await page.waitForTimeout(200);
  const title = await page.getByRole('button', { name: /^Move the Sounds window/ }).boundingBox();
  await page.mouse.move(title.x + 40, title.y + title.height / 2);
  await page.mouse.down();
  await quiet();
  const moves = [];
  for (let i = 0; i < TIMES; i += 1) {
    const stamp = await page.evaluate(() => { window.__feel.waiting = false; window.__feel.press = performance.now(); window.__feel.waiting = true; });
    void stamp;
    await page.mouse.move(title.x + 40 + i * 6, title.y + title.height / 2 + (i % 2) * 6);
    await page.waitForTimeout(40);
    moves.push(i);
  }
  await page.mouse.up();
  await record('mouse: window follows the pointer');

  await context.close();
  return results;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const results = {};
  for (const throttle of [1, 4]) {
    results[throttle === 1 ? 'this machine' : 'a machine four times slower'] = await measure(browser, throttle);
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ url: BASE, at: new Date().toISOString(), results }, null, 1));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
