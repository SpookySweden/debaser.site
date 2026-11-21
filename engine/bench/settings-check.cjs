#!/usr/bin/env node
/**
 * The proof that the stream's SETTINGS work (SPEC-screens.md): the shape and size of the picture, its frames a
 * second, the PC's caps, and the viewer page's own panel.
 *
 * It starts the engine three times (the second time pretending a League match is running throughout, the third
 * time switching that pretence on and off while the stream runs), opens the viewer page in a
 * HEADLESS Chrome (or Edge) on this same PC, asks for changes through the same code the panel's keys use
 * (`window.__debaserSettings.ask`), and after each one reads the size of the frames the browser REALLY decoded
 * (`window.__debaserStats()`). No window opens, nothing is typed into the desktop, and the PC's own display mode
 * is never touched.
 *
 *     node bench/settings-check.cjs            (from the engine folder, after `cargo build --release`)
 *     node bench/settings-check.cjs --port 8611
 *
 * Exit 0: every part passed (a part that "could not tell" does not fail it, and is said plainly).
 * Exit 1: something failed, with the reason.
 * Exit 3: not run at all, because a League match is running on this PC. Exit 4: not run, because its port is
 * taken (bench/own-port.cjs: a check never uses the live engine's port, nor one that something already answers on).
 *
 * What it cannot say: how the picture LOOKS. It checks sizes, rates, that the same connection carried on, and for
 * the SHARPENED mode that the canvas holds a lit picture close to the plain one; nobody has looked at it.
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

/** The pretend viewer: a 1280x800 screen (16:10), one screen pixel per page pixel. */
const VIEW = { width: 1280, height: 800 };
/** How long a change may take to show up in the decoded frames before it counts as failed. */
const SETTLE_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function stamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

const sameShape = (width, height, wide, tall) => Math.abs(width / height - wide / tall) / (wide / tall) < 0.01;

/** Starts the engine and waits until it says it is ready. `environment` adds to this process's own. */
async function startEngine(port, environment) {
  const args = ['serve', '--seconds', '40', '--tweaks', '12', '--port', String(port)];
  const child = spawn(ENGINE, args, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...environment } });
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

/** Opens the viewer page as a 1280x800 screen would. */
async function openViewer(browser, port, query = '') {
  const context = await browser.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const outside = new Set();
  page.on('request', (request) => { const origin = new URL(request.url()).origin; if (origin !== `http://127.0.0.1:${port}`) outside.add(origin); });
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load', timeout: 8000 });
  return { context, page, errors, outside };
}

/**
 * Waits, inside the page, until the PC says it is sending what `wanted(host)` accepts AND the browser's decoded
 * frames are that size. Returns what it saw either way.
 */
function waitForPicture(page, timeoutMs) {
  return page.evaluate(async (timeout) => {
    const began = performance.now();
    let host = null;
    let stats = null;
    while (performance.now() - began < timeout) {
      host = window.__debaserSettings.get();
      stats = await window.__debaserStats();
      if (host && host.applied && host.sending && stats.frameWidth === host.sending.width && stats.frameHeight === host.sending.height) {
        return { settled: true, ms: performance.now() - began, host, stats };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { settled: false, ms: performance.now() - began, host, stats };
  }, timeoutMs);
}

/** The same, until the PC's answer also passes `test` (so a change made by pressing a key has really arrived). */
async function settleOn(page, test) {
  const began = Date.now();
  let seen = null;
  while (Date.now() - began < SETTLE_MS) {
    seen = await waitForPicture(page, 400);
    if (seen.settled && test(seen)) return seen;
  }
  return { ...seen, settled: false };
}

/** Asks for a change through the page's own `ask`, then waits for decoded frames of the size the PC answered. */
function askAndWait(page, partial, timeoutMs) {
  return page.evaluate(async ({ change, timeout }) => {
    const began = performance.now();
    let answer;
    try {
      answer = await window.__debaserSettings.ask(change);
    } catch (error) {
      return { refused: String(error && error.message ? error.message : error) };
    }
    const answeredMs = performance.now() - began;
    let stats = null;
    while (performance.now() - began < timeout) {
      stats = await window.__debaserStats();
      if (answer.sending && stats.frameWidth === answer.sending.width && stats.frameHeight === answer.sending.height) {
        return { settled: true, answeredMs, settledMs: performance.now() - began, answer, stats };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { settled: false, answeredMs, settledMs: performance.now() - began, answer, stats };
  }, { change: partial, timeout: timeoutMs });
}

/** Frames a second really decoded over a stretch of time. */
async function decodedRate(page, forMs) {
  const read = () => page.evaluate(async () => { const s = await window.__debaserStats(); return { frames: s.framesDecoded, at: performance.now() }; });
  const a = await read();
  await sleep(forMs);
  const b = await read();
  return ((b.frames - a.frames) * 1000) / (b.at - a.at);
}

async function main() {
  const port = Number(option('--port', String(PORTS.settings)));
  const result = { kind: 'settings-check', when: new Date().toISOString(), pass: false, parts: [] };
  const parts = result.parts;
  // One line of the result: 'PASS', 'FAIL' or 'COULD NOT TELL', what was being proved, and what was seen.
  const part = (letter, verdict, what, seen, extra = {}) => { parts.push({ letter, verdict, what, seen, ...extra }); };

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

  const pretendFile = path.join(os.tmpdir(), `debaser-settings-check-pretend-match-${process.pid}`);
  let browser = null;
  let engine = null;
  const engineOutput = [];
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true, pretendScreen: `${VIEW.width}x${VIEW.height}` };

    // ---- First run: the engine as it normally starts. ----
    engine = await startEngine(port, { DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '' });
    let viewer = await openViewer(browser, port);
    let page = viewer.page;
    const changeTimes = [];
    const stillConnected = async (after) => {
      const s = await page.evaluate(() => window.__debaserStats());
      changeTimes.push({ after, connectionState: s.connectionState, connectionsMade: s.connectionsMade });
      return s.connectionState === 'connected' && s.connectionsMade === 1;
    };
    let reconnects = 0;

    // (a) Left alone, the page asks the PC to match its screen once the picture is flowing.
    {
      const began = Date.now();
      let seen = null;
      while (Date.now() - began < SETTLE_MS + 4000) {
        seen = await waitForPicture(page, 500);
        if (seen.settled && seen.host.asked.shape === 'match') break;
      }
      const host = seen && seen.host;
      result.screen = host ? host.screen : null;
      result.hostLimits = host ? host.hostLimits : null;
      result.realMatchRunning = Boolean(host && host.cap);
      if (!seen || !seen.settled || !host || host.asked.shape !== 'match') {
        part('a', 'FAIL', 'MATCH THIS SCREEN applies itself when the page opens', `after ${((Date.now() - began) / 1000).toFixed(1)} s the PC was asked for "${host ? host.asked.shape : 'nothing'}" and the browser was decoding ${seen && seen.stats ? `${seen.stats.frameWidth}x${seen.stats.frameHeight}` : 'nothing'}${viewer.errors.length ? `; page errors: ${viewer.errors.join(' | ')}` : ''}`);
        throw new Error('The stream never settled on the matched picture, so the rest could not be tried.');
      }
      const s = seen.stats;
      const good = host.asked.viewWidth === VIEW.width && host.asked.viewHeight === VIEW.height && sameShape(s.frameWidth, s.frameHeight, VIEW.width, VIEW.height) && s.frameHeight <= VIEW.height;
      part('a', good ? 'PASS' : 'FAIL', 'MATCH THIS SCREEN applies itself when the page opens', `the page reported a ${host.asked.viewWidth}x${host.asked.viewHeight} screen; the browser decoded ${s.frameWidth}x${s.frameHeight} (the PC took the middle ${host.sending.regionWidth}x${host.sending.regionHeight} of its ${host.screen.width}x${host.screen.height} screen)`);
      if (!(await stillConnected('a'))) reconnects += 1;
    }
    const screen = result.screen;

    // (l) FRAMES A SECOND, AUTO: the viewer's own screen rate, up to what the PC's screen shows.
    {
      const mine = await page.evaluate(async () => ({ host: window.__debaserSettings.get(), hz: (await window.__debaserStats()).screenHz }));
      const most = mine.host.hostLimits.maxFps;
      const notes = [];
      let good = true;
      const check = (ok, note) => { notes.push(`${ok ? 'yes' : 'NO'}: ${note}`); if (!ok) good = false; };
      check(mine.host.asked.fps === 'auto' && mine.host.asked.viewHz === mine.hz && mine.host.sending.fps === Math.min(mine.hz, mine.host.limits.maxFps),
        `left alone, the page measured its own screen at ${mine.hz} frames a second and asked for AUTO with it (the PC was asked for "${mine.host.asked.fps}" at ${mine.host.asked.viewHz}); the PC is sending up to ${mine.host.sending.fps}`);
      for (const viewHz of [144, 240]) {
        const r = await askAndWait(page, { fps: 'auto', viewHz }, SETTLE_MS);
        const want = Math.min(viewHz, most);
        check(Boolean(r.answer) && r.answer.sending.fps === want && (await page.evaluate(async () => (await window.__debaserStats()).connectionState)) === 'connected',
          r.refused ? `a pretended ${viewHz} Hz viewer was refused: ${r.refused}` : `a pretended ${viewHz} Hz viewer on AUTO: the PC (whose own screen shows ${mine.host.screen.hz}) sends up to ${r.answer.sending.fps} (wanted ${want})`);
      }
      await page.click('#open-settings');
      const says = await page.textContent('#rate-says');
      const pressed = await page.getAttribute('#rates button[data-fps="auto"]', 'aria-pressed');
      check(pressed === 'true' && says.includes('AUTO follows this screen') && says.includes(`${mine.hz} frames a second`), `the panel shows [ AUTO ] pressed and says: "${says}"`);
      await page.keyboard.press('Escape');
      const back = await askAndWait(page, { fps: 'auto', viewHz: mine.hz }, SETTLE_MS);
      if (back.refused) throw new Error(`The PC refused to go back to AUTO: ${back.refused}`);
      part('l', good ? 'PASS' : 'FAIL', 'FRAMES A SECOND on AUTO follows the viewer\'s screen, up to the PC\'s own', notes.join('\n      '));
      if (!(await stillConnected('l'))) reconnects += 1;
    }

    // (b) A named shape and size.
    {
      const r = await askAndWait(page, { shape: '16:9', lines: 720 }, SETTLE_MS);
      const canBe = screen.width * 9 >= screen.height * 16 && screen.height >= 720;
      const good = r.settled && (canBe ? r.stats.frameWidth === 1280 && r.stats.frameHeight === 720 : sameShape(r.stats.frameWidth, r.stats.frameHeight, 16, 9));
      part('b', good ? 'PASS' : 'FAIL', "ask({shape:'16:9', lines:720}) gives 1280x720", r.refused ? `the PC refused: ${r.refused}` : `the PC answered ${r.answer.sending.width}x${r.answer.sending.height}; the browser decoded ${r.stats ? `${r.stats.frameWidth}x${r.stats.frameHeight}` : 'nothing'}`, { answeredMs: r.answeredMs, settledMs: r.settledMs });
      if (!(await stillConnected('b'))) reconnects += 1;
    }

    // (e) Frames a second. Only a changing screen can show it: a still one sends too few frames to tell.
    {
      const sixty = await askAndWait(page, { fps: 60 }, SETTLE_MS);
      if (sixty.refused) throw new Error(`The PC refused 60 frames a second: ${sixty.refused}`);
      await sleep(400);
      const before = await decodedRate(page, 2000);
      const r = await askAndWait(page, { fps: 30 }, SETTLE_MS);
      await sleep(500);
      const after = await decodedRate(page, 3000);
      const host = await page.evaluate(() => window.__debaserSettings.get());
      const seen = `at 60 asked the browser decoded ${before.toFixed(1)} frames a second; at 30 asked, ${after.toFixed(1)} (the PC says it is sending up to ${r.answer ? r.answer.sending.fps : '?'})`;
      if (r.refused || !r.answer || r.answer.sending.fps !== 30) part('e', 'FAIL', 'ask({fps:30}) brings the frames a second near 30', r.refused ? `the PC refused: ${r.refused}` : seen);
      else if (before < 45) part('e', 'COULD NOT TELL', 'ask({fps:30}) brings the frames a second near 30', `${seen}. The screen was not changing fast enough to tell 60 from 30.`);
      else part('e', after >= 25 && after <= 35 ? 'PASS' : 'FAIL', 'ask({fps:30}) brings the frames a second near 30', seen, { answeredMs: r.answeredMs });
      result.fps = { before, after, hostMeasured: host && host.measured };
      const back = await askAndWait(page, { fps: 60 }, SETTLE_MS);
      if (back.refused) throw new Error(`The PC refused to go back to 60 frames a second: ${back.refused}`);
      if (!(await stillConnected('e'))) reconnects += 1;
    }

    // (c) Matching a different screen: a 1920x1200 laptop.
    {
      const r = await askAndWait(page, { shape: 'match', viewWidth: 1920, viewHeight: 1200, lines: 1080 }, SETTLE_MS);
      let good = r.settled && sameShape(r.stats.frameWidth, r.stats.frameHeight, 16, 10) && r.stats.frameHeight <= 1200;
      if (good && screen.width === 3440 && screen.height === 1440) good = r.stats.frameWidth === 1728 && r.stats.frameHeight === 1080;
      part('c', good ? 'PASS' : 'FAIL', "ask({shape:'match', viewWidth:1920, viewHeight:1200}) gives a 16:10 picture no taller than 1200", r.refused ? `the PC refused: ${r.refused}` : `the PC answered ${r.answer.sending.width}x${r.answer.sending.height} from the middle ${r.answer.sending.regionWidth}x${r.answer.sending.regionHeight}; the browser decoded ${r.stats ? `${r.stats.frameWidth}x${r.stats.frameHeight}` : 'nothing'}`, { answeredMs: r.answeredMs, settledMs: r.settledMs });
      if (!(await stillConnected('c'))) reconnects += 1;
    }

    // (d) The whole screen at its own size.
    {
      const r = await askAndWait(page, { shape: 'native', lines: 'native' }, SETTLE_MS);
      const wide = screen.width & ~1;
      const tall = screen.height & ~1;
      const seen = r.refused ? `the PC refused: ${r.refused}` : `the PC answered ${r.answer.sending.width}x${r.answer.sending.height}${r.answer.sending.scaled ? ' (made smaller)' : ' (as it is)'}; the browser decoded ${r.stats ? `${r.stats.frameWidth}x${r.stats.frameHeight}` : 'nothing'}`;
      const what = `ask({shape:'native', lines:'native'}) gives the whole ${wide}x${tall} screen`;
      if (r.answer && r.answer.cap) part('d', 'COULD NOT TELL', what, `${seen}. A real match is running on the PC (${r.answer.cap}), so it is capped and the full size cannot be asked for now.`);
      else part('d', r.settled && r.stats.frameWidth === wide && r.stats.frameHeight === tall ? 'PASS' : 'FAIL', what, seen, { answeredMs: r.answeredMs, settledMs: r.settledMs });
      if (!(await stillConnected('d'))) reconnects += 1;
    }

    // (h) The panel itself: the real keys, pressed as a person would press them.
    {
      const notes = [];
      let good = true;
      const check = (ok, note) => { notes.push(`${ok ? 'yes' : 'NO'}: ${note}`); if (!ok) good = false; };
      await page.click('#open-settings');
      check(await page.isVisible('#panel'), '[ SETTINGS ] opens the panel');
      check((await page.textContent('#really')).includes('REALLY SENDING'), 'the panel says what the PC is really sending');
      // After (d) the shape is NATIVE, so the SHAPE keys are showing. Press [ 16:9 ] and [ 1080 ].
      await page.click('#shapes button[data-shape="16:9"]');
      await settleOn(page, (seen) => seen.host.asked.shape === '16:9');
      await page.click('#lines button[data-lines="1080"]');
      const pressed = await settleOn(page, (seen) => seen.host.asked.lines === 1080);
      const wantWide = screen.width * 9 >= screen.height * 16 && screen.height >= 1080;
      check(pressed.settled && pressed.host.asked.shape === '16:9' && pressed.host.asked.lines === 1080 && (!wantWide || pressed.host.cap || (pressed.stats.frameWidth === 1920 && pressed.stats.frameHeight === 1080)), `pressing [ 16:9 ] and [ 1080 ] changed the picture (decoded ${pressed.stats ? `${pressed.stats.frameWidth}x${pressed.stats.frameHeight}` : 'nothing'})`);
      check((await page.getAttribute('#shapes button[data-shape="16:9"]', 'aria-pressed')) === 'true', 'the [ 16:9 ] key shows as pressed');

      // Drawing and upscaling, which never leave this device. FAST first (it is the default), then NORMAL.
      const drawnAs = () => page.evaluate(async () => { const s = await window.__debaserStats(); return { drawing: s.drawing, lowLatency: s.lowLatencyCanvas, note: s.drawingNote, drawn: s.framesDrawnFast, decoded: s.framesDecoded }; });
      const probeNow = () => page.evaluate(() => window.__debaserDrawing.probe());
      const size = { wide: pressed.stats.frameWidth, tall: pressed.stats.frameHeight };
      const fit = Math.min(VIEW.width / size.wide, VIEW.height / size.tall);
      const fitted = { wide: Math.round(size.wide * fit), tall: Math.round(size.tall * fit) };
      const about = (box) => (box ? `${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'nowhere');
      const boxIs = (box, want) => Boolean(box) && Math.abs(box.width - want.wide) <= 1 && Math.abs(box.height - want.tall) <= 1;
      result.drawing = {};

      const first = await drawnAs();
      result.lowLatencyCanvas = first.lowLatency;
      check(first.drawing === 'fast' && (await page.isVisible('#fast')) && (await page.getAttribute('#drawing button[data-drawing="fast"]', 'aria-pressed')) === 'true',
        `FAST is in use by default (drawing "${first.drawing}"${first.note ? `: ${first.note}` : ''}); the browser ${first.lowLatency ? 'gave' : 'did NOT give'} its canvas the skip-the-queue kind`);
      if (first.drawing === 'fast') {
        for (const mode of ['off', 'smooth', 'sharp', 'sharpened']) {
          await page.click(`#upscaling button[data-upscaling="${mode}"]`);
          await sleep(300);
          const a = await drawnAs();
          await sleep(1000);
          const b = await drawnAs();
          const probe = await probeNow();
          result.drawing[`fast ${mode}`] = probe;
          // OFF, SMOOTH and SHARP keep the frame at its own size on the canvas; SHARPENED makes the canvas the
          // size the picture is shown at. On the page the picture is its real size for OFF and fitted otherwise.
          const sized = probe.looked && probe.width === (mode === 'sharpened' ? fitted : size).wide && probe.height === (mode === 'sharpened' ? fitted : size).tall && boxIs(probe.box, mode === 'off' ? size : fitted);
          const drawn = b.drawn - a.drawn;
          const decoded = b.decoded - a.decoded;
          const everyFrame = decoded > 0 && drawn >= decoded - 3 && drawn <= decoded + 3;
          const right = probe.looked && probe.litShare > 0.02 && probe.meanDifference < (mode === 'sharpened' ? 16 : 6);
          const hard = (await page.evaluate(() => getComputedStyle(document.getElementById('fast')).imageRendering)) === 'pixelated';
          check(sized && everyFrame && right && hard === (mode === 'sharp'),
            `FAST, ${mode.toUpperCase()}: the canvas holds ${probe.width}x${probe.height}, the picture is ${about(probe.box)} on the page, ${drawn} frames were drawn while ${decoded} were decoded` +
            (probe.looked ? `, ${(probe.litShare * 100).toFixed(0)}% of the sampled points are lit, and it is on average ${probe.meanDifference.toFixed(2)} levels (of 255) from the plain frame (most ${probe.largestDifference.toFixed(0)})` : ', and NO frame could be looked at') +
            (mode === 'sharp' ? `; hard squares: ${hard}` : ''));
        }
      }

      await page.click('#drawing button[data-drawing="normal"]');
      await sleep(300);
      check((await drawnAs()).drawing === 'normal' && !(await page.isVisible('#fast')), '[ NORMAL ] hands the picture to the browser\'s own player (the FAST canvas is gone)');
      const boxNow = () => page.evaluate(() => window.__debaserDrawing.box());
      await page.click('#upscaling button[data-upscaling="off"]');
      await sleep(150);
      const off = await boxNow();
      check(boxIs(off, size), `NORMAL, OFF shows the picture at its real size (${size.wide}x${size.tall} drawn ${about(off)})`);
      await page.click('#upscaling button[data-upscaling="sharp"]');
      check((await page.evaluate(() => getComputedStyle(document.getElementById('screen')).imageRendering)) === 'pixelated', 'NORMAL, SHARP draws in hard squares (image-rendering: pixelated)');
      await page.click('#upscaling button[data-upscaling="smooth"]');
      await sleep(150);
      const smooth = await boxNow();
      check(boxIs(smooth, fitted) && (await page.evaluate(() => getComputedStyle(document.getElementById('screen')).imageRendering)) !== 'pixelated', `NORMAL, SMOOTH fits the window (${about(smooth)})`);
      await page.click('#upscaling button[data-upscaling="sharpened"]');
      await sleep(600);
      const probe = await probeNow();
      result.drawing['normal sharpened'] = probe;
      if (!probe.looked) {
        notes.push(`COULD NOT TELL: NORMAL, SHARPENED did not run in this headless browser (${probe.note || 'no reason given'}); it fell back to SMOOTH`);
        const shownAs = await page.evaluate(async () => (await window.__debaserStats()).upscaling);
        check(shownAs.shown === 'smooth' && Boolean(shownAs.note), 'and the panel says it fell back');
      } else {
        check(probe.width === fitted.wide && probe.framesDrawn > 2 && probe.litShare > 0.02 && probe.meanDifference < 16, `NORMAL, SHARPENED draws a ${probe.width}x${probe.height} canvas, ${probe.framesDrawn} frames so far, ${(probe.litShare * 100).toFixed(0)}% of the sampled points lit, and on average ${probe.meanDifference.toFixed(2)} levels (of 255) away from the plain picture (most ${probe.largestDifference.toFixed(0)})`);
      }
      await page.click('#upscaling button[data-upscaling="smooth"]');
      await page.click('#drawing button[data-drawing="fast"]');
      await sleep(300);
      check((await drawnAs()).drawing === 'fast', '[ FAST ] takes it back');

      await page.click('#numbers-key');
      check(!(await page.isVisible('#numbers')), '[ NUMBERS ] takes the corner readout away');
      await page.click('#numbers-key');
      check(await page.isVisible('#numbers'), 'and puts it back');
      check((await page.textContent('#readout')).includes('frames a second'), 'the READOUT shows the stream');

      await page.click('#fullscreen');
      await sleep(300);
      const full = await page.evaluate(() => Boolean(document.fullscreenElement));
      if (full) { notes.push('yes: [ FULLSCREEN ] took the page fullscreen'); await page.click('#fullscreen'); await sleep(200); } else notes.push('COULD NOT TELL: [ FULLSCREEN ] did nothing in this headless browser (a headless browser has no screen to fill)');

      const kept = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('debaser-engine-viewer')); } catch (error) { return null; } });
      check(Boolean(kept) && kept.match === false && kept.shape === '16:9' && kept.lines === 1080 && kept.drawing === 'fast' && kept.upscaling === 'smooth', `the choices are remembered on this device (${JSON.stringify(kept)})`);
      await page.keyboard.press('Escape');
      check(!(await page.isVisible('#panel')), 'Esc closes the panel');
      part('h', good ? 'PASS' : 'FAIL', 'the panel\'s own keys do what they say', notes.join('\n      '));
      if (!(await stillConnected('h'))) reconnects += 1;
    }

    // (g) The same connection carried every change.
    {
      const timed = parts.filter((p) => typeof p.settledMs === 'number');
      const times = timed.map((p) => `(${p.letter}) ${p.settledMs.toFixed(0)} ms`).join(', ');
      part('g', reconnects === 0 ? 'PASS' : 'FAIL', 'the stream survives every change without reconnecting', `one peer connection throughout, "connected" after every change (${changeTimes.map((c) => `${c.after}: ${c.connectionState}`).join(', ')}). From the ask to the first decoded frame at the new size: ${times || 'no change settled'}`);
    }

    // (i) A new visit sends what this device remembers.
    {
      await page.reload({ waitUntil: 'load', timeout: 8000 });
      const began = Date.now();
      let seen = null;
      while (Date.now() - began < SETTLE_MS + 4000) {
        seen = await waitForPicture(page, 500);
        if (seen.settled && seen.host.viewers >= 1 && seen.stats.connectionState === 'connected') break;
      }
      const good = Boolean(seen && seen.settled && seen.host.asked.shape === '16:9' && seen.host.asked.lines === 1080);
      part('i', good ? 'PASS' : 'FAIL', 'on a new visit the remembered settings are sent to the PC again', seen && seen.host ? `after a reload the PC was asked for ${seen.host.asked.shape} at ${seen.host.asked.lines} lines; the browser decoded ${seen.stats ? `${seen.stats.frameWidth}x${seen.stats.frameHeight}` : 'nothing'}` : 'the page did not come back');
    }
    // (k) Where FAST cannot run the page says so and draws NORMAL; and the address can ask for one way or the other.
    {
      const notes = [];
      let good = true;
      const check = (ok, note) => { notes.push(`${ok ? 'yes' : 'NO'}: ${note}`); if (!ok) good = false; };
      for (const [query, want, saying] of [['?fast=refused&hold=1', 'normal', 'FAST cannot run here'], ['?drawing=normal&hold=1', 'normal', 'address asks for NORMAL'], ['?drawing=fast&hold=1', 'fast', 'address asks for FAST']]) {
        const other = await openViewer(browser, port, query);
        const began = Date.now();
        let s = null;
        while (Date.now() - began < 8000) {
          s = await other.page.evaluate(() => window.__debaserStats());
          if (s.framesDecoded > 5) break;
          await sleep(100);
        }
        await other.page.click('#open-settings');
        const line = (await other.page.isVisible('#drawing-says')) ? await other.page.textContent('#drawing-says') : '';
        const canvasShown = await other.page.isVisible('#fast');
        check(s.framesDecoded > 5 && s.drawing === want && line.includes(saying) && canvasShown === (want === 'fast'),
          `opened with "${query}": ${s.framesDecoded} frames decoded, drawn ${s.drawing.toUpperCase()}, and the panel says "${line}"`);
        result.pageErrors = [...(result.pageErrors || []), ...other.errors];
        await other.context.close();
      }
      part('k', good ? 'PASS' : 'FAIL', 'where FAST cannot run the page says so and draws NORMAL; the address can ask for either', notes.join('\n      '));
    }
    result.requestsOutsideTheEngine = [...viewer.outside];
    result.pageErrors = [...(result.pageErrors || []), ...viewer.errors];
    await viewer.context.close();
    await engine.stop();
    engineOutput.push('--- first run ---', ...engine.lines());

    // ---- Second run: the engine told to behave as if a League match were running. ----
    engine = await startEngine(port, { DEBASER_PRETEND_MATCH: '1', DEBASER_PRETEND_MATCH_FILE: '' });
    viewer = await openViewer(browser, port);
    page = viewer.page;
    {
      const began = Date.now();
      let seen = null;
      while (Date.now() - began < SETTLE_MS + 4000) {
        seen = await waitForPicture(page, 500);
        if (seen.settled && seen.host.asked.shape === 'match') break;
      }
      const r = await askAndWait(page, { shape: 'native', lines: 'native', fps: 180, bitrateKbps: 40000 }, SETTLE_MS);
      await page.click('#open-settings');
      const says = (await page.isVisible('#cap')) ? await page.textContent('#cap') : '';
      const a = r.answer;
      // AUTO from a 144 Hz viewer is held to the cap as well.
      const auto = await askAndWait(page, { fps: 'auto', viewHz: 144 }, SETTLE_MS);
      const autoCapped = Boolean(auto.answer) && auto.answer.asked.fps === 'auto' && auto.answer.sending.fps === 60 && auto.answer.cap === 'LEAGUE MATCH';
      const good = autoCapped && Boolean(a) && a.cap === 'LEAGUE MATCH' && r.settled && r.stats.frameHeight <= 1080 && a.sending.height <= 1080 && a.sending.fps <= 60 && a.sending.bitrateKbps <= 12000 && a.asked.fps === 180 && says.includes('CAPPED BY THE PC: LEAGUE MATCH');
      part('f', good ? 'PASS' : 'FAIL', 'with a match running, native lines at 180 frames a second is answered with the cap', r.refused ? `the PC refused: ${r.refused}` : `asked for native lines, 180 frames a second, 40 Mbit/s; the PC answered cap "${a.cap}", sending ${a.sending.width}x${a.sending.height} at up to ${a.sending.fps} frames a second, ${a.sending.bitrateKbps} kbit/s; the browser decoded ${r.stats ? `${r.stats.frameWidth}x${r.stats.frameHeight}` : 'nothing'}; the panel says "${says.split('\n')[0]}"; AUTO from a pretended 144 Hz viewer is then sent at up to ${auto.answer ? auto.answer.sending.fps : '?'}`, { answeredMs: r.answeredMs, settledMs: r.settledMs });
    }
    result.pageErrors.push(...viewer.errors);
    await viewer.context.close();
    await engine.stop();
    engineOutput.push('--- second run (DEBASER_PRETEND_MATCH=1) ---', ...engine.lines());

    // ---- Third run: the pretend match starts and ends while the stream is running. ----
    // The engine pretends for as long as this file exists, so making and removing it is the match starting and ending.
    fs.rmSync(pretendFile, { force: true });
    engine = await startEngine(port, { DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: pretendFile });
    viewer = await openViewer(browser, port);
    page = viewer.page;
    {
      const what = 'a match starting mid-stream caps it, and what was asked for comes back when the match ends';
      await settleOn(page, (seen) => seen.host.asked.shape === 'match');
      const before = await askAndWait(page, { shape: '16:9', lines: 1440, fps: 60, bitrateKbps: 30000 }, SETTLE_MS);
      if (before.refused || !before.settled) {
        part('j', 'FAIL', what, before.refused ? `the PC refused the starting settings: ${before.refused}` : 'the starting settings never showed in the decoded frames');
      } else if (before.answer.cap) {
        part('j', 'COULD NOT TELL', what, `A real match is running on the PC (${before.answer.cap}), so the cap was on from the start.`);
      } else {
        const size = (seen) => `${seen.stats.frameWidth}x${seen.stats.frameHeight} at ${seen.host.sending.bitrateKbps} kbit/s`;
        const startedAt = Date.now();
        fs.writeFileSync(pretendFile, 'the settings check is pretending a match is running\n');
        const capped = await settleOn(page, (seen) => seen.host.cap === 'LEAGUE MATCH');
        const cappedMs = Date.now() - startedAt;
        const endedAt = Date.now();
        fs.rmSync(pretendFile, { force: true });
        const lifted = await settleOn(page, (seen) => !seen.host.cap);
        const liftedMs = Date.now() - endedAt;
        const s = await page.evaluate(() => window.__debaserStats());
        const good = capped.settled && capped.stats.frameHeight <= 1080 && capped.host.sending.bitrateKbps <= 12000 && capped.host.asked.lines === 1440 &&
          lifted.settled && lifted.stats.frameWidth === before.stats.frameWidth && lifted.stats.frameHeight === before.stats.frameHeight && lifted.host.sending.bitrateKbps === 30000 &&
          s.connectionState === 'connected' && s.connectionsMade === 1;
        part('j', good ? 'PASS' : 'FAIL', what,
          `before: ${before.stats.frameWidth}x${before.stats.frameHeight} at ${before.answer.sending.bitrateKbps} kbit/s; ` +
          `match "started": ${capped.settled ? `${size(capped)}, cap "${capped.host.cap}", seen by the page ${cappedMs} ms later` : 'the cap never showed'}; ` +
          `match "ended": ${lifted.settled ? `${size(lifted)}, seen ${liftedMs} ms later` : 'the settings never came back'}; connection ${s.connectionState}, ${s.connectionsMade} made ` +
          '(the engine looks for the game once a second and the page reads the PC\'s settings every 3 s, so a few seconds is expected)');
      }
    }
    result.pageErrors.push(...viewer.errors);
    await viewer.context.close();
    await engine.stop();
    engineOutput.push('--- third run (DEBASER_PRETEND_MATCH_FILE, made then removed) ---', ...engine.lines());
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    if (engine) { await engine.stop(); engineOutput.push('--- the run that broke ---', ...engine.lines()); }
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(pretendFile, { force: true });
  }

  const order = 'abcdefghijkl';
  parts.sort((x, y) => order.indexOf(x.letter) - order.indexOf(y.letter));
  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= 12;
  result.engineOutput = engineOutput.filter((line) => !/^\d+ s\s/.test(line));

  console.log();
  console.log('DEBASER ENGINE :: settings-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, pretending to be a ${VIEW.width}x${VIEW.height} screen, on this PC (127.0.0.1)`);
  if (result.screen) console.log(`  the PC's screen: ${result.screen.width}x${result.screen.height} at ${result.screen.hz} Hz${result.realMatchRunning ? '; A REAL MATCH IS RUNNING, so the first run was capped too' : ''}`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
    if (typeof p.settledMs === 'number') console.log(`      the PC answered after ${p.answeredMs.toFixed(0)} ms; the first frame at the new size was decoded ${p.settledMs.toFixed(0)} ms after the ask`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  const changes = result.engineOutput.filter((line) => line.startsWith('now sending') || line.startsWith('could NOT'));
  if (changes.length) console.log(`  the engine's own account of each change:\n${changes.map((line) => `      ${line}`).join('\n')}`);
  if (result.requestsOutsideTheEngine) console.log(`  the page asked nothing of any other server: ${result.requestsOutsideTheEngine.length === 0 ? 'true' : `FALSE (${result.requestsOutsideTheEngine.join(', ')})`}`);
  if (result.pageErrors && result.pageErrors.length) console.log(`  page errors: ${result.pageErrors.join(' | ')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `settings-check-${stamp(new Date())}.json`);
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
