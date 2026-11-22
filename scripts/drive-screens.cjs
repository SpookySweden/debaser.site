/*
 * Drives SCREENS in a room (SPEC-screens.md, phase 3, first slice) in a real, hidden browser: the owner's PC screen in
 * his own room, its settings panel and CONTROL. All of it on this PC, on mock data: nothing reaches the live site or
 * the live database, and nothing reaches Windows (the engine is started in its DRY RUN, which writes down what it
 * would do with the mouse and keys and does none of it). Not in `npm run checks`: it needs the engine, a dev server
 * and a browser.
 *
 *   node scripts/drive-screens.cjs [--port 3391] [--engine-port 8491] [--only closed|open|rdp]
 *
 * PART 3 (--only rdp), THE SERVER BY REMOTE DESKTOP: the real gateway (scripts/host/rdp-gateway.cjs) on 127.0.0.1, with
 *   a pretend guacd in this script in place of Guacamole's translator (no Remote Desktop server is needed): it draws a
 *   red screen of the size it was asked for and writes down every key and press that reaches it. The room's REMOTE
 *   goes straight to THE SERVER; the picture is drawn; control is on from the start (a key and a click reach the
 *   server); a short Esc is the server's and closes nothing here; holding Esc lets go (keys then stay on the page);
 *   a click takes control back; a smaller room tells the server its new size.
 *
 * It starts everything itself and stops it again:
 *   - the engine: engine/target/release/debaser-engine.exe serve --allow-control --control-dry-run --tweaks 76
 *     --port <engine-port> --seconds 120   (127.0.0.1 only; never --lan). The video it sends is this PC's own screen,
 *     and it goes no further than the hidden browser on this PC.
 *   - the site's dev server, by a node launcher: every data source on mock, mock sign-in, the Supabase address and key
 *     truly EMPTY (an empty value survives `spawn`'s env, unlike PowerShell's `$env:X = ''`), SCREENS_ENGINE_URL
 *     pointed at that engine.
 *
 * PART 1, a server started WITHOUT SCREENS_DEV_OPEN (the engine running all the while): a visitor opens a room and
 * there is no [ SCREEN ] key; the site says "not available" and refuses a hello.
 * PART 2, a server started with SCREENS_DEV_OPEN=1 (the one local-proof exception, see app/lib/screens/host-server.ts):
 *   a. the room shows [ SCREEN ]; pressed, the browser's own receiver statistics say frames are being decoded
 *   b. [ SETTINGS ], MATCH THIS SCREEN off, 16:9 and 720: the decoded picture becomes 1280x720
 *   c. [ CONTROL ]: the pointer put on a known place of the picture and the letter A pressed arrive at the engine as
 *      the right pixel of the PC's screen and the right scan code (read from the engine's own GET /control-log), and
 *      the site itself never hears that key; Ctrl+Alt+Shift+Q lets go, and is never sent
 *   d. back to the room's ordinary picture: control is let go of and the connection is closed
 *
 *   e. (added with the engine's SOUND, CONTROLLER and POINTER SHAPE) on this PC the browser reaches the engine on its
 *      own machine, so SOUND is not offered and the panel warns; told to stand in for a device that is NOT the PC (the
 *      test-only mark a server opened for the drive honours, never a production one), [ SOUND ] makes Opus packets
 *      arrive with a level above nothing (the engine sends a test tone, DEBASER_PRETEND_TONE=1) and [ SOUND OFF ]
 *      stops them, the picture decoding all the while and nothing else on the page that plays being touched
 *   f. a made-up controller in the page reaches the engine's record with the right buttons and sticks only while
 *      control is held, and is set to nothing pressed and unplugged when control ends
 *   g. the picture's pointer takes the PC's (pretended) shape at the picture's scale while controlling, hides when
 *      the PC hides its own, and is left alone otherwise
 *   h. Esc typed to the PC reaches the engine's record and closes nothing of the site's that was open before
 *      control was taken (the room's queue window, and a listener on the whole window like the ones the site has)
 *
 * It never uses port 8478 (the engine that is live on this PC) and refuses to start when anything already answers
 * on its own ports. It stops only the engine it started itself (by that process, under engine\target).
 *
 * The statistics are the browser's own: the page's RTCPeerConnection is watched from outside the site's code.
 * Exit 0: every part passed. Exit 1: something failed. Exit 3: not run, because a League match is running on this PC.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'target', 'release', 'debaser-engine.exe');
const NEXT = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const SHOTS = path.join(ROOT, 'Temp', 'browse', 'screens');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PORT = Number(opt('--port', '3391'));
const ENGINE_PORT = Number(opt('--engine-port', '8491'));
const ONLY = opt('--only', null);
const BASE = `http://localhost:${PORT}`;
const ENGINE_AT = `http://127.0.0.1:${ENGINE_PORT}`;
const VIEW = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The engine that is live on this PC, serving the real site. Never used, never spoken to, never stopped. */
const LIVE_ENGINE_PORT = 8478;
/** The word in this file is the pointer the engine pretends the PC has (DEBASER_PRETEND_POINTER_FILE, as engine/bench/pointer-check.cjs does). */
const POINTER_FILE = path.join(os.tmpdir(), `debaser-drive-screens-pointer-${process.pid}`);
const MODES_FILE = path.join(os.tmpdir(), `debaser-drive-screens-modes-${process.pid}`);

/** Whether anything on this PC accepts a connection on that port. Nothing is sent to it. */
function answering(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (yes) => { socket.destroy(); resolve(yes); };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const results = [];
const pass = (what, seen) => {
  results.push({ ok: true, what, seen });
  console.log(`  ok    ${what}${seen ? `\n        ${seen}` : ''}`);
};

/** The owner plays League on this PC. While a match runs, nothing here is started. */
function leagueRunning() {
  try {
    return /League of Legends\.exe/i.test(execFileSync('tasklist', { encoding: 'utf8', windowsHide: true }));
  } catch {
    return false;
  }
}

async function waitFor(test, ms, every = 100) {
  const began = Date.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() - began > ms) return null;
    await sleep(every);
  }
}

/* --- what this script starts, and stops ---------------------------------------------------------- */

const started = [];
function stopTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  // The dev server has children of its own: the whole tree goes, and only ever one this script started.
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    child.kill();
  }
}
process.on('exit', () => started.forEach(stopTree));

async function startEngine() {
  const engineArgs = ['serve', '--allow-control', '--control-dry-run', '--allow-fit', '--tweaks', '76', '--port', String(ENGINE_PORT), '--seconds', '120', ...(process.env.DRIVE_ENGINE_INTERNET === '1' ? ['--internet'] : [])];
  // DRIVE_ENGINE_INTERNET=1: the engine as it runs for the site on another machine (full ICE, its outside address from STUN).
  fs.writeFileSync(POINTER_FILE, 'block\n');
  // FIT is a dry run: the engine pretends this monitor's modes (as engine/bench/fit-check.cjs does) and never makes a display call.
  fs.writeFileSync(MODES_FILE, ['3440x1440@180', '3440x1440@144', '2560x1440@144', '2560x1440@60', '1920x1080@144', '1920x1080@60'].join('\n') + '\n');
  // A steady test tone in place of the PC's sound, and a pretended pointer in place of the real one: both the engine's own test switches.
  const env = { ...process.env, DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '', DEBASER_PRETEND_STILL: '', DEBASER_PRETEND_TONE: '1', DEBASER_PRETEND_POINTER_FILE: POINTER_FILE, DEBASER_PRETEND_MODES: MODES_FILE };
  const child = spawn(ENGINE, engineArgs, { cwd: path.join(ROOT, 'engine'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  started.push(child);
  const engine = { child, text: '', began: Date.now() };
  child.stdout.on('data', (chunk) => { engine.text += chunk; });
  child.stderr.on('data', (chunk) => { engine.text += chunk; });
  const lines = () => engine.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ready = await waitFor(() => engine.text.includes('waiting for a viewer') || child.exitCode !== null, 10000, 50);
  if (!ready || child.exitCode !== null) throw new Error(`the engine did not start: ${lines().slice(-3).join(' | ') || 'it said nothing'}`);
  assert.ok(/dry run/i.test(engine.text), `the engine says it is a dry run (nothing reaches Windows): ${lines().join(' | ')}`);
  engine.stop = async () => {
    stopTree(child);
    await waitFor(() => child.exitCode !== null, 3000, 50);
  };
  engine.secondsLeft = () => 120 - (Date.now() - engine.began) / 1000;
  engine.settings = async () => (await fetch(`${ENGINE_AT}/settings`)).json();
  engine.log = async () => (await fetch(`${ENGINE_AT}/control-log`)).json();
  return engine;
}

/** The site's dev server on mock data, cut off from the live site, with or without the local-proof switch. */
async function startSite(devOpen, extraEnv = {}) {
  const switches = 'AQUARIUM BEATBOX BOOKS COMMS DOCS FORUM GAMES HISTORY LETTERS LORE MEDIA MUSIC NOTIFICATIONS PROFILE_CHARACTER PROFILE RECOMMENDATIONS WATCH WEB WINDOWS'.split(' ');
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_ENGINE_URL: ENGINE_AT, SCREENS_OWNER_ID: '', SCREENS_DEV_OPEN: devOpen ? '1' : '' };
  for (const name of switches) env[`NEXT_PUBLIC_${name}_DATA_SOURCE`] = 'mock';
  Object.assign(env, extraEnv);
  delete env.NODE_ENV;
  const child = spawn(process.execPath, [NEXT, 'dev', '-p', String(PORT)], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  started.push(child);
  const site = { child, text: '' };
  child.stdout.on('data', (chunk) => { site.text += chunk; });
  child.stderr.on('data', (chunk) => { site.text += chunk; });
  site.stop = async () => {
    stopTree(child);
    await waitFor(() => child.exitCode !== null, 5000, 100);
    await sleep(500);
  };
  // Ready when the routes answer (the first asking also builds them).
  const answered = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`the dev server stopped: ${site.text.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ')}`);
    try {
      return (await fetch(`${BASE}/api/screens/host`, { signal: AbortSignal.timeout(60000) })).status === 200;
    } catch {
      return false;
    }
  }, 180000, 500);
  if (!answered) throw new Error(`the dev server never answered on ${BASE}`);
  return site;
}

/* --- the page ------------------------------------------------------------------------------------ */

/** Run before the site's own scripts: a made-up account in the browser's mock store, and two instruments. */
const SEED = `(() => {
  try {
    const kept = JSON.parse(localStorage.getItem('debaser.auth.mock.v1') ?? '{"users":[],"bannedIds":[]}');
    if (!kept.sessionUserId) {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...kept, users: [...(kept.users ?? []).filter((held) => held.id !== user.id), user], sessionUserId: user.id }));
    }
  } catch {}
  // Every connection the page makes, kept in reach, so its statistics are read from the browser and not from the site's code.
  const Real = window.RTCPeerConnection;
  window.__connections = [];
  const Watched = function (...args) { const made = new Real(...args); window.__connections.push(made); return made; };
  Watched.prototype = Real.prototype;
  Object.setPrototypeOf(Watched, Real);
  window.RTCPeerConnection = Watched;
  // A made-up game controller the drive can connect and "press" (as engine/bench/control-check.cjs has): the page asks the
  // browser for its controllers in the ordinary way and is given this one, in the layout browsers call "standard".
  const pad = { id: 'Made-up controller for the drive (STANDARD GAMEPAD)', index: 0, connected: false, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__madeUpController = pad;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => (pad.connected ? [pad, null, null, null] : [null, null, null, null]) });
  // Everything else on the page that plays sound, and every time the page takes a copy of an element's sound to listen to it
  // (the room's sound graph and visualiser do): the PC's sound must touch none of it.
  window.__audios = [];
  const RealAudio = window.Audio;
  window.Audio = function (...args) { const made = new RealAudio(...args); window.__audios.push(made); return made; };
  window.Audio.prototype = RealAudio.prototype;
  window.__listens = 0;
  for (const name of ['createMediaStreamSource', 'createMediaElementSource']) {
    const make = AudioContext.prototype[name];
    AudioContext.prototype[name] = function (...args) { window.__listens += 1; return make.apply(this, args); };
  }
  const capture = HTMLMediaElement.prototype.captureStream;
  if (capture) HTMLMediaElement.prototype.captureStream = function (...args) { window.__listens += 1; return capture.apply(this, args); };
  // Every key press that reaches the page's own listeners (the site's shortcuts listen there or later).
  window.__keysHeard = [];
  document.addEventListener('keydown', (event) => window.__keysHeard.push(event.code));
  // Every press, click and wheel turn on the PC's picture that reaches the page (the room's own handlers sit between the two).
  window.__pressesHeard = [];
  for (const kind of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    document.addEventListener(kind, (event) => { if (event.target instanceof Element && event.target.closest('[data-screen-stage]')) window.__pressesHeard.push(kind); });
  }
})()`;

const receiver = (page) =>
  page.evaluate(async () => {
    const connection = window.__connections[window.__connections.length - 1];
    if (!connection) return { connections: 0, state: 'none', framesDecoded: 0 };
    const out = { connections: window.__connections.length, state: connection.connectionState, framesDecoded: 0, frameWidth: null, frameHeight: null, framesPerSecond: null, decoder: null, codec: null, sound: { packets: 0, lost: 0, level: null, energy: null, codec: null } };
    if (connection.connectionState === 'closed') return out;
    const report = await connection.getStats();
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') {
        out.sound = { packets: entry.packetsReceived ?? 0, lost: entry.packetsLost ?? 0, level: entry.audioLevel ?? null, energy: entry.totalAudioEnergy ?? null, codec: entry.codecId ? (report.get(entry.codecId) || {}).mimeType ?? null : null };
      }
      if (entry.type !== 'inbound-rtp' || entry.kind !== 'video') return;
      out.framesDecoded = entry.framesDecoded ?? 0;
      out.frameWidth = entry.frameWidth ?? null;
      out.frameHeight = entry.frameHeight ?? null;
      out.framesPerSecond = entry.framesPerSecond ?? null;
      out.decoder = entry.decoderImplementation ?? null;
      out.codec = entry.codecId ? (report.get(entry.codecId) || {}).mimeType ?? null : null;
    });
    return out;
  });

/** Opens the site and the made-up account's own room, private, with nothing playing. */
async function openRoom(page) {
  await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  // Headless Chrome reports no mouse until the first move, and the site would treat it as a phone.
  await page.mouse.move(300, 300);
  await page.waitForSelector('[data-cytube-go-live]', { timeout: 180000 });
  await sleep(1200);
  for (const words of ['NOT NOW', '[ KEEP THESE SETTINGS ]']) {
    const key = page.getByText(words, { exact: false });
    if (await key.count()) await key.first().click().catch(() => undefined);
  }
  const first = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if (await first.count()) await first.first().click().catch(() => undefined);
  const pictureShown = () => page.locator('[data-dock-window="stream"] [data-room-picture]').first().isVisible().catch(() => false);
  if (!(await pictureShown())) {
    // A room folded away after a reload comes back from its key on the shelf; otherwise GO LIVE opens it.
    const folded = page.locator('[data-room-shelf-key] button, [data-own-room-door] button');
    if (await folded.count()) await folded.first().click();
    else {
      await page.locator('[data-cytube-go-live]').click();
      // A first GO LIVE asks who can join in a window of its own; a room that exists opens with that question in its cog.
      const opened = await waitFor(async () => (await page.locator('[data-go-live-window], [data-dock-window="stream"]').count()) > 0, 60000);
      assert.ok(opened, 'GO LIVE opened something');
      if (await page.locator('[data-go-live-window]').count()) {
        await page.locator('[data-go-live-window] [data-room-privacy="private"]').click();
        await page.locator('[data-go-live-window] [data-go-live-start]').click();
      }
    }
  }
  await page.waitForSelector('[data-dock-window="stream"] [data-room-picture]', { timeout: 60000 });
  await sleep(1000);
  const join = page.locator('[data-dock-window="stream"]').getByRole('button', { name: '[ JOIN ]' });
  if (await join.count()) await join.first().click();
  // The room's cog (WHO CAN JOIN) is put away: the room stays private.
  if (await page.locator('[data-room-settings]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-room-settings]') === null, null, { timeout: 5000 }).catch(() => undefined);
  }
  await page.waitForSelector('[data-dock-window="stream"] [data-visualiser-toggle]', { timeout: 30000 });
}

/** Sets the made-up controller: connected or not, which buttons are down (the browser's numbers), the triggers (0 to 1), the sticks (-1 to 1). */
const setController = (page, state) =>
  page.evaluate((to) => {
    const one = window.__madeUpController;
    if ('connected' in to) one.connected = to.connected;
    const down = to.buttons || [];
    one.buttons.forEach((button, index) => {
      const value = index === 6 ? to.leftTrigger || 0 : index === 7 ? to.rightTrigger || 0 : down.includes(index) ? 1 : 0;
      button.value = value;
      button.pressed = value > 0;
    });
    one.axes = to.axes || [0, 0, 0, 0];
    one.timestamp = performance.now();
  }, state);

/** Everything on the page that plays, apart from the PC's own sound: each one's state, and how often the page has taken a copy of a sound to listen to. */
const otherPlayers = (page) =>
  page.evaluate(() => {
    const elements = [...document.querySelectorAll('audio, video')].filter((element) => element.closest('[data-room-screen]') === null);
    const say = (element) => `${element.tagName} ${element.paused ? 'paused' : 'playing'} volume ${element.volume} ${element.muted ? 'muted' : 'unmuted'} ${element.currentSrc ? 'with a source' : 'empty'}`;
    return { players: [...elements, ...window.__audios].map(say), listens: window.__listens, blank: document.querySelector('[data-watch-blank]')?.getAttribute('data-watch-blank') ?? null };
  });

/** The room's corner keys, each by its words (or by what it is read as, when it wears a drawn mark). */
const cornerKeys = (page) => page.locator('[data-room-corner-keys] button').evaluateAll((keys) => keys.map((key) => key.innerText.trim() || `(${key.getAttribute('aria-label')})`));

/** A picture of the room for looking at how it is dressed, with the PC's own screen left out of it. */
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const veil = await page.addStyleTag({ content: '[data-screen-stage] > * { visibility: hidden !important; }' });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await veil.evaluate((element) => element.remove());
}

async function newPage(browser, blocked, errors) {
  const context = await browser.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 });
  await context.addInitScript(SEED);
  // Nothing may reach the live database, wherever it lives.
  await context.route(/supabase\.(co|in)|api\.debaser\.site|debaser-site\.vercel\.app/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  // What the browser's console complains of is printed with --console (the dev server's own notices are among it).
  if (args.includes('--console')) page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') console.log(`        console ${message.type()}: ${message.text().slice(0, 400)}`); });
  return { context, page };
}

/* --- PART 1: a server started without the switch ------------------------------------------------- */

async function partClosed(browser) {
  console.log('\nPART 1: A SERVER STARTED WITHOUT SCREENS_DEV_OPEN');
  const blocked = [];
  const errors = [];
  let site = null;
  let engine = null;
  let context = null;
  try {
    site = await startSite(false);
    const first = await newPage(browser, blocked, errors);
    context = first.context;
    const page = first.page;
    // The room is opened once before the engine is started, so the dev server has built everything the room needs.
    await openRoom(page);
    engine = await startEngine();
    const there = await engine.settings();
    assert.equal(there.control, 'free', 'the engine is running and would allow control');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openRoom(page);
    await sleep(2500);
    const keys = await cornerKeys(page);
    assert.ok((await page.locator('[data-room-corner-keys] [data-visualiser-toggle]').count()) === 1, `the room's corner keys are there: ${keys.join(' ')}`);
    assert.equal(await page.locator('[data-screen-toggle]').count(), 0, 'no [ SCREEN ] key');
    assert.ok(!keys.some((text) => text.includes('SCREEN')), 'by its words either');
    pass('a visitor of a server started without SCREENS_DEV_OPEN sees no [ REMOTE ] key in a room', `the engine was running all the while (asked directly, it said control is "${there.control}"); the room's corner keys read: ${keys.join(' ')}`);

    const said = await page.evaluate(async () => {
      const host = await fetch('/api/screens/host', { cache: 'no-store' });
      const offer = await fetch('/api/screens/offer', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: 'v=0\r\n' });
      const settings = await fetch('/api/screens/settings', { cache: 'no-store' });
      return { host: `${host.status} ${await host.text()}`, offer: `${offer.status} ${await offer.text()}`, settings: `${settings.status} ${await settings.text()}` };
    });
    assert.equal(said.host, '200 {"available":false}', 'the site says "not available"');
    assert.ok(said.offer.startsWith('403 '), `a hello is refused: ${said.offer}`);
    assert.ok(said.settings.startsWith('403 '), `the settings are refused: ${said.settings}`);
    assert.equal((await engine.settings()).viewers, 0, 'and the engine has no viewer');
    pass('asked from that page, the site gives nothing away', `/api/screens/host: ${said.host}; a hello: ${said.offer}; the settings: ${said.settings}; the engine counts 0 viewers`);
    assert.deepEqual(blocked, [], 'nothing went to the live database');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (engine) await engine.stop();
    if (site) await site.stop();
  }
}

/* --- PART 2: a server opened for the drive ------------------------------------------------------- */

async function partOpen(browser) {
  console.log('\nPART 2: A SERVER STARTED WITH SCREENS_DEV_OPEN=1 (LOCAL PROOF ONLY), THE ENGINE IN ITS DRY RUN');
  const blocked = [];
  const errors = [];
  let site = null;
  let engine = null;
  let context = null;
  let page = null;
  try {
    site = await startSite(true);
    const first = await newPage(browser, blocked, errors);
    context = first.context;
    page = first.page;
    await openRoom(page);
    assert.equal(await page.locator('[data-screen-toggle]').count(), 0, 'with no engine running there is no [ REMOTE ] key, even here');
    pass('with the engine not running, the room has no [ REMOTE ] key (the site says "not available")');
    // The room's queue window is opened once before the engine is started, so the dev server has built it (part h needs it at once).
    await page.locator('[data-dock-window="stream"] [data-watch-queue-key]').first().click();
    await page.waitForSelector('#stream-queue-search', { timeout: 120000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 10000 });

    engine = await startEngine();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openRoom(page);
    const room = page.locator('[data-dock-window="stream"]');
    const toggle = room.locator('[data-screen-toggle]');

    // a. The key, and the picture.
    await toggle.waitFor({ timeout: 15000 });
    const keys = await cornerKeys(page);
    assert.equal((await toggle.innerText()).trim(), '[ REMOTE ]', 'the key reads [ REMOTE ]');
    assert.equal(await toggle.locator('img, svg').count(), 0, 'words only: no picture on the key');
    assert.equal((await receiver(page)).connections, 0, 'nothing is connected before the key is pressed');
    await toggle.click();
    // The list always opens now, even with THE PC alone (Luke, 2026-11-21); it says how to add another device.
    await page.waitForSelector('[data-remote-add-device]', { timeout: 5000 });
    await page.locator('[data-remote-choice="engine"]').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-room-picture] [data-room-screen]', { timeout: 10000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'the key says it is on');
    const flowing = await waitFor(async () => { const r = await receiver(page); return r.framesDecoded > 5 ? r : null; }, 20000);
    // Which way the picture goes, read from the connection (Luke, 2026-11-21): this browser is on the PC itself.
    const routeSaid = await waitFor(async () => (await page.locator('[data-screen-route]').count()) ? page.locator('[data-screen-route]').evaluate((el) => `${el.getAttribute('data-screen-route')} ${el.textContent}`) : null, 8000);
    assert.ok(routeSaid && routeSaid.startsWith('this-pc'), `the engine's route label: ${routeSaid}`);
    assert.ok(flowing, `frames are decoded: ${JSON.stringify(await receiver(page))}`);
    await sleep(1000);
    const later = await receiver(page);
    assert.ok(later.framesDecoded > flowing.framesDecoded, `and keep coming: ${flowing.framesDecoded} then ${later.framesDecoded}`);
    assert.equal(later.state, 'connected');
    const drawn = await page.locator('[data-room-screen]').getAttribute('data-screen-drawing');
    pass(
      "the room shows [ REMOTE ] beside VIS and CANVAS; pressed, the PC's screen is decoded in the room's picture",
      `corner keys: ${keys.join(' ')}; the browser's own receiver: ${flowing.framesDecoded} frames decoded, then ${later.framesDecoded} a second later, ${later.frameWidth}x${later.frameHeight}, ${later.codec}, decoder ${later.decoder}; drawn ${String(drawn).toUpperCase()}`,
    );

    // b. SETTINGS: 16:9 and 720.
    const settingsKey = page.locator('[data-screen-settings-key]');
    await settingsKey.click();
    await page.waitForSelector('[data-screen-panel]', { timeout: 5000 });
    assert.equal(await settingsKey.getAttribute('aria-expanded'), 'true', 'the SETTINGS key says it is open');
    const headings = await page.locator('[data-screen-panel] h3').allInnerTexts();
    assert.deepEqual(headings, ['PICTURE', 'DRAWING', 'UPSCALING', 'READOUT', 'WINDOW', 'SOUND', 'CONTROL', 'NOT BUILT YET'], "the panel has the engine page's sections");
    await shot(page, 'panel');
    const match = page.locator('[data-screen-match]');
    if ((await match.getAttribute('data-screen-match')) === 'on') await match.click();
    await page.waitForSelector('[data-screen-shape="16:9"]', { timeout: 5000 });
    await page.locator('[data-screen-shape="16:9"]').click();
    await page.locator('[data-screen-lines="720"]').click();
    const small = await waitFor(async () => { const r = await receiver(page); return r.frameWidth === 1280 && r.frameHeight === 720 ? r : null; }, 15000);
    assert.ok(small, `the decoded picture became 1280x720: ${JSON.stringify(await receiver(page))}`);
    await page.waitForFunction(() => /REALLY SENDING: 1280x720/.test(document.querySelector('[data-screen-really]')?.textContent ?? ''), null, { timeout: 8000 });
    const really = (await page.locator('[data-screen-really]').innerText()).split('\n')[0];
    assert.equal(await page.locator('[data-screen-shape="16:9"]').getAttribute('aria-pressed'), 'true', '16:9 is the pressed shape');
    assert.equal(await page.locator('[data-screen-lines="720"]').getAttribute('aria-pressed'), 'true', '720 is the pressed size');
    const sending = (await engine.settings()).sending;
    assert.deepEqual([sending.width, sending.height], [1280, 720], 'the engine itself says so too');
    pass('[ SETTINGS ], MATCH THIS SCREEN off, [ 16:9 ] and [ 720 ]: the decoded picture becomes 1280x720', `the browser's own receiver: ${small.frameWidth}x${small.frameHeight}; the panel: "${really}"; the engine: the screen's ${sending.regionWidth}x${sending.regionHeight} from ${sending.x},${sending.y}`);
    await settingsKey.click();
    await page.waitForFunction(() => document.querySelector('[data-screen-panel]') === null, null, { timeout: 5000 });

    // e. SOUND. This browser is on the PC, so it reaches the engine on its own machine: no key, and the warning.
    {
      const hostSound = async () => (await engine.settings()).sound;
      assert.ok((await hostSound()).allowed, `the engine sends sound: ${JSON.stringify(await hostSound())}`);
      await settingsKey.click();
      await page.waitForSelector('[data-screen-panel]', { timeout: 5000 });
      const pcItself = await page.waitForFunction(() => /this device is the PC itself/.test(document.querySelector('[data-screen-sound-state]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => null);
      if (!pcItself) {
        const path = await page.evaluate(async () => { const c = window.__connections[window.__connections.length - 1]; const r = await c.getStats(); const by = new Map(); r.forEach((e) => by.set(e.id, e)); let pair; by.forEach((e) => { if (e.type === 'transport' && e.selectedCandidatePairId) pair = by.get(e.selectedCandidatePairId); }); const l = pair && by.get(pair.localCandidateId); const f = pair && by.get(pair.remoteCandidateId); return { near: l && [l.candidateType, l.address, l.port], far: f && [f.candidateType, f.address, f.port], says: document.querySelector('[data-screen-sound-state]')?.textContent }; });
        assert.fail('on the PC itself, the panel should say so: ' + JSON.stringify(path));
      }
      const onPc = await page.locator('[data-screen-panel]').innerText();
      assert.ok(onPc.includes('ON THIS PC THE SOUND WOULD FEED BACK INTO ITSELF'), 'the panel warns');
      assert.equal(await page.locator('[data-screen-sound-key]').count(), 0, 'no [ SOUND ] key on the PC itself');
      assert.equal(await page.locator('[data-screen-sound-choice]').count(), 0, 'nor [ SOUND ON ] in the panel');
      assert.equal((await receiver(page)).sound.packets, 0, 'and no sound has arrived');
      assert.equal((await hostSound()).listeners, 0, 'the PC has no listener');
      pass('on the PC itself (the browser reached the engine on its own machine) SOUND is not offered, and the panel says why', `the panel: "${(await page.locator('[data-screen-sound-state]').innerText()).trim()}" and "ON THIS PC THE SOUND WOULD FEED BACK INTO ITSELF"; [ SOUND ] keys shown: 0; sound packets received: 0`);

      // TEST ONLY: this browser stands in for a device that is not the PC (a mark only a server opened for the drive honours).
      await page.evaluate(() => localStorage.setItem('debaser.screens.drive.not-this-pc', '1'));
      const soundKey = page.locator('[data-screen-sound-key]');
      await soundKey.waitFor({ timeout: 6000 });
      assert.equal((await soundKey.innerText()).trim(), '[ SOUND ]', 'the key reads [ SOUND ]');
      assert.equal(await soundKey.getAttribute('aria-pressed'), 'false', 'and is off');
      const keyRow = await page.locator('[data-screen-keys] button').evaluateAll((keys) => keys.map((key) => ({ text: key.innerText.trim(), top: Math.round(key.getBoundingClientRect().top), left: key.getBoundingClientRect().left, right: key.getBoundingClientRect().right })));
      const box = await page.locator('[data-room-screen]').boundingBox();
      assert.deepEqual(keyRow.map((key) => key.text), ['[ CONTROL ]', '[ SOUND ]', '[ SETTINGS ]'], 'the three keys, in order');
      assert.ok(keyRow.every((key) => key.top === keyRow[0].top && key.left >= box.x && key.right <= box.x + box.width), `the three keys sit on one line inside the picture's box (${Math.round(box.width)} wide): ${JSON.stringify(keyRow)}`);
      await shot(page, 'sound');
      const quiet = await otherPlayers(page);
      const framesBefore = (await receiver(page)).framesDecoded;
      await sleep(1200);
      assert.equal((await receiver(page)).sound.packets, 0, 'offered, but nothing travels until it is asked for');
      assert.equal((await hostSound()).capturing, false, 'and the PC is not reading its sound');

      await soundKey.click();
      const flowing = await waitFor(async () => { const r = await receiver(page); return r.sound.packets >= 150 && (r.sound.level > 0 || r.sound.energy > 0) ? r : null; }, 8000);
      assert.ok(flowing, `sound packets arrive, with a level: ${JSON.stringify((await receiver(page)).sound)}`);
      assert.equal(flowing.sound.codec, 'audio/opus', 'as Opus');
      const hostOn = (await waitFor(async () => { const h = await hostSound(); return h.heard ? h : null; }, 3000)) || (await hostSound());
      assert.deepEqual([hostOn.listeners, hostOn.capturing, hostOn.source, hostOn.heard], [1, true, 'a test tone', 'sound'], 'the PC says one listener, reading, a test tone, sound');
      assert.equal(await soundKey.getAttribute('aria-pressed'), 'true', 'the key says it is on');
      const element = await page.evaluate(() => { const audio = document.querySelector('[data-room-screen] audio'); return { paused: audio.paused, volume: audio.volume, tracks: audio.srcObject.getTracks().map((track) => track.kind), videoTracks: document.querySelector('[data-room-screen] video').srcObject.getTracks().map((track) => track.kind) }; });
      assert.deepEqual([element.paused, element.tracks, element.videoTracks], [false, ['audio'], ['video']], 'it plays in its own element, with the sound and the picture each in a stream of its own');
      await page.waitForFunction(() => /^ON\./.test(document.querySelector('[data-screen-sound-state]')?.textContent ?? '') && /\nSound /.test(document.querySelector('[data-screen-readout]')?.textContent ?? ''), null, { timeout: 6000 });
      const soundLine = (await page.locator('[data-screen-readout]').innerText()).split('\n').find((line) => line.startsWith('Sound'));
      // The volume is this device's own.
      await page.locator('[data-screen-volume]').focus();
      for (let presses = 0; presses < 30; presses += 1) await page.keyboard.press('ArrowLeft');
      const quieter = await page.evaluate(() => ({ volume: document.querySelector('[data-room-screen] audio').volume, kept: JSON.parse(localStorage.getItem('debaser.screens.viewer.v2')) }));
      assert.ok(Math.abs(quieter.volume - 0.7) < 0.011, `the volume range sets the element's own volume: ${quieter.volume}`);
      assert.deepEqual([quieter.kept.sound, Math.round(quieter.kept.volume * 100)], [true, 70], 'sound and volume are remembered on the device');
      const during = await receiver(page);
      assert.ok(during.framesDecoded > framesBefore && during.state === 'connected', 'the picture goes on decoding');
      const loud = await otherPlayers(page);
      assert.deepEqual([loud.players, loud.listens, loud.blank], [quiet.players, quiet.listens, quiet.blank], "nothing else that plays was touched, and the page took no copy of any sound to listen to (the room's sound graph is not fed)");
      pass(
        '[ SOUND ] (standing in for a device that is not the PC): Opus packets arrive with a level above nothing, in an element of their own, and nothing else on the page is touched',
        `the browser's own receiver: ${flowing.sound.packets} sound packets, ${flowing.sound.lost} lost, ${flowing.sound.codec}, level ${flowing.sound.level}, energy ${typeof flowing.sound.energy === 'number' ? flowing.sound.energy.toFixed(4) : flowing.sound.energy}; the PC: listeners ${hostOn.listeners}, reading ${hostOn.capturing}, source "${hostOn.source}", it heard "${hostOn.heard}"; the readout: "${soundLine}"; volume ${quieter.volume}; frames ${framesBefore} -> ${during.framesDecoded}; other players before and after: ${JSON.stringify(loud.players)}, copies of a sound taken ${quiet.listens} -> ${loud.listens}; keys: ${keyRow.map((key) => key.text).join(' ')} on one line`,
      );

      await page.locator('[data-screen-sound-choice="off"]').click();
      await sleep(600);
      const offA = await receiver(page);
      await sleep(1500);
      const offB = await receiver(page);
      const hostOff = (await waitFor(async () => { const h = await hostSound(); return !h.capturing && h.listeners === 0 ? h : null; }, 4000)) || (await hostSound());
      assert.equal(offB.sound.packets, offA.sound.packets, `no more sound packets arrive: ${offA.sound.packets} then ${offB.sound.packets}`);
      assert.deepEqual([hostOff.listeners, hostOff.capturing], [0, false], 'the PC has no listener and has stopped reading its sound');
      assert.ok(offB.framesDecoded > offA.framesDecoded, 'the picture still decodes');
      assert.equal(await page.evaluate(() => document.querySelector('[data-room-screen] audio').paused), true, 'the element is paused');
      assert.ok((await page.locator('[data-screen-sound-state]').innerText()).startsWith('OFF.'), 'the panel says OFF');
      pass('[ SOUND OFF ] stops it: no more packets, the PC stops reading its sound, the picture goes on', `sound packets ${offA.sound.packets} then ${offB.sound.packets} a second and a half later; the PC: listeners ${hostOff.listeners}, reading ${hostOff.capturing}; frames ${offA.framesDecoded} -> ${offB.framesDecoded}`);
      await settingsKey.click();
      await page.waitForFunction(() => document.querySelector('[data-screen-panel]') === null, null, { timeout: 5000 });
    }

    // c. CONTROL: the pointer and a letter.
    const controlKey = page.locator('[data-screen-control-key]');
    assert.equal((await controlKey.innerText()).trim(), '[ CONTROL ]', 'the engine allows control, so the key is there');
    await controlKey.click();
    await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
    assert.equal((await controlKey.innerText()).trim(), '[ RELEASE ]', 'holding control, the key reads [ RELEASE ]');
    await sleep(300);
    // Where the picture is: worked out here, from the picture's box on the page and the picture's own size (fitted inside, in the middle).
    const stage = await page.locator('[data-screen-stage]').boundingBox();
    const fit = Math.min(stage.width / 1280, stage.height / 720);
    const picture = { left: stage.x + (stage.width - 1280 * fit) / 2, top: stage.y + (stage.height - 720 * fit) / 2, width: 1280 * fit, height: 720 * fit };
    const [fx, fy] = [0.25, 0.6];
    const mark = (await engine.log()).everLogged;
    await page.mouse.move(picture.left + fx * picture.width, picture.top + fy * picture.height);
    const moved = await waitFor(async () => (await engine.log()).entries.filter((entry) => entry.n > mark && entry.what === 'pointer').pop() ?? null, 3000);
    const want = { x: sending.x + fx * sending.regionWidth, y: sending.y + fy * sending.regionHeight };
    assert.ok(moved, 'the engine heard the pointer');
    assert.ok(Math.abs(moved.x - want.x) <= 2 && Math.abs(moved.y - want.y) <= 2, `the pointer lands on the right pixel: wanted ${want.x.toFixed(0)},${want.y.toFixed(0)}, the engine would move to ${moved.x},${moved.y}`);

    const heardBefore = await page.evaluate(() => window.__keysHeard.length);
    const keyMark = (await engine.log()).everLogged;
    await page.keyboard.down('KeyA');
    await page.keyboard.up('KeyA');
    const typed = await waitFor(async () => { const list = (await engine.log()).entries.filter((entry) => entry.n > keyMark && entry.what === 'key'); return list.length >= 2 ? list : null; }, 3000);
    assert.ok(typed, 'the engine heard the key');
    assert.deepEqual(typed.map((entry) => `${entry.code} ${entry.scan} ${entry.down ? 'down' : 'up'}`), ['KeyA 30 down', 'KeyA 30 up'], 'the letter A arrives as scan code 30, down then up');
    const heardBy = await page.evaluate((from) => window.__keysHeard.slice(from), heardBefore);
    assert.deepEqual(heardBy, [], 'and the site itself never heard that key');
    const dry = await engine.log();
    assert.equal(dry.dryRun, true, 'a dry run: nothing reached Windows');
    pass(
      '[ CONTROL ]: the pointer and the letter A reach the engine as the right screen pixel and scan code, and the site does not hear the key',
      `pointer at ${fx * 100}% across and ${fy * 100}% down the picture: wanted screen pixel ${want.x.toFixed(0)},${want.y.toFixed(0)}, the engine would move to ${moved.x},${moved.y}; the engine would press: ${typed.map((entry) => `${entry.code} scan ${entry.scan} ${entry.down ? 'down' : 'up'}`).join(', ')}; keys the site's own listeners heard meanwhile: ${heardBy.length}; dry run: ${dry.dryRun}`,
    );
    await shot(page, 'controlling');

    // Presses and the wheel on the picture are the PC's too: the room and the site never get them.
    {
      const pressesBefore = await page.evaluate(() => window.__pressesHeard.length);
      const pressMark = (await engine.log()).everLogged;
      const [x, y] = [picture.left + 0.5 * picture.width, picture.top + 0.5 * picture.height];
      await page.mouse.click(x, y);
      await page.mouse.click(x, y, { button: 'right' });
      await page.mouse.dblclick(x, y);
      await page.mouse.wheel(0, 100);
      const sent = await waitFor(async () => { const list = (await engine.log()).entries.filter((entry) => entry.n > pressMark && (entry.what === 'button' || entry.what === 'wheel')); return list.length >= 9 ? list : null; }, 3000);
      assert.ok(sent, `the engine heard the presses: ${JSON.stringify((await engine.log()).entries.filter((entry) => entry.n > pressMark && entry.what !== 'pointer'))}`);
      const lines = sent.map((entry) => (entry.what === 'wheel' ? `wheel ${entry.dy}` : `${entry.button} ${entry.down ? 'down' : 'up'}`));
      assert.deepEqual(lines, ['left down', 'left up', 'right down', 'right up', 'left down', 'left up', 'left down', 'left up', 'wheel -120'], 'a click, a right click, a double click and one notch of the wheel, in order');
      const heardPresses = await page.evaluate((from) => window.__pressesHeard.slice(from), pressesBefore);
      assert.deepEqual(heardPresses, [], 'none of them reached the page beyond the picture');
      assert.equal(await page.evaluate(() => document.fullscreenElement === null), true, 'and nothing went fullscreen');
      pass('presses and the wheel on the picture go to the PC and stop there: the room and the site never hear them', `the engine would do: ${lines.join(', ')}; presses the page's own listeners heard meanwhile: ${heardPresses.length}`);
    }

    // The pointer again, for each way this device can draw the picture and fit it to its box (only on this device: the
    // PC sends the same 1280x720). OFF shows it at its real size, larger than this box, its middle in the box's middle.
    {
      const lines = [];
      const panel = async (open) => {
        if ((await page.locator('[data-screen-panel]').count() > 0) !== open) await settingsKey.click();
      };
      for (const way of ['normal', 'fast']) {
        for (const fitting of ['off', 'sharp', 'sharpened', 'smooth']) {
          await panel(true);
          await page.locator(`[data-screen-drawing-key="${way}"]`).click();
          await page.locator(`[data-screen-upscaling="${fitting}"]`).click();
          await panel(false);
          await sleep(350);
          const shown = await page.locator('[data-room-screen]').evaluate((element) => `${element.getAttribute('data-screen-drawing')} ${element.getAttribute('data-screen-pc-fit')}`);
          const places = fitting === 'off'
            ? [[stage.x + stage.width / 2, stage.y + stage.height / 2, 0.5, 0.5], [stage.x + stage.width / 2 - 128, stage.y + stage.height / 2 + 72, 0.4, 0.6]]
            : [[picture.left + 0.25 * picture.width, picture.top + 0.6 * picture.height, 0.25, 0.6], [picture.left + 0.5 * picture.width, picture.top + 0.9 * picture.height, 0.5, 0.9]];
          const seen = [];
          for (const [x, y, px, py] of places) {
            const from = (await engine.log()).everLogged;
            // A nudge first, so that a place the pointer is already at is still a move.
            await page.mouse.move(x + 3, y + 3);
            await page.mouse.move(x, y);
            const wanted = { x: sending.x + px * sending.regionWidth, y: sending.y + py * sending.regionHeight };
            const near = (entry) => Math.abs(entry.x - wanted.x) <= 3 && Math.abs(entry.y - wanted.y) <= 3;
            // The newest place the engine was told of, once it has settled (given a moment to arrive).
            let at = null;
            await waitFor(async () => { at = (await engine.log()).entries.filter((entry) => entry.n > from && entry.what === 'pointer').pop() ?? null; return at !== null && near(at); }, 1500, 60);
            assert.ok(at, `drawn ${shown}: the engine heard the pointer`);
            assert.ok(near(at), `drawn ${shown}: wanted screen pixel ${wanted.x.toFixed(0)},${wanted.y.toFixed(0)}, the engine would move to ${at.x},${at.y}`);
            seen.push(`${wanted.x.toFixed(0)},${wanted.y.toFixed(0)} -> ${at.x},${at.y}`);
          }
          lines.push(`${shown === `${way} ${fitting}` ? '' : `(asked ${way} ${fitting}) `}${shown.toUpperCase()}: ${seen.join('; ')}`);
        }
      }
      pass('the pointer lands on the right pixel however this device draws the picture (NORMAL and FAST; OFF, SHARP, SHARPENED, SMOOTH)', lines.join('\n        '));
      // Back on the picture, which takes the keyboard again with a press on it.
      assert.equal(await controlKey.getAttribute('data-screen-control-key'), 'mine', 'control was held throughout');
      await page.mouse.click(picture.left + 0.3 * picture.width, picture.top + 0.5 * picture.height);
      await sleep(200);
    }

    // The way out on this device: Ctrl+Alt+Shift+Q, never sent.
    const chordMark = (await engine.log()).everLogged;
    for (const code of ['ControlLeft', 'AltLeft', 'ShiftLeft', 'KeyQ']) await page.keyboard.down(code);
    const ended = await waitFor(async () => (await engine.log()).entries.find((entry) => entry.n > chordMark && entry.what === 'ended') ?? null, 3000);
    for (const code of ['KeyQ', 'ShiftLeft', 'AltLeft', 'ControlLeft']) await page.keyboard.up(code);
    assert.ok(ended, 'control ended at the engine');
    await page.waitForSelector('[data-screen-control-key="free"]', { timeout: 5000 });
    const chord = (await engine.log()).entries.filter((entry) => entry.n > chordMark && entry.what === 'key').map((entry) => `${entry.code} ${entry.down ? 'down' : 'up'}`);
    assert.ok(!chord.some((line) => line.startsWith('KeyQ')), `Q itself is never sent: ${chord.join(', ')}`);
    assert.deepEqual(chord, ['ControlLeft down', 'AltLeft down', 'ShiftLeft down', 'ShiftLeft up', 'AltLeft up', 'ControlLeft up'], 'and what was held is let go');
    // Let go, a key belongs to the site again and not to the PC.
    const afterMark = (await engine.log()).everLogged;
    const heardThen = await page.evaluate(() => window.__keysHeard.length);
    await page.keyboard.press('F9');
    await sleep(400);
    assert.deepEqual(await page.evaluate((from) => window.__keysHeard.slice(from), heardThen), ['F9'], 'after letting go the site hears keys again');
    assert.equal((await engine.log()).entries.filter((entry) => entry.n > afterMark && entry.what === 'key').length, 0, 'and the engine does not');
    const pressesThen = await page.evaluate(() => window.__pressesHeard.length);
    await page.mouse.click(picture.left + 0.5 * picture.width, picture.top + 0.5 * picture.height);
    await sleep(300);
    assert.ok((await page.evaluate((from) => window.__pressesHeard.slice(from), pressesThen)).includes('click'), 'and a press on the picture is the page\'s again');
    assert.equal((await engine.log()).entries.filter((entry) => entry.n > afterMark).length, 0, 'of which the engine hears nothing at all');
    pass('Ctrl+Alt+Shift+Q lets go of control: Q is never sent, what was held is let go, and keys belong to the site again', `the engine was sent: ${chord.join(', ')}; then "ended: ${ended.why}"`);

    // f. CONTROLLER: a made-up one, pressed before control is held (nothing may reach the PC), then while it is.
    {
      const padEntries = async (after) => (await engine.log()).entries.filter((entry) => entry.n > after && (entry.what === 'pad' || entry.what === 'controller' || entry.what === 'ended'));
      const before = (await engine.log()).everLogged;
      await setController(page, { connected: true, buttons: [0, 3], rightTrigger: 1, axes: [1, 1, 0, 0] });
      await sleep(700);
      assert.deepEqual(await padEntries(before), [], 'a controller pressed while this device does not hold control reaches nothing');
      await setController(page, { connected: true });
      await controlKey.click();
      await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
      const plugged = await waitFor(async () => ((await padEntries(before)).some((entry) => entry.what === 'controller' && entry.event === 'plugged in') ? true : null), 3000);
      assert.ok(plugged, `control given: the PC plugs its pretend controller in: ${JSON.stringify(await padEntries(before))}`);
      const pressMark = (await engine.log()).everLogged;
      await setController(page, { connected: true, buttons: [5, 0], rightTrigger: 0.5, axes: [-1, -1, 0, 0] });
      const pressed = await waitFor(async () => (await padEntries(pressMark)).filter((entry) => entry.what === 'pad' && entry.buttons !== 0).pop() ?? null, 3000);
      assert.ok(pressed, 'the state reached the engine');
      assert.deepEqual([pressed.buttons, pressed.pressed, pressed.leftTrigger, pressed.rightTrigger, pressed.leftX, pressed.leftY, pressed.rightX, pressed.rightY], [4608, 'RB A', 0, 128, -32767, 32767, 0, 0], 'RB and A, the right trigger half way, the left stick hard left and UP');
      await setController(page, { connected: true, buttons: [12, 9], leftTrigger: 1, axes: [0, 0, 0.5, 1] });
      const second = await waitFor(async () => (await padEntries(pressMark)).filter((entry) => entry.what === 'pad' && entry.leftTrigger === 255).pop() ?? null, 3000);
      assert.ok(second, 'a second state reached the engine');
      assert.deepEqual([second.buttons, second.rightX, second.rightY], [0x0011, 16384, -32767], 'UP and START (bits 0001 and 0010), the right stick half right and hard DOWN');
      await settingsKey.click();
      await page.waitForFunction(() => /IT IS DRIVING A PRETEND XBOX 360 CONTROLLER ON THE PC/.test(document.querySelector('[data-screen-pad]')?.textContent ?? ''), null, { timeout: 5000 });
      const padLine = (await page.locator('[data-screen-pad]').innerText()).replace(/\n/g, ' / ');
      assert.ok(!(await page.locator('[data-screen-panel]').innerText()).includes('A controller (gamepad) from this device'), 'the controller is no longer listed as not built');
      await settingsKey.click();
      await page.waitForFunction(() => document.querySelector('[data-screen-panel]') === null, null, { timeout: 5000 });

      // g. THE PC'S POINTER: this device's pointer over the picture takes the PC's (pretended) shape, at the picture's scale.
      const cursorNow = () => page.evaluate(() => document.querySelector('[data-screen-stage]').style.cursor);
      const scale = picture.width / sending.regionWidth;
      const want = { width: Math.max(1, Math.round(24 * scale)), height: Math.max(1, Math.round(32 * scale)), hotX: 0, hotY: 0 };
      want.hotX = Math.min(want.width - 1, Math.round(3 * scale));
      want.hotY = Math.min(want.height - 1, Math.round(5 * scale));
      const shaped = await waitFor(async () => { const css = await cursorNow(); return css.startsWith('url(') ? css : null; }, 5000);
      assert.ok(shaped, `while controlling in POINTER mode the picture's pointer is a picture: "${(await cursorNow()).slice(0, 60)}"`);
      const drawn = await page.evaluate(async (css) => { const address = /url\(["']?(data:image\/png;base64,[^"')]+)/.exec(css)[1]; const image = new Image(); image.src = address; await image.decode(); const hot = /\)\s+(\d+)\s+(\d+)\s*,\s*default$/.exec(css); return { width: image.naturalWidth, height: image.naturalHeight, hotX: Number(hot[1]), hotY: Number(hot[2]) }; }, shaped);
      assert.deepEqual(drawn, want, `the PC's 24 by 32 pointer at the picture's scale (${scale.toFixed(4)})`);
      fs.writeFileSync(POINTER_FILE, 'hidden\n');
      const hidden = await waitFor(async () => ((await cursorNow()) === 'none' ? true : null), 5000);
      assert.ok(hidden, `the PC hides its pointer: this device's pointer over the picture hides too ("${(await cursorNow()).slice(0, 40)}")`);
      fs.writeFileSync(POINTER_FILE, 'block\n');
      assert.ok(await waitFor(async () => ((await cursorNow()).startsWith('url(') ? true : null), 5000), 'and comes back with it');

      // Control ends (the key): the PC sets its pretend controller to nothing pressed and unplugs it; the pointer is left alone again.
      const endMark = (await engine.log()).everLogged;
      await controlKey.click();
      await page.waitForSelector('[data-screen-control-key="free"]', { timeout: 5000 });
      const ending = await waitFor(async () => { const list = await padEntries(endMark); return list.some((entry) => entry.what === 'ended') ? list : null; }, 4000);
      assert.ok(ending, 'control ended at the engine');
      const tail = ending.slice(-3).map((entry) => (entry.what === 'pad' ? `pad buttons ${entry.buttons} triggers ${entry.leftTrigger},${entry.rightTrigger} sticks ${entry.leftX},${entry.leftY},${entry.rightX},${entry.rightY}` : entry.what === 'controller' ? `controller ${entry.event}` : `ended: ${entry.why}`));
      assert.deepEqual(tail, ['pad buttons 0 triggers 0,0 sticks 0,0,0,0', 'controller unplugged', 'ended: the viewer let go'], 'nothing pressed, then unplugged, then control ends');
      assert.equal(await cursorNow(), '', "not controlling, the picture's pointer is the site's own again");
      const afterEnd = (await engine.log()).everLogged;
      await setController(page, { connected: true, buttons: [1], axes: [1, 0, 0, 0] });
      await sleep(600);
      assert.deepEqual(await padEntries(afterEnd), [], 'and a controller pressed after control ended reaches nothing');
      await setController(page, { connected: false });
      pass(
        'CONTROLLER: a made-up controller reaches the engine with the right buttons and sticks only while control is held, and ends neutral and unplugged',
        `pressed before control: 0 entries; with control: "controller plugged in", then buttons ${pressed.buttons} (${pressed.pressed}), triggers ${pressed.leftTrigger},${pressed.rightTrigger}, left stick ${pressed.leftX},${pressed.leftY}; then buttons ${second.buttons} (${second.pressed}), right stick ${second.rightX},${second.rightY}; the panel: "${padLine}"; on release: ${tail.join(', ')}; pressed after: 0 entries`,
      );
      pass(
        "POINTER SHAPE: while controlling, the picture's pointer is the PC's own shape at the picture's scale, hides when the PC hides its pointer, and is left alone otherwise",
        `the PC's pretended 24 by 32 pointer (hot spot 3,5) on a picture ${picture.width.toFixed(0)} page pixels wide showing ${sending.regionWidth} of the PC's: drawn ${drawn.width} by ${drawn.height}, hot spot ${drawn.hotX},${drawn.hotY} (wanted ${want.width} by ${want.height}, ${want.hotX},${want.hotY}); hidden on the PC: "cursor: none"; after control: "${await cursorNow()}" (the site's own)`,
      );
    }

    // h. Esc typed to the PC closes nothing of the site's that was open before control was taken.
    {
      await page.locator('[data-dock-window="stream"] [data-watch-queue-key]').first().click();
      await page.waitForSelector('#stream-queue-search', { timeout: 30000 });
      // A listener on the whole window, added before control is taken, as the site's own windows add theirs.
      await page.evaluate(() => { window.__escEarly = 0; window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.__escEarly += 1; }, true); });
      // The queue's window covers the page, so control is taken without a press of the mouse (which would close it).
      await page.evaluate(() => document.querySelector('[data-screen-control-key]').click());
      await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
      await sleep(300);
      const escMark = (await engine.log()).everLogged;
      await page.keyboard.press('Escape');
      const esc = await waitFor(async () => { const list = (await engine.log()).entries.filter((entry) => entry.n > escMark && entry.what === 'key'); return list.length >= 2 ? list : null; }, 3000);
      assert.ok(esc, 'the engine heard Esc');
      assert.deepEqual(esc.map((entry) => `${entry.code} ${entry.scan} ${entry.down ? 'down' : 'up'}`), ['Escape 1 down', 'Escape 1 up'], 'Esc arrives as scan code 1, down then up');
      await sleep(400);
      assert.equal(await page.locator('#stream-queue-search').count(), 1, "the room's queue window is still open");
      assert.equal(await page.evaluate(() => window.__escEarly), 0, 'and a listener on the whole window, added before control, heard nothing');
      // Let go (the chord works from anywhere): now Esc is the site's again, and closes the queue.
      for (const code of ['ControlLeft', 'AltLeft', 'ShiftLeft', 'KeyQ']) await page.keyboard.down(code);
      for (const code of ['KeyQ', 'ShiftLeft', 'AltLeft', 'ControlLeft']) await page.keyboard.up(code);
      await page.waitForSelector('[data-screen-control-key="free"]', { timeout: 5000 });
      const afterMark = (await engine.log()).everLogged;
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#stream-queue-search') === null, null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.__escEarly), 1, 'the same listener hears Esc once control is let go');
      assert.equal((await engine.log()).entries.filter((entry) => entry.n > afterMark && entry.what === 'key').length, 0, 'and the engine does not');
      pass("Esc typed to the PC reaches the engine and closes nothing of the site's opened before control; let go, Esc closes the room's queue window again", `the engine would press: ${esc.map((entry) => `${entry.code} scan ${entry.scan} ${entry.down ? 'down' : 'up'}`).join(', ')}; the queue window stayed open; a whole-window Esc listener added before control heard 0, then 1 after control was let go`);
    }

    // i. The easier way out (Luke, 2026-11-21): the bar under the keys while controlling, its [ RELEASE ],
    //    and holding Esc for a second. A quick Esc stays the PC's (part h).
    {
      await controlKey.click({ timeout: 5000 });
      await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
      const bar = page.locator('[data-screen-control-bar]');
      assert.equal(await bar.count(), 1, 'a bar under the keys while controlling');
      const barSays = (await page.locator('[data-screen-control-bar-says]').innerText()).trim();
      assert.ok(barSays.includes('HOLD ESC TO LET GO'), `the bar says how to let go: "${barSays}"`);
      // Its own [ RELEASE ]. If something of the room's lies over it, say what, rather than time out.
      const onTop = await page.evaluate(() => {
        const key = document.querySelector('[data-screen-control-bar-release]');
        const box = key.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { box: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)], mine: top === key || key.contains(top), top: top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}.${String(top.className).slice(0, 80)}` : 'nothing' };
      });
      assert.ok(onTop.mine, `the bar's [ RELEASE ] can be pressed: at ${onTop.box.join(',')} the top thing is ${onTop.top}`);
      await page.locator('[data-screen-control-bar-release]').click({ timeout: 5000 });
      await page.waitForSelector('[data-screen-control-key="free"]', { timeout: 5000 });
      assert.equal(await bar.count(), 0, 'and it goes when control is let go');
      // Holding Esc.
      await controlKey.click();
      await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
      await page.locator('[data-room-screen] video, [data-room-screen] canvas').first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
      await sleep(300);
      const holdMark = (await engine.log()).everLogged;
      await page.keyboard.down('Escape');
      await sleep(300);
      const holding = (await page.locator('[data-screen-control-bar-says]').innerText().catch(() => '')).trim();
      await sleep(1100);
      const stillMine = await controlKey.getAttribute('data-screen-control-key');
      await page.keyboard.up('Escape');
      await page.waitForSelector('[data-screen-control-key="free"]', { timeout: 3000 });
      const heard = (await engine.log()).entries.filter((entry) => entry.n > holdMark && entry.what === 'key').map((entry) => `${entry.code} ${entry.down ? 'down' : 'up'}`);
      const ended = (await engine.log()).entries.find((entry) => entry.n > holdMark && entry.what === 'ended');
      assert.equal(holding, 'KEEP HOLDING ESC TO LET GO', `while Esc is held the bar says so: "${holding}"`);
      assert.equal(stillMine, 'free', 'held for a second, control was let go before Esc came up');
      assert.ok(ended, 'the engine heard control end');
      assert.ok(heard.filter((line) => line === 'Escape down').length <= 1, `the PC saw at most one Esc press, not its repeats: ${heard.join(', ')}`);
      pass('the way out is in sight: a bar under the keys with [ RELEASE ], and holding Esc for a second lets go', `the bar said "${barSays}"; its [ RELEASE ] let go; with Esc held it said "${holding}", and control was let go (engine: "ended: ${ended.why ?? ended.reason ?? 'yes'}"); the PC saw ${heard.join(', ') || 'no key'}`);
    }

    // j. FIT THE PC TO THIS SCREEN (Luke, 2026-11-21): a separate switch, off at first; a dry run here (the engine
    //    pretends the monitor's modes and never changes the screen). This browser's screen is 16:9, so the PC's
    //    pretended 3440x1440 is fitted to 2560x1440, and given back when the switch goes off.
    {
      if (!(await page.locator('[data-screen-panel]').count())) await page.locator('[data-screen-settings-key]').click();
      const fitKey = page.locator('[data-screen-pc-fit]');
      await fitKey.waitFor({ timeout: 8000 });
      assert.equal(await fitKey.getAttribute('data-screen-pc-fit'), 'off', 'the FIT switch starts off');
      const startSays = (await page.locator('[data-screen-pc-fit-says]').innerText()).trim();
      await fitKey.click();
      const fitted = await waitFor(async () => { const s = await engine.settings(); return s.pcScreen && s.pcScreen.fitted ? s : null; }, 8000);
      assert.ok(fitted, `the PC (pretended) is fitted: ${JSON.stringify((await engine.settings()).pcScreen)}`);
      assert.equal(`${fitted.pcScreen.now.width}x${fitted.pcScreen.now.height}`, '2560x1440', 'to the 16:9 mode nearest this screen');
      assert.ok(fitted.pcScreen.pretended, 'and only pretended: no display call was made');
      const fittedSays = await waitFor(async () => { const t = (await page.locator('[data-screen-pc-fit-says]').innerText()).trim(); return t.startsWith("THE PC'S SCREEN IS NOW 2560x1440") ? t : null; }, 6000);
      assert.ok(fittedSays, 'the switch says what the PC now is');
      await fitKey.click();
      const back = await waitFor(async () => { const s = await engine.settings(); return s.pcScreen && !s.pcScreen.fitted ? s : null; }, 8000);
      assert.ok(back, 'pressed again, the PC gets its own screen back');
      assert.equal(await fitKey.getAttribute('data-screen-pc-fit'), 'off', 'and the switch reads off');
      pass("[ FIT THE PC TO THIS SCREEN ] is its own switch, off at first; on, the PC (pretended) changes to this screen's shape, off gives it back", `at first: "${startSays}"; on: "${fittedSays}"; off: the PC's own ${back.pcScreen.now.width}x${back.pcScreen.now.height} again`);
      await page.keyboard.press('Escape');
    }

    // d. Back to the room's ordinary picture, while holding control.
    await controlKey.click();
    await page.waitForSelector('[data-screen-control-key="mine"]', { timeout: 5000 });
    const backMark = (await engine.log()).everLogged;
    const before = await receiver(page);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-room-screen]') === null, null, { timeout: 5000 });
    const closed = await waitFor(async () => { const r = await receiver(page); return r.state === 'closed' ? r : null; }, 5000);
    assert.ok(closed, `the connection is closed: ${JSON.stringify(await receiver(page))}`);
    const letGo = await waitFor(async () => (await engine.log()).entries.find((entry) => entry.n > backMark && entry.what === 'ended') ?? null, 5000);
    assert.ok(letGo, 'the engine was told control is let go of');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'the key is off again');
    const roomShows = await page.evaluate(() => (document.querySelector('[data-room-canvas="shown"]') ? 'its canvas' : document.querySelector('[data-watch-blank="shown"]') ? 'its own empty screen' : 'its own picture'));
    const gone = await waitFor(async () => ((await engine.settings()).viewers === 0 ? true : null), 8000, 250);
    pass(
      '[ REMOTE ] pressed again: back to the room\'s own picture, control let go of, the connection closed',
      `the room shows ${roomShows}; the browser's connection went from "${before.state}" to "${closed.state}" (${closed.connections} made in all); the engine: "ended: ${letGo.why}", holder ${(await engine.log()).holder}, viewers ${gone ? 0 : (await engine.settings()).viewers}`,
    );

    // k. REMOTE from another of the owner's devices, nothing installed (Luke, 2026-11-21: "a selection option of which
    //    signed in device to stream from when you click remote"). A second browser stands for the other device: it
    //    has the site open; REMOTE lists it beside THE PC; chosen, it is asked, somebody there presses SHARE (this
    //    browser picks its screen by itself: a switch of the drive's), and the room shows its picture, watch only.
    {
      const second = await newPage(browser, blocked, errors);
      try {
        await second.page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const listed = await waitFor(async () => {
          if ((await page.locator('[data-remote-choices]').count()) === 0) await toggle.click();
          return (await page.locator('[data-remote-choice]').count()) >= 2 ? true : null;
        }, 20000, 1500);
        assert.ok(listed, 'pressed, REMOTE lists the devices to choose from');
        const choices = await page.locator('[data-remote-choice]').evaluateAll((keys) => keys.map((k) => ({ id: k.getAttribute('data-remote-choice'), text: k.textContent.trim() })));
        const pcChoice = choices.find((c) => c.id === 'engine');
        const deviceChoice = choices.find((c) => c.id !== 'engine');
        assert.ok(pcChoice && deviceChoice, `THE PC and the other device are both listed: ${JSON.stringify(choices)}`);
        await page.locator(`[data-remote-choice="${deviceChoice.id}"]`).click({ timeout: 5000 });
        await second.page.waitForSelector('[data-device-share-asks]', { timeout: 10000 });
        const asks = (await second.page.locator('[data-device-share-asks]').innerText()).trim();
        const waiting = (await page.locator('[data-room-device-says]').innerText()).trim();
        const yesOnTop = await second.page.evaluate(() => {
          const key = document.querySelector('[data-device-share-yes]');
          const box = key.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { box: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)], mine: top === key || key.contains(top), top: top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 90)} ${[...top.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).join(',')}` : 'nothing' };
        });
        assert.ok(yesOnTop.mine, `[ SHARE THIS SCREEN ] can be pressed: at ${yesOnTop.box.join(',')} the top thing is ${yesOnTop.top}`);
        await second.page.locator('[data-device-share-yes]').click({ timeout: 5000 });
        const shown = await waitFor(async () => ((await page.locator('[data-room-device-screen="showing"]').count()) === 1 ? true : null), 15000);
        if (!shown) {
          const roomSays = await page.locator('[data-room-device-says]').innerText().catch(() => '(nothing)');
          const otherSays = await second.page.locator('[data-device-share]').innerText().catch(() => '(nothing)');
          throw new Error(`the other device's picture did not come: the room says "${roomSays.trim()}"; the other device shows "${otherSays.replace(/\s+/g, ' ').trim()}"`);
        }
        const frames = await waitFor(async () => {
          const size = await page.evaluate(() => { const v = document.querySelector('[data-room-device-screen] video'); return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null; });
          return size && size.w > 0 && size.t > 0.3 ? size : null;
        }, 10000);
        assert.ok(frames, "the other device's screen is playing in the room");
        const showing = (await page.locator('[data-room-device-says]').innerText()).trim();
        assert.equal(await second.page.locator('[data-device-sharing]').count(), 1, 'the other device says it is sharing, with STOP');
        await second.page.locator('[data-device-share-stop]').click();
        const ended = await waitFor(async () => { const t = (await page.locator('[data-room-device-says]').innerText()).trim(); return t.includes('STOPPED SHARING') ? t : null; }, 10000);
        assert.ok(ended, 'STOP on the other device ends it, and the room says so');
        await toggle.click();
        await page.waitForFunction(() => document.querySelector('[data-room-screen]') === null, null, { timeout: 5000 });
        pass("REMOTE lists the owner's other device beside THE PC; chosen, that device is asked, SHARE there shows its screen in the room (watch only), and STOP there ends it",
          `the choices: ${choices.map((c) => c.text).join(' | ')}; the room said "${waiting}", the other device said "${asks}"; then "${showing}", playing ${frames.w}x${frames.h}; after STOP: "${ended}"`);
      } finally {
        await second.context.close().catch(() => undefined);
      }
    }

    assert.deepEqual(blocked, [], 'nothing went to the live database');
    assert.deepEqual(errors, [], 'no page errors');
    pass('nothing was asked of the live site or its database, and the page raised no errors', `the engine had ${engine.secondsLeft().toFixed(0)} of its 120 seconds left`);
  } catch (failure) {
    if (page) await shot(page, 'failed').catch(() => undefined);
    throw failure;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (engine) await engine.stop();
    if (site) await site.stop();
  }
}

/* --- PART 3: the server by Remote Desktop ------------------------------------------------------- */

const RDP_GATEWAY_PORT = 8492;
const RDP_GUACD_PORT = 8493;

/** Guacamole's instructions: LENGTH.VALUE,...; (the gateway's own reader, borrowed). */
const guac = require('./host/rdp-gateway.cjs');

/** A pretend guacd: answers the handshake, draws a red screen of the asked size, and writes down what reaches it. */
function pretendGuacd() {
  const seen = [];
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let rest = '';
    let size = [0, 0];
    socket.on('data', (text) => {
      const found = guac.whole(rest + text);
      rest = found.rest;
      for (const one of found.done) {
        const [op, ...parts] = guac.elements(one);
        seen.push([op, parts]);
        if (op === 'select') socket.write(guac.instruction('args', 'VERSION_1_5_0', 'hostname', 'port', 'username', 'password'));
        else if (op === 'size' && size[0] === 0) size = [Number(parts[0]), Number(parts[1])];
        else if (op === 'connect') {
          socket.write(guac.instruction('ready', '$drive'));
          socket.write(guac.instruction('size', '0', size[0], size[1]));
          socket.write(guac.instruction('rect', '0', '0', '0', size[0], size[1]));
          socket.write(guac.instruction('cfill', '14', '0', '255', '0', '0', '255'));
          socket.write(guac.instruction('sync', String(Date.now())));
        }
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(RDP_GUACD_PORT, '127.0.0.1', () => resolve({ seen, close: () => server.close() })));
}

async function partRdp(browser) {
  console.log('\nPART 3: THE SERVER BY REMOTE DESKTOP (THE REAL GATEWAY, A PRETEND GUACD)');
  const blocked = [];
  const errors = [];
  let site = null;
  let context = null;
  let guacd = null;
  let gateway = null;
  let serverEngine = null;
  const secret = require('node:crypto').randomBytes(32).toString('hex');
  const settings = path.join(os.tmpdir(), `debaser-drive-rdp-${process.pid}.env`);
  const switchFile = path.join(os.tmpdir(), `debaser-drive-rdp-switch-${process.pid}.json`);
  try {
    // No server named yet: the room's SERVER SIGN-IN form names it (Luke could not edit the settings file himself).
    fs.writeFileSync(settings, `SCREENS_RDP_SECRET=${secret}\nRDP_HOST=\nRDP_USER=\nRDP_PASSWORD=\n`);
    guacd = await pretendGuacd();
    gateway = spawn(process.execPath, [path.join(__dirname, 'host', 'rdp-gateway.cjs')], {
      env: { ...process.env, DEBASER_RDP_SETTINGS: settings, DEBASER_RDP_SWITCH: switchFile, DEBASER_RDP_GATEWAY_PORT: String(RDP_GATEWAY_PORT), DEBASER_GUACD_PORT: String(RDP_GUACD_PORT) },
      windowsHide: true,
      stdio: 'ignore',
    });
    started.push(gateway);
    // SERVER's own engine, played here by the dry-run engine (as THE PC's is in part 2): the server's WAY IN switch flips between it and Remote Desktop.
    serverEngine = await startEngine();
    site = await startSite(true, {
      SCREENS_SERVER_ENGINE_URL: ENGINE_AT,
      SCREENS_RDP_SECRET: secret,
      SCREENS_RDP_GATEWAY_URL: `http://127.0.0.1:${RDP_GATEWAY_PORT}`,
      SCREENS_RDP_SOCKET_URL: `ws://127.0.0.1:${RDP_GATEWAY_PORT}/api/screens/rdp-socket`,
    });
    const first = await newPage(browser, blocked, errors);
    context = first.context;
    const page = first.page;
    await openRoom(page);
    const room = page.locator('[data-dock-window="stream"]');
    const toggle = room.locator('[data-screen-toggle]');
    await toggle.waitFor({ timeout: 30000 });
    // Off until switched on (Luke: "a toggle since it is a separate thing to our tech"): the list opens with its switch.
    await toggle.click();
    await page.waitForSelector('[data-remote-server-switch="off"]', { timeout: 10000 });
    assert.equal(await page.locator('[data-remote-choice="rdp"]').count(), 0, 'switched off, THE SERVER is not a choice');
    const switchWords = await page.locator('[data-remote-server-switch]').innerText();
    await page.locator('[data-remote-server-switch]').click();
    await page.waitForSelector('[data-remote-choice="rdp"]', { timeout: 10000 });
    assert.equal(JSON.parse(fs.readFileSync(switchFile, 'utf8')).on, true, "the gateway's own switch file says on");
    const choiceWords = await page.locator('[data-remote-choice="rdp"]').innerText();
    const choiceTip = await page.locator('[data-remote-choice="rdp"]').getAttribute('title');
    assert.ok(/WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE, NOT OUR ENGINE/.test(choiceWords), choiceWords);
    pass('the server remote is off until switched on: REMOTE lists its own switch, and switched on, THE SERVER is a choice that says what it is and which way it goes', `"${switchWords}" -> "${choiceWords}" (tip: ${choiceTip})`);
    await page.locator('[data-remote-choice="rdp"]').click();
    await page.waitForSelector('[data-room-rdp-screen="setup"]', { timeout: 15000 });
    await page.locator('[data-room-rdp-signin-host]').fill('pretend-server');
    await page.locator('[data-room-rdp-signin-user]').fill('pretend');
    await page.locator('[data-room-rdp-signin-password]').fill('pretend-secret-word');
    await page.locator('[data-room-rdp-signin-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-room-rdp-screen]')?.getAttribute('data-room-rdp-screen') !== 'setup', null, { timeout: 15000 });
    const savedLines = fs.readFileSync(settings, 'utf8').split(/\r?\n/).filter((l) => /^RDP_(HOST|USER|PASSWORD)=/.test(l));
    assert.deepEqual(savedLines, ['RDP_HOST=pretend-server', 'RDP_USER=pretend', 'RDP_PASSWORD=pretend-secret-word'], 'the form wrote the three lines into the gateway settings');
    assert.equal(await page.locator('[data-room-rdp-signin-password]').count(), 0, 'the form is gone, and nothing of it is shown again');
    pass("with no server named, the view shows SERVER SIGN-IN; saved, the three lines are in the PC's settings file and the room goes on to connect", 'the address, user and password reached rdp.env through the site and the gateway; the form closed');
    await page.waitForSelector('[data-room-rdp-screen="showing"]', { timeout: 30000 });
    const red = await waitFor(() => page.evaluate(() => {
      const canvas = document.querySelector('[data-room-rdp-display] canvas');
      if (!canvas) return null;
      const [r, g, b] = canvas.getContext('2d').getImageData(5, 5, 1, 1).data;
      return r === 255 && g === 0 && b === 0 ? `${canvas.width}x${canvas.height}` : null;
    }), 10000);
    assert.ok(red, 'the server\'s picture is drawn');
    const ways = await room.locator('[data-room-rdp-way]').evaluateAll((keys) => keys.map((k) => `${k.innerText.trim()} ${k.getAttribute('aria-pressed')}${k.disabled ? ' disabled' : ''}`));
    assert.deepEqual(ways, ['[ WINDOWS REMOTE DESKTOP (GUACAMOLE) ] true', '[ OUR ENGINE ] false'], 'the way-in switch');
    // The drive's gateway is reached straight on this PC (a real one goes through the tunnel: OVER THE INTERNET).
    const routeSays = await room.locator('[data-room-rdp-route]').innerText();
    assert.equal(await room.locator('[data-room-rdp-route]').getAttribute('data-room-rdp-route'), 'this-pc', `the way it goes: ${routeSays}`);
    const connect = guacd.seen.find(([op]) => op === 'connect');
    pass('THE SERVER chosen: the gateway takes the site\'s pass and the server\'s picture is drawn in the room', `drawn ${red}; the way-in switch reads ${ways.join(' | ')}; guacd was asked for "${connect[1][1]}" from the gateway's settings file`);

    const keysOf = () => guacd.seen.filter(([op]) => op === 'key').map(([, p]) => p.join(':'));
    const before = keysOf().length;
    await page.keyboard.press('a');
    const sent = await waitFor(() => (keysOf().slice(before).join(' ') === '97:1 97:0' ? true : null), 5000);
    assert.ok(sent, `a key reaches the server at once, control on from the start: ${keysOf().slice(before).join(' ')}`);
    const box = await page.locator('[data-room-rdp-display]').boundingBox();
    const mouseBefore = guacd.seen.filter(([op]) => op === 'mouse').length;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const presses = await waitFor(() => {
      const mice = guacd.seen.filter(([op]) => op === 'mouse').slice(mouseBefore).map(([, p]) => p);
      return mice.some((m) => m[2] === '1') && mice.some((m, i) => i > 0 && m[2] === '0') ? mice : null;
    }, 5000);
    if (!presses) {
      const under = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? `${el.tagName} ${[...el.attributes].map((a) => a.name).join(' ')}` : 'nothing'; }, [box.x + box.width / 2, box.y + box.height / 2]);
      const mice = guacd.seen.filter(([op]) => op === 'mouse').slice(mouseBefore).map(([, p]) => p.join(':'));
      assert.fail(`a click reaches the server: box ${JSON.stringify(box)}, under the click ${under}, mouse seen ${mice.join(' ') || 'none'}`);
    }
    const at = presses.find((m) => m[2] === '1');
    pass('control is on from the start: a key and a click go to the server', `keys 97 down and up; the click landed at ${at[0]},${at[1]} on a screen of ${connect ? guacd.seen.find(([op]) => op === 'size')[1].slice(0, 2).join('x') : '?'}`);

    const escBefore = keysOf().length;
    await page.keyboard.press('Escape');
    const esc = await waitFor(() => (keysOf().slice(escBefore).join(' ') === '65307:1 65307:0' ? true : null), 5000);
    assert.ok(esc, `a short Esc is the server's: ${keysOf().slice(escBefore).join(' ')}`);
    assert.equal(await page.locator('[data-dock-window="stream"]').count(), 1, 'the room is still open');
    assert.equal(await page.locator('[data-room-rdp-control]').getAttribute('data-room-rdp-control'), 'on', 'control still on');
    pass('a short Esc goes to the server and closes nothing here', 'Esc down and up reached the server; the room stayed open, control on');

    await page.keyboard.down('Escape');
    await sleep(1300);
    await page.keyboard.up('Escape');
    assert.equal(await page.locator('[data-room-rdp-control]').getAttribute('data-room-rdp-control'), 'off', 'holding Esc lets go');
    const offBefore = keysOf().length;
    await page.keyboard.press('b');
    await sleep(500);
    assert.deepEqual(keysOf().slice(offBefore), [], 'keys stay on the page once let go');
    const offWords = await page.locator('[data-room-rdp-control]').innerText();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.locator('[data-room-rdp-control]').getAttribute('data-room-rdp-control'), 'on', 'a click takes it back');
    pass('holding Esc a second lets go, and a click on the picture takes control back', `let go, it read "${offWords.replace(/\s+/g, ' ')}" and a key reached nothing`);

    const sizes = () => guacd.seen.filter(([op]) => op === 'size').map(([, p]) => p.slice(0, 2).join('x'));
    assert.equal(sizes()[0], `${VIEW.width}x${VIEW.height}`, "normally the server's desktop is the size of this device's screen");
    // FIT and the server switch sit behind OPTIONS, so the column leaves a small room's picture clickable.
    await page.locator('[data-room-rdp-options]').click();
    assert.equal(await page.locator('[data-room-rdp-fit]').getAttribute('data-room-rdp-fit'), 'off', 'FIT is off at first');
    const viewSize = await page.locator('[data-room-rdp-screen] > [tabindex]').evaluate((el) => `${el.clientWidth}x${el.clientHeight}`);
    const nextSize = async (before) => waitFor(() => (sizes().length > before ? sizes().slice(-1)[0] : null), 8000);
    let sizesAt = sizes().length;
    // The room is a window of its own size, not the browser's: the view itself is made narrower, as a resized room would.
    await page.evaluate(() => { document.querySelector('[data-room-rdp-screen] > [tabindex]').style.right = '120px'; });
    await sleep(1000);
    assert.equal(sizes().length, sizesAt, 'with FIT off, a smaller view leaves the server as it is (drawn smaller, whole)');
    await page.evaluate(() => { document.querySelector('[data-room-rdp-screen] > [tabindex]').style.right = ''; });
    sizesAt = sizes().length;
    await page.locator('[data-room-rdp-fit]').click();
    const fitted = await nextSize(sizesAt);
    assert.equal(fitted, viewSize, 'FIT makes the server the size of the view');
    sizesAt = sizes().length;
    await page.evaluate(() => { document.querySelector('[data-room-rdp-screen] > [tabindex]').style.right = '120px'; });
    const followed = await nextSize(sizesAt);
    assert.ok(followed && followed !== fitted, 'and it follows the view');
    sizesAt = sizes().length;
    await page.locator('[data-room-rdp-fit]').click();
    const back = await nextSize(sizesAt);
    assert.equal(back, `${VIEW.width}x${VIEW.height}`, "FIT off: back to this screen's size");
    pass("the server starts at this screen's size, drawn whole; FIT THE SERVER TO THIS VIEW, a separate switch, sizes it to the view and follows it", `${sizes()[0]} at first; a narrower view with FIT off asked nothing; FIT on ${fitted}, narrower ${followed}; FIT off ${back}`);

    assert.deepEqual(blocked, [], 'nothing went to the live database');
    assert.deepEqual(errors, [], `no errors on the page: ${errors.join(' | ')}`);
    // Both ways to the server, one switch: Remote Desktop -> our engine on the server -> back.
    await page.locator('[data-room-rdp-options]').click().catch(() => undefined);
    await page.locator('[data-room-rdp-way="engine"]').click();
    await page.waitForSelector('[data-dock-window="stream"] [data-room-screen] [data-screen-way-in]', { timeout: 15000 });
    const engineWords = await page.locator('[data-screen-way-in]').innerText();
    const decoding = await waitFor(async () => { const r = await receiver(page); return r.framesDecoded > 5 ? r : null; }, 20000);
    assert.ok(decoding, 'our engine on the server decodes in the room');
    await page.locator('[data-screen-way="rdp"]').click();
    await page.waitForSelector('[data-room-rdp-screen="showing"]', { timeout: 20000 });
    pass("the server's WAY IN switch goes both ways: [ OUR ENGINE ] plays the server's own engine (frames decoded), and [ WINDOWS REMOTE DESKTOP (GUACAMOLE) ] goes back", `engine view read "${engineWords.replace(/\s+/g, ' ')}", ${decoding.framesDecoded} frames decoded`);

    // The server remote's own switch, from the view: off, and the gateway refuses the next pass. (Coming back from
    // our engine opened the view afresh, OPTIONS closed.)
    if ((await page.locator('[data-room-rdp-switch]').count()) === 0) await page.locator('[data-room-rdp-options]').click();
    await page.locator('[data-room-rdp-switch]').click();
    await page.waitForSelector('[data-room-rdp-screen="off"]', { timeout: 10000 });
    const offSays = await page.locator('[data-room-rdp-says]').innerText();
    assert.equal(JSON.parse(fs.readFileSync(switchFile, 'utf8')).on, false, "the gateway's own switch file says off");
    pass("the view's [ SERVER REMOTE: ON ] switches it off on the PC itself", `it then read "${offSays}"`);

    pass('nothing went to the live database and the page threw no errors');
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (site) await site.stop();
    if (gateway) stopTree(gateway);
    if (serverEngine) await serverEngine.stop();
    if (guacd) guacd.close();
    fs.rmSync(settings, { force: true });
    fs.rmSync(switchFile, { force: true });
  }
}

async function main() {
  if (leagueRunning()) {
    console.log('NOT RUN. A League match is running on this PC: nothing is built, started or sent while it is.');
    return 3;
  }
  if (ENGINE_PORT === LIVE_ENGINE_PORT || PORT === LIVE_ENGINE_PORT) {
    console.log(`NOT RUN. Port ${LIVE_ENGINE_PORT} belongs to the engine that is live on this PC. This drive never uses it: leave --engine-port out, or give another.`);
    return 1;
  }
  for (const port of [ENGINE_PORT, PORT]) {
    if (await answering(port)) {
      console.log(`NOT RUN. Something is already answering on port ${port}, and it is not anything this drive started. Nothing was started. Stop that program, or give another port.`);
      return 1;
    }
  }
  if (ONLY !== 'rdp' && !fs.existsSync(ENGINE)) {
    console.log(`FAIL. The engine is not built: ${ENGINE} is missing.`);
    return 1;
  }
  console.log(`DRIVE-SCREENS: the site on ${BASE} (mock data), the engine on ${ENGINE_AT} (dry run), a hidden browser. Nothing leaves this PC.`);
  // The last switch lets the second browser (part k's other device) share a screen without a picker: the drive's own stand-in for a press.
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--mute-audio', '--auto-select-desktop-capture-source=Entire screen'] });
  let failure = null;
  try {
    if (ONLY === 'rdp') await partRdp(browser);
    else {
      if (ONLY !== 'open') await partClosed(browser);
      if (leagueRunning()) throw new Error('a League match started: stopped before the second part');
      if (ONLY !== 'closed') await partOpen(browser);
    }
  } catch (error) {
    failure = error;
  } finally {
    await browser.close().catch(() => undefined);
    started.forEach(stopTree);
    fs.rmSync(POINTER_FILE, { force: true });
  }
  console.log('\nDRIVE-SCREENS RESULT');
  for (const result of results) console.log(`  PASS  ${result.what}`);
  if (failure) {
    console.log(`  FAIL  ${failure && failure.message ? failure.message : failure}`);
    console.log(`\nFAILED after ${results.length} passed.`);
    return 1;
  }
  console.log(`\nPASS: ${results.length} of ${results.length}. Browser ${path.basename(findChrome())}, headless; the engine's dry run put nothing into Windows.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FAIL. ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  },
);
