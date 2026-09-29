/**
 * Measure the panes in the screenshot, which is the only place the *composited* result exists.
 *
 * `scripts/png-read.cjs` decodes the PNG with no dependency; this counts the distinct colours inside each canvas's
 * bounding box. A pane showing the background clear alone has **one** colour. A pane with a figure in it has
 * several - the palette is nine colours and the figure is drawn in them - so the count separates "empty" from
 * "something is drawn" without anybody having to look.
 *
 * It still cannot say the figure is a *person*, or that it looks right. It says pixels of more than one colour
 * are inside the pane.
 *
 * Usage: node scripts/measure-panes.cjs [--png <file>] [--url <address>]
 */
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { readPng } = require('./png-read.cjs');
const { Socket, getJson } = require('./cdp-socket.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const argv = process.argv.slice(2);
const at = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const url = at('--url', 'http://localhost:3100/probe-character');
const png = path.resolve(at('--png', path.join('Temp', 'browse', 'panes.png')));
const profile = path.join('Temp', 'browse', 'measure-profile');

mkdirSync(path.dirname(png), { recursive: true });
require('node:fs').rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((candidate) => existsSync(candidate));

if (!CHROME) {
  console.log('NO BROWSER found');
  process.exit(2);
}

const PORT = 9336;

async function main() {
  const child = require('node:child_process').spawn(
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
    const boxes = await socket.send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }))`,
      returnByValue: true,
    });

    const panes = JSON.parse(boxes.result.value);
    console.log(`panes: ${panes.length}`);
    for (const pane of panes) console.log(`  ${pane.w}x${pane.h} at ${pane.x},${pane.y}`);

    const shot = await socket.send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync(png, Buffer.from(shot.data, 'base64'));

    const image = readPng(png);
    if (image.error) {
      console.log(`PNG: ${image.error}`);
      return;
    }

    console.log('');
    console.log(`image: ${image.width}x${image.height}, ${image.channels} channels`);
    console.log('');

    panes.forEach((pane, index) => {
      const counts = new Map();
      let sampled = 0;

      for (let y = pane.y + 2; y < Math.min(pane.y + pane.h - 2, image.height); y += 2) {
        for (let x = pane.x + 2; x < Math.min(pane.x + pane.w - 2, image.width); x += 2) {
          const offset = (y * image.width + x) * image.channels;
          const key = `${image.pixels[offset]},${image.pixels[offset + 1]},${image.pixels[offset + 2]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          sampled += 1;
        }
      }

      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const background = sorted[0];
      const other = sampled - (background?.[1] ?? 0);
      const percent = sampled === 0 ? 0 : Math.round((other / sampled) * 1000) / 10;

      console.log(`pane ${index}: ${sorted.length} distinct colours, ${percent}% not the background`);
      console.log(`  dominant rgb(${background?.[0]}) covers ${background?.[1]}/${sampled}`);
      console.log(`  next: ${sorted.slice(1, 4).map(([colour, count]) => `rgb(${colour}) x${count}`).join(', ')}`);
    });

    console.log('');
    console.log('NOT PROVEN: that what is drawn is a figure, or a good one.');
    console.log('  Several colours inside a pane means *something* is rendered there.');
    console.log('  What shape it makes is a question for a person looking at ' + path.basename(png) + '.');
  } finally {
    if (socket) socket.close();
    child.kill();
  }
}

main().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});
