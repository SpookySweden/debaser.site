/*
 * How does one REAL site fare inside BROWSER's OWN EYE frame? (Luke, 2026-11-28: "make sure as many websites as possible are working such
 * as openfront.io"; "find a way at all costs and persist in making openfront.io work and be user friednly within debaser.site browser".)
 *
 * The extension as it is, in a test Edge with a throwaway profile, signed in to nothing; debaser.site is a pretend page this script
 * serves, and the one site named is already let (a browser's own "allow" box can't be pressed by a script), as a site ADDED BY NAME.
 * The site is opened twice: in an ordinary tab (the baseline: what this test browser gets at all), and in the frame BROWSER makes for
 * OWN EYE (the same sandbox and the same `allow` line as SeeingOwnFrame). It reports what came back and what the page could do; it
 * presses only what `--press` names, types nothing, signs in to nothing, downloads nothing, and never answers an are-you-a-person
 * check: where the site puts one in front of this browser, the report says so and stops there.
 *
 *   node scripts/trial-real-site.cjs https://openfront.io/
 *   node scripts/trial-real-site.cjs https://openfront.io/ --press "Solo" --press "Start Game"   presses those words in the frame, in order
 *   node scripts/trial-real-site.cjs https://openfront.io/ --sandbox "+allow-modals +allow-pointer-lock" --allow "fullscreen; autoplay"
 *   node scripts/trial-real-site.cjs https://openfront.io/ --shots <folder>   a picture of the tab and of the frame (after each press)
 *   node scripts/trial-real-site.cjs https://openfront.io/ --wait 20          seconds to let the page settle (12)
 *
 * A trial, not a check: it always exits 0 once it has its report. Real sites change; read the report, not the exit code.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const every = (flag) => args.flatMap((each, at) => (each === flag && args[at + 1] !== undefined ? [args[at + 1]] : []));
const one = (flag, otherwise) => every(flag)[0] ?? otherwise;
const SITE = args.find((each) => /^https:\/\//.test(each));
if (!SITE) {
  console.error('usage: node scripts/trial-real-site.cjs https://a-site/ [--press "words"]... [--sandbox "+flag"] [--allow "line"] [--shots folder] [--wait seconds]');
  process.exit(2);
}
const source = fs.readFileSync(path.join(__dirname, '..', 'app/components/seeing/SeeingOwnFrame.tsx'), 'utf8');
const AS_BUILT = /OWN_FRAME_SANDBOX = '([^']+)'/.exec(source)[1];
const SANDBOX = [AS_BUILT, ...one('--sandbox', '').split(/\s+/).filter((each) => each.startsWith('+')).map((each) => each.slice(1))].join(' ');
const ALLOW = one('--allow', 'fullscreen');
const WAIT = Number(one('--wait', '12')) * 1000;
const SHOTS = one('--shots', null);
const PRESSES = every('--press');
const MACHINE = 'www.machinesite.test';
const host = new URL(SITE).hostname;
const family = host.split('.').slice(-2).join('.');

const short = (text, most = 160) => String(text).replace(/\s+/g, ' ').trim().slice(0, most);
const line = (name, value) => console.log(`  ${name.padEnd(26)} ${value}`);

/** What a page says of itself, asked inside it. Reads no cookie value and nothing typed. */
const ASK = () => {
  const canvases = [...document.querySelectorAll('canvas')].map((each) => `${each.width}x${each.height}`);
  let webgl = 'not asked';
  try {
    const probe = document.createElement('canvas');
    webgl = probe.getContext('webgl2') ? 'webgl2' : probe.getContext('webgl') ? 'webgl' : 'none';
  } catch (error) {
    webgl = `threw ${error.name}`;
  }
  let stored = 'yes';
  try {
    localStorage.setItem('__trial', '1');
    localStorage.removeItem('__trial');
  } catch (error) {
    stored = `no (${error.name})`;
  }
  const sound = (() => {
    try {
      const Kind = window.AudioContext ?? window.webkitAudioContext;
      if (!Kind) return 'no AudioContext';
      const made = new Kind();
      const state = made.state;
      void made.close();
      return state;
    } catch (error) {
      return `threw ${error.name}`;
    }
  })();
  return {
    href: location.href,
    title: document.title,
    framed: window.self !== window.top,
    referrer: document.referrer,
    isolated: window.crossOriginIsolated,
    cookies: navigator.cookieEnabled,
    stored,
    webgl,
    sound,
    fullscreen: document.fullscreenEnabled,
    canvases,
    frames: [...document.querySelectorAll('iframe')].map((each) => each.src.slice(0, 90)),
    keys: [...document.querySelectorAll('button, [role="button"], a[href]')]
      .filter((each) => each.getClientRects().length > 0)
      .map((each) => (each.innerText || each.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
      .filter((each) => each.length > 0 && each.length < 40)
      .slice(0, 40),
    words: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    check: /just a moment|verify you are human|checking your browser|attention required/i.test(`${document.title} ${document.body?.innerText ?? ''}`),
  };
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-real-site-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=pretend', '-addext', `subjectAltName=DNS:${MACHINE}`], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(dir, 'c.pem'));
  // Only this one pretend certificate is trusted: the real site's own certificate is checked as any browser checks it.
  const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert }, (request, answer) => answer.writeHead(200, { 'content-type': 'text/html' }).end('<title>BROWSER</title><body style="margin:0;background:#222"><p style="color:#eee;font:14px monospace;margin:4px">the pretend BROWSER page</p>'));
  await new Promise((done) => server.listen(443, '127.0.0.1', done));

  const extension = path.join(dir, 'extension');
  fs.cpSync(path.join(__dirname, '..', 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [`https://${family}/*`, `https://*.${family}/*`];
  manifest.externally_connectable.matches = [`https://${MACHINE}/*`];
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['sites.js', 'frame.js', 'act.js', 'worker.js']) fs.writeFileSync(path.join(extension, file), fs.readFileSync(path.join(extension, file), 'utf8').replaceAll('https://debaser.site', `https://${MACHINE}`));

  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    executablePath: findChrome(),
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--host-resolver-rules=MAP ${MACHINE} 127.0.0.1`, '--disable-features=DisableLoadExtensionCommandLineSwitch', `--ignore-certificate-errors-spki-list=${spki}`],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const done = async () => {
    await context.close().catch(() => undefined);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    console.log(`TRIAL: ${SITE} ; extension ${manifest.version} ; ${context.browser()?.version() ?? 'Edge'} ; sandbox "${SANDBOX}" ; allow "${ALLOW}"`);

    /** Everything one page (and what is inside it) asked for and said while it was watched. */
    const watch = (page) => {
      const seen = { errors: [], failed: [], sockets: [], documents: [], hosts: new Set() };
      page.on('console', (message) => message.type() === 'error' && seen.errors.push(short(message.text(), 200)));
      page.on('pageerror', (error) => seen.errors.push(`page error: ${short(error.message, 200)}`));
      page.on('requestfailed', (request) => seen.failed.push(`${short(request.url(), 110)} : ${request.failure()?.errorText ?? '?'}`));
      page.on('websocket', (socket) => {
        const entry = { url: short(socket.url(), 110), frames: 0, closed: false };
        seen.sockets.push(entry);
        socket.on('framereceived', () => (entry.frames += 1));
        socket.on('close', () => (entry.closed = true));
      });
      page.on('response', (response) => {
        try {
          seen.hosts.add(new URL(response.url()).hostname);
        } catch {}
        if (response.request().resourceType() !== 'document') return;
        const headers = response.headers();
        const kept = ['x-frame-options', 'content-security-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'permissions-policy', 'cf-mitigated']
          .filter((name) => headers[name] !== undefined)
          .map((name) => `${name}: ${short(headers[name], 140)}`);
        seen.documents.push(`${response.status()} ${short(response.url(), 90)}${kept.length ? `\n${' '.repeat(31)}${kept.join(`\n${' '.repeat(31)}`)}` : ''}`);
      });
      return seen;
    };
    const tell = async (where, frame, seen) => {
      const said = await frame?.evaluate(ASK).catch((error) => ({ failed: short(error.message) }));
      console.log(`\n${where}`);
      if (!said || said.failed) return line('the page', `could not be asked${said?.failed ? `: ${said.failed}` : ' (no frame)'}`), said;
      line('where it is', `${said.href}  "${short(said.title, 60)}"`);
      line('are-you-a-person check', said.check ? 'YES: this browser is stopped here (never answered by a script)' : 'none seen');
      line('thinks it is framed', `${said.framed} ; referrer "${said.referrer}"`);
      line('can do', `webgl ${said.webgl} ; sound ${said.sound} ; fullscreen ${said.fullscreen} ; storage ${said.stored} ; cookies ${said.cookies} ; isolated ${said.isolated}`);
      line('canvases', said.canvases.join(', ') || 'none');
      line('frames inside', said.frames.join(' | ') || 'none');
      line('keys drawn', said.keys.join(' | ') || 'none');
      line('words', said.words || '(none)');
      for (const each of seen.documents.slice(0, 6)) line('document', each);
      line('sockets', seen.sockets.map((each) => `${each.url} (${each.frames} in${each.closed ? ', closed' : ', open'})`).join(' | ') || 'none');
      line('hosts asked', [...seen.hosts].slice(0, 30).join(', '));
      for (const each of seen.failed.slice(0, 12)) line('failed', each);
      for (const each of seen.errors.slice(0, 14)) line('error', each);
      return said;
    };
    const shot = async (page, name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch((error) => line('picture', `not taken: ${short(error.message)}`));
    };

    // ---- An ordinary tab: what this test browser gets at all ----
    const tab = await context.newPage();
    const tabSeen = watch(tab);
    await tab.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((error) => line('tab', `did not load: ${short(error.message)}`));
    await tab.waitForTimeout(WAIT);
    await tell('IN AN ORDINARY TAB (the baseline)', tab.mainFrame(), tabSeen);
    await shot(tab, 'tab');
    await tab.close();

    // ---- The frame BROWSER makes for OWN EYE ----
    const page = await context.newPage();
    const seen = watch(page);
    const told = [];
    await page.goto(`https://${MACHINE}/`);
    await page.exposeFunction('heard', (message) => told.push(message));
    await page.evaluate((extensionId) => {
      window.held = chrome.runtime.connect(extensionId, { name: 'browser' });
      window.held.onMessage.addListener((message) => window.heard(message));
      addEventListener('message', (event) => {
        const own = document.querySelector('iframe[data-own]')?.contentWindow;
        if (own && event.source === own && event.data?.see === 'own-eye?') own.postMessage({ see: 'own-eye' }, '*');
      });
    }, id);
    await page.waitForTimeout(800);
    const has = await page.evaluate(([extensionId, about]) => new Promise((answer) => chrome.runtime.sendMessage(extensionId, { see: 'has', address: about }, answer)), [id, SITE]);
    await page.evaluate(
      ([where, sandbox, allow]) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('data-own', '');
        frame.setAttribute('sandbox', sandbox);
        frame.setAttribute('allow', allow);
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.style.cssText = 'display:block;border:0;width:100vw;height:calc(100vh - 26px)';
        frame.src = where;
        document.body.append(frame);
      },
      [SITE, SANDBOX, ALLOW],
    );
    await page.waitForTimeout(WAIT);
    const inner = () => page.frames().find((each) => each.parentFrame() === page.mainFrame());
    const said = await tell("IN BROWSER'S OWN EYE FRAME", inner(), seen);
    line('the extension said', `has: ${JSON.stringify(has)} ; told BROWSER: ${told.filter((each) => each.see === 'at').map((each) => short(each.href, 60)).join(' | ') || 'nothing'}`);
    await shot(page, 'frame');

    for (const [at, words] of PRESSES.entries()) {
      if (!said || said.failed || said.check) break;
      const key = inner().getByText(words, { exact: true }).first();
      const pressed = await key.click({ timeout: 6000 }).then(() => true, (error) => short(error.message, 120));
      await page.waitForTimeout(Math.max(6000, WAIT / 2));
      seen.documents.length = 0;
      await tell(`AFTER PRESSING "${words}" IN THE FRAME (${pressed === true ? 'pressed' : `NOT pressed: ${pressed}`})`, inner(), seen);
      await shot(page, `frame-press-${at + 1}`);
    }
  } finally {
    await done();
  }
})().catch((error) => {
  console.error('TRIAL BROKE:', error);
  process.exit(1);
});
