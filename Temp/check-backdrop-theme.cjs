/**
 * `[ THEME ]` on every background (Luke, 2026-11-16: "add a theme option for each backround that calibrates the colours and
 * brightness and all of the other settings to match each site theme in a unique way, this will be on by default and inside of
 * the individual backrounds settings as a switch"). `app/lib/backdrops/theme.ts`, `theme-switch.ts`, the registry, and the
 * window's THEME row.
 *
 * Held here:
 *   1. every background with settings has the switch, on as it comes, in every look; TILE has none (it is the theme already);
 *   2. it is saved lean: on is not written, off is, and reads back off, in this browser and in the account's row;
 *   3. every site theme has its own tune; while THEME is on each background is drawn differently from how it is with THEME off,
 *      and no two themes dress one background the same; off, the background is the reader's own settings, the very object;
 *   4. what the theme does stays in range and leaves the reader's sliders working (a nudge moves with the reader's value);
 *      the ground is always dark and the leading ink reads on it, so the brightness is calibrated, not washed out;
 *   5. the drawn values follow the site theme as it changes, and stop following when THEME is switched off;
 *   6. the window draws `[ THEME ]` above the tabs, pressed, names the theme, and rests the knobs the theme sets (as the server
 *      draws it: THEME on, the settings as they come);
 *   7. PARTY and the looks leave the switch as the reader has it (the window passes it as locked).
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/backdrops/theme.ts app/components/BackdropSettingsWindow.tsx app/lib/backdrops/store.ts app/lib/backdrops/registry.ts --outDir Temp/backdrop-theme-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToString } = require('react-dom/server');

const OUT = path.join(__dirname, 'backdrop-theme-out');
const load = (file) => require(path.join(OUT, file));

process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
process.env.NEXT_PUBLIC_AUTH_BACKEND = 'mock';
const stored = new Map();
global.window = {
  localStorage: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const K = load('lib/backdrops/knobs.js');
const registry = load('lib/backdrops/registry.js');
const store = load('lib/backdrops/store.js');
const T = load('lib/backdrops/theme.js');
const E = load('lib/backdrops/engine.js');
const themes = load('lib/ui/themes.js');
const themeSlot = load('lib/ui/theme-slot.js');
const DEFS = registry.BACKDROP_DEFS;
const IDS = themes.THEMES.map((theme) => theme.id);

/* ------------------------------------------------------------------ 1. the switch */
assert.equal(DEFS.length, 5, 'AQUARIUM, SAND, FLUID, STARFIELD and MYSTIFY have settings');
for (const def of DEFS) {
  const knob = def.knobs.find((each) => each.key === 'theme');
  assert.ok(knob !== undefined && knob.kind === 'switch', `${def.label} has the THEME switch`);
  assert.equal(def.defaults.theme, true, `${def.label}: on as it comes`);
  for (const look of def.looks) assert.equal(look.values.theme, true, `${def.label}: on in the ${look.label} look`);
  assert.equal(K.parseValues(def, {}).theme, true, `${def.label}: nothing stored reads as on`);
  assert.equal(K.parseValues(def, { theme: 'no' }).theme, true, `${def.label}: junk reads as on`);
}
assert.equal(registry.backdropDef('tile'), null, 'TILE has no settings, so no switch: it is drawn in the theme`s own colours already');

/* ------------------------------------------------------------------ 2. saved lean */
store.setBackdropValues('fluid', { ...store.backdropValues('fluid'), theme: false });
assert.equal(JSON.parse(stored.get('debaser.site.backdrop.fluid.v1')).theme, false, 'switched off, this browser keeps it off');
const scenes = Object.fromEntries(DEFS.map((def) => [def.id, { values: def.defaults, extras: { locks: [], sway: {} } }]));
assert.deepEqual(store.rowObject({ scenes, backdrop: 'fluid' }), { v: 1, backdrop: 'fluid' }, 'on (as it comes) is not written into the account`s row');
const offRow = store.rowObject({ scenes: { ...scenes, sand: { values: { ...scenes.sand.values, theme: false }, extras: { locks: [], sway: {} } } }, backdrop: 'sand' });
assert.deepEqual(offRow.scenes, { sand: { theme: false } }, 'off is, and only that');
assert.equal(store.parseSavedBackdrops(JSON.parse(JSON.stringify(offRow))).scenes.sand.values.theme, false, 'and reads back off on another machine');
store.setBackdropValues('fluid', { ...store.backdropValues('fluid'), theme: true });

/* ------------------------------------------------------------------ 3. a tune for every theme, each its own */
assert.deepEqual(Object.keys(T.THEME_TUNES).sort(), [...IDS].sort(), 'every site theme has a tune, and no tune is for a theme that is gone');
const BASE = Object.fromEntries(E.DYES.map((name) => [name, E.pixelFromHex(getDye(name)) ?? 0]));
function getDye(name) {
  const camel = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return themes.DYES[camel];
}
for (const def of DEFS) {
  const own = { ...def.defaults, theme: false };
  assert.equal(T.themedValues(def, own, 'overdrive-ember'), own, `${def.label}: THEME off is the reader's own settings, the very same object`);
  assert.equal(T.themePalette('overdrive-ember', def.id, BASE, false), BASE, `${def.label}: and its own dyes`);
  assert.equal(T.themeGround('overdrive-ember', false), 0, 'and the black behind');
  const looks = new Map();
  for (const theme of IDS) {
    const drawn = T.themedValues(def, def.defaults, theme);
    const palette = T.themePalette(theme, def.id, BASE, true);
    const changedKnobs = def.knobs.filter((knob) => drawn[knob.key] !== def.defaults[knob.key]).map((knob) => knob.key);
    const changedDyes = Object.keys(palette).filter((name) => palette[name] !== BASE[name]);
    const ground = T.themeGround(theme, true);
    const sea = def.id === 'aquarium' ? T.aquariumSeaVariable(theme, true) : '';
    assert.ok(changedKnobs.length + changedDyes.length > 0 || ground !== 0, `${def.label} under ${theme}: THEME changes something`);
    const signature = JSON.stringify([def.knobs.map((knob) => drawn[knob.key]), changedDyes.map((name) => [name, palette[name]]), ground, sea]);
    assert.ok(!looks.has(signature), `${def.label}: ${theme} looks just like ${looks.get(signature)}`);
    looks.set(signature, theme);
    // In range: every knob the theme moved is a value that knob can have (COLOURS is a set it offers).
    assert.ok(K.sameValues(def, K.parseValues(def, drawn), drawn), `${def.label} under ${theme}: everything drawn is a value its knob can have`);
  }
}

/* ------------------------------------------------------------------ 4. the reader's sliders still work; the brightness reads */
const fluid = registry.backdropDef('fluid');
const lively = T.themedValues(fluid, { ...fluid.defaults, swirl: 35 }, 'overdrive-glitch');
const livelier = T.themedValues(fluid, { ...fluid.defaults, swirl: 55 }, 'overdrive-glitch');
assert.ok(lively.swirl > 35, `OVERDRIVE swirls the water more than the reader set (${lively.swirl})`);
assert.equal(livelier.swirl - lively.swirl, 20, 'and the reader moving SWIRL moves it just as far: the nudge rides on their value');
const lazy = T.themedValues(fluid, fluid.defaults, 'marmalade-magma');
assert.ok(lazy.thickness > fluid.defaults.thickness && lazy.swirl < fluid.defaults.swirl, 'MAGMA is thicker and lazier');
const luminance = (pixel) => {
  const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(pixel & 255) + 0.7152 * lin((pixel >>> 8) & 255) + 0.0722 * lin((pixel >>> 16) & 255);
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const theme of IDS) {
  const ground = T.themeGround(theme, true);
  assert.ok(luminance(ground) < 0.03, `${theme}: the ground is dark (${luminance(ground).toFixed(3)}), so the inks always read on it`);
  const palette = T.themePalette(theme, 'fluid', BASE, true);
  assert.ok(contrast(palette['brilliant-pink'], ground) >= 3, `${theme}: the leading ink stands out from the ground (${contrast(palette['brilliant-pink'], ground).toFixed(2)}:1)`);
}

/* ------------------------------------------------------------------ 5. it follows the theme */
themeSlot.setTheme('dark');
const nigrosine = T.drawnValues('starfield');
assert.equal(T.drawnValues('starfield'), nigrosine, 'the same object while nothing changes');
let heard = 0;
const stop = T.subscribeToDrawnValues(() => (heard += 1));
themeSlot.setTheme('overdrive-volt');
assert.ok(heard > 0, 'a new site theme wakes the background');
const volt = T.drawnValues('starfield');
assert.notEqual(volt, nigrosine, 'and it is drawn anew');
assert.ok(volt.speed > nigrosine.speed, `VOLT flies faster than NIGROSINE (${volt.speed} against ${nigrosine.speed})`);
store.setBackdropValues('starfield', { ...store.backdropValues('starfield'), theme: false });
assert.equal(T.drawnValues('starfield'), store.backdropValues('starfield'), 'switched off, the background is drawn from the reader`s own settings');
themeSlot.setTheme('tigerbread-crumb');
assert.equal(T.drawnValues('starfield'), store.backdropValues('starfield'), 'and stays so whatever theme comes next');
store.setBackdropValues('starfield', { ...store.backdropValues('starfield'), theme: true });
stop();

/* ------------------------------------------------------------------ 6. the window */
const { BackdropKnobs } = load('components/BackdropSettingsWindow.js');
themeSlot.setTheme('overdrive-ember');
const ember = renderToString(React.createElement(BackdropKnobs, { id: 'fluid' })).replace(/<!-- -->/g, '');
assert.match(ember, /aria-pressed="true"[^>]*data-backdrop-knob="theme"/, 'FLUID`s window has [ THEME ], pressed');
assert.ok(ember.indexOf('data-backdrop-knob="theme"') < ember.indexOf('data-backdrop-sheet='), 'heading the sheet, not inside a section (one sheet since 2026-11-17)');
// A toggle that says which way it is, `[ THEME: ON ]` (SETTINGSUI item 3, 2026-11-17).
assert.match(ember, /data-backdrop-knob="theme">\[ THEME: ON \]<\/button><span><span[^>]*>OVERDRIVE EMBER</, 'naming the theme it is matched to, beside it');
// The knobs the theme sets say so in their own row (THEME in their keys' column), not in a list at the top (2026-11-17).
assert.match(ember, /aria-label="COLOURS"[\s\S]*?data-backdrop-set-by-theme="">THEME</, 'and the knobs the theme sets say THEME in their row');
assert.match(ember, /disabled=""[^>]*data-backdrop-knob="colours-dyes"/, 'which rest while it is on');
assert.match(ember, /→/, 'a nudged value shows where the theme has it');
const fish = renderToString(React.createElement(BackdropKnobs, { id: 'aquarium' })).replace(/<!-- -->/g, '');
assert.match(fish, /data-backdrop-knob="theme"/, 'the AQUARIUM`s window has it too');
assert.equal((fish.match(/data-backdrop-set-by-theme=""/g) ?? []).length, 4, 'where the theme sets the water: WATER TINT, TINT COLOUR, LIGHT, MURK each say THEME');
// (The server draws a background's settings as they come, THEME on: the window with THEME off is proven in a real browser.)

/* ------------------------------------------------------------------ 7. PARTY and the looks leave it be */
const sand = registry.backdropDef('sand');
for (let seed = 1; seed <= 20; seed += 1) {
  let s = seed;
  const random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  assert.equal(K.partyValues(sand, random, { ...sand.defaults, theme: false }, ['theme']).theme, false, 'a party keeps THEME off when the reader switched it off');
}
const source = require('node:fs').readFileSync('app/components/BackdropSettingsWindow.tsx', 'utf8');
assert.match(source, /partyValues\(def, Math\.random, panel\.values, kept\)/, 'the window`s PARTY passes the switch as kept');

console.log('backdrop theme: every background has [ THEME ], on as it comes; each of the', IDS.length, 'themes dresses each background its own way; off is the reader`s own; it follows the theme.');
