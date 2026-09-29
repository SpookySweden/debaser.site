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
 * A screenshot has no such problem: it is the composited page. So this presses each stage, captures, and counts
 * distinct colours inside each pane. Two colours means the void alone; more means geometry is drawn. It also counts
 * **greys inside a pane**, which the palette does not contain - the two-tone figure is violet, and a lambert light
 * scales a colour's channels together, so it can never produce r=g=b from a dye. A grey in a pane is a colour this
 * site does not own. (A grey elsewhere in the page is usually anti-aliased small text, which is why the count is
 * per-pane rather than per-image.)
 *
 * **The stage press is scoped, and that is the one thing this file exists to get right.** `MASS` and
 * `MASS GEOMETRY` share their first word, so an unscoped press lands on the edit row: a run of
 * `npm run shot -- --click MASS` reported, in its own transcript, pressing *BUILD A FIGURE FROM A SKELETON
 * AND THE MASS HUNG* - the palette's help text - and captured a picture of an unchanged stage. Every stage
 * press here is scoped to the `WHAT IS DRAWN` fieldset, and the pressed state is read back afterwards.
 *
 * **A page that did not answer is a refusal, not an empty pane** (`scripts/cdp-page.cjs`). Chrome's own error
 * page renders and answers `0` canvases, so a stage image of a refusal would read as "the pane is empty".
 *
 * A reader goes to the workbench through the plates a reader presses: the customiser, then `CHAR`. Reaching it
 * needs a session, so `--signin` makes one of the throwaway accounts the checks make and hands the page its
 * session - which leaves the account behind for `npm run db:sweep`.
 *
 * Run: node --env-file=.env.local scripts/measure-stages.cjs [--url <address>] [--signin] [--at <ms>]
 */
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { readPng } = require('./png-read.cjs');
const { arrive, click, close, findControl, flags, installSession, launch, signUp, sleep, socketOn } = require('./cdp-page.cjs');

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

const url = at('--url', 'https://debaser-site.vercel.app/account');
const port = 9338 + Math.floor(Math.random() * 40);
const settle = number('--at', 12000);
const signIn = has('--signin');
const profile = path.join(BROWSE, 'stage-profile');

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

/**
 * Press a control by its text, the way a reader does, and fail loudly when it is not there.
 *
 * A sequence that quietly skipped a plate would capture a screen nobody asked for and report success - which
 * is how a run "at the workbench" once produced a picture of `/account`. A wrong press has to be a failure.
 */
async function press(socket, target) {
  const found = await findControl(socket, target);

  if (!found.found) throw new Error(`cannot press ${JSON.stringify(target)}: ${found.why}`);

  await click(socket, found.x, found.y);
  // The screen behind the press mounts its own chunks; the next lookup needs them.
  await sleep(1200);

  return `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y}`;
}

async function main() {
  const { child } = launch({ port, profile, size: [1440, 1200] });

  let socket;
  try {
    socket = await socketOn(port);

    if (signIn) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      // `cline-` is the prefix the sweep already reviews, so the account this makes is one
      // `npm run db:sweep` already knows how to find. The session goes in before navigation, so the page
      // never renders signed-out at all.
      const account = await signUp(`cline-stage-${stamp}@debaser.site`, `stage-${stamp}-pw`, `stage ${stamp}`);

      if (account.error) {
        console.log(`session: NO - ${account.error}`);
        process.exitCode = 3;
        return;
      }

      await installSession(socket, account);
      console.log(`session: ${account.userId} - left behind for \`npm run db:sweep\``);
    }

    // A page that did not answer throws here, before any stage image exists.
    const arrival = await arrive(socket, url, { settle, allowErrorPage: has('--allow-error-page') });

    console.log(`url    : ${url}  (${arrival.title})`);

    // The plates that reach the workbench, pressed the way a reader presses them.
    for (const plate of OPEN) {
      const pressed = await press(socket, plate);
      console.log(`press  : ${pressed}`);
    }

    // The pane rectangles, read from the page rather than guessed.
    const boxesResult = await socket.send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }))`,
      returnByValue: true,
    });

    const panes = JSON.parse(boxesResult.result.value);
    console.log(`panes  : ${panes.length}`);

    for (const pane of panes) console.log(`  ${pane.w}x${pane.h} at ${pane.x},${pane.y}`);

    if (panes.length === 0) {
      console.log('');
      console.log('0 canvases: the workbench is not on this screen, so there is no stage to measure.');
      console.log('  A page with no <canvas> is a page with no pane, not a pane that drew nothing.');
      return;
    }

    console.log('');

    for (const stage of STAGES) {
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
          // Only the three stage labels count. The overlay's own eye carries aria-pressed as well, so
          // reading every pressed button in the fieldset made a correct run report "NOT this stage".
          const lit = fieldset
            ? [...fieldset.querySelectorAll('button')].filter(
                (b) =>
                  b.getAttribute('aria-pressed') === 'true' &&
                  /^(MASS|BASE|PIXEL)/.test(b.innerText.trim()),
              )
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
        console.log(
          `      greys in the pane: ` +
            (reading.greys === 0 ? 'none' : `${reading.greys} - a colour the palette does not own`),
        );
      });
    }

    console.log('');
    console.log('NOT PROVEN: that any of it is a figure, or a good one.');
    console.log('  Colours in a pane mean geometry is drawn. What shape is for whoever reads the image -');
    console.log('  the per-stage PNGs are in Temp/browse/ for exactly that, and one file can also be');
    console.log('  measured again without a browser: npm run panes -- --png Temp/browse/stage-mass.png');
  } finally {
    if (socket) socket.close();
    await close({ child, profile });
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
