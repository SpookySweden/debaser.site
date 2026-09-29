/**
 * What every browser instrument here shares: finding Chrome, launching it, arriving at an address,
 * **refusing when the address did not answer**, finding a control the way a reader does, pointing at
 * it, and taking a picture.
 *
 * **Why the refusal is here rather than in each tool.** Chrome's own error page is a *page*. It has a
 * body, it has text, and it renders - so `document.querySelectorAll('canvas')` answers `0`, the
 * drawing-buffer probe answers "no WebGL context", and both of those read as statements about the
 * site. They are statements about a refused connection. That is what happened to
 * `Temp/browse/account.png`: a picture of *"This site can't be reached"* sitting in the captures
 * folder under a name that says `account`, with nothing in any output to say so. The guard makes the
 * difference between "the figure did not draw" and "there was no server" loud, and it is *shared* so
 * three instruments cannot come to disagree about what an answer looks like.
 *
 * `--allow-error-page` exists on the tools that use this: capturing the refusal is sometimes what a
 * caller wants, and a guard with no way past it is a guard that gets deleted.
 */
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Socket, getJson } = require('./cdp-socket.cjs');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A refused arrival, as a distinct kind of failure.
 *
 * It is an `Error` so the caller's `finally` still runs (the Chrome child has to be killed), and it
 * carries `noAnswer` so the caller can print the refusal rather than a stack trace.
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

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

  if (!chrome) {
    console.log(`NO BROWSER: tried ${CHROME_CANDIDATES.join(', ')}`);
    process.exit(2);
  }

  return chrome;
}

/**
 * The arrival probe: what address the page *says* it is, whether it is the browser's own error page,
 * and enough text to name the failure. `documentClass` matters because `neterror` is the class Chrome
 * puts on `<html>` for a failed load, and it survives even when the text is localised.
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

/**
 * Launch a headless Chrome with the software GL.
 *
 * `--use-angle=swiftshader` is load-bearing: without the software GL a headless build has no WebGL,
 * and a blank canvas would say nothing about the code under test. `--profile` is the one flag that
 * keeps the profile directory instead of throwing it away, and the reason it exists is that a
 * throwaway profile is never signed in to anything - so a page behind a session can only be captured
 * from a profile that was logged in once, by hand, and kept.
 */
function launch({ port, profile, size = [1440, 1000], keepProfile = false }) {
  const chrome = findChrome();
  const absolute = path.resolve(profile);

  /**
   * **The old profiles are the reason this is written down.** A Chrome profile is not a small
   * artefact: `Temp/browse/*-profile` holds a `model.tflite` of about 36MB, a disk cache, a code
   * cache and half-finished `*.crdownload` files. Two scripts cleaned theirs up and the rest did not,
   * so the capture folder grew a copy of Chrome's internals per run. Removing it here means every
   * tool using this module cleans up, and `--profile` is the opt-out.
   */
  if (!keepProfile) rmSync(absolute, { recursive: true, force: true });
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
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  return { chrome, child, profile: absolute };
}

/** Wait for the debug port rather than sleeping long enough for a slow machine. */
async function socketOn(port, { attempts = 40 } = {}) {
  let targets = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      targets = await getJson(port, '/json/list');
      if (targets.some((target) => target.type === 'page')) break;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }

  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target appeared');

  const socket = await Socket.connect(page.webSocketDebuggerUrl);
  await socket.send('Page.enable');
  await socket.send('Runtime.enable');

  return socket;
}

/** `Runtime.evaluate` by value, with an exception in the page turned into a real throw. */
async function evaluate(socket, expression, { awaitPromise = false } = {}) {
  const result = await socket.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }

  return result.result.value;
}

/**
 * Go to an address and wait for it to have *arrived*.
 *
 * Worse than a fixed sleep: `document.readyState` is polled, because a fixed sleep passes on a fast
 * machine and reports "no canvas" on a slow one, which is a statement about the machine. Then a
 * settle, because the client chunks - three.js, the workbench - build after load.
 *
 * Throws `NoAnswer` when the page is the browser's refusal. **The point of the throw is that no file
 * is written**: a refused capture written to disk is indistinguishable from a real one afterwards,
 * and every tool downstream reads it happily.
 */
async function arrive(socket, url, { settle = 3000, allowErrorPage = false } = {}) {
  await socket.send('Page.navigate', { url });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await evaluate(socket, 'document.readyState');
    if (state === 'complete') break;
    await sleep(500);
  }

  await sleep(settle);

  const arrival = await evaluate(socket, ARRIVAL_PROBE);
  const detail = noAnswerOf(arrival);

  if (detail !== null && !allowErrorPage) throw new NoAnswer(url, detail);

  return arrival;
}

/**
 * Find a control the way a reader does - by its text, or by a CSS selector when the caller names one -
 * and say whether it was found.
 *
 * The preference order matters, and it is not a detail: the stage buttons read `MASS`, and the edit
 * row beside them reads `MASS GEOMETRY`. An `includes` search that starts at the top of the document
 * finds the edit row first, which is exactly how two stages came back byte-identical and read as "the
 * material never switches". Exact text first, then the first line, then a substring.
 *
 * `within` scopes the search to the container whose own text contains that phrase, which is how the
 * stage group inside `WHAT IS DRAWN` is reached without ambiguity.
 */
async function findControl(socket, target, { within = null } = {}) {
  return evaluate(
    socket,
    `(() => {
      const wanted = ${JSON.stringify(target)}.trim().toLowerCase();
      const looksLikeSelector = /^[#.\\[]/.test(wanted) || /^[a-z]+[.#\\[:]/i.test(wanted);

      let root = document;
      if (${JSON.stringify(within)} !== null) {
        const phrase = ${JSON.stringify(within)}.toLowerCase();
        const scope = [...document.querySelectorAll('fieldset, section, main, aside, div, form')].find(
          (element) => (element.innerText || '').toLowerCase().includes(phrase),
        );
        if (!scope) {
          return { found: false, why: 'no container whose text contains ' + JSON.stringify(${JSON.stringify(
            within,
          )}) };
        }
        root = scope;
      }

      const describe = (element, how) => {
        element.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = element.getBoundingClientRect();
        return {
          found: true,
          how,
          label: (element.innerText || element.getAttribute('aria-label') || element.tagName).trim().slice(0, 48),
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      };

      if (looksLikeSelector) {
        const bySelector = root.querySelector(${JSON.stringify(target)});
        if (bySelector) return describe(bySelector, 'selector');
      }

      const candidates = [
        ...root.querySelectorAll('button, a, [role="button"], label, summary, input, h1, h2, h3, p, span'),
      ];
      const firstLine = (element) => (element.innerText || '').trim().split(String.fromCharCode(10))[0].trim().toLowerCase();
      const whole = (element) => (element.innerText || '').trim().toLowerCase();

      const byExact = candidates.find((element) => whole(element) === wanted);
      if (byExact) return describe(byExact, 'text');

      const byFirstLine = candidates.find((element) => firstLine(element) === wanted);
      if (byFirstLine) return describe(byFirstLine, 'text');

      const loose = candidates.find((element) => whole(element).includes(wanted));
      if (loose) return describe(loose, 'text');

      return { found: false, why: 'nothing on the page reads ' + JSON.stringify(${JSON.stringify(target)}) };
    })()`,
  );
}

/** A real pointer move, out of process: the hover a person makes, not a class added by a script. */
async function hover(socket, x, y) {
  await socket.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
}

/** A real press and release. React's synthetic events are driven through the browser's own input path. */
async function click(socket, x, y) {
  await hover(socket, x, y);
  await socket.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await socket.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * Force `:focus` and `:focus-visible` onto a node, through the CSS domain.
 *
 * This is what the stylesheet does under focus, and it is honest about being that: it is not the tab
 * order, and it does not prove a keyboard can reach the control. `element.focus()` alone is not
 * enough, because `:focus-visible` needs a *keyboard* interaction to match, and the plates key their
 * look off it.
 */
async function forceFocus(socket, selector) {
  await socket.send('DOM.enable');
  await socket.send('CSS.enable');

  const root = await socket.send('DOM.getDocument', { depth: -1 });
  const found = await socket.send('DOM.querySelector', { nodeId: root.root.nodeId, selector });

  if (!found.nodeId) return { forced: false, why: `no element matches ${selector}` };

  await socket.send('CSS.forcePseudoState', { nodeId: found.nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });

  return { forced: true, selector };
}

/**
 * Take the picture, and write it.
 *
 * `fullPage` uses `captureBeyondViewport`, which is what makes a tall page one file rather than the
 * first screen. `clip` is a rectangle in *viewport* coordinates and the scroll offsets are added
 * here, so a caller names an element rather than a scrolled position.
 */
async function capture(socket, { out, fullPage = false, clip = null }) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const params = { format: 'png' };

  if (clip) {
    const metrics = await socket.send('Page.getLayoutMetrics');
    params.clip = {
      x: clip.x + (metrics.cssVisualViewport?.pageX ?? 0),
      y: clip.y + (metrics.cssVisualViewport?.pageY ?? 0),
      width: clip.w,
      height: clip.h,
      scale: 1,
    };
    params.captureBeyondViewport = true;
  } else if (fullPage) {
    params.captureBeyondViewport = true;
  }

  const shot = await socket.send('Page.captureScreenshot', params);
  const bytes = Buffer.from(shot.data, 'base64');
  writeFileSync(out, bytes);

  return { file: out, bytes: bytes.length };
}

/**
 * End the browser and give the profile back.
 *
 * `launch()` removes the profile when it *starts*, which leaves one behind after every run - the last one.
 * Twelve of them (about 36MB each, mostly `model.tflite`) were sitting in `Temp/browse/` when this was
 * written, which is not what "every tool using this module cleans up" should mean. Each tool awaits this in
 * its `finally`.
 *
 * The wait is not decoration: Chrome holds the directory open for a moment after the kill, and a `rmSync`
 * that races it fails on Windows. A profile kept for a hand-made sign-in (`--profile`) is never removed.
 */
async function close({ child, profile, keep = false }) {
  child.kill();

  if (keep) return;

  const ended = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });

  await Promise.race([ended, sleep(2000)]);

  try {
    rmSync(path.resolve(profile), { recursive: true, force: true });
  } catch {
    /* Chrome still holds a file. The next run removes it at launch, which is what used to be the only rule. */
  }
}

/** The small flag reader the three tools share: `--flag value`, or `--flag` for a boolean. */
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
 * Sign an account up, and hand back the session as the *browser* would hold it.
 *
 * `@supabase/supabase-js` reads a session out of `localStorage` under `sb-<project-ref>-auth-token`
 * (the ref being the first label of the project hostname) - read out of
 * `node_modules/@supabase/supabase-js/dist/umd/supabase.js`, where the key is built. So a script can
 * hand a page a session it obtained over the REST API, which is how a page behind a session gets
 * captured without anybody typing a password into a browser window: **the capture tool does not need
 * a password, and it must never print a token.**
 *
 * The account is one of the throwaway ones the checks already make. It cannot be deleted from here -
 * that takes the service role - so `npm run db:sweep` is what clears it up afterwards.
 */
async function signUp(email, password, displayName) {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return { error: 'no Supabase project in the environment: run with `node --env-file=.env.local`' };

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name: displayName } } });

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

/** Hand the page a session before its own scripts run, so it never renders signed-out at all. */
async function installSession(socket, { storageKey, session }) {
  await socket.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `try { window.localStorage.setItem(${JSON.stringify(storageKey)}, ` +
      `${JSON.stringify(JSON.stringify(session))}); } catch (error) { /* storage denied */ }`,
  });
}

module.exports = {
  ARRIVAL_PROBE,
  CHROME_CANDIDATES,
  NoAnswer,
  arrive,
  capture,
  click,
  close,
  evaluate,
  findChrome,
  findControl,
  flags,
  forceFocus,
  hover,
  installSession,
  launch,
  noAnswerOf,
  signUp,
  sleep,
  socketOn,
};
