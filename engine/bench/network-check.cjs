#!/usr/bin/env node
/**
 * What a frame spends inside the viewer's browser when it comes over the home network (SPEC-screens.md).
 *
 * Unlike webrtc-check.cjs it starts no engine: it watches one that is already running, on this machine or another,
 * from a HEADLESS Chrome (or Edge) on this machine, for a short while, and prints the browser's own counts in
 * two-second stretches, so a hiccup at the start does not colour the rest (the viewer's readout used to average
 * since the start). Nothing is clicked or typed; "hold=1" keeps the engine's settings as they are.
 *
 *     node engine/bench/network-check.cjs --url http://127.0.0.1:8478            (this machine's engine)
 *     node engine/bench/network-check.cjs --url http://192.168.0.30:8478 --token-from G:\DEBASER-HOST\site.env
 *     --seconds 20   how long it watches after the first frame
 *
 * --token-from reads SCREENS_ENGINE_TOKEN from that file; the token is never printed.
 *
 * Per frame, in the browser:
 *   assembly   first packet of a frame to its last (the network spreading the frame out)
 *   wait       the readout's "wait in buffer" (jitterBufferDelay): frame in the browser's queue
 *   target     what the browser aimed for (jitterBufferTargetDelay); 0 means "show at once" is honoured
 *   gap spread how unevenly frames arrive (the spread of the time between frames)
 */
'use strict';

const fs = require('node:fs');
const { chromium } = require('playwright-core');

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function tokenFrom(file) {
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find((l) => /^\s*SCREENS_ENGINE_TOKEN\s*=/.test(l));
  if (!line) throw new Error(`No SCREENS_ENGINE_TOKEN in ${file}`);
  return line.replace(/^\s*SCREENS_ENGINE_TOKEN\s*=\s*/, '').trim().replace(/^["']|["']$/g, '');
}

const FIELDS = [
  'framesDecoded', 'framesReceived', 'framesDropped', 'packetsLost', 'packetsReceived', 'nackCount', 'pliCount', 'bytesReceived',
  'jitterBufferDelay', 'jitterBufferTargetDelay', 'jitterBufferMinimumDelay', 'jitterBufferEmittedCount',
  'totalAssemblyTime', 'framesAssembledFromMultiplePackets', 'totalDecodeTime', 'totalProcessingDelay',
  'totalInterFrameDelay', 'totalSquaredInterFrameDelay', 'freezeCount', 'totalFreezesDuration', 'jitter',
];

async function main() {
  const base = option('--url', 'http://127.0.0.1:8478').replace(/\/$/, '');
  const seconds = Number(option('--seconds', '20'));
  const tokenFile = option('--token-from', null);
  const token = tokenFile ? tokenFrom(tokenFile) : null;
  const browserPath = BROWSER_CANDIDATES.find((c) => fs.existsSync(c));
  if (!browserPath) throw new Error('No Chrome or Edge found.');

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // Keep every connection the page makes, so its stats can be read whatever the page calls it.
    await page.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      window.__pcs = [];
      window.RTCPeerConnection = function (...args) {
        const pc = new Original(...args);
        window.__pcs.push(pc);
        return pc;
      };
      window.RTCPeerConnection.prototype = Original.prototype;
      Object.setPrototypeOf(window.RTCPeerConnection, Original);
    });
    const query = token ? `?hold=1&token=${encodeURIComponent(token)}` : '?hold=1';
    await page.goto(`${base}/${query}`, { waitUntil: 'load', timeout: 10000 });

    const read = () =>
      page.evaluate((fields) => {
        const pc = window.__pcs[window.__pcs.length - 1];
        if (!pc) return null;
        return pc.getStats().then((report) => {
          let video = null;
          let rtt = null;
          let pair = null;
          report.forEach((e) => {
            if (e.type === 'inbound-rtp' && e.kind === 'video') video = e;
            if (e.type === 'transport' && e.selectedCandidatePairId) pair = report.get(e.selectedCandidatePairId);
          });
          if (pair && typeof pair.currentRoundTripTime === 'number') rtt = pair.currentRoundTripTime;
          if (!video) return { at: performance.now(), framesDecoded: 0 };
          const out = { at: performance.now(), rtt, decoder: video.decoderImplementation, width: video.frameWidth, height: video.frameHeight };
          for (const f of fields) out[f] = typeof video[f] === 'number' ? video[f] : null;
          return out;
        });
      }, FIELDS);

    const began = Date.now();
    let first = await read();
    // The first picture is a full one (large): how long its packets took to arrive, first to last. On this
    // machine's own engine that is the engine's sending alone, with no network in the way.
    while (!first || !(first.framesAssembledFromMultiplePackets >= 1)) {
      if (Date.now() - began > 15000) throw new Error(`No picture within 15 s (last: ${JSON.stringify(first)})`);
      await sleep(5);
      first = await read();
    }
    console.log(
      `First ${first.framesAssembledFromMultiplePackets} picture(s), the first a full one: ${(first.bytesReceived / 1024).toFixed(0)} KB in ` +
        `${first.packetsReceived} packets, first to last packet ${((first.totalAssemblyTime * 1000) / first.framesAssembledFromMultiplePackets).toFixed(2)} ms a picture`,
    );
    while (!first || first.framesDecoded < 30) {
      if (Date.now() - began > 15000) throw new Error(`No picture within 15 s (last: ${JSON.stringify(first)})`);
      await sleep(250);
      first = await read();
    }
    console.log(`Watching ${base} (${first.width}x${first.height}, decoder ${first.decoder}) for ${seconds} s, in 2 s stretches.`);
    console.log('  frames/s  Mbit/s  assembly  wait   target  decode  gap spread  lost  resends  rtt');
    const per = (a, b, total, count) => {
      const n = b[count] - a[count];
      return n > 0 && a[total] !== null && b[total] !== null ? ((b[total] - a[total]) / n) * 1000 : NaN;
    };
    const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(5) : '    -');
    const rows = [];
    let prev = first;
    for (let i = 0; i < seconds / 2; i++) {
      await sleep(2000);
      const now = await read();
      const secs = (now.at - prev.at) / 1000;
      const frames = now.framesDecoded - prev.framesDecoded;
      const gaps = now.framesDecoded - prev.framesDecoded;
      const meanGap = gaps > 0 ? (now.totalInterFrameDelay - prev.totalInterFrameDelay) / gaps : NaN;
      const meanSq = gaps > 0 ? (now.totalSquaredInterFrameDelay - prev.totalSquaredInterFrameDelay) / gaps : NaN;
      const row = {
        fps: frames / secs,
        mbit: ((now.bytesReceived - prev.bytesReceived) * 8) / 1e6 / secs,
        assembly: per(prev, now, 'totalAssemblyTime', 'framesAssembledFromMultiplePackets'),
        wait: per(prev, now, 'jitterBufferDelay', 'jitterBufferEmittedCount'),
        target: per(prev, now, 'jitterBufferTargetDelay', 'jitterBufferEmittedCount'),
        decode: per(prev, now, 'totalDecodeTime', 'framesDecoded'),
        gapSpread: Math.sqrt(Math.max(0, meanSq - meanGap * meanGap)) * 1000,
        lost: now.packetsLost - prev.packetsLost,
        resends: now.nackCount - prev.nackCount,
        rtt: now.rtt === null ? NaN : now.rtt * 1000,
      };
      rows.push(row);
      console.log(`  ${f1(row.fps)}    ${f1(row.mbit)}   ${f1(row.assembly)}   ${f1(row.wait)}  ${f1(row.target)}  ${f1(row.decode)}    ${f1(row.gapSpread)}    ${String(row.lost).padStart(3)}   ${String(row.resends).padStart(4)}  ${f1(row.rtt)}`);
      prev = now;
    }
    const median = (key) => {
      const v = rows.map((r) => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : NaN;
    };
    console.log(`  middle: wait ${f1(median('wait'))} ms, assembly ${f1(median('assembly'))} ms, target ${f1(median('target'))} ms, decode ${f1(median('decode'))} ms, gap spread ${f1(median('gapSpread'))} ms, rtt ${f1(median('rtt'))} ms`);
    const life = per({ jitterBufferDelay: 0, jitterBufferEmittedCount: 0 }, prev, 'jitterBufferDelay', 'jitterBufferEmittedCount');
    console.log(`  since the start (what the readout used to show): wait ${f1(life)} ms`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`FAIL. ${error.message}`);
    process.exit(1);
  },
);
