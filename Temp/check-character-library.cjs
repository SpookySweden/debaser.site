const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const {
  isMassDye,
  MASS_DYES,
  MODEL_INK,
  MODEL_LIMB,
} = require('./character-out/palette.js');
const { MASS_SHAPE_IDS, MASS_SHAPES } = require('./character-out/shapes.js');
const { buildDefaultFigure } = require('./character-out/rig.js');
const { readFigure } = require('./character-out/figure.js');

/**
 * Feet, dyes and the saved-character shelf.
 *
 * **Three things the owner asked for, each with a failure mode that is invisible in a screenshot.**
 *
 *   1. A pair of limbs that match (it was a foot that is a triangle seen head-on, until the presets went simple).
 *   2. A recolour that is per shape, reverts, and only offers colours a shape can be seen in.
 *   3. A shelf that survives a corrupt `localStorage` and never hands back half a figure.
 *
 * The library module cannot be required here - it touches `window` and reads storage - so its *rules* are asserted
 * from its source and its shaping is exercised through the same constants the module uses.
 *
 * **Updated for the free-shape workbench.** Shapes are no longer a table keyed by joint; the starting figure is a list
 * of free shapes pinned to joints (`buildDefaultFigure`), and the shelf stores whole figures under a v2 key. The
 * feet, dye and shelf rules are unchanged; they are asserted against where those things now live. The prism's
 * *geometry* (three-sided, apex up, running forward) moved to `check-character-shapes`, which now builds and
 * measures it rather than reading the scene.
 *
 * Steps: the runner matches the `npx tsc ` prefix literally, inside this block.
 *   npx tsc app/lib/character/shapes.ts app/lib/character/palette.ts app/lib/character/skeleton.ts app/lib/character/rig.ts app/lib/character/figure.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CharacterBrowserWindow.tsx --outDir Temp/character-browser --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 */
const library = readFileSync('app/lib/character/library.ts', 'utf8');
const rig = readFileSync('app/lib/character/rig.ts', 'utf8');

/*
 * 1. The starting figure's legs are a matched pair, so it does not stand crooked.
 *
 * **Updated for simple figures (SPEC-simple-figures.md).** This used to hold BLOB's prism feet; the goofy presets went,
 * and no preset has feet now. What the feet rule was for - a pair of limbs that match, mirrored - is held on BASE's
 * legs instead.
 */
const base = buildDefaultFigure('base');
const legL = base.shapes.find((shape) => shape.name === 'LEG L');
const legR = base.shapes.find((shape) => shape.name === 'LEG R');
assert.ok(legL && legR, 'BASE has two legs');
assert.deepEqual(legL.size, legR.size, 'the legs are the same size');
assert.equal(legL.position.x, -legR.position.x, 'and mirror each other across the middle');
assert.equal(legL.position.y, legR.position.y, 'at the same height');
assert.ok(legL.position.x < 0, 'LEG L is on the left of the FRONT view');

/* 2. Every shape has a glyph, so the palette cannot grow a shape it cannot draw. */
const icons = readFileSync('app/lib/ui/icons.ts', 'utf8');

for (const shape of MASS_SHAPE_IDS) {
  assert.ok(MASS_SHAPES[shape].label.length > 0, `${shape} has a label`);
  assert.ok(MASS_SHAPES[shape].note.length > 0, `${shape} has a note, so the grid needs no instruction`);
  assert.match(icons, new RegExp(`\\b${shape}: '`), `${shape} has a glyph in the palette`);
}

/**
 * 3. The dyes: every one is one of the site's own, none is invisible, and `null` is reachable.
 *
 * **A recolour control that offers a colour the shape vanishes into is a control that gets pressed by accident.**
 * Black and Nigrosine are the field and the void, so they are absent by design - and the assertion is written as
 * "nothing in the list is either of those" rather than as a count, so the rule survives a dye being added.
 */
const INVISIBLE = ['#000000', '#1a1525'];

assert.ok(MASS_DYES.length >= 6, `there is a dye worth picking (${MASS_DYES.length} offered)`);
assert.equal(MASS_DYES[0].value, null, 'and the first choice is "no tint", so a shape can be put back');
assert.equal(new Set(MASS_DYES.map((dye) => dye.id)).size, MASS_DYES.length, 'no two dyes share a name');

for (const dye of MASS_DYES) {
  if (dye.value === null) continue;

  assert.match(dye.value, /^#[0-9A-Fa-f]{6}$/, `${dye.id} is a hex`);
  assert.ok(
    !INVISIBLE.includes(dye.value.toLowerCase()),
    `${dye.id} (${dye.value}) is not the field or the void - a shape painted it would disappear`,
  );
}

/* And the guard the loader uses accepts exactly those, so a saved colour cannot smuggle in another. */
assert.equal(isMassDye(null), true, 'no tint is allowed');
assert.equal(isMassDye('#28C745'), true, 'a real dye is allowed');
assert.equal(isMassDye('#123456'), false, 'a colour that is not one of the nine is refused');
assert.equal(isMassDye('#000000'), false, 'and so is the void');

/* 4. A figure saved and read back must be whole, so every seeded shape survives the vocabulary and the dyes. */
for (const shape of base.shapes) {
  assert.ok(MASS_SHAPE_IDS.includes(shape.kind), `${shape.name} is a shape the vocabulary has`);
  assert.ok(isMassDye(shape.colour), `${shape.name} wears a dye the loader accepts, so it survives a reload`);
}
assert.ok(base.shapes.some((shape) => shape.colour === null), 'the trunk wears the figure colour');
assert.ok(base.shapes.some((shape) => shape.colour === MODEL_LIMB), 'and the legs the second tone, so the figure keeps two');
assert.equal(
  JSON.stringify(readFigure(JSON.parse(JSON.stringify(base)))),
  JSON.stringify(base),
  'and a saved starting figure reads back exactly',
);

/* 5. The library's own rules, from its source - the module reads `window`, so it cannot be required here. */
assert.match(library, /const STORAGE_KEY = 'debaser\.character\.library\.v3'/, 'the shelf has one storage key - v3, so v1 and v2 are never misread');
assert.match(library, /const figure = readFigure\(record\.figure\)/, 'a figure read back is validated (readFigure, driven in check-character-figure)');
assert.match(library, /figure === null \|\|/, 'and one that fails is dropped');
assert.match(library, /JSON\.parse\(JSON\.stringify\(input\.figure\)\)/, 'a save is a deep copy, not a live reference');
assert.match(library, /const next = \[saved, \.\.\.existing\]/, 'the newest save leads the shelf');
assert.match(library, /function removeCharacter/, 'and a figure can be forgotten');

/**
 * 6. **The browser window is rendered by this check**, which `check-structure` requires of any component a scratch
 *      check can reach - and it is rendered for real rather than merely required, because the window's own
 *      open/closed gate is a behaviour a source grep cannot see.
 *
 * **What this proves and what it cannot.** `PopoutWindow` renders through a portal into `<body>`, and it returns
 * `null` until that host exists - which needs a browser. So everything the shelf *contains* is unreachable here,
 * and `Temp/probe-shelf.cjs` is what reads it with Chrome. What is reachable is the gate: shut draws nothing,
 * opening arms it, and closing disarms a half-pressed delete. Those three are the module-level slot's whole
 * contract, and they are asserted below against the slot itself rather than against markup.
 *
 * That is the honest split, and it is worth writing down rather than dressing up: a check that asserted
 * `markup.match(/SAVED CHARACTERS/)` would fail for a reason that has nothing to do with the shelf.
 */
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const CharacterBrowserWindow = require('./character-browser/components/CharacterBrowserWindow.js').default;
const {
  openCharacterBrowser,
  closeCharacterBrowser,
  confirmCharacterRemoval,
  characterBrowserState,
} = require('./character-browser/lib/character/browser-window.js');

/* Shut: the component draws nothing at all, whatever the shelf holds. */
closeCharacterBrowser();
assert.equal(
  renderToStaticMarkup(createElement(CharacterBrowserWindow)),
  '',
  'shut, the window draws nothing - not an empty shelf',
);

/* Opening arms it, and closing puts it back to one shared object so React can compare by identity. */
openCharacterBrowser();
assert.equal(characterBrowserState().open, true, 'opening arms the window');
assert.equal(characterBrowserState().confirmingId, null, 'and nothing is half-deleted');

/* Arming a delete, then closing, must not leave it armed for the next open. */
confirmCharacterRemoval('some-figure-id');
assert.equal(characterBrowserState().confirmingId, 'some-figure-id', 'a delete can be armed');

closeCharacterBrowser();
assert.equal(characterBrowserState().confirmingId, null, 'and closing disarms it, so the next open is clean');
assert.equal(characterBrowserState().open, false, 'and the window is shut');

/* Reopening while shut must not resurrect the armed delete either. */
openCharacterBrowser();
assert.equal(characterBrowserState().confirmingId, null, 'reopening starts clean');
closeCharacterBrowser();

console.log('character library checks passed');
console.log(`  legs    : a matched pair, ${legL.size.x} wide and ${legL.size.y} long`);
console.log(`  dyes    : ${MASS_DYES.length} choices, none of them the field or the void`);
console.log(`  shapes  : ${MASS_SHAPE_IDS.length} declared, all with a label, a note and a glyph`);
console.log('  shelf   : validated on read, deep-copied on write, read lazily by the window');
console.log('  cannot  : prove a foot LOOKS like a foot. That is Temp/probe-feet.cjs, with a browser.');

