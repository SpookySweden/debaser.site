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
 *     <-- one plain line across the home network, opened with the engine's key ("the engine's site line", below) -->
 *   the gaming PC's engine (engine/src/site.rs), which hands over the picture it already encodes and its sound, and
 *   takes control back
 *
 * HIDDEN (Luke, 2026-11-28: "Wait until sound works too"): no page asks for this address until picture, control and
 * sound all work. It is not on SERVER's kept-running list either: it runs only inside a check or a measurement.
 *
 * WHO GETS ANYTHING. Only a browser that says, as its first message and within three seconds, a pass the site's own
 * server made for the owner (POST /api/screens/site-way): signed with the secret the site already keeps on SERVER
 * (SCREENS_RDP_SECRET, with words of its own mixed in so that a Remote Desktop pass opens nothing here and the other
 * way round), good for 60 seconds, once. Everyone else gets a closed line and not one byte of picture. The engine's
 * key never leaves SERVER: it is read here from the site's own settings file and sent only to the engine.
 *
 * NEVER QUEUEING. A frame that cannot leave at once because the line to the browser is backed up is SKIPPED, not
 * kept for later; so is everything after it until the engine, asked at once, sends a full picture. The browser says
 * several times a second which frame it has reached; one that has fallen too far behind is sent nothing until it
 * has caught up, and then starts again from a full picture.
 *
 * THE MONTH'S ALLOWANCE (Luke: "Build, capped, 20 GB (Recommended)"). Every byte this program sends to or takes from
 * a browser is counted, and the month's total is kept in ONE small file on SERVER, outside the repository:
 * G:\DEBASER-HOST\screens-site-usage.json. No database. At 20 GB (20,000,000,000 bytes) it stops sending and says
 * so, until the month's name changes. If that file is ever lost, that month's count starts again from nothing.
 *
 * THE GATE (--gate) is the measurement that came first (engine/BENCH.md): MADE-UP frames at the real size and pace to
 * a browser that reports how late each came. engine/bench/site-way-gate.cjs starts and stops it.
 *
 * No packages: a small websocket server by hand (RFC 6455), the same pattern as rdp-gateway.cjs.
 *
 * --- the engine's site line (engine/src/site.rs writes down the same) ----------------------------------------------
 * This program asks the engine's web address `GET /site?token=<key>` with `Upgrade: debaser-site`; the engine answers
 * `101` with the viewer's number in `Debaser-Viewer`, and from then on both ends send messages on that one line:
 *   4 bytes: how long the rest is; 1 byte: what it is; then its contents.
 * From the engine:   1 a frame, 2 a full picture (8 bytes: its place in time, 90,000 to the second; then H.264)
 *                    3 sound (8 bytes: its place in time, 48,000 to the second; then one Opus packet, 10 ms)
 *                    4 the PC's words (control's state, the controller, sound, the pointer: as on WebRTC's "keys")
 * To the engine:     16 the page's bytes for "keys", 17 its bytes for "pointer" (control.rs lists both)
 *                    18 "send a full picture", 19 "the viewer is still watching" (at least once a second)
 *
 * --- this program to the browser ---------------------------------------------------------------------------------
 * Each of the engine's messages goes on as one binary message: 1 byte what it is (as above), 4 bytes its number
 * (frames count 1, 2, 3...), 8 bytes the moment it left here (this program's clock, milliseconds), then the engine's
 * contents untouched. Words from this program itself are text: {"ok", "viewer", "month"} once let in, {"month"} now
 * and then, {"ended": why} before it closes the line.
 * From the browser: text {"pass"} first, then {"got", "sent", "at", "now"} several times a second (the newest frame
 * it has, the moment that frame left here, when it arrived and when this word left, by the browser's clock);
 * binary: 1 byte 16, 17 or 18 as above, then the bytes.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const PORT = Number(process.env.DEBASER_SITE_WAY_PORT || 8481);
const PATH = '/api/screens/site-socket';
const HOST_FOLDER = process.env.DEBASER_HOST_FOLDER || 'G:\\DEBASER-HOST';
/** The site's own settings on SERVER: the engine's address and key and the pass secret are read from it, never printed. */
const SETTINGS = process.env.DEBASER_SITE_WAY_SETTINGS || path.join(HOST_FOLDER, 'site.env');
/** The month's count. Outside the repository, beside the settings. */
const USAGE_FILE = process.env.DEBASER_SITE_WAY_USAGE || path.join(HOST_FOLDER, 'screens-site-usage.json');
/** Luke, 2026-11-28: 20 GB a month, then it stops. A check may set a smaller one; nothing can set a larger. */
const MONTH_LIMIT_BYTES = 20_000_000_000;
/** The cap the engine holds the picture to while someone watches this way (about 1.6 GB an hour). */
const CAP_BITS_A_SECOND = 3_500_000;
const FRAMES_A_SECOND = 60;
const FRAME_BYTES = Math.round(CAP_BITS_A_SECOND / 8 / FRAMES_A_SECOND);
/** A full picture is several times an ordinary frame; the made-up stream sends one every ten seconds and after a skip. */
const FULL_PICTURE_BYTES = 45_000;
const FULL_PICTURE_EVERY_MS = 10_000;
/** More than this still waiting to leave (about half a second of picture) means the line is backed up. */
const BACKED_UP_BYTES = 256 * 1024;
/** A browser this many frames behind the newest one sent (three quarters of a second) is sent nothing until it catches up. */
const TOO_FAR_BEHIND = 45;
const PASS_WAIT_MS = 3000;
const PASS_SECONDS = 60;
/** A browser that has said nothing for this long is not watching: the engine is no longer told that it is. */
const QUIET_AFTER_MS = 3000;
/** And one silent for this long has gone. */
const GONE_AFTER_MS = 10_000;
const ENGINE_WAIT_MS = 3000;
const MAX_VIEWERS = 3;
const MAX_REAL_VIEWERS = 2;
/** How many lines may be open at once that have not shown a pass yet (each has three seconds to). */
const MAX_WAITING = 8;
const USED_UP = "THIS MONTH'S ALLOWANCE THROUGH THE SITE IS USED UP";
const MAX_MESSAGE = 16 * 1024;
const MAX_ENGINE_MESSAGE = 4 * 1024 * 1024;
const HEADER_BYTES = 13;
const KIND = { frame: 1, fullPicture: 2, sound: 3, says: 4, keys: 16, pointer: 17, fullPicturePlease: 18, stillWatching: 19 };
/** The words mixed into a pass's signature, so a pass made for another gateway opens nothing here. */
const PASS_WORDS = 'site-way:';

/** One clock for every stamp, in milliseconds with fractions; the measuring script reads the same one. */
const clock = () => performance.timeOrigin + performance.now();
const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

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

/* --- the settings, the pass and the engine's address --------------------------------------------------------------- */

/** A settings file as name -> value. Read at every connection, so an edit needs no restart. Never printed. */
function settingsFrom(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"(.*)"$/, '$1');
    }
  } catch {
    /* no file */
  }
  return out;
}

/** The secret the site signs passes with; null when it is not one (shorter than 32 characters, or missing). */
function passSecret(config) {
  const secret = String(config.SCREENS_RDP_SECRET || '').trim();
  return secret.length >= 32 ? secret : null;
}

/** A pass, as the site makes it (app/lib/screens/site-way-server.ts, `makeSitePass`): `<claims>.<signature>`. */
function makePass(secret, now, nonce = crypto.randomBytes(12).toString('base64url')) {
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + PASS_SECONDS, nonce, way: 'site' }), 'utf8').toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(PASS_WORDS + body).digest('base64url')}`;
}

/** Whether a pass is one the site made for this way: signed, not run out, not used before. `used` remembers them. */
function passIsGood(pass, secret, used, now = Date.now()) {
  if (!secret || typeof pass !== 'string' || pass.length > 600) return false;
  const [body, signature, more] = pass.split('.');
  if (!body || !signature || more !== undefined) return false;
  const expected = crypto.createHmac('sha256', secret).update(PASS_WORDS + body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (claims === null || typeof claims !== 'object' || claims.way !== 'site') return false;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now || claims.exp * 1000 > now + PASS_SECONDS * 2000) return false;
  if (typeof claims.nonce !== 'string' || claims.nonce.length < 8 || used.has(claims.nonce)) return false;
  for (const [nonce, at] of used) if (at < now - PASS_SECONDS * 2000) used.delete(nonce);
  used.set(claims.nonce, now);
  return true;
}

/**
 * Where the engine is, from the site's settings: a plain http address that is this PC itself, or a home-network
 * number together with the engine's key (the same rule as app/lib/screens/host-server.ts). Null for anything else.
 */
function engineAddress(config) {
  const key = /^[A-Za-z0-9_-]{16,128}$/.test(String(config.SCREENS_ENGINE_TOKEN || '').trim()) ? String(config.SCREENS_ENGINE_TOKEN).trim() : null;
  let url;
  try {
    url = new URL(String(config.SCREENS_ENGINE_URL || '').trim() || 'http://127.0.0.1:8478');
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.username !== '' || url.password !== '') return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return null;
  const host = url.hostname.toLowerCase();
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const numbers = parts === null ? null : parts.slice(1).map(Number);
  const numbered = numbers !== null && numbers.every((n) => n <= 255);
  const thisPc = host === 'localhost' || (numbered && numbers[0] === 127);
  const home = numbered && (numbers[0] === 10 || (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31) || (numbers[0] === 192 && numbers[1] === 168));
  if (!thisPc && !(home && key !== null)) return null;
  return { host, port: Number(url.port || 80), key };
}

/* --- the month's allowance ------------------------------------------------------------------------------------------ */

/** The month a moment falls in, by SERVER's own calendar: "2026-11". */
function monthOf(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The limit in force: 20 GB, or a smaller one a check asks for. Never a larger one. */
function limitFrom(asked) {
  const number = Number(asked);
  return Number.isFinite(number) && number > 0 && number < MONTH_LIMIT_BYTES ? Math.floor(number) : MONTH_LIMIT_BYTES;
}

/**
 * The month's count, kept in one small file. Read once at the start; written (to a file beside it, then swapped in,
 * so a cut-off write never leaves half a file) when it has changed. A file that is missing or cannot be read counts
 * as nothing used: that is the risk Luke was told once.
 */
function usageIn(file, limit, today = () => new Date()) {
  let month = monthOf(today());
  let bytes = 0;
  let saved = -1;
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kept && kept.month === month && Number.isFinite(kept.bytes) && kept.bytes >= 0) bytes = Math.floor(kept.bytes);
  } catch {
    /* no count yet */
  }
  const turn = () => {
    const now = monthOf(today());
    if (now !== month) {
      month = now;
      bytes = 0;
    }
  };
  return {
    add(count) {
      turn();
      bytes += count;
    },
    left() {
      turn();
      return Math.max(0, limit - bytes);
    },
    says() {
      turn();
      return { name: month, usedBytes: bytes, limitBytes: limit };
    },
    save() {
      turn();
      if (bytes === saved) return true;
      try {
        fs.writeFileSync(`${file}.new`, JSON.stringify({ month, bytes, saved: new Date().toISOString() }));
        fs.renameSync(`${file}.new`, file);
        saved = bytes;
        return true;
      } catch {
        return false;
      }
    },
  };
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

/** Sends one message; returns how many bytes that put on the line. */
function sendMessage(socket, opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  if (socket.destroyed) return 0;
  const header = frameHeader(opcode, data.length);
  socket.write(Buffer.concat([header, data]));
  return header.length + data.length;
}

/**
 * Reads the browser's messages (masked, as browsers send them) and hands each whole one on: text to `onText`, bytes
 * to `onBytes` (when there is one; the gate takes none). `onCount` hears how many bytes arrived.
 */
function readMessages(socket, onText, onClose, onBytes, onCount) {
  let buffer = Buffer.alloc(0);
  let pieces = [];
  let binary = false;
  socket.on('data', (chunk) => {
    if (onCount) onCount(chunk.length);
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
      if (opcode === 0x2 && !onBytes) return onClose('a message this gateway does not take');
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        if (opcode !== 0x0) binary = opcode === 0x2;
        pieces.push(data);
        if (pieces.reduce((sum, piece) => sum + piece.length, 0) > MAX_MESSAGE) return onClose('a message this gateway does not take');
        if (fin) {
          const whole = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
          pieces = [];
          if (binary) onBytes(whole);
          else onText(whole.toString('utf8'));
        }
      }
    }
  });
}

/* --- the engine's site line ---------------------------------------------------------------------------------------- */

/** One message for the engine's line: how long the rest is, what it is, its contents. */
function lineMessage(kind, contents = Buffer.alloc(0)) {
  const message = Buffer.allocUnsafe(5 + contents.length);
  message.writeUInt32BE(1 + contents.length, 0);
  message[4] = kind;
  contents.copy(message, 5);
  return message;
}

/**
 * Takes the bytes of the engine's line as they come and gives back the whole messages in them; what is left over
 * waits for the next bytes. A message longer than the engine ever sends means this is not the engine: it throws.
 */
function lineReader(most = MAX_ENGINE_MESSAGE) {
  let waiting = Buffer.alloc(0);
  return (chunk) => {
    waiting = waiting.length === 0 ? chunk : Buffer.concat([waiting, chunk]);
    const whole = [];
    for (;;) {
      if (waiting.length < 4) break;
      const length = waiting.readUInt32BE(0);
      if (length < 1 || length > most) throw new Error('not the engine\'s line');
      if (waiting.length < 4 + length) break;
      whole.push({ kind: waiting[4], contents: waiting.subarray(5, 4 + length) });
      waiting = waiting.subarray(4 + length);
    }
    return whole;
  };
}

/** What goes in front of the engine's contents on the way to the browser: what it is, its number, when it left here. */
function browserHeader(kind, number, now) {
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header[0] = kind;
  header.writeUInt32BE(number >>> 0, 1);
  header.writeDoubleBE(now, 5);
  return header;
}

/**
 * What to do with a frame, from how the viewer stands. Changes the viewer's state and returns 'send' or 'skip', and
 * whether the engine is to be asked for a full picture. Kept apart from the sockets so the check can ask it directly.
 *   waitingBytes: how much is still waiting to leave for the browser.
 */
function frameRule(viewer, kind, waitingBytes) {
  // Backed up: nothing more is put on the line; when it clears, a full picture is where it starts again.
  if (waitingBytes > BACKED_UP_BYTES) {
    viewer.needFull = true;
    return { what: 'skip', ask: false };
  }
  // Too far behind: sent nothing until its word says it has caught up with the last frame it was sent.
  if (viewer.catchingUp) {
    if (viewer.lastSent - viewer.got > 2 && clock() - viewer.catchingUpSince < 2000) return { what: 'skip', ask: false };
    viewer.catchingUp = false;
    viewer.needFull = true;
  } else if (viewer.heardOf && viewer.lastSent - viewer.got > TOO_FAR_BEHIND) {
    viewer.catchingUp = true;
    viewer.catchingUpSince = clock();
    return { what: 'skip', ask: false };
  }
  if (viewer.needFull && kind !== KIND.fullPicture) return { what: 'skip', ask: true };
  viewer.needFull = false;
  return { what: 'send', ask: false };
}

/* --- the made-up stream (the gate) -------------------------------------------------------------------------------- */

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

const GATE = process.argv.includes('--gate');
const viewers = new Set();
/** What the last viewers did, kept for the measuring script's question after they have gone. */
const finished = [];
let nextViewer = 1;
/** The passes already used, by their one-time part. */
const usedPasses = new Map();
let usage = null;

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

/** The browser's word, several times a second: where it has got to. Kept for the gate's report and the frame rule. */
function heardWhereItIs(viewer, said) {
  if (!said || !Number.isFinite(said.got) || !Number.isFinite(said.sent) || !Number.isFinite(said.at) || !Number.isFinite(said.now)) return;
  viewer.heardAt = clock();
  viewer.heardOf = true;
  viewer.got = Math.max(viewer.got, Math.floor(said.got));
  const roundTrip = clock() - said.sent - (said.now - said.at);
  if (viewer.roundTrips.length < 20000) viewer.roundTrips.push(Math.round(roundTrip * 100) / 100);
  if (viewer.behind.length < 20000) viewer.behind.push(viewer.number - said.got);
}

function heardAtTheGate(viewer, text) {
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
  heardWhereItIs(viewer, said);
  return null;
}

/* --- the real stream: one viewer and its line to the engine ------------------------------------------------------- */

/** Tells the browser why, in words the view can show, then closes. */
function endWith(viewer, why) {
  if (!viewer.socket.destroyed && !viewer.closed) viewer.count(sendMessage(viewer.socket, 0x1, JSON.stringify({ ended: why, month: usage.says() })));
  viewer.gone(why);
}

/** Opens the engine's site line for a viewer that has shown a good pass, and carries everything both ways. */
function openEngineLine(viewer) {
  const where = engineAddress(settingsFrom(SETTINGS));
  if (where === null) return endWith(viewer, "THE PC'S ENGINE IS NOT SET UP ON THE SERVER");
  const engine = net.connect({ host: where.host, port: where.port });
  viewer.engine = engine;
  engine.setNoDelay(true);
  let head = Buffer.alloc(0);
  let read = null;
  const answerTimer = setTimeout(() => endWith(viewer, "THE PC'S ENGINE DID NOT ANSWER"), ENGINE_WAIT_MS);
  engine.on('connect', () => {
    engine.write(`GET /site${where.key === null ? '' : `?token=${where.key}`} HTTP/1.1\r\nHost: ${where.host}:${where.port}\r\nConnection: Upgrade\r\nUpgrade: debaser-site\r\n\r\n`);
  });
  engine.on('error', () => endWith(viewer, "THE PC'S ENGINE DID NOT ANSWER"));
  engine.on('close', () => endWith(viewer, "THE PC'S ENGINE CLOSED THE LINE"));
  engine.on('data', (chunk) => {
    let rest = chunk;
    if (read === null) {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > 8192) endWith(viewer, "THE PC'S ENGINE DID NOT ANSWER");
        return;
      }
      clearTimeout(answerTimer);
      const lines = head.subarray(0, end).toString('latin1').split('\r\n');
      if (!/^HTTP\/1\.1 101 /.test(lines[0])) {
        // The engine says why in plain words ("2 viewers are already watching through the site"); an older engine says 404.
        const words = head.subarray(end + 4).toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 200);
        return endWith(viewer, /^HTTP\/1\.1 404 /.test(lines[0]) ? "THE PC'S ENGINE IS TOO OLD FOR THE WAY THROUGH THE SITE" : `THE PC SAID NO: ${words || lines[0]}`);
      }
      const number = lines.map((line) => /^debaser-viewer:\s*(\d{1,12})$/i.exec(line)).find(Boolean);
      viewer.engineViewer = number ? Number(number[1]) : null;
      read = lineReader();
      rest = head.subarray(end + 4);
      head = Buffer.alloc(0);
      viewer.heardAt = clock();
      viewer.count(sendMessage(viewer.socket, 0x1, JSON.stringify({ ok: true, viewer: viewer.engineViewer, month: usage.says() })));
      log(`viewer ${viewer.id} is watching through the site (the engine's viewer ${viewer.engineViewer})`);
      if (rest.length === 0) return;
    }
    let messages;
    try {
      messages = read(rest);
    } catch (error) {
      return endWith(viewer, "THE PC'S ENGINE SENT SOMETHING THIS SERVER DOES NOT KNOW");
    }
    for (const message of messages) fromEngine(viewer, message);
  });
}

/** One of the engine's messages, on its way to the browser. */
function fromEngine(viewer, { kind, contents }) {
  const socket = viewer.socket;
  if (socket.destroyed || viewer.closed) return;
  // The stop is here, at the byte that would go over, not at the next look twice a second.
  if (usage.left() <= 0) return endWith(viewer, USED_UP);
  const waiting = socket.writableLength;
  if (waiting > viewer.mostWaiting) viewer.mostWaiting = waiting;
  let number = 0;
  if (kind === KIND.frame || kind === KIND.fullPicture) {
    viewer.number += 1;
    number = viewer.number;
    const rule = frameRule(viewer, kind, waiting);
    if (rule.ask) askForFullPicture(viewer);
    if (rule.what === 'skip') {
      viewer.skipped += 1;
      return;
    }
    viewer.lastSent = number;
    viewer.sent += 1;
  } else if (kind === KIND.sound) {
    // Sound is never kept for later either: 10 ms that cannot leave now is 10 ms nobody needs.
    if (waiting > BACKED_UP_BYTES || viewer.catchingUp) return;
    viewer.soundNumber += 1;
    number = viewer.soundNumber;
  } else if (kind !== KIND.says) {
    return;
  }
  const header = browserHeader(kind, number, clock());
  socket.cork();
  socket.write(frameHeader(0x2, header.length + contents.length));
  socket.write(header);
  socket.write(contents);
  socket.uncork();
  viewer.count(header.length + contents.length + (header.length + contents.length < 126 ? 2 : header.length + contents.length < 65536 ? 4 : 10));
}

function askForFullPicture(viewer) {
  const now = clock();
  if (now - viewer.askedFullAt < 250 || !viewer.engine || viewer.engine.destroyed) return;
  viewer.askedFullAt = now;
  viewer.engine.write(lineMessage(KIND.fullPicturePlease));
}

function heardReal(viewer, text) {
  let said;
  try {
    said = JSON.parse(text);
  } catch {
    return 'words that are not a message';
  }
  if (!viewer.let) {
    const secret = passSecret(settingsFrom(SETTINGS));
    if (!passIsGood(said && said.pass, secret, usedPasses)) return 'no pass, or not a good one';
    viewer.let = true;
    clearTimeout(viewer.passTimer);
    if (usage.left() <= 0) {
      endWith(viewer, USED_UP);
      return null;
    }
    if ([...viewers].filter((other) => other.let).length > MAX_REAL_VIEWERS) {
      endWith(viewer, 'TWO VIEWERS ARE ALREADY WATCHING THROUGH THE SITE');
      return null;
    }
    openEngineLine(viewer);
    return null;
  }
  heardWhereItIs(viewer, said);
  return null;
}

/** The browser's bytes: control for the PC, or "send a full picture". Passed to the engine as they are. */
function bytesReal(viewer, bytes) {
  if (!viewer.let || !viewer.engine || viewer.engine.destroyed || viewer.engineViewer === undefined || bytes.length < 1) return;
  viewer.heardAt = clock();
  const kind = bytes[0];
  if (kind === KIND.keys || kind === KIND.pointer) viewer.engine.write(lineMessage(kind, bytes.subarray(1)));
  else if (kind === KIND.fullPicturePlease) askForFullPicture(viewer);
}

/** Twice a second: the engine is told who is still watching, silent browsers are let go, and the month is watched. */
function watchReal() {
  const now = clock();
  const usedUp = usage.left() <= 0;
  for (const viewer of [...viewers]) {
    if (!viewer.let || viewer.closed) continue;
    if (usedUp) {
      endWith(viewer, USED_UP);
      continue;
    }
    if (viewer.engineViewer === undefined) continue;
    const quiet = now - viewer.heardAt;
    if (quiet > GONE_AFTER_MS) {
      endWith(viewer, 'THE BROWSER WENT SILENT');
      continue;
    }
    if (quiet <= QUIET_AFTER_MS && viewer.engine && !viewer.engine.destroyed) viewer.engine.write(lineMessage(KIND.stillWatching));
    if (now - viewer.monthSaidAt >= 10_000) {
      viewer.monthSaidAt = now;
      viewer.count(sendMessage(viewer.socket, 0x1, JSON.stringify({ month: usage.says() })));
    }
  }
}

/* --- the door ---------------------------------------------------------------------------------------------------- */

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://gateway');
  const answer = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  // Asked only from this PC (the site's own server, a check, the measuring script): the site's rewrite passes nothing
  // but the socket's own address, so none of this can be asked through the tunnel.
  if (url.pathname === '/health') {
    if (GATE) return answer(200, { ok: true, gate: true, viewers: viewers.size });
    const config = settingsFrom(SETTINGS);
    return answer(200, { ok: true, gate: false, engineSet: engineAddress(config) !== null, passesSet: passSecret(config) !== null, viewers: viewers.size, month: usage.says() });
  }
  if (url.pathname === '/gate' && GATE) return answer(200, { now: [...viewers].map(summaryOf), finished });
  if (url.pathname === PATH) return answer(426, { error: 'this address is a websocket' });
  return answer(404, { error: 'nothing here' });
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, 'http://gateway');
  const refuse = (why) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    log(`refused: ${why}`);
  };
  if (url.pathname !== PATH) return refuse('another address');
  if (!originIsOurs(request.headers.origin)) return refuse('a page that is not the site');
  // The real door counts those still to show a pass apart from those watching, so a stranger knocking keeps nobody out.
  if (GATE ? viewers.size >= MAX_VIEWERS : [...viewers].filter((other) => !other.let).length >= MAX_WAITING) return refuse('enough viewers already');
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
    // The real stream's own:
    engine: null,
    engineViewer: undefined,
    lastSent: 0,
    got: 0,
    heardOf: false,
    heardAt: clock(),
    needFull: true,
    catchingUp: false,
    catchingUpSince: 0,
    askedFullAt: 0,
    soundNumber: 0,
    monthSaidAt: clock(),
    count(bytes) {
      viewer.bytes += bytes;
      if (usage) usage.add(bytes);
    },
    gone: null,
  };
  nextViewer += 1;
  viewers.add(viewer);
  const gone = (why) => {
    if (viewer.closed) return;
    viewer.closed = why;
    clearTimeout(viewer.passTimer);
    viewers.delete(viewer);
    if (viewer.engine && !viewer.engine.destroyed) viewer.engine.destroy();
    if (viewer.let && GATE) {
      finished.push(summaryOf(viewer));
      if (finished.length > 8) finished.shift();
    }
    if (!socket.destroyed) {
      sendMessage(socket, 0x8, Buffer.alloc(0));
      socket.end();
    }
    if (usage) usage.save();
    log(`viewer ${viewer.id} gone: ${why} (${viewer.sent} frames sent, ${viewer.skipped} skipped)`);
  };
  viewer.gone = gone;
  viewer.passTimer = setTimeout(() => gone(GATE ? 'no words in time' : 'no pass in time'), PASS_WAIT_MS);
  readMessages(
    socket,
    (text) => {
      const wrong = GATE ? heardAtTheGate(viewer, text) : heardReal(viewer, text);
      if (wrong) gone(wrong);
    },
    gone,
    GATE ? null : (bytes) => bytesReal(viewer, bytes),
    GATE ? null : (bytes) => viewer.count(bytes),
  );
  socket.on('error', () => gone('the line broke'));
  socket.on('close', () => gone('the line closed'));
});

module.exports = {
  originIsOurs,
  wordsMatch,
  madeUpFrame,
  frameHeader,
  settingsFrom,
  passSecret,
  makePass,
  passIsGood,
  engineAddress,
  monthOf,
  limitFrom,
  usageIn,
  lineMessage,
  lineReader,
  browserHeader,
  frameRule,
  PATH,
  PORT,
  FRAME_BYTES,
  FULL_PICTURE_BYTES,
  HEADER_BYTES,
  KIND,
  MONTH_LIMIT_BYTES,
  CAP_BITS_A_SECOND,
  BACKED_UP_BYTES,
  TOO_FAR_BEHIND,
  PASS_SECONDS,
  USED_UP,
  MAX_REAL_VIEWERS,
};

if (require.main === module) {
  if (GATE) {
    if (typeof process.env.SITE_WAY_GATE_PASS !== 'string' || process.env.SITE_WAY_GATE_PASS.length < 24) {
      console.log('The gate needs its one-time words (SITE_WAY_GATE_PASS), which the measuring script makes for each run.');
      process.exit(2);
    }
    server.listen(PORT, '127.0.0.1', () => log(`the site-way gateway (GATE ONLY: made-up frames) listens on 127.0.0.1:${PORT}`));
    // The timer here fires about every 15 ms on Windows; tick() sends whatever has come due, so the pace averages 60 a second.
    setInterval(tick, 1);
  } else {
    const config = settingsFrom(SETTINGS);
    if (passSecret(config) === null) {
      console.log('NOT STARTED. The site\'s settings on this PC hold no pass secret, so nobody could be let in.');
      process.exit(2);
    }
    usage = usageIn(USAGE_FILE, limitFrom(process.env.DEBASER_SITE_WAY_LIMIT_BYTES));
    if (!usage.save()) {
      console.log('NOT STARTED. The month\'s count cannot be written, and without it the 20 GB limit could not be kept.');
      process.exit(2);
    }
    const month = usage.says();
    server.listen(PORT, '127.0.0.1', () => log(`the site-way gateway listens on 127.0.0.1:${PORT}; ${month.name}: ${month.usedBytes} of ${month.limitBytes} bytes used; the engine is ${engineAddress(config) === null ? 'NOT set' : 'set'}`));
    setInterval(watchReal, 500);
    setInterval(() => usage.save(), 10_000);
    const stop = () => {
      usage.save();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
