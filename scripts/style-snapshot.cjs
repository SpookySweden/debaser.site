/**
 * Record what every element on a page *computes to*, and compare two recordings.
 *
 * The proof for a change that is meant to move nothing: renaming a class onto a token, moving a value
 * into `app/theme/tokens.css`, splitting a stylesheet. A screenshot cannot prove that - a clock ticks,
 * a crawl scrolls, an antialiased edge shifts - and a source diff cannot either, because two class names
 * that look different may compute the same and two that look alike may not. What the browser computed
 * for each element is the thing a visitor sees, so that is what is recorded.
 *
 *     npm run styles -- --out Temp/styles/before                       guest pages, both themes, desktop + phone
 *     npm run styles -- --out Temp/styles/before --signin              the same pages, signed in as test account A
 *     npm run styles -- --compare Temp/styles/before Temp/styles/after  every difference, page by page
 *
 * `--base <origin>` picks the server (default http://localhost:3210, a local `next start`). `--only <name>`
 * records one page. Animations are frozen (reduced motion) in every recording so a mid-flash frame is not a
 * difference. Each element is keyed by its place in the tree; if a page's tree changed (a new post arrived
 * between the two recordings) the comparison says so instead of reporting a thousand moved elements.
 *
 * Sizes and positions are compared separately from the look: a relative time ("3 MIN AGO" becoming
 * "4 MIN AGO") changes a width without anything having been restyled, so geometry differences are listed
 * under their own heading and only next to an element whose words did not change.
 */
const { gzipSync, gunzipSync } = require('node:zlib');
const { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { close, flags, goto, open, signInPage } = require('./browser.cjs');

const { at, has } = flags();
const showAll = has('--all');

const PAGES = [
  ['home', '/'],
  ['forum', '/forum'],
  ['forum-music', '/forum?music=1'],
  ['forum-arcade', '/forum?arcade=1'],
  ['forum-queues', '/forum?queues=1'],
  ['users', '/users'],
  ['comms', '/comms'],
  ['account', '/account'],
  ['concepts', '/concepts'],
  ['lore', '/lore'],
  ['notes', '/notes'],
  ['links', '/links'],
  ['projects', '/projects'],
  ['project', '/projects/debaser'],
  ['profile', '/profile/640d9861-d8e4-402d-ab5f-db97bb4d88f1'],
];

const SIZES = [
  ['desktop', { size: [1440, 1000], mobile: false }],
  ['phone', { size: [390, 844], mobile: true }],
];

const THEMES = ['dark', 'default'];

/** The look: what a restyle changes. */
const LOOK = [
  'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-bottom-style', 'border-radius', 'border-image-source',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-decoration-line', 'text-align', 'white-space',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'row-gap', 'column-gap', 'display', 'position', 'z-index', 'opacity', 'transform', 'translate',
  'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'box-shadow', 'cursor',
  'min-height', 'min-width', 'max-width', 'max-height', 'accent-color', 'animation-name', 'animation-duration',
  'overflow-x', 'overflow-y', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content',
  'grid-template-columns', 'image-rendering', 'font-synthesis-weight', '-webkit-font-smoothing',
];

/** Where it landed: changes when the words change, too. */
const GEOMETRY = ['x', 'y', 'width', 'height'];

/** Runs in the page: one row per element (and per drawn ::before/::after), keyed by its place in the tree. */
function recordInPage(LOOK) {
  const rows = [];
  const keyOf = (element) => {
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      let index = 0;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
      parts.push(`${node.tagName.toLowerCase()}${index}`);
    }
    return parts.reverse().join('>');
  };
  const ownText = (element) =>
    [...element.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 80);
  const lookOf = (style) => LOOK.map((name) => style.getPropertyValue(name));

  for (const element of [document.documentElement, ...document.documentElement.querySelectorAll('*')]) {
    if (element.closest('script, style, noscript, head, svg defs')) continue;
    const box = element.getBoundingClientRect();
    const key = keyOf(element);
    rows.push({
      key,
      text: ownText(element),
      look: lookOf(getComputedStyle(element)),
      geometry: [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 10) / 10),
    });
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      const content = style.getPropertyValue('content');
      if (content === 'none' || content === 'normal') continue;
      rows.push({ key: key + pseudo, text: content.slice(0, 40), look: lookOf(style), geometry: [] });
    }
  }

  // The tokens themselves, so a moved value is seen even where no element happens to use it.
  const root = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) walk(rule.cssRules);
        if (!rule.style) continue;
        for (const name of rule.style) if (name.startsWith('--')) tokens[name] = root.getPropertyValue(name).trim();
      }
    };
    walk(rules);
  }
  for (const name of document.documentElement.style) if (name.startsWith('--')) tokens[name] = root.getPropertyValue(name).trim();

  return { rows, tokens, theme: document.documentElement.getAttribute('data-theme') };
}

async function record() {
  const out = at('--out');
  if (!out) throw new Error('--out <directory> is required');
  const base = at('--base') ?? 'http://localhost:3210';
  const only = at('--only');
  const signin = has('--signin');
  mkdirSync(out, { recursive: true });

  for (const [sizeName, sizeOptions] of SIZES) {
    const session = await open({ ...sizeOptions, reducedMotion: true });
    const { page } = session;
    let signedIn = false;

    for (const theme of THEMES) {
      await page.addInitScript((id) => {
        try {
          window.localStorage.setItem('debaser.site.theme.v1', id);
        } catch {}
      }, theme);

      for (const [name, route] of PAGES) {
        if (only && only !== name) continue;
        if (signin && !signedIn) {
          await goto(page, `${base}/forum`, { settle: 1500 });
          await signInPage(page);
          signedIn = true;
        }
        // The init script runs on every navigation, and the last one added wins: it sets this theme.
        await goto(page, `${base}${route}`, { settle: 3500 });
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(recordInPage, LOOK);
        if (result.theme !== theme) throw new Error(`${name}: asked for theme ${theme}, the page is in ${result.theme}`);
        const file = path.join(out, `${name}.${sizeName}.${theme}${signin ? '.signedin' : ''}.json.gz`);
        writeFileSync(file, gzipSync(JSON.stringify({ route, size: sizeName, theme, look: LOOK, ...result })));
        console.log(`${file}  ${result.rows.length} elements, ${Object.keys(result.tokens).length} tokens`);
      }
    }
    await close(session);
  }
}

function compare(beforeDir, afterDir) {
  const files = readdirSync(beforeDir).filter((f) => f.endsWith('.json.gz'));
  let lookDiffs = 0;
  let unmatched = 0;

  for (const file of files) {
    const afterFile = path.join(afterDir, file);
    if (!existsSync(afterFile)) {
      console.log(`${file}: MISSING from ${afterDir}`);
      unmatched++;
      continue;
    }
    const before = JSON.parse(gunzipSync(readFileSync(path.join(beforeDir, file))));
    const after = JSON.parse(gunzipSync(readFileSync(afterFile)));
    const afterByKey = new Map(after.rows.map((row) => [row.key, row]));
    const beforeKeys = new Set(before.rows.map((row) => row.key));
    const lines = [];
    let geometry = 0;
    let textChanged = 0;

    const onlyBefore = before.rows.filter((row) => !afterByKey.has(row.key)).length;
    const onlyAfter = after.rows.filter((row) => !beforeKeys.has(row.key)).length;

    for (const row of before.rows) {
      const other = afterByKey.get(row.key);
      if (!other) continue;
      if (row.text !== other.text) {
        textChanged++;
        continue;
      }
      row.look.forEach((value, i) => {
        if (value !== other.look[i]) lines.push(`  ${row.key}  ${before.look[i]}: ${value}  ->  ${other.look[i]}   "${row.text}"`);
      });
      if (row.geometry.some((value, i) => Math.abs(value - other.geometry[i]) > 0.5)) geometry++;
    }

    const tokenLines = [];
    for (const [name, value] of Object.entries(before.tokens)) {
      if (!(name in after.tokens)) continue; // a token may be renamed or added; elements are the proof
      if (after.tokens[name] !== value) tokenLines.push(`  ${name}: ${value} -> ${after.tokens[name]}`);
    }

    lookDiffs += lines.length;
    const status = lines.length === 0 ? 'SAME' : `${lines.length} LOOK DIFFERENCES`;
    console.log(
      `${file}: ${status}  (${before.rows.length} elements; ${onlyBefore} only before, ${onlyAfter} only after, ` +
        `${textChanged} with changed words skipped, ${geometry} moved)`,
    );
    for (const line of lines.slice(0, showAll ? Infinity : 15)) console.log(line);
    if (lines.length > 15 && !showAll) console.log(`  ... ${lines.length - 15} more (--all)`);
    for (const line of tokenLines.slice(0, 10)) console.log(`  token ${line}`);
  }

  console.log(`\n${files.length} recordings compared: ${lookDiffs} look differences, ${unmatched} missing.`);
  process.exitCode = lookDiffs === 0 && unmatched === 0 ? 0 : 1;
}

const compareAt = process.argv.indexOf('--compare');
if (compareAt !== -1) {
  compare(process.argv[compareAt + 1], process.argv[compareAt + 2]);
} else {
  record().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
