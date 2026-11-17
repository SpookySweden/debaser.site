/*
 * SETTINGSUI (Luke, 2026-11-17). On a LOCAL mock dev server only (core.md, "Test locally"): no sign-in, no database; the live
 * database is blocked and the run fails if anything asked it.
 *
 *   node scripts/drive-settings-sheet.cjs --base http://localhost:<port> [--out Temp/browse/settings-sheet] [--theme dark]
 *
 *   1. Each background's settings window (AQUARIUM, SAND, FLUID, STARFIELD, MYSTIFY), opened from its key on the background, on
 *      a 1366 x 768 and a 1920 x 1080 screen: nothing in it scrolls ("ideally i dont want any scrolling to be necessary to see
 *      all the settings"), every section is inside the window, the window is on the screen and clear of the music bar, and
 *      no words in it are under 13px.
 *   2. PREFERENCES, reopened from a layout saved under its old name at the old 384 x 620: it opens taller ("make sure the
 *      prefereances window that shows the site themes ect is taller by default"), within the screen and above the music bar,
 *      and its THEME list shows whole without scrolling (on 1920 x 1080 its BACKGROUND list too).
 *   3. RESET apart from THEME (item 3, Luke: "the "theme" button ... should be a toggle separate to the "reset" button, the
 *      reset button resets according to wether theme is on or off"), each background, under OVERDRIVE EMBER (a theme that
 *      sets and nudges knobs): with THEME on, knobs moved then RESET give back the theme's tuned look and THEME stays on;
 *      with THEME off, knobs moved then RESET give back the plain defaults and THEME stays off.
 *   `--only resets` runs just 3; `--settle 35000` measures 1 after the meters have filled (their strips widen).
 * A picture of each in --out, for reading.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3330');
const OUT = opt('--out', join('Temp', 'browse', 'settings-sheet'));
const THEME = opt('--theme', 'dark');
// How long to let a background run before measuring: its meters' strips widen as they fill (about half a minute).
const SETTLE = Number(opt('--settle', '600'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SCREENS = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
];
const BACKGROUNDS = ['aquarium', 'sand', 'fluid', 'starfield', 'mystify'];
let passed = 0;
let live = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

async function open(browser, screen, seed) {
  const context = await browser.newContext({ viewport: { width: screen.w, height: screen.h } });
  await context.route(/supabase\.(co|in)\//, (route) => {
    live += 1;
    return route.abort();
  });
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('settings-sheet.seeded') !== null) return;
    sessionStorage.setItem('settings-sheet.seeded', '1');
    for (const [key, value] of Object.entries(JSON.parse(s))) localStorage.setItem(key, value);
  }, JSON.stringify(seed));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-backdrop-key]').first().waitFor({ state: 'attached', timeout: 120000 });
  await sleep(1200);
  return { context, page };
}

/** The window's box, its scrolling body, the music bar's top, and (for the settings) every section's box. */
const measure = (page, selector) =>
  page.evaluate((sel) => {
    const win = document.querySelector(sel);
    const body = win.querySelector('.overflow-y-auto');
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const reach = Number.parseFloat(document.documentElement.style.getPropertyValue('--music-top'));
    return {
      win: box(win),
      body: box(body),
      scrollH: body.scrollHeight,
      clientH: body.clientHeight,
      musicTop: innerHeight - (Number.isFinite(reach) ? reach : 0),
      sections: [...win.querySelectorAll('section')].map((s) => ({ name: s.getAttribute('aria-label') ?? s.querySelector('span')?.textContent ?? '?', ...box(s) })),
      // The head line over the sheet ([ THEME ], the theme's name, the meters): one line, or the sheet is pushed down.
      head: (() => { const sheet = win.querySelector('[data-backdrop-sheet]'); return sheet === null ? 0 : sheet.previousElementSibling.getBoundingClientRect().height; })(),
      columns: Number(win.querySelector('[data-backdrop-sheet]')?.dataset.backdropSheet ?? 0),
      // The smallest type any words in the window are set in (docs/design.md: nothing below 13px).
      smallest: Math.min(
        ...[...win.querySelectorAll('*')]
          .filter((el) => [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
          .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
      ),
    };
  }, selector);

async function settings(browser, screen, id) {
  const { context, page } = await open(browser, screen, { 'debaser.site.backdrop.v2': id, 'debaser.site.theme.v2': THEME });
  await page.evaluate(() => document.querySelector('[data-backdrop-key]').click());
  const selector = '[data-dock-window="aquarium"]';
  await page.locator(selector).waitFor({ timeout: 15000 });
  await sleep(SETTLE);
  const m = await measure(page, selector);
  await page.screenshot({ path: join(OUT, `${id}-${screen.w}x${screen.h}-${THEME}.png`) });
  const where = `${id.toUpperCase()} at ${screen.w} x ${screen.h}`;
  assert.ok(m.scrollH <= m.clientH + 1, `${where}: nothing scrolls (holds ${m.scrollH}px in ${m.clientH}px)`);
  assert.ok(m.win.left >= 0 && m.win.right <= screen.w && m.win.top >= 0, `${where}: the window is on the screen ${JSON.stringify(m.win)}`);
  assert.ok(m.win.bottom <= m.musicTop, `${where}: its foot (${m.win.bottom}) clear of the music bar (${m.musicTop})`);
  assert.ok(m.sections.length >= 3, `${where}: its sections are on one sheet (${m.sections.length})`);
  // One line in a three-column window; two in a two-column one, the meters on their own (sheet.ts counts it).
  assert.ok(m.head <= (m.columns < 3 ? 66 : 40), `${where}: the head keeps to its ${m.columns < 3 ? 'two lines' : 'one line'} (${m.head}px)`);
  assert.ok(m.smallest >= 13, `${where}: no words under 13px (smallest ${m.smallest}px)`);
  for (const s of m.sections) assert.ok(s.bottom <= m.body.bottom + 1 && s.right <= m.body.right + 1, `${where}: ${s.name} is inside the window`);
  pass(`${where}: ${m.sections.length} sections, ${Math.round(m.win.right - m.win.left)} x ${Math.round(m.win.bottom - m.win.top)}, nothing scrolls`);
  await context.close();
}

async function preferences(browser, screen) {
  const ratio = screen.w / screen.h;
  const bucket = ratio < 1.45 ? 'tall' : ratio < 1.95 ? 'standard' : 'wide';
  // A returning reader's browser: PREFERENCES saved open under its old name, at the old 384 x 620, in the lower corner.
  const saved = { x: screen.w - 392, y: screen.h - 112 - Math.min(620, Math.round((screen.h - 46) * 0.78)), w: 384, h: Math.min(620, Math.round((screen.h - 46) * 0.78)) };
  const layout = { [bucket]: { screen, windows: { preferences: { rect: saved, group: null, open: true, restore: null } }, order: ['preferences'] } };
  const { context, page } = await open(browser, screen, { 'debaser.site.backdrop.v2': 'aquarium', 'debaser.site.theme.v2': THEME, 'debaser.windows.guest.v1': JSON.stringify(layout) });
  const selector = '[data-dock-window="preferences"]';
  await page.locator(selector).waitFor({ timeout: 15000 });
  await sleep(1500);
  const m = await measure(page, selector);
  await page.screenshot({ path: join(OUT, `preferences-${screen.w}x${screen.h}-${THEME}.png`) });
  const where = `PREFERENCES at ${screen.w} x ${screen.h}`;
  const height = m.win.bottom - m.win.top;
  assert.ok(height > saved.h + 30, `${where}: opens taller than the old ${saved.h}px (${Math.round(height)}px)`);
  assert.ok(m.win.top >= 0 && m.win.bottom <= m.musicTop, `${where}: within the screen and above the music bar (${Math.round(m.win.top)} to ${Math.round(m.win.bottom)}, bar at ${m.musicTop})`);
  // A 768 screen has 602px above the music bar: the whole THEME list (a family's options open) shows there; 1080 shows BACKGROUND too.
  const whole = screen.h >= 1000 ? ['THEME', 'BACKGROUND'] : ['THEME'];
  for (const name of whole) {
    const s = m.sections.find((each) => each.name === name);
    assert.ok(s !== undefined, `${where}: has its ${name} list`);
    assert.ok(s.bottom <= m.body.bottom + 1, `${where}: the whole ${name} list shows without scrolling (its foot ${Math.round(s.bottom)}, the window's ${Math.round(m.body.bottom)})`);
  }
  pass(`${where}: ${Math.round(height)}px tall (was ${saved.h}), ${whole.join(' and ')} whole`);
  await context.close();
}

/** Everything the sheet says a knob is: each slider's place, each key's pressed state, each written value. */
const knobState = (page) =>
  page.evaluate(() => {
    const win = document.querySelector('[data-dock-window="aquarium"]');
    const state = {};
    for (const el of win.querySelectorAll('input[type="range"][data-backdrop-knob]')) state[`slider ${el.dataset.backdropKnob}`] = el.value;
    for (const el of win.querySelectorAll('button[data-backdrop-knob][aria-pressed]')) state[`key ${el.dataset.backdropKnob}`] = el.getAttribute('aria-pressed');
    for (const el of win.querySelectorAll('[data-backdrop-value]')) state[`value ${el.dataset.backdropValue}`] = el.textContent;
    return state;
  });

const themeKey = (page) => page.locator('[data-dock-window="aquarium"] [data-backdrop-knob="theme"]');

/** Moves knobs away from where they are: the first slider that moves to its far end, and the first switch flipped. */
async function moveKnobs(page) {
  const slider = page.locator('[data-dock-window="aquarium"] input[type="range"][data-backdrop-knob]:not([disabled])').first();
  await slider.focus();
  const start = await slider.inputValue();
  await page.keyboard.press('End');
  if ((await slider.inputValue()) === start) await page.keyboard.press('Home');
  const flip = page.locator('[data-dock-window="aquarium"] [role="group"] > button[data-backdrop-knob][aria-pressed]:not([data-backdrop-knob="theme"])').first();
  if ((await flip.count()) > 0) await flip.click();
  await sleep(200);
}

async function resets(browser, id) {
  const screen = { w: 1366, h: 768 };
  const { context, page } = await open(browser, screen, { 'debaser.site.backdrop.v2': id, 'debaser.site.theme.v2': 'overdrive-ember' });
  await page.evaluate(() => document.querySelector('[data-backdrop-key]').click());
  await page.locator('[data-dock-window="aquarium"]').waitFor({ timeout: 15000 });
  await sleep(500);
  const where = `${id.toUpperCase()} RESET`;
  const reset = page.locator('[data-dock-window="aquarium"] [data-backdrop-look="reset"]');

  // THEME on, as it comes: the theme's tuned look.
  assert.equal(await themeKey(page).getAttribute('aria-pressed'), 'true', `${where}: THEME is on as it comes`);
  assert.equal((await themeKey(page).textContent()).trim(), '[ THEME: ON ]', `${where}: and says so`);
  const tuned = await knobState(page);
  await moveKnobs(page);
  assert.notDeepEqual(await knobState(page), tuned, `${where}: the knobs moved (the test means something)`);
  await reset.click();
  await sleep(200);
  assert.equal(await themeKey(page).getAttribute('aria-pressed'), 'true', `${where}: with THEME on, RESET leaves it on`);
  assert.deepEqual(await knobState(page), tuned, `${where}: and gives back the theme's tuned look`);
  await page.screenshot({ path: join(OUT, `reset-${id}-theme-on.png`) });

  // THEME off: the background's own plain defaults.
  await themeKey(page).click();
  await sleep(200);
  assert.equal((await themeKey(page).textContent()).trim(), '[ THEME: OFF ]', `${where}: THEME switched off says so`);
  const [head, columns] = await page.evaluate(() => { const sheet = document.querySelector('[data-backdrop-sheet]'); return [sheet.previousElementSibling.getBoundingClientRect().height, Number(sheet.dataset.backdropSheet)]; });
  assert.ok(head <= (columns < 3 ? 66 : 40), `${where}: with THEME off the head is still one line (${head}px)`);
  const plain = await knobState(page);
  await moveKnobs(page);
  assert.notDeepEqual(await knobState(page), plain, `${where}: the knobs moved again`);
  await reset.click();
  await sleep(200);
  assert.equal(await themeKey(page).getAttribute('aria-pressed'), 'false', `${where}: with THEME off, RESET leaves it off`);
  assert.deepEqual(await knobState(page), plain, `${where}: and gives back the plain defaults`);
  await page.screenshot({ path: join(OUT, `reset-${id}-theme-off.png`) });
  pass(`${where}: THEME on gives the tuned look back, THEME off the plain defaults; THEME never flipped`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--no-first-run'] });
  let failed = 0;
  const run = async (what, step) => {
    try {
      await step();
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${what}: ${error.message.split('\n')[0]}`);
    }
  };
  const only = opt('--only', '');
  if (only !== 'resets') {
    for (const screen of SCREENS) {
      console.log(`${screen.w} x ${screen.h}, ${THEME}`);
      for (const id of BACKGROUNDS) await run(`${id} ${screen.w}`, () => settings(browser, screen, id));
      await run(`preferences ${screen.w}`, () => preferences(browser, screen));
    }
  }
  console.log('RESET apart from THEME, under OVERDRIVE EMBER');
  for (const id of BACKGROUNDS) await run(`${id} reset`, () => resets(browser, id));
  await browser.close();
  if (live > 0) {
    console.log(`  FAIL the live database was asked ${live} times`);
    failed += 1;
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
