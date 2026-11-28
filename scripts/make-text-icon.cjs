/*
 * The DEBASER extension's icon, as words (Luke, 2026-11-27, his own exception to the asset rule: "generate a text icon for debaser"; .claude/rules/art.md).
 * The word set in the site's own strong face (IBM Plex Mono 600, app/theme/faces/) in the house theme's inks (black on Daffodil, the site's main
 * key), rendered to PNG by a headless browser: letters on a plain field, no drawn shapes, no picture. At 16 to 48 px the word can't be read, so
 * those carry its first letter.
 *   node scripts/make-text-icon.cjs
 *   node scripts/make-text-icon.cjs public/     only the files whose path starts so
 * Writes extension/icon-16.png, -32, -48, -128 (the manifest's), docs/extension-store/edge-logo-300.png and tile-440x280.png. Run it again
 * when the face or the inks change, and make a new extension version.
 * Also public/app-icon-*.png, the installed site's icon (app/manifest.ts; Luke, 2026-11-28: "Yes, yellow text icon"). The maskable one is
 * the same word set narrower, so a phone that cuts the icon to a circle keeps all of it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const ROOT = path.join(__dirname, '..');
const themes = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'ui', 'themes.ts'), 'utf8');
const dye = (name) => new RegExp(`^\\s+${name}: '(#[0-9a-f]{6})'`, 'm').exec(themes)[1];
const INK = dye('black');
const FIELD = dye('daffodil');
const face = fs.readFileSync(path.join(ROOT, 'app', 'theme', 'faces', 'ibm-plex-mono-600-latin.woff2')).toString('base64');

// [file, width, height, words (one line each), size of the letters as a share of the height, 'clear' for no field, width of a word as a share]
const MADE = [
  ['public/app-icon-192.png', 192, 192, ['DEBASER'], 0.5],
  ['public/app-icon-512.png', 512, 512, ['DEBASER'], 0.5],
  ['public/app-icon-maskable-512.png', 512, 512, ['DEBASER'], 0.5, '', 0.72],
  ['extension/icon-16.png', 16, 16, ['D'], 0.95],
  ['extension/icon-32.png', 32, 32, ['D'], 0.9],
  ['extension/icon-48.png', 48, 48, ['D'], 0.9],
  ['extension/icon-128.png', 128, 128, ['DEBASER'], 0.5],
  ['docs/extension-store/edge-logo-300.png', 300, 300, ['DEBASER'], 0.5],
  ['docs/extension-store/tile-440x280.png', 440, 280, ['DEBASER', 'SEEING MACHINE'], 0.3],
  // For Luke to choose by looking (the coordinator, 2026-11-27): the same 128 with no field behind the letters.
  ['docs/extension-store/icon-128-transparent.png', 128, 128, ['DEBASER'], 0.5, 'clear'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const only = process.argv[2] ?? '';
  for (const [file, width, height, lines, share, clear, fills = 0.86] of MADE.filter(([name]) => name.startsWith(only))) {
    const big = Math.round(height * share);
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><style>
      @font-face { font-family: strong; src: url(data:font/woff2;base64,${face}) format('woff2'); font-weight: 600; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; background: ${clear ? 'transparent' : FIELD}; overflow: hidden; }
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${Math.round(big * 0.25)}px;
        color: ${INK}; font: 600 ${big}px/1 strong; letter-spacing: 0; }
      .then { font-size: ${Math.round(big * 0.42)}px; }
    </style>${lines.map((line, i) => `<div class="${i === 0 ? 'first' : 'then'}">${line}</div>`).join('')}`);
    await page.evaluate(() => document.fonts.ready);
    // The first line as wide as the field allows, with room round it.
    await page.evaluate(([room]) => {
      const first = document.querySelector('.first');
      const wide = first.getBoundingClientRect().width;
      if (wide > room) first.style.fontSize = `${(parseFloat(getComputedStyle(first).fontSize) * room) / wide}px`;
    }, [width * (lines[0].length > 1 ? fills : 1)]);
    await page.screenshot({ path: path.join(ROOT, file), clip: { x: 0, y: 0, width, height }, omitBackground: Boolean(clear) });
    console.log(`${file} ${width}x${height}`);
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
