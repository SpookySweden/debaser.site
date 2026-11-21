#!/usr/bin/env node
/**
 * The proof of the still-screen rule (SPEC-screens.md; engine switch 64, on by default): when nothing on the
 * screen changes, the gaps between repeated frames grow (the first when it always came, then 100 ms, 200 ms,
 * then every 500 ms) instead of a repeat every frame's time, and the stream is still there the moment it is needed.
 *
 * A really still screen cannot be arranged on a PC that is in use, so the engine is started with
 * `DEBASER_PRETEND_STILL=1` (test-only): after its first picture it behaves as if the screen never changed.
 * Three short runs, each with a headless Chrome (or Edge) on this same PC:
 *   1. the old way (`--tweaks 12`): a repeat every frame's time;
 *   2. the rule (`--tweaks 76`, which is 12 + 64): how many frames and how much data a second, whether the
 *      picture is still showing, and how fast a second viewer gets its full picture;
 *   3. the rule on the REAL screen (no pretending): a screen that is changing must not be slowed by it.
 *
 *     node bench/still-check.cjs            (from the engine folder, after `cargo build --release`)
 *
 * Exit 0: every part passed (a part that "could not tell" does not fail it). Exit 1: something failed.
 * Exit 3: not run at all, because a League match is running on this PC.
 */
'use strict';

const fs = require('node:fs');
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

const VIEW = { width: 1280, height: 720 };
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

async function startEngine(port, tweaks, pretendStill) {
  const args = ['serve', '--seconds', '20', '--tweaks', String(tweaks), '--port', String(port)];
  const child = spawn(ENGINE, args, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '', DEBASER_PRETEND_STILL: pretendStill ? '1' : '' } });
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

/** Opens the viewer page (leaving the stream as the engine started it) and waits for its first frames. */
async function openViewer(browser, port) {
  const context = await browser.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/?hold=1`, { waitUntil: 'load', timeout: 8000 });
  const began = Date.now();
  for (;;) {
    const frames = await page.evaluate(async () => (await window.__debaserStats()).framesDecoded);
    if (frames >= 1) break;
    if (Date.now() - began > 10000) throw new Error('The viewer page never decoded a frame');
    await sleep(50);
  }
  return { context, page };
}

/** What the browser received and decoded over a stretch of time, a second. */
async function rate(page, forMs) {
  const read = () => page.evaluate(async () => { const s = await window.__debaserStats(); return { frames: s.framesDecoded, bytes: s.bytesReceived, keys: s.keyFramesDecoded, at: performance.now(), wide: s.frameWidth, tall: s.frameHeight, state: s.connectionState }; });
  const a = await read();
  await sleep(forMs);
  const b = await read();
  const seconds = (b.at - a.at) / 1000;
  return { framesPerSecond: (b.frames - a.frames) / seconds, kbitPerSecond: ((b.bytes - a.bytes) * 8) / 1000 / seconds, picture: `${b.wide}x${b.tall}`, state: b.state, keyFramesDecoded: b.keys };
}

async function main() {
  const port = Number(option('--port', '8481'));
  const result = { kind: 'still-check', when: new Date().toISOString(), pass: false, parts: [] };
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

  let browser = null;
  let engine = null;
  const engineOutput = [];
  const finishRun = async (label) => { if (engine) { await engine.stop(); engineOutput.push(`--- ${label} ---`, ...engine.lines()); engine = null; } };
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true };

    // ---- 1. The old way, on a pretended still screen. ----
    engine = await startEngine(port, 12, true);
    let viewer = await openViewer(browser, port);
    await sleep(1200);
    const old = await rate(viewer.page, 4000);
    result.oldWay = old;
    await viewer.context.close();
    await finishRun('run 1: a pretended still screen, the old way (--tweaks 12)');

    // ---- 2. The rule, on the same pretended still screen. ----
    engine = await startEngine(port, 76, true);
    viewer = await openViewer(browser, port);
    const page = viewer.page;
    await sleep(1200);
    const rested = await rate(page, 4000);
    result.rule = rested;
    {
      const few = rested.framesPerSecond >= 1 && rested.framesPerSecond <= 4;
      const little = rested.kbitPerSecond <= old.kbitPerSecond * 0.25;
      part('a', few && little ? 'PASS' : 'FAIL', 'on a still screen the repeats thin out to about two a second',
        `the old way: ${old.framesPerSecond.toFixed(1)} frames and ${old.kbitPerSecond.toFixed(0)} kbit a second; with the rule, after the first second: ${rested.framesPerSecond.toFixed(1)} frames and ${rested.kbitPerSecond.toFixed(0)} kbit a second (${old.kbitPerSecond > 0 ? ((rested.kbitPerSecond / old.kbitPerSecond) * 100).toFixed(1) : '?'}% of the data)`);
    }
    {
      // The picture is still there: the page's own canvas holds a lit picture of the right size, drawn from a
      // frame that arrived during the rest.
      const probe = await page.evaluate(() => window.__debaserDrawing.probe());
      result.picture = probe;
      const good = rested.state === 'connected' && probe.looked && probe.litShare > 0.02 && probe.width > 0;
      part('b', good ? 'PASS' : 'FAIL', 'the picture is still showing while the stream rests',
        `connection "${rested.state}", picture ${rested.picture}, drawn ${String(probe.drawing).toUpperCase()}; ${probe.looked ? `a frame that arrived during the rest was drawn ${probe.width}x${probe.height} with ${(probe.litShare * 100).toFixed(0)}% of the sampled points lit` : 'no frame arrived to look at within 2.5 seconds'}`);
    }
    {
      // A viewer that needs a full picture gets one at once, not at the next half-second. A second viewer
      // joining is such a need; the engine prints when it connected and when its full picture left.
      const keysBefore = (await rate(page, 100)).keyFramesDecoded;
      const second = await openViewer(browser, port);
      await sleep(400);
      const said = engine.lines();
      const connected = said.map((line) => /viewer 2 connected (\d+) ms after its hello/.exec(line)).find(Boolean);
      const started = said.map((line) => /viewer 2 starts from a full picture, (\d+) ms after its hello/.exec(line)).find(Boolean);
      const waited = connected && started ? Number(started[1]) - Number(connected[1]) : null;
      const keysAfter = (await rate(page, 100)).keyFramesDecoded;
      part('c', waited !== null && waited < 100 && keysAfter > keysBefore ? 'PASS' : 'FAIL', 'a full picture is still sent at once when a viewer needs one',
        waited === null ? 'the engine did not print when the second viewer connected and got its picture' : `a second viewer joined mid-rest: its full picture left ${waited} ms after it connected; the first viewer decoded it too (${keysBefore} full pictures before, ${keysAfter} after)`);
      await second.context.close();
    }
    const spared = engine.lines().filter((line) => line.includes('repeats spared'));
    result.sparedLines = spared;
    await viewer.context.close();
    await finishRun('run 2: a pretended still screen, with the rule (--tweaks 76)');

    // ---- 3. The rule on the real screen: a screen that is changing must not be slowed. ----
    engine = await startEngine(port, 76, false);
    viewer = await openViewer(browser, port);
    await sleep(1500);
    const real = await rate(viewer.page, 4000);
    const host = await (await fetch(`http://127.0.0.1:${port}/settings`)).json();
    result.realScreen = { ...real, hostMeasured: host.measured, sending: host.sending };
    {
      const what = 'on the real screen, a picture that is changing is sent at full speed';
      const fresh = host.measured ? host.measured.newFramesPerSecond : 0;
      const seen = `the PC says ${fresh.toFixed(0)} new frames a second were there to send (up to ${host.sending.fps} allowed); the browser decoded ${real.framesPerSecond.toFixed(1)} a second`;
      if (fresh < 20) part('d', 'COULD NOT TELL', what, `${seen}. The real screen was nearly still during this run, so there was no full speed to keep.`);
      else part('d', real.framesPerSecond >= fresh * 0.85 ? 'PASS' : 'FAIL', what, seen);
    }
    await viewer.context.close();
    await finishRun('run 3: the real screen, with the rule (--tweaks 76)');
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    await finishRun('the run that broke');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= 4;
  result.engineOutput = engineOutput;

  console.log();
  console.log('DEBASER ENGINE :: still-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, on this PC (127.0.0.1). Parts (a) to (c) pretend the screen is still (DEBASER_PRETEND_STILL=1).`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  if (result.sparedLines && result.sparedLines.length) console.log(`  the engine's own once-a-second lines while resting:\n${result.sparedLines.slice(0, 4).map((line) => `      ${line}`).join('\n')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `still-check-${stamp(new Date())}.json`);
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
