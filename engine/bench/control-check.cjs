#!/usr/bin/env node
/**
 * The proof that CONTROL works and is safe (SPEC-screens.md, phase 2): the viewer page's mouse, keys and wheel
 * driving this PC.
 *
 * Almost all of it is a DRY RUN: the engine is started with `--allow-control --control-dry-run`, which writes
 * down what it would put into Windows (readable at `GET /control-log`) and puts in NOTHING. The page is driven by
 * Playwright's own mouse and keyboard, which reach only the hidden headless browser, never the PC. The check then
 * reads the engine's record and compares it with what was done to the page.
 *
 * One thing is real, at the very end and only when no League match is running: with a real (not dry) engine, the
 * real pointer is nudged two pixels to the right and two back, and read before, between and after. While that
 * happens (about a second) the strip "CONTROLLED FROM ANOTHER DEVICE" shows along the top of the PC's screen; the
 * check looks at that window from outside, and ends control by telling the engine its cut-off key was pressed
 * (the message Windows would send is posted to it: no key is pressed). No key is ever really pressed and nothing
 * is ever really clicked by this check.
 *
 *     node bench/control-check.cjs            (from the engine folder, after `cargo build --release`)
 *     node bench/control-check.cjs --port 8480 --no-real    (skip the real nudge)
 *     node bench/control-check.cjs --only-real              (only the real nudge, the strip and the cut-off)
 *
 * Exit 0: every part passed (a part that "could not tell" does not fail it, and is said plainly).
 * Exit 1: something failed. Exit 3: not run at all, because a League match is running on this PC.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const ENGINE_DIR = path.join(__dirname, '..');
const ENGINE = path.join(ENGINE_DIR, 'target', 'release', 'debaser-engine.exe');
const RESULTS = path.join(__dirname, 'results');

/** The browser, looked for the way scripts/browser.cjs does: Chrome first, Edge when Chrome is missing. */
const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const VIEW = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function stamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/** The owner plays League on this PC. While a match runs, nothing here is started. */
function leagueRunning() {
  try {
    return /League of Legends\.exe/i.test(execFileSync('tasklist', { encoding: 'utf8', windowsHide: true }));
  } catch (error) {
    return false;
  }
}

async function startEngine(port, more, environment) {
  const args = ['serve', '--seconds', '45', '--tweaks', '12', '--port', String(port), ...more];
  const child = spawn(ENGINE, args, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '', ...environment } });
  // Whatever goes wrong in this script, an engine it started does not outlive it.
  process.on('exit', () => { if (child.exitCode === null) child.kill(); });
  const engine = { child, args, text: '', exit: null };
  child.stdout.on('data', (chunk) => { engine.text += chunk; });
  child.stderr.on('data', (chunk) => { engine.text += chunk; });
  engine.gone = new Promise((resolve) => child.on('exit', (code) => { engine.exit = code; resolve(code); }));
  engine.lines = () => engine.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  engine.stop = async () => {
    // Only ever an engine this script started itself.
    if (engine.exit === null) child.kill();
    await Promise.race([engine.gone, sleep(3000)]);
  };
  const began = Date.now();
  while (!engine.text.includes('waiting for a viewer')) {
    if (engine.exit !== null) throw new Error(`The engine stopped before it was ready (exit code ${engine.exit}): ${engine.lines().slice(-3).join(' | ')}`);
    if (Date.now() - began > 8000) throw new Error('The engine did not say it was ready within 8 seconds.');
    await sleep(50);
  }
  return engine;
}

/** Opens the viewer page and waits until its picture is flowing and its control channel is open. */
async function openViewer(browser, port, query = '') {
  const context = await browser.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load', timeout: 8000 });
  const began = Date.now();
  for (;;) {
    const ready = await page.evaluate(async () => {
      const s = await window.__debaserStats();
      return s.framesDecoded > 5 && Boolean(window.__debaserSettings.get()) && typeof keysChannel !== 'undefined' && keysChannel && keysChannel.readyState === 'open';
    });
    if (ready) break;
    if (Date.now() - began > 10000) throw new Error(`The viewer page never got a picture and an open control channel${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
    await sleep(100);
  }
  return { context, page, errors };
}

/** Asks the PC for a picture and waits until the browser is decoding frames of that size. */
async function picture(page, change) {
  const seen = await page.evaluate(async (partial) => {
    const answer = await window.__debaserSettings.ask(partial);
    const began = performance.now();
    while (performance.now() - began < 8000) {
      const s = await window.__debaserStats();
      if (s.frameWidth === answer.sending.width && s.frameHeight === answer.sending.height) return { ok: true, sending: answer.sending, screen: answer.screen };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { ok: false, sending: answer.sending, screen: answer.screen };
  }, change);
  if (!seen.ok) throw new Error(`The picture never became ${seen.sending.width}x${seen.sending.height}`);
  return seen;
}

/** Where the picture is on the page (the check works it out for itself, from the page's and the picture's sizes). */
async function pictureBox(page) {
  const size = await page.evaluate(() => { const v = document.getElementById('screen'); return { wide: v.videoWidth, tall: v.videoHeight }; });
  const fit = Math.min(VIEW.width / size.wide, VIEW.height / size.tall);
  const width = size.wide * fit;
  const height = size.tall * fit;
  return { left: (VIEW.width - width) / 2, top: (VIEW.height - height) / 2, width, height };
}

const controlState = (page) => page.evaluate(() => window.__debaserControl.state());
const frames = (page) => page.evaluate(async () => (await window.__debaserStats()).framesDecoded);

async function waitFor(test, ms, every = 50) {
  const began = Date.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() - began > ms) return null;
    await sleep(every);
  }
}

async function main() {
  const port = Number(option('--port', '8480'));
  const result = { kind: 'control-check', when: new Date().toISOString(), pass: false, parts: [] };
  const parts = result.parts;
  const part = (letter, verdict, what, seen) => { parts.push({ letter, verdict, what, seen }); };

  if (leagueRunning()) {
    console.log('NOT RUN. A League match is running on this PC: nothing is built, started or sent while it is.');
    return 3;
  }
  if (!fs.existsSync(ENGINE)) {
    console.log(`FAIL. The engine is not built: ${ENGINE} is missing. Run "cargo build --release" in the engine folder first.`);
    return 1;
  }
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    console.log(`FAIL. No Chrome or Edge found. Looked in:\n  ${BROWSER_CANDIDATES.join('\n  ')}`);
    return 1;
  }

  const pretendFile = path.join(os.tmpdir(), `debaser-control-check-pretend-match-${process.pid}`);
  const logAt = (viewerPort) => fetch(`http://127.0.0.1:${viewerPort}/control-log`);
  const readLog = async () => (await logAt(port)).json();
  /** The record's entries after entry number `after`, once `enough(entries)` says they have all arrived. */
  const entriesAfter = async (after, enough, ms = 1500) => {
    let entries = [];
    await waitFor(async () => { entries = (await readLog()).entries.filter((entry) => entry.n > after); return enough(entries); }, ms);
    return entries;
  };
  const mark = async () => (await readLog()).everLogged;
  const keyLine = (entry) => `${entry.code} ${entry.scan}${entry.extended ? '+E0' : ''} ${entry.down ? 'down' : 'up'}`;

  const onlyReal = process.argv.includes('--only-real');
  let browser = null;
  let engine = null;
  const engineOutput = [];
  const finishRun = async (label) => { if (engine) { await engine.stop(); engineOutput.push(`--- ${label} ---`, ...engine.lines().filter((line) => !/^\d+ s\s/.test(line))); engine = null; } };
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true };

    dryRuns: {
    if (onlyReal) break dryRuns;
    // ---- (a) A PC that was not started with --allow-control. ----
    engine = await startEngine(port, [], {});
    {
      const viewer = await openViewer(browser, port, '?hold=1');
      const page = viewer.page;
      const keyShown = await page.isVisible('#control-key');
      await page.evaluate(() => window.__debaserControl.take());
      await sleep(400);
      const state = await controlState(page);
      await page.click('#open-settings');
      const says = await page.textContent('#control-state');
      const log = await logAt(port);
      const good = !keyShown && state.standing === 'off' && !state.mine && says.includes('THIS PC IS NOT ALLOWING CONTROL') && log.status === 403;
      part('a', good ? 'PASS' : 'FAIL', 'without --allow-control there is no control at all',
        `the [ CONTROL ] key is ${keyShown ? 'SHOWN' : 'absent'}; /settings says control is "${state.standing}"; asking anyway got "${state.note || 'no answer'}" and control ${state.mine ? 'WAS GIVEN' : 'was not given'}; the panel says "${says.split('\n')[0]}"; GET /control-log answered ${log.status}`);
      await viewer.context.close();
    }
    await finishRun('run 1: no --allow-control');

    // ---- The dry run, first half: pointer, keys, buttons, wheel, letting go, two devices. ----
    engine = await startEngine(port, ['--allow-control', '--control-dry-run'], {});
    {
      const one = await openViewer(browser, port);
      const page = one.page;
      const framesAtStart = await frames(page);
      const frameMarks = [];

      // (b) The pointer, for two shapes of picture.
      const notes = [];
      let pointerGood = true;
      await picture(page, { shape: '16:9', lines: 1080 });
      await page.click('#control-key');
      const took = await waitFor(async () => (await controlState(page)).mine, 3000);
      if (!took) throw new Error(`Control was not given: ${JSON.stringify(await controlState(page))}`);
      const keyText = await page.textContent('#control-key');
      for (const change of [{ shape: '16:9', lines: 1080 }, { shape: 'native', lines: 'native' }]) {
        const seen = await picture(page, change);
        const box = await pictureBox(page);
        for (const [fx, fy] of [[0.25, 0.25], [0.5, 0.5], [0.1, 0.9], [0.7, 0.6]]) {
          const after = await mark();
          await page.mouse.move(box.left + fx * box.width, box.top + fy * box.height);
          const entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'pointer'));
          const last = entries.filter((entry) => entry.what === 'pointer').pop();
          const want = { x: seen.sending.x + fx * seen.sending.regionWidth, y: seen.sending.y + fy * seen.sending.regionHeight };
          const ok = Boolean(last) && Math.abs(last.x - want.x) <= 2 && Math.abs(last.y - want.y) <= 2;
          if (!ok) pointerGood = false;
          notes.push(`${ok ? 'yes' : 'NO'}: ${seen.sending.width}x${seen.sending.height} picture (the screen's ${seen.sending.regionWidth}x${seen.sending.regionHeight} from ${seen.sending.x},${seen.sending.y}), pointer at ${(fx * 100).toFixed(0)}% across and ${(fy * 100).toFixed(0)}% down: wanted screen pixel ${want.x.toFixed(0)},${want.y.toFixed(0)}, the engine would move to ${last ? `${last.x},${last.y}` : 'nowhere'}`);
        }
      }
      await picture(page, { shape: '16:9', lines: 1080 });
      part('b', pointerGood && keyText.includes('RELEASE') ? 'PASS' : 'FAIL', 'taking control, then the pointer lands on the right pixel of the PC\'s screen (within 2) for two shapes', `[ CONTROL ] was pressed and became "${keyText}"\n      ${notes.join('\n      ')}`);
      frameMarks.push(await frames(page));

      // (c) Keys, as hardware scan codes, down then up, in order.
      {
        const wanted = [['KeyA', 0x1e, false], ['Digit5', 0x06, false], ['ShiftLeft', 0x2a, false], ['ShiftRight', 0x36, false], ['Enter', 0x1c, false], ['ArrowLeft', 0x4b, true], ['F5', 0x3f, false], ['NumpadEnter', 0x1c, true], ['Delete', 0x53, true], ['ControlRight', 0x1d, true]];
        const after = await mark();
        const unknownBefore = (await readLog()).unknownKeys;
        for (const [code] of wanted) {
          await page.keyboard.down(code);
          await page.keyboard.up(code);
        }
        // A key the engine does not know: ignored, and counted.
        await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'WibbleKey', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'WibbleKey', bubbles: true })); });
        const entries = (await entriesAfter(after, (list) => list.filter((entry) => entry.what === 'key').length >= wanted.length * 2)).filter((entry) => entry.what === 'key');
        await sleep(200);
        const unknownAfter = (await readLog()).unknownKeys;
        const expected = wanted.flatMap(([code, scan, extended]) => [`${code} ${scan}${extended ? '+E0' : ''} down`, `${code} ${scan}${extended ? '+E0' : ''} up`]);
        const got = entries.map(keyLine);
        const good = JSON.stringify(got) === JSON.stringify(expected) && unknownAfter - unknownBefore === 2;
        part('c', good ? 'PASS' : 'FAIL', 'keys arrive as the right scan codes, extended where due, down then up, in order',
          `pressed in the page: ${wanted.map(([code]) => code).join(', ')}\n      the engine would press: ${got.join(', ')}\n      an unknown key ("WibbleKey") down and up: ignored and counted ${unknownAfter - unknownBefore} times`);
      }

      // (d) Buttons and the wheel.
      {
        const box = await pictureBox(page);
        const x = box.left + 0.5 * box.width;
        const y = box.top + 0.5 * box.height;
        const after = await mark();
        await page.mouse.move(x, y);
        for (const button of ['left', 'right', 'middle']) {
          await page.mouse.down({ button });
          await page.mouse.up({ button });
        }
        // The back and forward buttons, which Playwright's own mouse does not have: the browser is told directly.
        const session = await one.context.newCDPSession(page);
        for (const [button, buttons] of [['back', 8], ['forward', 16]]) {
          await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
          await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
        }
        await page.mouse.wheel(0, 100);   // one notch towards the hand (down)
        await page.mouse.wheel(0, -200);  // two notches away (up)
        await page.mouse.wheel(100, 0);   // one notch to the right
        const entries = await entriesAfter(after, (list) => list.filter((entry) => entry.what === 'wheel').length >= 3 && list.filter((entry) => entry.what === 'button').length >= 10);
        const buttons = entries.filter((entry) => entry.what === 'button').map((entry) => `${entry.button} ${entry.down ? 'down' : 'up'}`);
        const wheels = entries.filter((entry) => entry.what === 'wheel').map((entry) => `dy ${entry.dy} dx ${entry.dx}`);
        // Every press carries its place, so the pointer is put there first.
        const placed = entries.every((entry, index) => entry.what !== 'button' || (index > 0 && entries[index - 1].what === 'pointer'));
        const good = JSON.stringify(buttons) === JSON.stringify(['left down', 'left up', 'right down', 'right up', 'middle down', 'middle up', 'back down', 'back up', 'forward down', 'forward up']) &&
          JSON.stringify(wheels) === JSON.stringify(['dy -120 dx 0', 'dy 240 dx 0', 'dy 0 dx 120']) && placed;
        part('d', good ? 'PASS' : 'FAIL', 'mouse buttons and the wheel',
          `buttons the engine would press: ${buttons.join(', ')}\n      each press is preceded by a move to its place: ${placed}\n      wheel (120 a notch, up and right positive): ${wheels.join('; ')}`);
      }
      frameMarks.push(await frames(page));

      // (e) Letting go: the [ RELEASE ] key, and this device's own chord, each with things held down.
      const letGo = [];
      let letGoGood = true;
      {
        const after = await mark();
        await page.keyboard.down('KeyW');
        await page.keyboard.down('ShiftLeft');
        await page.click('#control-key');
        const entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'));
        await page.keyboard.up('ShiftLeft');
        await page.keyboard.up('KeyW');
        // (The pointer crossing the picture on its way to the key is in the record too; it is not what is being proved here.)
        const lines = entries.filter((entry) => entry.what !== 'pointer').map((entry) => (entry.what === 'key' ? keyLine(entry) : entry.what === 'ended' ? `ended: ${entry.why}` : entry.what));
        const ok = JSON.stringify(lines) === JSON.stringify(['KeyW 17 down', 'ShiftLeft 42 down', 'ShiftLeft 42 up', 'KeyW 17 up', 'ended: the viewer let go']) && !(await controlState(page)).mine;
        if (!ok) letGoGood = false;
        letGo.push(`${ok ? 'yes' : 'NO'}: [ RELEASE ] with W and Shift held: ${lines.join(', ')}`);
      }
      {
        await page.click('#control-key');
        await waitFor(async () => (await controlState(page)).mine, 3000);
        const box = await pictureBox(page);
        const after = await mark();
        await page.mouse.move(box.left + 0.4 * box.width, box.top + 0.4 * box.height);
        await page.mouse.down({ button: 'left' });
        for (const code of ['ControlLeft', 'AltLeft', 'ShiftLeft', 'KeyQ']) await page.keyboard.down(code);
        const entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'));
        for (const code of ['KeyQ', 'ShiftLeft', 'AltLeft', 'ControlLeft']) await page.keyboard.up(code);
        await page.mouse.up({ button: 'left' });
        const lines = entries.filter((entry) => entry.what !== 'pointer').map((entry) => (entry.what === 'key' ? keyLine(entry) : entry.what === 'button' ? `${entry.button} ${entry.down ? 'down' : 'up'}` : entry.what === 'ended' ? `ended: ${entry.why}` : entry.what));
        const ok = JSON.stringify(lines) === JSON.stringify(['left down', 'ControlLeft 29 down', 'AltLeft 56 down', 'ShiftLeft 42 down', 'ShiftLeft 42 up', 'AltLeft 56 up', 'ControlLeft 29 up', 'left up', 'ended: the viewer let go']) && !(await controlState(page)).mine;
        if (!ok) letGoGood = false;
        letGo.push(`${ok ? 'yes' : 'NO'}: Ctrl+Alt+Shift+Q on the viewer with the left button held (Q itself is never sent): ${lines.join(', ')}`);
      }

      // (f) A second device.
      {
        const two = await openViewer(browser, port);
        await page.click('#control-key');
        await waitFor(async () => (await controlState(page)).mine, 3000);
        const after = await mark();
        await two.page.click('#control-key');
        const refused = await waitFor(async () => { const s = await controlState(two.page); return s.note ? s : null; }, 3000);
        await two.page.evaluate(() => window.__debaserSettings.get() && null);
        await sleep(300);
        const standingTwo = (await waitFor(async () => { const s = await controlState(two.page); return s.standing === 'another device' ? s : null; }, 4000)) || (await controlState(two.page));
        const saysTwo = await two.page.textContent('#control-says');
        // Nothing the second device does reaches the PC.
        await two.page.keyboard.down('KeyZ');
        await two.page.keyboard.up('KeyZ');
        await sleep(200);
        const stray = (await readLog()).entries.filter((entry) => entry.n > after && entry.what === 'key');
        await page.click('#control-key');
        await waitFor(async () => !(await controlState(page)).mine, 3000);
        await two.page.click('#control-key');
        const tookAfter = await waitFor(async () => (await controlState(two.page)).mine, 3000);
        const standingOne = (await waitFor(async () => { const s = await controlState(page); return s.standing === 'another device' ? s : null; }, 4000)) || (await controlState(page));
        await two.page.click('#control-key');
        await waitFor(async () => !(await controlState(two.page)).mine, 3000);
        const good = Boolean(refused) && !refused.mine && refused.note === 'ANOTHER DEVICE HAS CONTROL' && saysTwo.includes('ANOTHER DEVICE') && standingTwo.standing === 'another device' && stray.length === 0 && Boolean(tookAfter) && standingOne.standing === 'another device';
        part('f', good ? 'PASS' : 'FAIL', 'one device at a time',
          `while the first page held control, the second pressed [ CONTROL ]: it was told "${refused ? refused.note : 'nothing'}", shows "${saysTwo}", and /settings told it "${standingTwo.standing}"; a key it pressed reached the record ${stray.length} times; after the first let go, the second ${tookAfter ? 'was given control' : 'was NOT given control'} and the first was told "${standingOne.standing}"`);
        await two.context.close();
      }
      // (i) The other ways the page can draw the picture, and the other kind of mouse.
      {
        const lines = [];
        let good = true;
        const check = (ok, text) => { lines.push(`${ok === null ? 'COULD NOT TELL' : ok ? 'yes' : 'NO'}: ${text}`); if (ok === false) good = false; };
        const lastPointer = async (after) => (await entriesAfter(after, (list) => list.some((entry) => entry.what === 'pointer'))).filter((entry) => entry.what === 'pointer').pop();
        const near = (entry, x, y) => Boolean(entry) && Math.abs(entry.x - x) <= 2 && Math.abs(entry.y - y) <= 2;
        const sending = (await picture(page, { shape: '16:9', lines: 1080 })).sending;
        await page.click('#control-key');
        await waitFor(async () => (await controlState(page)).mine, 3000);
        // Opens or closes the settings panel with its own key, whichever way it is now.
        const panel = async (open) => { if ((await page.isVisible('#panel')) !== open) await page.click('#open-settings'); };
        const upscaling = async (mode) => { await panel(true); await page.click(`#upscaling button[data-upscaling="${mode}"]`); await panel(false); await sleep(250); };

        // Both ways of drawing (FAST, on its one canvas; NORMAL, the browser's own player) and all four ways of
        // fitting the picture to the window. Each time the pointer is put on known places of the PICTURE and the
        // record must show the matching pixel of the PC's screen.
        const fitted = await pictureBox(page);
        for (const way of ['fast', 'normal']) {
          await panel(true);
          await page.click(`#drawing button[data-drawing="${way}"]`);
          await panel(false);
          await sleep(300);
          for (const mode of ['off', 'smooth', 'sharp', 'sharpened']) {
            await upscaling(mode);
            const drawn = await page.evaluate(async () => { const st = await window.__debaserStats(); return { drawing: st.drawing, upscaling: st.upscaling.shown }; });
            const asWanted = drawn.drawing === way && drawn.upscaling === mode;
            // OFF draws the picture at its real size, so it overflows this 1280x800 page with its middle in the
            // page's middle; the others fit it to the page.
            const places = mode === 'off'
              ? [[VIEW.width / 2, VIEW.height / 2, 0.5, 0.5], [300, 200, (300 + (sending.width - VIEW.width) / 2) / sending.width, (200 + (sending.height - VIEW.height) / 2) / sending.height]]
              : [[fitted.left + 0.25 * fitted.width, fitted.top + 0.25 * fitted.height, 0.25, 0.25], [fitted.left + 0.8 * fitted.width, fitted.top + 0.6 * fitted.height, 0.8, 0.6]];
            const seen = [];
            let right = true;
            for (const [x, y, fx, fy] of places) {
              const after = await mark();
              await page.mouse.move(x, y);
              const got = await lastPointer(after);
              const want = [sending.x + fx * sending.regionWidth, sending.y + fy * sending.regionHeight];
              if (!near(got, want[0], want[1])) right = false;
              seen.push(`wanted ${want[0].toFixed(0)},${want[1].toFixed(0)} got ${got ? `${got.x},${got.y}` : 'nothing'}`);
            }
            check(asWanted ? right : null, `drawn ${way.toUpperCase()}, ${mode.toUpperCase()}${asWanted ? '' : ` (this browser drew ${drawn.drawing.toUpperCase()}, ${drawn.upscaling.toUpperCase()} instead)`}: ${seen.join('; ')}`);
          }
        }
        await upscaling('smooth');
        await panel(true);
        await page.click('#drawing button[data-drawing="fast"]');
        await panel(false);

        // GAME: the pointer is captured and its movement is sent as it is.
        let after;
        await panel(true);
        await page.click('#mouse button[data-mouse="game"]');
        const locked = await waitFor(async () => (await controlState(page)).pointerLocked, 1500);
        if (!locked) {
          check(null, 'GAME: this headless browser would not capture the pointer, so the page sent no movement (the panel says the pointer is not captured: ' + (await page.isVisible('#pointer-says').catch(() => false)) + ')');
        } else {
          await page.mouse.move(600, 400);
          await sleep(150);
          after = await mark();
          await page.mouse.move(610, 405);
          await page.mouse.move(617, 401);
          await page.mouse.down({ button: 'left' });
          await page.mouse.up({ button: 'left' });
          const entries = await entriesAfter(after, (list) => list.filter((entry) => entry.what === 'button').length >= 2);
          const moves = entries.filter((entry) => entry.what === 'move');
          const sum = moves.reduce((total, entry) => [total[0] + entry.dx, total[1] + entry.dy], [0, 0]);
          const absolute = entries.filter((entry) => entry.what === 'pointer').length;
          check(sum[0] === 17 && sum[1] === 1 && absolute === 0, `GAME (pointer captured): moving the page's mouse 17 right and 1 down in two steps sent movement adding up to ${sum[0]},${sum[1]} in ${moves.length} messages, and ${absolute} absolute positions; the click that followed carried no position`);
        }
        // A captured pointer cannot press the page's own keys; a person gets it back with Esc, the check asks the page.
        await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
        await waitFor(async () => !(await controlState(page)).pointerLocked, 1500);
        await panel(true);
        await page.click('#mouse button[data-mouse="pointer"]');

        // Fullscreen while controlling: system keys are asked for.
        await page.click('#fullscreen');
        const keys = await waitFor(async () => (await controlState(page)).keyboardLocked, 1500);
        const full = await page.evaluate(() => Boolean(document.fullscreenElement));
        check(keys ? true : null, `fullscreen while controlling (fullscreen ${full}): the browser ${keys ? 'handed over the system keys (Keyboard Lock)' : 'did not hand over the system keys here; the panel says: "' + (await page.textContent('#keys-says')) + '"'}`);
        if (full) await page.click('#fullscreen');
        await panel(false);
        const kept = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('debaser-engine-viewer')).mouse; } catch (error) { return null; } });
        check(kept === 'pointer', `the MOUSE choice is remembered on the device ("${kept}")`);
        await page.click('#control-key');
        await waitFor(async () => !(await controlState(page)).mine, 3000);
        part('i', good ? 'PASS' : 'FAIL', 'the pointer is right however the page draws the picture (FAST and NORMAL, every way of fitting), and GAME sends movement', lines.join('\n      '));
      }
      frameMarks.push(await frames(page));
      result.framesFirstHalf = [framesAtStart, ...frameMarks];
      result.letGo = { notes: letGo, good: letGoGood };
      result.streamFirstHalf = frameMarks.every((count, index) => count > (index ? frameMarks[index - 1] : framesAtStart)) && (await page.evaluate(async () => (await window.__debaserStats()).connectionState)) === 'connected';
      await one.context.close();
    }
    await finishRun('run 2: dry run, first half');

    // ---- The dry run, second half: a match, silence, and a page that closes. ----
    fs.rmSync(pretendFile, { force: true });
    engine = await startEngine(port, ['--allow-control', '--control-dry-run'], { DEBASER_PRETEND_MATCH_FILE: pretendFile });
    {
      const one = await openViewer(browser, port, '?hold=1');
      const page = one.page;
      const framesAtStart = await frames(page);
      const frameMarks = [];

      // (g) A League match (pretended): no control is given, and control that is held ends at once.
      {
        fs.writeFileSync(pretendFile, 'the control check is pretending a match is running\n');
        await waitFor(async () => { await page.evaluate(() => window.__debaserSettings.get()); return (await (await fetch(`http://127.0.0.1:${port}/settings`)).json()).controlWhy; }, 4000);
        const afterRefusal = await mark();
        await page.click('#control-key');
        const refused = await waitFor(async () => { const s = await controlState(page); return s.note ? s : null; }, 3000);
        const settings = await (await fetch(`http://127.0.0.1:${port}/settings`)).json();
        const refusedEntries = (await readLog()).entries.filter((entry) => entry.n > afterRefusal);
        fs.rmSync(pretendFile, { force: true });
        await waitFor(async () => !(await (await fetch(`http://127.0.0.1:${port}/settings`)).json()).controlWhy, 4000);
        await page.click('#control-key');
        const took = await waitFor(async () => (await controlState(page)).mine, 3000);
        const after = await mark();
        await page.keyboard.down('KeyE');
        const box = await pictureBox(page);
        await page.mouse.move(box.left + 0.5 * box.width, box.top + 0.5 * box.height);
        await page.mouse.down({ button: 'right' });
        await sleep(200);
        const startedAt = Date.now();
        fs.writeFileSync(pretendFile, 'the control check is pretending a match is running\n');
        const entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'), 4000);
        const endedMs = Date.now() - startedAt;
        const told = await waitFor(async () => { const s = await controlState(page); return !s.mine && s.note ? s : null; }, 3000);
        await page.mouse.up({ button: 'right' });
        await page.keyboard.up('KeyE');
        fs.rmSync(pretendFile, { force: true });
        const lines = entries.filter((entry) => entry.what !== 'pointer').map((entry) => (entry.what === 'key' ? keyLine(entry) : entry.what === 'button' ? `${entry.button} ${entry.down ? 'down' : 'up'}` : entry.what === 'ended' ? `ended: ${entry.why}` : entry.what));
        const good = Boolean(refused) && !refused.mine && refused.note === 'NOT DURING A LEAGUE MATCH' && settings.controlWhy === 'NOT DURING A LEAGUE MATCH' && refusedEntries.every((entry) => entry.what === 'refused') && Boolean(took) &&
          JSON.stringify(lines) === JSON.stringify(['KeyE 18 down', 'right down', 'KeyE 18 up', 'right up', 'ended: a League match started']) && Boolean(told) && told.note.includes('LEAGUE MATCH');
        part('g', good ? 'PASS' : 'FAIL', 'a League match (pretended) refuses control, and ends control that is held, with everything let go',
          `during the match, [ CONTROL ] was answered "${refused ? refused.note : 'nothing'}" and /settings said "${settings.controlWhy}"; after it, control was ${took ? 'given' : 'NOT given'}; with E and the right button held the match "started": ${lines.join(', ')} (${endedMs} ms later); the page was told "${told ? told.note : 'nothing'}"`);
        await waitFor(async () => !(await (await fetch(`http://127.0.0.1:${port}/settings`)).json()).controlWhy, 4000);
      }
      frameMarks.push(await frames(page));

      // (e, continued) Three seconds of silence: the page is frozen, as a tab left in the background can be.
      const letGo = result.letGo.notes;
      {
        await page.click('#control-key');
        await waitFor(async () => (await controlState(page)).mine, 3000);
        const after = await mark();
        await page.keyboard.down('KeyS');
        await sleep(150);
        const session = await one.context.newCDPSession(page);
        let how = 'the page frozen';
        const silentAt = Date.now();
        await session.send('Page.setWebLifecycleState', { state: 'frozen' });
        let entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'), 4500);
        await session.send('Page.setWebLifecycleState', { state: 'active' });
        if (!entries.some((entry) => entry.what === 'ended')) {
          // This browser kept the frozen page talking. The same silence, made by stopping the page's "still here".
          how = 'the page\'s "still here" stopped';
          await page.evaluate(() => clearInterval(control.stillHereTimer));
          entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'), 4500);
        }
        const silentMs = Date.now() - silentAt;
        const told = await waitFor(async () => { const s = await controlState(page); return !s.mine ? s : null; }, 3000);
        await page.keyboard.up('KeyS');
        const lines = entries.map((entry) => (entry.what === 'key' ? keyLine(entry) : entry.what === 'ended' ? `ended: ${entry.why}` : entry.what));
        const ok = JSON.stringify(lines) === JSON.stringify(['KeyS 31 down', 'KeyS 31 up', 'ended: the viewer went silent for 3 seconds']) && Boolean(told);
        if (!ok) result.letGo.good = false;
        letGo.push(`${ok ? 'yes' : 'NO'}: silence (${how}) with S held: ${lines.join(', ')} (${silentMs} ms after the silence began); the page was then told "${told ? told.note : 'nothing'}"`);
      }
      frameMarks.push(await frames(page));
      result.streamSecondHalf = frameMarks.every((count, index) => count > (index ? frameMarks[index - 1] : framesAtStart)) && (await page.evaluate(async () => (await window.__debaserStats()).connectionState)) === 'connected';
      result.framesSecondHalf = [framesAtStart, ...frameMarks];

      // (e, continued) The page closes while holding a key.
      {
        await page.click('#control-key');
        await waitFor(async () => (await controlState(page)).mine, 3000);
        const after = await mark();
        await page.keyboard.down('KeyD');
        await sleep(150);
        const closedAt = Date.now();
        await one.context.close();
        const entries = await entriesAfter(after, (list) => list.some((entry) => entry.what === 'ended'), 6000);
        const lines = entries.map((entry) => (entry.what === 'key' ? keyLine(entry) : entry.what === 'ended' ? `ended: ${entry.why}` : entry.what));
        const ended = entries.find((entry) => entry.what === 'ended');
        const ok = lines[0] === 'KeyD 32 down' && lines[1] === 'KeyD 32 up' && Boolean(ended);
        if (!ok) result.letGo.good = false;
        letGo.push(`${ok ? 'yes' : 'NO'}: the page closed with D held: ${lines.join(', ')} (${Date.now() - closedAt} ms after it closed)`);
      }
      part('e', result.letGo.good ? 'PASS' : 'FAIL', 'however control ends, what was held is let go (the record shows the ups)', letGo.join('\n      '));
      part('h', result.streamFirstHalf && result.streamSecondHalf ? 'PASS' : 'FAIL', 'the stream keeps running throughout',
        `frames decoded, read between the parts: first half ${result.framesFirstHalf.join(' -> ')}; second half ${result.framesSecondHalf.join(' -> ')}; the connection stayed "connected"`);
    }
    await finishRun('run 3: dry run, second half');
    }

    // ---- The one real thing: Windows takes the engine's input. A pointer moved two pixels and back. ----
    const real = 'REAL: Windows accepts the engine\'s input (the pointer nudged 2 right and 2 back), the strip is up while controlled, and the cut-off ends it';
    const where = (more = []) => JSON.parse(execFileSync(ENGINE, ['pointer-where', ...more], { encoding: 'utf8', windowsHide: true }).trim());
    if (process.argv.includes('--no-real')) {
      part('r', 'COULD NOT TELL', real, 'skipped: --no-real was given');
    } else if (leagueRunning()) {
      part('r', 'COULD NOT TELL', real, 'skipped: a League match started on this PC, and nothing real is sent during one');
    } else {
      engine = await startEngine(port, ['--allow-control'], {});
      const one = await openViewer(browser, port, '?hold=1');
      const page = one.page;
      const idle = where();
      const logRoute = await logAt(port);
      // Control is taken by the page's own function: nothing is clicked, and the page's pointer never moves.
      await page.evaluate(() => window.__debaserControl.take());
      const took = await waitFor(async () => (await controlState(page)).mine, 3000);
      let readings = null;
      let moved = false;
      let busy = 0;
      let tries = 0;
      // Someone may be using the mouse at this very moment. The nudge is only made when the pointer has been
      // still for a moment, and it is tried again (a dozen times at most) when the pointer moved by itself meanwhile.
      for (let attempt = 0; took && attempt < 12 && !moved; attempt += 1) {
        const still = where();
        await sleep(120);
        const before = where();
        if (still.x !== before.x || still.y !== before.y) {
          busy += 1;
          await sleep(350);
          continue;
        }
        tries += 1;
        await page.evaluate(() => window.__debaserControl.nudge(2, 0));
        await sleep(60);
        const between = where();
        await page.evaluate(() => window.__debaserControl.nudge(-2, 0));
        await sleep(60);
        const after = where();
        readings = { before, between, after };
        moved = between.x - before.x >= 1 && between.x - before.x <= 6 && between.y === before.y && after.x === before.x && after.y === before.y;
      }
      result.realTries = { nudged: tries, pointerWasMovingByItself: busy };
      const held = took ? where() : idle;
      const strip = held.strip;
      const cut = took ? where(['--cut-off']) : null;
      const ended = await waitFor(async () => { const s = await controlState(page); return !s.mine && s.note ? s : null; }, 3000);
      await sleep(300);
      const after = where();
      const engineSaid = engine.lines().filter((line) => /CONTROL|took CONTROL/.test(line));
      result.real = { idle, readings, cut, after, engineSaid };
      const stripGood = Boolean(strip) && strip.visible && strip.topmost && strip.clickThrough && strip.neverActivated && !strip.hasTheKeyboard && strip.top === 0 && strip.left === 0 && strip.text === 'CONTROLLED FROM ANOTHER DEVICE :: CTRL+ALT+SHIFT+END STOPS IT';
      const guardGood = idle.strip === null && idle.cutOffKeyFree && !held.cutOffKeyFree && Boolean(cut) && cut.cutOffPosted && Boolean(ended) && ended.note === 'CONTROL WAS STOPPED AT THE PC' && after.strip === null && after.cutOffKeyFree && logRoute.status === 403;
      const seen =
        `before control: no strip (${idle.strip === null}), Ctrl+Alt+Shift+End free (${idle.cutOffKeyFree}), GET /control-log answered ${logRoute.status} (there is no record outside a dry run)\n` +
        `      control ${took ? 'taken' : 'NOT taken'}; the real pointer read ${readings ? `${readings.before.x},${readings.before.y} before, ${readings.between.x},${readings.between.y} after the nudge right, ${readings.after.x},${readings.after.y} after the nudge back` : 'not at all'}\n` +
        `      the strip, seen from another program while controlled: ${strip ? `visible ${strip.visible}, at ${strip.left},${strip.top} to ${strip.right},${strip.bottom}, stays on top ${strip.topmost}, clicks pass through ${strip.clickThrough}, never activated ${strip.neverActivated}, has the keyboard ${strip.hasTheKeyboard}, says "${strip.text}"` : 'NOT FOUND'}\n` +
        `      the cut-off key while controlled: owned by the engine (${!held.cutOffKeyFree}); told it was pressed (${cut ? cut.cutOffPosted : false}): the page was told "${ended ? ended.note : 'nothing'}", and afterwards the strip is gone (${after.strip === null}) and the key is free again (${after.cutOffKeyFree})\n` +
        `      the engine said: ${engineSaid.join(' | ')}`;
      if (took && !moved && stripGood && guardGood) part('r', 'COULD NOT TELL', real, `${seen}\n      The pointer did not read as "2 right, then back": it was nudged ${tries} times, and ${busy} more times it was not still enough to try. Someone is using the mouse. Everything else held.`);
      else part('r', took && moved && stripGood && guardGood ? 'PASS' : 'FAIL', real, seen);
      await one.context.close();
      await finishRun('run 4: REAL (no dry run), the pointer nudge');
    }
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    await finishRun('the run that broke');
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(pretendFile, { force: true });
  }

  const order = 'abcdefghir';
  parts.sort((x, y) => order.indexOf(x.letter) - order.indexOf(y.letter));
  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= (onlyReal ? 1 : 10);
  result.engineOutput = engineOutput;

  console.log();
  console.log('DEBASER ENGINE :: control-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, on this PC (127.0.0.1). ${onlyReal ? 'Only the real part was run (--only-real).' : 'Parts (a) to (i) are a dry run: nothing reached Windows.'}`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  const said = engineOutput.filter((line) => /CONTROL|REFUSED/.test(line) || line.startsWith('---'));
  if (said.length) console.log(`  what the engine printed about control:\n${said.map((line) => `      ${line}`).join('\n')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `control-check-${stamp(new Date())}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`  saved ${path.relative(ENGINE_DIR, file)}`);
  return result.pass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FAIL. ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  },
);
