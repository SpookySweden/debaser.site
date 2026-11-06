/**
 * ANIMATE in a real browser, with synthetic pen events: what `Temp/check-animate-*.cjs` can't reach (canvases, storage, workers, keys).
 * A live check, run by hand or by the build session against any address:
 *
 *     node scripts/drive-animate.cjs --url http://localhost:3001/animate [--out Temp/browse/animate] [--only phase0,phase1]
 *
 * It drives the page as a person would: pen strokes as pointer events, keys as key presses. It reads results from the canvases and the
 * engine's own state. It never signs in and writes only to the browser profile it starts with, which it throws away.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const URL_ = arg('url', 'http://localhost:3001/animate');
const OUT = arg('out', 'Temp/browse/animate');
const ONLY = arg('only', '');
const HEADED = process.argv.includes('--headed');

let failures = 0;
function pass(name, detail = '') {
  console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
}
function fail(name, detail = '') {
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
}
function check(name, condition, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

/** A pen stroke through sheet coordinates, as real pointer events with pressure, at the page's own canvas. */
async function penStroke(page, points, options = {}) {
  await page.evaluate(
    async ({ points: pts, options: opts }) => {
      const engine = window.__animate;
      const root = document.querySelector('[data-animate-stage]');
      const box = root.getBoundingClientRect();
      const m = engine.viewMatrix(false);
      const toClient = ([x, y]) => {
        const p = m.transformPoint(new DOMPoint(x, y));
        return { clientX: box.left + p.x, clientY: box.top + p.y };
      };
      const fire = (type, pt, extra = {}) =>
        root.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: opts.pointerType ?? 'pen',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : (opts.button ?? 0),
            buttons: type === 'pointerup' ? 0 : (opts.buttons ?? 1),
            pressure: pt[2] ?? 0.5,
            tiltX: pt[3] ?? 0,
            ...toClient(pt),
            ...extra,
          }),
        );
      // setPointerCapture refuses a made-up pointer, so it is let through for this drive.
      const realCapture = root.setPointerCapture;
      root.setPointerCapture = () => undefined;
      fire('pointerdown', pts[0]);
      // Real time passes between a pen's points; the stabiliser works by time.
      for (const pt of pts.slice(1)) {
        await new Promise((resolve) => setTimeout(resolve, opts.gapMs ?? 8));
        fire('pointermove', pt);
      }
      if (opts.end !== 'cancel') fire('pointerup', pts[pts.length - 1]);
      else fire('pointercancel', pts[pts.length - 1]);
      root.setPointerCapture = realCapture;
    },
    { points, options },
  );
}

/** A line of points with pressure rising and falling along it. */
function line(x0, y0, x1, y1, steps = 30) {
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.2 + 0.7 * Math.sin(Math.PI * t)];
  });
}

/** What the finished frame looks like at a sheet point: red, green, blue. */
async function pixel(page, x, y) {
  return page.evaluate(
    ([px, py]) => {
      const engine = window.__animate;
      const hex = engine.pickColour(px, py);
      return hex;
    },
    [x, y],
  );
}

async function state(page, read) {
  return page.evaluate(read);
}

const frameOps = (page) =>
  page.evaluate(() => {
    const engine = window.__animate;
    const project = engine.project;
    return Object.values(project.drawings).reduce((sum, drawing) => sum + drawing.planes.line.length + drawing.planes.colour.length, 0);
  });

async function waitSaved(page) {
  await page.evaluate(() => window.__animate.autosave());
  await page.waitForFunction(() => document.querySelector('[data-animate-save]')?.getAttribute('data-animate-save') === 'saved', null, { timeout: 15000 });
}

const phases = {};

phases.phase0 = async (page, shot) => {
  console.log('Phase 0: Skeleton');
  check('the studio opens', (await page.locator('[data-animate-stage]').count()) === 1);
  check('the nav has one ANIMATE key', (await page.getByRole('link', { name: 'ANIMATE', exact: true }).count()) === 1);

  // Pressure: a heavy stroke is wider than a light one.
  await page.keyboard.press('i');
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [200 + i * 12, 200, 0.15]));
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [200 + i * 12, 300, 1]));
  const widthAt = async (y) => {
    return page.evaluate(
      (yy) => {
        const engine = window.__animate;
        const project = engine.project;
        const cel = project.nodes[0].cels[0];
        const canvas = engine.planes.peek(`${cel.drawingId}.line`);
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(380, yy - 60, 1, 120).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 128) count += 1;
        return count;
      },
      y,
    );
  };
  const light = await widthAt(200);
  const heavy = await widthAt(300);
  check('a heavier pen draws a wider line', heavy > light * 1.5 && light > 0, `light ${light}px, heavy ${heavy}px`);
  check('both strokes kept as data', (await frameOps(page)) === 2);
  const stored = await page.evaluate(() => {
    const engine = window.__animate;
    const project = engine.project;
    const stroke = project.drawings[project.nodes[0].cels[0].drawingId].planes.line[1];
    return { brush: stroke.brush, colour: stroke.colour, n: stroke.points.length, shape: stroke.points[0].length };
  });
  check('a stroke stores points, pressure, brush, colour', stored.brush === 'ink' && stored.n >= 20 && stored.shape === 3, JSON.stringify(stored));

  // Undo and redo, with the keyboard, are exact.
  const before = await pixel(page, 380, 300);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.__animate.history.canRedo);
  await page.waitForTimeout(100);
  const undone = await pixel(page, 380, 300);
  check('undo takes the stroke off', before === '#000000' && undone === '#ffffff', `${before} then ${undone}`);
  check('undo drops it from the data', (await frameOps(page)) === 1);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  check('redo puts it back', (await pixel(page, 380, 300)) === '#000000' && (await frameOps(page)) === 2);

  // A right-click or cancel drops a stroke.
  await penStroke(page, line(200, 500, 800, 500), { end: 'cancel' });
  check('a cancelled stroke leaves nothing', (await frameOps(page)) === 2 && (await pixel(page, 500, 500)) === '#ffffff');

  // The eraser.
  await page.keyboard.press('e');
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [300 + i * 10, 300, 0.9]));
  await page.waitForTimeout(50);
  check('the eraser cuts the line', (await pixel(page, 380, 300)) === '#ffffff');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('undo restores what was erased', (await pixel(page, 380, 300)) === '#000000');

  await page.keyboard.press('i');
  await shot('phase0-desktop');

  // Autosave: reload the tab and the work is back.
  await waitSaved(page);
  const privateFiles = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('animate')).getDirectoryHandle(window.__animate.project.id);
    const names = [];
    for await (const name of dir.keys()) names.push(name);
    return names;
  });
  check("pictures went to the browser's private files, through the worker", privateFiles.some((name) => name.endsWith('.line.png')), privateFiles.join(', '));
  await page.reload();
  await page.waitForFunction(() => window.__animate?.project && document.querySelector('[data-animate-stage]') && window.__animate.project.nodes[0].cels.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  check('a reload brings the work back from the browser', (await pixel(page, 380, 300)) === '#000000' && (await frameOps(page)) >= 2);

  // Save to a file and open it again: same picture.
  const download = page.waitForEvent('download', { timeout: 15000 });
  await page.evaluate(() => {
    delete window.showSaveFilePicker;
    window.showSaveFilePicker = undefined;
  });
  await page.getByRole('button', { name: /SAVE FILE/ }).click();
  const file = await download;
  const fileName = file.suggestedFilename();
  const savedPath = path.join(os.tmpdir(), `animate-${Date.now()}.zip`);
  await file.saveAs(savedPath);
  const size = fs.statSync(savedPath).size;
  check('SAVE FILE gives a zip', fileName.endsWith('.animate.zip') && size > 500, `${fileName}, ${size} bytes`);

  const idBefore = await page.evaluate(() => window.__animate.project.id);
  await page.setInputFiles('#animate-open-file', savedPath);
  await page.waitForFunction((id) => window.__animate.project.id !== id, idBefore, { timeout: 15000 });
  await page.waitForTimeout(800);
  check('OPEN brings the file back as its own project', (await pixel(page, 380, 300)) === '#000000' && (await frameOps(page)) >= 2);
  fs.unlinkSync(savedPath);

  const notAProject = path.join(os.tmpdir(), `animate-bad-${Date.now()}.zip`);
  fs.writeFileSync(notAProject, 'hello');
  await page.setInputFiles('#animate-open-file', notAProject);
  await page.waitForFunction(() => document.querySelector('[data-animate-notice]')?.textContent?.includes('NOT AN ANIMATE'), null, { timeout: 8000 });
  pass('a file that is not a project is refused, in words');
  fs.unlinkSync(notAProject);

  // Bigger interface.
  await page.getByRole('button', { name: 'Interface bigger' }).click();
  await page.getByRole('button', { name: 'Interface bigger' }).click();
  const scale = await page.evaluate(() => window.__animate && JSON.parse(localStorage.getItem('debaser.animate.settings') ?? '{}').uiScale);
  check('the interface can be made bigger', scale === 1.5, `scale ${scale}`);
  await shot('phase0-ui150');
  await page.getByRole('button', { name: 'Interface smaller' }).click();
  await page.getByRole('button', { name: 'Interface smaller' }).click();
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'animate-drive-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !HEADED,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // The site's theme script writes on <html> before React arrives; a dev server grumbles about that on every page.
    if (message.type() === 'error' && !/Failed to load resource|Supabase|supabase|hydrated but some attributes/.test(message.text())) errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('[data-animate-stage]', { timeout: 180000 });
  await page.waitForFunction(() => window.__animate !== undefined && window.__animate.stage !== null, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  shot ${path.join(OUT, `${name}.png`)}`);
  };

  const helpers = { penStroke, line, pixel, state, frameOps, waitSaved, check, pass, fail, shot };
  const wanted = ONLY === '' ? Object.keys(phases) : ONLY.split(',');
  for (const name of wanted) await phases[name](page, shot, helpers);

  // Phone width: no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scroll at phone width', overflow <= 0, `${overflow}px`);
  await shot('phone');
  await page.setViewportSize({ width: 1440, height: 900 });

  check('no errors in the page', errors.length === 0, errors.slice(0, 5).join(' | '));
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});

module.exports = { phases };
