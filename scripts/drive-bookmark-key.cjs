/*
 * THE BOOKMARKS-BAR KEY in a real browser (Luke, 2026-11-27: "Bookmarks-bar key (no install)"): the address the site makes (bookmark-key.ts, from
 * extension/lens.js and bookmark/strip.js), pressed on pretend pages this script serves, each with a stricter rule about scripts and styles
 * than the last, and (with --real) once each on a few real kinds of page. It says what worked where; it fails only where a page that is
 * expected to work didn't.
 *
 *   node scripts/drive-bookmark-key.cjs --browser edge
 *   node scripts/drive-bookmark-key.cjs --browser chrome --exe <chrome.exe>
 *   node scripts/drive-bookmark-key.cjs --browser firefox --exe <firefox.exe>
 *   ... --real    the real pages too (read once each, signed in to nothing)
 *
 * The press: in Chrome and Edge the address is sent the way the bookmarks bar sends it (the browser's own "go to this address", not a page's
 * link); in Firefox a real bookmark is put on the bookmarks toolbar and its key is commanded. No hand is on the bar in either.
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const arg = (name) => {
  const at = process.argv.indexOf('--' + name);
  return at === -1 ? null : process.argv[at + 1];
};
const BROWSER = arg('browser') ?? 'edge';
const REAL = process.argv.includes('--real');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* bookmark-key.ts as it is, made runnable here: what is pressed is what the site makes. */
const made = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(ROOT, 'app/lib/seeing/bookmark-key.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(made, made.exports);
const { composeBookmarkKey, bookmarkAddress } = made.exports;
const THEME = { paper: '#101820', ink: '#f2aa4c', accent: '#00ff88', quiet: '#cccccc', fault: '#ff0055', faultInk: '#ffffff', sun: '#ffee00' };
const INK = 'rgb(242, 170, 76)';
const PAPER = 'rgb(16, 24, 32)';

const WORDS = 'The machine shows a page through a lens, and the lens changes how the page looks and nothing of what it says, which is the whole of the idea. ';
const BODY = (nonce) => `<nav class="navbar"><a href="/plain">home</a> <a href="/strict">elsewhere</a></nav>
<article><h1>A pretend article</h1>${[1, 2, 3, 4].map((each) => `<p>${WORDS.repeat(3)} Paragraph ${each}.</p>`).join('')}
<video src="/clip.mp4" title="A pretend clip"></video> <a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">a video elsewhere</a></article>
<footer class="footer">the foot of the page</footer><script${nonce ? ` nonce="${nonce}"` : ''}>window.pageRan = true;</script>`;
const STRICT = "default-src 'none'; script-src 'nonce-abc'; style-src 'nonce-abc'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'";
const PAGES = {
  plain: { rule: null, words: 'no rule at all (a plain blog)' },
  inline: { rule: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'", words: 'a loose rule (inline scripts and styles allowed)' },
  strict: { rule: STRICT, words: 'a strict rule (only scripts and styles the site signed)' },
  trusted: { rule: `${STRICT}; require-trusted-types-for 'script'; trusted-types 'none'`, words: 'strict, and Trusted Types (no markup from words)' },
  noscripts: { rule: "default-src 'none'; style-src 'unsafe-inline'; sandbox", words: 'no scripts at all (a sandboxed file, as raw.githubusercontent.com)' },
};
const REAL_PAGES = [
  ['a news site', 'https://www.bbc.com/news'],
  ['an encyclopedia article', 'https://en.wikipedia.org/wiki/Comics'],
  ['a strict-rule site (GitHub)', 'https://github.com/mozilla/pdf.js'],
  ['a strict-rule site (MDN)', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP'],
  ['a plain blog', 'https://danluu.com/'],
];

function serve() {
  const asked = [];
  const server = http.createServer((request, answer) => {
    asked.push(request.url);
    const name = request.url.slice(1).split(/[?#]/)[0];
    if (name === 'clip.mp4') return answer.writeHead(200, { 'content-type': 'video/mp4' }).end('');
    if (name.startsWith('browser')) return answer.writeHead(200, { 'content-type': 'text/html' }).end('<title>the pretend debaser.site</title>');
    const page = PAGES[name];
    if (page === undefined) return answer.writeHead(404).end();
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    if (page.rule !== null) headers['content-security-policy'] = page.rule;
    return answer.writeHead(200, headers).end(`<!doctype html><html><head><title>Pretend ${name}</title></head><body>${BODY(page.rule?.includes('nonce-abc') ? 'abc' : null)}</body></html>`);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ asked, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/* What is read of the page, the same words in every browser. */
const PROBE = {
  watch: "window.__violations = []; document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.violatedDirective));",
  strip: "(() => { const host = document.getElementById('debaser-key'); return host === null ? null : { fixed: getComputedStyle(host).position === 'fixed', keys: host.shadowRoot.querySelectorAll('button').length }; })()",
  ink: "getComputedStyle(document.querySelector('article p, main p, p')).color",
  cover: "(() => { const top = document.elementFromPoint(Math.floor(innerWidth / 3), Math.floor(innerHeight / 2)); const style = top === null ? null : getComputedStyle(top); return top !== null && top.parentElement === document.documentElement && top.id !== 'debaser-key' && top.tagName === 'DIV' ? { fixed: style.position === 'fixed', paper: style.backgroundColor } : null; })()",
  said: "document.getElementById('debaser-key')?.shadowRoot.querySelector('[role=status]')?.textContent ?? null",
  rows: "[...(document.getElementById('debaser-key')?.shadowRoot.querySelectorAll('.row span') ?? [])].map((each) => each.title)",
  violations: '(window.__violations ?? []).join(",")',
  key: (which) => `document.getElementById('debaser-key')?.shadowRoot.querySelector('${which}') ?? null`,
};

async function openChromium(dir) {
  const { chromium } = require('playwright-core');
  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), { executablePath: arg('exe') ?? require('./browser.cjs').findChrome(), headless: false, args: ['--headless=new'], viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  return {
    version: `${BROWSER} ${context.browser()?.version() ?? ''}`.trim(),
    go: (address) => page.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 }).then(() => sleep(REAL ? 2500 : 300)),
    // The browser's own "go to this address", as a bookmark is: not a link in the page.
    press: (address) => cdp.send('Page.navigate', { url: address }).then(() => sleep(500)),
    read: (script) => page.evaluate(script),
    click: async (which) => {
      const key = page.locator(`#debaser-key ${which}`).first();
      if ((await key.count()) === 0) return false;
      await key.click({ timeout: 4000 });
      await sleep(300);
      return true;
    },
    opened: async () => {
      await sleep(800);
      const others = context.pages().filter((each) => each !== page);
      const urls = others.map((each) => each.url());
      for (const each of others) await each.close();
      return urls;
    },
    close: () => context.close(),
  };
}

async function openFirefox(dir) {
  const { launchFirefox } = require('./marionette.cjs');
  const { client, version, close } = await launchFirefox({ exe: arg('exe'), dir });
  let bookmarked = null;
  const first = (await client.send('WebDriver:GetWindowHandle')).value;
  return {
    version: `firefox ${version}`,
    go: (address) => client.send('WebDriver:Navigate', { url: address }).then(() => sleep(REAL ? 2500 : 300)),
    // A real bookmark on the bookmarks toolbar, and its key commanded.
    press: async (address) => {
      const how = await client.script(
        `const [url, known, done] = arguments;
         (async () => {
           const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
           let guid = known;
           if (guid === null) {
             guid = (await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, url, title: 'DEBASER LENSES' })).guid;
             setToolbarVisibility(document.getElementById('PersonalToolbar'), true, false);
           }
           let key = null;
           for (let tries = 0; tries < 40 && key === null; tries += 1) {
             key = [...document.querySelectorAll('#PlacesToolbarItems > toolbarbutton')].find((each) => each._placesNode?.bookmarkGuid === guid) ?? null;
             if (key === null) await new Promise((wait) => setTimeout(wait, 150));
           }
           if (key === null) return done({ guid, pressed: false });
           key.doCommand();
           done({ guid, pressed: true });
         })().catch((error) => done({ guid: known, pressed: false, error: String(error) }));`,
        [address, bookmarked],
        true,
      );
      bookmarked = how.guid ?? bookmarked;
      if (!how.pressed) console.log('  ..  the bookmark was not pressed:', how.error ?? 'its key was not on the toolbar');
      await sleep(600);
    },
    read: (script) => client.read(`return ${script};`),
    click: async (which) => {
      const pressed = await client.press(`return ${PROBE.key(which)};`).catch((error) => (console.log('  ..  ' + error.message.split('\n')[0]), false));
      await sleep(300);
      return pressed;
    },
    opened: async () => {
      await sleep(1200);
      const urls = [];
      for (const handle of (await client.send('WebDriver:GetWindowHandles')).filter?.((each) => each !== first) ?? []) {
        await client.send('WebDriver:SwitchToWindow', { handle });
        urls.push((await client.send('WebDriver:GetCurrentURL')).value);
        await client.send('WebDriver:CloseWindow');
      }
      await client.send('WebDriver:SwitchToWindow', { handle: first });
      return urls;
    },
    close,
  };
}

/** One page: the key pressed, each lens, MEDIA, and put away. What happened, in words. */
async function tryPage(browser, address, code, base) {
  const got = {};
  const safe = async (what, fallback = null) => {
    try {
      return await what();
    } catch (error) {
      got.fault = String(error.message ?? error).split('\n')[0].slice(0, 120);
      return fallback;
    }
  };
  await safe(() => browser.go(address));
  await safe(() => browser.read(PROBE.watch));
  const before = await safe(() => browser.read(PROBE.ink));
  await safe(() => browser.press(bookmarkAddress(code, THEME)));
  const strip = await safe(() => browser.read(PROBE.strip));
  got.strip = strip !== null && strip.keys === 7;
  got.dressed = strip?.fixed === true;
  if (got.strip) {
    await safe(() => browser.click('[data-lens=lowfi]'));
    got.lowfi = (await safe(() => browser.read(PROBE.ink))) === INK;
    await safe(() => browser.click('[data-lens=xray]'));
    got.xray = await safe(() => browser.read("getComputedStyle(document.querySelector('article p, main p, p')).outlineStyle === 'dotted'"));
    await safe(() => browser.click('[data-lens=yours]'));
    got.yours = (await safe(() => browser.read(PROBE.ink))) === INK;
    await safe(() => browser.click('[data-lens=reader]'));
    const cover = await safe(() => browser.read(PROBE.cover));
    const said = await safe(() => browser.read(PROBE.said));
    got.reader = cover?.fixed === true && cover.paper === PAPER ? true : said || false;
    got.readerKeys = (await safe(() => browser.click('[data-lens=standard]'))) === true;
    got.standard = (await safe(() => browser.read(PROBE.ink))) === before && (await safe(() => browser.read(PROBE.cover))) === null;
    await safe(() => browser.click('[data-key=media]'));
    const rows = (await safe(() => browser.read(PROBE.rows))) ?? [];
    got.media = rows.length;
    if (base !== null && rows.length > 0) {
      await safe(() => browser.click('.row button'));
      const opened = await safe(() => browser.opened(), []);
      got.handed = opened.some((each) => each.startsWith(`${base}/browser#media=`));
    }
    await safe(() => browser.press(bookmarkAddress(code, THEME)));
    got.away = (await safe(() => browser.read(PROBE.strip))) === null;
  }
  got.told = (await safe(() => browser.read(PROBE.violations))) ?? '';
  return got;
}

const mark = (value) => (value === true ? 'yes' : value === false ? 'NO' : value === undefined ? '-' : String(value));
const line = (words, got) => `  ${words.padEnd(62)} strip ${mark(got.strip)} · dressed ${mark(got.dressed)} · LOW-FI ${mark(got.lowfi)} · X-RAY ${mark(got.xray)} · YOUR THEME ${mark(got.yours)} · READER ${mark(got.reader)} · STANDARD ${mark(got.standard)} · MEDIA ${mark(got.media)}${got.handed === undefined ? '' : ' · handed over ' + mark(got.handed)} · away ${mark(got.away)}${got.told ? ` · the page's rule was told of: ${got.told}` : ''}${got.fault ? ` · (${got.fault})` : ''}`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-bookmark-key-'));
  const shop = await serve();
  const code = composeBookmarkKey(fs.readFileSync(path.join(ROOT, 'extension/lens.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'bookmark/strip.js'), 'utf8'), shop.base);
  const address = bookmarkAddress(code, THEME);
  const browser = await (BROWSER === 'firefox' ? openFirefox(dir) : openChromium(dir));
  const results = {};
  let failed = 0;
  try {
    console.log(`${browser.version} · the key is ${address.length} characters`);
    for (const [name, page] of Object.entries(PAGES)) {
      const from = shop.asked.length;
      results[name] = await tryPage(browser, `${shop.base}/${name}`, code, shop.base);
      // What was asked of the network after the page itself: only the hand-over's own page, on its press.
      results[name].asked = shop.asked.slice(from + 1).filter((each) => !each.startsWith('/browser') && each !== '/clip.mp4' && each !== '/favicon.ico');
      console.log(line(page.words, results[name]) + (results[name].asked.length ? ` · ASKED THE NETWORK FOR ${results[name].asked.join(' ')}` : ''));
    }
    if (REAL) {
      console.log('\n real pages, once each:');
      for (const [words, real] of REAL_PAGES) console.log(line(`${words} (${new URL(real).hostname})`, (results[real] = await tryPage(browser, real, code, null))));
    }
  } finally {
    await browser.close().catch(() => undefined);
    shop.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
  // What must hold: on a page with no rule and one with a loose rule, everything; and nowhere a request of its own.
  for (const name of ['plain', 'inline']) {
    const got = results[name];
    for (const each of ['strip', 'dressed', 'lowfi', 'xray', 'yours', 'standard', 'handed', 'away']) if (got[each] !== true) (failed += 1), console.log(`FAILED: ${name}: ${each}`);
    if (got.reader !== true || got.media !== 2) (failed += 1), console.log(`FAILED: ${name}: READER or MEDIA`);
  }
  for (const [name, got] of Object.entries(results)) if ((got.asked ?? []).length > 0) (failed += 1), console.log(`FAILED: ${name}: it asked the network for something`);
  const json = arg('json');
  if (json !== null) fs.writeFileSync(json, JSON.stringify({ browser: browser.version, results }, null, 1));
  console.log(failed === 0 ? '\nthe key works where it must' : `\n${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
