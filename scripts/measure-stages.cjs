/**
 * Measure each render stage from the SCREENSHOT, which is the only reading that reflects what a person sees.
 *
 * **Why not `readPixels` on the canvas per stage.** `canvas.getContext('webgl2')` called from outside r3f does not
 * return r3f's context - the canvas already has one, and asking again yields an object whose drawing buffer this
 * code never rendered to, so it reads all zeros even while the pane is visibly full. The in-frame read in
 * `cdp-look.cjs` works because it runs against r3f's own context during its frame; a second context cannot be had
 * for the same canvas. That is why `--stages` reports `0 drawn` for every stage while the panes are correct - a
 * limitation of that probe, not a statement about the stage.
 *
 * A screenshot has no such problem: it is the composited page. So this clicks each stage, captures, and counts
 * distinct colours inside each pane. Two colours means the void alone; more means geometry is drawn.
 *
 * Run: node scripts/measure-stages.cjs [--url <address>]
 */
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Socket, getJson } = require('./cdp-socket.cjs');
const { readPng } = require('./png-read.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const argv = process.argv.slice(2);
const at = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const url = at('--url', 'http://localhost:3100/probe-character');
const profile = path.join('Temp', 'browse', 'stage-profile');
const PORT = 9338;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((candidate) => existsSync(candidate));

if (!CHROME) {
  console.log('NO BROWSER found');
  process.exit(2);
}

rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

/** Count distinct colours inside a box, and how much of it is not the dominant one. */
function measure(image, box) {
  const counts = new Map();
  for (let y = box.y + 2; y < Math.min(box.y + box.h - 2, image.height); y += 2) {
    for (let x = box.x + 2; x < Math.min(box.x + box.w - 2, image.width); x += 2) {
      const offset = (y * image.width + x) * image.channels;
      const key = `${image.pixels[offset]},${image.pixels[offset + 1]},${image.pixels[offset + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);
  const drawn = total - (sorted[0]?.[1] ?? 0);
  return {
    colours: sorted.length,
    percent: total === 0 ? 0 : Math.round((drawn / total) * 1000) / 10,
    top: sorted.slice(0, 3).map(([colour, count]) => `rgb(${colour}) x${count}`),
  };
}

async function main() {
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${path.resolve(profile)}`,
      '--headless=new',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=1440,1200',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let socket;
  try {
    let targets = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        targets = await getJson(PORT, '/json/list');
        if (targets.some((target) => target.type === 'page')) break;
      } catch {
        /* waiting */
      }
      await sleep(500);
    }

    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('no page target');

    socket = await Socket.connect(page.webSocketDebuggerUrl);
    await socket.send('Page.enable');
    await socket.send('Runtime.enable');
    await socket.send('Page.navigate', { url });
    await sleep(9000);

    // The pane rectangles, read from the page rather than guessed.
    const boxesResult = await socket.send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }))`,
      returnByValue: true,
    });

    const panes = JSON.parse(boxesResult.result.value);
    console.log(`url    : ${url}`);
    console.log(`panes  : ${panes.length}`);
    console.log('');

    for (const stage of ['MASS', 'BASE', 'PIXEL']) {
      /**
       * **Click the render-stage button, not the edit row that starts with the same word.**
       *
       * `startsWith('MASS')` matches `MASS GEOMETRY` - the edit-layer row - as well as `MASS`, the stage button.
       * The first version therefore clicked the *edit* row for MASS and BASE (leaving the stage on BASE, so both
       * readings were BASE's, byte-identical) and clicked past PIXEL entirely. A selector that is ambiguous
       * between two controls with the same first word is the whole bug, and the numbers agreeing to the pixel is
       * what exposed it.
       *
       * The stage buttons are the ones inside the `WHAT IS DRAWN` fieldset, so that is what is scoped to.
       */
      const clicked = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          const fieldset = [...document.querySelectorAll('fieldset')].find(
            (f) => f.innerText.includes('WHAT IS DRAWN')
          );
          if (!fieldset) return 'NO FIELDSET';
          const button = [...fieldset.querySelectorAll('button')].find(
            (b) => b.innerText.trim().startsWith('${stage}') && !b.getAttribute('aria-label')
          );
          if (!button) return 'NO STAGE BUTTON';
          button.click();
          return 'ok';
        })()`,
        returnByValue: true,
      });

      if (clicked.result.value !== 'ok') {
        console.log(`  ${stage.padEnd(6)} -> ${clicked.result.value}`);
        continue;
      }

      /**
       * Wait for the click to be *reflected*, not just issued, and say what the page thinks is active.
       *
       * **The first version of this produced byte-identical readings for MASS and BASE** - the same 3 colours and
       * the same counts, to the pixel - which looked like "the material does not switch" and was really "the
       * screenshot was taken before the frame was redrawn". Identical numbers for two different requests is the
       * tell: a real render differs at least slightly. So this waits, then asserts the pressed button is the one
       * just clicked, and prints it - a stage reading is meaningless if the stage never changed.
       */
      await sleep(3500);

      const state = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          const fieldset = [...document.querySelectorAll('fieldset')].find(
            (f) => f.innerText.includes('WHAT IS DRAWN')
          );
          const lit = fieldset
            ? [...fieldset.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true')
            : [];
          return lit.map((b) => b.innerText.trim().split(String.fromCharCode(10))[0].trim()).join(' + ');
        })()`,
        returnByValue: true,
      });

      const active = state.result.value || 'nothing lit in the stage group';
      const activeIsStage = active.startsWith(stage);
      console.log(`  ${stage}  (stage group says: ${active}${activeIsStage ? '' : '  <- NOT this stage'})`);

      const shot = await socket.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join('Temp', 'browse', `stage-${stage.toLowerCase()}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));

      const image = readPng(file);
      if (image.error) {
        console.log(`    PNG ${image.error}`);
        continue;
      }

      panes.forEach((pane, index) => {
        const reading = measure(image, pane);
        console.log(
          `    pane ${index}: ${reading.colours <= 2 ? 'EMPTY' : 'drawn'} - ` +
            `${reading.colours} colours, ${reading.percent}% not background`,
        );
        console.log(`      ${reading.top.join('   ')}`);
      });
    }

    console.log('');
    console.log('NOT PROVEN: that any of it is a figure, or a good one.');
    console.log('  Colours in a pane mean geometry is drawn. What shape is a question for a person;');
    console.log('  the per-stage PNGs are in Temp/browse/ for exactly that.');
  } finally {
    if (socket) socket.close();
    child.kill();
  }
}

main().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});
