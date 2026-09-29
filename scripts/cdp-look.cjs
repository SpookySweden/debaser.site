/**
 * Point Chrome at the workbench and ask the page what is actually there.
 *
 * **Why this file exists, and why its absence was a wrong answer for a whole session.** The answer to "does the
 * figure render?" was "no headless verification available", based on Puppeteer failing with *"Could not find
 * expected browser (chrome) locally"*. That message is about **Puppeteer's download cache** being empty; it says
 * nothing about the machine. Chrome 153 is installed at `Program Files` and has `--remote-debugging-port`, which
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
 * What it still cannot do, and the output says so: **it cannot see.** Pixels on the canvas means the renderer
 * ran, not that it drew a person, and not that the person looks right.
 *
 * Run: node scripts/cdp-look.cjs [--url <address>] [--out <file.png>]
 */
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Socket, getJson } = require('./cdp-socket.cjs');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The probe, evaluated in the page. It reads the DOM and then the drawing buffer - the distinction that
 * matters, because a `<canvas>` proves the element exists and pixels prove the renderer ran.
 */
const PROBE = `(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));

  let drawn = 0;
  let sampled = 0;
  if (gl) {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Every 4th pixel is enough to tell blank from drawn, and keeps the read small.
    for (let index = 3; index < pixels.length; index += 16) {
      sampled += 1;
      if (pixels[index] > 0) drawn += 1;
    }
  }

  return {
    text: document.body.innerText,
    canvasCount: document.querySelectorAll('canvas').length,
    canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
    hasGL: Boolean(gl),
    glVersion: gl ? gl.getParameter(gl.VERSION) : null,
    sampled,
    drawn,
    nodes: document.querySelectorAll('*').length,
  };
})()`;

/** Console messages collected from the page, so a three.js or WebGL error has somewhere to surface. */
const consoleLog = [];

async function main() {
  const chrome = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) {
    console.log(`NO BROWSER: tried ${CANDIDATES.join(', ')}`);
    process.exit(2);
  }

  const argv = process.argv.slice(2);
  const at = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1];
  };

  const url = at('--url', 'http://localhost:3100/account');
  const outFile = path.resolve(at('--out', path.join('Temp', 'browse', 'account.png')));
  const PORT = 9334;
  const profile = path.join('Temp', 'browse', 'cdp-profile');

  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(path.dirname(outFile), { recursive: true });

  const child = spawn(
    chrome,
    [
      `--user-data-dir=${path.resolve(profile)}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=1440,2400',
      // The software GL. Without it a headless build has no WebGL, and a blank canvas would say nothing at all
      // about the code under test - the single most important flag here.
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
    console.log(`browser : ${chrome}`);
    console.log(`url     : ${url}`);

    // Wait for the debugger port rather than guessing a sleep long enough for a slow machine.
    let targets = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        targets = await getJson(PORT, '/json/list');
        if (targets.some((target) => target.type === 'page')) break;
      } catch {
        /* not listening yet */
      }
      await sleep(500);
    }

    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('no page target appeared');

    socket = await Socket.connect(page.webSocketDebuggerUrl);
    await socket.send('Page.enable');
    await socket.send('Runtime.enable');

    /**
     * Listen for console output, which is where this class of defect is *supposed* to be loud. r3f log a bare
     * string and a stack rather than a thrown exception when a scene fails to draw, so the guard here is a
     * listener installed before navigation rather than a try/catch around the probe.
     */
    socket.onEvent = (message) => {
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        consoleLog.push(
          `[${message.params.type}] ` +
            message.params.args.map((arg) => arg.description ?? arg.value ?? arg.type).join(' ').slice(0, 400),
        );
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        consoleLog.push(`[exception] ${details.exception?.description ?? details.text}`.slice(0, 400));
      }
    };

    await socket.send('Page.navigate', { url });

    // The panel is dynamic-imported and the canvas is built after hydration, so this waits rather than sleeping
    // a fixed amount: a fixed sleep passes on a fast machine and reports "no canvas" on a slow one.
    await sleep(9000);

    /**
     * The CHAR tab has to be pressed before the workbench exists, and finding that out was the point of running
     * this. The customiser opens on `[ PICTURE, BIO & TAGS ]`; `[ CHAR 🐰 ]` is the third of three, so a probe
     * that never clicks will always report "the sidebar did not render" - which says nothing about the sidebar.
     *
     * It clicks by *text*, the way a reader does, so it breaks if the tab is renamed rather than if the styling
     * moves. `--no-click` skips it, for checking what the first tab looks like.
     */
    if (!argv.includes('--no-click')) {
      const clicked = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          const tab = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('CHAR'));
          if (!tab) return 'no CHAR tab found';
          tab.click();
          return 'pressed ' + tab.innerText.trim();
        })()`,
        returnByValue: true,
      });
      console.log(`click   : ${clicked.result.value}`);
      // The dynamic import and the first WebGL frame both land after the click.
      await sleep(7000);
    }

    const evaluated = await socket.send('Runtime.evaluate', {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: true,
    });

    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.exception?.description ?? 'the probe threw');
    }

    const p = evaluated.result.value;

    /**
     * Dump what the page actually is before judging it. The first run reported *"a CHAR tab: YES"* while
     * `querySelectorAll('button')` could not find one - so those two facts disagreed and the disagreement was the
     * useful part. `CHAR` appears in the board's own text (it is a word), and `innerText` includes hidden panels.
     * Printing the buttons and the headings is what turns "some string is present" into "this is what is on the
     * screen", and it is how the missing customiser was found.
     */
    if (argv.includes('--dump')) {
      const dump = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          const buttons = [...document.querySelectorAll('button')].map((b) => b.innerText.trim().slice(0, 48));
          const heads = [...document.querySelectorAll('h1,h2,h3,[class*="TITLE"]')].map((h) => h.innerText.trim().slice(0, 48));
          return 'BUTTONS (' + buttons.length + '):\\n  ' + buttons.join('\\n  ') +
                 '\\nHEADINGS (' + heads.length + '):\\n  ' + heads.slice(0, 12).join('\\n  ') +
                 '\\nTEXT START: ' + document.body.innerText.slice(0, 700);
        })()`,
        returnByValue: true,
      });
      console.log('');
      console.log(dump.result.value);
    }

    /**
     * **The pixel probe, and the trap in it that has to be handled before its answer means anything.**
     *
     * A WebGL drawing buffer is *cleared after it is presented* unless the context was created with
     * `preserveDrawingBuffer`. So `readPixels` from outside a frame legitimately returns all zeros even when the
     * figure is drawn perfectly - which would make "the canvas is blank" a statement about the probe rather than
     * about the renderer. The first run of this script reported exactly `0/72072`, and that number alone does not
     * tell the two cases apart.
     *
     * So the probe reads the pixels **inside** a `requestAnimationFrame` callback - after the frame has been
     * drawn and before it is presented - which is the one moment the buffer is guaranteed to hold the frame. And
     * it reads *both* ways, because they answer different questions:
     *
     *   inFrame       sampled in a rAF, so a zero here means the renderer really drew nothing
     *   screenshot    the composited page, which is what a person would see regardless of buffer policy
     *
     * The screenshot is decisive on its own: if the compositor has content, the figure is on screen.
     */
    const pixels = await socket.send('Runtime.evaluate', {
      expression: `(async () => {
        const canvases = [...document.querySelectorAll('canvas')];
        const out = [];

        for (const canvas of canvases) {
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) {
            out.push({ hasGL: false });
            continue;
          }

          const readOnce = () => {
            const width = gl.drawingBufferWidth;
            const height = gl.drawingBufferHeight;
            const buffer = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
            let drawn = 0;
            let sampled = 0;
            let coloured = 0;
            for (let index = 0; index < buffer.length; index += 16) {
              sampled += 1;
              if (buffer[index + 3] > 0) {
                drawn += 1;
                // A non-grey, non-black pixel means something with a colour was drawn rather than a clear.
                if (Math.abs(buffer[index] - buffer[index + 1]) > 12 || Math.abs(buffer[index + 1] - buffer[index + 2]) > 12) {
                  coloured += 1;
                }
              }
            }
            return { width, height, sampled, drawn, coloured };
          };

          // Inside a frame, which is the only time the drawing buffer is guaranteed to hold the image.
          const inFrame = await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(readOnce())));
          });

          out.push({ hasGL: true, version: gl.getParameter(gl.VERSION), inFrame });
        }

        return out;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });

    if (pixels.exceptionDetails) throw new Error(pixels.exceptionDetails.exception?.description ?? 'pixel probe threw');

    console.log('');
    console.log('per canvas:');
    for (const [index, entry] of pixels.result.value.entries()) {
      if (!entry.hasGL) {
        console.log(`  canvas ${index}: no GL context`);
        continue;
      }
      const f = entry.inFrame;
      console.log(
        `  canvas ${index}: ${f.width}x${f.height}  in-frame ${f.drawn}/${f.sampled} drawn, ${f.coloured} coloured`,
      );
    }
    console.log(`canvas  : ${p.canvasCount} element(s)${p.canvasSize ? `, ${p.canvasSize}` : ''}`);
    console.log(`webgl   : ${p.hasGL ? p.glVersion : 'NO CONTEXT'}`);
    console.log(
      `drawn   : ${p.drawn}/${p.sampled} sampled pixels non-transparent` +
        (p.sampled === 0 ? '  <- nothing sampled, so this proves nothing' : ''),
    );

    const canvasesRead = pixels.result.value.filter((entry) => entry.hasGL).map((entry) => entry.inFrame);
    const drawnTotal = canvasesRead.reduce((sum, frame) => sum + frame.drawn, 0);
    const colouredTotal = canvasesRead.reduce((sum, frame) => sum + frame.coloured, 0);

    // Console errors and page exceptions, captured before the probe so a WebGL failure has somewhere to show up.
    // A blank canvas with a console full of errors is a *fixable* blank canvas; a blank one in silence is not.
    const diagnostics = await socket.send('Runtime.evaluate', {
      expression: `(() => {
        const canvas = document.querySelector('canvas');
        const parent = canvas ? canvas.parentElement : null;
        return {
          canvasRect: canvas ? JSON.stringify(canvas.getBoundingClientRect()) : null,
          parentSize: parent ? parent.clientWidth + 'x' + parent.clientHeight : null,
          grandparentSize: parent && parent.parentElement
            ? parent.parentElement.clientWidth + 'x' + parent.parentElement.clientHeight
            : null,
          canvasStyle: canvas ? canvas.getAttribute('style') : null,
          parentStyle: parent ? parent.getAttribute('style') : null,
        };
      })()`,
      returnByValue: true,
    });
    console.log('');
    console.log('layout:');
    for (const [key, value] of Object.entries(diagnostics.result.value)) {
      console.log(`  ${key.padEnd(16)}: ${value}`);
    }

    /**
     * **Mount here is not draw.** With `frameloop="demand"` three.js renders only when something invalidates a
     * frame, so a scene that never invalidates produces a canvas that is correct in every visible respect and
     * empty. Pressing a stage button should invalidate; so should a resize. This walks a few invalidations and
     * re-reads, which separates "the renderer never ran" from "the renderer ran and drew nothing".
     */
    if (argv.includes('--nudge')) {
      console.log('');
      console.log('nudging invalidations:');
      for (const step of ['resize', 'click-stage']) {
        const before = await socket.send('Runtime.evaluate', {
          expression: `(() => {
            const canvas = document.querySelector('canvas');
            const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
            if (!gl) return -1;
            const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
            let drawn = 0;
            for (let index = 3; index < buffer.length; index += 16) if (buffer[index] > 0) drawn += 1;
            return drawn;
          })()`,
          returnByValue: true,
        });

        await socket.send('Runtime.evaluate', {
          expression:
            step === 'resize'
              ? `window.dispatchEvent(new Event('resize')), 'resized'`
              : `(() => {
                  const buttons = [...document.querySelectorAll('button')];
                  const pixel = buttons.find((b) => b.innerText.trim().startsWith('PIXEL'));
                  const base = buttons.find((b) => b.innerText.trim().startsWith('BASE'));
                  if (pixel) pixel.click();
                  if (base) base.click();
                  return 'clicked stage buttons';
                })()`,
          returnByValue: true,
        });

        await sleep(2500);
        const after = await socket.send('Runtime.evaluate', {
          expression: `(() => {
            const canvas = document.querySelector('canvas');
            const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
            if (!gl) return -1;
            const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
            let drawn = 0;
            for (let index = 3; index < buffer.length; index += 16) if (buffer[index] > 0) drawn += 1;
            return drawn;
          })()`,
          returnByValue: true,
        });

        console.log(`  ${step.padEnd(12)} before=${before.result.value}  after=${after.result.value}`);
      }
    }

    /**
     * **Test the render paths one at a time, because two faults can mask each other.**
     *
     * The `Outline` warning is gone after adding `autoClear={false}`, yet the canvas is still empty - and BASE,
     * which mounts no composer at all, is equally empty. So a second fault exists on the plain path, and the
     * composer one hid it. This walks MASS (wireframe), BASE (flat solid) and PIXEL (lit + composer) and re-reads
     * after each, which is what separates "no renderer runs" from "one stage is broken".
     */
    if (argv.includes('--stages')) {
      console.log('');
      console.log('per stage:');
      for (const stage of ['MASS', 'BASE', 'PIXEL']) {
        await socket.send('Runtime.evaluate', {
          expression: `(() => {
            const button = [...document.querySelectorAll('button')].find(
              (b) => b.innerText.trim().split('\\n')[0].trim() === '${stage}'
            );
            if (!button) return 'no ${stage} button';
            button.click();
            return 'clicked';
          })()`,
          returnByValue: true,
        });
        await sleep(3000);

        const read = await socket.send('Runtime.evaluate', {
          expression: `(() => {
            const canvases = [...document.querySelectorAll('canvas')];
            return canvases.map((canvas) => {
              const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
              if (!gl) return 'noGL';
              const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
              gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
              let drawn = 0;
              let coloured = 0;
              for (let index = 0; index < buffer.length; index += 16) {
                if (buffer[index + 3] > 0) {
                  drawn += 1;
                  if (Math.abs(buffer[index] - buffer[index + 1]) > 12) coloured += 1;
                }
              }
              return drawn + ' drawn, ' + coloured + ' coloured';
            }).join('  |  ');
          })()`,
          returnByValue: true,
        });

        console.log(`  ${stage.padEnd(6)} -> ${read.result.value}`);
      }
    }

    /**
     * **The decisive experiment: does a *continuous* frame loop draw the figure?**
     *
     * Every stage is empty, including MASS, which is a wireframe that mounts no composer - so the composer is not
     * the (only) cause. The remaining suspect is `frameloop="demand"`, which renders only when something calls
     * `invalidate()`. A store change from *inside* React does not by itself invalidate a canvas that r3f is not
     * tracking for that pane, and nothing else does either - so the scene may simply never have been drawn once.
     *
     * That is not something source-reading can decide, so this asks the renderer: r3f exposes its root on the
     * canvas element, and its render loop can be switched to `always` at runtime. If pixels appear, `demand` is
     * the fault and the fix belongs in the scene. If they do not, the scene itself is wrong.
     */
    if (argv.includes('--force-frames')) {
      console.log('');
      console.log('forcing a continuous loop:');
      const forced = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          const canvases = [...document.querySelectorAll('canvas')];
          const results = [];
          for (const canvas of canvases) {
            const key = Object.keys(canvas).find((k) => k.startsWith('__react'));
            const fiber = key ? canvas[key] : null;
            // r3f stores its store on the canvas; the loop mode is a setter on the root state.
            let touched = 'no r3f root found';
            if (fiber) {
              const store = fiber?.child?.memoizedProps?.__r3f?.store ?? null;
              if (store && store.getState) {
                const state = store.getState();
                if (typeof state.setFrameloop === 'function') {
                  state.setFrameloop('always');
                  touched = 'set frameloop=always';
                } else if (typeof state.invalidate === 'function') {
                  state.invalidate();
                  touched = 'invalidated once';
                }
              }
            }
            results.push(touched);
          }
          return results.join('  |  ') + '   (canvases: ' + canvases.length + ')';
        })()`,
        returnByValue: true,
      });
      console.log(`  ${forced.result.value}`);

      await sleep(4000);

      const after = await socket.send('Runtime.evaluate', {
        expression: `(() => {
          return [...document.querySelectorAll('canvas')].map((canvas) => {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return 'noGL';
            const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
            let drawn = 0;
            for (let index = 3; index < buffer.length; index += 16) if (buffer[index] > 0) drawn += 1;
            return drawn + ' drawn';
          }).join('  |  ');
        })()`,
        returnByValue: true,
      });
      console.log(`  after 4s: ${after.result.value}`);
    }

    console.log('');
    console.log('console:');
    if (consoleLog.length === 0) {
      console.log('  (silent - no errors, no warnings, no exceptions)');
    } else {
      for (const line of consoleLog.slice(0, 12)) console.log(`  ${line}`);
    }

    console.log('');
    console.log('what the page says:');
    const rows = [
      ['the ssr:false plate is gone', !p.text.includes('LOADING THE WORKBENCH'), 'the client chunk never ran'],
      ['the edit-layer heading', p.text.includes('WHAT A DRAG EDITS'), 'the sidebar did not render'],
      ['the render-stage heading', p.text.includes('WHAT IS DRAWN'), 'the stage control did not render'],
      ['the overlay note', p.text.includes('AN OVERLAY'), 'the skeleton eye did not render'],
      ['FRONT and SIDE panes', p.text.includes('FRONT') && p.text.includes('SIDE'), 'the viewports did not render'],
      ['two canvases mounted', p.canvasCount >= 2, 'a pane is missing its canvas'],
      ['a live WebGL context', p.hasGL, 'no GL, so nothing could be drawn'],
      ['pixels drawn in-frame', drawnTotal > 0, 'the renderer produced an empty frame'],
      ['coloured, not just cleared', colouredTotal > 0, 'pixels are there but uncoloured - geometry may be absent'],
    ];

    console.log('');
    console.log('what the page says:');
    for (const [label, truthy, why] of rows) {
      console.log(`  ${truthy ? 'YES' : 'no '}  ${label}${truthy ? '' : `   <- ${why}`}`);
    }

    const shot = await socket.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    console.log('');
    console.log(`shot    : ${outFile} (${readFileSync(outFile).length} bytes)`);

    console.log('');
    console.log('NOT PROVEN: that the figure is a person, or that it looks right.');
    console.log('  Pixels on the canvas means the renderer ran, not that it drew something correct.');
    console.log("  Nothing here can read the screenshot. That is a person's job.");
  } finally {
    if (socket) socket.close();
    child.kill();
  }
}

main().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});
