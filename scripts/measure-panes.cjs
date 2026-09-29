/**
 * Measure the panes in a screenshot, which is the only place the *composited* result exists.
 *
 * `scripts/png-read.cjs` decodes the PNG with no dependency; this counts the distinct colours inside a
 * rectangle. A pane showing the background clear alone has **one** colour. A pane with a figure in it has
 * several - the palette is nine colours, and the figure is drawn in them - so the count separates "empty"
 * from "something is drawn" without a browser reading the drawing buffer at all.
 *
 * **Two modes, and the difference between them is whether a browser is started:**
 *
 *     npm run panes                      capture, then measure it (starts Chrome)
 *     npm run panes -- --out f.png       the same, into a named file
 *     npm run panes -- --png f.png       measure a PNG that is already on disk, and start nothing
 *     npm run panes -- --png --box 0,0,120,120   the newest capture, one rectangle
 *
 * `--png` with no value means the newest PNG in `Temp/browse/`. **A `--png` file that is not there is a
 * refusal, not a capture** - and that is not a nicety: this tool used to launch Chrome for any run and
 * write its capture to the very path it had been asked to read, so `--png stage-mass.png` returned a pane
 * count for a file the tool had itself just overwritten. A measurement of a file the measurer wrote proves
 * nothing about the file that was asked for, and the two are indistinguishable afterwards.
 *
 * **The default address is the local account page, and it used to be a dead one.** It was
 * `http://localhost:3100/probe-character` - a page that has not existed since the probe it was named after
 * was deleted, on a port that is not the one the local server uses. So the bare `npm run panes` launched a
 * browser, was refused by nothing listening, and its own refusal told the reader to check the address. The
 * two things it got wrong are now one thing: `localhost:3210` is the local server (`npm run capture` uses
 * the same port), and `--signin`/`--click` reach a screen whose canvas only appears after a press, which is
 * every canvas on this site.
 *
 * **The refusal on a page that did not answer is the shared one** (`scripts/browser.cjs`), because Chrome's
 * own error page is a page: it renders, it has a body, and it answers `0` canvases - a zero that reads as
 * "the pane is empty" when the truth is "there was no server". `--allow-error-page` captures the refusal
 * deliberately.
 *
 * Usage:
 *   node scripts/measure-panes.cjs [--png [file]] [--box x,y,w,h]...
 *   node scripts/measure-panes.cjs --url <address> [--out <file>] [--width n] [--height n] [--at ms]
 *   node scripts/measure-panes.cjs --url <address> --signin --click "[ CUSTOMISE PUBLIC PROFILE ]"
 */
const { existsSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { readPng } = require('./png-read.cjs');
const {
  capture,
  click,
  close,
  flags,
  goto,
  holdsSession,
  mustFind,
  noAnswerOf,
  open,
  report: reportPage,
  signInPage,
  sleep,
} = require('./browser.cjs');

const { all, at, has, number } = flags();

const BROWSE = path.join('Temp', 'browse');

/** The canvases on the page, as rectangles - read from the page rather than guessed. */
const PANE_QUERY = `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => {
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}))`;

/** The most recently written PNG in the scratch folder - what a bare `--png` means. */
function newestShot(dir = BROWSE) {
  if (!existsSync(dir)) return null;

  const shots = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .map((name) => ({ file: path.join(dir, name), at: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  return shots[0] ? path.resolve(shots[0].file) : null;
}

/**
 * `--png` on its own means the newest capture, `--png f.png` means that file, and no `--png` at all
 * means "capture one". The distinction is the whole reason the flag exists, so it is read in one place.
 */
function askedPng() {
  if (!has('--png')) return null;

  const named = at('--png', null);
  if (!named || named.startsWith('--')) return newestShot();

  return path.resolve(named);
}

/** `--box x,y,w,h`, repeatable; with no `--box` the whole image is the one pane. */
function boxesFrom(image) {
  const given = all('--box');

  if (given.length === 0) return [{ x: 0, y: 0, w: image.width, h: image.height }];

  return given.map((raw) => {
    const [x, y, w, h] = raw.split(',').map(Number);

    return { x, y, w, h };
  });
}

/**
 * The browser path: open, arrive, press what it takes to reach a canvas, read the pane rectangles, capture.
 *
 * `goto` is where a page that did not answer **throws instead of returning**, and that is the whole reason
 * the capture goes through it: the throw happens before any file exists, so a refusal cannot land in the
 * captures folder wearing the name of a page that worked.
 */
async function capturePanes(out) {
  const url = at('--url', 'http://localhost:3210/account');
  const width = number('--width', 1440);
  const height = number('--height', 1200);
  const settle = number('--settle', number('--at', 9000));
  const attach = has('--attach');
  const signIn = has('--signin');
  const reuse = has('--reuse');
  const presses = all('--click');
  const within = at('--within', null);
  let session = null;

  try {
    session = await open({
      size: [width, height],
      attach,
      profile: path.join(BROWSE, 'measure-profile'),
      keepProfile: attach,
    });

    if (signIn && !attach) {
      const account = await signInPage(session.page, { label: 'cline-panes' });
      if (account.error) {
        console.log(`session: NO - ${account.error}`);
        return { panes: null, file: null, error: account.error };
      }

      console.log(`session: ${account.userId} - left behind for \`npm run db:sweep\``);
    }

    const arrival = await goto(session.page, url, { settle, allowErrorPage: has('--allow-error-page') });
    console.log(`arrived: ${arrival.title} - ${arrival.href}`);

    if (reuse || attach) {
      const held = await holdsSession(session.page);
      console.log(`session: ${held ? 'the profile already holds one' : 'NONE - a screen behind a session will not open'}`);

      if (signIn && !held) {
        const account = await signInPage(session.page, { label: 'cline-panes' });
        if (account.error) return { panes: null, file: null, error: account.error };

        console.log(`session: ${account.userId} - left behind for \`npm run db:sweep\``);
        await goto(session.page, url, { settle });
      }
    }

    // The presses that reach a canvas, in the order they were given, each one failing the run if the
    // control is not there.
    for (const plate of presses) {
      const found = await mustFind(session.page, plate, { within, allowAmbiguous: true });
      await click(session.page, found.x, found.y);
      console.log(`press  : ${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y} (matched by ${found.how})`);
      await sleep(1500);
    }

    /*
     * `--allow-error-page` means "keep the refusal", and the refusal has no `<canvas>` in it - so the pane
     * query must not be asked. Asking it is what a first version did, and it answered with a
     * `Runtime.evaluate` timeout, which reads as a fault in the tool rather than "this is an error page".
     * The whole image is measured instead, which is the only pane such a page has.
     */
    if (noAnswerOf(await session.page.evaluate(`(() => ({ href: location.href, documentClass: document.documentElement.className }))()`)) !== null) {
      console.log('THE PAGE THAT ANSWERED IS AN ERROR PAGE: --allow-error-page keeps it; there are no panes on it');
      await capture(session.page, { out });

      return { panes: null, file: out };
    }

    const panes = JSON.parse((await session.page.evaluate(PANE_QUERY)) ?? '[]');
    await capture(session.page, { out });

    reportPage(session.log);

    return { panes, file: out };
  } finally {
    await close(session, { keep: attach });
  }
}

/**
 * The reading itself. A pane measured from a file on disk and a pane measured from a live capture come
 * through this one function, so the two modes cannot drift into disagreeing about what a pane is.
 */
function report(file, panes) {
  const image = readPng(file);

  if (image.error) {
    console.log(`PNG: ${image.error}`);
    console.log('  Nothing was measured: a file that will not decode has no panes.');
    process.exitCode = 1;
    return;
  }

  if (panes === null) panes = boxesFrom(image);

  /* A page with no canvas is not an empty pane, and the difference is worth saying out loud. */
  if (panes.length === 0) {
    console.log('');
    console.log('0 canvases on that page: this tool has nothing to measure there.');
    console.log('  A page with no <canvas> is a page with no pane, not a pane that drew nothing.');
    console.log('  If the canvas appears behind a press, name it: --click "[ CUSTOMISE PUBLIC PROFILE ]"');
    return;
  }

  console.log('');
  console.log(`${panes.length} pane(s) to measure:`);
  for (const pane of panes) console.log(`  ${pane.w}x${pane.h} at ${pane.x},${pane.y}`);
  console.log('');
  console.log(`image: ${path.relative(process.cwd(), file) || file} ${image.width}x${image.height}, ${image.channels} channels`);
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
  console.log('  What shape it makes is for whoever reads the image - this count cannot tell two colours from a person.');
}

async function main() {
  const asked = askedPng();
  const out = path.resolve(at('--out', path.join(BROWSE, 'panes.png')));

  /*
   * The refusal that matters most: a `--png` file that is not there. Capturing into the path just asked
   * for would make the answer true of the wrong file, and nothing afterwards could tell the two apart.
   */
  if (asked !== null && !existsSync(asked)) {
    console.log(`NO SUCH CAPTURE: ${path.relative(process.cwd(), asked) || asked}`);
    console.log('  `--png` reads a file that is already on disk; it never captures one.');
    console.log('  Nothing was captured and nothing was written. Drop `--png` to capture a fresh image.');
    process.exit(1);
  }

  let panes = null; // `--box`, or the whole image: decided in report()

  if (asked !== null) {
    console.log(`reading ${path.relative(process.cwd(), asked) || asked} - no browser started, nothing written`);
  } else {
    const captured = await capturePanes(out);
    if (captured.error) process.exit(3);

    panes = captured.panes;
  }

  report(asked ?? out, panes);
}

main().catch((error) => {
  if (error.noAnswer) {
    console.log(`REFUSED: ${error.message}`);
    console.log('  Nothing was written. Chrome\'s own error page renders, has a body, and answers 0');
    console.log('  canvases - a zero that reads as "the pane is empty". Pass --allow-error-page to keep it.');
    process.exit(1);
  }

  console.log('FAILED: ' + error.message);
  process.exit(1);
});


