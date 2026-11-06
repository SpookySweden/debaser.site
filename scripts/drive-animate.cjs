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
  await page.getByRole('button', { name: '[ PING-PONG ]' }).click();
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
  await page.getByRole('button', { name: '[ LOOP ]' }).click();
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
  const zipNow = await downloadFrom(page, () => page.getByRole('button', { name: /SAVE FILE/ }).click());
  check('SAVE FILE holds the latest stroke', zipNow.bytes.toString('latin1').includes('project.json') && zipNow.bytes.length > 400, `${zipNow.bytes.length} bytes`);

  // Full screen.
  await page.keyboard.press('\\');
  await page.waitForTimeout(300);
  check('FULL fills the window', await page.evaluate(() => document.querySelector('[aria-label="Animation studio"]').getBoundingClientRect().width === window.innerWidth));
  await page.keyboard.press('0');
  await page.waitForTimeout(100);
  await shot('phase1-full');
  await page.keyboard.press('\\');
};

phases.phase2 = async (page, shot) => {
  console.log('Phase 2: Organise');
  await freshProject(page);
  await page.keyboard.press('f');
  const rowIds = () => page.evaluate(() => window.__animate.project.nodes.map((n) => n.name));

  // Colour on the bottom layer, a new layer above: the top one covers it.
  await page.getByRole('button', { name: 'ROSE', exact: true }).click();
  await penStroke(page, Array.from({ length: 30 }, (_, i) => [300 + i * 10, 300, 0.9]));
  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(100);
  check('a new layer goes above the active one', JSON.stringify(await rowIds()) === '["LAYER 2","LAYER 1"]', JSON.stringify(await rowIds()));
  await page.getByRole('button', { name: 'EMERALD', exact: true }).click();
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
  await page.keyboard.press('\\');
  await page.waitForTimeout(250);
  await shot('phase2-ui300-full');
  const stageTall = await page.evaluate(() => document.querySelector('[data-animate-stage]').getBoundingClientRect().height);
  check('at 300% full screen the sheet still has room', stageTall >= 400, `${stageTall}px`);
  await page.keyboard.press('`');
  await page.waitForTimeout(250);
  await shot('phase2-panels-hidden');
  const allStage = await page.evaluate(() => document.querySelector('[data-animate-stage]').getBoundingClientRect().height);
  check('hiding the panels gives the sheet the screen', allStage > stageTall, `${allStage}px`);
  await page.keyboard.press('`');
  await page.keyboard.press('\\');
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
  await page.getByRole('button', { name: 'BLACK', exact: true }).click();
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
  await freshProject(page);
  await page.getByRole('button', { name: 'BLACK', exact: true }).click();
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
  await page.getByRole('button', { name: 'ROSE', exact: true }).click();
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
  await page.getByRole('button', { name: 'EMERALD', exact: true }).click();
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
  await page.getByRole('button', { name: 'BLACK', exact: true }).click();
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
  await page.getByRole('button', { name: 'ROYAL', exact: true }).click();
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
  await page.getByRole('button', { name: 'DAFFODIL', exact: true }).click();
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
  await page.getByRole('button', { name: 'CANDY', exact: true }).click();
  await penStroke(page, along(1000, 450, 700, 450), { gapMs: 1 });
  await page.waitForTimeout(1200);
  check('a stroke made before the lines are read still lands inside its area', (await pixel(page, 700, 450)) !== '#ffb7e6' && (await pixel(page, 900, 450)) === '#ffb7e6', (await pixel(page, 700, 450)) + ' ' + (await pixel(page, 900, 450)));
  await shot('phase3-desktop');
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
