const assert = require('node:assert/strict');
const fs = require('node:fs');

const sceneCode = fs
  .readFileSync('app/components/CharacterScene.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * The render's switches must be **visibly different**, and the instrument that measures them must press the right
 * button.
 *
 * **Rewritten again when the two looks (SHAPES / FINAL) became the live pixel render with LAYERS switches**
 * (SPEC-pixel-render.md). The rule held here was never about any one set of names; it is *a switch that changes
 * nothing is worse than no switch*, and the way that breaks is quietly - two states rendering the same while every
 * label stays right. With the live render there is no look to choose: the building aids are always drawn, crisp, over
 * the pixel figure, and what changes is the light pass. So this asserts:
 *
 *   the aids     the grid behind, and the picked-shape wire, the transform box and the skeleton in front, always
 *                mounted (in their own groups, which the render draws in their own passes)
 *   the figure   one flat, unlit material per dye - the light is the shader's, so there is no lit material left
 *   the switches each one reaches the light pass as a different mode, decided in one place (`shadeMode`)
 *
 * Measured afterwards by `npm run stages` (four layer states, colours per pane) and by `Temp/char-drive.cjs`.
 */
const groupOf = (name) => sceneCode.match(new RegExp(String.raw`<group ref=\{${name}\}>([\s\S]*?)</group>`))?.[1] ?? '';
const tagsIn = (block) => [...block.matchAll(/<(\w+)/g)].map((m) => m[1]).sort();
// Simple figures added two: the invisible sheet that takes every press while placing, and the rose marks of what
// blocks saving. Neither is a look; both are always mounted and decide for themselves when to draw.
assert.deepEqual(tagsIn(groupOf('under')), ['Backdrop', 'Grid', 'PlacingSheet'], 'behind the figure: the grid (and the invisible backdrop that takes clicks on empty space, and the sheet that takes them while placing)');
assert.deepEqual(tagsIn(groupOf('figure')), ['Shapes'], 'the figure group holds the shapes and nothing else');
assert.deepEqual(tagsIn(groupOf('over')), ['Bones', 'BrokenMarks', 'PickedWire', 'PlacingRing', 'SelectionBox'], 'in front: the picked-shape wire, the transform box, the skeleton, the broken marks and (2026-11-04) the placing ring (place.ts)');
assert.doesNotMatch(sceneCode, /\? <(Grid|SelectionBox|Bones|PickedWire)/, 'none of the aids is switched by a look any more');
assert.equal((sceneCode.match(/flatMaterial\(/g) ?? []).length, 1, 'one flat material for every shape');
assert.doesNotMatch(sceneCode, /meshLambertMaterial/, 'and no lit material: the cel shader does the lighting');

const renderLib = fs.readFileSync('app/lib/character/pixel-render.ts', 'utf8');
assert.match(renderLib, /if \(layers\.normalMap\) return 'normals';\s*return layers\.normalLight \? 'lit' : 'flat';/, 'NORMAL MAP, then NORMAL LIGHT, decide the mode in one place');
const passCode = fs.readFileSync('app/components/CharacterPixelRender.tsx', 'utf8');
assert.match(passCode, /uniforms\.mode\.value = MODE_NUMBER\[shadeMode\(layers\)\]/, 'and that one answer is what the shader is handed');
// Updated 2026-10-19: 50 PX also sizes the passes (its effect is run for real in check-character-frame.cjs).
assert.match(passCode, /grid = pixelGrid\(buffer\.x, buffer\.y, camera\.zoom, ratio, layers\.pixelate, layers\.fine\)/, 'PIXELATE and 50 PX change the size of the passes');
assert.match(passCode, /uniforms\.lightOn\.value = lightOn \? 1 : 0/, 'and the LIGHT switch reaches the shader');

/**
 * **A pane may not contain a grey, and the reason is the ink rather than the light.** A light - the old lambert one,
 * and now the cel shader's bands - scales a colour's channels together, so a dye can never come out r=g=b; `MODEL_INK` was `#FFFFFF`, which rounded to
 * rgb(226,226,226) every time and made the figure a grey silhouette. The rule is therefore about the two tones the
 * figure ships with - the reading is per pane, and anti-aliased text elsewhere on the page is grey by nature, so a
 * whole-image count would say nothing.
 *
 * A reader may still *paint* a shape PURE WHITE from the dye row, and in the cel shader's mid and shadow bands that
 * particular choice does grey (white times 0.78 is a grey; any dye times 0.78 is a darker shade of that dye). This check is about the figure's own two tones, which is what every pane shows before anybody
 * has chosen anything.
 */
const paletteCode = fs
  .readFileSync('app/lib/character/palette.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

for (const token of ['MODEL_INK', 'MODEL_LIMB']) {
  const hex = new RegExp(`${token}\\s*=\\s*'(#[0-9a-fA-F]{6})'`).exec(paletteCode)?.[1];
  assert.ok(hex, `${token} is a hex literal`);

  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  assert.ok(
    red !== green || green !== blue,
    `${token} is ${hex}, a grey - the palette has none, and shaded it stays one`,
  );
  assert.notEqual(
    hex.toUpperCase(),
    '#FFFFFF',
    `${token} is Pure White: the lambert light rounds it to a grey and the figure has no colour of its own`,
  );
}

/**
 * The numbers above come out of a run of `scripts/measure-stages.cjs`, and both ways that instrument has been
 * wrong are visible in its own source - so they are checkable here, where the reading is unambiguous. A stage
 * image is evidence only if the press reached the stage, and the press is the thing that fails quietly.
 *
 * **These three assertions were rewritten when the instruments moved onto `scripts/browser.cjs`, and this is
 * why.** They used to match the old press's own code: a `fieldset` query for `WHAT IS DRAWN`, a
 * `startsWith('${stage}')`, and an `element.click()`. The rule has not changed - a stage press must reach the
 * stage *button* - but it is now enforced in two places rather than one, and the press is a real one:
 *
 *   - `measure-stages.cjs` presses with `scope: within`, so the search is confined to the group;
 *   - `browser.cjs` resolves `within` to the **innermost** container holding the phrase, because the first
 *     match in document order is the outer `<main>` - and scoping to that is scoping to nothing. That exact
 *     fault was reproduced on 2026-09-29: a run reported `pressed MASS GEOMETRY at 907,398` while its
 *     transcript said the stage was `MASS`, and the stage read BASE's colours three times;
 *   - and it matches by **prefix** before substring, because the stage buttons render as
 *     `MASSTHE SHAPE AS EDGES - A WIREFRAME...` - so `MASS` is not an equality on them, and a substring pass
 *     reaches the palette's help text first.
 *
 * Verified after the change: `npm run stages -- --attach` printed `pressed MASSTHE SHAPE AS EDGES - TO BUILD
 * AGAINST ... (matched by text-prefix)` and then 2 colours for MASS, 3 for BASE and 217/136 for PIXEL.
 */
const stagesCode = fs.readFileSync('scripts/measure-stages.cjs', 'utf8');
const browserCode = fs.readFileSync('scripts/browser.cjs', 'utf8');

// The press must be scoped to the layer switches. Witnessed with the old stages: a run of `npm run shot -- --click MASS`
// pressed the palette's help text and wrote a picture of a stage nobody had chosen.
assert.match(stagesCode, /scope: within/, 'the layer press is scoped, so a switch name cannot mean some other button');
const states = [...(stagesCode.match(/const STATES = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(states, ['LIT', 'PIXELATE OFF', 'NORMAL LIGHT OFF', 'NORMAL MAP'], 'the instrument measures the layer states that exist');
assert.match(
  stagesCode,
  /const within = at\('--within', 'NORMAL MAP'\)/,
  'and scopes to the innermost box holding NORMAL MAP - the LAYERS group itself',
);
assert.match(stagesCode, /for \(const plate of state\.press\) await pressPlate\(browser\.page, plate, \{ scope: within \}\);/, 'and presses each state back to the defaults before the next');

// The scope is the innermost container, and a control is matched by prefix before substring: together these are
// what the old `startsWith('${stage}')` did, moved to where the search actually happens.
assert.match(
  browserCode,
  /const innermost = matches\.filter/,
  'the scope is the innermost container holding the phrase - the outer <main> holds everything and scopes nothing',
);
assert.match(
  browserCode,
  /whole\(element\)\.startsWith\(wanted\)/,
  'and a prefix match comes before a substring one, so MASS finds the stage button rather than the help text',
);

// The read-back must count layer labels only, inside the layer group.
assert.match(stagesCode, /\[role=group\]\[aria-label=Layers\]/, 'the pressed-state read-back looks inside the layer group');
assert.match(stagesCode, /\(PIXELATE\|NORMAL LIGHT\|NORMAL MAP\)/, 'and counts the three layer labels only');

// Greys are counted per pane, because the page's own text is grey where it is anti-aliased and a pane's colours
// are the figure's.
assert.match(stagesCode, /greys in the pane/, 'every pane reports its own greys, so a grey in the figure is visible');

console.log('character layer-distinctness checks passed');
console.log('  aids     grid behind, wire + transform box + skeleton in front, always drawn');
console.log('  figure   one flat material; the light is the shader');
console.log('  switches one shade mode, PIXELATE sizes the passes, LIGHT reaches the shader');
console.log('  greys   MODEL_INK / MODEL_LIMB are dyes rather than greys');
console.log('  cannot : re-measure the panes from here. That is `npm run stages`, with a browser.');
