#!/usr/bin/env node
/**
 * The proof of FIT THE PC TO THIS SCREEN (SPEC-screens.md; engine/src/fit.rs has the rules): while a viewer wants
 * it, the PC's own screen is changed to a mode of the viewer's shape, and changed back when the viewer has gone.
 *
 * EVERYTHING HERE IS A DRY RUN. THIS PC'S REAL SCREEN MODE IS NEVER CHANGED BY THIS CHECK. The engine is started
 * with a test-only switch, `DEBASER_PRETEND_MODES=<file>`: it then makes no display call of any kind, takes its
 * list of modes from that file (one like this PC's ultrawide monitor), only WRITES DOWN the change it would have
 * made (readable in `/settings`, under `pcScreen.record`), and carries on as if the screen had that size, so the
 * piece of screen it sends can be checked. The one real thing is the cut-off key: while "fitted" the engine really
 * holds Ctrl+Alt+Shift+End (no window shows for it), and the check tells its own engine, by process number, that
 * the key was pressed (the message Windows would send is posted to it: no key is pressed).
 *
 * The pretended modes are no larger than 3440x1440, so this is meant for a PC whose real screen is at least that.
 *
 *     node bench/fit-check.cjs            (from the engine folder, after `cargo build --release`)
 *
 * Exit 0: every part passed. Exit 1: something failed. Exit 3: not run at all, because a League match is running
 * on this PC. Exit 4: not run, because its port is taken (bench/own-port.cjs).
 *
 * What it cannot say: anything about a REAL change of mode (how long the monitor is black, whether Windows gives
 * the screen share back, what happens to open windows). That is one test for a person at the PC.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
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

/** A monitor like this PC's: an ultrawide whose own mode is 3440x1440 at 180. The first line is the PC's own. */
const ULTRAWIDE = ['3440x1440@180', '3440x1440@144', '3440x1440@120', '3440x1440@60', '2560x1440@144', '2560x1440@120', '2560x1440@60', '2560x1080@180', '2560x1080@60', '1920x1200@60', '1920x1080@180', '1920x1080@144', '1920x1080@60', '1680x1050@60', '1280x720@60', '1024x768@75'];
/** The same monitor with the PC running it at 120 a second (the monitor still offers 144 and 180). */
const ULTRAWIDE_AT_120 = ['3440x1440@120', ...ULTRAWIDE];

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
  const args = ['serve', '--tweaks', '12', '--port', String(port), ...more];
  if (!args.includes('--seconds')) args.push('--seconds', '80');
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
  // The dry run must be on before anything else is done: without it this check does not go on.
  if (!engine.text.includes('THIS PC\'S SCREEN AND ITS MODES ARE PRETENDED')) {
    await engine.stop();
    throw new Error('The engine did not say that its screen modes are pretended. Nothing further was done.');
  }
  return engine;
}

/** Opens the viewer page as a device with a screen of `screen` pixels would, and waits for its own first request. */
async function openViewer(browser, port, screen, query = '') {
  const viewport = { width: 1280, height: Math.round((1280 * screen.height) / screen.width) };
  const context = await browser.newContext({ viewport, screen, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load', timeout: 8000 });
  const began = Date.now();
  for (;;) {
    const ready = await page.evaluate(async () => {
      const s = await window.__debaserStats();
      const host = window.__debaserSettings.get();
      // (The page's own first request has arrived when the PC has been asked for AUTO frames a second.)
      return s.framesDecoded > 3 && Boolean(host) && host.asked.fps === 'auto' && host.applied;
    });
    if (ready) break;
    if (Date.now() - began > 12000) throw new Error(`The viewer page never got a picture and an answer to its first request${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
    await sleep(100);
  }
  const id = await page.evaluate(() => viewer);
  return { context, page, errors, id };
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

const mode = (m) => (m ? `${m.width}x${m.height} at ${m.hz}` : '?');
const recorded = (pc) => (pc && pc.record ? pc.record.map((entry) => (entry.what === 'set' ? `set ${entry.width}x${entry.height} at ${entry.hz}` : entry.what)).join(', ') || 'nothing' : 'NO RECORD');
const piece = (s) => (s ? `${s.regionWidth}x${s.regionHeight} from ${s.x},${s.y}, sent as ${s.width}x${s.height}` : 'nothing');

async function main() {
  const port = Number(option('--port', String(PORTS.fit)));
  const result = { kind: 'fit-check', when: new Date().toISOString(), pass: false, parts: [] };
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

  const modesFile = path.join(os.tmpdir(), `debaser-fit-check-modes-${process.pid}`);
  const matchFile = path.join(os.tmpdir(), `debaser-fit-check-pretend-match-${process.pid}`);
  const settings = async (viewerId) => (await fetch(`http://127.0.0.1:${port}/settings${viewerId ? `?viewer=${viewerId}` : ''}`)).json();
  /** Waits until the PC's own account of its screen (and of the stream) passes `test`. */
  const until = async (test, viewerId, ms = 8000) => (await waitFor(async () => { const host = await settings(viewerId); return test(host) ? host : null; }, ms)) || settings(viewerId);
  const panel = async (page, open) => { if ((await page.isVisible('#panel')) !== open) await page.click('#open-settings'); };
  /** Presses the page's own FIT key (the panel is opened for it, and left open). */
  const pressFit = async (page) => { await panel(page, true); await page.click('#fit'); };
  /** What the page itself shows about FIT, after it has read the PC's settings afresh. */
  const shown = (page) => page.evaluate(async () => {
    await readHost();
    const part = document.getElementById('fit-part');
    return { offered: !part.hidden, pressed: document.getElementById('fit').getAttribute('aria-pressed'), says: document.getElementById('fit-says').textContent, lines: part.textContent };
  });
  const stats = (page) => page.evaluate(async () => { const s = await window.__debaserStats(); return { frames: s.framesDecoded, wide: s.frameWidth, tall: s.frameHeight, state: s.connectionState, made: s.connectionsMade }; });
  /** Waits until the browser is decoding frames of the size the PC says it is sending. */
  const decoding = async (page, viewerId) => {
    let host = null;
    let s = null;
    await waitFor(async () => { host = await settings(viewerId); s = await stats(page); return host.applied && host.sending && s.wide === host.sending.width && s.tall === host.sending.height; }, 8000);
    return { host, s };
  };
  const where = (more = []) => JSON.parse(execFileSync(ENGINE, ['pointer-where', ...more], { encoding: 'utf8', windowsHide: true }).trim());

  let browser = null;
  let other = null;
  let engine = null;
  const engineOutput = [];
  const finishRun = async (label) => { if (engine) { await engine.stop(); engineOutput.push(`--- ${label} ---`, ...engine.lines().filter((line) => !/^\d+ s\s/.test(line))); engine = null; } };
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true };

    // ---- Run 1: an engine that allows FIT, on a pretended ultrawide. ----
    fs.writeFileSync(modesFile, `${ULTRAWIDE.join('\n')}\n`);
    fs.rmSync(matchFile, { force: true });
    engine = await startEngine(port, ['--allow-fit'], { DEBASER_PRETEND_MODES: modesFile, DEBASER_PRETEND_MATCH_FILE: matchFile });
    {
      const a = await openViewer(browser, port, { width: 1920, height: 1080 });
      const page = a.page;
      const marks = [await stats(page)];

      // (a) Before anybody asks: the switch is there, off, with its plain lines; the PC's screen is its own.
      {
        const host = await settings(a.id);
        await panel(page, true);
        const page0 = await shown(page);
        const visible = await page.isVisible('#fit');
        const pc = host.pcScreen;
        const whole = host.sending.regionWidth === 3440 && host.sending.regionHeight === 1440;
        const good = pc.allowed && pc.pretended === true && !pc.fitted && pc.wantedBy === 0 && !pc.yours && pc.own.width === 3440 && pc.own.height === 1440 && pc.own.hz === 180 && pc.now.width === 3440 && pc.record.length === 0 &&
          visible && page0.offered && page0.pressed === 'false' && page0.says === 'THE PC\'S SCREEN IS ITS OWN: 3440x1440 AT 180' &&
          page0.lines.includes('The PC changes its own screen to this screen\'s shape while you are connected, and changes it back when you leave. Its monitor goes black for a second or two each way, and windows on it may move.') &&
          whole && host.asked.shape === 'native';
        part('a', good ? 'PASS' : 'FAIL', 'with --allow-fit the switch is offered, off, with its plain lines; the PC\'s screen is its own and the picture starts as all of it',
          `/settings: allowed ${pc.allowed}, the screen pretended ${pc.pretended}, its own ${mode(pc.own)}, now ${mode(pc.now)}, fitted ${pc.fitted}, wanted by ${pc.wantedBy}, the record of changes: ${recorded(pc)}\n` +
          `      the page: [ FIT THE PC TO THIS SCREEN ] is ${visible ? 'shown' : 'NOT shown'}, pressed "${page0.pressed}"; its status line reads "${page0.says}"; the two plain lines are under it: ${page0.lines.includes('Its monitor goes black for a second or two each way')}\n` +
          `      the stream, left alone: shape "${host.asked.shape}", the PC's ${piece(host.sending)}`);
      }

      // (b) A viewer in the PC's own shape: nothing closer, nothing changed.
      {
        const wide = await openViewer(browser, port, { width: 3440, height: 1440 });
        await pressFit(wide.page);
        const host = await until((h) => h.pcScreen.why, wide.id, 4000);
        const said = await shown(wide.page);
        const pc = host.pcScreen;
        part('b', !pc.fitted && pc.record.length === 0 && pc.yours && String(pc.why).startsWith('NOTHING CLOSER') && said.says.includes('NOTHING CLOSER') && said.says.includes('THE PC\'S SCREEN IS ITS OWN: 3440x1440 AT 180') ? 'PASS' : 'FAIL',
          'a 3440x1440 viewer asking for a fit gets "nothing closer", and nothing is changed',
          `the PC answered: fitted ${pc.fitted}, why "${pc.why}", the record of changes: ${recorded(pc)}; the page's status line reads "${said.says.replace(/\n/g, ' / ')}"`);
        await wide.context.close();
        await until((h) => h.pcScreen.wantedBy === 0, null, 6000);
      }
      marks.push(await stats(page));

      // (c) The 1920x1080 viewer. First MATCH alone, which cuts the PC's sides off; then FIT, after which the
      // same MATCH cuts nothing off, and so does the whole-screen shape.
      let fittedHost = null;
      {
        const notes = [];
        let good = true;
        const note = (ok, text) => { notes.push(`${ok ? 'yes' : 'NO'}: ${text}`); if (!ok) good = false; };
        await page.evaluate(() => window.__debaserSettings.ask({ shape: 'match' }));
        const cut = await decoding(page, a.id);
        note(cut.host.sending.regionWidth === 2560 && cut.host.sending.x === 440 && cut.s.wide === 1920 && cut.s.tall === 1080, `before the fit, MATCH THIS SCREEN on a 1920x1080 viewer: the PC sends ${piece(cut.host.sending)} of its ${cut.host.screen.width}x${cut.host.screen.height} screen (its two sides cut off); the browser decodes ${cut.s.wide}x${cut.s.tall}`);
        await pressFit(page);
        fittedHost = await until((h) => h.pcScreen.fitted && h.applied, a.id);
        const pc = fittedHost.pcScreen;
        if (!pc.fitted && /CUT-OFF KEY/.test(String(pc.why))) throw new Error(`The fit was refused because another program holds Ctrl+Alt+Shift+End on this PC right now ("${pc.why}"). Nothing was changed. Run the check again when no engine is controlling this PC.`);
        note(pc.fitted && pc.now.width === 2560 && pc.now.height === 1440 && pc.now.hz === 144 && pc.wantedBy === 1 && pc.yours && pc.record.length === 1 && pc.record[0].what === 'set' && pc.record[0].width === 2560 && pc.record[0].height === 1440 && pc.record[0].hz === 144,
          `[ FIT THE PC TO THIS SCREEN ] pressed: the PC chose ${mode(pc.now)} (wanted 2560x1440 at 144: the tallest 16:9 mode, at the fastest rate the monitor has for that size); wanted by ${pc.wantedBy}; the record of what would have been set on the real screen: ${recorded(pc)}`);
        const fit = await decoding(page, a.id);
        const s = fit.host.sending;
        note(fit.host.screen.width === 2560 && fit.host.screen.height === 1440 && s.x === 0 && s.y === 0 && s.regionWidth === 2560 && s.regionHeight === 1440 && fit.s.wide === 1920 && fit.s.tall === 1080 && fit.host.asked.shape === 'match',
          `the stream then: the engine takes the screen to be ${fit.host.screen.width}x${fit.host.screen.height} at ${fit.host.screen.hz}, and with MATCH still on it sends ${piece(s)}: all of it, nothing cut off; the browser decodes ${fit.s.wide}x${fit.s.tall}; the most frames a second a viewer can now ask for: ${fit.host.hostLimits.maxFps}`);
        await page.evaluate(() => window.__debaserSettings.ask({ shape: 'native' }));
        const whole = await decoding(page, a.id);
        note(whole.host.sending.regionWidth === 2560 && whole.host.sending.regionHeight === 1440 && whole.s.wide === 1920 && whole.s.tall === 1080, `and with the whole-screen shape: ${piece(whole.host.sending)}; the browser decodes ${whole.s.wide}x${whole.s.tall}`);
        const said = await shown(page);
        note(said.pressed === 'true' && said.says === 'THE PC\'S SCREEN IS NOW 2560x1440 AT 144 (ITS OWN: 3440x1440 AT 180)', `the page: the key reads pressed "${said.pressed}" and the status line "${said.says}"`);
        const kept = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('debaser-engine-viewer-v2')).fit; } catch (error) { return null; } });
        note(kept === true, `the choice is remembered on the device (fit: ${kept})`);
        const seen = where();
        note(seen.strip !== null && seen.strip.visible === false && seen.cutOffKeyFree === false, `while fitted the engine holds Ctrl+Alt+Shift+End (free for others: ${seen.cutOffKeyFree}) and shows no window for it (a strip window exists: ${seen.strip !== null}, visible: ${seen.strip ? seen.strip.visible : 'no'})`);
        part('c', good ? 'PASS' : 'FAIL', 'a 1920x1080 viewer asking for a fit gets 2560x1440 at 144, and the stream then sends the whole screen with nothing cut off', notes.join('\n      '));
      }
      marks.push(await stats(page));

      // (d) Two viewers wanting it: one leaving keeps it, the last leaving gives the screen back.
      {
        const notes = [];
        let good = true;
        const note = (ok, text) => { notes.push(`${ok ? 'yes' : 'NO'}: ${text}`); if (!ok) good = false; };
        const second = await openViewer(browser, port, { width: 1366, height: 768 });
        await pressFit(second.page);
        const two = await until((h) => h.pcScreen.wantedBy === 2, second.id, 4000);
        note(two.pcScreen.wantedBy === 2 && two.pcScreen.fitted && two.pcScreen.record.length === 1, `a second viewer (1366x768) presses the key too: wanted by ${two.pcScreen.wantedBy}, still ${mode(two.pcScreen.now)}, the record: ${recorded(two.pcScreen)}`);
        // The first viewer gives it up (its key, pressed again): the second still wants it.
        await pressFit(page);
        const one = await until((h) => h.pcScreen.wantedBy === 1, a.id, 4000);
        const firstSays = await shown(page);
        note(one.pcScreen.wantedBy === 1 && one.pcScreen.fitted && !one.pcScreen.yours && one.pcScreen.record.length === 1 && firstSays.pressed === 'false' && firstSays.says.startsWith('THE PC\'S SCREEN IS NOW 2560x1440 AT 144'),
          `the first viewer presses its key again (off): wanted by ${one.pcScreen.wantedBy}, fitted ${one.pcScreen.fitted} at ${mode(one.pcScreen.now)}, the record: ${recorded(one.pcScreen)}; the first page's key reads pressed "${firstSays.pressed}" and its line "${firstSays.says}"`);
        // The second viewer's page closes: nobody wants it any more.
        const closedAt = Date.now();
        await second.context.close();
        const back = await until((h) => !h.pcScreen.fitted, a.id, 9000);
        const tookMs = Date.now() - closedAt;
        const after = await decoding(page, a.id);
        note(!back.pcScreen.fitted && back.pcScreen.now.width === 3440 && back.pcScreen.now.hz === 180 && back.pcScreen.record.length === 2 && back.pcScreen.record[1].what === 'given back' && after.host.screen.width === 3440 && after.host.sending.regionWidth === 3440,
          `the second viewer's page closes: the PC's screen is given back (${mode(back.pcScreen.now)}) ${tookMs} ms later; the record: ${recorded(back.pcScreen)}; the stream is the PC's ${piece(after.host.sending)} again`);
        part('d', good ? 'PASS' : 'FAIL', 'with two viewers wanting it, one leaving keeps the fit and the last leaving gives the screen back', notes.join('\n      '));
      }
      marks.push(await stats(page));

      // (e) Silence: a viewer whose browser dies without a word (killed outright, so it says no goodbye).
      {
        const server = await chromium.launchServer({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        other = server;
        const client = await chromium.connect(server.wsEndpoint());
        const silent = await openViewer(client, port, { width: 1920, height: 1080 });
        await pressFit(silent.page);
        const on = await until((h) => h.pcScreen.fitted, silent.id, 6000);
        const recordBefore = on.pcScreen.record.length;
        const killedAt = Date.now();
        server.process().kill();
        const back = await until((h) => !h.pcScreen.fitted, null, 12000);
        const tookMs = Date.now() - killedAt;
        other = null;
        await client.close().catch(() => {});
        part('e', on.pcScreen.fitted && !back.pcScreen.fitted && back.pcScreen.record.length === recordBefore + 1 && back.pcScreen.record[recordBefore].what === 'given back' && tookMs >= 2000 ? 'PASS' : 'FAIL',
          'a viewer that falls silent (its browser killed outright) loses the fit: the screen is given back',
          `fitted for it: ${on.pcScreen.fitted} (${mode(on.pcScreen.now)}); its browser was killed; the PC gave its screen back ${tookMs} ms later (a viewer counts as silent after 3 s without a word); the record: ${recorded(back.pcScreen)}`);
      }
      marks.push(await stats(page));

      // (f) The cut-off key on the PC.
      {
        await pressFit(page);
        const on = await until((h) => h.pcScreen.fitted, a.id, 6000);
        const recordBefore = on.pcScreen.record.length;
        // Only this check's own engine is told, by its process number.
        const told = where(['--cut-off', '--of', String(engine.child.pid)]);
        const back = await until((h) => !h.pcScreen.fitted, a.id, 6000);
        await sleep(600);
        const settled = await settings(a.id);
        const said = await shown(page);
        const free = where();
        const pc = settled.pcScreen;
        part('f', on.pcScreen.fitted && told.cutOffPosted && !back.pcScreen.fitted && !pc.fitted && pc.wantedBy === 0 && !pc.yours && pc.record.length === recordBefore + 1 && pc.record[recordBefore].what === 'given back' && /PUT BACK AT THE PC/.test(String(pc.why)) && said.pressed === 'false' && said.says.includes('PUT BACK AT THE PC') && free.cutOffKeyFree && free.strip === null ? 'PASS' : 'FAIL',
          'Ctrl+Alt+Shift+End on the PC gives the screen back, and it is not fitted again by itself',
          `fitted: ${on.pcScreen.fitted}; the engine was told its cut-off key was pressed (${told.cutOffPosted}): fitted ${pc.fitted}, now ${mode(pc.now)}, wanted by ${pc.wantedBy} (the viewer's wish was forgotten), why "${pc.why}"; the record: ${recorded(pc)}; the page's key reads pressed "${said.pressed}" and its line "${said.says.replace(/\n/g, ' / ')}"; afterwards the key is free again (${free.cutOffKeyFree}) and the engine's hidden window is gone (${free.strip === null})`);
      }
      marks.push(await stats(page));

      // (g) A League match (pretended): a new fit is refused, and a fit that is on is left alone until it ends.
      {
        const notes = [];
        let good = true;
        const note = (ok, text) => { notes.push(`${ok ? 'yes' : 'NO'}: ${text}`); if (!ok) good = false; };
        const before = (await settings(a.id)).pcScreen.record.length;
        fs.writeFileSync(matchFile, 'the fit check is pretending a match is running\n');
        await until((h) => h.cap === 'LEAGUE MATCH', a.id, 5000);
        await pressFit(page);
        const refused = await until((h) => h.pcScreen.why, a.id, 4000);
        const said = await shown(page);
        note(!refused.pcScreen.fitted && refused.pcScreen.why === 'NOT DURING A LEAGUE MATCH' && refused.pcScreen.record.length === before && said.says.includes('NOT DURING A LEAGUE MATCH'),
          `during the match the key is pressed: fitted ${refused.pcScreen.fitted}, why "${refused.pcScreen.why}", nothing added to the record (${refused.pcScreen.record.length - before}); the page's line reads "${said.says.replace(/\n/g, ' / ')}"`);
        // The match ends with the viewer still wanting it: the fit is made then.
        fs.rmSync(matchFile, { force: true });
        const made = await until((h) => h.pcScreen.fitted, a.id, 6000);
        note(made.pcScreen.fitted && made.pcScreen.record.length === before + 1 && !made.cap, `the match ends and the viewer still wants it: fitted ${made.pcScreen.fitted} (${mode(made.pcScreen.now)})`);
        // A match starts while fitted, and the viewer gives the fit up: the mode is left alone until the match ends.
        fs.writeFileSync(matchFile, 'the fit check is pretending a match is running\n');
        await until((h) => h.cap === 'LEAGUE MATCH', a.id, 5000);
        await pressFit(page);
        const held = await until((h) => h.pcScreen.wantedBy === 0 && h.pcScreen.why, a.id, 4000);
        await sleep(1500);
        const stillHeld = await settings(a.id);
        note(stillHeld.pcScreen.fitted && stillHeld.pcScreen.wantedBy === 0 && stillHeld.pcScreen.record.length === before + 1 && /WHEN THE LEAGUE MATCH ENDS/.test(String(held.pcScreen.why)),
          `a match starts while fitted and the viewer presses the key off: 1.5 s later the PC is still fitted (${stillHeld.pcScreen.fitted}, ${mode(stillHeld.pcScreen.now)}), wanted by ${stillHeld.pcScreen.wantedBy}, and says "${held.pcScreen.why}"`);
        const endedAt = Date.now();
        fs.rmSync(matchFile, { force: true });
        const back = await until((h) => !h.pcScreen.fitted, a.id, 6000);
        note(!back.pcScreen.fitted && back.pcScreen.record.length === before + 2 && back.pcScreen.record[before + 1].what === 'given back', `the match ends: the screen is given back ${Date.now() - endedAt} ms later (${mode(back.pcScreen.now)}); the record: ${recorded(back.pcScreen)}`);
        part('g', good ? 'PASS' : 'FAIL', 'a League match (pretended): a new fit is refused, and a fit that is on is neither changed nor given back until the match ends', notes.join('\n      '));
      }
      await sleep(500);
      marks.push(await stats(page));

      // (h) The one connection carried all of it.
      {
        const last = marks[marks.length - 1];
        const grew = marks.every((mark, index) => index === 0 || mark.frames > marks[index - 1].frames);
        part('h', grew && last.state === 'connected' && last.made === 1 && a.errors.length === 0 ? 'PASS' : 'FAIL', 'the first viewer\'s connection survives every change, and its picture keeps coming',
          `frames decoded, read after each part: ${marks.map((mark) => mark.frames).join(' -> ')}; the connection is "${last.state}", made ${last.made} time(s); errors on the page: ${a.errors.length ? a.errors.join(' | ') : 'none'}`);
      }
      await a.context.close();
    }
    await finishRun('run 1: --allow-fit, a pretended ultrawide at 180');

    // ---- Run 2: the rate chosen, and the engine stopping while fitted. The PC is pretended to be running its
    // screen at 120 (the monitor still offers 144 and 180). The engine is told to stop by itself after 12 s. ----
    fs.writeFileSync(modesFile, `${ULTRAWIDE_AT_120.join('\n')}\n`);
    engine = await startEngine(port, ['--allow-fit', '--seconds', '12'], { DEBASER_PRETEND_MODES: modesFile });
    {
      const a = await openViewer(browser, port, { width: 1920, height: 1080 });
      await pressFit(a.page);
      const on = await until((h) => h.pcScreen.fitted, a.id, 6000);
      const pc = on.pcScreen;
      // The engine stops by itself (its --seconds runs out), in the ordinary way, while still fitted.
      await Promise.race([engine.gone, sleep(14000)]);
      const said = engine.lines().filter((line) => line.startsWith('FIT:'));
      const gaveBack = said.some((line) => line.includes('back to its own, 3440x1440 AT 120'));
      part('i', pc.fitted && pc.own.hz === 120 && pc.now.width === 2560 && pc.now.height === 1440 && pc.now.hz === 120 && engine.exit === 0 && gaveBack ? 'PASS' : 'FAIL',
        'the rate chosen is never above the PC\'s own, and an engine that stops while fitted gives the screen back first',
        `the PC pretended to be at ${mode(pc.own)} (its monitor also offers 2560x1440 at 144): the fit chose ${mode(pc.now)}; then the engine stopped by itself (exit code ${engine.exit}) and printed: ${said.join(' | ')}`);
      await a.context.close();
    }
    await finishRun('run 2: --allow-fit, the PC at 120, stopping while fitted');

    // ---- Run 3: an engine that was NOT started with --allow-fit. ----
    fs.writeFileSync(modesFile, `${ULTRAWIDE.join('\n')}\n`);
    engine = await startEngine(port, [], { DEBASER_PRETEND_MODES: modesFile });
    {
      const a = await openViewer(browser, port, { width: 1920, height: 1080 });
      await panel(a.page, true);
      const offered = await a.page.isVisible('#fit');
      const answer = await a.page.evaluate(async () => { try { return (await window.__debaserSettings.ask({ pcScreen: 'fit' })).pcScreen; } catch (error) { return { refusedOutright: String(error && error.message ? error.message : error) }; } });
      await sleep(600);
      const host = await settings(a.id);
      const pc = host.pcScreen;
      part('j', !offered && !pc.allowed && !pc.fitted && !pc.yours && pc.wantedBy === 0 && pc.record.length === 0 && pc.why === 'THIS PC DOES NOT ALLOW ITS SCREEN TO BE CHANGED' && answer && answer.fitted === false ? 'PASS' : 'FAIL',
        'without --allow-fit there is no switch, and asking anyway is refused',
        `the [ FIT THE PC TO THIS SCREEN ] key is ${offered ? 'SHOWN' : 'not shown'}; a page that asks anyway is answered: ${JSON.stringify(answer && answer.refusedOutright ? answer : { fitted: answer && answer.fitted, why: answer && answer.why })}; /settings then says allowed ${pc.allowed}, fitted ${pc.fitted}, wanted by ${pc.wantedBy}, why "${pc.why}", the record: ${recorded(pc)}`);
      await a.context.close();
    }
    await finishRun('run 3: no --allow-fit');
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    await finishRun('the run that broke');
  } finally {
    if (other) { try { other.process().kill(); } catch (error) { /* already gone */ } }
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(modesFile, { force: true });
    fs.rmSync(matchFile, { force: true });
  }

  const order = 'abcdefghij';
  parts.sort((x, y) => order.indexOf(x.letter) - order.indexOf(y.letter));
  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= 10;
  result.engineOutput = engineOutput;

  console.log();
  console.log('DEBASER ENGINE :: fit-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, on this PC (127.0.0.1). A DRY RUN THROUGHOUT (DEBASER_PRETEND_MODES): this PC's real screen mode was never changed, and no display call was made.`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  const said = engineOutput.filter((line) => /FIT|fitted|PRETENDED/.test(line) || line.startsWith('---'));
  if (said.length) console.log(`  what the engine printed about the fit:\n${said.map((line) => `      ${line}`).join('\n')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `fit-check-${stamp(new Date())}.json`);
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
