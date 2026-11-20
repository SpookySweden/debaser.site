#!/usr/bin/env node
/**
 * The proof that `debaser-engine serve` reaches a browser (SPEC-screens.md).
 *
 * It starts the engine for 15 seconds, opens the viewer page in a HEADLESS Chrome (or Edge) on this same PC,
 * waits until the browser has really decoded 120 frames, and prints what the browser's own receiver measured.
 * No window opens and nothing is clicked or typed.
 *
 *     node bench/webrtc-check.cjs            (from the engine folder, after `cargo build --release`)
 *     node bench/webrtc-check.cjs --port 8479 --bitrate 20000 --fps 60 --frames 120
 *
 * Exit 0: the frames arrived and were decoded. Exit 1: they did not, with the reason.
 *
 * What it cannot say: how long a frame takes from the PC's screen to the viewer's screen. That needs the rig
 * (BENCH.md). These are the browser's own counts of what it received and how long each frame spent inside it.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
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

/** How long the engine runs, and how long the browser is given to decode the frames. */
const ENGINE_SECONDS = 15;
const DECODE_PATIENCE_MS = 12000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function stamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

const ms = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)} ms` : 'not reported');

/** The same per-frame averages the page reports, but over the stretch between two readings. */
function between(a, b) {
  const per = (total, count) => {
    const frames = b[count] - a[count];
    return typeof a[total] === 'number' && typeof b[total] === 'number' && frames > 0 ? ((b[total] - a[total]) / frames) * 1000 : null;
  };
  const seconds = (b.readAt - a.readAt) / 1000;
  return {
    seconds,
    framesDecoded: b.framesDecoded - a.framesDecoded,
    framesPerSecond: seconds > 0 ? (b.framesDecoded - a.framesDecoded) / seconds : null,
    kbitPerSecond: seconds > 0 ? ((b.bytesReceived - a.bytesReceived) * 8) / 1000 / seconds : null,
    jitterBufferDelayMsPerFrame: per('jitterBufferDelay', 'jitterBufferEmittedCount'),
    processingDelayMsPerFrame: per('totalProcessingDelay', 'framesDecoded'),
    decodeMsPerFrame: per('totalDecodeTime', 'framesDecoded'),
    framesDropped: b.framesDropped - a.framesDropped,
    packetsLost: b.packetsLost - a.packetsLost,
    nackCount: b.nackCount - a.nackCount,
    pliCount: b.pliCount - a.pliCount,
  };
}

async function main() {
  const port = option('--port', '8478');
  const target = Number(option('--frames', '120'));
  const result = { kind: 'webrtc-check', when: new Date().toISOString(), pass: false, framesTarget: target };
  const say = (text = '') => console.log(text);

  if (!fs.existsSync(ENGINE)) {
    say(`FAIL. The engine is not built: ${ENGINE} is missing. Run "cargo build --release" in the engine folder first.`);
    return 1;
  }
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    say(`FAIL. No Chrome or Edge found. Looked in:\n  ${BROWSER_CANDIDATES.join('\n  ')}`);
    return 1;
  }

  // 1. The engine. `--tweaks 12` leaves its graphics-priority switch off, so a game running on this PC is not
  // pushed aside by a test.
  const engineArgs = ['serve', '--seconds', String(ENGINE_SECONDS), '--tweaks', option('--tweaks', '12'), '--port', port, '--bitrate', option('--bitrate', '20000'), '--fps', option('--fps', '60')];
  result.engineCommand = `debaser-engine ${engineArgs.join(' ')}`;
  const engine = spawn(ENGINE, engineArgs, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Whatever goes wrong in this script, the engine it started does not outlive it.
  process.on('exit', () => { if (engine.exitCode === null) engine.kill(); });
  let engineText = '';
  let engineExit = null;
  engine.stdout.on('data', (chunk) => { engineText += chunk; });
  engine.stderr.on('data', (chunk) => { engineText += chunk; });
  const engineGone = new Promise((resolve) => engine.on('exit', (code) => { engineExit = code; resolve(code); }));
  const engineLines = () => engineText.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);

  let browser = null;
  const finish = async (code) => {
    if (browser) await browser.close().catch(() => {});
    if (engineExit === null) {
      // Only ever the engine this script started itself.
      engine.kill();
      await Promise.race([engineGone, sleep(2000)]);
    }
    result.engineOutput = engineLines();
    fs.mkdirSync(RESULTS, { recursive: true });
    const file = path.join(RESULTS, `webrtc-check-${stamp(new Date())}.json`);
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    say(`  saved ${path.relative(ENGINE_DIR, file)}`);
    return code;
  };
  const fail = async (why) => {
    result.failure = why;
    say();
    say('DEBASER ENGINE :: webrtc-check');
    say(`  FAIL. ${why}`);
    const tail = engineLines().slice(-12);
    if (tail.length) say(`  the engine said:\n${tail.map((line) => `    ${line.trim()}`).join('\n')}`);
    return finish(1);
  };

  const engineStarted = Date.now();
  while (!engineText.includes('waiting for a viewer')) {
    if (engineExit !== null) return fail(`The engine stopped before it was ready (exit code ${engineExit}).`);
    if (Date.now() - engineStarted > 8000) return fail('The engine did not say it was ready within 8 seconds.');
    await sleep(50);
  }

  // 2. The browser: no window, and allowed to start the (muted) video by itself.
  // The "fake device" switch swaps the camera and microphone for Chrome's built-in test signal, for step 3b
  // below. No real device is opened.
  const browserArgs = ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream'];
  if (process.argv.includes('--gpu')) browserArgs.push('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist');
  browser = await chromium.launch({ executablePath: browserPath, headless: true, args: browserArgs });
  result.browser = { path: browserPath, version: browser.version(), headless: true };
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  // The page must ask nothing of anyone but the engine: every address it requests is noted.
  const asked = new Set();
  page.on('request', (request) => asked.add(new URL(request.url()).origin));

  const url = `http://127.0.0.1:${port}/`;
  const opened = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 8000 });
  } catch (error) {
    return fail(`The viewer page did not open at ${url}: ${error.message}`);
  }
  const read = async () => {
    const stats = await page.evaluate(() => window.__debaserStats());
    stats.readAt = Date.now();
    return stats;
  };

  // 3. Wait for the frames to be decoded, not merely received.
  let stats = await read();
  let firstFrameMs = null;
  while (stats.framesDecoded < target) {
    if (Date.now() - opened > DECODE_PATIENCE_MS) {
      result.lastStats = stats;
      result.pageErrors = pageErrors;
      return fail(
        `Only ${stats.framesDecoded} of ${target} frames were decoded within ${DECODE_PATIENCE_MS / 1000} seconds ` +
          `(connection: ${stats.connectionState}; frames received ${stats.framesReceived}; packets received ${stats.packetsReceived}; ` +
          `codec ${stats.mimeType || 'none'}; decoder ${stats.decoderImplementation || 'none'}` +
          `${stats.problem ? `; the page says: ${stats.problem}` : ''}${pageErrors.length ? `; page errors: ${pageErrors.join(' | ')}` : ''}).`,
      );
    }
    await sleep(100);
    stats = await read();
    if (firstFrameMs === null && stats.framesDecoded > 0) firstFrameMs = stats.readAt - opened;
  }
  const atTarget = stats;
  const targetMs = atTarget.readAt - opened;

  // 3b. Chrome only tells a page which decoder it is using (and whether that is the graphics card) while the
  // page is recording something. So the check, not the viewer page, opens the FAKE microphone and leaves it idle.
  // Only now, once the video is flowing: a page that is allowed to record makes Chrome connect from each network
  // card's own address instead of "any", and from those it cannot reach an engine that listens on 127.0.0.1 only
  // (seen 2026-11-20: with the permission given from the start, the connection never formed).
  await page.context().grantPermissions(['microphone'], { origin: `http://127.0.0.1:${port}` });
  result.fakeMicrophoneForDecoderName = await page.evaluate(async () => {
    try {
      window.__checkMicrophone = await navigator.mediaDevices.getUserMedia({ audio: true });
      return 'yes';
    } catch (error) {
      return String(error);
    }
  });

  // 4. Keep watching while the engine runs, for numbers taken after the start-up is over.
  const playing = await page.evaluate(() => {
    const video = document.getElementById('screen');
    return { paused: video.paused, readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, time: video.currentTime };
  });
  const leftMs = ENGINE_SECONDS * 1000 - (Date.now() - engineStarted) - 1500;
  if (leftMs > 0) await sleep(Math.min(leftMs, 8000));
  const atEnd = engineExit === null ? await read() : atTarget;
  const steady = atEnd !== atTarget ? between(atTarget, atEnd) : null;
  await browser.close().catch(() => {});
  browser = null;

  // 5. The engine ends by itself and prints its own side.
  await Promise.race([engineGone, sleep(6000)]);
  let engineSide = null;
  const jsonLine = engineLines().find((line) => line.trim().startsWith('json: '));
  if (jsonLine) {
    try { engineSide = JSON.parse(jsonLine.trim().slice('json: '.length)); } catch (error) { /* reported below as missing */ }
  }

  const outside = [...asked].filter((origin) => origin !== `http://127.0.0.1:${port}`);
  Object.assign(result, { pass: true, url, msToFirstFrame: firstFrameMs, msToTargetFrames: targetMs, video: playing, atTarget, atEnd, steady, engine: engineSide, requestsOutsideTheEngine: outside, pageErrors });

  const hardware = atEnd.powerEfficientDecoder === true ? 'hardware' : atEnd.powerEfficientDecoder === false ? 'software' : 'hardware or software not reported';
  say();
  say('DEBASER ENGINE :: webrtc-check');
  say(`  PASS. ${atTarget.framesDecoded} frames decoded ${(targetMs / 1000).toFixed(1)} s after the page opened.`);
  const step = (value) => (typeof value === 'number' ? `${value.toFixed(0)} ms` : 'not seen');
  const steps = atEnd.stepsMs || {};
  say(`  connecting, since the page began loading: offer sent ${step(steps.offerSent)}, answer back ${step(steps.answerBack)}, connected ${step(steps.connected)}, first frame on the page ${step(steps.firstFrameShown)}`);
  say(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, on this PC (127.0.0.1)`);
  say(`  picture ${atEnd.frameWidth}x${atEnd.frameHeight}, ${atEnd.mimeType}; decoder: ${atEnd.decoderImplementation} (${hardware})`);
  say(`  the <video> element: ${playing.paused ? 'PAUSED' : 'playing'}, ${playing.width}x${playing.height}`);
  say(`  whole run, ${atEnd.framesDecoded} frames decoded:`);
  say(`    waiting in the browser's buffer    ${ms(atEnd.jitterBufferDelayMsPerFrame)} a frame`);
  say(`    decoding                           ${ms(atEnd.decodeMsPerFrame)} a frame`);
  say(`    arrival to decoded (both + assembly) ${ms(atEnd.processingDelayMsPerFrame)} a frame`);
  say(`    frames dropped ${atEnd.framesDropped}, packets lost ${atEnd.packetsLost}, resends asked for ${atEnd.nackCount}, full pictures asked for ${atEnd.pliCount} (PLI) + ${atEnd.firCount} (FIR), full pictures decoded ${atEnd.keyFramesDecoded}, freezes ${atEnd.freezeCount}`);
  if (steady) {
    say(`  after start-up (${steady.seconds.toFixed(1)} s, ${steady.framesDecoded} frames, ${steady.framesPerSecond.toFixed(1)} frames/s, ${steady.kbitPerSecond.toFixed(0)} kbit/s received):`);
    say(`    waiting in the browser's buffer    ${ms(steady.jitterBufferDelayMsPerFrame)} a frame`);
    say(`    decoding                           ${ms(steady.decodeMsPerFrame)} a frame`);
    say(`    arrival to decoded (both + assembly) ${ms(steady.processingDelayMsPerFrame)} a frame`);
    say(`    frames dropped ${steady.framesDropped}, packets lost ${steady.packetsLost}, resends asked for ${steady.nackCount}, full pictures asked for ${steady.pliCount}`);
  }
  if (engineSide) {
    const part = (s) => (s ? `middle ${s.p50Ms.toFixed(2)} ms, worst 5% ${s.p95Ms.toFixed(2)} ms` : 'no frames');
    say(`  the engine's side (${engineSide.framesSent} frames sent, ${engineSide.freshFrames} from real changes on screen, ${engineSide.sentKbps} kbit/s):`);
    say(`    Windows showed it -> encoded       ${part(engineSide.presentToEncoded)}`);
    say(`    encoded -> handed to the network   ${part(engineSide.encodedToNetwork)}`);
  } else {
    say('  the engine printed no summary (it was still running, or stopped early)');
  }
  say(`  the page asked nothing of any other server: ${outside.length === 0 ? 'true' : `FALSE (${outside.join(', ')})`}`);
  if (pageErrors.length) say(`  page errors: ${pageErrors.join(' | ')}`);
  return finish(0);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FAIL. ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  },
);
