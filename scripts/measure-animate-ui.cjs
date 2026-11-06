/**
 * ANIMATE's interface against SPEC-animate-ui.md's acceptance tests, in numbers: how much of the window the sheet gets, how many keys are on screen, and how many
 * presses a 6-frame bouncing ball takes. The same on any layout, so before and after can be compared.
 *
 *     node scripts/measure-animate-ui.cjs --url http://localhost:3001/animate [--out Temp/browse/animate-ui] [--name before]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const URL_ = arg('url', 'http://localhost:3001/animate');
const OUT = arg('out', 'Temp/browse/animate-ui');
const NAME = arg('name', 'layout');
const SIZES = [
  [1280, 900],
  [1920, 1080],
];

/** A short pen stroke through sheet coordinates. */
async function pen(page, points) {
  await page.evaluate(async (pts) => {
    const engine = window.__animate;
    const root = document.querySelector('[data-animate-stage]');
    const box = root.getBoundingClientRect();
    const m = engine.viewMatrix(false);
    const at = ([x, y]) => {
      const p = m.transformPoint(new DOMPoint(x, y));
      return { clientX: box.left + p.x, clientY: box.top + p.y };
    };
    const fire = (type, pt) => root.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: pt[2] ?? 0.6, ...at(pt) }));
    const real = root.setPointerCapture;
    root.setPointerCapture = () => undefined;
    fire('pointerdown', pts[0]);
    for (const pt of pts.slice(1)) {
      await new Promise((r) => setTimeout(r, 4));
      fire('pointermove', pt);
    }
    fire('pointerup', pts[pts.length - 1]);
    root.setPointerCapture = real;
  }, points);
}

/** A ball, as a circle of ink: enough to see on a screenshot. */
const circle = (cx, cy, r) => Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 39) * 6.283) * r, cy + Math.sin((i / 39) * 6.283) * r, 0.8]);

/** What the bounce's six frames draw. */
const BALL = [
  [400, 200],
  [600, 420],
  [800, 760],
  [1000, 880],
  [1200, 520],
  [1400, 300],
];

async function measure(page) {
  return page.evaluate(() => {
    const engine = window.__animate;
    const stage = document.querySelector('[data-animate-stage]').getBoundingClientRect();
    const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const studio = document.querySelector('[aria-label="Animation studio"]');
    let studioKeys = 0;
    let siteKeys = 0;
    let frameKeys = 0;
    let smallest = 999;
    const names = [];
    for (const el of document.querySelectorAll('button, a[href], input:not(.sr-only), select, [role="button"]')) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || el.closest('nextjs-portal')) continue;
      const r = el.getBoundingClientRect();
      if (!inView(r) || r.width < 2) continue;
      if (el.closest('[data-animate-cel]') || el.closest('[data-animate-frame-key]')) {
        frameKeys += 1;
        continue;
      }
      if (studio.contains(el)) {
        studioKeys += 1;
        names.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24));
        smallest = Math.min(smallest, Number.parseFloat(style.fontSize) * (Number.parseFloat(el.closest('[style*="zoom"]')?.style.zoom || 1) || 1));
      } else {
        siteKeys += 1;
      }
    }
    return {
      stageShareOfWindowHeight: Math.round((stage.height / innerHeight) * 100),
      stageShareOfWindowWidth: Math.round((stage.width / innerWidth) * 100),
      sheetHeightPx: Math.round(engine.project.height * engine.view.zoom),
      sheetShareOfWindowHeight: Math.round(((engine.project.height * engine.view.zoom) / innerHeight) * 100),
      zoomPercent: Math.round(engine.view.zoom * 100),
      studioKeys,
      siteKeys,
      frameKeys,
      smallestKeyTextPx: smallest,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      names,
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'animate-measure-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 900 }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__animate?.stage != null, null, { timeout: 180000 });
  await page.waitForTimeout(600);

  const results = {};
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__animate.fitView());
    await page.waitForTimeout(200);
    results[`${w}x${h}`] = await measure(page);
  }

  // A drawing to look at: the ball on six frames, a second layer, and the onion on.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__animate.setBrushValue('ink', { stabiliser: 0 }));
  await page.keyboard.press('i');
  for (let f = 0; f < BALL.length; f += 1) {
    await page.evaluate((frame) => window.__animate.goToFrame(frame), f);
    await pen(page, circle(BALL[f][0], BALL[f][1], 90));
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.__animate.goToFrame(2));
  await page.keyboard.press('o');
  await page.waitForTimeout(300);

  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__animate.fitView());
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${NAME}-${w}x${h}.png`) });
  }

  // What he'd see on the way through: the tools at the pen, the layers out, and full screen. Only on a layout that has them.
  const hasPopup = await page.evaluate(() => document.querySelector('[data-animate-tools-key]') !== null);
  if (hasPopup) {
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__animate.fitView());
      const box = await page.locator('[data-animate-stage]').boundingBox();
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.35, { button: 'right' });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, `${NAME}-tools-${w}x${h}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.keyboard.press('l');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${NAME}-layers-1920x1080.png`) });
    await page.keyboard.press('l');
    await page.keyboard.press('`');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${NAME}-full-1920x1080.png`) });
    await page.keyboard.press('`');
  }

  // The acceptance test's bouncing ball, done for real with the mouse alone, counting every press. Six frames, a tool change, a new layer, the onion, play.
  if (hasPopup) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__animate.newProject());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__animate.setBrushValue('ink', { stabiliser: 0 }));
    let presses = 0;
    const tools = async (word) => {
      const box = await page.locator('[data-animate-stage]').boundingBox();
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.3, { button: 'right' });
      presses += 1;
      await page.waitForTimeout(120);
      await page.locator('[data-animate-popup]').getByRole('button', { name: word, exact: true }).click();
      presses += 1;
      await page.waitForTimeout(120);
    };
    const stepOn = async (frame) => {
      // A frame on the timeline: the ruler, or the time sheet's numbers.
      const ruler = page.locator('[data-animate-ruler]');
      if ((await ruler.count()) > 0) {
        const box = await ruler.boundingBox();
        await page.mouse.click(box.x + frame * 24 + 12, box.y + box.height / 2);
      } else {
        await page.getByRole('button', { name: `Go to frame ${frame + 1}`, exact: true }).click();
      }
      presses += 1;
      await page.waitForTimeout(80);
    };
    for (let f = 0; f < 6; f += 1) {
      if (f > 0) await stepOn(f);
      await pen(page, circle(BALL[f][0], BALL[f][1], 90));
      await page.waitForTimeout(60);
    }
    await tools('FLAT');
    await tools('NEW LAYER');
    await tools('ONION ON');
    await page.getByRole('button', { name: '[ PLAY ]' }).click();
    presses += 1;
    await page.waitForTimeout(500);
    const ran = await page.evaluate(() => {
      const engine = window.__animate;
      return { drawings: Object.keys(engine.project.drawings).length, layers: engine.project.nodes.length, onion: engine.project.onion.on, tool: document.querySelector('[data-animate-status]')?.textContent ?? '' };
    });
    await page.keyboard.press('Enter');
    results.bounce = { presses, ...ran };
    console.log(`${NAME} bounce: ${presses} presses with the mouse, ${ran.drawings} drawings, ${ran.layers} layers, onion ${ran.onion}`);
  }

  fs.writeFileSync(path.join(OUT, `${NAME}.json`), JSON.stringify(results, null, 2));
  for (const [size, r] of Object.entries(results)) {
    if (size === 'bounce') continue;
    console.log(`${NAME} ${size}: stage ${r.stageShareOfWindowHeight}% of window height, sheet ${r.sheetShareOfWindowHeight}% (zoom ${r.zoomPercent}%), studio keys ${r.studioKeys}, site keys ${r.siteKeys}, smallest key text ${r.smallestKeyTextPx}px, sideways ${r.sideways}px`);
  }
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
