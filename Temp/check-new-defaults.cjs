/**
 * The site's new defaults and the reset (Luke, 2026-11-16, list 2, group DEFAULTS): "new defaults: FLUID background, NIGROSINE theme,
 * PINK cursor, modules FORUM / MEDIA / STREAM with the hover colours the account 'good morning' chose ... reset everyone, including people
 * who chose something else". And MODULOS "a word like the others"; every key's hover a coloured word (DOCS was "a big yellow bar").
 *
 * Held here, by running the code (not by reading its text):
 *   1. a browser with nothing stored gets FLUID, NIGROSINE (`dark`) and the PINK cursor, in the store and in each boot script that paints
 *      before the first load (no flash of the old default), also when storage throws;
 *   2. "reset everyone": a browser holding an OLD choice (the `.v1` keys: TILE, the bright theme, the WHITE cursor, the old modules copy)
 *      lands on the new defaults, and a choice made after that is kept under the new key;
 *   3. the starting bar is FORUM, MEDIA, STREAM and MODULOS, with emerald / teal / rose as the hover colours;
 *   4. every key on the bar, whatever its colour, turns a word colour that reads (4.5:1) on the bar of every theme: the fallback included;
 *   5. a new profile starts with PROFILE COMMENTS and MY LISTENING on, and the other switches as before.
 *
 * Compiled fresh on every run:
 *   npx tsc app/lib/ui/theme-slot.ts app/lib/ui/cursor-slot.ts app/lib/ui/backdrop-slot.ts app/lib/ui/modules.ts app/lib/ui/modules-slot.ts app/lib/profile/visibility.ts --rootDir app --outDir Temp/new-defaults-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const OUT = path.join(__dirname, 'new-defaults-out');
const fresh = (file) => {
  for (const key of Object.keys(require.cache)) if (key.startsWith(OUT)) delete require.cache[key];
  return require(path.join(OUT, file));
};

/** A browser's storage, and a document to write onto. */
const stored = new Map();
const install = (throws = false) => {
  global.window = {
    localStorage: {
      getItem: (k) => {
        if (throws) throw new Error('blocked');
        return stored.has(k) ? stored.get(k) : null;
      },
      setItem: (k, v) => stored.set(k, String(v)),
      removeItem: (k) => stored.delete(k),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
};
const root = () => ({ dataset: {}, style: { setProperty: () => {} } });

/** What a head script wrote onto the document, run as the page would run it. */
function boot(script, throws = false) {
  const attrs = {};
  vm.runInNewContext(script, {
    localStorage: {
      getItem: (k) => {
        if (throws) throw new Error('blocked');
        return stored.has(k) ? stored.get(k) : null;
      },
    },
    document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v), style: { setProperty: () => {} } } },
  });
  return attrs;
}

/* ------------------------------------------------------------------ 1. a browser with nothing stored */
install();
{
  const theme = fresh('lib/ui/theme-slot.js');
  const cursor = fresh('lib/ui/cursor-slot.js');
  const backdrop = fresh('lib/ui/backdrop-slot.js');
  assert.equal(theme.FALLBACK_THEME.id, 'dark', 'NIGROSINE is the dark theme, and the fallback');
  assert.equal(theme.THEMES.find((t) => t.id === 'dark').label, 'NIGROSINE');
  assert.equal(backdrop.DEFAULT_BACKDROP, 'fluid', 'the default background is FLUID');
  assert.equal(backdrop.backdropState().id, 'fluid');
  const doc = root();
  backdrop.initBackdrop(doc);
  cursor.initCursor(doc);
  theme.initTheme(doc);
  assert.equal(doc.dataset.backdrop, 'fluid');
  assert.equal(doc.dataset.cursor, 'pink', 'the default cursor is PINK');
  assert.equal(doc.dataset.theme, 'dark');
  assert.equal(boot(backdrop.backdropBootScript())['data-backdrop'], 'fluid', 'boot: the background is written before the first paint');
  assert.equal(boot(cursor.cursorBootScript())['data-cursor'], 'pink', 'boot: the cursor is written before the first paint');
  assert.equal(boot(theme.themeBootScript())['data-theme'], 'dark', 'boot: the theme is written before the first paint');
  assert.equal(boot(cursor.cursorBootScript(), true)['data-cursor'], 'pink', 'boot: storage that throws still gets PINK');
  assert.equal(boot(backdrop.backdropBootScript(), true)['data-backdrop'], 'fluid', 'boot: and FLUID');
  console.log('  ok    nothing stored: FLUID, NIGROSINE, PINK, in the stores and in the head scripts');
}

/* ------------------------------------------------------------------ 2. "reset everyone" */
stored.clear();
stored.set('debaser.site.backdrop.v1', 'tile');
stored.set('debaser.site.theme.v1', 'default');
stored.set('debaser.site.cursor.v1', 'white');
stored.set('debaser-modules', JSON.stringify({ on: { docs: true, web: false }, colours: { forum: 'violet' } }));
{
  const theme = fresh('lib/ui/theme-slot.js');
  const cursor = fresh('lib/ui/cursor-slot.js');
  const backdrop = fresh('lib/ui/backdrop-slot.js');
  const doc = root();
  backdrop.initBackdrop(doc);
  cursor.initCursor(doc);
  theme.initTheme(doc);
  assert.equal(doc.dataset.backdrop, 'fluid', 'a browser that chose TILE is reset to FLUID');
  assert.equal(doc.dataset.cursor, 'pink', 'a browser that chose WHITE is reset to PINK');
  assert.equal(doc.dataset.theme, 'dark', 'a browser that chose the bright theme is reset to NIGROSINE');
  assert.equal(boot(backdrop.backdropBootScript())['data-backdrop'], 'fluid', 'boot: the old background choice is not read');
  assert.equal(boot(cursor.cursorBootScript())['data-cursor'], 'pink', 'boot: the old cursor choice is not read');
  assert.equal(boot(theme.themeBootScript())['data-theme'], 'dark', 'boot: the old theme choice is not read');
  // And they can choose again, once: the choice is kept under the new key.
  backdrop.setBackdrop('tile');
  cursor.setCursor('white');
  theme.setTheme('default');
  assert.equal(stored.get('debaser.site.backdrop.v2'), 'tile');
  assert.equal(stored.get('debaser.site.cursor.v2'), 'white');
  assert.equal(stored.get('debaser.site.theme.v2'), 'default');
  assert.equal(boot(backdrop.backdropBootScript())['data-backdrop'], 'tile', 'a choice made after the reset is kept');
  assert.equal(boot(cursor.cursorBootScript())['data-cursor'], 'white');
  assert.equal(boot(theme.themeBootScript())['data-theme'], 'default');
  console.log('  ok    old choices (TILE, the bright theme, WHITE, ticked DOCS) are reset once, and new choices stick');
}
{
  const modules = fresh('lib/ui/modules-slot.js');
  assert.deepEqual(modules.modulesState(), { on: {}, colours: {} }, 'the old modules copy is not read: no ticks, no colours');
  modules.setModuleChoices({ on: { docs: true }, colours: { forum: 'violet' } });
  assert.ok(stored.has('debaser-modules-v2'), 'a choice made after the reset is kept under the new key');
  assert.deepEqual(fresh('lib/ui/modules-slot.js').modulesState(), { on: { docs: true }, colours: { forum: 'violet' } }, 'and read back');
  console.log('  ok    the old modules copy is reset; a new choice is kept under debaser-modules-v2');
}

/* ------------------------------------------------------------------ 3 and 4. the bar */
{
  const M = fresh('lib/ui/modules.js');
  const { THEMES } = fresh('lib/ui/themes.js');
  const { contrastRatio } = fresh('lib/ui/colour.js');
  const choices = M.NO_CHOICES;
  const startOn = M.MODULES.filter((module) => M.moduleIsOn(module, choices)).map((module) => module.label);
  assert.deepEqual(startOn, ['FORUM', 'MEDIA', 'STREAM', 'MODULOS'], 'a first visit: FORUM, MEDIA, STREAM, and MODULOS at the end');
  assert.equal(M.MODULES[M.MODULES.length - 1].key, 'modules', 'MODULOS is last');
  const colourOf = (label) => M.moduleColour(M.MODULES.find((module) => module.label === label), choices);
  assert.deepEqual([colourOf('FORUM'), colourOf('MEDIA'), colourOf('STREAM')], ['emerald', 'teal', 'rose'], 'green, light blue, reddish pink: the hover colours "Good morning" chose');
  assert.equal(colourOf('DOCS'), undefined, 'DOCS has no colour of its own');
  assert.equal(M.moduleColour(M.MODULES.find((module) => module.label === 'FORUM'), { on: {}, colours: { forum: 'violet' } }), 'violet', 'a pick still wins');
  let checked = 0;
  for (const theme of THEMES) {
    const bar = theme.tokens['sun-pale'];
    for (const module of M.MODULES) {
      const ink = M.moduleHoverInk(module, choices, bar);
      assert.match(ink, /^#[0-9a-f]{6}$/i, `${module.label} on ${theme.id} hovers a colour`);
      assert.ok(contrastRatio(ink, bar) >= 4.5, `${module.label} on ${theme.id}: hover word ${ink} reads on the bar at ${contrastRatio(ink, bar).toFixed(2)}:1`);
      checked += 1;
    }
  }
  console.log(`  ok    the starting bar and its three colours; every key's hover word (${checked} of them, every theme) reads 4.5:1 on the bar`);
}

/* ------------------------------------------------------------------ 5. privacy */
{
  const { DEFAULT_VISIBILITY } = fresh('lib/profile/visibility.js');
  const on = Object.entries(DEFAULT_VISIBILITY).filter(([, value]) => value).map(([key]) => key).sort();
  assert.deepEqual(on, ['roomChatOnDiscuss', 'showListening', 'showOnline', 'showProfileComments'], 'a new profile: comments, listening, the lamp and room chat on DISCUSS; the rest off');
  console.log('  ok    a new profile starts with profile comments and listening on');
}
console.log('PASS check-new-defaults');
