/**
 * Point Chrome at the workbench and ask the page what is actually there.
 *
 * **Why this file exists, and why its absence was a wrong answer for a whole session.** The answer to "does the
 * figure render?" was "no headless verification available", based on Puppeteer failing with *"Could not find
 * expected browser (chrome) locally"*. That message is about **Puppeteer's download cache** being empty; it says
 * nothing about the machine. Chrome is installed at `Program Files` and has `--remote-debugging-port`, which
 * needs no Puppeteer, no download and no `node_modules`.
 *
 * Two things this reaches that nothing else here can:
 *
 *   - **It runs JavaScript.** Every other check renders markup on the server, where `CharacterEditorPanel` is
 *     `ssr: false` and emits the literal string `LOADING THE WORKBENCH...`. The canvas and the figure were
 *     unreachable *by construction*, not merely unreached.
 *   - **It reads the drawing buffer.** `readPixels` separates "a canvas element exists" from "something was drawn
 *     into it", which no source check and no server render can tell apart.
 *
 * **The read happens inside a `requestAnimationFrame`, and that is load-bearing.** A WebGL drawing buffer is
 * cleared when it is presented unless the context was created with `preserveDrawingBuffer`, so a read from
 * outside a frame legitimately returns all zeros on a perfectly drawn figure. The first run of this probe
 * reported `0/72072` and that number alone did not distinguish "nothing was drawn" from "the probe looked at the
 * wrong moment".
 *
 * **What changed when this moved onto `scripts/browser.cjs`.** It is a rewrite rather than a transliteration, so
 * say what is different: the presses are **real presses at a control's own coordinates** instead of
 * `element.click()`, which means hit-testing is exercised; and the control search now prefers an exact or
 * *prefix* match, which is what stops `MASS` from finding the palette's help text (*BUILD A FIGURE FROM A
 * SKELETON AND THE MASS HUNG*) - the wrong press that made three stages read byte-identically. The old
 * `--force-frames` and `--invalidations` probes are gone: the first was a workaround for a `frameloop="demand"`
 * scene that no longer exists and the second is what `--stages` now does with a real press. `--stages` and
 * `--dump` are kept.
 *
 * What it still cannot do, and the output says so: **it cannot judge.** Pixels on the canvas means the renderer
 * ran, not that it drew a person, and not that the person looks right. It cannot hover, drag or press anything
 * that is not a control it can find by its text, and the still it writes is read by `scripts/png-read.cjs` (a
 * colour count per box) and by a person (what shape those colours make) - never by this file.
 *
 * **A page that did not answer is a refusal, not an empty page** (`scripts/browser.cjs`). Chrome's own error page
 * renders, has a body, and answers `0` canvases, so a probe pointed at a dead address reports `no` for every row
 * below and writes a screenshot of *"This site can't be reached"*. That is not hypothetical: it is how
 * `Temp/browse/account.png` came to exist, under the name of a page that worked. The arrival throws before the
 * capture is written now, and `--allow-error-page` keeps the refusal on purpose.
 *
 * Run:
 *   node scripts/look.cjs [--url <address>] [--out <file.png>] [--allow-error-page]
 *   node scripts/look.cjs --signin           a throwaway session, so `/account` opens the customiser
 *   node scripts/look.cjs --attach           use the session `npm run browser -- --start` left running
 *   node scripts/look.cjs --stages           press each render stage and read the buffer after each
 *   node scripts/look.cjs --dump             print the buttons and headings the page actually has
 *   node scripts/look.cjs --no-click         do not press the CHAR tab
 */
const path = require('node:path');
const {
  capture,
  click,
  close,
  flags,
  goto,
  holdsSession,
  mustFind,
  open,
  report,
  signInPage,
  sleep,
} = require('./browser.cjs');

/**
 * The probe, evaluated in the page: the DOM, and then the drawing buffer **inside a frame**, because that is
 * the only moment at which the buffer is guaranteed to hold the frame that was presented.
 */
const PROBE = `(async () => {
  const canvas = document.querySelector('canvas');
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));

  const read = await new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (!gl) {
        resolve({ sampled: 0, drawn: 0, colours: 0, top: [] });
        return;
      }

      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      /*
       * **How many COLOURS, not how many lit pixels.** The first version of this counted alpha > 0 and
       * reported 21112/21112 for MASS, BASE and PIXEL alike - every pixel - because the canvas has an opaque
       * clear colour, so alpha is non-zero across the whole buffer whether or not anything was drawn into it.
       * A reading that cannot separate a wireframe from the lit composer is a statement about the probe, not
       * about the stage; a colour count separates them the same way the screenshot reading does.
       */
      const counts = new Map();

      for (let index = 0; index < pixels.length; index += 16) {
        const key = pixels[index] + ',' + pixels[index + 1] + ',' + pixels[index + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      let sampled = 0;
      let dominant = 0;

      for (const count of counts.values()) {
        sampled += count;
        if (count > dominant) dominant = count;
      }

      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

      resolve({
        sampled,
        colours: counts.size,
        drawn: sampled - dominant, // what is not the clear colour
        top: sorted.slice(0, 3).map(([colour, count]) => colour + ' x' + count),
      });
    });
  });

  return {
    text: document.body.innerText.slice(0, 4000),
    canvasCount: document.querySelectorAll('canvas').length,
    canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
    hasGL: Boolean(gl),
    glVersion: gl ? gl.getParameter(gl.VERSION) : null,
    sampled: read.sampled,
    drawn: read.drawn,
    colours: read.colours,
    top: read.top,
    nodes: document.querySelectorAll('*').length,
  };
})()`;

const { at, has } = flags();

const url = at('--url', 'https://debaser-site.vercel.app/account');
const outFile = path.resolve(at('--out', path.join('Temp', 'browse', 'account.png')));
const settle = Number(at('--at', 9000));
const attach = has('--attach');
const signIn = has('--signin');
const reuse = has('--reuse');

/** The rows, in one place, so the two callers (arrival and per-stage) cannot drift apart. */
function printRows(label, reading) {
  console.log(
    `${label.padEnd(8)}: canvas=${reading.canvasCount} ${reading.canvasSize ?? '-'} ` +
      `webgl=${reading.hasGL ? 'yes' : 'NO'} ${reading.glVersion ?? ''}`,
  );
  console.log(
    `${' '.repeat(8)}  in-frame: ${reading.colours} distinct colours, ` +
      `${reading.drawn}/${reading.sampled} not the clear ` +
      `${reading.sampled === 0 ? '(nothing to read)' : reading.drawn === 0 ? '(NOTHING DRAWN)' : ''} nodes=${reading.nodes}`,
  );
  if (reading.top?.length > 0) console.log(`${' '.repeat(8)}  ${reading.top.join('   ')}`);
}

async function main() {
  let browser = null;

  try {
    browser = await open({ size: [1440, 2400], attach, keepProfile: attach });

    if (browser.attached) console.log(`attached : port ${browser.port} - stateful, so this is not a first visit`);

    if (signIn && !attach) {
      const account = await signInPage(browser.page, { label: 'cline-look' });

      if (account.error) {
        console.log(`session  : NO - ${account.error}`);
        process.exitCode = 3;
        return;
      }

      console.log(`session  : ${account.userId} - left behind for \`npm run db:sweep\``);
    }

    await goto(browser.page, url, { settle, allowErrorPage: has('--allow-error-page') });
    console.log(`url      : ${url}`);

    if (reuse || attach) {
      const held = await holdsSession(browser.page);
      console.log(
        `session  : ${held ? 'the profile already holds one' : 'NONE - the customiser will not open, so the workbench is unreachable'}`,
      );

      if (signIn && !held) {
        const account = await signInPage(browser.page, { label: 'cline-look' });
        if (account.error) {
          console.log(`session  : NO - ${account.error}`);
          process.exitCode = 3;
          return;
        }

        console.log(`session  : ${account.userId} - left behind for \`npm run db:sweep\``);
        await goto(browser.page, url, { settle });
      }
    }

    /**
     * The CHAR tab has to be pressed before the workbench exists, and finding that out was the point of running
     * this. The customiser opens on `[ PICTURE, BIO & TAGS ]`; `[ CHAR ]` is the third of three, so a probe that
     * never clicks will always report "the sidebar did not render" - which says nothing about the sidebar.
     *
     * It presses by *text*, the way a reader does, so it breaks if the tab is renamed rather than if the styling
     * moves. `--no-click` skips it, for checking what the first tab looks like.
     */
    if (!has('--no-click')) {
      for (const plate of ['CUSTOMISE PUBLIC PROFILE', 'CHAR']) {
        const found = await mustFind(browser.page, plate, { allowAmbiguous: true });
        await click(browser.page, found.x, found.y);
        console.log(`press    : ${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y} (matched by ${found.how})`);
        // The dynamic import and the first WebGL frame both land after the press.
        await sleep(7000);
      }
    }

    printRows('probe', await browser.page.evaluate(PROBE));

    /**
     * Dump what the page actually is before judging it. The first run reported *"a CHAR tab: YES"* while
     * `querySelectorAll('button')` could not find one - so those two facts disagreed and the disagreement was the
     * useful part. `CHAR` appears in the board's own text (it is a word), and `innerText` includes hidden panels.
     * Printing the buttons and the headings is what turns "some string is present" into "this is what is on the
     * screen", and it is how the missing customiser was found.
     */
    if (has('--dump')) {
      const dump = await browser.page.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')].map((b) => b.innerText.trim().slice(0, 48));
        const heads = [...document.querySelectorAll('h1,h2,h3,[class*="TITLE"]')].map((h) => h.innerText.trim().slice(0, 48));
        return 'BUTTONS (' + buttons.length + '):\\n  ' + buttons.join('\\n  ') +
               '\\nHEADINGS (' + heads.length + '):\\n  ' + heads.slice(0, 12).join('\\n  ') +
               '\\nTEXT START: ' + document.body.innerText.slice(0, 700);
      })()`);

      console.log('');
      console.log(dump);
    }

    /**
     * **Test the render paths one at a time, because two faults can mask each other.** The `Outline` warning is
     * gone after adding `autoClear={false}` and a stage can still be empty, so this walks MASS (wireframe), BASE
     * (flat solid) and PIXEL (lit + composer) and re-reads after each - which is what separates "no renderer runs"
     * from "one stage is broken". The press is scoped to the stage group and the group's own state is printed,
     * because `MASS` also appears in the palette's help text.
     */
    if (has('--stages')) {
      console.log('');
      console.log('per stage:');

      for (const stage of ['MASS', 'BASE', 'PIXEL']) {
        const found = await mustFind(browser.page, stage, { within: 'WHAT IS DRAWN', allowAmbiguous: true });
        await click(browser.page, found.x, found.y);
        console.log(`  pressed ${found.label.replace(/\n/g, ' ').slice(0, 44)} at ${found.x},${found.y} (${found.how})`);
        await sleep(3000);

        const lit = await browser.page.evaluate(`(() => {
          const fieldset = [...document.querySelectorAll('fieldset')].find((f) => f.innerText.includes('WHAT IS DRAWN'));
          return fieldset
            ? [...fieldset.querySelectorAll('button')]
                .filter((b) => b.getAttribute('aria-pressed') === 'true')
                .map((b) => b.innerText.trim().slice(0, 16))
                .join(' + ')
            : 'no fieldset';
        })()`);

        console.log(`  stage group says: ${lit}`);
        printRows(`  ${stage}`, await browser.page.evaluate(PROBE));
      }
    }

    const shot = await capture(browser.page, { out: outFile });
    console.log('');
    console.log(`wrote    : ${path.relative(process.cwd(), shot.file)} (${shot.bytes} bytes)`);

    report(browser.log);

    console.log('');
    console.log('NOT PROVEN: that what was drawn is a figure, or a good one.');
    console.log('  Pixels in the buffer mean the renderer ran. What shape they make is for whoever reads the');
    console.log('  file - the capture above is the composited page, which is a different question again.');
  } finally {
    await close(browser, { keep: attach });
  }
}

main().catch((error) => {
  if (error.noAnswer) {
    console.log(`REFUSED: ${error.message}`);
    console.log('  Nothing was written: a capture of the browser\'s own error page under the name of a page');
    console.log('  that worked is how Temp/browse/account.png came to exist. --allow-error-page keeps it.');
    process.exit(1);
  }

  console.log('FAILED: ' + error.message);
  process.exit(1);
});

