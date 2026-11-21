/*
 * Drives SCREENS in a room (SPEC-screens.md, phase 3, first slice) in a real, hidden browser: the owner's PC screen in
 * his own room, its settings panel and CONTROL. All of it on this PC, on mock data: nothing reaches the live site or
 * the live database, and nothing reaches Windows (the engine is started in its DRY RUN, which writes down what it
 * would do with the mouse and keys and does none of it). Not in `npm run checks`: it needs the engine, a dev server
 * and a browser.
 *
 *   node scripts/drive-screens.cjs [--port 3391] [--engine-port 8491] [--only closed|open]
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
 * The statistics are the browser's own: the page's RTCPeerConnection is watched from outside the site's code.
 * Exit 0: every part passed. Exit 1: something failed. Exit 3: not run, because a League match is running on this PC.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const engineArgs = ['serve', '--allow-control', '--control-dry-run', '--tweaks', '76', '--port', String(ENGINE_PORT), '--seconds', '120'];
  const child = spawn(ENGINE, engineArgs, { cwd: path.join(ROOT, 'engine'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
async function startSite(devOpen) {
  const switches = 'AQUARIUM BEATBOX BOOKS COMMS DOCS FORUM GAMES HISTORY LETTERS LORE MEDIA MUSIC NOTIFICATIONS PROFILE_CHARACTER PROFILE RECOMMENDATIONS WATCH WEB WINDOWS'.split(' ');
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_ENGINE_URL: ENGINE_AT, SCREENS_OWNER_ID: '', SCREENS_DEV_OPEN: devOpen ? '1' : '' };
  for (const name of switches) env[`NEXT_PUBLIC_${name}_DATA_SOURCE`] = 'mock';
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
    const out = { connections: window.__connections.length, state: connection.connectionState, framesDecoded: 0, frameWidth: null, frameHeight: null, framesPerSecond: null, decoder: null, codec: null };
    if (connection.connectionState === 'closed') return out;
    const report = await connection.getStats();
    report.forEach((entry) => {
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
    pass('a visitor of a server started without SCREENS_DEV_OPEN sees no [ SCREEN ] key in a room', `the engine was running all the while (asked directly, it said control is "${there.control}"); the room's corner keys read: ${keys.join(' ')}`);

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
    assert.equal(await page.locator('[data-screen-toggle]').count(), 0, 'with no engine running there is no [ SCREEN ] key, even here');
    pass('with the engine not running, the room has no [ SCREEN ] key (the site says "not available")');

    engine = await startEngine();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openRoom(page);
    const room = page.locator('[data-dock-window="stream"]');
    const toggle = room.locator('[data-screen-toggle]');

    // a. The key, and the picture.
    await toggle.waitFor({ timeout: 15000 });
    const keys = await cornerKeys(page);
    assert.equal((await toggle.innerText()).trim(), '[ SCREEN ]', 'the key reads [ SCREEN ]');
    assert.equal(await toggle.locator('img, svg').count(), 0, 'words only: no picture on the key');
    assert.equal((await receiver(page)).connections, 0, 'nothing is connected before the key is pressed');
    await toggle.click();
    await page.waitForSelector('[data-dock-window="stream"] [data-room-picture] [data-room-screen]', { timeout: 10000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'the key says it is on');
    const flowing = await waitFor(async () => { const r = await receiver(page); return r.framesDecoded > 5 ? r : null; }, 20000);
    assert.ok(flowing, `frames are decoded: ${JSON.stringify(await receiver(page))}`);
    await sleep(1000);
    const later = await receiver(page);
    assert.ok(later.framesDecoded > flowing.framesDecoded, `and keep coming: ${flowing.framesDecoded} then ${later.framesDecoded}`);
    assert.equal(later.state, 'connected');
    const drawn = await page.locator('[data-room-screen]').getAttribute('data-screen-drawing');
    pass(
      "the room shows [ SCREEN ] beside VIS and CANVAS; pressed, the PC's screen is decoded in the room's picture",
      `corner keys: ${keys.join(' ')}; the browser's own receiver: ${flowing.framesDecoded} frames decoded, then ${later.framesDecoded} a second later, ${later.frameWidth}x${later.frameHeight}, ${later.codec}, decoder ${later.decoder}; drawn ${String(drawn).toUpperCase()}`,
    );

    // b. SETTINGS: 16:9 and 720.
    const settingsKey = page.locator('[data-screen-settings-key]');
    await settingsKey.click();
    await page.waitForSelector('[data-screen-panel]', { timeout: 5000 });
    assert.equal(await settingsKey.getAttribute('aria-expanded'), 'true', 'the SETTINGS key says it is open');
    const headings = await page.locator('[data-screen-panel] h3').allInnerTexts();
    assert.deepEqual(headings, ['PICTURE', 'DRAWING', 'UPSCALING', 'READOUT', 'WINDOW', 'CONTROL', 'NOT BUILT YET'], "the panel has the engine page's sections");
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
          const shown = await page.locator('[data-room-screen]').evaluate((element) => `${element.getAttribute('data-screen-drawing')} ${element.getAttribute('data-screen-fit')}`);
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
      '[ SCREEN ] pressed again: back to the room\'s own picture, control let go of, the connection closed',
      `the room shows ${roomShows}; the browser's connection went from "${before.state}" to "${closed.state}" (${closed.connections} made in all); the engine: "ended: ${letGo.why}", holder ${(await engine.log()).holder}, viewers ${gone ? 0 : (await engine.settings()).viewers}`,
    );
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

async function main() {
  if (leagueRunning()) {
    console.log('NOT RUN. A League match is running on this PC: nothing is built, started or sent while it is.');
    return 3;
  }
  if (!fs.existsSync(ENGINE)) {
    console.log(`FAIL. The engine is not built: ${ENGINE} is missing.`);
    return 1;
  }
  console.log(`DRIVE-SCREENS: the site on ${BASE} (mock data), the engine on ${ENGINE_AT} (dry run), a hidden browser. Nothing leaves this PC.`);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--mute-audio', '--disable-audio-output'] });
  let failure = null;
  try {
    if (ONLY !== 'open') await partClosed(browser);
    if (leagueRunning()) throw new Error('a League match started: stopped before the second part');
    if (ONLY !== 'closed') await partOpen(browser);
  } catch (error) {
    failure = error;
  } finally {
    await browser.close().catch(() => undefined);
    started.forEach(stopTree);
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
