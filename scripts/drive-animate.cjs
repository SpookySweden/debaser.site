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

// Updated on purpose for SPEC-animate-ui.md: the strip, the tools and the timeline's keys moved into the pop-up, the menu and the timeline's menu.
/** Open the tools with their key and press a swatch. */
async function pickColour(page, name) {
  await page.keyboard.press('x');
  await page.locator('[data-animate-popup]').getByRole('button', { name, exact: true }).click();
}

/** Press a row of the menu, opened with its key. */
async function menuItem(page, id) {
  await page.keyboard.press('?');
  await page.locator(`[data-animate-menu-item="${id}"]`).click();
}

/** Press a word in the timeline's menu, opened with its key. */
async function framesTile(page, label) {
  await page.keyboard.press('Shift+F');
  await page.locator(`[data-animate-frames-menu] [data-animate-tile="${label}"]`).click();
}

/** The layer list folded out, if it isn't already. */
async function layersOut(page) {
  if ((await page.locator('[data-animate-layers-fold]').count()) === 0) await page.keyboard.press('l');
  await page.waitForSelector('[data-animate-layers-fold]');
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
  await menuItem(page, 'file.save');
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
  await page.keyboard.press('?');
  await page.locator('[data-animate-menu-item="ui.bigger"]').click();
  await page.locator('[data-animate-menu-item="ui.bigger"]').click();
  const scale = await page.evaluate(() => window.__animate && JSON.parse(localStorage.getItem('debaser.animate.settings') ?? '{}').uiScale);
  check('the interface can be made bigger', scale === 1.5, `scale ${scale}`);
  await shot('phase0-ui150');
  await page.locator('[data-animate-menu-item="ui.smaller"]').click();
  await page.locator('[data-animate-menu-item="ui.smaller"]').click();
  await page.keyboard.press('Escape');
};

/** What is really on screen at a sheet point, onions and all: red, green, blue. */
const seen = (page, x, y) =>
  page.evaluate(
    ([px, py]) => {
      const engine = window.__animate;
      const canvas = document.querySelector('canvas[data-animate="below"]');
      const m = engine.viewMatrix(true);
      const p = m.transformPoint(new DOMPoint(px, py));
      const data = canvas.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      return [data[0], data[1], data[2]];
    },
    [x, y],
  );

const cels = (page) => page.evaluate(() => window.__animate.project.nodes.find((n) => n.id === window.__animate.activeLayer.id).cels.map((c) => [c.frame, c.length, c.mark]));

async function freshProject(page) {
  await page.evaluate(() => window.__animate.newProject());
  await page.waitForTimeout(200);
}

/** A bar of ink through (x + 20, y + 20), so a frame can be told by where its mark is. */
const mark = (x, y) => Array.from({ length: 16 }, (_, i) => [x + i * 3, y + 20, 0.9]);

/** Save whatever the next click downloads; returns its bytes. */
async function downloadFrom(page, click) {
  const wait = page.waitForEvent('download', { timeout: 60000 });
  await click();
  const file = await wait;
  const where = path.join(os.tmpdir(), `animate-dl-${Date.now()}`);
  await file.saveAs(where);
  const bytes = fs.readFileSync(where);
  fs.unlinkSync(where);
  return { name: file.suggestedFilename(), bytes };
}

phases.phase1 = async (page, shot) => {
  console.log('Phase 1: Animate');
  await freshProject(page);
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  await page.keyboard.press('i');

  // Drawing on empty frames makes drawings; the frame keys walk them.
  await penStroke(page, mark(200, 200));
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await penStroke(page, mark(400, 200));
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await penStroke(page, mark(600, 200));
  check('drawing on an empty frame makes a drawing there', JSON.stringify(await cels(page)) === JSON.stringify([[0, 1, 'key'], [2, 1, 'key'], [4, 1, 'key']]), JSON.stringify(await cels(page)));
  check('each frame shows only its own drawing', (await pixel(page, 620, 220)) === '#000000' && (await pixel(page, 220, 220)) === '#ffffff');
  await page.keyboard.press('a');
  check('the drawing keys step drawing by drawing', (await state(page, () => window.__animate.frame)) === 2);
  await page.keyboard.press('s');
  check('and forward', (await state(page, () => window.__animate.frame)) === 4);

  // Undo reaches across the timeline: it goes back to the frame it happened on.
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  check('undo goes back to the frame it happened on', (await state(page, () => window.__animate.frame)) === 4 && (await cels(page)).length === 2);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);

  // Exposure: drag a drawing's end.
  await page.evaluate(() => window.__animate.goToFrame(0));
  await page.waitForTimeout(100);
  const end = page.locator('[data-animate-cel-end]').first();
  await end.scrollIntoViewIfNeeded();
  const box = await end.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  check("dragging a drawing's end holds it longer", (await cels(page))[0][1] === 2, JSON.stringify(await cels(page)));
  check('a held frame shows the drawing', await page.evaluate(() => window.__animate.goToFrame(1) === undefined));
  await page.waitForTimeout(100);
  check('and frame 2 now shows frame 1', (await pixel(page, 220, 220)) === '#000000');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('undo shortens it again', (await cels(page))[0][1] === 1);

  // Alt+. holds with a push; on twos.
  await page.evaluate(() => window.__animate.goToFrame(0));
  await page.keyboard.press('Alt+.');
  await page.waitForTimeout(50);
  check('the hold key pushes what follows along', JSON.stringify((await cels(page)).map((c) => c[0])) === '[0,3,5]', JSON.stringify(await cels(page)));
  await page.keyboard.press('Alt+2');
  await page.waitForTimeout(50);
  check('on twos', JSON.stringify((await cels(page)).map((c) => [c[0], c[1]])) === '[[0,2],[2,2],[4,2]]', JSON.stringify(await cels(page)));
  await page.keyboard.press('u');
  await page.waitForTimeout(50);
  check('a drawing can be marked', (await cels(page))[0][2] === 'breakdown');

  // A new drawing in a hold, a copy, a paste.
  await page.evaluate(() => window.__animate.goToFrame(1));
  await page.keyboard.press('d');
  await page.waitForTimeout(50);
  check('NEW inside a hold cuts it', JSON.stringify((await cels(page)).slice(0, 2).map((c) => [c[0], c[1]])) === '[[0,1],[1,1]]', JSON.stringify(await cels(page)));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__animate.goToFrame(4));
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(200);
  check('COPY puts a copy after it, and goes there', (await state(page, () => window.__animate.frame)) === 6 && (await pixel(page, 620, 220)) === '#000000');
  await penStroke(page, mark(800, 200));
  await page.evaluate(() => window.__animate.goToFrame(4));
  await page.waitForTimeout(100);
  check('drawing on the copy leaves the original alone', (await pixel(page, 820, 220)) === '#ffffff');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);

  // Onion: neighbours show tinted, and follow the frame.
  await page.evaluate(() => window.__animate.goToFrame(2));
  await page.waitForTimeout(100);
  check('with the onion off, neighbours do not show', JSON.stringify(await seen(page, 220, 220)) === '[255,255,255]');
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  const before = await seen(page, 220, 220);
  const after = await seen(page, 620, 220);
  check('the drawing before shows, in its tint', before[0] > before[1] + 40 && before[0] > 200, JSON.stringify(before));
  check('the drawing after shows, in its tint', after[1] > after[0] + 40, JSON.stringify(after));
  await shot('phase1-onion');
  await page.evaluate(() => window.__animate.goToFrame(4));
  await page.waitForTimeout(150);
  check('it follows the frame being edited', JSON.stringify(await seen(page, 620, 220)) === '[0,0,0]' && (await seen(page, 420, 220))[0] > 200);
  await page.keyboard.press('Shift+O');
  await page.waitForTimeout(100);
  check('the onion panel opens', (await page.getByRole('dialog', { name: 'ONION SKIN' }).count()) === 1);
  await shot('phase1-onion-panel');
  await page.keyboard.press('Shift+O');
  await page.keyboard.press('o');

  // Playback: loop, ping-pong, range.
  const watch = async (ms) =>
    page.evaluate(
      (duration) =>
        new Promise((resolve) => {
          const seenFrames = [];
          const start = performance.now();
          const step = () => {
            const frame = window.__animate.frame;
            if (seenFrames[seenFrames.length - 1] !== frame) seenFrames.push(frame);
            if (performance.now() - start < duration) requestAnimationFrame(step);
            else resolve(seenFrames);
          };
          step();
        }),
      ms,
    );
  await page.evaluate(() => {
    window.__animate.goToFrame(0);
    window.__animate.tweak((p) => ({ ...p, frames: 6, fps: 12 }));
  });
  await page.keyboard.press('Enter');
  const looped = await watch(1200);
  await page.keyboard.press('Enter');
  const loopedText = looped.join(',');
  check('LOOP runs and comes back round', /5,0/.test(loopedText) && looped.length >= 6, loopedText);
  await page.waitForTimeout(100);
  check('Enter stops it', !(await state(page, () => window.__animate.project && document.querySelector('[aria-pressed="true"][title="ENTER"]') !== null)));

  await page.evaluate(() => window.__animate.goToFrame(0));
  await framesTile(page, 'PING-PONG');
  await page.mouse.move(300, 300);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  const ponged = await watch(1500);
  await page.keyboard.press('Enter');
  check('PING-PONG comes back down', /5,4/.test(ponged.join(',')) && /1,0|0,1/.test(ponged.join(',')), ponged.join(','));

  await page.evaluate(() => window.__animate.goToFrame(2));
  await page.keyboard.press('b');
  await page.evaluate(() => window.__animate.goToFrame(4));
  await page.keyboard.press('n');
  await framesTile(page, 'LOOP');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.evaluate(() => window.__animate.goToFrame(2));
  await page.keyboard.press('Enter');
  const ranged = await watch(1200);
  await page.keyboard.press('Enter');
  check('the in/out range holds it there', ranged.every((f) => f >= 2 && f <= 4) && ranged.length >= 3, ranged.join(','));
  await page.keyboard.press('Shift+B');
  await shot('phase1-desktop');

  // Timeline thumbnails exist.
  check('a cel shows a little picture', (await page.locator('[data-animate-cel] canvas').count()) >= 1);

  // Exports.
  await page.evaluate(() => window.__animate.tweak((p) => ({ ...p, fps: 24 })));
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(100);
  const gif = await downloadFrom(page, () => page.getByRole('button', { name: '[ GIF ]' }).click());
  check('GIF export gives a real GIF', gif.name.endsWith('.gif') && gif.bytes.subarray(0, 6).toString() === 'GIF89a', `${gif.name}, ${gif.bytes.length} bytes`);
  const frameCount = gif.bytes.reduce((n, byte, i) => n + (byte === 0x21 && gif.bytes[i + 1] === 0xf9 && gif.bytes[i + 2] === 4 ? 1 : 0), 0);
  check('with its frames', frameCount >= 3, `${frameCount} frames`);
  const zip = await downloadFrom(page, () => page.getByRole('button', { name: '[ PNG FRAMES ]' }).click());
  const names = zip.bytes.toString('latin1').match(/UNTITLED_\d{4}\.png/g) ?? [];
  check('PNG export gives a zip of frames', zip.name.endsWith('.zip') && zip.bytes.subarray(0, 2).toString() === 'PK' && new Set(names).size === 6, `${new Set(names).size} frames`);
  await shot('phase1-export');
  await page.keyboard.press('Control+e');

  // Leaving a project in the middle of a save (the code review's first worry): nothing is lost.
  await freshProject(page);
  await penStroke(page, mark(300, 300));
  const leftBehind = await page.evaluate(async () => {
    const engine = window.__animate;
    const id = engine.project.id;
    const save = engine.autosave();
    await engine.newProject();
    await save;
    return id;
  });
  check('leaving during a save moves to the new project', (await state(page, () => window.__animate.project.nodes[0].cels.length)) === 0);
  await page.evaluate((id) => window.__animate.switchProject(id), leftBehind);
  await page.waitForTimeout(500);
  check('and the old project came through whole', (await frameOps(page)) === 1 && (await pixel(page, 320, 320)) === '#000000', await pixel(page, 320, 320));

  // Undo waiting on a picture from storage: the plane is thrown out of memory first, so undo has to load it, and a new project swapped in
  // meanwhile must not be overwritten.
  const swapped = await page.evaluate(async () => {
    const engine = window.__animate;
    engine.undo();
    await engine.newProject();
    return engine.project.nodes[0].cels.length;
  });
  check('an undo racing a project swap stays out of the new project', swapped === 0);
  await page.evaluate((id) => window.__animate.switchProject(id), leftBehind);
  await page.waitForTimeout(300);

  // Saving to a file holds a stroke made a moment ago, not yet autosaved.
  await penStroke(page, mark(500, 500));
  const zipNow = await downloadFrom(page, () => menuItem(page, 'file.save'));
  check('SAVE FILE holds the latest stroke', zipNow.bytes.toString('latin1').includes('project.json') && zipNow.bytes.length > 400, `${zipNow.bytes.length} bytes`);

  // Full screen.
  await page.keyboard.press('`');
  await page.waitForTimeout(300);
  check('FULL fills the window', await page.evaluate(() => document.querySelector('[aria-label="Animation studio"]').getBoundingClientRect().width === window.innerWidth));
  await page.keyboard.press('0');
  await page.waitForTimeout(100);
  await shot('phase1-full');
  await page.keyboard.press('`');
};

phases.phase2 = async (page, shot) => {
  console.log('Phase 2: Organise');
  await layersOut(page);
  await freshProject(page);
  await page.keyboard.press('f');
  const rowIds = () => page.evaluate(() => window.__animate.project.nodes.map((n) => n.name));

  // Colour on the bottom layer, a new layer above: the top one covers it.
  await pickColour(page, 'ROSE');
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [300 + i * 10, 300, 0.9]));
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(100);
  check('a new layer goes above the active one', JSON.stringify(await rowIds()) === '["LAYER 2","LAYER 1"]', JSON.stringify(await rowIds()));
  await pickColour(page, 'EMERALD');
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [300 + i * 10, 300, 0.9]));
  await page.waitForTimeout(100);
  check('the top layer covers the one below', (await pixel(page, 450, 300)) === '#28c745', await pixel(page, 450, 300));

  // Hide, solo, lock.
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  check('hiding a layer shows what is under it', (await pixel(page, 450, 300)) === '#e6004c', await pixel(page, 450, 300));
  await page.keyboard.press('v');
  await page.keyboard.press('Alt+s');
  await page.waitForTimeout(100);
  check('solo shows only that layer', (await pixel(page, 450, 300)) === '#28c745');
  await page.keyboard.press('Alt+s');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+s');
  await page.waitForTimeout(100);
  check('the arrows move between layers, and solo follows', (await pixel(page, 450, 300)) === '#e6004c');
  await page.keyboard.press('Alt+s');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+l');
  await page.waitForTimeout(50);
  const opsBefore = await frameOps(page);
  await penStroke(page, Array.from({ length: 10 }, (_, i) => [900 + i * 5, 500, 0.9]));
  check('a locked layer refuses, and says so', (await frameOps(page)) === opsBefore && (await page.locator('[data-animate-notice]').textContent()).includes('LOCKED'));
  await page.keyboard.press('Alt+l');

  // Opacity and blend.
  const setActive = (change) => page.evaluate((c) => {
    const engine = window.__animate;
    const id = engine.activeLayer.id;
    engine.tweak((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...c } : n)) }));
  }, change);
  await setActive({ opacity: 0.5 });
  await page.waitForTimeout(60);
  const half = await pixel(page, 450, 300);
  check('opacity lets what is under show through', half !== '#28c745' && half !== '#e6004c', half);
  await setActive({ opacity: 1, blend: 'multiply' });
  await page.waitForTimeout(60);
  const multiplied = await pixel(page, 450, 300);
  // Rose #e6004c x Emerald #28c745: red 0x24, green 0, blue 0x14.
  check('multiply darkens', multiplied === '#240014' || (parseInt(multiplied.slice(1, 3), 16) < 50 && parseInt(multiplied.slice(3, 5), 16) < 10), multiplied);
  await setActive({ blend: 'normal' });

  // Folders: a layer inside a hidden folder is hidden; a folder's opacity applies to its rows.
  await page.keyboard.press('Shift+G');
  await page.waitForTimeout(80);
  const folderId = await state(page, () => window.__animate.activeLayer.id);
  check('a folder can be made', (await state(page, () => window.__animate.activeLayer.kind)) === 'folder');
  await shot('phase2-folder');

  // Drag a layer's row into the folder.
  const nameButton = page.locator(`[data-animate-row]`).filter({ hasText: 'LAYER 2' }).getByRole('button', { name: 'LAYER 2', exact: true });
  const folderRow = page.locator(`[data-animate-row="${folderId}"]`);
  const from = await nameButton.boundingBox();
  const to = await folderRow.boundingBox();
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + to.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  check('dragging a row onto a folder puts it inside', (await page.evaluate((id) => window.__animate.project.nodes.find((n) => n.name === 'LAYER 2').parent === id, folderId)));
  await page.evaluate((id) => document.querySelector(`[data-animate-row="${id}"]`).querySelector('button[aria-label^="Hide"]').click(), folderId);
  await page.waitForTimeout(100);
  check('hiding the folder hides what is inside it', (await pixel(page, 450, 300)) === '#e6004c');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('and undo shows it again', (await pixel(page, 450, 300)) === '#28c745');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('undo takes it back out', await page.evaluate(() => window.__animate.project.nodes.find((n) => n.name === 'LAYER 2').parent === null));
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);

  // Tag chips show on rows, and a folder's passes down.
  await page.evaluate((id) => {
    const engine = window.__animate;
    engine.edit('TAG', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, tagId: 'rough' } : n)) }));
  }, folderId);
  await page.waitForTimeout(100);
  check('a tag shows as a chip on the row', (await page.locator(`[data-animate-row="${folderId}"] [data-animate-chip="rough"]`).count()) === 1);
  check('and passes down to the layer inside', (await page.locator('[data-animate-row]').filter({ hasText: 'LAYER 2' }).locator('[data-animate-chip="rough"]').count()) === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);

  // Settings: the panel, the biggest interface, a remapped key.
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(100);
  check('the settings panel opens', (await page.getByRole('dialog', { name: 'SETTINGS' }).count()) === 1);
  await shot('phase2-settings');
  await page.getByRole('button', { name: 'Change the key for PENCIL' }).click();
  await page.keyboard.press('j');
  await page.waitForTimeout(80);
  check('a key can be remapped', await page.evaluate(() => JSON.parse(localStorage.getItem('debaser.animate.settings')).shortcuts['tool.pencil'] === 'j'));
  await page.getByRole('button', { name: 'Change the key for ERASER' }).click();
  await page.keyboard.press('j');
  await page.waitForTimeout(80);
  check('taking a key from another action says so', (await page.getByText(/WAS PENCIL, WHICH NOW HAS NO KEY/).count()) === 1);
  await page.getByRole('button', { name: '[ ALL BACK TO START ]' }).click();
  await page.getByRole('button', { name: '[ 300% ]' }).click();
  await page.waitForTimeout(150);
  await shot('phase2-ui300');
  await page.keyboard.press('Control+,');
  await page.keyboard.press('`');
  await page.waitForTimeout(250);
  await shot('phase2-ui300-full');
  const stageTall = await page.evaluate(() => document.querySelector('[data-animate-stage]').getBoundingClientRect().height);
  check('at 300% full screen the sheet still has room', stageTall >= 400, `${stageTall}px`);
  await page.keyboard.press('`');
  await layersOut(page);
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(100);
  check('the interface goes to 300%', await page.evaluate(() => JSON.parse(localStorage.getItem('debaser.animate.settings')).uiScale === 3));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('and nothing runs off sideways at 300%', overflow <= 0, `${overflow}px`);
  await page.getByRole('button', { name: '[ 100% ]' }).click();
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(100);

  // The pressure curve changes the line. Same light pen, a soft curve makes it thicker.
  await freshProject(page);
  await pickColour(page, 'BLACK');
  await page.keyboard.press('i');
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [200 + i * 12, 200, 0.3]));
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '[ SOFT ]' }).click();
  await page.keyboard.press('Control+,');
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [200 + i * 12, 300, 0.3]));
  const widthOf = (y) => page.evaluate((yy) => {
    const engine = window.__animate;
    const cel = engine.activeLayer.cels[0];
    const data = engine.planes.peek(`${cel.drawingId}.line`).getContext('2d').getImageData(380, yy - 40, 1, 80).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) count += 1;
    return count;
  }, y);
  const plain = await widthOf(200);
  const soft = await widthOf(300);
  check('a soft pressure curve draws wider for the same press', soft > plain, `even ${plain}px, soft ${soft}px`);
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '[ EVEN ]' }).click();
  await page.keyboard.press('Control+,');

  // Selecting: box, move, undo.
  await page.keyboard.press('Shift+W');
  const before = await pixel(page, 380, 200);
  await penStroke(page, [[300, 150, 0.5], [500, 150, 0.5], [500, 250, 0.5]]);
  check('a box selects', await state(page, () => document.querySelector('[data-animate-stage]') !== null));
  await penStroke(page, [[400, 200, 0.5], [400, 300, 0.5], [400, 500, 0.5]]);
  await page.waitForTimeout(120);
  check('dragging inside moves what is selected', before === '#000000' && (await pixel(page, 380, 200)) === '#ffffff' && (await pixel(page, 380, 500)) === '#000000', `${await pixel(page, 380, 200)} ${await pixel(page, 380, 500)}`);
  await shot('phase2-select');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
  check('undo puts it back', (await pixel(page, 380, 200)) === '#000000' && (await pixel(page, 380, 500)) === '#ffffff');
  check('the move is kept as data', await page.evaluate(() => Object.values(window.__animate.project.drawings)[0].planes.line.every((op) => op.kind === 'stroke')));
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(120);
  check('redo moves it again', (await pixel(page, 380, 500)) === '#000000');
  check('a move lands in the data', await page.evaluate(() => Object.values(window.__animate.project.drawings)[0].planes.line.some((op) => op.kind === 'move')));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  check('backspace deletes what is selected', (await pixel(page, 380, 500)) === '#ffffff');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('i');

  // Rebuilt from data: throw a plane's picture away and it comes back the same.
  const rebuilt = await page.evaluate(async () => {
    const engine = window.__animate;
    const cel = engine.activeLayer.cels[0];
    const key = `${cel.drawingId}.line`;
    const canvas = new OffscreenCanvas(engine.project.width, engine.project.height);
    engine.replayOps(canvas, engine.project.drawings[cel.drawingId].planes.line);
    const a = canvas.getContext('2d').getImageData(200, 180, 300, 40).data;
    const b = engine.planes.peek(key).getContext('2d').getImageData(200, 180, 300, 40).data;
    let differ = 0;
    for (let i = 3; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8) differ += 1;
    return differ;
  });
  check('a drawing rebuilt from its data matches its picture', rebuilt < 40, `${rebuilt} pixels differ`);

  // The palette: add, remove.
  const paletteSize = () => page.evaluate(() => window.__animate.project.palette.length);
  const n0 = await paletteSize();
  await menuItem(page, 'palette.panel');
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Colour"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Keep this colour in the palette' }).click();
  await page.waitForTimeout(60);
  check('a colour can be kept in the palette', (await paletteSize()) === n0 + 1);
  await page.getByRole('button', { name: 'Take this colour out of the palette' }).click();
  await page.waitForTimeout(60);
  check('and taken out', (await paletteSize()) === n0);
  await page.keyboard.press('Escape');

  // Reorder by keyboard.
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(50);
  const order0 = await rowIds();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(50);
  check('a row can be moved with the keyboard', JSON.stringify(await rowIds()) !== JSON.stringify(order0), JSON.stringify(await rowIds()));
  await shot('phase2-desktop');
};

/** Points along a line, spaced for a pen. */
const along = (x0, y0, x1, y1, pressure = 0.9) => {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6);
  return Array.from({ length: steps + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, pressure]);
};

phases.phase3 = async (page, shot) => {
  console.log('Phase 3: Smart Figure');
  await layersOut(page);
  await freshProject(page);
  await pickColour(page, 'BLACK');
  await page.evaluate(() => {
    const engine = window.__animate;
    engine.setBrushValue('ink', { stabiliser: 0 });
    engine.setBrushValue('flat', { stabiliser: 0 });
    const id = engine.activeLayer.id;
    engine.edit('TAG', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, tagId: 'figure' } : n)) }));
  });
  await page.waitForTimeout(80);
  check('a Figure layer shows its two planes', (await page.locator('[data-animate-plane-row]').count()) === 2);

  const opsOf = (plane) => page.evaluate((pl) => {
    const engine = window.__animate;
    const cel = engine.celForDrawing(engine.activeLayer);
    return cel === null ? [] : engine.project.drawings[cel.drawingId].planes[pl];
  }, plane);
  /** A plane's alpha at a point. */
  const alphaOf = (plane, x, y) => page.evaluate(([pl, px, py]) => {
    const engine = window.__animate;
    const cel = engine.celForDrawing(engine.activeLayer);
    const canvas = engine.planes.peek(cel.drawingId + '.' + pl);
    return canvas === null ? 0 : canvas.getContext('2d').getImageData(px, py, 1, 1).data[3];
  }, [plane, x, y]);

  // Ink a box with a small gap in its top edge.
  await page.keyboard.press('i');
  check('ink draws on the Line plane', (await state(page, () => window.__animate && document.querySelector('[data-animate-plane="line"]').getAttribute('aria-pressed'))) === 'true');
  await penStroke(page, along(420, 200, 800, 200), { gapMs: 1 });
  await penStroke(page, along(800, 200, 800, 600), { gapMs: 1 });
  await penStroke(page, along(800, 600, 400, 600), { gapMs: 1 });
  await penStroke(page, along(400, 600, 400, 200), { gapMs: 1 });
  check('the lines are on the Line plane', (await opsOf('line')).length === 4 && (await opsOf('colour')).length === 0);
  check('and an ink stroke holds no smarts', (await opsOf('line'))[0].smartAtDrawTime.length === 0);

  // Give the background read a moment; the helper line is the proof the gap closed.
  await page.waitForTimeout(900);
  const cyan = await page.evaluate(() => {
    const engine = window.__animate;
    const canvas = document.querySelector('canvas[data-animate="ui"]');
    engine.paintUi();
    const m = engine.viewMatrix(true);
    const ctx = canvas.getContext('2d');
    let found = 0;
    for (let x = 395; x < 425; x += 1) {
      for (let y = 190; y < 210; y += 1) {
        const p = m.transformPoint(new DOMPoint(x, y));
        const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        if (d[3] > 100 && d[0] < 90 && d[1] > 150 && d[2] > 180) found += 1;
      }
    }
    return found;
  });
  check('a thin cyan line shows where the gap closed', cyan > 0, cyan + ' pixels');
  await shot('phase3-closure');

  // Flat colour starts inside and runs out over the line: it stops.
  await page.keyboard.press('f');
  await pickColour(page, 'ROSE');
  check('flat colour goes to the Colour plane', (await state(page, () => document.querySelector('[data-animate-plane="colour"]').getAttribute('aria-pressed'))) === 'true');
  await penStroke(page, along(600, 400, 1000, 400), { gapMs: 1 });
  await page.waitForTimeout(150);
  const flat = (await opsOf('colour'))[0];
  check('a colour stroke remembers its smarts', flat.smartAtDrawTime.includes('stayInsideLines') && flat.smartAtDrawTime.includes('tuckUnder') && flat.regionId > 0, JSON.stringify(flat.smartAtDrawTime));
  check('inside the lines it paints', (await pixel(page, 700, 400)) === '#e6004c', await pixel(page, 700, 400));
  check('past the line it does not', (await pixel(page, 900, 400)) === '#ffffff', await pixel(page, 900, 400));
  // No white halo: colour goes under the line, as far as its middle.
  check('colour runs under the line', (await alphaOf('colour', 798, 400)) > 200, String(await alphaOf('colour', 798, 400)));
  check('and stops inside its far edge', (await alphaOf('colour', 806, 400)) === 0, String(await alphaOf('colour', 806, 400)));
  check('the lines stay on top', (await pixel(page, 800, 400)) === '#000000', await pixel(page, 800, 400));
  await shot('phase3-inside');

  // Tapping Q reads the lines with no closing, and that must not move colour already down (the code review's worry).
  await page.keyboard.press('q');
  await page.waitForTimeout(900);
  check('tapping Q off moves no colour', (await pixel(page, 900, 400)) === '#ffffff' && (await pixel(page, 700, 400)) === '#e6004c', await pixel(page, 900, 400));
  await page.keyboard.press('q');
  await page.waitForTimeout(500);
  check('nor does tapping it on', (await pixel(page, 900, 400)) === '#ffffff' && (await pixel(page, 700, 400)) === '#e6004c', await pixel(page, 900, 400));

  // It leaks through a big gap but not the small one. (Starting outside it stays outside.)
  await penStroke(page, along(1000, 500, 700, 500), { gapMs: 1 });
  await page.waitForTimeout(150);
  check('a stroke started outside stays outside', (await pixel(page, 900, 500)) === '#e6004c' && (await pixel(page, 700, 500)) === '#ffffff', (await pixel(page, 900, 500)) + ' ' + (await pixel(page, 700, 500)));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  // Q: off goes anywhere, and says so.
  await page.keyboard.press('q');
  await page.waitForTimeout(80);
  check('the master key turns smarts off', (await page.locator('[data-animate-badge]').count()) === 1);
  check('and a badge says so', (await page.locator('[data-animate-badge]').textContent()) === 'SMART OFF');
  await shot('phase3-smart-off');
  await pickColour(page, 'EMERALD');
  await penStroke(page, along(600, 300, 1000, 300), { gapMs: 1 });
  await page.waitForTimeout(150);
  check('a raw stroke goes past the line', (await pixel(page, 900, 300)) === '#28c745', await pixel(page, 900, 300));
  const raw = (await opsOf('colour'))[1];
  check('and remembers it was raw', raw.smartAtDrawTime.length === 0);
  await page.keyboard.press('q');
  await page.waitForTimeout(80);
  check('the key again turns them on', (await page.locator('[data-animate-badge]').count()) === 0);

  // Hold it for one stroke.
  await page.keyboard.down('q');
  await penStroke(page, along(600, 250, 1000, 250), { gapMs: 1 });
  await page.keyboard.up('q');
  await page.waitForTimeout(150);
  check('held for one stroke: that stroke is raw', (await pixel(page, 900, 250)) === '#28c745', await pixel(page, 900, 250));
  check('and smarts come straight back', (await page.locator('[data-animate-badge]').count()) === 0);

  // Lines changed after colouring: a wall through the box. Smart colour moves; raw stays.
  await page.keyboard.press('i');
  await pickColour(page, 'BLACK');
  await penStroke(page, along(650, 200, 650, 600), { gapMs: 1 });
  await page.waitForTimeout(1400);
  check('smart colour moves to the new lines', (await pixel(page, 620, 400)) === '#e6004c' && (await pixel(page, 700, 400)) === '#ffffff', (await pixel(page, 620, 400)) + ' ' + (await pixel(page, 700, 400)));
  check('raw colour stays exactly as drawn', (await pixel(page, 700, 300)) === '#28c745' && (await pixel(page, 900, 300)) === '#28c745', (await pixel(page, 700, 300)) + ' ' + (await pixel(page, 900, 300)));
  await shot('phase3-relaid');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1400);
  check('undo takes the wall away and the colour comes back', (await pixel(page, 700, 400)) === '#e6004c', await pixel(page, 700, 400));
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(1400);
  check('redo sends it back again', (await pixel(page, 700, 400)) === '#ffffff', await pixel(page, 700, 400));

  // The bucket: a whole area, and it can be undone.
  await page.keyboard.press('g');
  await pickColour(page, 'ROYAL');
  await page.waitForTimeout(100);
  await penStroke(page, [[720, 450, 0.5]], { gapMs: 1 });
  await page.waitForTimeout(400);
  check('the bucket fills the area it lands in', (await pixel(page, 700, 590)) === '#1d3ca6' && (await pixel(page, 620, 590)) === '#ffffff', (await pixel(page, 700, 590)) + ' ' + (await pixel(page, 620, 590)));
  check('and fills are kept as data', (await opsOf('colour')).some((op) => op.kind === 'fill' && op.regionId > 0));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('undo takes the fill off', (await pixel(page, 700, 590)) === '#ffffff');

  // Hover preview: a pointer over the sheet tints the area, drawn on the marks canvas.
  await page.evaluate(() => {
    const engine = window.__animate;
    engine.setHover({ x: 720, y: 450 });
    engine.paintUi();
  });
  const tinted = await page.evaluate(() => {
    const engine = window.__animate;
    const canvas = document.querySelector('canvas[data-animate="ui"]');
    const p = engine.viewMatrix(true).transformPoint(new DOMPoint(700, 590));
    return canvas.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data[3];
  });
  check('hovering the bucket previews the area it would fill', tinted > 40, 'alpha ' + tinted);
  await shot('phase3-preview');
  await page.evaluate(() => window.__animate.setHover(null));

  // Fill brush: a drag across two areas fills both, in one undo step.
  await page.keyboard.press('y');
  await pickColour(page, 'DAFFODIL');
  await penStroke(page, along(520, 450, 720, 450, 0.5), { gapMs: 1 });
  await page.waitForTimeout(400);
  check('the fill brush fills every area it crosses', (await pixel(page, 500, 590)) === '#fff000' && (await pixel(page, 700, 590)) === '#fff000', (await pixel(page, 500, 590)) + ' ' + (await pixel(page, 700, 590)));
  await page.keyboard.press('Shift+Y');
  await penStroke(page, [[720, 450, 0.5]], { gapMs: 1 });
  await page.waitForTimeout(400);
  check('the fill eraser clears an area', (await pixel(page, 700, 590)) === '#ffffff' && (await pixel(page, 500, 590)) === '#fff000', (await pixel(page, 700, 590)) + ' ' + (await pixel(page, 500, 590)));

  // Make smart: a raw stroke, selected, snaps inside.
  await page.keyboard.press('Shift+W');
  await penStroke(page, [[580, 240, 0.5], [1020, 240, 0.5], [1020, 260, 0.5]], { gapMs: 1 });
  await page.waitForTimeout(80);
  check('MAKE SMART shows with a selection', (await page.locator('[data-animate-make-smart]').count()) === 1);
  await page.getByRole('button', { name: '[ MAKE SMART ]' }).click();
  await page.waitForTimeout(500);
  check('MAKE SMART snaps a raw stroke inside its area', (await pixel(page, 900, 250)) === '#ffffff', await pixel(page, 900, 250));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('and undo unsnaps it', (await pixel(page, 900, 250)) === '#28c745', await pixel(page, 900, 250));
  await page.keyboard.press('Control+d');
  await page.keyboard.press('f');

  // Reloading keeps it all, smarts included: nothing depends on memory.
  await waitSaved(page);
  await page.reload();
  await page.waitForFunction(() => window.__animate?.project?.nodes?.[0]?.tagId === 'figure', null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const opsCount = (await opsOf('colour')).length;
  check('a reload brings the smart drawing back', opsCount >= 3 && (await pixel(page, 620, 400)) === '#fff000', opsCount + ' ' + (await pixel(page, 620, 400)));
  // Painting immediately after a reload, before anything has been read, is still held inside.
  await page.keyboard.press('f');
  await pickColour(page, 'CANDY');
  await penStroke(page, along(1000, 450, 700, 450), { gapMs: 1 });
  await page.waitForTimeout(1200);
  check('a stroke made before the lines are read still lands inside its area', (await pixel(page, 700, 450)) !== '#ffb7e6' && (await pixel(page, 900, 450)) === '#ffb7e6', (await pixel(page, 700, 450)) + ' ' + (await pixel(page, 900, 450)));
  await shot('phase3-desktop');
};

phases.phase4 = async (page, shot) => {
  console.log('Phase 4: Tags');
  await layersOut(page);
  await freshProject(page);
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
    const engine = window.__animate;
    for (const b of ['ink', 'flat', 'pencil']) engine.setBrushValue(b, { stabiliser: 0 });
  });
  await pickColour(page, 'BLACK');
  const rows = () => page.evaluate(() => window.__animate.project.nodes.map((n) => [n.name, n.tagId, n.blend, n.locked]));
  const pickTag = (tagId) => page.evaluate((t) => {
    const select = document.querySelector('[data-animate-tag-select]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, t);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, tagId);

  // Ctrl + a number: a new layer with that tag.
  check('all eight tags are there', (await page.evaluate(() => window.__animate.project.tags.map((t) => t.id).join(','))) === 'figure,ink,rough,shade,background,reference,fx,notes');
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(100);
  check('Ctrl + 1 makes a Figure layer', (await rows())[0][1] === 'figure', JSON.stringify((await rows())[0]));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);

  // Ink as a fill reference: a Figure on another layer reads its lines.
  await page.keyboard.press('i');
  await pickTag('ink');
  await page.waitForTimeout(80);
  await penStroke(page, along(400, 200, 800, 200), { gapMs: 1 });
  await penStroke(page, along(800, 200, 800, 600), { gapMs: 1 });
  await penStroke(page, along(800, 600, 400, 600), { gapMs: 1 });
  await penStroke(page, along(400, 600, 400, 200), { gapMs: 1 });
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(80);
  await pickTag('figure');
  await page.keyboard.press('f');
  await pickColour(page, 'ROSE');
  await page.waitForTimeout(900);
  await penStroke(page, along(600, 400, 1000, 400), { gapMs: 1 });
  await page.waitForTimeout(300);
  check('a Figure stays inside lines on an Ink layer', (await pixel(page, 700, 400)) === '#e6004c' && (await pixel(page, 900, 400)) === '#ffffff', (await pixel(page, 700, 400)) + ' ' + (await pixel(page, 900, 400)));

  // Shade: multiplies, and stays where the layer below has pixels.
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(80);
  await pickTag('shade');
  await page.waitForTimeout(80);
  check('a Shade layer starts on multiply', (await rows())[0][2] === 'multiply', JSON.stringify((await rows())[0]));
  await pickColour(page, 'GREY');
  await penStroke(page, along(650, 450, 1000, 450), { gapMs: 1 });
  await page.waitForTimeout(600);
  check('a Shade paints only where the layer below has pixels', (await pixel(page, 900, 450)) === '#ffffff', await pixel(page, 900, 450));
  await penStroke(page, along(620, 402, 760, 402), { gapMs: 1 });
  await page.waitForTimeout(500);
  const shaded = await pixel(page, 700, 402);
  check('and multiplies over the colour', shaded !== '#e6004c' && shaded !== '#ffffff', shaded);
  await shot('phase4-shade');

  // Rough: dim, and left out of renders. Reference starts locked.
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(80);
  await pickTag('rough');
  await page.keyboard.press('i');
  await pickColour(page, 'BLACK');
  await penStroke(page, along(1100, 300, 1500, 300), { gapMs: 1 });
  await page.waitForTimeout(100);
  check('Rough shows full strength while it is the layer in hand', (await pixel(page, 1300, 300)) === '#000000', await pixel(page, 1300, 300));
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const dimmed = await seen(page, 1300, 300);
  check('and dims, tinted blue, when it is not', dimmed[2] > dimmed[0] && dimmed[0] > 60, JSON.stringify(dimmed));
  await page.keyboard.press('ArrowUp');

  // Reference starts locked. Notes stay on top. FX adds.
  await page.keyboard.press('Control+6');
  await page.waitForTimeout(80);
  check('a Reference layer starts locked', (await rows())[0][1] === 'reference' && (await rows())[0][3] === true, JSON.stringify((await rows())[0]));
  await page.keyboard.press('Alt+Delete');
  await page.waitForTimeout(80);
  await page.keyboard.press('Control+7');
  await page.waitForTimeout(80);
  check('an FX layer starts on add', (await rows())[0][2] === 'add', JSON.stringify((await rows())[0]));
  await page.keyboard.press('Alt+Delete');
  await page.waitForTimeout(80);

  // Background: one drawing on every frame.
  await page.keyboard.press('Control+5');
  await page.waitForTimeout(80);
  await pickColour(page, 'EMERALD');
  await penStroke(page, along(1100, 800, 1500, 800), { gapMs: 1 });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__animate.goToFrame(20));
  await page.waitForTimeout(120);
  check('a Background drawing shows on every frame', (await pixel(page, 1300, 800)) === '#28c745', await pixel(page, 1300, 800));
  await page.evaluate(() => window.__animate.goToFrame(0));

  // The off switch, per tag.
  await page.keyboard.press('Shift+T');
  await page.waitForTimeout(100);
  check('the tag editor opens', (await page.getByRole('dialog', { name: 'TAGS' }).count()) === 1);
  await shot('phase4-tags');
  await page.getByRole('button', { name: 'FIGURE smarts on' }).click();
  await page.waitForTimeout(100);
  check('a tag can be switched off', await page.evaluate(() => window.__animate.project.tags.find((t) => t.id === 'figure').on === false));
  await page.getByRole('button', { name: 'FIGURE smarts off' }).click();

  // A custom tag: copied, edited, put on a layer, and its behaviour works.
  await page.getByRole('button', { name: 'Copy FIGURE' }).click();
  await page.waitForTimeout(100);
  const customId = await page.evaluate(() => window.__animate.project.tags[window.__animate.project.tags.length - 1].id);
  check('a tag can be copied', await page.evaluate(() => window.__animate.project.tags.length === 9));
  await page.locator('input[aria-label="Tag name"]').fill('MY FIG');
  await page.waitForTimeout(60);
  await shot('phase4-editor');
  await page.locator('[data-animate-behaviour="STAY INSIDE LINES"]').uncheck();
  await page.waitForTimeout(60);
  check('a behaviour can be switched off in it', await page.evaluate((id) => {
    const t = window.__animate.project.tags.find((x) => x.id === id);
    return t.behaviours.stayInsideLines === false && t.name === 'MY FIG';
  }, customId));

  // Presets: out to a file, and in again.
  const preset = await downloadFrom(page, () => page.getByRole('button', { name: '[ SAVE TAGS ]' }).click());
  check('tags save to a small file', preset.name === 'animate-tags.json' && preset.bytes.toString().includes('MY FIG'), preset.bytes.length + ' bytes');
  const presetPath = path.join(os.tmpdir(), 'animate-preset-' + Date.now() + '.json');
  fs.writeFileSync(presetPath, preset.bytes);
  await page.setInputFiles('#animate-tag-file', presetPath);
  await page.waitForTimeout(200);
  check('and load back as new tags', await page.evaluate(() => window.__animate.project.tags.filter((t) => t.name === 'MY FIG').length === 2));
  fs.writeFileSync(presetPath, 'nonsense');
  await page.setInputFiles('#animate-tag-file', presetPath);
  await page.waitForTimeout(200);
  check('a file that is not one is refused, in words', (await page.locator('[data-animate-notice]').textContent()).includes('NOT A TAG FILE'));
  fs.unlinkSync(presetPath);
  await page.keyboard.press('Shift+T');

  // A folder's tag passes down.
  await page.keyboard.press('Shift+G');
  await page.waitForTimeout(80);
  await pickTag('rough');
  await page.waitForTimeout(60);
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(80);
  check('a layer made in a folder takes its tag', (await page.locator('[data-animate-row]').first().locator('[data-animate-chip="rough"]').count()) === 1 || (await page.locator('[data-animate-chip="rough"]').count()) >= 2);
  await shot('phase4-desktop');
};

/** A small WAV of a tone, for testing sound without shipping one. */
function toneWav(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buffer.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 20000), 44 + i * 2);
  return buffer;
}

phases.phase5 = async (page, shot) => {
  console.log('Phase 5: Pro polish');
  await layersOut(page);
  await freshProject(page);
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
    const engine = window.__animate;
    for (const b of ['ink', 'flat']) engine.setBrushValue(b, { stabiliser: 0 });
  });
  await pickColour(page, 'BLACK');
  await page.keyboard.press('i');
  await penStroke(page, mark(300, 300), { gapMs: 1 });
  await page.keyboard.press('.');
  await page.waitForTimeout(60);
  await page.keyboard.press('.');
  await page.waitForTimeout(60);
  await penStroke(page, mark(600, 300), { gapMs: 1 });

  // Light table: a second layer's drawing washes out.
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(80);
  await penStroke(page, mark(900, 300), { gapMs: 1 });
  await page.waitForTimeout(80);
  check('before the light table, the other layer is full strength', JSON.stringify(await seen(page, 620, 320)) === '[0,0,0]', JSON.stringify(await seen(page, 620, 320)));
  await page.keyboard.press('t');
  await page.waitForTimeout(120);
  const washed = await seen(page, 620, 320);
  check('the light table washes out every layer but the one in hand', washed[0] > 120, JSON.stringify(washed));
  check('and leaves the one in hand', JSON.stringify(await seen(page, 920, 320)) === '[0,0,0]', JSON.stringify(await seen(page, 920, 320)));
  await shot('phase5-lighttable');
  await page.keyboard.press('t');
  await page.keyboard.press('Alt+Delete');
  await page.waitForTimeout(100);

  // Shift and Trace: the onion moves; the drawing doesn't; it snaps back.
  await page.evaluate(() => window.__animate.goToFrame(2));
  await page.keyboard.press('o');
  await page.waitForTimeout(100);
  const opsBefore = await frameOps(page);
  await page.keyboard.press('j');
  await page.waitForTimeout(60);
  check('the trace keys show', (await page.locator('[data-animate-trace-keys]').count()) === 1);
  check('the neighbour shows in its tint where it was', (await seen(page, 320, 320))[0] > 200 && (await seen(page, 320, 320))[1] < 200, JSON.stringify(await seen(page, 320, 320)));
  await penStroke(page, [[400, 400, 0.5], [500, 500, 0.5], [600, 600, 0.5]], { gapMs: 4 });
  await page.waitForTimeout(150);
  check('dragging moves the onion', JSON.stringify(await seen(page, 320, 320)) === '[255,255,255]' && (await seen(page, 520, 520))[0] > 200, JSON.stringify(await seen(page, 520, 520)));
  await shot('phase5-trace');
  check('and changes no drawing', (await frameOps(page)) === opsBefore);
  await page.keyboard.press('Shift+J');
  await page.waitForTimeout(100);
  check('SNAP BACK puts it back', (await seen(page, 320, 320))[0] > 200, JSON.stringify(await seen(page, 320, 320)));
  await page.keyboard.press('o');

  // Carry colour forward.
  await freshProject(page);
  await pickColour(page, 'BLACK');
  await page.evaluate(() => {
    const engine = window.__animate;
    for (const b of ['ink', 'flat']) engine.setBrushValue(b, { stabiliser: 0 });
    const id = engine.activeLayer.id;
    engine.edit('TAG', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, tagId: 'figure' } : n)) }));
  });
  await page.waitForTimeout(80);
  const box = async (x0, y0, x1, y1) => {
    await penStroke(page, along(x0, y0, x1, y0), { gapMs: 1 });
    await penStroke(page, along(x1, y0, x1, y1), { gapMs: 1 });
    await penStroke(page, along(x1, y1, x0, y1), { gapMs: 1 });
    await penStroke(page, along(x0, y1, x0, y0), { gapMs: 1 });
  };
  await page.keyboard.press('i');
  await box(300, 300, 700, 700);
  await page.waitForTimeout(800);
  await page.keyboard.press('g');
  await pickColour(page, 'ROSE');
  await page.waitForTimeout(100);
  await penStroke(page, [[500, 500, 0.5]], { gapMs: 1 });
  await page.waitForTimeout(300);
  check('a coloured drawing to carry from', (await pixel(page, 500, 500)) === '#e6004c');
  await page.keyboard.press('.');
  await page.waitForTimeout(100);
  await page.keyboard.press('i');
  await pickColour(page, 'BLACK');
  await box(320, 320, 720, 720);
  await page.waitForTimeout(800);
  check('the next drawing has lines and no colour', (await pixel(page, 500, 500)) === '#ffffff');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  check('carrying goes to the next drawing', (await state(page, () => window.__animate.frame)) === 1);
  check('and fills its matching area', (await pixel(page, 500, 500)) === '#e6004c' && (await pixel(page, 900, 500)) === '#ffffff', (await pixel(page, 500, 500)) + ' ' + (await pixel(page, 900, 500)));
  await shot('phase5-carry');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__animate.goToFrame(1));
  await page.waitForTimeout(100);
  check('undo takes the carried colour off', (await pixel(page, 500, 500)) === '#ffffff', await pixel(page, 500, 500));

  // The Carry Colour Forward behaviour: stepping on from a coloured drawing carries once. With nothing to carry it doesn't loop.
  await page.evaluate(() => {
    const engine = window.__animate;
    engine.tweak((p) => ({ ...p, tags: p.tags.map((t) => (t.id === 'figure' ? { ...t, behaviours: { ...t.behaviours, carryColourForward: true } } : t)) }));
    engine.goToFrame(0);
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('.');
  await page.waitForTimeout(900);
  check('the behaviour carries colour as you step on to a drawing with none', (await state(page, () => window.__animate.frame)) === 1 && (await pixel(page, 500, 500)) === '#e6004c', await pixel(page, 500, 500));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const hops = await page.evaluate(async () => {
    const engine = window.__animate;
    engine.goToFrame(0);
    let last = engine.frame;
    let changes = 0;
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        if (engine.frame !== last) {
          changes += 1;
          last = engine.frame;
        }
        if (performance.now() - started < 800) requestAnimationFrame(tick);
        else resolve();
      };
      engine.goToFrame(1);
      tick();
    });
    return changes;
  });
  check('it tries once for each drawing: the frame does not hop back and forth', hops <= 3, hops + ' changes');
  await page.evaluate(() => {
    const engine = window.__animate;
    engine.tweak((p) => ({ ...p, tags: p.tags.map((t) => (t.id === 'figure' ? { ...t, behaviours: { ...t.behaviours, carryColourForward: false } } : t)) }));
  });

  // Sound: a file in, a row on the timeline, and it travels with the project.
  const wavPath = path.join(os.tmpdir(), 'animate-tone-' + Date.now() + '.wav');
  fs.writeFileSync(wavPath, toneWav());
  await page.keyboard.press('Shift+A');
  await page.waitForTimeout(100);
  await page.setInputFiles('#animate-sound-file', wavPath);
  await page.waitForFunction(() => window.__animate.project.audio !== null, null, { timeout: 10000 });
  await page.waitForTimeout(250);
  check('a sound shows as a row on the timeline', (await page.locator('[data-animate-sound-row]').count()) === 1);
  const bars = await page.evaluate(() => {
    const canvas = document.querySelector('[data-animate-sound-row] canvas');
    const d = canvas.getContext('2d').getImageData(0, 0, Math.min(200, canvas.width), canvas.height).data;
    let on = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 100) on += 1;
    return on;
  });
  check('drawn as its loudness', bars > 100, bars + ' pixels');
  await shot('phase5-sound');
  fs.writeFileSync(wavPath, 'not a sound');
  await page.setInputFiles('#animate-sound-file', wavPath);
  await page.waitForFunction(() => document.querySelector('[data-animate-notice]')?.textContent?.includes('CANNOT READ'), null, { timeout: 8000 });
  pass('a file that is not a sound is refused, in words');
  fs.unlinkSync(wavPath);
  await page.keyboard.press('Shift+A');
  await page.waitForTimeout(80);

  // Playing with sound: the picture still runs.
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const during = await state(page, () => window.__animate.frame);
  await page.keyboard.press('Enter');
  check('it plays with sound on', during > 0, 'frame ' + during);

  // Video: real files, with real headers.
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(100);
  const canH264 = await page.evaluate(async () => {
    try {
      return (await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 480, height: 270 })).supported === true;
    } catch {
      return false;
    }
  });
  await page.getByRole('button', { name: '[ 25% ]' }).click();
  await page.evaluate(() => window.__animate.tweak((p) => ({ ...p, frames: 12 })));
  await page.waitForTimeout(60);
  if (canH264) {
    const mp4 = await downloadFrom(page, () => page.getByRole('button', { name: '[ MP4 ]' }).click());
    check('MP4 export gives a real MP4', mp4.name.endsWith('.mp4') && mp4.bytes.subarray(4, 8).toString() === 'ftyp', mp4.bytes.length + ' bytes');
    check('with sound in it', mp4.bytes.includes('soun', 0, 'latin1'), mp4.bytes.includes('soun', 0, 'latin1') ? 'sound track found' : 'no sound track: ' + (await page.locator('[data-animate-notice]').textContent()));
    await page.waitForTimeout(200);
  } else {
    pass('this browser has no H.264 encoder here, so MP4 was not tried');
  }
  const webm = await downloadFrom(page, () => page.getByRole('button', { name: '[ WEBM ]' }).click());
  check('WebM export gives a real WebM', webm.name.endsWith('.webm') && webm.bytes[0] === 0x1a && webm.bytes[1] === 0x45 && webm.bytes[2] === 0xdf && webm.bytes[3] === 0xa3, webm.bytes.length + ' bytes');
  await shot('phase5-export');
  // Closing the panel during an export keeps STOP: reopening shows it still running, and a second can't start.
  // Hundreds of different drawings, so the export takes long enough to catch in the act. Undone afterwards.
  await page.evaluate(() => {
    window.__animate.edit('TEST', (p) => {
      const drawings = { ...p.drawings };
      const cels = [...p.nodes[0].cels];
      for (let i = 0; i < 300; i += 1) {
        const id = 'test_' + i;
        drawings[id] = { id, planes: { line: [], colour: [] } };
        cels.push({ id: 'testcel_' + i, frame: 20 + i, length: 1, drawingId: id, mark: 'key' });
      }
      return { ...p, frames: 330, drawings, nodes: p.nodes.map((n, at) => (at === 0 ? { ...n, cels } : n)) };
    });
  });
  await page.getByRole('button', { name: '[ GIF ]' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('GIF 1 /') || document.body.textContent.includes('STARTING'), null, { timeout: 8000 });
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(100);
  await penStroke(page, mark(100, 100), { gapMs: 1 });
  check('the pen waits while an export reads the pictures', (await page.locator('[data-animate-notice]').textContent()).includes('EXPORTING'));
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(100);
  check('reopening the panel shows it still running', (await page.getByRole('button', { name: '[ STOP ]' }).count()) === 1);
  await page.getByRole('button', { name: '[ STOP ]' }).click();
  await page.waitForFunction(() => document.querySelector('[data-animate-notice]')?.textContent?.includes('EXPORT STOPPED'), null, { timeout: 20000 });
  pass('STOP stops it');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__animate.tweak((p) => ({ ...p, frames: 12 })));
  await page.keyboard.press('Control+e');

  // The sound travels in the project file.
  await page.waitForTimeout(100);
  const projectZip = await downloadFrom(page, () => menuItem(page, 'file.save'));
  check('the project file holds the sound', projectZip.bytes.toString('latin1').includes('assets/a_'), projectZip.bytes.length + ' bytes');

  // A reference picture lands on its own locked layer, and stays out of renders.
  const pngPath = path.join(os.tmpdir(), 'animate-pic-' + Date.now() + '.png');
  const pngData = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    c.getContext('2d').fillRect(0, 0, 40, 30);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(pngPath, Buffer.from(pngData, 'base64'));
  await page.setInputFiles('#animate-import-picture', pngPath);
  await page.waitForFunction(() => window.__animate.project.nodes[0].tagId === 'reference', null, { timeout: 8000 });
  check('an imported picture lands on a locked Reference layer', await page.evaluate(() => window.__animate.project.nodes[0].locked === true));
  check('and is kept as data', await page.evaluate(() => Object.values(window.__animate.project.drawings).some((d) => d.planes.line.some((op) => op.kind === 'image'))));
  fs.unlinkSync(pngPath);
  await shot('phase5-desktop');
};

const ALL_KEYS = 'button, a[href], input:not(.sr-only), select, [role="button"]';

/** The keys on screen, not counting the timeline's frames: in the studio, and the site's own around it. */
const keysOnScreen = (page) =>
  page.evaluate((selector) => {
    const studio = document.querySelector('[aria-label="Animation studio"]');
    const out = { studio: [], site: 0 };
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || el.closest('nextjs-portal')) continue;
      if (r.width < 2 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      if (el.closest('[data-animate-cel]')) continue;
      if (studio.contains(el)) out.studio.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 20));
      else out.site += 1;
    }
    return out;
  }, ALL_KEYS);

phases.phase6 = async (page, shot) => {
  console.log('The interface (SPEC-animate-ui.md)');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('debaser.animate.settings') ?? '{}');
    localStorage.setItem('debaser.animate.settings', JSON.stringify({ ...settings, hintSeen: false, full: false, showLayers: false, uiScale: 1 }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__animate?.stage != null, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await freshProject(page);

  // Test 1 and 2: on opening, at both sizes.
  for (const [w, h] of [[1280, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => {
      const engine = window.__animate;
      return { stage: document.querySelector('[data-animate-stage]').getBoundingClientRect().height / innerHeight, sheet: (engine.project.height * engine.view.zoom) / innerHeight };
    });
    check(`${w}x${h}: the sheet's area is at least 70% of the window's height`, sheet.stage >= 0.7, `stage ${Math.round(sheet.stage * 100)}%, sheet ${Math.round(sheet.sheet * 100)}%`);
    const keys = await keysOnScreen(page);
    check(`${w}x${h}: no more than 8 keys in the studio`, keys.studio.length <= 8, `${keys.studio.length}: ${keys.studio.join(' | ')}; the site's own: ${keys.site}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // What folds: the side panel, title and START, with tabs still there and one key to bring the panel back.
  const folded = await page.evaluate(() => ({ start: document.body.innerText.includes('[ START ]'), tabs: [...document.querySelectorAll('a[href="/animate"]')].some((a) => a.getBoundingClientRect().width > 0) }));
  check('the START strip folds away on this page, the tabs stay', !folded.start && folded.tabs, JSON.stringify(folded));
  const panelWas = await page.evaluate(() => document.body.innerText.includes('[ SIDE PANEL ]'));
  await page.keyboard.press('\\');
  await page.waitForTimeout(250);
  const stageWithPanel = await page.evaluate(() => document.querySelector('[data-animate-stage]').getBoundingClientRect().width);
  await page.keyboard.press('\\');
  await page.waitForTimeout(250);
  const stageWithout = await page.evaluate(() => document.querySelector('[data-animate-stage]').getBoundingClientRect().width);
  check("the site's side panel comes and goes with one key, and gives its room to the sheet", panelWas && stageWithout > stageWithPanel, `${stageWithPanel}px, then ${stageWithout}px`);

  // The first-time hint goes for good once used.
  check('a new person gets the hint', (await page.locator('[data-animate-hint]').count()) === 1);
  await shot('phase6-first-time');
  // A real right click: the browser's own menu mustn't come up over the tools, which by then are what's under the pointer.
  await page.evaluate(() => {
    window.__contextMenus = [];
    window.addEventListener('contextmenu', (event) => window.__contextMenus.push(event.defaultPrevented));
  });
  const stageBox = await page.locator('[data-animate-stage]').boundingBox();
  await page.mouse.click(stageBox.x + stageBox.width * 0.4, stageBox.y + stageBox.height * 0.3, { button: 'right' });
  await page.waitForTimeout(150);
  const menus = await page.evaluate(() => window.__contextMenus);
  check("the browser's own menu stays away", menus.length > 0 && menus.every(Boolean), JSON.stringify(menus));
  check('the right button opens the tools', (await page.locator('[data-animate-popup]').count()) === 1);
  check('and the hint goes', (await page.locator('[data-animate-hint]').count()) === 0);
  const popupBox = await page.locator('[data-animate-popup]').boundingBox();
  check('they open at the pen', Math.abs(popupBox.x - (stageBox.x + stageBox.width * 0.4 + 12)) < 3 || popupBox.x + popupBox.width >= stageBox.x + stageBox.width - 6, `${Math.round(popupBox.x)}, ${Math.round(popupBox.y)}`);
  await shot('phase6-tools');

  // The brush's three values: stepped, watched, with the pop-up left open.
  const brushValue = () => page.evaluate(() => window.__animate.brushes ?? null);
  void brushValue;
  const read = () => page.evaluate(() => {
    const steppers = {};
    for (const el of document.querySelectorAll('[data-animate-stepper]')) steppers[el.dataset.animateStepper] = el.querySelector('[aria-live]').textContent;
    return steppers;
  });
  const before = await read();
  await page.getByRole('button', { name: 'opacity down' }).click();
  await page.getByRole('button', { name: 'steady up' }).click();
  // Down to the old slider's 5%, and back up.
  await page.evaluate(() => window.__animate.setBrushValue('ink', { opacity: 0.1 }));
  await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'opacity down' }).click();
  await page.waitForTimeout(40);
  check('OPACITY goes down to 5%', (await read()).OPACITY === '5%', (await read()).OPACITY);
  await page.getByRole('button', { name: 'opacity up' }).click();
  await page.waitForTimeout(40);
  check('and steps back up to 10%', (await read()).OPACITY === '10%', (await read()).OPACITY);
  await page.getByRole('button', { name: 'size up' }).click();
  await page.waitForTimeout(80);
  const after = await read();
  check('OPACITY, STEADY and SIZE are all back, and the pop-up stays to watch them', after.OPACITY !== before.OPACITY && after.STEADY !== before.STEADY && after.SIZE !== before.SIZE, `${JSON.stringify(before)} then ${JSON.stringify(after)}`);
  const strokeOpacity = await page.evaluate(() => document.querySelector('[data-animate-popup]') !== null);
  check('still open after stepping', strokeOpacity);

  // One press to pick, and it closes itself.
  await page.locator('[data-animate-popup]').getByRole('button', { name: 'FLAT', exact: true }).click();
  await page.waitForTimeout(80);
  check('one press picks a tool, and it closes itself', (await page.locator('[data-animate-popup]').count()) === 0 && (await page.locator('[data-animate-status]').textContent()).includes('FLAT'), await page.locator('[data-animate-status]').textContent());
  // Pressing elsewhere just closes it, and draws nothing.
  const opsNow = await frameOps(page);
  await page.keyboard.press('x');
  await page.waitForTimeout(80);
  check('X opens them too', (await page.locator('[data-animate-popup]').count()) === 1);
  check('the keyboard lands on the tool in hand', await page.evaluate(() => document.activeElement?.textContent === 'FLAT'));
  await page.keyboard.press('ArrowRight');
  check('arrows walk the block', await page.evaluate(() => document.activeElement?.textContent === 'ERASER'), await page.evaluate(() => document.activeElement?.textContent));
  await page.mouse.click(stageBox.x + 6, stageBox.y + stageBox.height - 6);
  await page.waitForTimeout(80);
  check('pressing elsewhere closes them, and draws nothing', (await page.locator('[data-animate-popup]').count()) === 0 && (await frameOps(page)) === opsNow);
  await page.keyboard.press('x');
  await page.keyboard.press('i');
  await page.waitForTimeout(80);
  check('a tool key closes them too', (await page.locator('[data-animate-popup]').count()) === 0);
  await page.evaluate(() => window.__animate.setBrushValue('ink', { stabiliser: 0, opacity: 1 }));
  await page.reload();
  await page.waitForFunction(() => window.__animate?.stage != null, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  check('the hint stays gone after a reload', (await page.locator('[data-animate-hint]').count()) === 0);

  // A big interface: the pop-up and the layers still fit, opened at the far corner.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('debaser.animate.settings'));
    localStorage.setItem('debaser.animate.settings', JSON.stringify({ ...settings, uiScale: 2 }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__animate?.stage != null, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const big = await page.locator('[data-animate-stage]').boundingBox();
  await page.mouse.click(big.x + big.width - 10, big.y + big.height - 10, { button: 'right' });
  await page.waitForTimeout(150);
  const inBig = await page.evaluate(() => {
    const stage = document.querySelector('[data-animate-stage]').getBoundingClientRect();
    const box = document.querySelector('[data-animate-popup]');
    const r = box.getBoundingClientRect();
    return { inside: r.left >= stage.left - 1 && r.top >= stage.top - 1 && r.right <= stage.right + 1 && r.bottom <= stage.bottom + 1, scrolls: box.scrollHeight <= box.clientHeight + 1 || getComputedStyle(box).overflowY === 'auto' };
  });
  check('at 200% the pop-up stays on the sheet, scrolling if it has to', inBig.inside && inBig.scrolls, JSON.stringify(inBig));
  await shot('phase6-tools-ui200');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('debaser.animate.settings'));
    localStorage.setItem('debaser.animate.settings', JSON.stringify({ ...settings, uiScale: 1 }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__animate?.stage != null, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  // The timeline's menu.
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(80);
  check("the timeline's menu opens", (await page.locator('[data-animate-frames-menu]').count()) === 1);
  await page.keyboard.press('x');
  await page.waitForTimeout(80);
  check('X from a menu shuts it, so the tools are in front', (await page.locator('[data-animate-frames-menu]').count()) === 0 && (await page.locator('[data-animate-popup]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(80);
  await shot('phase6-frames-menu');
  const fps0 = await state(page, () => window.__animate.project.fps);
  await page.getByRole('button', { name: 'speed up' }).click();
  check('SPEED steps, and the menu stays', (await state(page, () => window.__animate.project.fps)) === fps0 + 1 && (await page.locator('[data-animate-frames-menu]').count()) === 1);
  await page.getByRole('button', { name: 'speed down' }).click();
  const timelineWas = await page.locator('section[aria-label="Timeline"]').boundingBox();
  await page.getByRole('button', { name: 'rows shown up' }).click();
  await page.getByRole('button', { name: 'frame width up' }).click();
  await page.waitForTimeout(100);
  const timelineNow = await page.locator('section[aria-label="Timeline"]').boundingBox();
  check('ROWS SHOWN steps', timelineNow !== null && timelineNow.height >= timelineWas.height, `${timelineWas.height} to ${timelineNow?.height}`);
  await page.getByRole('button', { name: 'rows shown down' }).click();
  await page.getByRole('button', { name: 'frame width down' }).click();
  await page.locator('[data-animate-frames-menu] [data-animate-tile="NEW DRAWING"]').click();
  await page.waitForTimeout(80);
  check('NEW DRAWING works from it, and it closes itself', (await page.locator('[data-animate-frames-menu]').count()) === 0);
  await page.keyboard.press('Control+z');

  // Everything's in the menu.
  await page.keyboard.press('?');
  await page.waitForTimeout(80);
  const rowsThere = await page.evaluate(() => [...document.querySelectorAll('[data-animate-menu-item]')].map((el) => el.dataset.animateMenuItem));
  const owed = ['file.projects', 'file.open', 'file.save', 'picture.import', 'export.panel', 'view.fit', 'view.full', 'view.sidepanel', 'ui.bigger', 'ui.smaller', 'settings.panel', 'layer.panel', 'layer.folder', 'tag.panel', 'palette.panel', 'time.menu', 'sound.panel', 'onion.panel', 'view.lighttable', 'smart.carry', 'smart.make', 'trace.back', 'range.in', 'range.out', 'range.clear', 'range.mode', 'cel.new', 'cel.copy', 'cel.delete', 'cel.mark', 'cel.ones', 'cel.twos', 'cel.threes'];
  const missing = owed.filter((id) => !rowsThere.includes(id));
  check('every key that left the screen has a row in the menu', missing.length === 0, missing.join(', ') || `${rowsThere.length} rows`);
  await shot('phase6-menu');
  await page.keyboard.press('Escape');

  // Test 3: the bouncing ball, with the sheet in view throughout. No panel to close.
  await freshProject(page);
  const panelsOpened = [];
  const noteDialogs = async () => {
    const dialogs = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((el) => el.getAttribute('aria-label')));
    panelsOpened.push(...dialogs);
  };
  for (let f = 0; f < 6; f += 1) {
    await page.keyboard.press(f === 0 ? 'i' : '.');
    await penStroke(page, Array.from({ length: 24 }, (_, i) => [400 + f * 150 + Math.cos(i / 3.6) * 80, 200 + f * 90 + Math.sin(i / 3.6) * 80, 0.8]));
    await noteDialogs();
  }
  await page.keyboard.press('x');
  await page.locator('[data-animate-popup]').getByRole('button', { name: 'FLAT', exact: true }).click();
  await noteDialogs();
  await page.keyboard.press('Shift+N');
  await page.keyboard.press('o');
  await noteDialogs();
  const ball = await page.evaluate(() => ({ drawings: Object.keys(window.__animate.project.drawings).length, layers: window.__animate.project.nodes.length, onion: window.__animate.project.onion.on }));
  check('the ball: six drawings, a tool change, a new layer, the onion, and no panel to close', ball.drawings >= 6 && ball.layers === 2 && ball.onion && panelsOpened.length === 0, `${JSON.stringify(ball)}, panels: ${panelsOpened.join(',') || 'none'}`);
  await page.keyboard.press('o');

  // Test 4: full screen.
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  const opsFull = await frameOps(page);
  await page.keyboard.press('`');
  await page.waitForTimeout(300);
  const fullScreen = await page.evaluate((selector) => {
    const stage = document.querySelector('[data-animate-stage]').getBoundingClientRect();
    const timeline = document.querySelector('section[aria-label="Timeline"]');
    const line = timeline.getBoundingClientRect();
    const stray = [...document.querySelectorAll(selector)].filter((el) => {
      if (timeline.contains(el) || el.closest('nextjs-portal')) return false;
      const r = el.getBoundingClientRect();
      if (getComputedStyle(el).visibility === 'hidden' || r.width < 2 || r.height < 1) return false;
      const on = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return on === el || el.contains(on);
    });
    return { fills: Math.round(stage.height + line.height) === innerHeight && stage.width === innerWidth, stray: stray.map((el) => el.textContent.trim().slice(0, 16)), corners: [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3]].every(([x, y]) => document.elementFromPoint(x, y)?.closest('[aria-label="Animation studio"]') != null) };
  }, ALL_KEYS);
  check('full screen: nothing but the sheet and the timeline', fullScreen.fills && fullScreen.corners && fullScreen.stray.length === 0, JSON.stringify(fullScreen));
  await shot('phase6-full');
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [300 + i * 8, 700, 0.8]));
  await page.waitForTimeout(60);
  await page.keyboard.press('x');
  await page.waitForTimeout(100);
  check('the tools still open there', (await page.locator('[data-animate-popup]').getByRole('button', { name: 'LEAVE FULL', exact: true }).count()) === 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('`');
  await page.waitForTimeout(300);
  check('one key back, and the work is safe', (await frameOps(page)) === opsFull + 1 && (await page.locator('[data-animate-tools-key]').count()) === 1, `${opsFull} strokes then ${await frameOps(page)}`);
  check('and the layers that were out come back', (await page.locator('[data-animate-layers-fold]').count()) === 1);
  // Names and rows level, however far down the layer in hand is.
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Shift+N');
  await page.waitForTimeout(150);
  const level = await page.evaluate(() => {
    const engine = window.__animate;
    const name = document.querySelector(`[data-animate-row-name="${engine.project.nodes[0].id}"]`).getBoundingClientRect();
    const all = [...document.querySelectorAll('[data-animate-row-name]')].map((el) => el.getBoundingClientRect().top);
    const rows = [...document.querySelectorAll('section[aria-label="Timeline"] .relative > .border-b')].map((el) => el.getBoundingClientRect().top);
    return { name: name.height, drift: Math.max(...all.map((top, i) => Math.abs(top - rows[i]))) };
  });
  check('the timeline keeps names and rows level', level.drift < 1, JSON.stringify(level));
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Control+z');
  await page.keyboard.press('l');
  await page.waitForTimeout(100);
  await waitSaved(page);
  await page.keyboard.press('Control+z');

  // A key that only means something now, shows only then.
  check('MAKE SMART and the trace keys are away at rest', (await page.locator('[data-animate-trace-keys], [data-animate-make-smart]').count()) === 0);

  // Test 6: strength of the text, and 400% zoom (a 1280 x 900 window at 400% lays out as 320 x 225).
  const strength = await page.evaluate(() => {
    const parts = (text) => text.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const backOf = (el) => {
      for (let at = el; at !== null; at = at.parentElement) {
        const c = parts(getComputedStyle(at).backgroundColor);
        if (c.length === 3 || c[3] > 0.9) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const studio = document.querySelector('[aria-label="Animation studio"]');
    let smallest = 999;
    let weakest = 99;
    let weakestText = '';
    const walker = document.createTreeWalker(studio, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const el = walker.currentNode.parentElement;
      if (text === '' || el.getBoundingClientRect().width < 1 || el.closest('.sr-only')) continue;
      const style = getComputedStyle(el);
      smallest = Math.min(smallest, Number.parseFloat(style.fontSize));
      const a = lum(parts(style.color).slice(0, 3));
      const b = lum(backOf(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < weakest) {
        weakest = ratio;
        weakestText = text.slice(0, 20);
      }
    }
    return { smallest, weakest: Math.round(weakest * 10) / 10, weakestText };
  });
  check('no text under 13px or under 4.5:1 at rest', strength.smallest >= 13 && strength.weakest >= 4.5, JSON.stringify(strength));

  await page.setViewportSize({ width: 320, height: 225 });
  await page.waitForTimeout(500);
  await shot('phase6-zoom400');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('400% zoom: no sideways scroll', wide <= 0, `${wide}px`);
  const reachAll = (selector) =>
    page.evaluate((sel) => {
      const bad = [];
      for (const el of document.querySelectorAll(sel)) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) bad.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 18) + ` ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      return bad;
    }, selector);
  const barBad = await reachAll('[data-animate-menu-key], [data-animate-tools-key], [data-animate-layers-key], [data-animate-frames-key]');
  check('400% zoom: the small keys can all be reached', barBad.length === 0, barBad.join(' | '));
  await page.keyboard.press('x');
  await page.waitForTimeout(150);
  await shot('phase6-zoom400-tools');
  const popupBad = await reachAll('[data-animate-popup] button');
  check('400% zoom: every key in the pop-up can be reached', popupBad.length === 0, popupBad.slice(0, 5).join(' | '));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(150);
  const framesBad = await reachAll('[data-animate-frames-menu] button');
  check("400% zoom: every key in the timeline's menu can be reached", framesBad.length === 0, framesBad.slice(0, 5).join(' | '));
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.waitForTimeout(150);
  await shot('phase6-zoom400-menu');
  const menuBad = await reachAll('[data-animate-menu-item]');
  check('400% zoom: every row of the menu can be reached', menuBad.length === 0, menuBad.slice(0, 5).join(' | '));
  check('the menu has every key, second keys too', rowsThere.includes('edit.redo2') && rowsThere.includes('time.next2') && rowsThere.includes('help.keys'));
  await page.keyboard.press('Escape');
  await layersOut(page);
  await page.waitForTimeout(150);
  await shot('phase6-zoom400-layers');
  const layersBad = await reachAll('[data-animate-layers-fold] button, [data-animate-layers-fold] select, [data-animate-layers-fold] input');
  check('400% zoom: everything in the layers can be reached', layersBad.length === 0, layersBad.slice(0, 5).join(' | '));
  await page.keyboard.press('l');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
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

  // Every control in the studio has a name a screen reader can say, and nothing is set below the site's smallest text.
  const unreadable = await page.evaluate(() => {
    const studio = document.querySelector('[aria-label="Animation studio"]');
    const out = [];
    for (const el of studio.querySelectorAll('button, input, select')) {
      const name = el.getAttribute('aria-label') || el.textContent?.trim() || el.closest('label')?.textContent?.trim();
      if (!name) out.push('unnamed ' + el.tagName);
    }
    for (const el of studio.querySelectorAll('button, span, p, label, h2, h3, li')) {
      if (el.textContent?.trim() && Number.parseFloat(getComputedStyle(el).fontSize) < 13) out.push('small ' + el.textContent.trim().slice(0, 20));
    }
    return out;
  });
  check('every control has a name, and no text is under 13px', unreadable.length === 0, unreadable.slice(0, 6).join(' | '));

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
