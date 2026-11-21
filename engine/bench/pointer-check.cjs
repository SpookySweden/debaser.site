#!/usr/bin/env node
/**
 * The proof that THE PC'S OWN POINTER SHAPE reaches a viewer (SPEC-screens.md): while a device controls the PC in
 * POINTER mode, its own pointer over the picture takes the shape the PC's pointer has, at the picture's scale,
 * and hides when the PC hides its own.
 *
 * Nobody can be asked to move the real mouse over a text box, so the engine is started with a test-only switch:
 * `DEBASER_PRETEND_POINTER_FILE=<path>` makes it ignore the real pointer and take the shape named by one word
 * in that file (engine/src/pointer.rs lists the words: three made-up shapes in Windows' three layouts, one too
 * large for a browser to show, and "hidden"). The check writes a word, and reads what the page did with it.
 * Control is a DRY RUN throughout (`--control-dry-run`): nothing reaches Windows.
 *
 * One last run has no pretending at all: it reports whether Windows handed the engine the REAL pointer's shape
 * (it only does when the pointer moves or changes, and this check never moves it).
 *
 *     node bench/pointer-check.cjs            (from the engine folder, after `cargo build --release`)
 *
 * Exit 0: every part passed (a part that "could not tell" does not fail it, and is said plainly).
 * Exit 1: something failed. Exit 3: not run at all, because a League match is running on this PC.
 * Exit 4: not run, because its port is taken (bench/own-port.cjs).
 *
 * What it cannot say: what the pointer LOOKS like on a real screen. It reads the style the page set, the size
 * and hot spot in it, and a few pixels of the picture the page made; nobody has looked at it.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const { PORTS, portProblem, leagueRunning } = require('./own-port.cjs');

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

async function startEngine(port, more, environment) {
  const args = ['serve', '--seconds', '45', '--tweaks', '12', '--port', String(port), ...more];
  const child = spawn(ENGINE, args, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '', DEBASER_PRETEND_STILL: '', DEBASER_PRETEND_TONE: '', DEBASER_PRETEND_POINTER_FILE: '', ...environment } });
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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
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

async function waitFor(test, ms, every = 50) {
  const began = Date.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() - began > ms) return null;
    await sleep(every);
  }
}

/**
 * Everything about the page's pointer over the picture: what the page says it is doing, the style really on the
 * picture (as the browser understood it), and the picture the page made for the pointer, measured by loading it
 * the way the browser does, with a few of its pixels read back.
 */
const look = (page) => page.evaluate(async () => {
  const said = window.__debaserPointer.state();
  const stage = document.getElementById('stage');
  const understood = getComputedStyle(stage).cursor;
  const out = { ...said, address: undefined, understood: understood.length > 90 ? `${understood.slice(0, 40)}...${understood.slice(-30)}` : understood, madeWidth: null, madeHeight: null, pixels: null, panelSays: document.getElementById('shape-says').hidden ? '' : document.getElementById('shape-says').textContent };
  out.understoodHot = (/\)\s+(\d+)\s+(\d+)\s*,/.exec(understood) || []).slice(1, 3).map(Number);
  if (said.use === 'shape' && said.address) {
    const image = new Image();
    await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; image.src = said.address; });
    out.madeWidth = image.naturalWidth;
    out.madeHeight = image.naturalHeight;
    if (image.naturalWidth) {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const pen = canvas.getContext('2d');
      pen.drawImage(image, 0, 0);
      const at = (fx, fy) => [...pen.getImageData(Math.min(canvas.width - 1, Math.floor(fx * canvas.width)), Math.min(canvas.height - 1, Math.floor(fy * canvas.height)), 1, 1).data];
      out.pixels = { leftMiddle: at(0.25, 0.5), rightMiddle: at(0.75, 0.5), middle: at(0.5, 0.5), topLeft: at(0, 0) };
    }
  }
  const box = window.__debaserDrawing.box();
  const host = window.__debaserSettings.get();
  out.expectedScale = box && host && host.sending ? box.width / host.sending.regionWidth : null;
  out.mine = window.__debaserControl.state().mine;
  return out;
});

const near = (a, b, by = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= by;
/** Whether a pixel is close to a colour (red, green, blue, how solid). */
const like = (pixel, colour, by = 40) => Array.isArray(pixel) && pixel.every((value, index) => Math.abs(value - colour[index]) <= by);

async function main() {
  const port = Number(option('--port', String(PORTS.pointer)));
  const result = { kind: 'pointer-check', when: new Date().toISOString(), pass: false, parts: [] };
  const parts = result.parts;
  const part = (letter, verdict, what, seen) => { parts.push({ letter, verdict, what, seen }); };

  if (leagueRunning()) {
    console.log('NOT RUN. A League match is running on this PC: nothing is built, started or sent while it is.');
    return 3;
  }
  const portTrouble = await portProblem(port);
  if (portTrouble) {
    console.log(`NOT RUN. ${portTrouble}`);
    return 4;
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

  const pretendFile = path.join(os.tmpdir(), `debaser-pointer-check-pretend-${process.pid}`);
  let browser = null;
  let engine = null;
  const engineOutput = [];
  const finishRun = async (label) => { if (engine) { await engine.stop(); engineOutput.push(`--- ${label} ---`, ...engine.lines().filter((line) => !/^\d+ s\s/.test(line))); engine = null; } };
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true };

    // ---- The pretended pointer, with control as a dry run. ----
    fs.writeFileSync(pretendFile, 'block\n');
    engine = await startEngine(port, ['--allow-control', '--control-dry-run'], { DEBASER_PRETEND_POINTER_FILE: pretendFile });
    {
      const one = await openViewer(browser, port, '?hold=1');
      const page = one.page;
      /** Tells the engine which pointer to pretend, and waits until the page has heard (`test` says when). */
      const pretend = async (word, test) => {
        fs.writeFileSync(pretendFile, `${word}\n`);
        return (await waitFor(async () => { const seen = await look(page); return test(seen) ? seen : null; }, 4000)) || (await look(page));
      };
      const panel = async (open) => { if ((await page.isVisible('#panel')) !== open) await page.click('#open-settings'); };
      const frames = () => page.evaluate(async () => (await window.__debaserStats()).framesDecoded);
      const framesAtStart = await frames();

      // (a) Not controlling: the shape arrives, and nothing about the page's pointer changes.
      const idle = (await waitFor(async () => { const seen = await look(page); return seen.number >= 1 ? seen : null; }, 4000)) || (await look(page));
      part('a', idle.number === 1 && idle.width === 24 && idle.height === 32 && idle.use === 'none' && idle.style === '' && !idle.mine && !/url\(/.test(idle.understood) ? 'PASS' : 'FAIL',
        'while this device is not controlling, nothing changes: no pointer is put on the picture',
        `the PC's shape number ${idle.number} arrived (${idle.width}x${idle.height}, hot spot ${idle.hotX},${idle.hotY}); the page is using "${idle.use}", has put the style "${idle.style}" on the picture, and the browser's own pointer there is "${idle.understood}"`);

      // (b) Controlling, POINTER mode: the page's pointer takes the shape, at the picture's scale.
      await page.click('#control-key');
      const took = await waitFor(async () => (await look(page)).mine, 3000);
      if (!took) throw new Error('Control was not given (dry run)');
      const lines = [];
      let shapesGood = true;
      const judge = (label, seen, pc) => {
        const scale = seen.expectedScale;
        const want = { width: Math.max(1, Math.round(pc.width * scale)), height: Math.max(1, Math.round(pc.height * scale)), hotX: Math.round(pc.hotX * scale), hotY: Math.round(pc.hotY * scale) };
        const ok = seen.use === 'shape' && seen.width === pc.width && seen.height === pc.height && seen.hotX === pc.hotX && seen.hotY === pc.hotY &&
          Boolean(seen.drawn) && seen.drawn.width === want.width && seen.drawn.height === want.height && near(seen.drawn.hotX, want.hotX, 0) && near(seen.drawn.hotY, want.hotY, 0) &&
          seen.madeWidth === want.width && seen.madeHeight === want.height && /^url\("data:image\/png/.test(seen.understood) && seen.understoodHot[0] === seen.drawn.hotX && seen.understoodHot[1] === seen.drawn.hotY;
        lines.push(`${ok ? 'yes' : 'NO'}: ${label}: the PC's pointer is ${seen.width}x${seen.height} with its hot spot at ${seen.hotX},${seen.hotY} (wanted ${pc.width}x${pc.height} at ${pc.hotX},${pc.hotY}); one PC pixel is ${scale === null ? '?' : scale.toFixed(3)} page pixels here, so it should be drawn ${want.width}x${want.height} with the hot spot at ${want.hotX},${want.hotY}; the page made a ${seen.madeWidth}x${seen.madeHeight} picture and the browser's pointer style is "${seen.understood}"`);
        return ok;
      };
      const block = await pretend('block', (seen) => seen.use === 'shape' && seen.width === 24);
      if (!judge('"block" (a colour pointer)', block, { width: 24, height: 32, hotX: 3, hotY: 5 })) shapesGood = false;
      // Its left half is solid white and its right half half-solid red.
      const blockPixels = block.pixels && like(block.pixels.leftMiddle, [255, 255, 255, 255]) && like(block.pixels.rightMiddle, [255, 0, 0, 128]);
      lines.push(`${blockPixels ? 'yes' : 'NO'}: its pixels, read back from the picture the page made: the left half ${JSON.stringify(block.pixels && block.pixels.leftMiddle)} (wanted solid white), the right half ${JSON.stringify(block.pixels && block.pixels.rightMiddle)} (wanted half-solid red)`);
      if (!blockPixels) shapesGood = false;
      const bar = await pretend('bar', (seen) => seen.use === 'shape' && seen.width === 10);
      if (!judge('"bar" (a one-bit pointer whose pixels invert what is under them: sent as a white bar with a black edge)', bar, { width: 10, height: 22, hotX: 5, hotY: 11 })) shapesGood = false;
      const mask = await pretend('mask', (seen) => seen.use === 'shape' && seen.width === 18);
      if (!judge('"mask" (the masked kind)', mask, { width: 18, height: 18, hotX: 9, hotY: 9 })) shapesGood = false;
      part('b', shapesGood ? 'PASS' : 'FAIL', 'controlling in POINTER mode: this device\'s pointer over the picture takes each new shape, with its size and hot spot at the picture\'s scale', lines.join('\n      '));

      // (c) A settings change (the PC sends another piece of its screen, so the scale changes), and the picture
      // shown at its real size, where one PC pixel is exactly one page pixel.
      {
        const notes = [];
        let good = true;
        await pretend('block', (seen) => seen.use === 'shape' && seen.width === 24);
        const before = await look(page);
        const answer = await page.evaluate(async () => (await window.__debaserSettings.ask({ shape: 'native', lines: 'native' })).sending);
        const after = (await waitFor(async () => { const seen = await look(page); return seen.use === 'shape' && seen.expectedScale !== null && Math.abs(seen.expectedScale - before.expectedScale) > 0.01 ? seen : null; }, 8000)) || (await look(page));
        const changed = after.use === 'shape' && after.number === before.number && Math.abs(after.expectedScale - before.expectedScale) > 0.01;
        notes.push(`${changed ? 'yes' : 'NO'}: the stream was changed to all of the PC's screen (${answer.regionWidth}x${answer.regionHeight}, sent as ${answer.width}x${answer.height}): the pointer is still the same shape (number ${after.number}, was ${before.number}), and one PC pixel went from ${before.expectedScale.toFixed(3)} to ${after.expectedScale === null ? '?' : after.expectedScale.toFixed(3)} page pixels`);
        if (!changed) good = false;
        if (!judge('after that change', after, { width: 24, height: 32, hotX: 3, hotY: 5 })) good = false;
        notes.push(lines.pop());
        await panel(true);
        await page.click('#upscaling button[data-upscaling="off"]');
        await panel(false);
        const real = (await waitFor(async () => { const seen = await look(page); return seen.use === 'shape' && near(seen.expectedScale, 1, 0.001) ? seen : null; }, 4000)) || (await look(page));
        if (!judge('the picture at its real size (UPSCALING OFF)', real, { width: 24, height: 32, hotX: 3, hotY: 5 })) good = false;
        notes.push(lines.pop());
        const exact = Boolean(real.drawn) && real.drawn.width === 24 && real.drawn.height === 32 && real.drawn.hotX === 3 && real.drawn.hotY === 5;
        if (!exact) good = false;
        notes.push(`${exact ? 'yes' : 'NO'}: at real size the pointer is drawn exactly as the PC has it: ${real.drawn ? `${real.drawn.width}x${real.drawn.height}, hot spot ${real.drawn.hotX},${real.drawn.hotY}` : 'not drawn'}`);
        part('c', good ? 'PASS' : 'FAIL', 'the shape survives a settings change, and follows the picture\'s scale', notes.join('\n      '));
      }

      // (d) Past the size a browser will show: the plain arrow. (Still at real size: 200 by 200 is over 128.)
      {
        const large = await pretend('large', (seen) => seen.width === 200);
        await panel(true);
        const says = await page.textContent('#shape-says').catch(() => '');
        const saysShown = await page.isVisible('#shape-says');
        await page.click('#upscaling button[data-upscaling="smooth"]');
        await panel(false);
        // Fitted to this 1280-wide page, the same pointer is small enough to show.
        const fitted = (await waitFor(async () => { const seen = await look(page); return seen.use === 'shape' ? seen : null; }, 4000)) || (await look(page));
        const wantFitted = Math.round(200 * fitted.expectedScale);
        const good = large.use === 'arrow' && large.style === 'default' && large.understood === 'default' && saysShown && says.includes('A PLAIN ARROW IS SHOWN') && large.limit === 128 &&
          fitted.use === 'shape' && fitted.madeWidth === wantFitted && wantFitted <= 128;
        part('d', good ? 'PASS' : 'FAIL', 'a pointer larger than a browser will show falls back to the plain arrow',
          `"large" (200x200) with the picture at its real size: the page uses "${large.use}", the style is "${large.style}" and the browser's pointer is "${large.understood}"; the panel says "${says}" (shown: ${saysShown}); the limit the page uses is ${large.limit}\n` +
          `      the same pointer with the picture fitted to the page (one PC pixel = ${fitted.expectedScale === null ? '?' : fitted.expectedScale.toFixed(3)} page pixels): "${fitted.use}", drawn ${fitted.madeWidth}x${fitted.madeHeight} (wanted ${wantFitted}x${wantFitted})`);
      }

      // (e) Hidden, GAME mode, and letting go.
      {
        const notes = [];
        let good = true;
        const note = (ok, text) => { notes.push(`${ok ? 'yes' : 'NO'}: ${text}`); if (!ok) good = false; };
        const hidden = await pretend('hidden', (seen) => seen.use === 'hidden');
        note(hidden.use === 'hidden' && hidden.style === 'none' && hidden.understood === 'none' && hidden.shown === false, `the PC hides its pointer: the page uses "${hidden.use}", the style is "${hidden.style}", the browser's pointer over the picture is "${hidden.understood}"`);
        const back = await pretend('block', (seen) => seen.use === 'shape' && seen.width === 24);
        note(back.use === 'shape' && back.shown === true && /^url\(/.test(back.understood), `the PC shows it again (as "block"): "${back.use}", "${back.understood}"`);
        await panel(true);
        await page.click('#mouse button[data-mouse="game"]');
        await sleep(300);
        const game = await look(page);
        // (A captured pointer cannot press the page's keys; a person gets it back with Esc, the check asks the page.)
        await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
        await sleep(200);
        note(game.use === 'none' && game.style === '', `GAME mode (the pointer is captured, so there is none to shape): the page uses "${game.use}" and the style is "${game.style}"`);
        await panel(true);
        await page.click('#mouse button[data-mouse="pointer"]');
        await panel(false);
        const pointerAgain = (await waitFor(async () => { const seen = await look(page); return seen.use === 'shape' ? seen : null; }, 3000)) || (await look(page));
        note(pointerAgain.use === 'shape', `back to POINTER mode: "${pointerAgain.use}"`);
        await page.click('#control-key');
        const released = (await waitFor(async () => { const seen = await look(page); return !seen.mine ? seen : null; }, 3000)) || (await look(page));
        note(!released.mine && released.use === 'none' && released.style === '' && !/url\(/.test(released.understood), `control let go: the page uses "${released.use}", the style is "${released.style}", the browser's pointer over the picture is "${released.understood}"`);
        part('e', good ? 'PASS' : 'FAIL', 'it hides when the PC hides its pointer, and is only there while controlling in POINTER mode', notes.join('\n      '));
      }

      // (f) A device that joins later is told the shape at once, and the stream never stopped.
      {
        const two = await openViewer(browser, port, '?hold=1');
        const late = (await waitFor(async () => { const seen = await look(two.page); return seen.number >= 1 ? seen : null; }, 4000)) || (await look(two.page));
        const first = await look(page);
        const framesNow = await frames();
        const state = await page.evaluate(async () => (await window.__debaserStats()).connectionState);
        const host = await (await fetch(`http://127.0.0.1:${port}/settings`)).json();
        part('f', late.number === first.number && late.width === 24 && late.height === 32 && late.shown === true && framesNow > framesAtStart && state === 'connected' && host.pointer.shape === first.number && one.errors.length === 0 ? 'PASS' : 'FAIL',
          'a device that joins later is told the current shape, and the stream kept running',
          `a second page, opened after everything above: shape number ${late.number} (the first page has ${first.number}), ${late.width}x${late.height}, showing ${late.shown}; /settings says the PC's pointer is ${JSON.stringify(host.pointer)}; the first page decoded ${framesAtStart} frames at the start and ${framesNow} now, its connection is "${state}"; errors on the page: ${one.errors.length ? one.errors.join(' | ') : 'none'}`);
        await two.context.close();
      }
      await one.context.close();
    }
    await finishRun('run 1: the pretended pointer');

    // ---- The real pointer: does Windows hand its shape over? (Nothing is moved by this check.) ----
    engine = await startEngine(port, [], {});
    {
      const one = await openViewer(browser, port, '?hold=1');
      const page = one.page;
      await sleep(2500);
      const host = await (await fetch(`http://127.0.0.1:${port}/settings`)).json();
      const seen = await look(page);
      const got = host.pointer.shape >= 1 && seen.number === host.pointer.shape && seen.width === host.pointer.width;
      part('r', got ? 'PASS' : host.pointer.shape === 0 ? 'COULD NOT TELL' : 'FAIL', 'REAL: Windows hands the engine the PC\'s real pointer shape, and the page receives it',
        got ? `Windows handed over shape number ${host.pointer.shape}: ${host.pointer.width}x${host.pointer.height} once turned into pixels, the pointer showing: ${host.pointer.shown}; the page received the same (${seen.width}x${seen.height}, hot spot ${seen.hotX},${seen.hotY})`
          : `the engine says ${JSON.stringify(host.pointer)} and the page ${JSON.stringify({ number: seen.number, width: seen.width, height: seen.height })}` + (host.pointer.shape === 0 ? '\n      Windows only describes the pointer when it moves or changes, and nobody moved the mouse in these few seconds (this check never does).' : ''));
      await one.context.close();
    }
    await finishRun('run 2: REAL (no pretending)');
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    await finishRun('the run that broke');
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(pretendFile, { force: true });
  }

  const order = 'abcdefr';
  parts.sort((x, y) => order.indexOf(x.letter) - order.indexOf(y.letter));
  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= 7;
  result.engineOutput = engineOutput;

  console.log();
  console.log('DEBASER ENGINE :: pointer-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, a ${VIEW.width}x${VIEW.height} page, on this PC (127.0.0.1). Parts (a) to (f) pretend the PC's pointer (DEBASER_PRETEND_POINTER_FILE) and control is a dry run.`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  const said = engineOutput.filter((line) => /pointer/i.test(line) || line.startsWith('---'));
  if (said.length) console.log(`  what the engine printed about the pointer:\n${said.map((line) => `      ${line}`).join('\n')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `pointer-check-${stamp(new Date())}.json`);
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
