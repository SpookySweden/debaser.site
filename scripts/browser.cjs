/**
 * The browser instrument: one Chrome, driven by `playwright-core`, and the shared vocabulary every tool
 * in `scripts/` uses - arriving, **refusing when the address did not answer**, finding a control the way
 * a reader does, pointing at it, typing into it, dragging it, and taking a picture.
 *
 * **Why Playwright, and why `playwright-core` rather than `playwright`.** This was a hand-rolled CDP
 * client for most of the project's life, on the argument that a WebSocket library is a dependency a
 * diagnostic should not need. It was replaced deliberately: typing, keys, drags, media emulation and
 * traces are a lot of protocol to hand-roll, and every one of them was a question that had to be
 * answered by reading source instead of by pressing something. `playwright-core` is the *core*: it has
 * no bundled browser and no download step (a `playwright` install wants ~130MB of Chromium, which is
 * exactly what had silently failed here before), and it drives the Chrome already on the machine
 * through `channel: 'chrome'`. The software GL args are unchanged, because they are still load-bearing:
 * `--use-angle=swiftshader --enable-unsafe-swiftshader` is what makes WebGL exist in a headless build.
 *
 * **The refusal is the one rule that must survive the change of transport.** Chrome's own error page is
 * a *page*: it renders, it has a body, and it answers `0` canvases - which reads as "the pane is empty"
 * when the truth is "there was no server". `Temp/browse/account.png` is exactly that file, and two
 * instruments then reported `0 panes` and `no WebGL context` about it. So `goto` **throws `NoAnswer`
 * before any file is written**, and it does so on two independent signals: the `net::ERR_*` name Chrome
 * refuses the navigation with, and the shared `ARRIVAL_PROBE` read out of the page afterwards. Both are
 * kept because they fail differently - a refused connection throws before there is a page to read, and
 * an error page reached some other way only shows in the probe.
 *
 * **A second browser is not started while one is running.** `npm run browser -- --start` opens a Chrome
 * that outlives the tool that started it (detached, kept profile, a fixed debug port written to
 * `Temp/browse/browser.json`), and every tool here attaches to it when it is up. That is what makes a
 * session cost one sign-in instead of one per run, and a re-capture take seconds. `--fresh` reloads
 * before the steps, because an attached session is *stateful* and a capture from it is not a first
 * visit - a thing the output has to say, not a thing the caller has to remember.
 *
 * **What it cannot do, stated here because this file is where the capability lives**: it cannot decide
 * which sequence to press, cannot feel a drag, cannot judge whether a picture looks right, and one
 * still frame cannot show motion. A `READING...` in a capture is a pre-hydration state, not a result.
 */
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const BROWSE = path.join('Temp', 'browse');
const SESSION_FILE = path.join(BROWSE, 'browser.json');

/** Chrome, in the order it is looked for. The first that exists is used, or the run refuses. */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

/**
 * The software GL, and nothing else. A headless Chrome without `--use-angle=swiftshader` has **no
 * WebGL**, so a blank canvas would say nothing about the code under test - and the workbench is a
 * `<canvas>`. Every launch in this repository goes through here so no tool can forget it.
 */
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A refused arrival, as a distinct kind of failure.
 *
 * It is an `Error` so the caller's `finally` still runs, and it carries `noAnswer` so a tool can print
 * the refusal rather than a stack trace.
 */
class NoAnswer extends Error {
  constructor(url, detail) {
    super(`nothing answered at ${url} (${detail})`);
    this.name = 'NoAnswer';
    this.url = url;
    this.detail = detail;
    this.noAnswer = true;
  }
}

/** Whether a debug port is answering, and what it says. Used to find a session and to wait for one. */
function debugPort(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('bad JSON from /json/version'));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(4000, () => request.destroy(new Error('timeout')));
  });
}

/**
 * The project's own environment, loaded by the script rather than demanded on the command line.
 *
 * `--signin` needs `NEXT_PUBLIC_SUPABASE_URL` and the anon key, which live in `.env.local`. Next loads
 * that file for the *app*; a standalone script does not, so `--signin` used to fail with "no Supabase
 * project in the environment" unless the caller happened to remember `node --env-file`. `loadEnvFile`
 * is Node's own dotenv (Node 21+), so this costs no dependency.
 */
function loadEnv(file = '.env.local') {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return true;

  try {
    process.loadEnvFile(file);
    return true;
  } catch {
    return false;
  }
}

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

  if (!chrome) {
    console.log(`NO BROWSER: tried ${CHROME_CANDIDATES.join(', ')}`);
    console.log('  playwright-core drives the browser you already have; it does not download one.');
    process.exit(2);
  }

  return chrome;
}

/**
 * The arrival probe: what address the page *says* it is, whether it is the browser's own error page,
 * and enough text to name the failure. Kept as a string so every tool evaluates the same text.
 */
const ARRIVAL_PROBE = `(() => ({
  href: location.href,
  title: document.title,
  documentClass: document.documentElement.className,
  text: (document.body ? document.body.innerText : '').slice(0, 4000),
}))()`;

/** The `ERR_...` a Chrome error page names, or `null` when the page is a page. */
function noAnswerOf(arrival) {
  if (!arrival) return null;

  if (typeof arrival.href === 'string' && arrival.href.startsWith('chrome-error:')) {
    return /\bERR_[A-Z0-9_]+/.exec(arrival.text ?? '')?.[0] ?? 'the browser error page';
  }

  if (typeof arrival.documentClass === 'string' && arrival.documentClass.includes('neterror')) {
    return /\bERR_[A-Z0-9_]+/.exec(arrival.text ?? '')?.[0] ?? 'the browser error page';
  }

  return null;
}

/** The `ERR_...` out of a thrown navigation failure, or `null`. */
function netErrorOf(error) {
  return /net::(ERR_[A-Z0-9_]+)/.exec(String(error?.message ?? ''))?.[1] ?? null;
}

/** The small flag reader every tool shares: `--flag value`, or `--flag` for a boolean. */
function flags(argv = process.argv.slice(2)) {
  const at = (flag, fallback) => {
    const index = argv.indexOf(flag);

    return index === -1 ? fallback : argv[index + 1];
  };

  return {
    argv,
    has: (flag) => argv.includes(flag),
    at,
    number: (flag, fallback) => {
      const raw = at(flag, null);

      return raw === null ? fallback : Number(raw);
    },
    /** Every occurrence, in the order given: `--click a --click b` is a sequence of presses. */
    all: (flag) => argv.reduce((out, value, index) => (value === flag ? [...out, argv[index + 1]] : out), []),
  };
}

/**
 * The in-page search, as text: **exact text first, then the first line, then a prefix, then a substring**,
 * and an ambiguity is a *result* rather than a guess.
 *
 * The preference order is not a detail, and every tier of it was earned by a wrong press. The stage buttons
 * read `MASS` and the edit row beside them reads `MASS GEOMETRY`, so a search that starts at the top of the
 * document finds the wrong one; and the stage buttons are really rendered `MASSTHE SHAPE AS EDGES - A
 * WIREFRAME...`, so a *substring* pass reaches the palette's help text before the button. Exact wins, then
 * the first line, then a prefix of the whole text, then a substring.
 *
 * **A loose pass with more than one candidate is now a refusal.** That is the one behaviour this
 * rewrite adds on purpose: picking the first of several matches is how a press lands somewhere the
 * caller did not name, and the transcript then *says* it pressed the thing it meant - so the fault is
 * invisible. A caller can accept the ambiguity with `allowAmbiguous`, which is a decision rather than
 * an accident.
 *
 * Coordinates are returned twice: in the viewport, which is where a pointer goes, and in the page,
 * which is where a screenshot's `clip` is measured. The control is scrolled to the middle first, so a
 * press cannot land on a control that is off-screen.
 */
function controlExpression(target, within, allowAmbiguous) {
  return `(() => {
    const wanted = ${JSON.stringify(target)}.trim().toLowerCase();
    const looksLikeSelector = /^[#.\\[]/.test(wanted) || /^[a-z]+[.#\\[:]/i.test(wanted);

    let root = document;
    if (${JSON.stringify(within)} !== null) {
      const phrase = ${JSON.stringify(within)}.toLowerCase();
      const matches = [...document.querySelectorAll('fieldset, section, main, aside, div, form')].filter(
        (element) => (element.innerText || '').toLowerCase().includes(phrase),
      );

      /*
       * The INNERMOST container holding the phrase, not the first one found. The first match in document
       * order is the outer <main>, which contains the whole workbench - and scoping to that is scoping to
       * nothing: the edit rows (MASS GEOMETRY, BASE RENDER) collide with the stage buttons again, which is
       * exactly the wrong press this scope exists to prevent.
       */
      const innermost = matches.filter(
        (element) => !matches.some((other) => other !== element && element.contains(other)),
      );
      const scope = innermost[innermost.length - 1] ?? matches[0];

      if (!scope) {
        return { found: false, why: 'no container whose text contains ' + JSON.stringify(${JSON.stringify(within)}) };
      }
      root = scope;
    }

    const labelOf = (element) =>
      (element.innerText || element.getAttribute('aria-label') || element.tagName).trim().slice(0, 48);

    const describe = (element, how) => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return {
        found: true,
        how,
        label: labelOf(element),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        pageX: Math.round(rect.x + window.scrollX),
        pageY: Math.round(rect.y + window.scrollY),
      };
    };

    if (looksLikeSelector) {
      const matches = [...root.querySelectorAll(${JSON.stringify(target)})];
      if (matches.length > 0) {
        const described = describe(matches[0], 'selector');
        described.matches = matches.length; // a selector is an explicit choice; the count is reported
        return described;
      }
    }

    const candidates = [
      ...root.querySelectorAll('button, a, [role="button"], label, summary, input, h1, h2, h3, p, span'),
    ];
    const firstLine = (element) =>
      (element.innerText || '').trim().split(String.fromCharCode(10))[0].trim().toLowerCase();
    const whole = (element) => (element.innerText || '').trim().toLowerCase();

    const byExact = candidates.find((element) => whole(element) === wanted);
    if (byExact) return describe(byExact, 'text');

    const byFirstLine = candidates.find((element) => firstLine(element) === wanted);
    if (byFirstLine) return describe(byFirstLine, 'text');

    /*
     * Prefix, before substring. The stage buttons render as MASSTHE SHAPE AS EDGES - A WIREFRAME..., so
     * their whole text does not *equal* MASS, and a substring pass reaches the palette's help text -
     * BUILD A FIGURE FROM A SKELETON AND THE MASS HUNG - first. That is not hypothetical: it is what a run
     * of this very tool did, pressing the help text and measuring an unchanged stage three times. A prefix
     * match picks the button whose text *begins* with what was asked for, which is what naming a plate by
     * its label means.
     */
    const byPrefix = candidates.find((element) => whole(element).startsWith(wanted));
    if (byPrefix) return describe(byPrefix, 'text-prefix');

    /*
     * The same, with the plate's brackets and padding taken off first: the plates read [ CHAR ], and a
     * caller should be able to name the verb rather than the decoration. This tier sits after the plain
     * prefix so an exact reading always wins, and ambiguity is still reported rather than guessed at.
     */
    const bare = (element) =>
      whole(element).replace(/^[\\s\\[(]+/, '').replace(/[\\s\\]()]+$/, '');
    const byBarePrefix = candidates.find((element) => bare(element).startsWith(wanted));
    if (byBarePrefix) return describe(byBarePrefix, 'text-bare-prefix');

    const loose = candidates.filter((element) => whole(element).startsWith(wanted));
    if (loose.length === 1) return describe(loose[0], 'text-partial');

    if (loose.length > 1) {
      const labels = loose.map(labelOf);
      if (${allowAmbiguous ? 'true' : 'false'}) return describe(loose[0], 'text-partial-ambiguous');
      return {
        found: false,
        why: 'ambiguous',
        candidates: labels,
        detail: loose.length + ' controls contain that text: ' + labels.map((l) => JSON.stringify(l)).join(', '),
      };
    }

    return { found: false, why: 'nothing on the page reads ' + JSON.stringify(${JSON.stringify(target)}) };
  })()`;
}

/** Find a control by its text (or a selector), the way a reader does. See `controlExpression`. */
function findControl(page, target, { within = null, allowAmbiguous = false } = {}) {
  return page.evaluate(controlExpression(target, within, allowAmbiguous));
}

/**
 * A real pointer move, through the browser's own input path: the hover a person makes, not a class added
 * by a script. `:hover` in the stylesheet is what these tools need to see, and React's synthetic events
 * come with it.
 */
async function hover(page, x, y) {
  await page.mouse.move(x, y);
}

/** A real press and release, at the control's own coordinates. */
async function click(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Drag one control onto a point, as a sequence of real mouse moves.
 *
 * The moves are *steps*, not one jump: React's pointer handlers see `pointermove` events, and a single
 * move to the destination is a drag a component can legitimately not notice. What this cannot do is
 * judge whether the drag did what it looked like it did - that is read back from the page, or it is not
 * read at all.
 */
async function drag(page, from, to, { steps = 24 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await sleep(120);
  await page.mouse.up();
}

/**
 * Force `:focus` and `:focus-visible` onto a node, through the CSS domain.
 *
 * This is what the stylesheet does under focus, and it is honest about being that: it is not the tab
 * order, and it does not prove a keyboard can reach the control. `element.focus()` alone is not enough,
 * because `:focus-visible` needs a *keyboard* interaction to match, and the plates key their look off
 * it. Playwright has no equivalent, so this is the one place a raw CDP session is still used - on
 * purpose, and with the same call as before.
 */
async function forceFocus(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');

  const root = await cdp.send('DOM.getDocument', { depth: -1 });
  const found = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector });

  if (!found.nodeId) return { forced: false, why: `no element matches ${selector}` };

  await cdp.send('CSS.forcePseudoState', { nodeId: found.nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });

  return { forced: true, selector };
}

/**
 * The arrival probe, retried, because a navigation that was *refused* can destroy the execution context
 * as the error page takes over. A single failed evaluate there is not a statement about the page.
 */
async function probeArrival(page, { attempts = 4 } = {}) {
  let last = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await page.evaluate(ARRIVAL_PROBE);
    } catch (error) {
      last = error;
      await sleep(400);
    }
  }

  throw last;
}

/**
 * Open a browser: the machine's own Chrome, headless, with the software GL.
 *
 * Two ways in, and the difference matters:
 *
 * - **a fresh throwaway browser** (the default) - `launchPersistentContext` on a profile directory that
 *   is removed at the end, which is what the old `--profile` flag meant and what keeps a capture from
 *   carrying yesterday's cookies;
 * - **`attach`** - connect to the browser `npm run browser -- --start` left running. The *profile* is
 *   kept, so a signed-in page stays signed in between runs, and a re-capture costs seconds. An attached
 *   session is stateful: a capture from it is not a first visit, and the tools say so.
 *
 * The viewport goes through `Emulation.setDeviceMetricsOverride` rather than Playwright's own viewport
 * option, for two reasons: `--scale` below 1 is what makes a cheap reading possible, and `--window-size`
 * includes the browser chrome - the override is in CSS pixels and is what the old tools already used.
 */
async function open({
  size = [1440, 1000],
  mobile = false,
  scale = 1,
  profile = null,
  keepProfile = false,
  attach = false,
  reducedMotion = false,
} = {}) {
  const [width, height] = size;
  const log = { console: [], errors: [], failed: [], bad: [] };
  let browser = null;
  let context = null;
  let page = null;
  let owned = false;
  let profileDir = null;
  let port = null;

  if (attach) {
    const session = await sessionAlive();

    if (!session) {
      throw new Error('no browser session is running: start one with `npm run browser -- --start`');
    }

    port = session.port;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    context = browser.contexts()[0] ?? (await browser.newContext());
    page = context.pages().find((candidate) => !candidate.isClosed()) ?? (await context.newPage());
  } else {
    findChrome(); // refuses with the paths it tried, rather than an exception from deep inside Playwright

    profileDir = path.resolve(profile ?? path.join(BROWSE, 'browser-profile'));
    if (!keepProfile) rmSync(profileDir, { recursive: true, force: true });
    mkdirSync(profileDir, { recursive: true });

    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: true,
      viewport: { width, height },
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
      args: [...GL_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars'],
    });

    browser = context.browser();
    page = context.pages()[0] ?? (await context.newPage());
    owned = true;
  }

  const cdp = await context.newCDPSession(page);
  await cdp
    .send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile,
      screenWidth: width,
      screenHeight: height,
    })
    .catch(() => {
      /* the override is an optimisation for --scale; the Playwright viewport is already correct at 1 */
    });
  if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});

  page.on('console', (message) => log.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => log.errors.push(String(error?.message ?? error)));
  page.on('requestfailed', (request) =>
    log.failed.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText ?? 'failed'}`),
  );
  // A 404 is not a *failed request* - it is a response with a bad status, and it never appears in
  // `requestfailed`. Naming it is the difference between "a resource did not load" and knowing which.
  page.on('response', (response) => {
    if (response.status() >= 400) log.bad.push(`${response.status()} ${response.url()}`);
  });

  return { browser, context, page, cdp, log, owned, profileDir, port, size: [width, height], attached: attach };
}

/**
 * Go to an address and wait for it to have *arrived*, then refuse if it did not answer.
 *
 * `readyState` is polled rather than slept through, because a fixed sleep passes on a fast machine and
 * reports "no canvas" on a slow one - which is a statement about the machine. `--wait-for` waits for a
 * phrase or a selector to be *visible* before the settle, which is the honest way to wait for a client
 * chunk: the workbench is `ssr: false`, so it appears after load, and "it was not there yet" and "it
 * never came" are different findings.
 *
 * **The throw is the point**: a refused capture written to disk is indistinguishable from a real one
 * afterwards, and every tool downstream reads it happily.
 */
async function goto(page, url, { settle = 3000, waitFor = null, allowErrorPage = false, timeout = 20000 } = {}) {
  let refused = null;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (error) {
    refused = netErrorOf(error);
    if (refused === null) throw error;
    await sleep(700); // the error page is rendered after the navigation is rejected
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await page.evaluate(() => document.readyState).catch(() => null);
    if (state === 'complete') break;
    await sleep(250);
  }

  if (waitFor !== null) await waitForControl(page, waitFor, { timeout: Math.max(timeout, settle) });

  await sleep(settle);

  const arrival = await probeArrival(page);
  const detail = refused ?? noAnswerOf(arrival);

  if (detail !== null && !allowErrorPage) throw new NoAnswer(url, detail);

  return { ...arrival, refused };
}

/** Wait until a phrase or a selector is visible - and say so when it never appears. */
async function waitForControl(page, target, { timeout = 20000 } = {}) {
  const looksLikeSelector = /^[#.\[]/.test(target) || /^[a-z]+[.#\[:]/i.test(target);

  try {
    if (looksLikeSelector) await page.waitForSelector(target, { state: 'visible', timeout });
    else await page.getByText(target).first().waitFor({ state: 'visible', timeout });

    return { appeared: true, target };
  } catch (error) {
    throw new Error(
      `--wait-for ${JSON.stringify(target)} never appeared in ${timeout}ms ` +
        `(${String(error.message).split('\n')[0]}) - so the page loaded and this is about the content`,
    );
  }
}

/**
 * Take the picture, and write it.
 *
 * `clip` is a rectangle measured *in the page*, which is what `findControl` returns as `pageX/pageY`, so
 * a caller names an element rather than a scrolled position. `fullPage` is the whole document; Playwright
 * forbids it together with `clip`, so the two are exclusive here as well.
 */
async function capture(page, { out, fullPage = false, clip = null, type = 'png' } = {}) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const options = { path: out, type };

  if (clip) {
    const offsets = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    options.clip = {
      x: clip.pageX ?? clip.x + offsets.x,
      y: clip.pageY ?? clip.y + offsets.y,
      width: clip.w,
      height: clip.h,
    };
  } else if (fullPage) {
    options.fullPage = true;
  }

  const bytes = await page.screenshot(options);

  return { file: out, bytes: bytes.length };
}

/** Type text into whatever has focus, or into a control named by its text first. */
async function type(page, text, { target = null, within = null, allowAmbiguous = false } = {}) {
  if (target !== null) {
    const found = await findControl(page, target, { within, allowAmbiguous });
    if (!found.found) throw new Error(`cannot type into ${JSON.stringify(target)}: ${found.detail ?? found.why}`);

    await click(page, found.x, found.y);
    await sleep(120);
  }

  await page.keyboard.insertText(text);
}

/** A real key press - `Enter`, `Tab`, `Shift+Tab`, `Escape`, `ArrowDown`. */
async function key(page, name) {
  await page.keyboard.press(name);
}

/** One wheel event, in pixels. Scrolling is a real reader action and is honest about being coarse. */
async function scroll(page, by) {
  await page.mouse.wheel(0, by);
}

/**
 * What the page said while the tool was looking at it, printed rather than swallowed.
 *
 * A `console.warn` was invisible to every check here for most of the project's life, and three.js put the
 * one that mattered in exactly that channel (*"Outline requires `<EffectComposer autoClear={false}>`"*).
 * A tool that reads pixels should not also be the tool that hides the reason they are wrong.
 */
function report(log, { limit = 10 } = {}) {
  const noise = log.console.filter((entry) => entry.type === 'error' || entry.type === 'warning');

  if (log.errors.length > 0) {
    console.log('');
    console.log(`page errors (${log.errors.length}):`);
    for (const error of log.errors.slice(0, limit)) console.log(`  ${error.split('\n')[0].slice(0, 160)}`);
  }

  if (noise.length > 0) {
    console.log('');
    console.log(`console errors and warnings (${noise.length}):`);
    for (const entry of noise.slice(0, limit)) console.log(`  ${entry.type}: ${entry.text.slice(0, 160)}`);
  }

  if (log.failed.length > 0) {
    console.log('');
    console.log(`failed requests (${log.failed.length}):`);
    for (const failure of log.failed.slice(0, limit)) console.log(`  ${failure.slice(0, 160)}`);
  }

  if (log.bad.length > 0) {
    console.log('');
    console.log(`responses with a bad status (${log.bad.length}):`);
    for (const bad of log.bad.slice(0, limit)) console.log(`  ${bad.slice(0, 160)}`);
  }

  return { errors: log.errors.length, noise: noise.length, failed: log.failed.length, bad: log.bad.length };
}

/**
 * End the browser and give the profile back.
 *
 * `launch()` removed the profile when it *started*, which left one behind after every run - twelve of
 * them, about 36MB each, were sitting in `Temp/browse/` when that was noticed. So every tool awaits this
 * in its `finally`, and the removal waits for the process to die, because Chrome holds the directory open
 * for a moment and a `rmSync` that races it fails on Windows.
 *
 * **An attached browser is left running** - that is the whole point of it. `browser.close()` on a
 * `connectOverCDP` connection disconnects rather than ending Chrome (measured on playwright-core 1.63.0,
 * 2026-09-29: the debug port still answered afterwards), so an attached session survives the tool.
 */
async function close(session, { keep = false } = {}) {
  if (!session) return;

  try {
    if (session.context) await session.context.close();
  } catch {
    /* already gone */
  }

  try {
    if (session.browser) await session.browser.close();
  } catch {
    /* already gone */
  }

  if (session.owned && !keep && session.profileDir) {
    await sleep(600);

    try {
      rmSync(session.profileDir, { recursive: true, force: true });
    } catch {
      /* Chrome still holds a file; the next launch removes it, which used to be the only rule */
    }
  }
}

/**
 * The reusable session, on disk.
 *
 * `Temp/browse/browser.json` is the session *file* rather than a remembered port, because a tool that
 * guesses a port is a tool that attaches to whichever Chrome happens to hold it. `sessionAlive` is the
 * only thing that decides whether a browser is up, and it asks the debug port rather than the file - a
 * file left behind by a killed browser is a file that says a browser is there when none is.
 */
const SESSION_PORT = 9410;

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** The running session, or `null`: never the file's opinion on its own. */
async function sessionAlive() {
  const session = readSession();
  if (!session || !session.port) return null;

  try {
    const version = await debugPort(session.port);
    return { ...session, browser: version.Browser };
  } catch {
    return null;
  }
}

/** `taskkill /T` - Chrome's child processes hold the profile open, so the tree goes, not the launcher. */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve(false);
      return;
    }

    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('exit', (code) => resolve(code === 0));
    killer.on('error', () => resolve(false));
  });
}

/**
 * Start the browser every tool will attach to, and remember its port.
 *
 * It is **detached** and its profile is **kept**, which is the difference between a session and a run: the
 * signed-in page state, the loaded chunks and the cookies survive between tools, so reaching the workbench
 * costs one sign-in for a whole working session rather than one per capture. What it is *not* is evidence:
 * a capture from an attached browser is not a first visit, and every tool that attaches says so.
 */
async function startSession({
  port = SESSION_PORT,
  profile = path.join(BROWSE, 'session-profile'),
  size = [1440, 1000],
} = {}) {
  const alive = await sessionAlive();
  if (alive) return { ...alive, alreadyRunning: true };

  const chrome = findChrome();
  const absolute = path.resolve(profile);
  mkdirSync(absolute, { recursive: true });

  const child = spawn(
    chrome,
    [
      `--user-data-dir=${absolute}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--window-size=${size[0]},${size[1]}`,
      ...GL_ARGS,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  let version = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      version = await debugPort(port);
      break;
    } catch {
      await sleep(400);
    }
  }

  if (!version) {
    await killTree(child.pid);
    throw new Error(`the browser never opened a debug port on ${port}`);
  }

  const session = {
    port,
    profile: absolute,
    pid: child.pid,
    browser: version.Browser,
    startedAt: new Date().toISOString(),
  };

  mkdirSync(BROWSE, { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`);

  return session;
}

/** End the session: the browser, the file, and the profile unless it was asked for. */
async function stopSession({ keepProfile = false } = {}) {
  const session = readSession();
  if (!session) return { stopped: false, why: 'no session file' };

  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
    await browser.close();
  } catch {
    /* already gone, or never answered */
  }

  await sleep(400);

  // Measured to be necessary: `browser.close()` on a CDP connection disconnects rather than ending
  // Chrome, so the process tree is what actually closes the session's browser.
  if (await debugPort(session.port).then(() => true).catch(() => false)) await killTree(session.pid);

  try {
    rmSync(SESSION_FILE, { force: true });
  } catch {
    /* nothing to remove */
  }

  if (!keepProfile && session.profile) {
    await sleep(500);
    try {
      rmSync(path.resolve(session.profile), { recursive: true, force: true });
    } catch {
      /* a file is still held; the next start removes it */
    }
  }

  return { stopped: true, port: session.port, profile: keepProfile ? session.profile : null };
}

/**
 * Sign an account up, and hand back the session as the *browser* would hold it.
 *
 * `@supabase/supabase-js` reads a session out of `localStorage` under `sb-<project-ref>-auth-token`
 * (the ref being the first label of the project hostname) - read out of
 * `node_modules/@supabase/supabase-js/dist/umd/supabase.js`, where the key is built. So a script can hand
 * a page a session it obtained over the REST API, which is how a page behind a session gets captured
 * without anybody typing a password into a browser window: **the tool does not need a password, and it
 * must never print a token.**
 *
 * The account is one of the throwaway ones the checks already make. It cannot be deleted from here - that
 * takes the service role - so `npm run db:sweep` is what clears it up afterwards, and the count of
 * accounts a session leaves behind is one, not one per capture.
 */
async function signUp(email, password, displayName) {
  loadEnv();

  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { error: 'no Supabase project in the environment and no readable .env.local' };

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error !== null) return { error: error.message };
  if (data.session === null) {
    return { error: 'the account was made but the project has email confirmation on, so there is no session' };
  }

  return {
    storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
    session: data.session,
    userId: data.user.id,
  };
}

/** The localStorage key a Supabase session lives under, for a project. */
function storageKeyFor(url) {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

/**
 * Hand the page a session **before its own scripts run**, so it never renders signed-out at all.
 *
 * It is installed on the *page* rather than the context so that attaching to a session and navigating to a
 * URL works the same way a fresh launch does: Playwright applies a page's init scripts to every following
 * navigation, which is exactly the guarantee the old `Page.addScriptToEvaluateOnNewDocument` gave.
 */
async function installSession(page, { storageKey, session }) {
  const source =
    `try { window.localStorage.setItem(${JSON.stringify(storageKey)}, ` +
    `${JSON.stringify(JSON.stringify(session))}); } catch (error) { /* storage denied */ }`;

  await page.addInitScript({ content: source });

  return { installed: true, storageKey };
}

/** Read a localStorage key back, without printing it. Used to ask whether a session is already there. */
function storage(page, key) {
  return page.evaluate((name) => window.localStorage.getItem(name), key);
}

/** Find a control, or throw with the reason. See `controlExpression` for how a control is matched. */
async function mustFind(page, target, { within = null, allowAmbiguous = false, what = 'press' } = {}) {
  const found = await findControl(page, target, { within, allowAmbiguous });
  if (found.found) return found;

  throw new Error(`cannot ${what} ${JSON.stringify(target)}: ${found.candidates ? found.detail : found.why}`);
}

/**
 * Make one throwaway account and hand the page its session - the one place this happens.
 *
 * `label` becomes the account's prefix, and every label here starts `cline-`, because that is the pattern
 * `supabase/cleanup/throwaway-accounts-review.sql` already reviews: an account a tool makes is one
 * `npm run db:sweep` knows how to find.
 */
async function signInPage(page, { label = 'cline-shoot', stamp = null } = {}) {
  loadEnv();

  const at = stamp ?? new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const account = await signUp(`${label}-${at}@debaser.site`, `${label}-${at}-pw`, `${label} ${at}`);

  if (account.error) return { error: account.error };

  await installSession(page, account);

  return account;
}

/** Whether this page's origin already holds a Supabase session for the project in `.env.local`. */
async function holdsSession(page) {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  return storage(page, storageKeyFor(url)).catch(() => null);
}

module.exports = {
  ARRIVAL_PROBE,
  BROWSE,
  CHROME_CANDIDATES,
  GL_ARGS,
  NoAnswer,
  SESSION_FILE,
  capture,
  click,
  close,
  controlExpression,
  debugPort,
  drag,
  findChrome,
  findControl,
  flags,
  forceFocus,
  goto,
  hover,
  holdsSession,
  installSession,
  key,
  loadEnv,
  mustFind,
  netErrorOf,
  noAnswerOf,
  open,
  probeArrival,
  readSession,
  report,
  scroll,
  sessionAlive,
  signInPage,
  signUp,
  sleep,
  startSession,
  stopSession,
  storage,
  storageKeyFor,
  type,
  waitForControl,
};

/**
 * The command line: `--status`, `--start`, `--stop`, `--open`.
 *
 *     npm run browser                       what session is up, if any
 *     npm run browser -- --start            open the reusable browser
 *     npm run browser -- --start --signin   ... and sign one throwaway account into it, once
 *     npm run browser -- --open <address>   attach, arrive, and print what the page says
 *     npm run browser -- --stop             close it, and remove its profile
 *
 * `--open` is the cheap way to ask a question of a running session: it starts nothing, waits for the page
 * to arrive, and prints the text - so "is it there, and does it say the thing" costs one command instead
 * of a capture and a decoder. It is not a substitute for a capture when the question is about pixels.
 */
async function main() {
  const { at, has, number } = flags();
  const command = has('--start') ? 'start' : has('--stop') ? 'stop' : has('--open') ? 'open' : 'status';

  if (command === 'status') {
    const session = await sessionAlive();

    if (!session) {
      console.log('no browser session is running');
      console.log('  start one with `npm run browser -- --start`');
      return;
    }

    console.log(`session on port ${session.port}`);
    console.log(`  browser  : ${session.browser}`);
    console.log(`  profile  : ${session.profile}`);
    console.log(`  started  : ${session.startedAt}`);
    return;
  }

  if (command === 'stop') {
    const result = await stopSession({ keepProfile: has('--keep-profile') });

    if (!result.stopped) {
      console.log(`nothing to stop (${result.why})`);
      return;
    }

    console.log(`stopped the session on port ${result.port}`);
    console.log(result.profile === null ? '  its profile was removed; --keep-profile would have kept it' : `  profile kept: ${result.profile}`);
    return;
  }

  if (command === 'start') {
    const session = await startSession({ port: number('--port', undefined) ?? undefined });

    console.log(
      session.alreadyRunning
        ? `already running on port ${session.port} (${session.browser})`
        : `started ${session.browser} on port ${session.port}`,
    );
    console.log(`  profile: ${session.profile} - kept, so a signed-in page stays signed in`);
    console.log('  attach to it with `npm run shot -- --attach`, and close it with `npm run browser -- --stop`');

    if (!has('--signin')) {
      console.log('');
      console.log('NOT SIGNED IN: a page behind a session will render signed out. `--start --signin` makes one');
      console.log('throwaway account for the whole session instead of one per capture.');
      return;
    }

    await signInSession(session, at('--url', 'https://debaser-site.vercel.app/forum'));
    return;
  }

  // `--open <address>`: nothing is started, nothing is written.
  const url = at('--open', null);
  let session = null;

  try {
    session = await open({ attach: true, size: [number('--width', 1440), number('--height', 1000)] });
    const arrival = await goto(session.page, url, {
      settle: number('--at', 1500),
      waitFor: at('--wait-for', null),
      allowErrorPage: has('--allow-error-page'),
    });

    console.log(`arrived: ${arrival.title} - ${arrival.href}`);
    console.log('');
    console.log(arrival.text.slice(0, 2000));
    report(session.log);
  } finally {
    await close(session);
  }
}

/** One throwaway account, handed to the session's page once - the reason a session exists. */
async function signInSession(session, url) {
  let page = null;

  try {
    page = await open({ attach: true });

    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const account = await signUp(`cline-shoot-${stamp}@debaser.site`, `shoot-${stamp}-pw`, `shoot ${stamp}`);

    if (account.error) {
      console.log(`session sign-in FAILED: ${account.error}`);
      process.exitCode = 3;
      return;
    }

    await installSession(page.page, account);
    const arrival = await goto(page.page, url, { settle: 3000 });

    console.log(`  signed in as ${account.userId} - left behind for \`npm run db:sweep\``);
    console.log(`  arrived: ${arrival.title}`);
  } finally {
    await close(page); // attached: the connection closes, the browser keeps running
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      if (error.noAnswer) {
        console.log(`REFUSED: ${error.message}`);
        process.exitCode = 4;
        return;
      }

      console.log('FAILED: ' + error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      // A session that was attached to leaves a handle on a browser that is meant to outlive this
      // process, so the exit is explicit rather than left to the event loop.
      process.exit(process.exitCode ?? 0);
    });
}









