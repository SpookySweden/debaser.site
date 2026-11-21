#!/usr/bin/env node
/**
 * The proof that SOUND works (SPEC-screens.md): what the PC is playing, sent to a viewer that asks for it.
 *
 * The PC may be silent when this runs, so most of it uses a test-only switch: with `DEBASER_PRETEND_TONE=1` the
 * engine sends a steady tone in place of the PC's own sound. Three short runs of the engine, each with a headless
 * Chrome (or Edge) on this same PC:
 *   1. the tone: nothing is sent before `[ SOUND ]` is pressed; once it is, the browser receives and decodes Opus;
 *      the volume; turning it off stops the packets and the PC stops reading; turning it on again; the picture
 *      keeps coming throughout; a device that IS the PC is not offered sound; a browser that wants a press first;
 *   2. an engine started with `--no-sound`;
 *   3. the REAL thing, with no pretending: the engine opens the copy of what this PC is playing ("loopback") and
 *      sends it, and says whether it heard sound or silence.
 *
 * Nothing is played aloud on the PC: the browsers are started with their sound output switched off
 * (`--mute-audio`), which also keeps the check's own browser out of what run 3 hears. No window opens.
 *
 *     node bench/sound-check.cjs            (from the engine folder, after `cargo build --release`)
 *
 * Exit 0: every part passed (a part that "could not tell" does not fail it, and is said plainly).
 * Exit 1: something failed. Exit 3: not run at all, because a League match is running on this PC.
 * Exit 4: not run, because its port is taken (bench/own-port.cjs).
 *
 * What it cannot say: what the sound SOUNDS like, or how long it takes from the PC's speakers to the viewer's.
 * It checks that Opus arrives, is decoded, is not silent, and how long it waits inside the browser.
 */
'use strict';

const fs = require('node:fs');
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

async function startEngine(port, more, environment) {
  const args = ['serve', '--seconds', '40', '--tweaks', '12', '--port', String(port), ...more];
  const child = spawn(ENGINE, args, { cwd: ENGINE_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEBASER_PRETEND_MATCH: '', DEBASER_PRETEND_MATCH_FILE: '', DEBASER_PRETEND_STILL: '', DEBASER_PRETEND_POINTER_FILE: '', DEBASER_PRETEND_TONE: '', ...environment } });
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

/** Opens the viewer page and waits until its picture is flowing and the PC has said how its settings stand. */
async function openViewer(browser, port, query, remembered) {
  const context = await browser.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 });
  if (remembered) await context.addInitScript((kept) => { try { localStorage.setItem('debaser-engine-viewer-v2', JSON.stringify(kept)); } catch (error) { /* carry on */ } }, remembered);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'load', timeout: 8000 });
  const began = Date.now();
  for (;;) {
    const ready = await page.evaluate(async () => {
      const s = await window.__debaserStats();
      return s.framesDecoded > 5 && Boolean(window.__debaserSettings.get()) && typeof keysChannel !== 'undefined' && keysChannel && keysChannel.readyState === 'open';
    });
    if (ready) break;
    if (Date.now() - began > 10000) throw new Error(`The viewer page never got a picture${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
    await sleep(100);
  }
  return { context, page, errors };
}

/** The page's own numbers, with the time they were read. */
const read = (page) => page.evaluate(async () => {
  const s = await window.__debaserStats();
  const player = document.getElementById('sound');
  return {
    at: performance.now(), state: s.connectionState, connectionsMade: s.connectionsMade,
    frames: s.framesDecoded, wait: s.jitterBufferDelay, waited: s.jitterBufferEmittedCount,
    sound: s.sound, playerPaused: player.paused, playerVolume: player.volume,
  };
});
const hostSound = async (port) => (await (await fetch(`http://127.0.0.1:${port}/settings`)).json()).sound;

async function waitFor(test, ms, every = 100) {
  const began = Date.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() - began > ms) return null;
    await sleep(every);
  }
}

/** How long a frame of the picture waited in the browser, on average, between two readings. */
function pictureWait(a, b) {
  const frames = b.waited - a.waited;
  return frames > 0 ? ((b.wait - a.wait) / frames) * 1000 : null;
}
const oneDecimal = (value) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : 'not reported');

async function main() {
  const port = Number(option('--port', String(PORTS.sound)));
  const result = { kind: 'sound-check', when: new Date().toISOString(), pass: false, parts: [] };
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

  let browser = null;
  let strict = null;
  let engine = null;
  const engineOutput = [];
  const finishRun = async (label) => { if (engine) { await engine.stop(); engineOutput.push(`--- ${label} ---`, ...engine.lines().filter((line) => !/^\d+ s\s/.test(line))); engine = null; } };
  try {
    // `--mute-audio`: the browser plays into nothing, so the check is silent on the PC and never hears itself.
    browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
    result.browser = { path: browserPath, version: browser.version(), headless: true, muted: true };

    // ---- Run 1: the test tone. ----
    engine = await startEngine(port, [], { DEBASER_PRETEND_TONE: '1' });
    {
      // "thispc=0": this browser IS on the PC, and must behave as a device that is not (part g is the other way).
      const one = await openViewer(browser, port, '?hold=1&thispc=0');
      const page = one.page;

      // (a) Before anybody asks.
      const quietA = await read(page);
      await sleep(2500);
      const quietB = await read(page);
      const hostBefore = await hostSound(port);
      const keyShown = await page.isVisible('#sound-key');
      const keyPressed = await page.getAttribute('#sound-key', 'aria-pressed');
      part('a', quietB.sound.packetsReceived === 0 && !hostBefore.capturing && hostBefore.listeners === 0 && hostBefore.packetsSent === 0 && keyShown && keyPressed === 'false' && quietB.frames > quietA.frames ? 'PASS' : 'FAIL',
        'nothing is sent, and the PC reads no sound, before [ SOUND ] is pressed',
        `after ${((quietB.at) / 1000).toFixed(1)} s of picture (${quietB.frames} frames): ${quietB.sound.packetsReceived} sound packets received; the PC says listeners ${hostBefore.listeners}, reading its sound ${hostBefore.capturing}, packets sent ${hostBefore.packetsSent}; the [ SOUND ] key is ${keyShown ? 'shown' : 'NOT shown'}, pressed "${keyPressed}"`);

      // (b) Pressed: Opus arrives and is decoded, and it is not silence.
      await page.click('#sound-key');
      const flowing = await waitFor(async () => { const r = await read(page); return r.sound.packetsReceived >= 150 ? r : null; }, 6000);
      const onA = flowing || (await read(page));
      await sleep(2000);
      const onB = await read(page);
      const loud = await waitFor(async () => { const r = await read(page); return r.sound.audioLevel > 0 || r.sound.totalAudioEnergy > 0 ? r : null; }, 3000);
      const heardB = loud || onB;
      const hostOn = await waitFor(async () => { const h = await hostSound(port); return h.heard ? h : null; }, 3000) || (await hostSound(port));
      const perSecond = ((onB.sound.packetsReceived - onA.sound.packetsReceived) * 1000) / (onB.at - onA.at);
      const kbit = ((onB.sound.bytesReceived - onA.sound.bytesReceived) * 8) / (onB.at - onA.at);
      const keyNow = await page.getAttribute('#sound-key', 'aria-pressed');
      const sdp = await page.evaluate(() => connection.remoteDescription.sdp);
      // The answer's lines, one stretch for each "m=" (the picture, the sound, the data channels).
      const streams = sdp.split(/^(?=m=)/m).filter((piece) => piece.startsWith('m=')).map((piece) => ({ kind: /^m=(\w+)/.exec(piece)[1], stream: (/^a=msid:(\S+)/m.exec(piece) || [])[1] || null }));
      const soundStream = (streams.find((s) => s.kind === 'audio') || {}).stream;
      const pictureStream = (streams.find((s) => s.kind === 'video') || {}).stream;
      const goodB = Boolean(flowing) && heardB.sound.mimeType === 'audio/opus' && (heardB.sound.audioLevel > 0 || heardB.sound.totalAudioEnergy > 0) && perSecond > 85 && perSecond < 115 && onB.sound.packetsLost === 0 &&
        hostOn.capturing && hostOn.listeners === 1 && hostOn.source === 'a test tone' && hostOn.heard === 'sound' && keyNow === 'true' && !onB.playerPaused;
      part('b', goodB ? 'PASS' : 'FAIL', 'with [ SOUND ] pressed the browser receives and decodes Opus, and it is not silence',
        `codec ${heardB.sound.mimeType}; ${onB.sound.packetsReceived} packets received, ${onB.sound.packetsLost} lost, ${perSecond.toFixed(0)} a second (100 is one every 10 ms), ${kbit.toFixed(0)} kbit/s; ` +
        `audio level ${heardB.sound.audioLevel} (0 is silence, 1 is full), energy so far ${typeof heardB.sound.totalAudioEnergy === 'number' ? heardB.sound.totalAudioEnergy.toFixed(4) : 'not reported'}; ` +
        `waiting in the browser's queue ${oneDecimal(onB.sound.jitterBufferDelayMsPerSample)} ms a sample; samples the browser had to make up ${onB.sound.concealedSamples} of ${onB.sound.totalSamplesReceived}; ` +
        `the page's player is ${onB.playerPaused ? 'PAUSED' : 'playing'} and the key reads pressed "${keyNow}"\n` +
        `      the PC says: listeners ${hostOn.listeners}, reading ${hostOn.capturing}, source "${hostOn.source}", it heard "${hostOn.heard}", packets sent ${hostOn.packetsSent}\n` +
        `      the sound and the picture are in different streams (so the browser does not hold the picture back for the sound): ${soundStream && pictureStream && soundStream !== pictureStream} (${soundStream} / ${pictureStream})`);
      result.pictureWaitMs = { soundOff: pictureWait(quietA, quietB), soundOn: pictureWait(onA, onB) };

      // (c) The volume, and what is remembered.
      await page.click('#open-settings');
      const panelOn = await page.textContent('#sound-state');
      await page.evaluate(() => { const slider = document.getElementById('volume'); slider.value = '40'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
      const afterVolume = await read(page);
      const kept = await page.evaluate(() => { try { const k = JSON.parse(localStorage.getItem('debaser-engine-viewer-v2')); return { sound: k.sound, volume: k.volume }; } catch (error) { return null; } });
      const volumeSays = await page.textContent('#volume-says');
      const plain = await page.evaluate(() => document.getElementById('panel').textContent.includes('This is everything the PC is playing, not one program'));
      const warningHidden = !(await page.isVisible('#sound-warning'));
      part('c', Math.abs(afterVolume.playerVolume - 0.4) < 0.001 && kept && kept.sound === true && Math.abs(kept.volume - 0.4) < 0.001 && volumeSays === '40%' && panelOn.startsWith('ON.') && plain && warningHidden ? 'PASS' : 'FAIL',
        'the SOUND section: its state, the volume, the plain line, and what this device remembers',
        `the panel says "${panelOn.replace(/\n/g, ' / ')}"; the volume set to 40: the player plays at ${afterVolume.playerVolume} and the panel reads "${volumeSays}"; remembered on the device: sound ${kept ? kept.sound : '?'}, volume ${kept ? kept.volume : '?'}; the line "this is everything the PC is playing" is there: ${plain}; the same-PC warning is hidden on a device that is not the PC: ${warningHidden}`);

      // (d) Off: the packets stop, and the PC stops reading its sound.
      await page.click('#sound-keys button[data-sound="off"]');
      await sleep(600);
      const offA = await read(page);
      await sleep(2000);
      const offB = await read(page);
      const hostOff = await waitFor(async () => { const h = await hostSound(port); return !h.capturing ? h : null; }, 3000) || (await hostSound(port));
      const panelOff = await page.textContent('#sound-state');
      const said = engine.lines().some((line) => line.includes('nobody is listening now'));
      part('d', offB.sound.packetsReceived === offA.sound.packetsReceived && !hostOff.capturing && hostOff.listeners === 0 && offB.playerPaused && panelOff.startsWith('OFF.') && said && offB.frames > offA.frames ? 'PASS' : 'FAIL',
        '[ SOUND OFF ] stops the packets, and the PC stops reading its sound',
        `sound packets received: ${offA.sound.packetsReceived} half a second after the key, ${offB.sound.packetsReceived} two seconds later; the PC says listeners ${hostOff.listeners}, reading ${hostOff.capturing}; the page's player is ${offB.playerPaused ? 'paused' : 'STILL PLAYING'}; the panel says "${panelOff.split('\n')[0]}"; the engine printed that nobody is listening: ${said}`);

      // (e) On again, on the same connection.
      await page.click('#sound-keys button[data-sound="on"]');
      const again = await waitFor(async () => { const r = await read(page); return r.sound.packetsReceived >= offB.sound.packetsReceived + 100 ? r : null; }, 5000);
      const againB = again || (await read(page));
      await page.click('#open-settings');
      part('e', Boolean(again) && againB.connectionsMade === 1 && againB.state === 'connected' && Math.abs(againB.playerVolume - 0.4) < 0.001 ? 'PASS' : 'FAIL', 'on again: the sound comes back on the same connection, at the volume chosen',
        `sound packets received went from ${offB.sound.packetsReceived} to ${againB.sound.packetsReceived}; connections made by the page ${againB.connectionsMade}; the connection is "${againB.state}"; the player's volume ${againB.playerVolume}`);

      // (f) The picture, throughout.
      const marks = [quietA, quietB, onA, onB, offA, offB, againB];
      const grew = marks.every((mark, index) => index === 0 || mark.frames > marks[index - 1].frames);
      const waitOff = result.pictureWaitMs.soundOff;
      const waitOn = result.pictureWaitMs.soundOn;
      part('f', grew && againB.state === 'connected' && (waitOn === null || waitOff === null || waitOn - waitOff < 5) ? 'PASS' : 'FAIL', 'the picture keeps being decoded throughout, and is not held back by the sound',
        `frames decoded, read at each step: ${marks.map((mark) => mark.frames).join(' -> ')}; a frame waited in the browser ${oneDecimal(waitOff)} ms with the sound off and ${oneDecimal(waitOn)} ms with it on`);

      // (g) A device that IS the PC: no key, the warning, and nothing sent even if asked.
      {
        const same = await openViewer(browser, port, '?hold=1');
        const samePage = same.page;
        const shown = await samePage.isVisible('#sound-key');
        await samePage.click('#open-settings');
        const warning = (await samePage.isVisible('#sound-warning')) ? await samePage.textContent('#sound-warning') : '';
        const choices = await samePage.isVisible('#sound-choices');
        const stateSays = await samePage.textContent('#sound-state');
        await samePage.evaluate(() => turnSound(true, true));
        await sleep(1200);
        const after = await read(samePage);
        const offered = after.sound.offered;
        part('g', !shown && warning === 'ON THIS PC THE SOUND WOULD FEED BACK INTO ITSELF' && !choices && !offered && after.sound.packetsReceived === 0 && !after.sound.on ? 'PASS' : 'FAIL',
          'on the PC itself (the page loaded from 127.0.0.1) sound is not offered',
          `the [ SOUND ] key is ${shown ? 'SHOWN' : 'absent'}; the panel warns "${warning}" and says "${stateSays}"; its ON and OFF keys are ${choices ? 'SHOWN' : 'absent'}; asking through the page's own function anyway: sound on ${after.sound.on}, ${after.sound.packetsReceived} sound packets received`);
        await same.context.close();
      }

      // (h) Sound left on at the last visit, in a browser that wants a press before it plays anything.
      {
        strict = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=document-user-activation-required', '--mute-audio'] });
        // The page is opened and then left entirely alone for three seconds: anything this script asks of a page
        // counts, to the browser, as a person having pressed something on it.
        const visit = { context: await strict.newContext({ viewport: VIEW, screen: VIEW, deviceScaleFactor: 1 }) };
        await visit.context.addInitScript((kept) => { try { localStorage.setItem('debaser-engine-viewer-v2', JSON.stringify(kept)); } catch (error) { /* carry on */ } }, { sound: true, volume: 0.7 });
        const visitPage = await visit.context.newPage();
        await visitPage.goto(`http://127.0.0.1:${port}/?hold=1&thispc=0`, { waitUntil: 'load', timeout: 8000 });
        await sleep(3000);
        const before = await read(visitPage);
        await visitPage.click('#open-settings');
        const note = await visitPage.textContent('#sound-state');
        await visitPage.click('#open-settings');
        const settled = await waitFor(async () => { const r = await read(visitPage); return r.sound.packetsReceived === before.sound.packetsReceived ? r : null; }, 2000, 700);
        const refusedFirst = !before.sound.on && note.includes('PRESS [ SOUND ]');
        if (refusedFirst) await visitPage.click('#sound-key');
        const played = await waitFor(async () => { const r = await read(visitPage); return r.sound.packetsReceived >= (settled || before).sound.packetsReceived + 80 ? r : null; }, 5000);
        // Some builds of the browser play straight away whatever they are told; then there is nothing to refuse.
        const verdict = played && refusedFirst ? 'PASS' : played && before.sound.on ? 'COULD NOT TELL' : 'FAIL';
        part('h', verdict, 'sound left on at the last visit: a browser that wants a press first is given one, and nothing is sent until then',
          `opened with sound remembered as on, in a browser told to refuse sound nobody pressed for: sound on ${before.sound.on}, the panel says "${note.replace(/\n/g, ' / ')}", ${before.sound.packetsReceived} sound packets received; after one press of [ SOUND ]: ${played ? `${played.sound.packetsReceived} packets, playing at volume ${played.playerVolume}` : 'NOTHING'}` +
          (verdict === 'COULD NOT TELL' ? '\n      This browser played without a press, so the refusal could not be seen.' : ''));
        await visit.context.close();
        await strict.close();
        strict = null;
      }
      await one.context.close();
    }
    await finishRun('run 1: the test tone');

    // ---- Run 2: an engine that was told never to send sound. ----
    engine = await startEngine(port, ['--no-sound'], { DEBASER_PRETEND_TONE: '1' });
    {
      const one = await openViewer(browser, port, '?hold=1&thispc=0');
      const page = one.page;
      const host = await hostSound(port);
      const shown = await page.isVisible('#sound-key');
      await page.click('#open-settings');
      const says = await page.textContent('#sound-state');
      await page.evaluate(() => { soundTrack && tellPcSound(true); });
      await sleep(1200);
      const after = await read(page);
      const hostAfter = await hostSound(port);
      part('i', !host.allowed && !shown && says.startsWith('THIS PC IS NOT SENDING SOUND') && after.sound.packetsReceived === 0 && !hostAfter.capturing && hostAfter.listeners === 0 && after.frames > 5 ? 'PASS' : 'FAIL',
        'an engine started with --no-sound sends none, whoever asks',
        `/settings says sound allowed ${host.allowed}; the [ SOUND ] key is ${shown ? 'SHOWN' : 'absent'}; the panel says "${says.replace(/\n/g, ' / ')}"; a page that asks anyway: ${after.sound.packetsReceived} sound packets, the PC reading its sound ${hostAfter.capturing}, listeners ${hostAfter.listeners}`);
      await one.context.close();
    }
    await finishRun('run 2: --no-sound');

    // ---- Run 3: the real thing. No pretending: the copy of what this PC is playing. ----
    engine = await startEngine(port, [], {});
    {
      const one = await openViewer(browser, port, '?hold=1&thispc=0');
      const page = one.page;
      await page.click('#sound-key');
      const flowing = await waitFor(async () => { const r = await read(page); return r.sound.packetsReceived >= 150 ? r : null; }, 6000);
      const a = flowing || (await read(page));
      await sleep(2000);
      const b = await read(page);
      const host = await waitFor(async () => { const h = await hostSound(port); return h.heard || h.problem ? h : null; }, 3000) || (await hostSound(port));
      const perSecond = ((b.sound.packetsReceived - a.sound.packetsReceived) * 1000) / (b.at - a.at);
      const kbit = ((b.sound.bytesReceived - a.sound.bytesReceived) * 8) / (b.at - a.at);
      const opened = engine.lines().find((line) => line.startsWith('SOUND:') && line.includes('asked for it')) || '';
      const good = Boolean(flowing) && host.capturing && !host.problem && host.source === 'everything the PC is playing' && (host.heard === 'sound' || host.heard === 'silence') && b.sound.mimeType === 'audio/opus' && perSecond > 85 && perSecond < 115;
      result.real = { heard: host.heard, problem: host.problem, packetsPerSecond: perSecond, kbitPerSecond: kbit, audioLevel: b.sound.audioLevel, queueMs: b.sound.jitterBufferDelayMsPerSample };
      part('r', good ? 'PASS' : 'FAIL', 'REAL: the copy of what this PC is playing opens without error and is sent (whatever it hears)',
        `the engine said: "${opened}"\n` +
        `      the PC says: reading its sound ${host.capturing}, problem ${host.problem ? `"${host.problem}"` : 'none'}, and in the last second it heard: ${host.heard ? host.heard.toUpperCase() : 'nothing yet'}\n` +
        `      the browser received ${b.sound.packetsReceived} packets of ${b.sound.mimeType}, ${perSecond.toFixed(0)} a second, ${kbit.toFixed(0)} kbit/s, ${b.sound.packetsLost} lost; audio level ${b.sound.audioLevel}; ${oneDecimal(b.sound.jitterBufferDelayMsPerSample)} ms a sample in the browser's queue` +
        (host.heard === 'silence' ? '\n      The PC was playing nothing during the run, so what was sent was silence (a few bytes a packet).' : ''));
      await one.context.close();
    }
    await finishRun('run 3: REAL (no pretending)');
  } catch (error) {
    result.failure = String(error && error.message ? error.message : error);
    await finishRun('the run that broke');
  } finally {
    if (strict) await strict.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const order = 'abcdefghir';
  parts.sort((x, y) => order.indexOf(x.letter) - order.indexOf(y.letter));
  const failed = parts.filter((p) => p.verdict === 'FAIL');
  const unsure = parts.filter((p) => p.verdict === 'COULD NOT TELL');
  result.pass = !result.failure && failed.length === 0 && parts.length >= 10;
  result.engineOutput = engineOutput;

  console.log();
  console.log('DEBASER ENGINE :: sound-check');
  console.log(`  ${result.pass ? 'PASS' : 'FAIL'}. ${parts.filter((p) => p.verdict === 'PASS').length} parts passed, ${failed.length} failed, ${unsure.length} could not be told.`);
  if (result.browser) console.log(`  browser: ${path.basename(browserPath)} ${result.browser.version}, headless, its sound output switched off, on this PC (127.0.0.1). Parts (a) to (i) use a test tone (DEBASER_PRETEND_TONE=1); (r) is the PC's real sound.`);
  for (const p of parts) {
    console.log(`  (${p.letter}) ${p.verdict}: ${p.what}`);
    console.log(`      ${p.seen}`);
  }
  if (result.failure) console.log(`  STOPPED: ${result.failure}`);
  const said = engineOutput.filter((line) => /SOUND|sound/.test(line) || line.startsWith('---'));
  if (said.length) console.log(`  what the engine printed about sound:\n${said.map((line) => `      ${line}`).join('\n')}`);

  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `sound-check-${stamp(new Date())}.json`);
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
