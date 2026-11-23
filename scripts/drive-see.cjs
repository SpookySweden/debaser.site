/*
 * BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md, Luke 2026-11-23), Phase 1: the shell, in a real browser.
 * On a LOCAL mock dev server only (core.md, "Test locally"): mock sign-in, and the live database blocked.
 *
 *   SEEING_DEV_OPEN=1 SEEING_EXIT=fixture:4567 node scripts/dev-mock-live.cjs 3341      (in another terminal, from Git Bash)
 *   node scripts/drive-see.cjs --base http://localhost:3341 [--out Temp/browse/see] [--only shell|themes|frame|eye]
 *
 *   shell   signed out, the sign-in call and no machine; BROWSER off the bar until ticked in MODULOS, then there with WIP; the test page,
 *           its links, back, forward, reload, tabs (eight at most), the address box, refusals, lens keys, the address after the #, an
 *           address a link brought waiting for GO, tabs open again after a reload and private to their account; nothing is asked of any
 *           host but the site, and no address is in any request; no sideways scroll at 390
 *   themes  every theme: READER's words and the machine's own measured in the page (4.5:1), and a theme change that dresses the open
 *           page again without reloading it or losing its place
 *   eye     the server's eye (Phase 2) on a made-up internet this script serves: a page with its pictures, sheets, scripts, forms and
 *           trackers, its scripts' own requests, READER, WATCHERS, BILLBOARD, scripts off; then a hostile page that tries every way out.
 *           The browser asks nobody but the site, and the fixture is only ever asked by the server
 *   frame   the page in the frame has no origin: no cookies, storage or parent to read, no way to move the top window or open another;
 *           forged messages do nothing
 */
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341');
const OUT = opt('--out', join('Temp', 'browse', 'see'));
const ONLY = opt('--only', '');
mkdirSync(OUT, { recursive: true });
let passed = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  passed += 1;
  console.log(`  ok  ${what}`);
};

const person = (id, name) => ({ id, displayName: name, email: `${id}@example.com`, createdAt: '2026-11-01T00:00:00.000Z', salt: '', secretHash: '', hidden: true });
const ANN = person('11111111-1111-4111-8111-111111111111', 'SEE ANN');
const BOB = person('22222222-2222-4222-8222-222222222222', 'SEE BOB');

async function open(browser, { as = null, width = 1440, height = 900, theme = null, storage = {} } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const asked = [];
  await context.route(/supabase\.(co|in)\/|api\.debaser\.site/, (route) => route.abort());
  // `left`: it was answered, or failed for some reason other than the frame's policy stopping it before it went.
  const entries = new Map();
  context.on('request', (request) => {
    const entry = { url: request.url(), body: request.postData() ?? '', type: request.resourceType(), left: false };
    entries.set(request, entry);
    asked.push(entry);
  });
  context.on('response', (response) => entries.get(response.request()) && (entries.get(response.request()).left = true));
  context.on('requestfailed', (request) => entries.get(request) && !/csp|BLOCKED_BY|ERR_ABORTED/i.test(request.failure()?.errorText ?? '') && (entries.get(request).left = true));
  await context.addInitScript(
    ({ users, session, themeId, more }) => {
      if (window.top !== window || sessionStorage.getItem('see.seeded') !== null) return;
      sessionStorage.setItem('see.seeded', '1');
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users, sessionUserId: session, bannedIds: [] }));
      localStorage.setItem('debaser.lost-account.never.v1', '1');
      localStorage.setItem('debaser.tour.v2', 'skipped');
      const profile = (user) => ({ userId: user.id, displayName: user.displayName, bio: '', tags: [], comments: [], updatedAt: user.createdAt, privacySeen: true });
      localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: Object.fromEntries(users.map((user) => [user.id, profile(user)])) }));
      if (themeId !== null) localStorage.setItem('debaser.site.theme.v2', themeId);
      for (const [key, value] of Object.entries(more)) localStorage.setItem(key, value);
    },
    { users: [ANN, BOB], session: as === null ? null : as.id, themeId: theme, more: storage },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ..  page error: ${error.message.slice(0, 160)}`));
  return { context, page, asked };
}

const status = (page) => page.locator('[data-seeing-status]').innerText();
const say = (page, words) => page.waitForFunction((text) => document.querySelector('[data-seeing-status]')?.textContent.includes(text), words, { timeout: 15000 });
const key = (page, name) => page.locator('[data-seeing]').getByRole('button', { name, exact: true });
const box = (page) => page.locator('[data-seeing-address]');
const tabs = (page) => page.locator('[data-seeing-tabs] [role="tab"]');
const inside = (page) => page.frameLocator('[data-seeing-frame]').frameLocator('iframe');
const frameOf = async (page) => {
  const outer = await (await page.waitForSelector('[data-seeing-frame]')).contentFrame();
  return (await outer.waitForSelector('iframe', { state: 'attached' })).contentFrame();
};
const go = async (page, text) => {
  await box(page).fill(text);
  await box(page).press('Enter');
};
const machine = async (page) => {
  await page.goto(`${BASE}/browser`, { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-seeing-tabs]', { timeout: 60000 });
};

async function shell(browser) {
  {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/browser`, { timeout: 90000, waitUntil: 'domcontentloaded' });
    await page.locator('[data-seeing]').getByRole('link', { name: '[ LOG IN ]' }).waitFor({ timeout: 60000 });
    ok((await page.locator('[data-seeing-tabs], iframe[data-seeing-frame]').count()) === 0, 'signed out: the sign-in call, and no machine');
    await context.close();
  }
  const { context, page, asked } = await open(browser, { as: ANN });
  await machine(page);
  const bar = page.getByRole('navigation', { name: 'Modules' });
  ok((await bar.getByRole('link', { name: /BROWSER/ }).count()) === 0, 'BROWSER is off the bar until it is ticked');
  await page.screenshot({ path: join(OUT, 'empty.png') });
  asked.length = 0;
  await key(page, 'OPEN THE TEST PAGE').click();
  await say(page, 'DOCUMENT RECONSTRUCTED · BUILT IN · 0 FILES · 0 REFUSED · LENS: STANDARD');
  await inside(page).getByRole('heading', { name: 'The test page' }).waitFor();
  ok((await tabs(page).first().innerText()).toUpperCase().includes('THE TEST PAGE'), "a tab wears its page's title");
  ok(page.url() === `${BASE}/browser#see=see%3Atest`, 'the address is after the #');
  await page.screenshot({ path: join(OUT, 'standard.png') });

  await inside(page).getByRole('link', { name: 'The second test page' }).click();
  await inside(page).getByRole('heading', { name: 'The second test page' }).waitFor();
  ok((await box(page).inputValue()) === 'see:test/2', 'a link pressed in the page opens in the tab');
  ok(await key(page, 'Forward').isDisabled(), 'nothing ahead yet');
  await key(page, 'Back').click();
  await inside(page).getByRole('heading', { name: 'The test page' }).waitFor();
  await key(page, 'Forward').click();
  await inside(page).getByRole('heading', { name: 'The second test page' }).waitFor();
  await key(page, 'Back').click();
  await inside(page).getByRole('link', { name: 'The end of this page' }).click();
  await page.waitForTimeout(200);
  const top = async () => (await frameOf(page)).evaluate(() => document.scrollingElement.scrollTop);
  ok((await top()) > 200, 'a link to a place on the page goes there');
  await key(page, 'Reload').click();
  await say(page, 'DOCUMENT RECONSTRUCTED');
  await page.waitForFunction(() => document.querySelector('[data-seeing-frame]') !== null);
  await page.waitForTimeout(300);
  ok((await top()) === 0, 'reload opens it again from the top');

  await inside(page).getByRole('link', { name: 'An address outside' }).click();
  await say(page, 'SOURCE REFUSED: NO SUCH SITE');
  const source = page.locator('[data-seeing]').getByRole('link', { name: /OPEN SOURCE/ });
  ok((await source.getAttribute('href')) === 'https://example.com/' && (await source.getAttribute('rel')) === 'noopener noreferrer', 'an outside page is refused, with the way to its source');
  await page.screenshot({ path: join(OUT, 'refused.png') });
  for (const [typed, why] of [
    ['javascript:alert(1)', 'ONLY HTTP AND HTTPS'],
    ['https://me:secret@example.com', 'NO NAME OR PASSWORD'],
    ['hello there', "THAT ISN'T AN ADDRESS"],
  ]) {
    await go(page, typed);
    await say(page, why);
    ok((await page.url()).endsWith('#see=https%3A%2F%2Fexample.com%2F'), `refused where it is typed: ${typed.slice(0, 12)}`);
  }
  await key(page, 'Back').click();
  await say(page, 'DOCUMENT RECONSTRUCTED');

  await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ WATCHERS ]' }).click();
  ok((await page.locator('[data-seeing-watchers] li').count()) === 3, 'WATCHERS lists who was on the page');
  await page.screenshot({ path: join(OUT, 'watchers.png') });
  await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ READER ]' }).click();
  await say(page, 'LENS: READER');
  ok((await inside(page).locator('header').count()) === 0, 'READER shows the main text alone');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'reader.png') });
  for (const name of ['[ X-RAY ]', '[ LOW-FI ]', '[ DYE ]']) ok(await page.locator('[data-seeing-lenses]').getByRole('button', { name }).isDisabled(), `${name} waits, quiet`);

  await key(page, 'New tab').click();
  ok((await tabs(page).count()) === 2 && (await status(page)) === 'READY', 'a new tab, empty');
  ok(page.url() === `${BASE}/browser`, 'and no address after the #');
  await page.locator('[data-seeing-frame]').waitFor({ state: 'detached' });
  ok((await page.locator('[data-seeing-frame]').count()) === 0, 'only the tab in front has a page');
  await go(page, 'see:test/2');
  await say(page, 'DOCUMENT RECONSTRUCTED');
  await inside(page).getByRole('link', { name: 'the first page' }).click({ modifiers: ['Control'] });
  await page.waitForFunction(() => document.querySelectorAll('[data-seeing-tabs] [role="tab"]').length === 3);
  ok(true, 'a link pressed with Ctrl opens a tab');
  for (let i = 3; i < 8; i += 1) await key(page, 'New tab').click();
  ok((await tabs(page).count()) === 8 && (await key(page, 'New tab').isDisabled()), 'eight tabs at most');
  await tabs(page).nth(1).click();
  await say(page, 'DOCUMENT RECONSTRUCTED');
  await inside(page).getByRole('link', { name: 'the first page' }).click({ modifiers: ['Control'] });
  await say(page, '8 TABS AT MOST');
  ok((await box(page).inputValue()) === 'see:test/2', 'a ninth opens nowhere: the page in front is left alone');
  for (let i = 8; i > 3; i -= 1) await tabs(page).nth(i - 1).locator('xpath=following-sibling::button').click();
  ok((await tabs(page).count()) === 3, 'a tab is closed by its own key');
  await tabs(page).nth(0).focus();
  await tabs(page).nth(0).click();
  await page.keyboard.press('ArrowRight');
  ok((await tabs(page).nth(1).getAttribute('aria-selected')) === 'true', 'the arrow keys move between tabs');

  await page.reload();
  await page.waitForSelector('[data-seeing-tabs]');
  await say(page, 'DOCUMENT RECONSTRUCTED');
  ok((await tabs(page).count()) === 3 && (await tabs(page).nth(1).getAttribute('aria-selected')) === 'true', 'a reload opens the tabs again where they were');

  await page.evaluate(() => {
    window.location.hash = `#see=${encodeURIComponent('https://example.org/brought')}`;
  });
  await page.waitForFunction(() => document.querySelector('[data-seeing-address]')?.value === 'https://example.org/brought');
  ok((await status(page)) === 'READY' && (await page.locator('[data-seeing-frame]').count()) === 0 && (await tabs(page).count()) === 4, 'an address a link brought waits in a new tab for GO');
  await key(page, '[ GO ]').click();
  await say(page, 'SOURCE REFUSED');
  ok(true, 'and GO opens it');

  const outsideAsked = asked.filter((each) => !each.url.startsWith(BASE) && !each.url.startsWith('ws:') && !/^(data|blob|about):/.test(each.url) && /example\./.test(each.url));
  ok(outsideAsked.length === 0, 'nothing on any page was asked for');
  ok(!asked.some((each) => /example\.(com|org)|see%3A|see:test/.test(each.url.replace(/#.*/, ''))), "no address looked at is in any request's address");
  ok(!asked.some((each) => /example\.(com|org)/.test(each.body) && !each.url.endsWith('/api/see/open')), 'and only the page itself was asked for, in a body');

  // MODULOS ticks it on.
  await bar.getByRole('button', { name: 'MODULOS' }).click();
  await page.getByRole('checkbox', { name: /BROWSER/ }).first().click();
  await bar.getByRole('link', { name: /BROWSER/ }).waitFor();
  ok(/WIP/.test(await bar.getByRole('link', { name: /BROWSER/ }).innerText()), 'ticked in MODULOS it is on the bar, tagged WIP');
  await page.screenshot({ path: join(OUT, 'modulos.png') });

  // Another account in the same browser.
  await page.evaluate((id) => {
    const auth = JSON.parse(localStorage.getItem('debaser.auth.mock.v1'));
    localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ ...auth, sessionUserId: id }));
  }, BOB.id);
  await machine(page);
  ok((await tabs(page).count()) === 1 && (await status(page)) === 'READY', "another account in this browser doesn't see her tabs");
  await context.close();

  const phone = await open(browser, { as: ANN, width: 390, height: 844 });
  await machine(phone.page);
  await go(phone.page, 'see:test');
  await say(phone.page, 'DOCUMENT RECONSTRUCTED');
  ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll at 390');
  await phone.page.screenshot({ path: join(OUT, 'phone.png') });
  await phone.context.close();
}

/** Runs in a page: every element with words of its own, its ink against the nearest painted ground, as rgb triples. */
const MEASURE = `(root) => {
  const parse = (text) => { const n = text.match(/[\\d.]+/g).map(Number); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0)) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || el.closest('.sr-only, script, style')) continue;
    let ground = null;
    for (let at = el; at; at = at.parentElement) { const c = parse(getComputedStyle(at).backgroundColor); if (c.a === 1) { ground = c.rgb; break; } }
    const fill = getComputedStyle(el).getPropertyValue('--key-fill');
    out.push({ text: el.textContent.trim().slice(0, 30), ink: parse(getComputedStyle(el).color).rgb, ground, filled: el.matches('.key-fill') ? fill : '' });
  }
  return out;
}`;
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

async function themes(browser) {
  const ts = require('typescript');
  const { outputText } = ts.transpileModule(require('node:fs').readFileSync('app/lib/ui/themes.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const held = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(held, held.exports, require);
  const list = held.exports.THEMES;
  // PREFERENCES open beside the machine, as a saved layout opens it.
  const layout = { standard: { screen: { w: 1440, h: 900 }, windows: { 'preferences-tall': { rect: { x: 980, y: 60, w: 384, h: 700 }, group: null, open: true, restore: null } }, order: ['preferences-tall'] } };
  const { context, page } = await open(browser, { as: ANN, theme: list[0].id, storage: { 'debaser.windows.mock.v1': JSON.stringify({ [ANN.id]: layout }) } });
  await machine(page);
  await go(page, 'see:test');
  await say(page, 'DOCUMENT RECONSTRUCTED');
  const lens = (name) => page.locator('[data-seeing-lenses]').getByRole('button', { name: `[ ${name} ]` }).click();
  await lens('READER');
  await page.waitForTimeout(400);
  let drawn = await frameOf(page);
  const frameNow = () => drawn;
  await frameNow().evaluate(() => {
    document.scrollingElement.scrollTop = 300;
    window.stillHere = true;
  });
  let lowest = 99;
  let measured = 0;
  for (const theme of list) {
    await pickTheme(page, theme);
    await page.waitForFunction((id) => document.documentElement.dataset.theme === id, theme.id, { timeout: 8000 });
    await page.waitForTimeout(120);
    const same = await frameNow().evaluate(() => ({ still: window.stillHere === true, top: document.scrollingElement.scrollTop }));
    ok(same.still && same.top === 300, `${theme.id}: the open page is dressed again where it stands`);
    const paper = await frameNow().evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    const hex = `#${paper.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
    ok(hex === theme.tokens.paper, `${theme.id}: READER is on the theme's paper`);
    for (const [where, frame, selector] of [['READER', frameNow(), 'body'], ['the machine', page.mainFrame(), '[data-seeing]']]) {
      for (const one of await frame.evaluate(`(${MEASURE})(document.querySelector('${selector}'))`)) {
        // A filled key paints its fill as background stripes; its pair is a token pair, held by check-seeing and check-themes.
        if (one.filled !== '') continue;
        const ground = one.ground ?? theme.tokens.paper.match(/\w\w/g).map((v) => parseInt(v, 16));
        const value = ratio(one.ink, ground);
        lowest = Math.min(lowest, value);
        measured += 1;
        assert.ok(value >= 4.5, `${theme.id} ${where}: "${one.text}" ${value.toFixed(2)}`);
      }
    }
    if (['dark', 'default', 'sherbet-pink', 'tigerbread-toasted'].includes(theme.id)) await page.screenshot({ path: join(OUT, `theme-${theme.id}.png`) });
  }
  ok(true, `${measured} words measured on ${list.length} themes, the lowest ${lowest.toFixed(2)}:1`);
  await lens('STANDARD');
  await page.waitForTimeout(400);
  drawn = await frameOf(page);
  ok((await frameNow().evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(255, 248, 220)', 'STANDARD wears nothing of the theme');
  await context.close();
}

/** Through the picker itself, in PREFERENCES: the template's row, then its option's. */
async function pickTheme(page, theme) {
  const list = page.locator('[data-dock-window="preferences"]');
  if (theme.family !== undefined) await list.getByRole('button', { name: `[ ${theme.family.label} ]`, exact: true }).first().click();
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme.id) await list.getByRole('button', { name: `[ ${theme.label} ]` }).last().click();
}

async function frame(browser) {
  const { context, page } = await open(browser, { as: ANN });
  await machine(page);
  await go(page, 'see:test');
  await say(page, 'DOCUMENT RECONSTRUCTED');
  await page.waitForTimeout(400);
  const inner = await frameOf(page);
  const got = await inner.evaluate(async () => {
    const attempt = (what) => {
      try {
        return { value: String(what()) };
      } catch (error) {
        return { error: error.name };
      }
    };
    const net = async (what) => {
      try {
        await what();
        return 'reached';
      } catch {
        return 'refused';
      }
    };
    const picture = () => new Promise((yes, no) => Object.assign(new Image(), { onload: yes, onerror: no }).setAttribute('src', '/'));
    return {
      origin: self.origin,
      cookie: attempt(() => document.cookie),
      local: attempt(() => localStorage.length),
      session: attempt(() => sessionStorage.length),
      parentDoc: attempt(() => parent.document.title),
      parentStore: attempt(() => parent.localStorage.length),
      top: attempt(() => {
        top.location.href = 'https://example.com/';
        return 'moved';
      }),
      popup: attempt(() => window.open('https://example.com/')),
      fetched: await net(() => fetch('https://example.com/')),
      pictured: await net(picture),
      evaluated: await new Promise((done) => {
        const script = document.createElement('script');
        script.textContent = 'window.ran = true';
        document.body.appendChild(script);
        setTimeout(() => done(window.ran === true), 50);
      }),
    };
  });
  ok(got.origin === 'null', 'the page in the frame has no origin');
  for (const name of ['cookie', 'local', 'session', 'parentDoc', 'parentStore']) ok(got[name].error === 'SecurityError', `it can't read ${name}`);
  ok(got.popup.value === 'null' || got.popup.error !== undefined, "it can't open a window");
  ok(got.fetched === 'refused' && got.pictured === 'refused', "it can't reach any host");
  ok(got.evaluated === false, 'a script without our mark does not run');
  await page.waitForTimeout(400);
  ok(page.url().startsWith(`${BASE}/browser`) && context.pages().length === 1, "it can't move the top window");

  const before = await box(page).inputValue();
  await inner.evaluate(() => {
    for (const message of [{ see: 'open', address: 'javascript:alert(1)' }, { see: 'open', address: 5 }, { see: 'dress', css: 'x' }, 'ready', null]) parent.postMessage(message, '*');
  });
  await page.evaluate(() => window.postMessage({ see: 'open', address: 'https://forged.example/', newTab: true }, '*'));
  await page.waitForTimeout(300);
  ok((await box(page).inputValue()) === before && (await tabs(page).count()) === 1, 'forged and senseless messages do nothing');
  ok((await page.locator('[data-seeing-frame]').getAttribute('sandbox')) === 'allow-scripts', 'the frame wears allow-scripts and nothing more');
  await context.close();
}

/* --- the server's eye -------------------------------------------------------------------------------------------- */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// A name of its own each run: the server keeps files for a few minutes.
const SITE = `https://p${Date.now()}.seeing-fixture.org`;

const ORDINARY = `<!doctype html><html lang="en"><head><title>An ordinary page</title><link rel="stylesheet" href="/s.css">
<script src="/app.js"></script><script src="https://www.googletagmanager.com/gtm.js"></script><script type="module" src="/mod.js"></script></head>
<body><h1>An ordinary page</h1><img id="plain" src="/a.png"><img id="refused" src="https://www.google-analytics.com/p.gif">
<p>${'The story goes on, and on, with commas, and more words, to be the main text of the page. '.repeat(12)}</p>
<a id="next" href="/next">next</a> <a id="far" href="/b#deep">far</a>
<form id="search" action="/find"><input name="q" value="cats"><button id="go">Find</button></form>
<form id="post" method="post" action="/post"><input name="q"><button id="send">Send</button></form>
<form><input type="password" id="pw" value="secret"></form>
<iframe src="https://ad.doubleclick.net/x" width="300" height="250"></iframe>
<iframe src="https://player.seeing-fixture.org/embed" width="300" height="250"></iframe>
<div id="out"></div></body></html>`;

const APP = `
var out = {};
function tell() { document.getElementById('out').textContent = JSON.stringify(out); }
document.addEventListener('DOMContentLoaded', function () {
  out.inline = true;
  localStorage.setItem('k', 'v'); out.store = localStorage.getItem('k') + localStorage.length;
  document.cookie = 'a=1'; out.cookie = document.cookie;
  fetch('/data.json').then(function (r) { return r.json(); }).then(function (d) { out.fetch = d.a; tell(); });
  fetch('/data.json', { method: 'POST' }).catch(function (e) { out.post = e.name; tell(); });
  var x = new XMLHttpRequest(); x.open('GET', 'data.json'); x.responseType = 'json'; x.onload = function () { out.xhr = x.response.a + ':' + x.status; tell(); }; x.send();
  var i = new Image(); i.id = 'made'; i.onload = function () { out.image = true; tell(); }; i.src = '/made.png'; document.body.appendChild(i);
  var d = document.createElement('div'); d.innerHTML = '<img id="markup" src="/markup.png">'; document.body.appendChild(d);
  var s = document.createElement('script'); s.src = '/late.js'; document.head.appendChild(s);
  var p = document.createElement('input'); p.type = 'password'; p.id = 'late-pw'; document.body.appendChild(p);
  fetch('https://www.google-analytics.com/collect').catch(function () { out.tracker = 'refused'; tell(); });
  fetch('http://127.0.0.1:4567/secret').catch(function () { out.loopback = 'refused'; tell(); });
  tell();
});`;

const HOSTILE = `<!doctype html><title>Hostile</title><div id="out"></div><meta http-equiv="refresh" content="1;url=http://127.0.0.1:4567/escaped-refresh"><base href="http://127.0.0.1:4567/">
<script>
var out = {}; function tell() { document.getElementById('out').textContent = JSON.stringify(out); }
function attempt(name, what) { try { var v = what(); out[name] = 'done:' + v; } catch (e) { out[name] = e.name; } }
attempt('origin', function () { return self.origin; });
attempt('parentDoc', function () { return parent.document.title; });
attempt('topDoc', function () { return top.document.title; });
attempt('topStore', function () { return top.localStorage.length; });
attempt('topNav', function () { top['loc' + 'ation'].href = 'http://127.0.0.1:4567/escaped-top'; return 'set'; });
attempt('outerNav', function () { parent['loc' + 'ation'].href = 'http://127.0.0.1:4567/escaped-outer'; return 'set'; });
attempt('popup', function () { return Object.getPrototypeOf(window).constructor.prototype && window.open.call(window, 'http://127.0.0.1:4567/escaped-popup'); });
// A fresh realm, with nothing of ours in it.
var HTML = 'http://www.w3.org/1999/xhtml', root = document.documentElement, F = 'ifr' + 'ame', T = '<' + F + '>';
attempt('makeElement', function () { root.appendChild(document.createElement(F)); return window.length; });
attempt('makeElementNS', function () { root.appendChild(document.createElementNS(HTML, 'x:' + F)); return window.length; });
attempt('makeTwoFaced', function () { var n = 0; root.appendChild(document.createElement({ toString: function () { return n++ ? F : 'p'; } })); return window.length; });
attempt('makeProto', function () { root.appendChild(Document.prototype.createElement.call(new Document(), F)); return window.length; });
attempt('makeOther', function () { root.appendChild(document.implementation.createHTMLDocument('').createElement(F)); return window.length; });
attempt('makeDocument', function () { root.appendChild(document.adoptNode(document.implementation.createDocument(HTML, F, null).documentElement)); return window.length; });
attempt('makeInner', function () { var d = document.createElement('div'); root.appendChild(d); d.innerHTML = T; return window.length; });
attempt('makeOuter', function () { var d = document.createElement('div'); root.appendChild(d); d.outerHTML = T; return window.length; });
attempt('makeAdjacent', function () { root.insertAdjacentHTML('beforeend', T); return window.length; });
attempt('makeRange', function () { root.appendChild(document.createRange().createContextualFragment(T)); return window.length; });
attempt('makeTemplate', function () { var t = document.createElement('template'); t.innerHTML = T; root.appendChild(t.content); return window.length; });
attempt('makeShadow', function () { var d = document.createElement('div'); root.appendChild(d); d.attachShadow({ mode: 'open' }).innerHTML = T; return window.length; });
attempt('makeParser', function () { root.appendChild(document.adoptNode(new DOMParser().parseFromString(T, 'text/html').querySelector(F))); return window.length; });
attempt('makeXml', function () { root.appendChild(document.adoptNode(new DOMParser().parseFromString('<q:' + F + ' xmlns:q="' + HTML + '"/>', 'application/xml').documentElement)); return window.length; });
attempt('makeXmlEntity', function () { var x = new DOMParser().parseFromString('<!DOCTYPE a [<!ENTITY e "&#60;q:' + '&#105;frame xmlns:q=\\'' + HTML + '\\'/&#62;">]><a>&e;</a>', 'application/xml'); root.appendChild(document.adoptNode(x.documentElement)); return window.length; });
attempt('makeSafe', function () { var d = document.createElement('div'); root.appendChild(d); d.setHTML(T, { sanitizer: { elements: [F] } }); return window.length; });
attempt('makeUnsafe', function () { var d = document.createElement('div'); root.appendChild(d); d.setHTMLUnsafe(T); return window.length; });
attempt('makeParseUnsafe', function () { root.appendChild(document.adoptNode(Document.parseHTMLUnsafe(T).querySelector(F))); return window.length; });
attempt('makeCustom', function () { class X extends HTMLIFrameElement {} customElements.define('x-y', X, { extends: F }); root.appendChild(new X()); return window.length; });
attempt('makeCommand', function () { var d = document.createElement('div'); d.contentEditable = 'true'; root.appendChild(d); d.focus(); document.execCommand('insertHTML', false, T); return window.length; });
attempt('makeXslt', function () { return new XSLTProcessor() && 'made'; });
attempt('makePolicy', function () { trustedTypes.createPolicy('mine', { createHTML: function (s) { return s; } }); return 'made'; });
attempt('makeSplit', function () { var d = document.createElement('div'); root.appendChild(d); document.write('<ifr'); document.write('ame>'); return window.length; });
attempt('rtc', function () { return new RTCPeerConnection() && 'made'; });
out.frames = window.length;
var w = window[0];
attempt('freshFetch', function () { w.fetch('http://127.0.0.1:4567/escaped-fetch', { mode: 'no-cors' }).catch(function () { out.freshFetchEnd = 'refused'; tell(); }); return 'asked'; });
attempt('freshRtc', function () { var c = new w.RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:4567' }] }); c.createDataChannel('x'); c.createOffer().then(function (o) { return c.setLocalDescription(o); }).catch(function (e) { out.rtcEnd = e.name; tell(); }); return 'made'; });
attempt('freshSocket', function () { new w.WebSocket('ws://127.0.0.1:4567/escaped-socket'); return 'made'; });
attempt('freshWorker', function () { new w.Worker('data:text/javascript,1'); return 'made'; });
attempt('freshPopup', function () { return w.open('http://127.0.0.1:4567/escaped-popup2'); });
attempt('freshStore', function () { return w.localStorage.length; });
attempt('freshCookie', function () { return w.document.cookie; });
attempt('download', function () { var a = document.createElement('a'); a.href = 'data:text/plain,x'; a.download = 'x.txt'; document.documentElement.appendChild(a); a.click(); return 'clicked'; });
attempt('form', function () { var m = document.createElement('form'); m.action = 'http://127.0.0.1:4567/escaped-form'; document.documentElement.appendChild(m); HTMLFormElement.prototype.submit.call(m); return 'sent'; });
attempt('frame', function () { var m = document.createElement('iframe'); m.src = 'http://127.0.0.1:4567/escaped-frame'; document.documentElement.appendChild(m); return 'made'; });
attempt('object', function () { var m = document.createElement('object'); m.data = 'http://127.0.0.1:4567/escaped-object'; document.documentElement.appendChild(m); return 'made'; });
attempt('link', function () { ['prefetch', 'preload', 'dns-prefetch', 'preconnect', 'icon', 'manifest', 'modulepreload'].forEach(function (rel) { var l = document.createElement('link'); l.rel = rel; l.as = 'image'; Element.prototype.setAttribute.call(l, 'href', 'http://127.0.0.1:4567/escaped-' + rel); document.head.appendChild(l); }); return 'made'; });
attempt('style', function () { var m = document.createElement('style'); m.textContent = 'body{background:url(http://127.0.0.1:4567/escaped-style)} @import url(http://127.0.0.1:4567/escaped-import)'; document.head.appendChild(m); return 'made'; });
attempt('picture', function () { var m = document.createElementNS('http://www.w3.org/2000/svg', 'image'); m.setAttributeNS('http://www.w3.org/1999/xlink', 'href', 'http://127.0.0.1:4567/escaped-svg'); document.documentElement.appendChild(m); return 'made'; });
attempt('api', function () { w.fetch('SITE/api/see/open', { method: 'POST', body: '{}' }).then(function (r) { out.apiEnd = 'answered ' + r.status; tell(); }, function () { out.apiEnd = 'refused'; tell(); }); return 'asked'; });
attempt('dress', function () { top.postMessage({ see: 'dress', css: 'x' }, '*'); for (var i = 0; i < 50; i += 1) top.postMessage({ see: 'open', address: 'https://spam.seeing-fixture.org/spam' + i, newTab: true }, '*'); top.postMessage({ see: 'open', address: 'javascript:alert(1)' }, '*'); return 'sent'; });
setTimeout(function () { location.href = 'http://127.0.0.1:4567/escaped-self'; }, 300);
setTimeout(tell, 1200); tell();
</script>`;

function fixture() {
  const asked = [];
  const pages = {
    '/': ['text/html', ORDINARY],
    '/app.js': ['text/javascript', APP],
    '/mod.js': ['text/javascript', "import { x } from './part.js'; window.moduleSays = x; document.documentElement.setAttribute('data-module', x);"],
    '/part.js': ['text/javascript', "export const x = 'joined';"],
    '/late.js': ['text/javascript', "document.documentElement.setAttribute('data-late', 'ran');"],
    '/s.css': ['text/css', '@import "two.css"; h1{color:rgb(1, 2, 3)}'],
    '/two.css': ['text/css', 'p{color:rgb(4, 5, 6);background:url(/bg.png)}'],
    '/a.png': ['image/png', PNG], '/made.png': ['image/png', PNG], '/markup.png': ['image/png', PNG], '/bg.png': ['image/png', PNG],
    '/data.json': ['application/json', '{"a":"json"}'],
    '/next': ['text/html', '<title>Next</title><h1>Next</h1>'],
    '/b': ['text/html', '<title>Far</title><h1>Far</h1>'],
    '/find': ['text/html', '<title>Found</title><h1>Found</h1>'],
    '/hostile': ['text/html', HOSTILE],
    '/sends': ['text/html', '<title>Sends</title><script>location.href = "/next"</script>'],
    '/refreshes': ['text/html', '<meta http-equiv=refresh content="0;url=/next"><title>Refreshes</title>'],
    '/loop': ['text/html', '<title>Loop</title><h1>Loop</h1><script>setTimeout(function () { location.href = "/loop2"; }, 50)</script>'],
    '/loop2': ['text/html', '<title>Loop</title><h1>Loop</h1><script>setTimeout(function () { location.href = "/loop"; }, 50)</script>'],
  };
  const server = require('node:http').createServer((request, answer) => {
    asked.push({ path: request.url, host: request.headers['x-fixture-host'] ?? null, headers: request.headers });
    const [type, body] = pages[request.url.split('?')[0]] ?? ['text/html', '<title>Nothing</title><h1>Nothing</h1>'];
    if (request.url === '/moved') {
      answer.writeHead(302, { location: '/next' }).end();
      return;
    }
    answer.writeHead(pages[request.url.split('?')[0]] ? 200 : 404, { 'content-type': type, 'access-control-allow-origin': '*' }).end(String(body).replaceAll ? (Buffer.isBuffer(body) ? body : body.replaceAll('SITE', BASE)) : body);
  });
  return new Promise((done) => server.listen(4567, '127.0.0.1', () => done({ asked, close: () => server.close() })));
}

async function eye(browser) {
  const net = await fixture();
  try {
    const { context, page, asked } = await open(browser, { as: ANN });
    await machine(page);
    asked.length = 0;
    await go(page, `${SITE}/`);
    await say(page, 'DOCUMENT RECONSTRUCTED · SERVER EYE');
    const line = await status(page);
    ok(/\d+ FILES · \d+ REFUSED · LENS: STANDARD/.test(line), `the status line says what was done: ${line}`);
    ok((await tabs(page).first().innerText()).toUpperCase().includes('AN ORDINARY PAGE'), 'the tab wears its title');
    const out = async () => JSON.parse(await inside(page).locator('#out').innerText());
    await page.waitForFunction(() => true);
    let said = {};
    for (let i = 0; i < 60; i += 1) {
      said = await out().catch(() => ({}));
      if (said.fetch && said.xhr && said.image && said.tracker && said.loopback && said.post) break;
      await page.waitForTimeout(250);
    }
    const inner = await frameOf(page);
    ok(said.inline && said.store === 'v1' && said.cookie === 'a=1', "a page's scripts run, with storage in memory");
    ok(said.fetch === 'json' && said.xhr === 'json:200', 'what they ask for is asked by the server');
    ok(said.post === 'TypeError', 'a script may not send');
    ok(said.tracker === 'refused' && said.loopback === 'refused', 'nor reach a tracker, nor this machine');
    ok(said.image === true, 'a picture a script makes is signed and drawn');
    await page.waitForTimeout(800);
    const drawn = await inner.evaluate(() => ({
      plain: document.querySelector('#plain').naturalWidth,
      markup: document.querySelector('#markup').naturalWidth,
      refused: document.querySelector('#refused').getAttribute('src'),
      colour: getComputedStyle(document.querySelector('h1')).color,
      imported: getComputedStyle(document.querySelector('p')).color,
      late: document.documentElement.getAttribute('data-late'),
      module: document.documentElement.getAttribute('data-module'),
      pw: [document.querySelector('#pw'), document.querySelectorAll('input[type=password]').length, document.querySelector('#late-pw').disabled],
      frames: document.querySelectorAll('iframe').length,
      link: document.querySelector('[data-see-frame]').textContent,
    }));
    ok(drawn.plain === 1 && drawn.markup === 1, 'pictures are drawn, one a script wrote as markup too');
    if (drawn.colour !== 'rgb(1, 2, 3)' || drawn.imported !== 'rgb(4, 5, 6)') console.log(drawn);
    ok(drawn.colour === 'rgb(1, 2, 3)' && drawn.imported === 'rgb(4, 5, 6)', 'styles are, and what they import');
    ok(drawn.late === 'ran' && drawn.module === 'joined', 'a script put in later runs, and a module with the module it needs');
    ok(drawn.refused === null && drawn.pw[1] === 0 && drawn.pw[2] === true, 'a tracker is gone, and every password box is dead');
    ok(drawn.frames === 0 && drawn.link === '[ FRAME: player.seeing-fixture.org ]', 'a frame in the page is a link to it');
    await page.screenshot({ path: join(OUT, 'eye.png') });

    const strangers = asked.filter((each) => each.left && !each.url.startsWith(`${BASE}/`) && !/^(?:data|blob|about|ws):/.test(each.url));
    ok(strangers.length === 0, `the browser asked nobody but the site (${strangers.slice(0, 2).map((each) => each.url)})`);
    ok(!asked.some((each) => /seeing-fixture/.test(each.url)), 'and no address of the page is in any request it made');
    ok(net.asked.length > 5 && net.asked.every((each) => each.host !== null), 'the page was asked for by the server alone');
    ok(net.asked.every((each) => each.headers.cookie === undefined && each.headers.referer === undefined && each.headers.authorization === undefined && !/debaser|luke/i.test(JSON.stringify(each.headers))), 'with nothing of the reader or the site');
    ok(!net.asked.some((each) => /doubleclick|googletag|analytics|player/.test(String(each.host)) || each.path === '/secret'), 'and nothing refused was asked for');

    await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ WATCHERS ]' }).click();
    const watchers = await page.locator('[data-seeing-watchers]').innerText();
    ok(/Google/.test(watchers) && /REFUSED/.test(watchers), 'WATCHERS says who was on it and what was refused');
    await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ READER ]' }).click();
    await inside(page).getByText('The story goes on').first().waitFor();
    ok((await (await frameOf(page)).evaluate(() => document.querySelectorAll('form, #out, script[src]').length)) === 0, 'READER is the story alone');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'eye-reader.png') });
    await page.locator('[data-seeing-lenses]').getByRole('button', { name: '[ STANDARD ]' }).click();

    await inside(page).locator('#next').click();
    await inside(page).getByRole('heading', { name: 'Next' }).waitFor();
    ok((await box(page).inputValue()) === `${SITE}/next`, 'a link is followed in the tab');
    await key(page, 'Back').click();
    await inside(page).locator('#go').waitFor();
    await inside(page).locator('#go').click();
    await inside(page).getByRole('heading', { name: 'Found' }).waitFor();
    ok((await box(page).inputValue()) === `${SITE}/find?q=cats`, 'a search is sent, as a GET');
    await key(page, 'Back').click();
    await inside(page).locator('#send').click();
    await say(page, 'FORMS THAT SEND');
    ok(!net.asked.some((each) => each.path === '/post'), 'any other form is not');
    await go(page, `${SITE}/moved`);
    await inside(page).getByRole('heading', { name: 'Next' }).waitFor();
    ok((await box(page).inputValue()) === `${SITE}/next`, 'a page sent on is where it ended');
    await go(page, `${SITE}/nowhere`);
    await say(page, 'HTTP 404');
    ok(true, "a page that isn't there says so");

    await go(page, `${SITE}/`);
    await say(page, 'DOCUMENT RECONSTRUCTED');
    await page.locator('[data-seeing]').getByRole('button', { name: '[ SCRIPTS OFF ]' }).click();
    await page.waitForTimeout(1500);
    const off = await (await frameOf(page)).evaluate(() => ({ out: document.querySelector('#out').textContent, scripts: document.querySelectorAll('script').length }));
    ok(off.out === '' && off.scripts === 1, 'SCRIPTS OFF: only ours is left, and nothing of theirs ran');
    await page.locator('[data-seeing]').getByRole('button', { name: '[ SCRIPTS OFF ]' }).click();
    await say(page, 'DOCUMENT RECONSTRUCTED');

    await go(page, `${SITE}/sends`);
    await inside(page).getByRole('heading', { name: 'Next' }).waitFor();
    ok(true, 'a page that sends itself on is let');
    await go(page, `${SITE}/refreshes`);
    await inside(page).getByRole('heading', { name: 'Next' }).waitFor();
    ok(true, 'and one that says it does');
    await page.waitForTimeout(21_000);
    await go(page, `${SITE}/loop`);
    await page.waitForTimeout(6000);
    const loops = net.asked.filter((each) => /^\/loop/.test(each.path)).length;
    ok(loops >= 2 && loops <= 12, `and one that does it without end is stopped (${loops})`);

    net.asked.length = 0;
    asked.length = 0;
    const tabsBefore = await tabs(page).count();
    await page.evaluate(() => {
      window.messagesHeard = 0;
    });
    await page.waitForTimeout(6000);
    await go(page, `${SITE}/hostile`);
    await say(page, 'THE PAGE TRIED TO SEND YOU ON');
    await page.waitForTimeout(4000);
    const hostile = await (await frameOf(page)).evaluate(() => document.querySelector('#out') && document.querySelector('#out').textContent).catch(() => null);
    console.log('  ..  the hostile page says:', String(hostile).slice(0, 900));
    ok(hostile !== null && hostile !== '', 'the hostile page ran');
    {
      const got = JSON.parse(hostile);
      ok(got.origin === 'done:null', 'the hostile page has no origin');
      ok(got.frames === 0 && Object.entries(got).filter(([name, value]) => /^make/.test(name) && !/^(?:done:0|[A-Z]\w*Error)$/.test(value)).length === 0, `no way of making a frame made one (${JSON.stringify(Object.entries(got).filter(([name, value]) => /^make/.test(name) && !/^(?:done:0|[A-Z]\w*Error)$/.test(value)))})`);
      ok(/Error/.test(got.rtc) && /Error/.test(got.freshRtc), 'so WebRTC is out of its reach');
      for (const name of ['parentDoc', 'topDoc', 'topStore', 'topNav', 'outerNav']) ok(got[name] === 'SecurityError', `it can't: ${name}`);
      ok(!/^done:\[object/.test(got.freshPopup ?? '') && !/^done:\[object/.test(got.popup ?? ''), 'it opened no window');
      ok(got.apiEnd !== undefined ? got.apiEnd === 'refused' : true, "it can't ask the site's own routes");
    }
    const escaped = net.asked.filter((each) => /escaped/.test(each.path) && each.host === null);
    ok(escaped.length === 0, `it reached nothing by itself (${escaped.map((each) => each.path)})`);
    const strangers2 = asked.filter((each) => each.left && !each.url.startsWith(`${BASE}/`) && !/^(?:data|blob|about|ws|chrome-error):/.test(each.url));
    ok(strangers2.length === 0, `and the browser asked nobody but the site (${strangers2.slice(0, 3).map((each) => each.url)})`);
    ok(context.pages().length === 1 && page.url().startsWith(`${BASE}/browser`), 'the top window is where it was, and alone');
    ok((await tabs(page).count()) === tabsBefore, 'its fifty forged messages opened no tab');
    ok(net.asked.filter((each) => /spam/.test(each.path)).length === 0, 'and fetched nothing');
    await context.close();
  } finally {
    net.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, // The frames in their own processes are how a real browser keeps them apart; this tool can't look inside them there.
    args: ['--use-angle=swiftshader', '--disable-features=IsolateSandboxedIframes'] });
  try {
    for (const [name, run] of [['shell', shell], ['frame', frame], ['eye', eye], ['themes', themes]]) {
      if (ONLY !== '' && ONLY !== name) continue;
      console.log(`\n=== ${name} ===`);
      await run(browser);
    }
    console.log(`\n${passed} passed`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
