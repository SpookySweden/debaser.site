/*
 * THIS IS OPEN: the one look for everything that folds open in place (Luke, 2026-11-14: "go over all expandable things in the site and
 * where it makes sense ... make it clear with highlights or something that the expansion is engaged, so its easier to see that and
 * then click it again to collapse"). No browser needed: it holds the rule in the stylesheet, what it reaches and what it must not,
 * and that the folds in the site's frame say they are open in the way the rule reads.
 *   npx tsc app/components/InfoFold.tsx --outDir Temp/open-look-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
// Without its comments: they name the same classes the rules do, and a rule is what is being looked for.
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector list contains `selector`. */
function rule(selector) {
  const at = css.indexOf(selector);
  assert.ok(at !== -1, `the stylesheet has a rule for ${selector}`);
  const open = css.indexOf('{', at);
  return { selectors: css.slice(css.lastIndexOf('}', at) + 1, open), body: css.slice(open + 1, css.indexOf('}', open)) };
}

// 1. An open key is pressed in: the field ink for its fill, the window's colour for its words.
const key = rule(".key[aria-expanded='true']");
assert.match(key.selectors, /:is\(button, \[role='button'\]\)\.key\[aria-expanded='true'\]/, 'buttons only: a tree row or a search box that says it is expanded is left alone');
assert.match(key.selectors, /details\[open\] > summary\.key/, 'and the key of an open <details> is the same thing');
assert.match(key.body, /--open-fill: var\(--key-ink, var\(--color-ink\)\)/, "filled with the field ink, or the key's own ink on a surface that sets one");
assert.match(key.body, /background-color: var\(--open-fill\)/);
assert.match(key.body, /color: var\(--key-hover-ink, var\(--color-paper\)\)/, "its words take the window's colour");
assert.match(key.selectors, /:not\(:active/, 'the press keeps its flash');
assert.match(key.selectors, /\.debaser-beatbox \*/, 'the beat box, which has a look of its own, is left out');

// 2. An open row stays lit in the colour a row wears under the pointer.
const row = rule("[aria-expanded='true']:not(.key");
assert.match(row.selectors, /details\[open\] > summary:not\(\.key/, 'a thread or a note, whose summary is a whole row, is a row');
assert.match(row.body, /background-color: var\(--color-pointed\)/, 'lit in `pointed`, which every ink a row carries reads on');
assert.doesNotMatch(row.body, /(^|\s)color:/, "and its words keep their own colours");

// 3. The opened area is tied to it by a rule in the field ink down its left side.
const area = rule('.fold-body');
assert.match(area.selectors, /details\[open\]:has\(> summary\.key\) > :not\(summary\)/, 'automatic for what a <details> key opens');
assert.match(area.body, /border-inline-start: 2px solid var\(--color-ink\)/);
const block = rule('details[open]:not(:has(> summary.key))');
assert.match(block.body, /box-shadow: -3px 0 0 0 var\(--color-ink\)/, 'and for a row-style <details> the rule runs down the whole open block, outside it, so the row does not move');

// 4. Colour only on the thing pressed: nothing that could move it under the pointer.
for (const [name, body] of [['an open key', key.body], ['an open row', row.body]]) {
  assert.doesNotMatch(body, /padding|margin|border-width|border:|font|width|height|transform/, `${name} changes colour only`);
}
// Unlayered, so it wins over a component's own classes: the rule stands at the top level of the stylesheet, not inside a layer.
const before = css.slice(0, css.indexOf(".key[aria-expanded='true']"));
assert.equal((before.match(/\{/g) ?? []).length, (before.match(/\}/g) ?? []).length, 'the rule is at the top level of the stylesheet');

// 5. The frame's own folds say they are open in the way the rule reads.
const InfoFold = require('./open-look-render/components/InfoFold.js').default;
const fold = renderToStaticMarkup(React.createElement(InfoFold, { topic: 'pins' }, 'WORDS'));
assert.match(fold, /<details[^>]*><summary[^>]*class="[^"]*(?<=[" ])key(?=[" ])/, 'the [ ? ] fold is a <details> whose summary is a bracket key');
assert.match(read('app/components/SiteNav.tsx'), /aria-expanded=\{listOpen\}/, 'MODULOS says when its list is open');
assert.doesNotMatch(read('app/components/SiteNav.tsx'), /listOpen \? wordClass\(true\)/, 'and no longer draws an open face of its own');
assert.match(read('app/components/SidebarComms.tsx'), /aria-expanded=\{expanded\}[\s\S]*id="sidebar-comms-list" className="fold-body"/, "the side panel's COMMS key says it is open, and what it opens is tied to it");
assert.match(read('app/components/SidebarProfile.tsx'), /aria-expanded=\{settingsOpen\}[\s\S]*className="fold-body /, 'and so is SETTINGS');
assert.match(read('docs/design.md'), /THIS IS OPEN: one look for everything that folds open in place/, 'the rule is written down');

console.log('open look: one rule lights open keys, rows and their areas; buttons and summaries only; colour only: OK');
