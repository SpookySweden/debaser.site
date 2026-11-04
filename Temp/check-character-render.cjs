/**
 * Does the character panel **render at all**? Answered by really rendering it.
 *
 * The bug this exists to catch: opening the CHAR tab threw. The cause was a zustand selector returning a new
 * array on every call (`Object.keys(...)`), which `Object.is` never considers equal - so the component
 * re-rendered, produced another new array, and looped until React threw *"Maximum update depth exceeded"*.
 *
 * **Every check in this project was green while that was broken**, and that is the lesson worth keeping: they
 * all read source, and no amount of source-reading finds a render loop. This renders the real component tree
 * with `react-dom/server` and a real store, so a crash on mount, a hook misuse or a bad import is a *failure
 * here* rather than a report from the owner.
 *
 * It is not a browser and there is no DOM, so what it proves is bounded: the component renders, produces
 * markup, and the markup contains what the tab promises. It cannot prove a drag works, cannot see pixels, and
 * cannot exercise an event handler - `react-dom/server` never calls one. **It also does not reproduce the
 * original loop**: server rendering calls each component once, and a loop needs a second render to show itself.
 * The loop is held instead by the selector-shape assertion at the end of this file.
 *
 * **Rewritten for the canvas-window workbench.** It renders the new tool strip, views, shapes list and panels - with
 * nothing picked, and again with a shape picked - and counts what a reader is offered. The selector rule at the end
 * is unchanged, and now covers the scene as well as the panels.
 *
 * **Updated for the live pixel render (SPEC-pixel-render.md).** The SHAPES / FINAL switch became three LAYERS
 * switches and a ☀ light with a d-pad; the light sliders left the figure panel; a picked shape's properties fold into
 * SHAPE / COLOUR / PIN / NUMBERS with NUMBERS folded - so its nine number boxes are counted after unfolding it.
 *
 * **Updated for simple figures (SPEC-simple-figures.md).** The shapes list starts folded to its header (`SHAPES 5/7`), so
 * its rows are counted after opening it; the skeleton switch moved into LAYERS; ADD now places by picking a node, so the
 * bar shows what is being placed with a ✗, and the side panels are inert meanwhile; BASE's head is a sphere.
 *
 * Steps (inside this block, and spelled `npx tsc ` because the runner matches that literally):
 *   npx tsc app/components/CharacterViewport.tsx --outDir Temp/character-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *
 * **The require path is the nested one.** `tsc` preserves the structure below the deepest common directory of
 * its inputs, and this input pulls in `lib/` siblings, so the output lands at
 * `Temp/character-render/components/CharacterViewport.js` rather than at the root.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

process.removeAllListeners('warning'); // three's "require is deprecated" notice is about this harness

/**
 * **Server rendering reads zustand's *initial* state, never the current one** (its hook hands React
 * `getInitialState` as the server snapshot, from a private copy). So the "a shape picked" render below would draw
 * the opening state again and the properties panel could never be seen. Before the store is loaded, zustand's
 * `create` is swapped for the same hook with the *current* state as the server snapshot - this harness only; the
 * site's code is untouched.
 */
{
  const React = require('react');
  const { createStore } = require('zustand/vanilla');
  require('zustand/react').create = (init) => {
    const api = createStore(init);
    const hook = (selector = (state) => state) =>
      React.useSyncExternalStore(api.subscribe, () => selector(api.getState()), () => selector(api.getState()));
    return Object.assign(hook, api);
  };
}

const { default: CharacterViewport } = require('./character-render/components/CharacterViewport.js');
const { useCharacterStore } = require('./character-render/lib/character/store.js');

const render = () => renderToStaticMarkup(createElement(CharacterViewport));
const buttonsOf = (html) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    tag: match[1],
    pressed: match[1].includes('aria-pressed="true"'),
    disabled: /\sdisabled=""/.test(match[1]),
    label: match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    aria: (match[1].match(/aria-label="([^"]+)"/) ?? [])[1] ?? null,
  }));
const endingIn = (buttons, text) => buttons.filter((button) => button.label.endsWith(text));

/* 1. Nothing picked: the workbench as it opens. */
useCharacterStore.getState().reset();
const html = render();
const buttons = buttonsOf(html);
const shapes = useCharacterStore.getState().figure.shapes;

assert.ok(html.length > 2000, `the workbench rendered something substantial (${html.length} bytes)`);
assert.ok(html.includes('FRONT') && html.includes('SIDE'), 'both views are there');
for (const tool of ['SELECT', 'ADD', 'MOVE', 'TURN', 'SIZE', 'POSE', 'DELETE', 'UNDO', 'REDO', 'NEW']) {
  assert.equal(endingIn(buttons, tool).length, 1, `the tool strip offers ${tool}, once`);
}
assert.ok(endingIn(buttons, 'SELECT')[0].pressed, 'SELECT is in hand on arrival');
assert.ok(endingIn(buttons, 'UNDO')[0].disabled && endingIn(buttons, 'REDO')[0].disabled, 'and there is nothing to undo or redo yet');
const layerButton = (label) => {
  const found = buttons.filter((b) => b.label === label);
  assert.equal(found.length, 1, `one ${label} switch`);
  return found[0];
};
assert.ok(layerButton('PIXELATE').pressed && layerButton('NORMAL LIGHT').pressed, 'PIXELATE and NORMAL LIGHT are on');
assert.ok(!layerButton('NORMAL MAP').pressed, 'and NORMAL MAP is off');
assert.ok(!buttons.some((b) => b.label === 'SHAPES' || b.label === 'FINAL'), 'the SHAPES / FINAL switch is gone');
const sun = buttons.filter((b) => b.aria === 'Light');
assert.equal(sun.length, 1, 'one ☀ for both views, not one per view');
assert.match(sun[0].tag, /aria-expanded="false"/, 'with its d-pad shut on arrival');
assert.ok(!html.includes('aria-label="Light controls"'), 'so the pad is not drawn');
assert.ok(!html.includes('type="range"'), 'and the light sliders are gone');
assert.ok(html.includes('CLICK A SHAPE'), 'the bar says what SELECT does in three words');
assert.ok(!html.includes('DRAG A YELLOW SQUARE TO SIZE IT</p>'), 'and keeps the full sentence for the tooltip');
const listHead = buttons.filter((b) => b.label.startsWith('SHAPES '));
assert.equal(listHead.length, 1, 'the shapes list has one header');
assert.match(listHead[0].label, new RegExp(`^SHAPES ${shapes.length}/7`), 'saying how many of the seven there are');
assert.match(listHead[0].tag, /aria-expanded="false"/, 'folded on arrival');
for (const shape of shapes) {
  assert.equal(buttons.filter((b) => b.label.endsWith(shape.name) && b.aria === null).length, 0, `so no row for ${shape.name} yet`);
}
assert.ok(layerButton('SKELETON').pressed, 'the skeleton switch is in LAYERS, and on');
assert.ok(html.includes('aria-label="Figure settings"'), 'with nothing picked, the panel shows the figure settings');
assert.ok(html.includes('FROM BASE'), 'its title says which preset the bench started from');
assert.ok(buttons.some((b) => b.label === '[ NEW FIGURE... ]'), 'and offers NEW FIGURE, which opens the picker');
assert.ok(!html.includes('role="dialog"'), 'the picker is shut until asked for');

/**
 * **The pressed census, read off the markup.** One tool, the two layers that start on, the skeleton switch, and one
 * eye per shape (every shape starts shown). A second tool lit at once would be the old defect - two states claiming
 * the same picture - and shows up here as a number that does not add up.
 */
const expectedPressed = 1 + 2 + 1;
assert.equal(buttons.filter((b) => b.pressed).length, expectedPressed, '1 tool + 2 layers + skeleton, with the list folded');

/* Opened, the list has a row per shape - and an eye each, all on - and the header did not move: it is first. */
useCharacterStore.getState().toggleList();
const listHtml = render();
const listButtons = buttonsOf(listHtml);
for (const shape of shapes) {
  assert.equal(listButtons.filter((b) => b.label.endsWith(shape.name) && b.aria === null).length, 1, `the open list has a row for ${shape.name}`);
}
assert.equal(listButtons.filter((b) => b.pressed).length, expectedPressed + shapes.length, `and ${shapes.length} eyes, all on`);
assert.ok(listHtml.indexOf('SHAPES ') < listHtml.indexOf(`>${shapes[0].name}<`), 'the rows open below the header, which stays put');
useCharacterStore.getState().toggleList();

/* The light pad, open: the four arrows, the reset and the LIGHT switch, and from the start one raise is left. */
useCharacterStore.getState().setLightPad(true);
const padHtml = render();
const padButtons = buttonsOf(padHtml);
assert.ok(padHtml.includes('aria-label="Light controls"'), 'the ☀ opens the d-pad');
for (const name of ['Raise the light', 'Lower the light', 'Turn the light left', 'Turn the light right', 'Reset the light']) {
  assert.equal(padButtons.filter((b) => b.aria === name).length, 1, `the pad has ${name}`);
}
assert.ok(padButtons.find((b) => b.label === 'LIGHT ON').pressed, 'and the LIGHT switch, on');
assert.ok(!padButtons.find((b) => b.aria === 'Raise the light').disabled, 'the light can go up from the start');
useCharacterStore.getState().stepLight('up');
assert.ok(buttonsOf(render()).find((b) => b.aria === 'Raise the light').disabled, 'and one raise reaches the top step, so UP rests');
useCharacterStore.getState().reset();
assert.ok(!render().includes('aria-label="Light controls"'), 'a reset shuts the pad');

/**
 * The NEW FIGURE picker, open: a card per preset, none picked, and the commit button disabled until one is - the
 * two-press rule, read off the markup. (Its pictures are canvases, which a server render leaves empty.)
 */
useCharacterStore.getState().setPresetPicker(true);
const pickerHtml = render();
const pickerButtons = buttonsOf(pickerHtml);
const { RIG_PRESET_IDS, RIG_PRESETS } = require('./character-render/lib/character/rig.js');
assert.ok(pickerHtml.includes('role="dialog"') && pickerHtml.includes('aria-label="New figure"'), 'the picker opens over the workbench');
for (const id of RIG_PRESET_IDS) {
  const card = pickerButtons.filter((b) => b.label.includes(RIG_PRESETS[id].label) && b.label.includes(RIG_PRESETS[id].note));
  assert.equal(card.length, 1, `a card for ${RIG_PRESETS[id].label}, with its line`);
  assert.ok(!card[0].pressed, 'none is picked on opening');
}
// (2026-10-25, SPEC-less-text.md) The commit key reads `[ START ]` in both states (it was `[ PICK A FIGURE
// ABOVE ]` until a pick, then `[ START WITH <NAME> ]`): the disabled state is what says "pick first".
const commit = pickerButtons.find((b) => b.label === '[ START ]');
assert.ok(commit && commit.disabled, 'and the start button waits, disabled, for a pick');
assert.ok(!pickerButtons.some((b) => b.label === '[ PICK A FIGURE ABOVE ]'), 'under its short name');
assert.ok(pickerHtml.includes('REPLACES THE CURRENT FIGURE. UNDO BRINGS IT BACK.'), 'START warns that it replaces the figure on the bench (the one warning before it is thrown away)');
useCharacterStore.getState().setPresetPicker(false);

/* 1b. ADD: one button in the strip with a pop-up menu of shapes, not seven buttons spread across the bar. */
const addButton = endingIn(buttons, 'ADD')[0];
assert.match(addButton.tag, /aria-expanded="false"/, 'ADD is a menu button, shut on arrival');
assert.ok(!html.includes('aria-label="Shape to add"'), 'so the shape menu is not drawn');
useCharacterStore.getState().startPlacing({ what: 'shape', kind: 'sphere' });
const adding = render();
const addingButtons = buttonsOf(adding);
assert.ok(endingIn(addingButtons, 'ADD')[0].pressed, 'with ADD in hand');
assert.equal(addingButtons.filter((b) => ['BOX', 'SPHERE', 'CONE', 'CYLINDER', 'CAPSULE', 'WEDGE', 'PRISM'].some((k) => b.label.endsWith(k) || b.aria === k)).length, 0, 'the bar holds no shape buttons');
assert.match(adding.replace(/<!-- -->/g, ''), /SPHERE<\/span><p[^>]*>CLICK A NODE/, 'it names the shape being placed and says what to do next');
assert.equal(addingButtons.filter((b) => b.aria === 'Cancel the new shape').length, 1, 'with a ✗ to cancel before there is a shape to put one beside');
assert.match(adding, /<div inert="" class="[^"]*opacity-60/, 'and the side panels are inert while placing');
useCharacterStore.getState().reset();
assert.doesNotMatch(render(), /<div inert=""/, 'and live again once it is over');

/* 2. A shape picked: its properties. */
const head = shapes.find((shape) => shape.name === 'HEAD');
useCharacterStore.getState().selectShape(head.id);
const picked = render();
const pickedButtons = buttonsOf(picked);
const KINDS = ['BOX', 'SPHERE', 'CONE', 'CYLINDER', 'CAPSULE', 'WEDGE', 'PRISM'];
assert.ok(picked.includes('PROPERTIES'), 'picking a shape shows its properties');
assert.match(picked, /id="shape-name"[^>]*value="HEAD"/, 'its name, in a box that can rename it');
assert.match(picked, /<option value="head" selected="">HEAD<\/option>|<option selected="" value="head">HEAD<\/option>/, 'and the joint it is pinned to');
assert.equal(pickedButtons.filter((b) => KINDS.includes(b.aria)).length, 7, 'all seven shapes to switch it to');
assert.equal(pickedButtons.filter((b) => b.pressed && b.aria === 'SPHERE').length, 1, 'with SPHERE lit, because the head is a sphere');
assert.ok(endingIn(pickedButtons, '[ DUPLICATE ]').length === 1 && endingIn(pickedButtons, '[ DELETE ]').length === 1, 'and DUPLICATE and DELETE');
// ADD in the strip opens its own menu, and the shapes list folds, so both carry aria-expanded too; neither is a
// properties section.
const sectionHeads = pickedButtons.filter((b) => /aria-expanded=/.test(b.tag) && b.aria === null && !b.label.endsWith('ADD') && !b.label.startsWith('SHAPES ')).map((b) => b.label.replace(/ [▾▸]$/, ''));
assert.deepEqual(sectionHeads, ['SHAPE', 'COLOUR', 'PIN', 'NUMBERS'], 'the properties fold into SHAPE / COLOUR / PIN / NUMBERS');
assert.equal((picked.match(/type="number"/g) ?? []).length, 0, 'NUMBERS is folded on arrival: no number boxes yet');
useCharacterStore.getState().toggleSection('numbers');
const unfolded = render();
assert.equal((unfolded.match(/type="number"/g) ?? []).length, 9, 'unfolded: position, turn and size, nine number boxes');
assert.ok(unfolded.indexOf('[ DELETE ]') < unfolded.indexOf('type="number"'), 'and NUMBERS is last, so unfolding it pushes nothing down');
useCharacterStore.getState().reset();

/**
 * 3. **Joints are posed by their handles, not chosen from a list.** The old rule here was "no joint picker in the
 * sidebar - the handles are the interaction". It still holds for *posing*. The one list of joints is the PINNED TO
 * box in a shape's properties, which is there on purpose (the spec: a shape can be re-pinned), and it is the only
 * `<select>` on the workbench.
 */
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'));
const sceneCode = strip(fs.readFileSync('app/components/CharacterScene.tsx', 'utf8'));
assert.doesNotMatch(code, /JointPicker/, 'there is no joint picker');
assert.equal((code.match(/<select/g) ?? []).length, 1, 'one <select> - the PINNED TO box');
assert.match(code, /<select\s+id="shape-pin"/, 'and that is what it is');
assert.match(sceneCode, /kind: 'pose', jointId: id/, 'posing starts from a joint handle in the view');

/* 4. The scene is a real, always-drawing, flat canvas. */
assert.match(sceneCode, /from '@react-three\/fiber'/, 'the scene uses react-three-fiber');
assert.match(sceneCode, /<Canvas/, 'and renders a canvas');
assert.match(sceneCode, /<OrthographicCamera/, 'with a flat camera, so a pixel means the same thing anywhere on screen');
assert.match(sceneCode, /frameloop="always"/, 'the canvas runs a frame loop, so the figure is guaranteed to draw');
assert.doesNotMatch(sceneCode, /frameloop="demand"/, 'demand never invalidates here, so it never drew at all');
assert.match(sceneCode, /window\.addEventListener\('pointerup', end\)/, 'a drag ends wherever the pointer is let go, even outside the view');
const passCode = strip(fs.readFileSync('app/components/CharacterPixelRender.tsx', 'utf8'));
assert.match(passCode, /const \{ layers, light, lightOn \} = useCharacterStore\.getState\(\);/, 'the render reads the light and the layers from the store every frame');

/**
 * 5. **No selector returns a fresh object on every call.** The loop that made the CHAR tab throw: a selector like
 * `(state) => Object.keys(state.figure.shapes)` builds a new array each time, zustand sees a change, re-renders and
 * builds another. Server rendering cannot see a loop (one render is not a loop), so the selectors' *shape* is held:
 * each must be a plain read, or end in something primitive. Reading a new array and counting it is fine; returning
 * it is not. Covers the scene now as well as the panels.
 */
const selectors = [...(code + sceneCode).matchAll(/useCharacterStore\(\((?:state|\w+)\) => (.+?)\);/g)].map((match) => match[1].trim());
assert.ok(selectors.length >= 20, `found the selectors to check (${selectors.length})`);
const PRIMITIVE = [/\.length$/, /\.length [<>=]+ \d+$/, /\.toString\(\)$/, /^state\.\w+(\.\w+)*$/, /^\w+$/, /^'[^']*'$/, /=== shape\.id$/];
const BUILDS = [/\bObject\.keys\(/, /\bObject\.entries\(/, /\bObject\.values\(/, /\.map\(/, /\.filter\(/, /\.slice\(/, /\.concat\(/, /\{\s*\.\.\./, /^\s*\[/];
for (const selector of selectors) {
  if (PRIMITIVE.some((pattern) => pattern.test(selector))) continue;
  assert.ok(!BUILDS.some((pattern) => pattern.test(selector)), `selector "${selector}" must return a stable value - a new object per call re-renders forever`);
}

console.log('character panel render checks passed');
console.log(`  rendered : ${html.length} bytes with nothing picked, ${picked.length} with the head picked`);
console.log('  strip    : 7 tools + undo/redo + new, SELECT in hand, nothing to undo');
console.log(`  pressed  : ${expectedPressed} - one tool, two layers, the skeleton; then an eye per shape with the list open`);
console.log('  light    : one ☀, its d-pad shut until asked for, UP rests at the top step');
console.log('  folds    : SHAPE / COLOUR / PIN / NUMBERS, NUMBERS folded and last');
console.log(`  picker   : ${RIG_PRESET_IDS.length} cards, none picked, start disabled until one is`);
console.log(`  selectors: ${selectors.length} checked, none builds a new value`);
console.log('  cannot   : see a pixel or press anything. Temp/char-drive.cjs does both, in Chrome.');
