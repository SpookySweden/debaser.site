const assert = require('node:assert/strict');
const fs = require('node:fs');

/**
 * The model palette must not contain a colour that lighting can turn grey, and this is the check for it.
 *
 * **The defect this holds was invisible until the canvas was measured.** `MODEL_INK` was `#FFFFFF`, which looks
 * reasonable in source and is why every existing check passed. Rendered, it becomes `rgb(226,226,226)` - a grey,
 * which the palette forbids - because white geometry under a `meshLambertMaterial` is darkened by whatever light
 * reaches it and no light on this stage reaches 1.0. The figure had no colour of its own at all.
 *
 * A list of forbidden values would be the wrong shape of rule, because the next white would be a different white.
 * What is checked instead is the *property* that makes a colour safe: **every channel must be able to lose
 * brightness without the result becoming a grey**, which is true exactly when the colour is saturated enough that
 * the channels stay apart as they scale down. White, black and grey all fail it. So do the site's own
 * near-greys. Saturated hues pass at any brightness.
 *
 * `MODEL_HANDLE` and `MODEL_HANDLE_ACTIVE` are the exception and are exempted by name: they are *unlit*
 * (`meshBasicMaterial` on a handle), so no light can move them, and they are deliberately the site's green and
 * yellow because a handle is a handle. The exemption is written out rather than implied, so adding a lit white
 * to that list is a visible edit rather than a silent one.
 */
const palette = fs.readFileSync('app/lib/character/palette.ts', 'utf8');
const declarations = [...palette.matchAll(/export const (MODEL_\w+) = '(#[0-9A-Fa-f]{6})';/g)].map((match) => ({
  name: match[1],
  hex: match[2],
}));

assert.ok(declarations.length >= 6, `found the palette to check (${declarations.length})`);

/** Unlit, so no light can shade them into a grey. Named rather than pattern-matched, deliberately. */
const UNLIT = new Set(['MODEL_HANDLE', 'MODEL_HANDLE_ACTIVE', 'MODEL_VOID']);

/** Maximum channel spread after dimming to a normal light level. Under 20 and it reads as a grey. */
const MIN_SPREAD = 20;

for (const { name, hex } of declarations) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);

  if (UNLIT.has(name)) {
    assert.ok(spread >= MIN_SPREAD || Math.max(r, g, b) === 0, `${name} is unlit, so only its own value matters`);
    continue;
  }

  // What the colour becomes at 70% light, which is roughly where a lambert surface under these lights lands.
  const dimmed = [r, g, b].map((channel) => Math.round(channel * 0.7));
  const dimmedSpread = Math.max(...dimmed) - Math.min(...dimmed);

  assert.ok(
    spread >= MIN_SPREAD,
    `${name} (${hex}) has a channel spread of only ${spread} - it is a grey, or near enough to become one`,
  );
  assert.ok(
    dimmedSpread >= MIN_SPREAD * 0.7,
    `${name} (${hex}) loses its hue when lit: dimmed to ${dimmed.join(',')} the spread is ${dimmedSpread}, ` +
      'so the lit figure would read as a grey. Pick a more saturated colour.',
  );
}

// The specific regression: the lit ink must not be white or near-white, which is what made the figure grey.
const ink = declarations.find((entry) => entry.name === 'MODEL_INK');
assert.ok(ink, 'MODEL_INK exists');
assert.notEqual(ink.hex.toUpperCase(), '#FFFFFF', 'MODEL_INK is not white - white under a light is a grey');
assert.ok(
  (ink.hex.match(/[0-9A-Fa-f]{2}/g) ?? []).some((pair) => parseInt(pair, 16) > 0x90),
  'and it is not so dark that nothing of it shows against the void',
);

// The limb tone has to be separable from the trunk, or the two masses merge into one silhouette.
const limb = declarations.find((entry) => entry.name === 'MODEL_LIMB');
assert.ok(limb, 'MODEL_LIMB exists - a second tone is what makes a joint read as a joint');

const distance = (a, b) => {
  const channels = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return Math.max(...channels(a).map((value, index) => Math.abs(value - channels(b)[index])));
};

assert.ok(
  distance(ink.hex, limb.hex) >= 24,
  `the limb tone must be visibly apart from the trunk (they differ by ${distance(ink.hex, limb.hex)})`,
);

/**
 * And the scene must actually *use* both, because a declared palette the components ignore is the
 * `SIDE_MUSIC.href` defect again - a value that looks right in source and is never read.
 */
const scene = fs
  .readFileSync('app/components/CharacterScene.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * **Updated for the free-shape workbench (the rule is the same, the place it lives moved).** Shapes used to take
 * their tone from a regex over joint names inside the scene. Now every shape carries its own colour: the starting
 * figure gives its limb shapes `MODEL_LIMB` in `rig.ts`, and the scene paints `shape.colour`, falling back to
 * `MODEL_INK`. So the assertions follow the colour to where it is decided - and `MODEL_LIMB` must also be a dye a
 * reader can pick, or a limb recoloured once could never be put back.
 */
const rig = fs.readFileSync('app/lib/character/rig.ts', 'utf8');
const paletteSource = fs.readFileSync('app/lib/character/palette.ts', 'utf8');
assert.match(scene, /shape\.colour \?\? MODEL_INK/, 'the scene paints each shape its own colour, the trunk tone by default');
// Presets name their colours by dye id (2026-10-14); BASE's legs are dyed 'limb', which is MODEL_LIMB. (BLOB held this
// rule until the simple-figure presets replaced it, SPEC-simple-figures.md.)
assert.match(rig, /LEG \$\{s\}`, kind: 'capsule'[^\n]*dye: 'limb'/, 'and BASE gives its legs the second tone');
assert.match(rig, /const dye = MASS_DYES\.find\(\(entry\) => entry\.id === id\)/, 'resolved through the dyes, so a preset can only wear a pickable colour');
assert.match(rig, /upper-arm|forearm|thigh|shin|hand|foot/, 'matched to the rig`s own hyphenated, suffixed joints');
assert.match(paletteSource, /value: MODEL_LIMB/, 'and the limb tone is a dye, so a recoloured limb can be put back');

console.log('character palette checks passed');
console.log(`  declared : ${declarations.length} colours, none able to read as a grey when lit`);
console.log(`  ink      : ${ink.hex} trunk, ${limb.hex} limbs - ${distance(ink.hex, limb.hex)} apart`);
console.log('  why      : #FFFFFF under a lambert light is rgb(226,226,226), which is the grey that was shipped');
console.log('  cannot   : see the figure. This proves the colours are not greys, not that they look right.');
