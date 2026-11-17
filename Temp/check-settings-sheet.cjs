/**
 * SETTINGSUI (Luke, 2026-11-17): (1) "make sure the prefereances window that shows the site themes ect is taller by default";
 * (2) "inside of backround settings, this ui needs some work to be more readable and needs to open a slightly larger window,
 * ideally i dont want any scrolling to be necessary to see all the settings". `app/lib/backdrops/sheet.ts`, the settings window
 * (`BackdropSettingsWindow.tsx`), `window-layout.ts`'s `tall`, `PreferencesWindow.tsx`.
 *
 * Held here:
 *   1. every background's settings are one sheet: no tabs; each old tab is a section, then LOOKS; every knob is drawn;
 *   2. the sheet opens in a window whose size fits a 1366 x 768 screen whole, not cut to 78% of it (so nothing scrolls);
 *   3. a choice whose keys don't fit beside its name, and the LOOKS keys, are shared out evenly: no key alone on a line;
 *   4. PREFERENCES opens as tall as the room above the music bar, under a new layout name, and reopens by either name;
 *   5. RESET never flips [ THEME ]: with it on, the theme's tuned look; with it off, the plain defaults (item 3).
 * A real browser holds the "nothing scrolls" itself: scripts/drive-settings-sheet.cjs on a local mock server.
 *
 * Compiled fresh on every run:
 *   npx tsc app/components/BackdropSettingsWindow.tsx app/lib/backdrops/sheet.ts app/lib/backdrops/registry.ts app/lib/ui/window-layout.ts --outDir Temp/settings-sheet-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToString } = require('react-dom/server');

const OUT = path.join(__dirname, 'settings-sheet-out');
const load = (file) => require(path.join(OUT, file));
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
process.env.NEXT_PUBLIC_AUTH_BACKEND = 'mock';

const sheet = load('lib/backdrops/sheet.js');
const { BACKDROP_DEFS } = load('lib/backdrops/registry.js');
const layout = load('lib/ui/window-layout.js');
const { BackdropKnobs } = load('components/BackdropSettingsWindow.js');

/** A 1366 x 768 screen as the site measures it: the top bar's foot at 46px (the guest strip), the player bar below. */
const SMALL = { w: 1366, h: 768 };
const TOP = 46;

/* ------------------------------------------------------------------ 1. one sheet, every knob */
assert.equal(BACKDROP_DEFS.length >= 5, true, 'AQUARIUM, SAND, FLUID, STARFIELD and MYSTIFY at least');
for (const def of BACKDROP_DEFS) {
  const { columns, size } = sheet.sheetLayout(def);
  const sections = columns.flat();
  assert.ok(columns.length === 2 || columns.length === 3, `${def.label}: two or three columns (${columns.length})`);
  assert.deepEqual(
    sections.map((s) => s.id).sort(),
    [...def.tabs.map((tab) => tab.id), sheet.LOOKS_SECTION].sort(),
    `${def.label}: each tab is a section, once, and LOOKS`,
  );
  const html = renderToString(React.createElement(BackdropKnobs, { id: def.id })).replace(/<!-- -->/g, '');
  assert.doesNotMatch(html, /data-backdrop-tab=/, `${def.label}: no tabs`);
  assert.equal((html.match(/data-backdrop-section="/g) ?? []).length, sections.length, `${def.label}: every section drawn`);
  assert.match(html, new RegExp(`data-backdrop-sheet="${columns.length}"`), `${def.label}: in its columns`);
  const inWidget = new Set(def.widgets.flatMap((w) => (w.kind === 'pad' ? [w.x, w.y] : [w.low, w.high])));
  for (const knob of def.knobs) {
    if (inWidget.has(knob.key)) continue;
    const marks = knob.kind === 'choice' ? knob.options.map((o) => `${knob.key}-${o.value}`) : [knob.key];
    for (const mark of marks) assert.ok(html.includes(`data-backdrop-knob="${mark}"`), `${def.label}: ${knob.label} (${mark}) is on the sheet`);
  }
  for (const widget of def.widgets) assert.ok(html.includes(widget.kind === 'pad' ? `data-backdrop-pad="${widget.id}"` : `data-backdrop-band="${widget.id}"`), `${def.label}: ${widget.label} drawn`);
  for (const action of def.actions) assert.ok(html.includes(`data-backdrop-knob="${action.id}"`), `${def.label}: ${action.label} drawn`);
  assert.ok(html.indexOf('data-backdrop-knob="theme"') < html.indexOf('data-backdrop-sheet='), `${def.label}: [ THEME ] heads the sheet`);

  /* ---------------------------------------------------------------- 2. it fits a 1366 x 768 screen whole */
  const spec = { min: { w: 300, h: 240 }, size, dock: 'top', tall: true };
  const rect = layout.defaultRect(spec, SMALL, TOP);
  assert.equal(rect.h, size.h, `${def.label}: opens at its whole height on 1366 x 768 (${rect.h} of ${size.h}), not cut short`);
  assert.equal(rect.w, size.w, `${def.label}: and its whole width (${size.w})`);
  assert.ok(rect.y + rect.h <= SMALL.h - 112, `${def.label}: its foot clear of the music bar (${rect.y + rect.h})`);
  assert.ok(rect.x >= 0, `${def.label}: on the screen`);
  // Without `tall` a window is cut to 78% of the room: the sheet would scroll on 1366 x 768 for the biggest ones.
  const cut = layout.defaultRect({ ...spec, tall: false }, SMALL, TOP);
  if (def.id === 'aquarium') assert.ok(cut.h < size.h, `the AQUARIUM's sheet needs more than 78% of a 768 screen (${size.h} > ${cut.h}): \`tall\` is what lets it open whole`);
}
const sizes = Object.fromEntries(BACKDROP_DEFS.map((def) => [def.id, sheet.sheetLayout(def).size]));
assert.ok(sizes.aquarium.w > 400 && sizes.fluid.w > 400, 'larger than the old 400-wide window');

/* ------------------------------------------------------------------ 3. even lines */
const def = (id) => BACKDROP_DEFS.find((d) => d.id === id);
const knob = (id, key) => def(id).knobs.find((k) => k.key === key);
const lens = (rows) => rows.map((row) => row.length);
assert.deepEqual(sheet.choiceLayout(knob('fluid', 'pointer')), { beside: true, rows: [[0, 1]] }, 'POINTER STIR / IGNORE sits beside its name');
assert.deepEqual(lens(sheet.choiceLayout(knob('fluid', 'mirror')).rows), [4], 'KALEIDOSCOPE OFF 2 4 8 on one line under its name, no 8 left alone');
assert.deepEqual(lens(sheet.choiceLayout(knob('sand', 'grain')).rows), [4, 3], "GRAIN's seven as four and three");
assert.deepEqual(lens(sheet.choiceLayout(knob('fluid', 'colours')).rows), [3, 2], "FLUID's five COLOURS as three and two");
for (const d of BACKDROP_DEFS) {
  const rows = sheet.evenRows(sheet.looksKeys(d), sheet.COLUMN_W);
  if (rows.length > 1) assert.ok(rows[rows.length - 1].length > 1 || rows.length === sheet.looksKeys(d).length, `${d.label}: no look alone on the last line (${lens(rows)})`);
}

/* ------------------------------------------------------------------ 5. RESET apart from THEME (item 3) */
// Luke: "the "theme" button ... should be a toggle separate to the "reset" button, the reset button resets according to wether
// theme is on or off, resetting to a separate default ie the one we used before incoroporating the "theme" button".
const { resetValues } = load('lib/backdrops/theme-switch.js');
const T = load('lib/backdrops/theme.js');
for (const d of BACKDROP_DEFS) {
  const range = d.knobs.find((k) => k.kind === 'range' && !d.widgets.some((w) => [w.x, w.y, w.low, w.high].includes(k.key)));
  const moved = (theme) => ({ ...d.defaults, theme, [range.key]: range.max === d.defaults[range.key] ? range.min : range.max });
  const plain = { ...d.defaults, theme: false };
  // THEME off: RESET gives the background's own plain defaults, and THEME stays off.
  const off = resetValues(d, moved(false), []);
  assert.equal(off.theme, false, `${d.label}: RESET with THEME off leaves it off`);
  assert.deepEqual(off, plain, `${d.label}: and puts every knob back to its plain default`);
  // THEME on: RESET gives the theme's tuned look (the theme drawn over the defaults), and THEME stays on.
  const on = resetValues(d, moved(true), []);
  assert.equal(on.theme, true, `${d.label}: RESET with THEME on leaves it on`);
  assert.deepEqual(on, { ...d.defaults, theme: true }, `${d.label}: and the knobs go back to the defaults the theme tunes`);
  for (const id of ['dark', 'overdrive-ember', 'sherbet-pink']) {
    assert.deepEqual(T.themedValues(d, on, id), T.themedValues(d, d.defaults, id), `${d.label}: so in ${id} it is drawn as the theme's own look`);
  }
  // A locked knob keeps its place through RESET, as before.
  assert.equal(resetValues(d, moved(false), [range.key])[range.key], moved(false)[range.key], `${d.label}: a locked knob stays put`);
}
const fluid = resetValues(def('fluid'), { ...def('fluid').defaults, theme: false, cell: 20, steps: 7, dither: 80, mirror: '8' }, []);
assert.deepEqual([fluid.cell, fluid.steps, fluid.dither, fluid.mirror], [10, 3, 15, 'off'], "FLUID's plain defaults: GRID 10px, COLOUR STEPS 3, DITHER 15%, KALEIDOSCOPE OFF");
const windowSource = fs.readFileSync('app/components/BackdropSettingsWindow.tsx', 'utf8');
assert.match(windowSource, /onClick=\{\(\) => setBackdropValues\(id, resetValues\(def, panel\.values, panel\.locks\)\)\}/, 'the window`s RESET is that rule');
const fishOn = renderToString(React.createElement(BackdropKnobs, { id: 'aquarium' })).replace(/<!-- -->/g, '');
assert.match(fishOn, /aria-pressed="true"[^>]*data-backdrop-knob="theme">\[ THEME: ON \]</, '[ THEME ] says which way it is');

/* ------------------------------------------------------------------ 4. PREFERENCES */
const prefs = fs.readFileSync('app/components/PreferencesWindow.tsx', 'utf8');
assert.match(prefs, /layoutId=\{PREFERENCES_LAYOUT\}/, 'PREFERENCES has a new layout name, so a box saved at the old height does not keep it short');
assert.match(prefs, /\btall\b/, 'and opens tall');
const height = Number(prefs.match(/defaultSize=\{\{ w: \d+, h: (\d+) \}\}/)[1]);
const tallPrefs = { min: { w: 280, h: 200 }, size: { w: 384, h: height }, dock: 'bottom', tall: true };
const old = { min: { w: 280, h: 200 }, size: { w: 384, h: 620 }, dock: 'bottom' };
const big = { w: 1920, h: 1080 };
assert.ok(layout.defaultRect(tallPrefs, big, TOP).h >= 900, `taller on 1920 x 1080 (${layout.defaultRect(tallPrefs, big, TOP).h}, was ${layout.defaultRect(old, big, TOP).h})`);
assert.ok(layout.defaultRect(tallPrefs, SMALL, TOP).h > layout.defaultRect(old, SMALL, TOP).h, 'and on 1366 x 768');
const tallRect = layout.defaultRect(tallPrefs, big, TOP);
assert.ok(tallRect.y >= TOP && tallRect.y + tallRect.h <= big.h - 112, 'within the screen, above the music bar');
const host = fs.readFileSync('app/components/WindowLayoutHost.tsx', 'utf8');
assert.match(host, /preferences: \(\) => openPreferences\(\)/, 'a layout saved under the old name still reopens it');
assert.match(host, /\[PREFERENCES_LAYOUT\]: \(\) => openPreferences\(\)/, 'and one saved under the new name');
assert.match(prefs, /clearMainKeys\(PREFERENCES_LAYOUT\)/, "it still keeps off a page's main keys (FORUMBITS, Luke's 4B), by its layout name");

console.log(
  `settings sheet: ${BACKDROP_DEFS.map((d) => `${d.label} ${sizes[d.id].w}x${sizes[d.id].h} in ${sheet.sheetLayout(d).columns.length}`).join(', ')}; all fit 1366 x 768 whole; PREFERENCES opens tall.`,
);
