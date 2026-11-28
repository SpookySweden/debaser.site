#!/usr/bin/env node
/*
 * The gateway for REMOTE's slowest way: THROUGH THE SITE (SPEC-screens.md, "Away from home with no setup"; Luke,
 * 2026-11-28: "okay but make sure it doesnt cost and look into it", then "Build, capped, 20 GB (Recommended)").
 *
 *   browser (the room's REMOTE view)
 *     <-- one websocket: debaser.site/api/screens/site-socket, through Cloudflare and the tunnel -->
 *   the site's own program on SERVER, which only passes it along (the rewrite in next.config.ts)
 *     <-- the same websocket, on 127.0.0.1 -->
 *   this program, on 127.0.0.1:8481
 *
 * ONLY THE GATE IS BUILT (2026-11-28). The gate is the measurement that decides whether the rest gets written: this
 * program sends MADE-UP frames (random bytes at the size and pace the real picture will have: 60 a second, 3.5 Mbit/s)
 * to a browser that reports back how late each one came, so the delay, the lumps and the stalls of the real path are
 * known before the engine's side exists. It carries no picture, no sound and no control, reaches no other machine, and
 * runs only for the few minutes of a measurement (engine/bench/site-way-gate.cjs starts and stops it). It is not on
 * SERVER's kept-running list.
 *
 * Who gets anything: only a browser that says the measurement's own one-time words (SITE_WAY_GATE_PASS, made fresh
 * by the measuring script for each run and handed to this program in its environment, never printed) as its first
 * message, within three seconds. Everyone else gets a closed line and not one frame.
 *
 * Never queueing, the rule the real one keeps too: a frame that cannot leave at once because the line is backed up is
 * SKIPPED, not kept for later, and the next frame sent after a skip is a full picture.
 *
 * No packages: a small websocket server by hand (RFC 6455), the same pattern as rdp-gateway.cjs.
 */
'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const PORT = Number(process.env.DEBASER_SITE_WAY_PORT || 8481);
const PATH = '/api/screens/site-socket';
/** The cap the site way will hold the picture to (about 1.6 GB an hour). */
const CAP_BITS_A_SECOND = 3_500_000;
const FRAMES_A_SECOND = 60;
const FRAME_BYTES = Math.round(CAP_BITS_A_SECOND / 8 / FRAMES_A_SECOND);
/** A full picture is several times an ordinary frame; the made-up stream sends one every ten seconds and after a skip. */
const FULL_PICTURE_BYTES = 45_000;
const FULL_PICTURE_EVERY_MS = 10_000;
/** More than this still waiting to leave (about half a second of picture) means the line is backed up. */
const BACKED_UP_BYTES = 256 * 1024;
const PASS_WAIT_MS = 3000;
const MAX_VIEWERS = 3;
const MAX_MESSAGE = 16 * 1024;
const HEADER_BYTES = 13;
const KIND = { frame: 1, fullPicture: 2 };

/** One clock for every stamp, in milliseconds with fractions; the measuring script reads the same one. */
const clock = () => performance.timeOrigin + performance.now();

/** Where a browser may come from: the site itself, or this machine (a drive on a local copy of the site). */
function originIsOurs(origin) {
  if (origin === undefined) return true; // not a browser: only something on this PC, or the measuring script, sends none
  return origin === 'https://debaser.site' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(origin);
}

function wordsMatch(said, expected) {
  if (typeof said !== 'string' || typeof expected !== 'string' || expected.length < 24) return false;
  const a = crypto.createHash('sha256').update(said).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/* --- a websocket by hand ---------------------------------------------------------------------------------------- */

function frameHeader(opcode, length) {
  if (length < 126) return Buffer.from([0x80 | opcode, length]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

function sendMessage(socket, opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  if (!socket.destroyed) socket.write(Buffer.concat([frameHeader(opcode, data.length), data]));
}

/** Reads the browser's messages (masked, as browsers send them) and hands each whole text one on. */
function readMessages(socket, onText, onClose) {
  let buffer = Buffer.alloc(0);
  let pieces = [];
  socket.on('data', (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        at = 10;
      }
      if (!masked || length > MAX_MESSAGE) return onClose('a message this gateway does not take');
      if (buffer.length < at + 4 + length) return;
      const mask = buffer.subarray(at, at + 4);
      const data = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
      buffer = buffer.subarray(at + 4 + length);
      if (opcode === 0x8) return onClose('the browser closed it');
      if (opcode === 0x9) {
        sendMessage(socket, 0xa, data);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        pieces.push(data);
        if (fin) {
          const text = Buffer.concat(pieces).toString('utf8');
          pieces = [];
          onText(text);
        }
      }
    }
  });
}

/* --- the made-up stream ----------------------------------------------------------------------------------------- */

/** Random bytes, so nothing on the way can squeeze them smaller than a real picture would be. */
const NOISE = crypto.randomBytes(1024 * 1024);
let noiseAt = 0;

/** One made-up frame: what it is (1 byte), its number (4), when it left by this program's clock (8), then noise. */
function madeUpFrame(kind, number, now) {
  const size = kind === KIND.fullPicture ? FULL_PICTURE_BYTES : FRAME_BYTES;
  const frame = Buffer.allocUnsafe(size);
  frame[0] = kind;
  frame.writeUInt32BE(number, 1);
  frame.writeDoubleBE(now, 5);
  const room = size - HEADER_BYTES;
  if (noiseAt + room > NOISE.length) noiseAt = 0;
  NOISE.copy(frame, HEADER_BYTES, noiseAt, noiseAt + room);
  noiseAt += room;
  return frame;
}

const viewers = new Set();
/** What the last viewers did, kept for the measuring script's question after they have gone. */
const finished = [];
let nextViewer = 1;

function summaryOf(viewer) {
  return {
    viewer: viewer.id,
    name: viewer.name,
    cameThroughCloudflare: viewer.cloudflare,
    framesSent: viewer.sent,
    framesSkipped: viewer.skipped,
    bytesSent: viewer.bytes,
    mostWaitingBytes: viewer.mostWaiting,
    // Round trips: frame out, the browser's word back, the browser's own handling time taken off. One clock: this one.
    roundTripsMs: viewer.roundTrips,
    behindFrames: viewer.behind,
    closed: viewer.closed,
  };
}

function startStream(viewer) {
  viewer.due = clock();
  viewer.lastFull = 0;
  viewer.wantFull = true;
}

/** Sends every frame that has come due, at most two at once (a late tick is caught up, a long pause is not replayed). */
function tick() {
  const now = clock();
  for (const viewer of viewers) {
    if (!viewer.let || viewer.socket.destroyed) continue;
    let sentNow = 0;
    while (now >= viewer.due && sentNow < 2) {
      viewer.due += 1000 / FRAMES_A_SECOND;
      sentNow += 1;
      viewer.number += 1;
      const waiting = viewer.socket.writableLength;
      if (waiting > viewer.mostWaiting) viewer.mostWaiting = waiting;
      if (waiting > BACKED_UP_BYTES) {
        viewer.skipped += 1;
        viewer.wantFull = true;
        continue;
      }
      const full = viewer.wantFull || now - viewer.lastFull >= FULL_PICTURE_EVERY_MS;
      const frame = madeUpFrame(full ? KIND.fullPicture : KIND.frame, viewer.number, clock());
      if (full) {
        viewer.wantFull = false;
        viewer.lastFull = now;
      }
      sendMessage(viewer.socket, 0x2, frame);
      viewer.sent += 1;
      viewer.bytes += frame.length;
    }
    if (now - viewer.due > 250) viewer.due = now; // the program itself was held up: carry on from now
  }
}

function heard(viewer, text) {
  let said;
  try {
    said = JSON.parse(text);
  } catch {
    return 'words that are not a message';
  }
  if (!viewer.let) {
    if (!wordsMatch(said && said.pass, process.env.SITE_WAY_GATE_PASS)) return 'not the measurement\'s words';
    viewer.let = true;
    viewer.name = typeof said.name === 'string' ? said.name.replace(/[^a-z0-9-]/gi, '').slice(0, 24) : '';
    clearTimeout(viewer.passTimer);
    sendMessage(viewer.socket, 0x1, JSON.stringify({ gate: true, framesASecond: FRAMES_A_SECOND, bitsASecond: CAP_BITS_A_SECOND }));
    startStream(viewer);
    return null;
  }
  // The browser's word, several times a second: the newest frame it has, when that frame left (our clock, given
  // back), when it arrived and when this word left (its clock: only their difference is used).
  if (said && Number.isFinite(said.got) && Number.isFinite(said.sent) && Number.isFinite(said.at) && Number.isFinite(said.now)) {
    const roundTrip = clock() - said.sent - (said.now - said.at);
    if (viewer.roundTrips.length < 20000) viewer.roundTrips.push(Math.round(roundTrip * 100) / 100);
    if (viewer.behind.length < 20000) viewer.behind.push(viewer.number - said.got);
  }
  return null;
}

/* --- the door ---------------------------------------------------------------------------------------------------- */

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://gateway');
  const answer = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  // Asked only by the measuring script on this PC: the site's rewrite passes nothing but the socket's own address.
  if (url.pathname === '/health') return answer(200, { ok: true, gate: true, viewers: viewers.size });
  if (url.pathname === '/gate') return answer(200, { now: [...viewers].map(summaryOf), finished });
  if (url.pathname === PATH) return answer(426, { error: 'this address is a websocket' });
  return answer(404, { error: 'nothing here' });
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, 'http://gateway');
  const refuse = (why) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    console.log(`${new Date().toISOString()} refused: ${why}`);
  };
  if (url.pathname !== PATH) return refuse('another address');
  if (!originIsOurs(request.headers.origin)) return refuse('a page that is not the site');
  if (viewers.size >= MAX_VIEWERS) return refuse('enough viewers already');
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') return refuse('not a websocket');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const viewer = {
    id: nextViewer,
    name: '',
    socket,
    cloudflare: Boolean(request.headers['cf-ray'] || request.headers['cf-connecting-ip']),
    let: false,
    number: 0,
    sent: 0,
    skipped: 0,
    bytes: 0,
    mostWaiting: 0,
    roundTrips: [],
    behind: [],
    closed: null,
    due: 0,
    lastFull: 0,
    wantFull: true,
    passTimer: null,
  };
  nextViewer += 1;
  viewers.add(viewer);
  const gone = (why) => {
    if (viewer.closed) return;
    viewer.closed = why;
    clearTimeout(viewer.passTimer);
    viewers.delete(viewer);
    if (viewer.let) {
      finished.push(summaryOf(viewer));
      if (finished.length > 8) finished.shift();
    }
    if (!socket.destroyed) {
      sendMessage(socket, 0x8, Buffer.alloc(0));
      socket.end();
    }
    console.log(`${new Date().toISOString()} viewer ${viewer.id} gone: ${why} (${viewer.sent} frames sent, ${viewer.skipped} skipped)`);
  };
  viewer.passTimer = setTimeout(() => gone('no words in time'), PASS_WAIT_MS);
  readMessages(
    socket,
    (text) => {
      const wrong = heard(viewer, text);
      if (wrong) gone(wrong);
    },
    gone,
  );
  socket.on('error', () => gone('the line broke'));
  socket.on('close', () => gone('the line closed'));
});

module.exports = { originIsOurs, wordsMatch, madeUpFrame, frameHeader, PATH, PORT, FRAME_BYTES, FULL_PICTURE_BYTES, HEADER_BYTES, KIND };

if (require.main === module) {
  if (!process.argv.includes('--gate')) {
    console.log('Only the gate (a measurement with made-up frames) is built: start it through engine/bench/site-way-gate.cjs.');
    process.exit(2);
  }
  if (typeof process.env.SITE_WAY_GATE_PASS !== 'string' || process.env.SITE_WAY_GATE_PASS.length < 24) {
    console.log('The gate needs its one-time words (SITE_WAY_GATE_PASS), which the measuring script makes for each run.');
    process.exit(2);
  }
  server.listen(PORT, '127.0.0.1', () => console.log(`${new Date().toISOString()} the site-way gateway (GATE ONLY: made-up frames) listens on 127.0.0.1:${PORT}`));
  // The timer here fires about every 15 ms on Windows; tick() sends whatever has come due, so the pace averages 60 a second.
  setInterval(tick, 1);
}
