/*
 * STARFIELD's PRESS A STAR in a real browser (SPEC-backgrounds.md; Luke, 2026-11-28: "make it so that clicking on individual
 * stars interacts with them in a few different ways that are selectable in the settings"). What the arithmetic does per mode is
 * held by `Temp/check-starfield-play.cjs`; this is what only a browser can show. Not in `npm run checks`: it needs a running
 * site.
 *
 *   node scripts/drive-starfield-play.cjs --base http://localhost:3217 [--shots]
 *
 * For a local dev server on mock data only. It signs nobody in and nothing may reach the live database. Held here:
 *   1. each mode chosen in the settings window, a real star pressed on the bare desk: the picture changes there and (NUDGE,
 *      LASER, PULL, TIE) comes back dot for dot; THROW moves it with the hand and leaves it somewhere else; BURST breaks it;
 *   2. OFF: a press on a star changes nothing on a still sky (it is hyperspace, as before) and one press on empty sky is
 *      hyperspace; with a mode on one press on empty sky does nothing, two drags nothing, two quick presses hyperspace,
 *      selecting no text;
 *   3. in front of the background: a press on the window leaves the stars alone, links, buttons and a text field work, a
 *      settings window still drags by its title, a right click does nothing; a drag from the sky selects no text and moves
 *      no window;
 *   4. the ready-made looks, PARTY and MORPH leave the mode as chosen; RESET puts NUDGE back;
 *   5. with the GHOST looping, a held star stays in the real hand and is let go when the hand lets go;
 *   6. reduced motion: a press changes nothing. 1366x768: the settings sheet needs no scrolling. 390 wide: no sideways scroll.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3217';
const SHOTS = args.includes('--shots') ? join('Temp', 'browse', 'starfield-play') : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WINDOW = '[data-dock-window="aquarium"]';
const MODES = ['nudge', 'laser', 'throw', 'pull', 'burst', 'tie'];
const ALL = [...MODES, 'off'];
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

async function open(browser, { width = 1920, height = 1080, storage = {}, motion } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
  await context.addInitScript((kept) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        for (const [key, value] of Object.entries(kept)) localStorage.setItem(key, value);
        sessionStorage.setItem('seeded', '1');
      }
    } catch (error) {
      // No storage: the run fails on what it expects next.
    }
  }, { 'debaser.site.backdrop.v2': 'starfield', ...storage });
  // Nothing may reach the live database from here.
  await context.route(/supabase\.co|api\.debaser\.site/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/forum`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.backdrop-canvas', { timeout: 60000 });
  await sleep(2000);
  return { context, page, errors };
}

/* ------------------------------------------------------------------ the settings window */

async function settings(page) {
  await page.evaluate(() => document.querySelector('[data-backdrop-key]').click());
  await page.locator(WINDOW).waitFor({ timeout: 30000 });
  await sleep(400);
}
const closeSettings = async (page) => {
  await page.locator(`${WINDOW} button[aria-label^="Close "]`).first().click();
  await page.locator(WINDOW).waitFor({ state: 'detached', timeout: 10000 });
  await sleep(300);
};
const slide = (page, key, value) => page.locator(`${WINDOW} input[data-backdrop-knob="${key}"]`).fill(String(value));
const modeKey = (page, mode) => page.locator(`${WINDOW} [data-backdrop-knob="touch-${mode}"]`);
const chosen = async (page) => {
  for (const mode of ALL) if ((await modeKey(page, mode).getAttribute('aria-pressed')) === 'true') return mode;
  return null;
};
/** A mode picked in the window; with `still`, the sky stopped too, so that whatever moves was moved by a press. */
async function choose(page, mode, still = true) {
  await settings(page);
  if (still) {
    await slide(page, 'speed', 0);
    await slide(page, 'twinkle', 0);
    await slide(page, 'stars', 300);
  }
  await modeKey(page, mode).click();
  assert.equal(await chosen(page), mode, `${mode} is the key pressed in`);
  await closeSettings(page);
  await sleep(700);
}

/* ------------------------------------------------------------------ reading the sky */

/** The canvas's cells now, kept in the page under a name. */
const keep = (page, name) =>
  page.evaluate((as) => {
    const canvas = document.querySelector('.backdrop-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    window.__kept = window.__kept ?? {};
    window.__kept[as] = { w: canvas.width, h: canvas.height, cells: new Uint32Array(data.buffer.slice(0)) };
  }, name);

/** How many cells differ between two kept pictures: in all, and within `reach` screen pixels of a point. */
const differ = (page, a, b, at = { x: 0, y: 0 }, reach = 0) =>
  page.evaluate(([first, second, point, far]) => {
    const [one, two] = [window.__kept[first], window.__kept[second]];
    const cell = Number(document.querySelector('.backdrop-canvas').dataset.cell);
    let [all, near] = [0, 0];
    for (let i = 0; i < one.cells.length; i += 1) {
      if (one.cells[i] === two.cells[i]) continue;
      all += 1;
      if (Math.hypot((i % one.w) * cell - point.x, Math.floor(i / one.w) * cell - point.y) <= far) near += 1;
    }
    return { all, near };
  }, [a, b, at, reach]);

/**
 * The drawn stars on the bare desk inside a box of screen pixels, the most alone first: where each is, and how far the nearest
 * other one is.
 */
const starsIn = (page, box) =>
  page.evaluate((area) => {
    const canvas = document.querySelector('.backdrop-canvas');
    const cell = Number(canvas.dataset.cell);
    const { width: w, height: h } = canvas;
    const cells = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, w, h).data.buffer);
    const counts = new Map();
    for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    const ground = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const lit = [];
    for (let i = 0; i < cells.length; i += 1) if (cells[i] !== ground) lit.push({ x: i % w, y: Math.floor(i / w) });
    const stars = [];
    for (const dot of lit) {
      const mine = stars.find((star) => Math.abs(star.x - dot.x) <= 3 && Math.abs(star.y - dot.y) <= 3);
      if (mine === undefined) stars.push({ ...dot });
    }
    const at = (star) => ({ x: (star.x + 1) * cell, y: (star.y + 1) * cell });
    const bare = (p) => {
      const el = document.elementFromPoint(p.x, p.y);
      // With the site window put away the empty desk lets the pointer through to the document itself.
      if (document.documentElement.getAttribute('data-site-hidden') === 'on') return el === document.documentElement || el === document.body;
      return el !== null && el.closest('[data-site-window="frame"]') === null && el.closest('[data-site-window="desk"]') !== null && el.closest('button, a, input, [data-dock-window]') === null;
    };
    return stars
      .map((star) => ({ ...at(star), apart: Math.min(...stars.filter((other) => other !== star).map((other) => Math.hypot(other.x - star.x, other.y - star.y) * cell), 999) }))
      .filter((p) => p.x >= area.x && p.x <= area.x + area.width && p.y >= area.y && p.y <= area.y + area.height && bare(p))
      .sort((a, b) => b.apart - a.apart);
  }, box);

/** The bare desk to the left and right of the site window, well clear of its edges and the screen's. */
async function sides(page) {
  const frame = await page.locator('[data-site-window="frame"]').boundingBox();
  const width = page.viewportSize().width;
  return {
    frame,
    left: { x: 50, y: 150, width: frame.x - 100, height: 700 },
    right: { x: frame.x + frame.width + 50, y: 150, width: width - frame.x - frame.width - 100, height: 700 },
  };
}

async function aStar(page) {
  const { left, right } = await sides(page);
  const stars = [...(await starsIn(page, left)), ...(await starsIn(page, right))].sort((a, b) => b.apart - a.apart);
  assert.ok(stars.length > 0, 'a star on the bare desk');
  return stars[0];
}

const shot = async (page, name, at, half = 130) => {
  if (SHOTS === null) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const view = page.viewportSize();
  const clip = at === undefined ? undefined : { x: Math.max(0, Math.min(view.width - half * 2, at.x - half)), y: Math.max(0, Math.min(view.height - half * 2, at.y - half)), width: half * 2, height: half * 2 };
  await page.screenshot({ path: join(SHOTS, `${name}.png`), clip });
};

/* ------------------------------------------------------------------ the run */

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-first-run'] });
  try {
    let { context, page, errors } = await open(browser);
    // The later parts stand alone: one that fails says so and the rest still run, from a fresh page.
    const section = async (name, body) => {
      try {
        await body();
      } catch (failure) {
        console.log(`  FAILED  ${name}: ${failure.message}`);
        process.exitCode = 1;
        await page.mouse.up();
        await page.goto(`${BASE}/forum`, { waitUntil: 'load' });
        await sleep(2000);
      }
    };

    // `--late`: only the pictures, reduced motion and the two small screens.
    const late = args.includes('--late');
    if (!late) {
    console.log('EACH MODE, ON A REAL STAR');
    await settings(page);
    assert.equal(await chosen(page), 'nudge', 'NUDGE as it comes');
    assert.ok((await modeKey(page, 'laser').getAttribute('title')).length > 10, 'the keys have hover words');
    for (const mode of ALL) assert.ok((await modeKey(page, mode).getAttribute('title')).length > 20, `${mode} has hover words`);
    assert.equal(await page.locator(`${WINDOW} [data-backdrop-note="touch"]`).innerText(), 'PRESS EMPTY SKY TWICE: HYPERSPACE', 'the double press is written under the keys');
    await shot(page, 'settings');
    await closeSettings(page);

    for (const mode of ['nudge', 'laser', 'pull']) {
      await choose(page, mode);
      const star = await aStar(page);
      await keep(page, 'before');
      await sleep(300);
      await keep(page, 'rest');
      assert.equal((await differ(page, 'before', 'rest')).all, 0, 'the sky is still before the press');
      // NUDGE is pressed a little to one side, which says which way the shove goes.
      await page.mouse.click(star.x + (mode === 'nudge' ? 8 : 0), star.y);
      await sleep(110);
      await keep(page, 'during');
      await shot(page, `${mode}-1`, star);
      await sleep(150);
      await shot(page, `${mode}-2`, star);
      const during = await differ(page, 'before', 'during', star, 90);
      assert.ok(during.near >= 3, `${mode}: the picture changed round the star (${during.near} cells)`);
      await sleep(mode === 'pull' ? 6000 : 3500);
      await keep(page, 'after');
      assert.equal((await differ(page, 'before', 'after')).all, 0, `${mode}: and a few seconds on it is the same, dot for dot`);
      pass(`${mode.toUpperCase()}: chosen in settings, a star pressed, it moved and came back`);
    }

    await choose(page, 'burst');
    {
      const star = await aStar(page);
      await keep(page, 'before');
      await page.mouse.click(star.x, star.y);
      await sleep(180);
      await keep(page, 'during');
      await shot(page, 'burst-1', star);
      await sleep(200);
      await shot(page, 'burst-2', star);
      assert.ok((await differ(page, 'before', 'during', star, 60)).near >= 5, 'BURST: pieces round where the star was');
      await sleep(2000);
      await keep(page, 'after');
      assert.ok((await differ(page, 'before', 'after', star, 5)).near >= 1, 'the star is gone from its place');
      await sleep(500);
      await keep(page, 'later');
      assert.equal((await differ(page, 'after', 'later')).all, 0, 'and nothing of the pieces is left moving');
      pass('BURST: chosen in settings, a star pressed, it broke into pieces that went out');
    }

    await choose(page, 'tie');
    {
      // Two stars on the same side of the window, well apart.
      const { left, right } = await sides(page);
      let two = null;
      for (const box of [left, right]) {
        const stars = await starsIn(page, box);
        for (const a of stars) for (const b of stars) if (two === null && Math.hypot(a.x - b.x, a.y - b.y) > 90 && Math.hypot(a.x - b.x, a.y - b.y) < 400 && a.apart > 30 && b.apart > 30) two = [a, b];
        if (two !== null) break;
      }
      assert.ok(two !== null, 'two stars apart on one side');
      const [a, b] = two;
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      await keep(page, 'before');
      await page.mouse.click(a.x, a.y);
      await sleep(250);
      await keep(page, 'first');
      assert.ok((await differ(page, 'before', 'first', a, 30)).near >= 3, 'TIE: the first star is marked');
      await page.mouse.click(b.x, b.y);
      await sleep(300);
      await keep(page, 'during');
      await shot(page, 'tie-1', middle, 220);
      await sleep(350);
      await shot(page, 'tie-2', middle, 220);
      assert.ok((await differ(page, 'before', 'during', middle, 30)).near >= 2, 'a thread across the middle');
      await sleep(7000);
      await keep(page, 'after');
      assert.equal((await differ(page, 'before', 'after')).all, 0, 'and some seconds on it is the same, dot for dot');
      pass('TIE: chosen in settings, two stars pressed, tied, let go');
    }

    await choose(page, 'throw');
    {
      const { frame } = await sides(page);
      const star = await aStar(page);
      const inward = star.x < frame.x ? -1 : 1;
      await keep(page, 'before');
      await page.mouse.move(star.x, star.y);
      await page.mouse.down();
      // Taken downward and toward the screen's edge, slowly enough that it stays on the screen.
      for (let k = 1; k <= 8; k += 1) {
        await page.mouse.move(star.x + inward * k * 3, star.y + k * 9);
        await sleep(40);
      }
      const hand = { x: star.x + inward * 24, y: star.y + 72 };
      await sleep(120);
      await keep(page, 'held');
      assert.ok((await differ(page, 'before', 'held', hand, 12)).near >= 1, 'THROW: held, the star is drawn where the hand is');
      assert.ok((await differ(page, 'before', 'held', star, 8)).near >= 1, 'and gone from where it was');
      // One more quick stretch, and let go on the move.
      for (let k = 1; k <= 5; k += 1) {
        await page.mouse.move(hand.x + inward * k * 2, hand.y + k * 12);
        await sleep(33);
      }
      await page.mouse.up();
      const released = { x: hand.x + inward * 10, y: hand.y + 60 };
      await sleep(150);
      await shot(page, 'throw-1', released);
      await sleep(5000);
      await keep(page, 'after');
      await shot(page, 'throw-2', released);
      assert.ok((await differ(page, 'before', 'after', star, 8)).near >= 1, 'it did not go back to where it was');
      await sleep(500);
      await keep(page, 'later');
      assert.equal((await differ(page, 'after', 'later')).all, 0, 'and has come to rest as a star again');
      pass('THROW: held, moved with the hand, let go, flew on and settled');
    }

    console.log('OFF, AND THE EMPTY SKY');
    await choose(page, 'off');
    {
      const star = await aStar(page);
      await keep(page, 'before');
      await page.mouse.click(star.x + 8, star.y);
      await sleep(400);
      await keep(page, 'after');
      // A still sky in hyperspace has no speed to multiply: nothing at all may change.
      assert.equal((await differ(page, 'before', 'after')).all, 0, 'OFF: a star pressed is not touched');
      pass('OFF: a press on a star does nothing to it');
    }
    await sleep(2500);
    for (const mode of ['off', 'laser', 'throw']) {
      await settings(page);
      await slide(page, 'speed', 12);
      await slide(page, 'warp', 20);
      await slide(page, 'stars', 40);
      await modeKey(page, mode).click();
      await closeSettings(page);
      await sleep(2500);
      const { left } = await sides(page);
      // A spot with no star anywhere near it.
      const lit = await starsIn(page, { x: 0, y: 0, width: page.viewportSize().width, height: page.viewportSize().height });
      let empty = null;
      for (let x = left.x; x < left.x + left.width - 60 && empty === null; x += 20) {
        for (let y = left.y; y < left.y + left.height && empty === null; y += 20) if (lit.every((s) => Math.hypot(s.x - x, s.y - y) > 90)) empty = { x, y };
      }
      assert.ok(empty !== null, 'some empty sky');
      const count = () => page.evaluate(() => {
        const canvas = document.querySelector('.backdrop-canvas');
        const cells = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const counts = new Map();
        for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
        return cells.length - Math.max(...counts.values());
      });
      const rushes = async (act) => {
        const before = await count();
        await act();
        await sleep(700);
        const after = await count();
        await sleep(2500);
        return { yes: after > before * 1.4, said: `${before} lit cells, then ${after}` };
      };
      const once = await rushes(() => page.mouse.click(empty.x, empty.y));
      assert.equal(once.yes, mode === 'off', `${mode}: one press on empty sky (${once.said})`);
      if (mode !== 'off') {
        const dragged = await rushes(async () => {
          for (let k = 0; k < 2; k += 1) {
            await page.mouse.move(empty.x, empty.y);
            await page.mouse.down();
            await page.mouse.move(empty.x + 50, empty.y, { steps: 5 });
            await sleep(60);
            await page.mouse.up();
          }
        });
        assert.ok(!dragged.yes, `${mode}: two quick drags are not two presses (${dragged.said})`);
        await page.evaluate(() => window.getSelection().removeAllRanges());
        const twice = await rushes(async () => {
          await page.mouse.click(empty.x, empty.y);
          await sleep(140);
          await page.mouse.down({ clickCount: 2 });
          await sleep(60);
          await page.mouse.up({ clickCount: 2 });
        });
        assert.ok(twice.yes, `${mode}: two quick presses on empty sky are hyperspace (${twice.said})`);
        assert.equal(await page.evaluate(() => window.getSelection().toString()), '', `${mode}: and select no text`);
      }
      pass(mode === 'off' ? 'OFF: one press on empty sky is hyperspace, as before' : `${mode.toUpperCase()}: one miss nothing, drags nothing, a double press hyperspace`);
    }

    console.log('IN FRONT OF THE BACKGROUND');
    await choose(page, 'laser');
    {
      const { frame } = await sides(page);
      await keep(page, 'before');
      await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height - 30);
      await page.mouse.click(frame.x + 6, frame.y + 300);
      await page.mouse.dblclick(frame.x + 6, frame.y + 340);
      await sleep(250);
      await keep(page, 'after');
      assert.equal((await differ(page, 'before', 'after')).all, 0, 'a press on the window leaves the stars alone');
      const star = await aStar(page);
      await page.mouse.click(star.x, star.y, { button: 'right' });
      await sleep(250);
      await keep(page, 'right');
      assert.equal((await differ(page, 'before', 'right')).all, 0, 'a right click on a star does nothing to it');
      await page.keyboard.press('Escape');

      // A text field and a key of the settings window, over the sky.
      await settings(page);
      const speed = page.locator(`${WINDOW} input[data-backdrop-knob="speed"]`);
      await speed.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await speed.inputValue(), '1', 'the keyboard still works a slider');
      await page.keyboard.press('ArrowLeft');
      const title = page.locator(WINDOW);
      const was = await title.boundingBox();
      // Dragged toward the middle of the screen: a window already against an edge can't go further that way.
      const across = was.x + was.width / 2 > page.viewportSize().width / 2 ? -80 : 80;
      await page.mouse.move(was.x + 60, was.y + 12);
      await page.mouse.down();
      await page.mouse.move(was.x + 60 + across, was.y + 60, { steps: 6 });
      await page.mouse.up();
      await sleep(300);
      const now = await title.boundingBox();
      assert.ok(Math.abs(now.x - was.x - across) < 20 && Math.abs(now.y - was.y - 48) < 20, `a window still drags by its title (moved ${Math.round(now.x - was.x)}, ${Math.round(now.y - was.y)})`);
      await closeSettings(page);
      pass('windows in front get their clicks, drags and keys');
    }
    await section('a star dragged', async () => {
      // A drag that starts on a star and runs across the site window: nothing selected, nothing moved.
      await sleep(500);
      const { frame } = await sides(page);
      // Text of the page that can be selected at all (the window's own chrome never can: SiteWindow.tsx), proved by dragging
      // over it before any of this, so that a failure afterwards is the star's doing.
      const places = await page.evaluate(() => {
        const pane = document.querySelector('[data-scroll-pane="page"]');
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        const found = [];
        for (let node = walker.nextNode(); node !== null && found.length < 8; node = walker.nextNode()) {
          const el = node.parentElement;
          if (node.textContent.trim().length < 12 || el.closest('a, button, summary, label, [aria-hidden="true"]') !== null) continue;
          let off = false;
          for (let up = el; up !== null && up !== pane; up = up.parentElement) if (getComputedStyle(up).userSelect === 'none') off = true;
          if (off) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getClientRects()[0];
          if (box && box.width > 80 && box.top > 0 && box.bottom < window.innerHeight && document.elementFromPoint(box.left + 4, box.top + box.height / 2) === el) found.push({ x: box.left + 2, y: box.top + box.height / 2, width: box.width, what: `${el.tagName} "${node.textContent.trim().slice(0, 24)}"` });
        }
        return found;
      });
      const select = async (place) => {
        await page.evaluate(() => {
          window.getSelection().removeAllRanges();
          window.__blocked = null;
          window.addEventListener('selectstart', (event) => setTimeout(() => (window.__blocked = event.defaultPrevented)), { capture: true, once: true });
        });
        await sleep(600);
        await page.mouse.move(place.x, place.y);
        await page.mouse.down();
        await page.mouse.move(place.x + place.width - 6, place.y, { steps: 8 });
        await page.mouse.up();
        const got = await page.evaluate(() => ({ length: window.getSelection().toString().length, blocked: window.__blocked }));
        await page.evaluate(() => window.getSelection().removeAllRanges());
        return got;
      };
      let words = null;
      const tried = [];
      for (const place of places) {
        const got = await select(place);
        tried.push(`${place.what}: ${got.length} chars, blocked ${got.blocked}`);
        if (got.length > 4) {
          words = place;
          break;
        }
      }
      assert.ok(words !== null, `some text of the page selects before the drag (${tried.join('; ') || 'no text found'})`);
      const star = await aStar(page);
      const before = await page.locator('[data-site-window="frame"]').boundingBox();
      await page.mouse.move(star.x, star.y);
      await page.mouse.down();
      await page.mouse.move(frame.x + 400, 400, { steps: 8 });
      await page.mouse.move(frame.x + 700, 600, { steps: 8 });
      const selected = await page.evaluate(() => window.getSelection().toString());
      await page.mouse.up();
      assert.equal(selected, '', 'a drag from the sky selects no text');
      assert.deepEqual(await page.locator('[data-site-window="frame"]').boundingBox(), before, 'and moves no window');
      // And once it is let go, the same text selects as ever.
      const again = await select(words);
      assert.ok(again.length > 4, `text on the page still selects (${again.length} chars, blocked ${again.blocked})`);
      pass('a star dragged selects nothing and moves nothing; text selects as before');
    });
    await section('a link and a text field', async () => {
      // A link of the site, clicked as ever.
      const link = page.locator('[data-site-window="frame"] a[href="/media"]').first();
      await link.click();
      await page.waitForURL('**/media', { timeout: 120000 });
      await sleep(1500);
      const field = page.locator('[data-site-window="frame"] input[type="text"]:visible, [data-site-window="frame"] input[type="search"]:visible, [data-site-window="frame"] input:not([type]):visible').first();
      await field.click();
      await page.keyboard.type('stars');
      assert.equal(await field.inputValue(), 'stars', 'a text field in front takes its click and its typing');
      pass('a link and a text field in front work as before');
      await page.goto(`${BASE}/forum`, { waitUntil: 'load' });
      await sleep(2000);
    });

    console.log('THE MODE IS THE READER`S, NOT THE LOOK`S');
    await section('looks and the reload', async () => {
    await settings(page);
    await modeKey(page, 'throw').click();
    const looks = page.locator(`${WINDOW} [data-backdrop-look]:not([data-backdrop-look="reset"]):not([data-backdrop-look="party"])`);
    const howMany = await looks.count();
    assert.ok(howMany >= 3, `ready-made looks to try (${howMany})`);
    for (let k = 0; k < howMany; k += 1) {
      await looks.nth(k).click();
      assert.equal(await chosen(page), 'throw', 'a look leaves the mode');
    }
    assert.equal(await looks.nth(howMany - 1).getAttribute('aria-pressed'), 'true', 'and still reads as the chosen look');
    await page.locator(`${WINDOW} [data-backdrop-look="party"]`).click();
    assert.equal(await chosen(page), 'throw', 'PARTY leaves the mode');
    const morph = page.locator(`${WINDOW} [data-backdrop-morph]`);
    if ((await morph.count()) > 0) {
      await morph.fill('60');
      assert.equal(await chosen(page), 'throw', 'MORPH leaves the mode');
    }
    await page.locator(`${WINDOW} [data-backdrop-look="reset"]`).click();
    assert.equal(await chosen(page), 'nudge', 'RESET puts NUDGE back');
    await modeKey(page, 'laser').click();
    await closeSettings(page);
    await page.reload({ waitUntil: 'load' });
    await sleep(2500);
    await settings(page);
    assert.equal(await chosen(page), 'laser', 'and the choice is remembered over a reload');
    await closeSettings(page);
    pass('looks, PARTY and MORPH leave it; RESET and a reload do as the other knobs do');
    });

    console.log('THE GHOST, LOOPING');
    await section('the ghost', async () => {
      await choose(page, 'throw');
      await settings(page);
      await page.locator(`${WINDOW} [data-backdrop-ghost]`).click();
      await closeSettings(page);
      for (let k = 0; k < 110; k += 1) {
        await page.mouse.move(800 + 200 * Math.cos(k / 9), 500 + 200 * Math.sin(k / 9));
        await sleep(100);
      }
      await sleep(1600);
      const star = await aStar(page);
      await page.mouse.move(star.x, star.y);
      await page.mouse.down();
      await page.mouse.move(star.x, star.y + 40, { steps: 4 });
      await sleep(2200);
      await keep(page, 'held');
      await sleep(300);
      await keep(page, 'still');
      assert.equal((await differ(page, 'held', 'still')).all, 0, 'held still past the ghost`s wait, the star stays in the hand');
      await page.mouse.up();
      await sleep(5000);
      await keep(page, 'down');
      await sleep(500);
      await keep(page, 'down2');
      assert.equal((await differ(page, 'down', 'down2')).all, 0, 'let go, it is not picked up by the ghost');
      pass('with the GHOST looping, a held star is the hand`s own');
    });
    assert.deepEqual(errors, [], 'no page errors');
    }
    await context.close();

    if (SHOTS !== null) {
      console.log('PICTURES, AS IT COMES (the sky moving)');
      ({ context, page, errors } = await open(browser, { storage: { 'debaser.shell.hidden.v1': 'on' } }));
      for (const mode of MODES) {
        await settings(page);
        await modeKey(page, mode).click();
        await closeSettings(page);
        await sleep(1000);
        const box = { x: 250, y: 200, width: 1400, height: 650 };
        const stars = await starsIn(page, box);
        assert.ok(stars.length > 1, `${mode}: stars on the bare screen with the window put away (${stars.length})`);
        // PULL and TIE need neighbours to show: PULL the most crowded star, TIE two a way apart.
        const close = (s) => stars.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 110).length;
        const star = mode === 'pull' ? [...stars].sort((a, b) => close(b) - close(a))[0] : stars[0];
        if (mode === 'tie') {
          const other = stars.find((o) => Math.hypot(o.x - star.x, o.y - star.y) > 150 && Math.hypot(o.x - star.x, o.y - star.y) < 300) ?? stars[1];
          await page.mouse.click(star.x, star.y);
          await sleep(150);
          // The sky is moving: the second star is found again where it has got to.
          const now = (await starsIn(page, box)).sort((a, b) => Math.hypot(a.x - other.x, a.y - other.y) - Math.hypot(b.x - other.x, b.y - other.y))[0];
          await page.mouse.click(now.x, now.y);
          await sleep(450);
          const middle = { x: (star.x + now.x) / 2, y: (star.y + now.y) / 2 };
          await shot(page, 'moving-tie', middle, 220);
          await shot(page, 'moving-tie-whole');
          await sleep(4000);
        } else if (mode === 'throw') {
          await page.mouse.move(star.x, star.y);
          await page.mouse.down();
          for (let k = 1; k <= 7; k += 1) {
            await page.mouse.move(star.x + k * 16, star.y - k * 10);
            await sleep(33);
          }
          await page.mouse.up();
          await sleep(200);
          await shot(page, 'moving-throw', { x: star.x + 140, y: star.y - 90 }, 190);
          await shot(page, 'moving-throw-whole');
        } else {
          await page.mouse.click(star.x + (mode === 'nudge' ? 8 : 0), star.y);
          await sleep(mode === 'pull' ? 700 : mode === 'burst' ? 200 : 90);
          await shot(page, `moving-${mode}`, star, 190);
          await shot(page, `moving-${mode}-whole`);
        }
        await sleep(3000);
      }
      await context.close();
    }

    console.log('REDUCED MOTION, 1366 AND 390');
    ({ context, page, errors } = await open(browser, { motion: 'reduce' }));
    {
      const star = await aStar(page);
      await keep(page, 'before');
      await page.mouse.click(star.x + 8, star.y);
      await sleep(600);
      await keep(page, 'after');
      assert.equal((await differ(page, 'before', 'after')).all, 0, 'reduced motion: a press moves nothing');
      pass('reduced motion: no new motion');
    }
    await context.close();
    ({ context, page, errors } = await open(browser, { width: 1366, height: 768 }));
    await settings(page);
    const room = await page.evaluate((selector) => {
      const win = document.querySelector(selector);
      return [...win.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)).length;
    }, WINDOW);
    assert.equal(room, 0, '1366x768: the settings sheet needs no scrolling');
    await shot(page, 'settings-1366');
    await closeSettings(page);
    const frame = await page.locator('[data-site-window="frame"]').boundingBox();
    console.log(`      at 1366 wide the bare desk is ${Math.round(frame.x)}px on the left and ${Math.round(1366 - frame.x - frame.width)}px on the right`);
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(1500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 wide: no sideways scroll');
    pass('1366: the sheet fits; 390: no sideways scroll');
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    console.log(`\n${passed} passed`);
  } catch (failure) {
    console.log(`\nFAILED after ${passed} passed: ${failure.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
