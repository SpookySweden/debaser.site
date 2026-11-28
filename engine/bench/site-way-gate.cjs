#!/usr/bin/env node
/**
 * THE GATE for REMOTE's way THROUGH THE SITE (SPEC-screens.md, "Away from home with no setup"): how late does a frame
 * arrive when it goes browser <- Cloudflare <- the tunnel <- the site's own program <- a gateway on SERVER, and does
 * that path hold frames back and hand them over in lumps, or stall? Measured BEFORE the real thing is written.
 *
 * It starts scripts/host/screens-site-gateway.cjs in its gate mode (made-up frames: random bytes, 60 a second,
 * 3.5 Mbit/s, each stamped with the moment it left), watches the stream down one or more paths at the same time, and
 * stops the gateway again. Everything runs on SERVER, so the gateway's clock and the watcher's clock are the same
 * machine's; the round trip is measured on the gateway's clock alone as a check on that.
 *
 *     node engine/bench/site-way-gate.cjs --via gateway=ws://127.0.0.1:8481 --via site=ws://127.0.0.1:3000 \
 *          --via tunnel=wss://debaser.site --browser tunnel --seconds 600 --during "npm run build" --at 240
 *
 *   --via name=address   a path to watch (several allowed). "gateway" straight to the gateway (what the made-up stream
 *                        and this script cost by themselves), "site" through the site's program only, "tunnel" through
 *                        Cloudflare and the tunnel as a viewer's browser would come.
 *   --browser name       watch that path from a hidden Chrome (or Edge) on a page of the site, as a real viewer would;
 *                        the others are watched by this script itself.
 *   --seconds n          how long (default 60)
 *   --during "command"   something heavy to run on this machine part-way through, --at n seconds in (default: a third)
 *   --start-site port    first start `next start` on that port from this folder (the local proof that the site's
 *                        program passes a websocket along), and stop it at the end
 *   --port n             the gateway's port (default 8481, the one next.config.ts sends the socket to)
 *
 * Before the stream it checks the door: a stranger with the wrong words, and one with no words, must get a closed
 * line and not one frame. The run fails if either gets anything.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GATEWAY = path.join(ROOT, 'scripts', 'host', 'screens-site-gateway.cjs');
const SOCKET_PATH = '/api/screens/site-socket';
const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => performance.timeOrigin + performance.now();
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
function options(name) {
  const found = [];
  process.argv.forEach((word, at) => {
    if (word === name && process.argv[at + 1]) found.push(process.argv[at + 1]);
  });
  return found;
}

/**
 * The watcher. It runs as it stands in this script (Node has a WebSocket of its own) and, as text, inside the hidden
 * browser, so both watch the same way: say the words, note when each frame arrives, and five times a second tell the
 * gateway the newest frame it has (when that frame left, when it arrived, when this word leaves).
 */
function watch(address, words, name) {
  const now = () => performance.timeOrigin + performance.now();
  const state = { opened: null, closed: null, hello: null, number: [], left: [], arrived: [], size: [], kind: [], stop: null };
  const socket = new WebSocket(address);
  socket.binaryType = 'arraybuffer';
  let newest = null;
  let timer = null;
  socket.onopen = () => {
    state.opened = now();
    if (words !== null) socket.send(JSON.stringify({ pass: words, name }));
    timer = setInterval(() => {
      if (newest && socket.readyState === 1) socket.send(JSON.stringify({ got: newest.number, sent: newest.left, at: newest.arrived, now: now() }));
    }, 200);
  };
  socket.onmessage = (event) => {
    const arrived = now();
    if (typeof event.data === 'string') {
      state.hello = event.data;
      return;
    }
    const view = new DataView(event.data);
    const number = view.getUint32(1);
    const left = view.getFloat64(5);
    state.number.push(number);
    state.left.push(left);
    state.arrived.push(arrived);
    state.size.push(event.data.byteLength);
    state.kind.push(view.getUint8(0));
    newest = { number, left, arrived };
  };
  socket.onclose = (event) => {
    state.closed = { at: now(), code: event.code };
    if (timer) clearInterval(timer);
  };
  socket.onerror = () => {};
  state.stop = () => {
    try {
      socket.close(1000);
    } catch {
      /* already closed */
    }
  };
  return state;
}

/* --- the numbers -------------------------------------------------------------------------------------------------- */

function spread(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  const one = (n) => Math.round(n * 10) / 10;
  return { least: one(sorted[0]), middle: one(at(0.5)), p95: one(at(0.95)), p99: one(at(0.99)), worst: one(sorted[sorted.length - 1]) };
}

/** Everything said about one stretch of frames (the whole run, or one 30-second piece of it). */
function reading(frames) {
  const lateness = frames.map((f) => f.arrived - f.left);
  const gaps = [];
  let lumps = 0;
  let missing = 0;
  let bytes = 0;
  for (let i = 0; i < frames.length; i += 1) {
    bytes += frames[i].size;
    if (i === 0) continue;
    const gap = frames[i].arrived - frames[i - 1].arrived;
    gaps.push(gap);
    // A lump: two frames that left the gateway well apart and arrived together, so something on the way held one back.
    if (gap < 1 && frames[i].left - frames[i - 1].left > 8) lumps += 1;
    missing += Math.max(0, frames[i].number - frames[i - 1].number - 1);
  }
  const seconds = frames.length > 1 ? (frames[frames.length - 1].arrived - frames[0].arrived) / 1000 : 0;
  const over = (ms) => gaps.filter((gap) => gap > ms).length;
  return {
    frames: frames.length,
    missing,
    framesASecond: seconds > 0 ? Math.round((frames.length / seconds) * 10) / 10 : 0,
    megabitsASecond: seconds > 0 ? Math.round(((bytes * 8) / seconds / 1e6) * 100) / 100 : 0,
    lateMs: spread(lateness),
    gapMs: spread(gaps),
    gapsOver: { ms50: over(50), ms100: over(100), ms250: over(250), ms1000: over(1000) },
    lumps,
  };
}

function framesOf(state) {
  return state.number.map((number, i) => ({ number, left: state.left[i], arrived: state.arrived[i], size: state.size[i], kind: state.kind[i] }));
}

function say(name, how, whole, pieces, gateway, busy) {
  const l = whole.lateMs;
  const g = whole.gapMs;
  console.log(`\n${name} (${how}): ${whole.frames} frames, ${whole.framesASecond} a second, ${whole.megabitsASecond} Mbit/s; ${whole.missing} never arrived`);
  if (!l || !g) return;
  console.log(`  late by, ms     least ${l.least}   middle ${l.middle}   95% ${l.p95}   99% ${l.p99}   worst ${l.worst}`);
  console.log(`  between frames  middle ${g.middle} ms   99% ${g.p99}   worst ${g.worst}; longer than 50 ms: ${whole.gapsOver.ms50}, 100 ms: ${whole.gapsOver.ms100}, 250 ms: ${whole.gapsOver.ms250}, 1 s: ${whole.gapsOver.ms1000}`);
  console.log(`  lumps           ${whole.lumps} frames (${((whole.lumps / whole.frames) * 100).toFixed(2)}%) arrived together with the one before though they left apart`);
  if (gateway) {
    const r = spread(gateway.roundTripsMs);
    const b = spread(gateway.behindFrames);
    console.log(`  the gateway     sent ${gateway.framesSent}, skipped ${gateway.framesSkipped} (line backed up), most waiting to leave ${gateway.mostWaitingBytes} bytes, came through Cloudflare: ${gateway.cameThroughCloudflare ? 'yes' : 'no'}`);
    if (r) console.log(`  there and back  middle ${r.middle} ms   95% ${r.p95}   99% ${r.p99}   worst ${r.worst} (gateway's clock only)${b ? `; viewer behind by, frames: middle ${b.middle}, worst ${b.worst}` : ''}`);
  }
  console.log('  by 30 seconds   (from s: middle / 99% / worst late, ms; gaps over 100 ms; lumps)');
  for (const piece of pieces) {
    if (!piece.reading.lateMs) continue;
    const mark = busy && piece.from < busy.to && piece.from + 30 > busy.from ? ' *' : '';
    console.log(`    ${String(piece.from).padStart(4)}: ${piece.reading.lateMs.middle} / ${piece.reading.lateMs.p99} / ${piece.reading.lateMs.worst}; ${piece.reading.gapsOver.ms100}; ${piece.reading.lumps}${mark}`);
  }
}

/* --- the run ------------------------------------------------------------------------------------------------------ */

async function answers(address) {
  try {
    const response = await fetch(address, { signal: AbortSignal.timeout(2000) });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return 0;
  }
}

/** A stranger at the door: must be closed without a frame. `words` null says nothing at all. */
async function strangerGetsNothing(address, words, waitMs) {
  const state = watch(address, words, 'stranger');
  const until = Date.now() + waitMs;
  while (!state.closed && Date.now() < until) await sleep(50);
  const closed = Boolean(state.closed);
  state.stop();
  return { closed, frames: state.number.length, hello: state.hello };
}

async function main() {
  const seconds = Number(option('--seconds', '60'));
  const port = Number(option('--port', '8481'));
  const browserFor = option('--browser', null);
  const during = option('--during', null);
  const duringAt = Number(option('--at', String(Math.round(seconds / 3))));
  const startSite = option('--start-site', null);
  const vias = options('--via').map((word) => {
    const cut = word.indexOf('=');
    return { name: word.slice(0, cut), address: word.slice(cut + 1).replace(/\/$/, '') };
  });
  if (vias.length === 0) vias.push({ name: 'gateway', address: `ws://127.0.0.1:${port}` });
  if (vias.some((via) => !via.name || !/^wss?:\/\//.test(via.address))) throw new Error('--via wants name=ws://... or name=wss://...');
  if (browserFor && !vias.some((via) => via.name === browserFor)) throw new Error(`--browser ${browserFor} is not one of the --via names`);

  const words = crypto.randomBytes(24).toString('base64url');
  const children = [];
  let browser = null;
  let failed = false;
  const result = { at: new Date().toISOString(), seconds, vias: {}, door: null, busy: null };

  try {
    if ((await answers(`http://127.0.0.1:${port}/health`)) !== 0) throw new Error(`something already answers on 127.0.0.1:${port}; not starting a second gateway`);
    const gateway = spawn(process.execPath, [GATEWAY, '--gate'], { env: { ...process.env, SITE_WAY_GATE_PASS: words, DEBASER_SITE_WAY_PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
    children.push(gateway);
    for (let i = 0; i < 40 && (await answers(`http://127.0.0.1:${port}/health`)) !== 200; i += 1) await sleep(250);
    if ((await answers(`http://127.0.0.1:${port}/health`)) !== 200) throw new Error('the gateway did not come up');

    if (startSite) {
      console.log(`starting this folder's built site on 127.0.0.1:${startSite} ...`);
      const site = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(startSite), '-H', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
      children.push(site);
      for (let i = 0; i < 60 && (await answers(`http://127.0.0.1:${startSite}/api/version`)) === 0; i += 1) await sleep(1000);
      if ((await answers(`http://127.0.0.1:${startSite}/api/version`)) === 0) throw new Error('the site did not come up (was it built?)');
    }

    // The door, on the gateway itself and down every path: a stranger gets a closed line and no frame.
    const door = [];
    for (const via of vias) {
      const [wrong, silent] = await Promise.all([
        strangerGetsNothing(via.address + SOCKET_PATH, crypto.randomBytes(24).toString('base64url'), 6000),
        strangerGetsNothing(via.address + SOCKET_PATH, null, 6000),
      ]);
      const good = wrong.closed && wrong.frames === 0 && wrong.hello === null && silent.closed && silent.frames === 0 && silent.hello === null;
      door.push({ via: via.name, wrongWords: wrong, noWords: silent, good });
      console.log(`${good ? 'PASS' : 'FAIL'}: the door, by way of ${via.name}: wrong words -> ${wrong.closed ? 'closed' : 'LEFT OPEN'}, ${wrong.frames} frames; no words -> ${silent.closed ? 'closed' : 'LEFT OPEN'}, ${silent.frames} frames`);
      if (!good) failed = true;
    }
    result.door = door;
    if (failed) throw new Error('the door let a stranger in; nothing was measured');
    await sleep(300);

    // The watchers, all at once, so a stall can be told apart: in every path = this machine; in one = that path.
    const local = new Map();
    let page = null;
    for (const via of vias) {
      if (via.name === browserFor) {
        const { chromium } = require('playwright-core');
        const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
        if (!browserPath) throw new Error('No Chrome or Edge found.');
        browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
        page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        // A plain text page of the site: the socket then comes from the site's own address, as the room's will.
        const home = via.address.replace(/^ws/, 'http');
        await page.goto(`${home}/robots.txt`, { waitUntil: 'load', timeout: 30000 });
        await page.evaluate(`window.__gate = (${watch.toString()})(${JSON.stringify(via.address + SOCKET_PATH)}, ${JSON.stringify(words)}, ${JSON.stringify(via.name)}); true`);
      } else {
        local.set(via.name, watch(via.address + SOCKET_PATH, words, via.name));
      }
    }

    const began = clock();
    console.log(`watching for ${seconds} s by way of: ${vias.map((via) => via.name + (via.name === browserFor ? ' (hidden browser)' : '')).join(', ')}`);
    let heavy = null;
    if (during) {
      await sleep(duringAt * 1000);
      const from = Math.round((clock() - began) / 1000);
      console.log(`  ${from} s in: starting "${during}"`);
      result.busy = { command: during, from, to: null, exit: null };
      heavy = new Promise((resolve) => {
        const child = spawn(during, { cwd: ROOT, shell: true, stdio: 'ignore' });
        child.on('exit', (code) => {
          result.busy.to = Math.round((clock() - began) / 1000);
          result.busy.exit = code;
          console.log(`  ${result.busy.to} s in: "${during}" ended (exit ${code})`);
          resolve();
        });
        child.on('error', () => resolve());
      });
    }
    const left = seconds * 1000 - (clock() - began);
    if (left > 0) await sleep(left);
    if (heavy && result.busy.to === null) {
      console.log('  the heavy command is still running: watching on until it ends');
      await heavy;
      await sleep(5000);
    }

    // Collect.
    const states = new Map(local);
    if (page) {
      const got = await page.evaluate(() => {
        const s = window.__gate;
        s.stop();
        return { opened: s.opened, closed: s.closed, hello: s.hello, number: s.number, left: s.left, arrived: s.arrived, size: s.size, kind: s.kind };
      });
      states.set(browserFor, got);
    }
    const stillOpen = new Map();
    for (const [name, state] of states) {
      stillOpen.set(name, state.closed === null);
      if (state.stop) state.stop();
    }
    await sleep(600);
    const report = await (await fetch(`http://127.0.0.1:${port}/gate`)).json();
    const finished = [...report.finished, ...report.now];

    for (const via of vias) {
      const state = states.get(via.name);
      const frames = framesOf(state);
      const whole = reading(frames);
      const pieces = [];
      for (let from = 0; frames.length > 0 && from * 1000 < frames[frames.length - 1].left - began + 1; from += 30) {
        const inPiece = frames.filter((f) => f.left - began >= from * 1000 && f.left - began < (from + 30) * 1000);
        if (inPiece.length > 0) pieces.push({ from, reading: reading(inPiece) });
      }
      const gateway = finished.find((viewer) => viewer.name === via.name) ?? null;
      const stayed = stillOpen.get(via.name);
      result.vias[via.name] = {
        address: via.address,
        watchedBy: via.name === browserFor ? 'hidden browser' : 'this script',
        openedAfterMs: state.opened ? Math.round(state.opened - began) : null,
        stayedOpen: stayed,
        closed: stayed ? null : state.closed,
        whole,
        pieces,
        gateway: gateway ? { ...gateway, roundTripsMs: spread(gateway.roundTripsMs), behindFrames: spread(gateway.behindFrames) } : null,
      };
      say(via.name, via.name === browserFor ? 'hidden browser' : 'this script', whole, pieces, gateway, result.busy);
      if (!stayed) {
        console.log(`  THE LINE DID NOT LAST: closed ${state.closed ? `with code ${state.closed.code}, ${Math.round((state.closed.at - began) / 1000)} s in` : 'before it opened'}`);
        failed = true;
      }
      if (whole.frames === 0) failed = true;
    }
    if (result.busy) console.log(`\n* = while "${result.busy.command}" ran (${result.busy.from} s to ${result.busy.to} s)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const child of children) child.kill();
  }

  const stamp = result.at.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const out = option('--out', path.join(__dirname, 'results', `site-way-gate-${stamp}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`\nwritten: ${path.relative(ROOT, out)}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.log(`THE GATE DID NOT RUN: ${error.message}`);
  process.exitCode = 1;
});
