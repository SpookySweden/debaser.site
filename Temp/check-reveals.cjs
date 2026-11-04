/**
 * The reveal rule, held where it can fail.
 *
 * CLAUDE.md, "Reveals take their space in both states": anything that appears on hover, focus or tap
 * must occupy its box either way, so the thing being pointed at never moves and nothing beside it
 * reflows. Two shapes are legal, and the audit that found the violations is now a check rather than a
 * one-off, because the shape that breaks it is the *obvious* one to write:
 *
 *     <span className="hidden group-hover:inline-flex">    <- the bug: arrives and shoves siblings
 *
 * …which is exactly what `PostAuthorRow`'s picture and `ForumThreadCard`'s thumbnail were doing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Every component, so a new reveal anywhere is covered rather than the four files known today. */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });

const REVEAL = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?'([^']*)'[^}]*?\})/g;

/** `hidden` (or `hidden …`) followed by a hover/focus reveal: the box does not exist until then. */
const COMES_FROM_NOTHING = /^hidden\b[^`"']*\b(group-hover|group-focus-within|hover|focus):(flex|block|inline-flex|inline|grid)\b/;

/** Out of flow: legal, because filling it cannot push anything. */
const OUT_OF_FLOW = /\b(absolute|fixed)\b/;

/**
 * An element that fills a space somebody else reserved, declared rather than inferred.
 *
 * `PostRowDetails` is the case: its own class string is absolute inside a box its caller laid out, and
 * no regex can see across that gap - the caller in `ForumThreadCard` holds a `w-2/5` column in both
 * states. So the component says so about itself with `data-reveal="reserved"` and the audit believes
 * it - which is a claim a reviewer can check, unlike a heuristic that guesses. (It was written for the
 * hover panel that used to fill that column; the panel reveals nothing now, but the declaration is
 * still what the browser probes read the band by.)
 */
const DECLARED_RESERVED = /data-reveal="reserved"/;

const offenders = [];
let inspected = 0;
let declared = 0;

for (const file of walk('app')) {
  const text = fs.readFileSync(file, 'utf8');

  for (const match of text.matchAll(REVEAL)) {
    // The declaration sits on the same element, which in JSX means it may be written either side of
    // the `className` - so the window is taken around the match rather than after it.
    const window = text.slice(Math.max(0, match.index - 120), match.index + 160);
    const cls = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\s+/g, ' ').trim();
    if (!/(group-hover|group-focus-within|hover|focus):(flex|block|inline-flex|inline|grid)\b/.test(cls)) continue;

    inspected += 1;
    if (OUT_OF_FLOW.test(cls)) continue;

    if (DECLARED_RESERVED.test(window)) {
      declared += 1;
      continue;
    }

    if (COMES_FROM_NOTHING.test(cls)) offenders.push({ file, cls });
  }
}

console.log('reveal rule');
console.log(`  inspected  : ${inspected} hover/focus reveals`);
console.log(`  declared   : ${declared} filling a space their caller reserved`);
console.log(`  out of flow: legal, and not counted against the rule`);

if (offenders.length > 0) {
  for (const { file, cls } of offenders) {
    console.log(`\n  FAIL ${file.replace(/\\/g, '/')}`);
    console.log(`       ${cls}`);
  }

  assert.fail(
    `${offenders.length} reveal(s) appear from nothing inside a laid-out row. ` +
      'Use REVEAL_SLOT with a width and REVEAL_CONTENTS for the inner box, or make it absolute.',
  );
}

// The two shapes the rule names, so a rename or a deletion fails here rather than silently unravelling
// the convention: the slot that reserves, and the contents that swap.
const controls = fs.readFileSync(path.join('app', 'lib', 'ui', 'controls.ts'), 'utf8');
assert.match(controls, /export const REVEAL_SLOT = '[^']*'/, 'the reserved slot is still declared');
assert.match(controls, /export const REVEAL_CONTENTS = '[^']*'/, 'and the swapping contents with it');
// The slot reserves the space, so its own class must not begin with `hidden`. `empty:hidden` at the
// end is fine and is there on purpose: a slot with nothing in it collapses for real, because nothing
// is arriving there later and there is no second state to jump between.
assert.doesNotMatch(
  controls,
  /REVEAL_SLOT =\s*'hidden\b/,
  'the slot itself is never hidden - a slot that only exists on hover is the bug',
);
assert.match(
  controls,
  /REVEAL_CONTENTS = 'hidden\b[^']*group-hover:flex/,
  'and the contents are what the pointer reveals',
);

// The rule is written down, which is what makes it the site's rather than this file's.
// The site's rules moved out of CLAUDE.md on 2026-10-22; this one now lives in the frontend rules.
const agents = fs.readFileSync('.claude/rules/frontend.md', 'utf8');
assert.match(agents, /Reveals take their space in both states/, 'frontend.md carries the rule');

console.log('  offenders : 0');
console.log('  ok         reveals take their space in both states');
