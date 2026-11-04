const assert = require('node:assert/strict');
const fs = require('node:fs');

/**
 * The workbench's modes: one tool in hand, one set of LAYERS switches, one skeleton switch.
 *
 * **Rewritten twice.** First when the four layer tabs were replaced by a tool strip and a SHAPES / FINAL switch; then
 * when the live pixel render replaced the looks (SPEC-pixel-render.md) with three LAYERS switches. The rule this file
 * was written to hold has not changed: *a picture is decided by one fact, not by flags that can disagree.* The three
 * switches are independent on purpose, and where two of them would disagree - NORMAL MAP and NORMAL LIGHT - one
 * answer is computed in one place (`shadeMode`, held by `check-character-stages.cjs`) and NORMAL LIGHT rests:
 *
 *   the TOOL     what a press or drag in a view does - exactly one, stored once, listed once
 *   the LAYERS   PIXELATE, NORMAL LIGHT, NORMAL MAP - one record in the store, drawn from one list
 *   the SKELETON an independent overlay switch
 *
 * It holds the strip's three blocks (EDIT, POSE, HISTORY), drawn from the tool list so no tool can be declared and
 * unreachable. And it holds the options bar to the reveal rule: the bar above the views is always there, the same
 * height, whatever the tool - its contents change, the views below it never move.
 */
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const storeCode = strip(fs.readFileSync('app/lib/character/store.ts', 'utf8'));
const viewportCode = strip(fs.readFileSync('app/components/CharacterViewport.tsx', 'utf8'));
const sceneCode = strip(fs.readFileSync('app/components/CharacterScene.tsx', 'utf8'));

assert.ok(!fs.existsSync('app/lib/character/layers.ts'), 'the four-layer module is gone, not left behind unused');

// One tool, declared once as a union and once as the strip's order.
const union = storeCode.match(/export type ToolId = ([^;]+);/)?.[1];
const list = storeCode.match(/export const TOOL_IDS: readonly ToolId\[\] = \[([^\]]+)\]/)?.[1];
assert.ok(union && list, 'the tools are a union and a list');
const fromUnion = [...union.matchAll(/'(\w+)'/g)].map((m) => m[1]);
const fromList = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
assert.deepEqual(fromList, fromUnion, 'the strip lists every tool, in the order the type declares them');
assert.deepEqual(fromList, ['select', 'add', 'move', 'turn', 'size', 'pose', 'delete'], 'the seven tools the spec names');
assert.match(storeCode, /tool: ToolId;/, 'the store holds a single tool');
assert.match(storeCode, /tool: 'select' as ToolId/, 'and SELECT is in hand when the workbench opens');
/*
 * The strip's blocks: EDIT is every tool but POSE, drawn from the list - so a tool added to the list lands in EDIT
 * rather than nowhere - and POSE is its own block. (This used to assert `TOOL_IDS.map`; the rule is the same.)
 */
assert.match(viewportCode, /const EDIT_TOOLS = TOOL_IDS\.filter\(\(id\) => id !== 'pose'\);/, 'EDIT is the list minus POSE');
assert.match(viewportCode, /<StripBlock label="Edit" grid>\s*\{EDIT_TOOLS\.map\(toolButton\)\}/, 'and the EDIT block draws it');
// Simple figures: +NODE joined POSE's block - both work on the skeleton.
assert.match(viewportCode, /<StripBlock label="Pose">\s*\{toolButton\('pose'\)\}\s*<AddNodeButton \/>\s*<\/StripBlock>/, 'POSE has a block of its own, with +NODE');
assert.match(viewportCode, /<StripBlock label="History">/, 'and UNDO, REDO and NEW sit in HISTORY');
assert.match(
  viewportCode,
  /const TOOLS: Record<ToolId, \{ label: string; status: string; hint: string \}>/,
  'every tool has a name, a few words for the bar and a sentence for its tooltip (a type error otherwise)',
);
assert.match(viewportCode, /title=\{TOOLS\[id\]\.hint\}/, 'the sentence is the tool button tooltip, not text on the bar');

// The layers: one record, one list, one group.
assert.doesNotMatch(storeCode, /LookId|look: /, 'the SHAPES / FINAL look is gone');
assert.match(storeCode, /layers: Record<LayerId, boolean>;/, 'the store holds the layer switches as one record');
assert.match(storeCode, /toggleLayer: \(id\) => set\(\(state\) => \(\{ layers: \{ \.\.\.state\.layers, \[id\]: !state\.layers\[id\] \} \}\)\)/, 'and flips one at a time');
assert.match(viewportCode, /role="group" aria-label="Layers"/, 'the switches are one labelled group');
assert.match(viewportCode, /\{LAYER_IDS\.map\(\(id\) => \(/, 'drawn from the list');
assert.match(viewportCode, /aria-pressed=\{layers\[id\]\}/, 'each pressed by its own stored value');
// Updated 2026-10-19: the rest rule moved into `layerRests` when 50 PX joined (NORMAL LIGHT under NORMAL MAP, 50 PX
// with PIXELATE off); check-character-pixel.cjs runs the rule itself.
assert.match(viewportCode, /disabled=\{layerRests\(id, layers\)\}/, 'and a switch with nothing to change rests (layerRests)');

// The skeleton is its own switch.
assert.match(storeCode, /showSkeleton: boolean;/, 'the skeleton keeps its own independent switch');
assert.match(sceneCode, /if \(!posing && !showSkeleton && placing === null\) return null;/, 'and POSE (and placing, which picks a node) always shows it - a pose tool with no joints would be a dead end');
// Simple figures: the switch moved from the figure panel into the LAYERS group, beside the render switches.
const layersGroup = viewportCode.slice(viewportCode.indexOf('function LayerSwitches'), viewportCode.indexOf('function LightControl'));
assert.match(layersGroup, /aria-label="Layers"[\s\S]*onClick=\{toggleSkeleton\}\s*aria-pressed=\{showSkeleton\}[\s\S]*SKELETON/, 'the skeleton switch sits in the LAYERS group');
assert.equal((viewportCode.match(/toggleSkeleton\}/g) ?? []).length, 1, 'and nowhere else');

// The options bar keeps its box.
assert.match(viewportCode, /min-h-\[3\.25rem\]/, 'the options bar reserves its height');
assert.match(
  viewportCode,
  /placing \? <PlacingOptions \/> : tool === 'pose' \? <PoseOptions \/> :/,
  'and swaps only its contents per tool',
);

console.log('character mode checks passed');
console.log(`  tools    : ${fromList.length}, one in hand, listed once`);
console.log('  strip    : EDIT / POSE / HISTORY, EDIT drawn from the list');
console.log('  layers   : PIXELATE, 12 PX, NORMAL LIGHT, NORMAL MAP - one record, one group, from one list');
console.log('  overlay  : the skeleton switch, in the LAYERS group');
console.log('  cannot   : see that the layers differ. Temp/char-drive.cjs measures that in Chrome.');
