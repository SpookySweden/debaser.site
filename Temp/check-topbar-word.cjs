/**
 * The name of the page you're on in the top bar (FORUM) reads on every theme's own bar, from the first paint (Luke, 2026-11-16: "Yes, fix it").
 *
 * The fault it holds: the server cannot know the reader's theme, so the word's colour it sent was worked out for the dark theme and
 * stayed that way on every theme until the page's scripts had loaded (for ever with scripts blocked): a bright green on Flavine,
 * on the pinks and on the oranges. So each theme is opened twice, in Chrome:
 *   1. with every script file refused (only the inline theme boot runs), which is what a reader sees before the page is live;
 *   2. with scripts, once the page has settled.
 * Both times the word must read 4.5:1 on the bar and on the highlighter stroke behind it, and the stroke must still be seen.
 *
 *   node Temp/check-topbar-word.cjs                 the local build (`npm run build` first); starts its own `next start` on :3214 if none is up
 *   node Temp/check-topbar-word.cjs --url <origin>  any copy, e.g. a local mock dev server (use http://localhost:<port>, which hydrates)
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3214;
const urlAt = process.argv.indexOf('--url');
const BASE = urlAt === -1 ? `http://localhost:${PORT}` : process.argv[urlAt + 1].replace(/\/$/, '');
const STORAGE_KEY = 'debaser.site.theme.v2';

/** Every theme the picker offers, read from the library itself so a new one is checked without editing this file. */
function themeIds() {
  const ts = require('typescript');
  const source = require('node:fs').readFileSync(path.join(ROOT, 'app/lib/ui/themes.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const module = { exports: {} };
  new Function('module', 'exports', outputText)(module, module.exports);
  return module.exports.THEMES.map((theme) => theme.id);
}

async function up() {
  try {
    return (await fetch(`${BASE}/forum`)).ok;
  } catch {
    return false;
  }
}

const channels = (colour) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16));
  return colour.match(/[\d.]+/g).slice(0, 3).map(Number);
};
const lum = (colour) => {
  const [r, g, b] = channels(colour).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

(async () => {
  let server = null;
  if (urlAt === -1 && !(await up())) {
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    for (let attempt = 0; attempt < 40 && !(await up()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));
  const faults = [];
  let tightest = Infinity;
  try {
    assert.ok(await up(), `nothing is serving ${BASE}/forum (run npm run build first)`);
    const ids = themeIds();
    assert.ok(ids.length >= 19, 'every theme is read from the library (' + ids.length + ')');
    for (const scripts of [false, true]) {
      for (const id of ids) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
        await context.addInitScript(([key, theme]) => {
          window.localStorage.setItem(key, theme);
          window.localStorage.setItem('debaser.lost-account.never.v1', '1');
        }, [STORAGE_KEY, id]);
        // Nothing leaves for the live database, whatever the server's settings.
        await context.route(/supabase\.(co|in)\//, (route) => route.abort());
        if (!scripts) await context.route(/\.js(\?|$)/, (route) => route.abort());
        const page = await context.newPage();
        await page.goto(`${BASE}/forum`, { waitUntil: scripts ? 'load' : 'domcontentloaded', timeout: 60000 });
        if (scripts) await page.waitForTimeout(2500);
        const got = await page.evaluate(() => {
          const word = document.querySelector('nav[aria-label="Modules"] [aria-current="page"]');
          if (!word) return null;
          const style = getComputedStyle(word);
          return {
            theme: document.documentElement.dataset.theme,
            word: style.color,
            swipe: style.getPropertyValue('--swipe').trim(),
            bar: getComputedStyle(word.closest('nav')).backgroundColor,
            hydrated: Object.keys(word).some((key) => key.startsWith('__reactFiber$')),
          };
        });
        await context.close();
        const when = scripts ? 'live' : 'first paint';
        assert.ok(got !== null, `the top bar shows the page you're on (${id}, ${when})`);
        assert.equal(got.theme, id, `the page opened in ${id} (${when})`);
        assert.equal(got.hydrated, scripts, scripts ? 'the page went live' : 'no script ran but the boot');
        // A swipe written as color-mix() (the stylesheet's own pair) is read back by Chrome as rgb or color(srgb ...): only hex or rgb is measured.
        assert.match(got.swipe, /^(#[0-9a-f]{6}|rgb)/i, `the stroke is a colour that can be measured (${id}, ${when}: ${got.swipe})`);
        const onBar = ratio(got.word, got.bar);
        const onStroke = ratio(got.word, got.swipe);
        tightest = Math.min(tightest, onBar, onStroke);
        if (onBar < 4.5 || onStroke < 4.5) faults.push(`${id} (${when}): ${got.word} on the bar ${got.bar} ${onBar.toFixed(2)}:1, on its stroke ${got.swipe} ${onStroke.toFixed(2)}:1`);
        if (ratio(got.swipe, got.bar) < 1.15) faults.push(`${id} (${when}): the stroke ${got.swipe} cannot be seen on the bar ${got.bar}`);
      }
    }
    assert.deepEqual(faults, [], 'the page name reads on every theme, first paint and live:\n    ' + faults.join('\n    '));
    console.log(`  ok    the page name reads on all ${themeIds().length} themes' bars, at first paint and live (tightest ${tightest.toFixed(2)}:1)`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
