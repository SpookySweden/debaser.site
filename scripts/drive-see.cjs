/*
 * BROWSER, the DEBASER SEEING MACHINE (SPEC-seeing-machine.md, Luke 2026-11-23), Phase 1: the shell, in a real browser.
 * On a LOCAL mock dev server only (core.md, "Test locally"): mock sign-in, and the live database blocked.
 *
 *   node scripts/dev-mock-live.cjs 3341           (in another terminal)
 *   node scripts/drive-see.cjs --base http://localhost:3341 [--out Temp/browse/see] [--only shell|themes|frame]
 *
 *   shell   signed out, the sign-in call and no machine; BROWSER off the bar until ticked in MODULOS, then there with WIP; the test page,
 *           its links, back, forward, reload, tabs (eight at most), the address box, refusals, lens keys, the address after the #, an
 *           address a link brought waiting for GO, tabs open again after a reload and private to their account; nothing is asked of any
 *           host but the site, and no address is in any request; no sideways scroll at 390
 *   themes  every theme: READER's words and the machine's own measured in the page (4.5:1), and a theme change that dresses the open
 *           page again without reloading it or losing its place
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
  context.on('request', (request) => asked.push({ url: request.url(), body: request.postData() ?? '', type: request.resourceType() }));
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
const inside = (page) => page.frameLocator('[data-seeing-frame]');
const frameOf = async (page) => (await page.waitForSelector('[data-seeing-frame]')).contentFrame();
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
  await say(page, 'SOURCE REFUSED: THE MACHINE HAS NO EYE YET');
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
  await inside(page).locator('body').waitFor({ state: 'detached' }).catch(() => undefined);
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
  ok(!asked.some((each) => /example\.(com|org)|see%3A|see:test/.test(`${each.url.replace(/#.*/, '')} ${each.body}`)), 'no address looked at is in any request');

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

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader'] });
  try {
    for (const [name, run] of [['shell', shell], ['frame', frame], ['themes', themes]]) {
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
