/**
 * Every text-on-surface pair on a page, measured - in every theme, because a pair is a pair *per theme*.
 *
 * **Why this exists.** The check suite can hold a *table* of pairs to 4.5:1 (`Temp/check-themes.cjs`
 * does, for the tokens), and that table is only as complete as somebody's memory of it. The site has
 * hundreds of class lists and a palette of nine dyes; the pairs that actually occur are a fact about the
 * DOM the browser built, and nobody can enumerate them by reading source. `check-surreal.cjs` and
 * `check-themes.cjs` both read *source*, so a pair that only exists once a component renders - a status
 * bar whose ink comes from a parent, a badge inside a hovered row - is invisible to them by construction,
 * which is how `text-paper` on `bg-ena` sat in 55 rows at 1.91:1 in the dark theme with every check green.
 *
 * So this one asks the browser. For each theme it loads the page, walks every element that has text of its
 * own, resolves the ink from `color` and the surface from the *nearest ancestor that actually paints one*,
 * and computes the WCAG ratio. Two faults are reported, and the second is the one a ratio cannot see:
 *
 *   1. a pair below its floor - 4.5:1, or 3:1 for large or bold text, which is WCAG's floor for that size;
 *   2. an ink that *equals* its surface - 1.00:1, invisible text, which reads as "no text" rather than as
 *      "bad contrast" and is therefore missed by anything that starts from a table of colours.
 *
 *     npm run contrast                       the board, both themes, from a server it starts itself
 *     npm run contrast -- --theme dark       one theme only
 *     npm run contrast -- --url http://localhost:3200/thread/1
 *     npm run contrast -- --no-js            block every script: what the *boot* script alone produces
 *     npm run contrast -- --json             machine-readable, one object
 *
 * **`--no-js` is a real experiment, not a variant.** It answers a question nothing else here can: does the
 * page arrive themed before a single byte of application JavaScript runs? A page with every `.js` request
 * refused is the *earliest* state a reader can see, so a dark theme already applied there is a theme with
 * no flash - which is the whole reason `themeBootScript` exists.
 *
 * **What it cannot say.** It measures *pairs*, not layout: nothing here knows whether two boxes overlap,
 * whether one is cut off, or what a gradient does across a glyph. An element whose surface comes from a
 * `background-image` (the dithered desktop tile) is reported as `tiled` rather than guessed at, and text
 * drawn into a `canvas`, an `<img>` or a `::before` is not seen at all.
 */
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { close, flags, goto, open } = require('./browser.cjs');

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE_KEY = 'debaser.site.theme.v1';
const THEME_IDS = ['default', 'dark'];

const argv = flags();
const target = argv.at('--url', `${BASE}/forum`);
const only = argv.at('--theme', null);
const noJs = argv.has('--no-js');
const asJson = argv.has('--json');

/** Is something already listening? A refused socket is the answer that matters, not the error text. */
async function up() {
  try {
    const response = await fetch(`${BASE}/forum`, { signal: AbortSignal.timeout(4000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * The walk, evaluated in the page.
 *
 * It reads the *rendered* document, which is the point: `color` and `background-color` there are what the
 * browser resolved from the theme's custom properties, so a token written to the wrong place shows up as
 * the wrong pair rather than as a wrong string in a file.
 *
 * A surface is inherited - most elements paint no background at all - so the ink on them is read against
 * the nearest ancestor that does. A translucent fill is composited by the browser and read back as
 * `rgba(...)`, which is *not* flattened here: the element is reported as `translucent`, because
 * compositing it against the right backdrop is a guess and a guess printed as a ratio is worse than a
 * question. The entry carries the surface's own class list, so a failure is findable in the source.
 */
const WALK = `(() => {
  const rgb = (value) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const where = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 6).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const surfaceOf = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      const fill = rgb(style.backgroundColor);
      if (fill && fill.a > 0) {
        return { fill, from: where(node), owner: where(node), tiled: style.backgroundImage !== 'none', translucent: fill.a < 1 };
      }
      if (style.backgroundImage !== 'none') {
        return {
          fill: { r: 255, g: 255, b: 255, a: 1 },
          from: where(node) + ' (tiled)',
          owner: where(node),
          tiled: true,
          translucent: false,
        };
      }
      node = node.parentElement;
    }
    return null;
  };

  const checked = [];
  const failing = [];
  for (const el of document.querySelectorAll('body *')) {
    let text = '';
    for (const child of el.childNodes) if (child.nodeType === 3) text += child.nodeValue;
    text = text.replace(/\\s+/g, ' ').trim();
    if (text.length === 0) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;

    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;

    const ink = rgb(style.color);
    const surface = surfaceOf(el);
    if (!ink || !surface) continue;

    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const entry = {
      text: text.slice(0, 40),
      where: where(el),
      ink: style.color,
      surface: surface.from,
      surfaceFill: 'rgb(' + surface.fill.r + ', ' + surface.fill.g + ', ' + surface.fill.b + ')',
      surfaceFrom: surface.owner,
      ratio: Math.round(ratio(ink, surface.fill) * 100) / 100,
      floor: large ? 3 : 4.5,
      tiled: surface.tiled,
      translucent: surface.translucent,
      at: Math.round(box.x) + ',' + Math.round(box.y + window.scrollY),
    };

    checked.push(entry);
    if (entry.ratio < entry.floor) failing.push(entry);
  }

  return {
    theme: document.documentElement.getAttribute('data-theme'),
    scheme: getComputedStyle(document.documentElement).colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyInk: getComputedStyle(document.body).color,
    checked: checked.length,
    tiled: checked.filter((entry) => entry.tiled).length,
    failing,
  };
})()`;

/**
 * One theme, one page, one reading.
 *
 * The theme is *seeded into storage before any page script runs* (`addInitScript`), which is what makes
 * this the same path a returning reader takes - `themeBootScript` reads that key in `<head>` - rather than
 * a theme applied by a tool after the fact. Without that the walk would measure the default theme wearing
 * another theme's name, which is exactly the kind of stale reading `Temp/qa/*.html` taught this repository
 * to distrust.
 */
async function reading(browser, theme, { blockScripts = false } = {}) {
  await browser.page.addInitScript(
    ([key, id]) => {
      try {
        window.localStorage.setItem(key, id);
      } catch {
        /* storage blocked: the walk then measures the default theme, and says so */
      }
    },
    [STORAGE_KEY, theme],
  );

  if (blockScripts) await browser.page.route('**/*.js', (route) => route.abort());

  await goto(browser.page, target, { settle: 2500 });
  const result = await browser.page.evaluate(WALK);

  if (blockScripts) await browser.page.unroute('**/*.js');

  return { theme, ...result, refused: blockScripts };
}

function line(entry) {
  const tiled = entry.tiled ? ' tiled' : '';
  return `  ${String(entry.ratio).padStart(5)}:1 vs ${entry.floor}:1${tiled}  ${entry.ink} on ${entry.surface}  ${entry.at}  ${entry.where}  ${JSON.stringify(entry.text)}`;
}

(async () => {
  let server = null;

  if (!(await up())) {
    console.log(`starting next start on :${PORT} ...`);
    // `node node_modules/next/dist/bin/next`, not `npx next`: the shim leaves the server alive on
    // Windows and a stale listener is what `npm run capture` was rebuilt to avoid (see its comment).
    server = spawn(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
      stdio: 'ignore',
      detached: false,
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await up()) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!(await up())) {
    console.error(`nothing is serving ${BASE}. Run \`npm run build\` and then \`npm run capture\`, or serve one yourself.`);
    process.exitCode = 1;
    return;
  }

  const browser = await open({ size: [1440, 1000] });
  const readings = [];

  try {
    for (const theme of only === null ? THEME_IDS : [only]) {
      readings.push(await reading(browser, theme));
      if (noJs) readings.push(await reading(browser, theme, { blockScripts: true }));
    }
  } finally {
    await close(browser, { keep: false });
    if (server !== null) server.kill();
  }

  if (asJson) {
    console.log(JSON.stringify(readings, null, 2));
  } else {
    for (const result of readings) {
      console.log('');
      console.log(`=== ${target}  theme=${result.theme}${result.refused ? '  (every script refused)' : '  (scripts on)'}`);
      console.log(`    data-theme=${result.theme}  color-scheme=${result.scheme}  body ${result.bodyInk} on ${result.bodyBg}`);
      console.log(`    ${result.checked} text element(s) measured, ${result.tiled} on a tiled surface`);
      if (result.failing.length === 0) {
        console.log('    every pair is at or above its floor');
      } else {
        console.log(`    ${result.failing.length} pair(s) below the floor:`);
        for (const entry of result.failing) console.log(line(entry));
      }
    }
    console.log('');
    console.log('Pairs, not layout: nothing above knows whether two boxes overlap or what a gradient does.');
    console.log('For the boot script, `--no-js` is the reading that matters: a themed page with no');
    console.log('application JavaScript at all is a page with nowhere for a flash to happen.');
  }

  if (readings.some((result) => result.failing.length > 0)) process.exitCode = 2;
})().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});
