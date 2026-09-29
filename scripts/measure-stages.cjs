/**
 * Measure each render stage from the SCREENSHOT, which is the only reading that reflects what a person sees.
 *
 * **Why not `readPixels` on the canvas per stage.** `canvas.getContext('webgl2')` called from outside r3f does
 * not return r3f's context - the canvas already has one, and asking again yields an object whose drawing
 * buffer this code never rendered to, so it reads all zeros even while the pane is visibly full. The
 * in-frame read in `scripts/look.cjs` works because it runs against r3f's own context during its frame; a
 * second context cannot be had for the same canvas. That is why `--stages` reports `0 drawn` for every stage
 * while the panes are correct - a limitation of that probe, not a statement about the stage.
 *
 * A screenshot has no such problem: it is the composited page. So this presses each stage, captures, and
 * counts distinct colours inside each pane. Two colours means the void alone; more means geometry is drawn.
 * It also counts **greys inside a pane**, which the palette does not contain - the two-tone figure is violet,
 * and a lambert light scales a colour's channels together, so it can never produce r=g=b from a dye. A grey
 * in a pane is a colour this site does not own. (A grey elsewhere in the page is usually anti-aliased small
 * text, which is why the count is per-pane rather than per-image.)
 *
 * **The stage press is scoped, and that is the one thing this file exists to get right.** `MASS` and
 * `MASS GEOMETRY` share their first word, so an unscoped press lands on the edit row: a run of
 * `npm run shot -- --click MASS` reported, in its own transcript, pressing *BUILD A FIGURE FROM A SKELETON
 * AND THE MASS HUNG* - the palette's help text - and captured a picture of an unchanged stage. Two stages
 * then came back byte-identical and read as "the material never switches". Every stage press here is scoped
 * to the `WHAT IS DRAWN` fieldset, **and it is a real press at the button's own coordinates** rather than
 * `element.click()` - so hit-testing is exercised, and the pressed state is read back afterwards to check
 * the press actually took. A press that lands on an overlay is reported as `NOT this stage` rather than
 * silently measured.
 *
 * **The pane rectangles are re-read after every press.** A real press scrolls the control into view, and a
 * rectangle read before the scroll would measure the wrong region of the next frame. That is a wrinkle
 * `element.click()` never had, and it is the honest cost of pressing like a person.
 *
 * **A page that did not answer is a refusal, not an empty pane** (`scripts/browser.cjs`). Chrome's own error
 * page renders and answers `0` canvases, so a stage image of a refusal would read as "the pane is empty".
 *
 * A reader reaches the workbench through the plates a reader presses: the customiser, then `CHAR`. Reaching it
 * needs a session, so `--signin` makes one of the throwaway accounts the checks make and hands the page its
 * session - which leaves the account behind for `npm run db:sweep`. `--attach` uses the browser
 * `npm run browser -- --start --signin` left running, which costs no account at all.
 *
 * Run: node scripts/measure-stages.cjs [--url <address>] [--signin|--reuse] [--attach] [--at <ms>]
 */
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
  open,
  report,
  signInPage,
  sleep,
} = require('./browser.cjs');

const { at, has, number } = flags();

const BROWSE = path.join('Temp', 'browse');
const STAGES = ['MASS', 'BASE', 'PIXEL'];

/*
 * The plates a reader presses to stand in front of the workbench, in order. `CHAR` is a tab *inside* the
 * customiser, so the customiser has to be opened first - and on `/account` it is not open on arrival. A
 * first version pressed `CHAR` straight away and was told, correctly, that nothing on the page reads it,
 * which is the difference between a wrong press and a wrong assumption about the screen.
 */
const OPEN = ['CUSTOMISE PUBLIC PROFILE', 'CHAR'];

/** The canvases on the page, as rectangles - read from the page rather than guessed. */
const PANE_QUERY = `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => {
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}))`;

const url = at('--url', 'https://debaser-site.vercel.app/account');
const settle = number('--at', 12000);
const signIn = has('--signin');
const reuse = has('--reuse');
const attach = has('--attach');
const profile = path.join(BROWSE, 'stage-profile');
const within = at('--within', 'WHAT IS DRAWN');

/** Count distinct colours inside a box, how much of it is not the dominant one, and any grey. */
function measure(image, box) {
  const counts = new Map();
  let greys = 0;

  for (let y = box.y + 2; y < Math.min(box.y + box.h - 2, image.height); y += 2) {
    for (let x = box.x + 2; x < Math.min(box.x + box.w - 2, image.width); x += 2) {
      const offset = (y * image.width + x) * image.channels;
      const red = image.pixels[offset];
      const green = image.pixels[offset + 1];
      const blue = image.pixels[offset + 2];
      const key = `${red},${green},${blue}`;

      counts.set(key, (counts.get(key) ?? 0) + 1);

      // Black and Pure White are not greys; anything in between with equal channels is a colour the palette
      // does not own, and a dye under a lambert light cannot become one (shading scales the channels together).
      if (red === green && green === blue && red !== 0 && red !== 255) greys += 1;
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);
  const drawn = total - (sorted[0]?.[1] ?? 0);

  return {
    colours: sorted.length,
    greys,
    percent: total === 0 ? 0 : Math.round((drawn / total) * 1000) / 10,
    top: sorted.slice(0, 3).map(([colour, count]) => `rgb(${colour}) x${count}`),
  };
}

/** The pane rectangles, fresh - see the note about scrolling in the header. */
async function panesOf(page) {
  return JSON.parse((await page.evaluate(PANE_QUERY)) ?? '[]');
}

/**
 * Press a plate by its text, the way a reader does, and fail loudly when it is not there.
 *
 * A sequence that quietly skipped a plate would capture a screen nobody asked for and report success - which
 * is how a run "at the workbench" once produced a picture of `/account`. A wrong press has to be a failure.
 *
 * `scope` is the container whose own text has to contain the phrase, and **it is not the same for both kinds
 * of press**: the stage buttons live inside `WHAT IS DRAWN`, which does not exist until the customiser is
 * open, so scoping the plates that *open* it would refuse before there was anything to scope to.
 */
async function pressPlate(page, target, { scope = null, allowAmbiguous = true } = {}) {
  const found = await mustFind(page, target, { within: scope, allowAmbiguous });
  await click(page, found.x, found.y);

  // The screen behind the press mounts its own chunks; the next lookup needs them.
  await sleep(1200);

  return `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y} (matched by ${found.how})`;
}

/**
 * What the stage group says is lit.
 *
 * Only the three stage labels count. The overlay's own eye carries `aria-pressed` as well, so reading every
 * pressed button in the fieldset made a correct run report "NOT this stage".
 */
const LIT_QUERY = `(() => {
  const fieldset = [...document.querySelectorAll('fieldset')].find(
    (f) => f.innerText.includes('WHAT IS DRAWN')
  );
  const lit = fieldset
    ? [...fieldset.querySelectorAll('button')].filter(
        (b) => b.getAttribute('aria-pressed') === 'true' && /^(MASS|BASE|PIXEL)/.test(b.innerText.trim()),
      )
    : [];
  return lit.map((b) => b.innerText.trim().split(String.fromCharCode(10))[0].trim()).join(' + ');
})()`;

async function main() {
  let browser = null;

  try {
    browser = await open({
      size: [1440, 1200],
      profile,
      attach,
      keepProfile: attach, // a session's profile belongs to the session, not to this run
    });

    if (browser.attached) console.log(`attached: port ${browser.port} - stateful, so this is not a first visit`);

    if (signIn && !browser.attached) {
      const account = await signInPage(browser.page, { label: 'cline-stage' });

      if (account.error) {
        console.log(`session: NO - ${account.error}`);
        process.exitCode = 3;
        return;
      }

      // Handed over before the first navigation, so the page never renders signed-out at all.
      console.log(`session: ${account.userId} - left behind for \`npm run db:sweep\``);
    }

    // A page that did not answer throws here, before any stage image exists.
    const arrival = await goto(browser.page, url, { settle, allowErrorPage: has('--allow-error-page') });
    console.log(`url    : ${url}  (${arrival.title})`);

    if (reuse || browser.attached) {
      const held = await holdsSession(browser.page);

      if (!held) {
        console.log('session: NONE in this profile - the plates below will not be reachable, because the');
        console.log('  customiser is behind a session. Run `npm run browser -- --start --signin` first.');
      } else {
        console.log('session: the profile already holds one - no account made');
      }

      if (signIn && !held) {
        const account = await signInPage(browser.page, { label: 'cline-stage' });

        if (account.error) {
          console.log(`session: NO - ${account.error}`);
          process.exitCode = 3;
          return;
        }

        console.log(`session: ${account.userId} - left behind for \`npm run db:sweep\``);
        await goto(browser.page, url, { settle });
      }
    }

    // The plates that reach the workbench, pressed the way a reader presses them.
    for (const plate of OPEN) console.log(`press  : ${await pressPlate(browser.page, plate)}`);
    // The pane rectangles, read from the page rather than guessed.
    const panes = await panesOf(browser.page);
    console.log(`panes  : ${panes.length}`);

    for (const pane of panes) console.log(`  ${pane.w}x${pane.h} at ${pane.x},${pane.y}`);

    if (panes.length === 0) {
      console.log('');
      console.log('0 canvases: the workbench is not on this screen, so there is no stage to measure.');
      console.log('  A page with no <canvas> is a page with no pane, not a pane that drew nothing.');
      console.log('  The two presses above are what open it; if they did not land, the transcript says so.');
      return;
    }

    console.log('');

    for (const stage of STAGES) {
      const pressed = await pressPlate(browser.page, stage, { scope: within });

      /*
       * Wait for the press to be *reflected*, not just issued, and say what the page thinks is active.
       *
       * **The first version of this produced byte-identical readings for MASS and BASE** - the same 3 colours
       * and the same counts, to the pixel - which looked like "the material does not switch" and was really
       * "the screenshot was taken before the frame was redrawn". Identical numbers for two different requests
       * is the tell: a real render differs at least slightly. So this waits, then asserts the pressed button
       * is the one just clicked, and prints it - a stage reading is meaningless if the stage never changed.
       */
      await sleep(3500);

      const active = (await browser.page.evaluate(LIT_QUERY)) || 'nothing lit in the stage group';
      console.log(`  ${stage}  pressed ${pressed}`);
      console.log(`  ${' '.repeat(stage.length)}  (stage group says: ${active}${active.startsWith(stage) ? '' : '  <- NOT this stage'})`);

      // Fresh rectangles: the press scrolled the button into view, so a rectangle read earlier would
      // measure the wrong region of this frame.
      const fresh = await panesOf(browser.page);
      const file = path.join(BROWSE, `stage-${stage.toLowerCase()}.png`);
      await capture(browser.page, { out: file });

      const image = readPng(file);
      if (image.error) {
        console.log(`    PNG ${image.error}`);
        continue;
      }

      fresh.forEach((pane, index) => {
        const reading = measure(image, pane);
        /*
         * `EMPTY` is a statement about content, not about the colour count. MASS is a *wireframe*: two
         * colours - the void and the green edges - and 22% of the pane is not background, which is drawn.
         * The count-only test this replaces called that pane empty, which is the kind of reading that sends
         * somebody looking for a render fault that is not there.
         */
        console.log(
          `    pane ${index}: ${reading.percent === 0 ? 'EMPTY' : 'drawn'} - ` +
            `${reading.colours} colours, ${reading.percent}% not background`,
        );
        console.log(`      ${reading.top.join('   ')}`);
        console.log(
          `      greys in the pane: ` +
            (reading.greys === 0 ? 'none' : `${reading.greys} - a colour the palette does not own`),
        );
      });
    }

    report(browser.log);

    console.log('');
    console.log('NOT PROVEN: that any of it is a figure, or a good one.');
    console.log('  Colours in a pane mean geometry is drawn. What shape is for whoever reads the image -');
    console.log('  the per-stage PNGs are in Temp/browse/ for exactly that, and one file can also be');
    console.log('  measured again without a browser: npm run panes -- --png Temp/browse/stage-mass.png');
  } finally {
    await close(browser, { keep: attach });
  }
}

main().catch((error) => {
  if (error.noAnswer) {
    console.log(`REFUSED: ${error.message}`);
    console.log('  Nothing was written. Chrome\'s own error page renders and answers 0 canvases, so a');
    console.log('  stage image of a refusal would read as "the pane is empty". --allow-error-page keeps it.');
    process.exit(1);
  }

  console.log('FAILED: ' + error.message);
  process.exit(1);
});


