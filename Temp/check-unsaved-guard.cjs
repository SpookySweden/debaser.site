/**
 * The unsaved-work guard: does the window refuse to be dismissed by a stray click, and does it ask before it
 * throws anything away?
 *
 * **Held in source, because the measurements that prove it need a browser.** `Temp/probe-unsaved.cjs` drove the
 * real window in Chrome and reported:
 *
 *   click the backdrop, nothing edited   1 dialog,  no prompt    <- does not close
 *   close with an edited name            2 dialogs, prompted     <- asks first
 *   expand the list                      folded by default, lists the change
 *   go back                              1 dialog,  name still there
 *   switch tab with unsaved work         prompted
 *   throw away, then switch              no prompt, moved off the tab
 *
 * What this file holds is the *wiring* those numbers rest on, so a later edit that unplugs the guard fails here
 * rather than in the browser probe - which needs a server, a Chrome and two minutes.
 *
 * Steps: the runner matches the `npx tsc ` prefix literally, inside this block.
 *   npx tsc app/components/PopoutWindow.tsx app/components/UnsavedPrompt.tsx app/components/ProfileCustomiserWindow.tsx app/components/CharacterEditorPanel.tsx --outDir Temp/guard-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) =>
  fs
    .readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const popout = read('app/components/PopoutWindow.tsx');
const customiser = read('app/components/ProfileCustomiserWindow.tsx');
const prompt = read('app/components/UnsavedPrompt.tsx');
const panel = read('app/components/CharacterEditorPanel.tsx');

/* 1. The backdrop click is opt-out, and the customiser opts out - while every other window keeps it. */
assert.match(popout, /dismissOnBackdrop\?: boolean/, 'the backdrop dismissal is a prop');
assert.match(popout, /dismissOnBackdrop = true/, 'and it defaults to ON, so no other window changes behaviour');
assert.match(
  popout,
  /onMouseDown=\{dismissOnBackdrop \? onClose : undefined\}/,
  'the scrim only closes the window when the window said it may',
);
assert.match(customiser, /dismissOnBackdrop=\{false\}/, 'and the customiser, which holds work, says it may not');

/* 2. Both exits go through the one gate. Two checks would be two chances to disagree. */
assert.match(customiser, /function guard\(intent/, 'there is a single guard');
assert.match(
  customiser,
  /onClose=\{\(\) => guard\(\{ kind: 'close' \}\)/,
  'the window`s own close goes through it, so ESC and the `x` cannot bypass it',
);
assert.match(
  customiser,
  /onClick=\{\(\) => guard\(\{ kind: 'tab', tab: entry\.key \}\)\}/,
  'and so does every tab press',
);
assert.doesNotMatch(
  customiser,
  /onClose=\{onClose\}/,
  'the raw close is NOT wired straight through - that is the bug this holds shut',
);
assert.doesNotMatch(
  customiser,
  /onClick=\{\(\) => setTab\(/,
  'nor is a tab press wired straight to setTab',
);

/* 3. Nothing is asked when there is nothing to lose, and the same tab is not a move. */
assert.match(
  customiser,
  /if \(intent\.kind === 'tab' && intent\.tab === tab\) return;/,
  'pressing the tab you are already on is not a switch and does not prompt',
);
assert.match(
  customiser,
  /if \(unsaved\.length === 0\) \{\s*\n\s*finish\(intent\);/,
  'and with nothing unsaved the action happens at once - a prompt for nothing is a prompt nobody reads',
);

/* 4. The changes are derived from the drafts on every render, never stored. */
assert.match(
  customiser,
  /const unsaved: UnsavedChange\[\] = \[/,
  'the unsaved list is derived',
);
assert.doesNotMatch(
  customiser,
  /useState<[^>]*UnsavedChange/,
  'and NOT held in state, which is how a flag comes to disagree with the drafts it describes',
);
assert.match(
  customiser,
  /unsavedChanges\(\s*\n\s*\{/,
  'it reads the stored profile',
);
assert.match(
  customiser,
  /figureIsUnsaved\(\{ bench: benchFigure, kept: keptFigure \}\)/,
  'and it includes the figure, compared against the one that was kept',
);
assert.match(customiser, /useBenchFigure\(\)/, 'reading the bench from the store');
assert.match(customiser, /useKeptFigure\(\)/, 'and the kept figure too');
assert.doesNotMatch(
  customiser,
  /figureTouched/,
  'the latch is gone: a boolean set on any skeleton change is what made discarding re-mark the figure as edited',
);

/**
 * 5. **The panel no longer reports edits at all, and that is the fix rather than a simplification.**
 *
 * It used to take `onTouched` / `onKept` callbacks and latch a boolean on any skeleton change - so throwing
 * changes away, which puts the bench back and *is* a skeleton change, re-marked the figure as edited. The prompt
 * then named a figure the reader had just discarded, and re-asked on every tab switch. What replaced it is a
 * comparison the store can answer for itself: `keptFigure` is the figure as last saved or loaded, and the console
 * diffs the bench against it.
 */
assert.doesNotMatch(panel, /onTouched/, 'the workbench takes no "this was edited" callback any more');
assert.doesNotMatch(panel, /onKept/, 'nor one for a save, because a save is now a fact in the store');
assert.doesNotMatch(
  panel,
  /useCharacterStore\.subscribe/,
  'and it does not subscribe to skeleton changes, which is what re-marked the figure after a discard',
);
/**
 * **A discard puts the bench back from the console itself, not through the panel - changed 2026-10-13.** The panel
 * used to do it on a `discardToken` bump, which only ran while the CHAR tab was mounted. Throwing changes away on the
 * way to another tab (the usual reason to see the prompt) left the bench edited, and the prompt came straight back
 * on the return trip - found by `Temp/char-drive.cjs` pressing exactly that. Now the console asks the store to
 * revert to the kept figure, which works whichever tab is showing.
 */
assert.match(customiser, /useCharacterStore\.getState\(\)\.revert\(\);/, 'discarding reverts the bench from the console, on any tab');
assert.doesNotMatch(panel, /discardToken/, 'and the panel no longer waits for a signal it can only hear while mounted');
assert.doesNotMatch(panel, /useEffect/, 'so it runs nothing on mount - a fresh workbench is never replaced by a save');

/**
 * 6. **`[ THROW THEM AWAY ]` actually throws the drafts away, which it did not.**
 *
 * The defect this holds shut: the prompt said the work would be lost, the reader agreed, and `finish()` only
 * cleared the prompt - so the drafts survived and the one control whose purpose is to discard discarded nothing.
 * A dialogue that does not do what its buttons say teaches a reader that the words are decoration.
 */
assert.match(customiser, /function discardEverything\(\)/, 'there is a discard, not just a dismiss');
assert.match(
  customiser,
  /onDiscard=\{\(\) => \{[\s\S]{0,300}?discardEverything\(\);\s*\n\s*finish\(pendingIntent\);/,
  'and the prompt`s destructive button calls it *before* carrying out what was asked',
);
assert.doesNotMatch(
  customiser,
  /onDiscard=\{\(\) => finish\(pendingIntent\)\}/,
  'a discard that only finishes is the bug, so it must not be wired that way',
);

/* 6. The prompt exists, lists the changes, and folds them away by default. */
assert.match(prompt, /export default function UnsavedPrompt/, 'there is a prompt component');
assert.match(prompt, /useState\(false\)/, 'with the list state starting closed');
assert.match(prompt, /aria-expanded=\{open\}/, 'a control that says whether the list is open');
assert.match(
  prompt,
  /changes\.map\(\(change, index\) => \(/,
  'and it lists every change rather than only counting them',
);
assert.match(prompt, /change\.label/, 'showing what changed');
assert.match(prompt, /change\.detail/, 'and what it changed from and to');
assert.match(prompt, /change\.tab\.toUpperCase\(\)/, 'and which tab it is on, so the reader can go back to it');

/* 7. Three ways out, and the safe one is first. */
assert.match(prompt, /onStay/, 'the prompt can be dismissed without losing anything');
assert.match(prompt, /onDiscard/, 'and it can throw the work away');
assert.match(prompt, /onSave/, 'and it can save, when there is anything saveable');
// (2026-10-25, SPEC-less-text.md) `[ GO BACK AND KEEP WORKING ]` -> `[ KEEP EDITING ]`, `[ SAVE WHAT CAN BE SAVED ]`
// -> `[ SAVE ]`, `[ THROW THEM AWAY ]` -> `[ DISCARD ]`. The order is what this holds, so it is asked of the new keys.
const stayAt = prompt.indexOf('[ KEEP EDITING ]');
const discardAt = prompt.indexOf('[ DISCARD ]');
assert.ok(stayAt > 0 && discardAt > 0, 'both keys are there, under their short names');
assert.ok(
  stayAt < discardAt,
  'going back comes first and throwing away comes last, because losing work should take a deliberate press',
);
assert.doesNotMatch(prompt, /GO BACK AND KEEP WORKING|THROW THEM AWAY/, 'the long key names are gone');

/**
 * 8. **The save button is offered only when a save can keep something.**
 *
 * The figure cannot be saved at all, so a reader whose only unsaved work is the rig must not be offered a save
 * button that does nothing - that is the failure this asserts against, and it is the honest version of the
 * missing-persistence gap rather than a cover for it.
 */
assert.match(
  customiser,
  /onSave=\{unsaved\.some\(\(change\) => change\.tab !== 'character'\) \? saveThenFinish : undefined\}/,
  'the save option appears only when something other than the figure is unsaved',
);
assert.match(
  prompt,
  /changes\.some\(\(change\) => change\.tab === 'character'\) \?/,
  'and the prompt says out loud when the figure cannot be kept',
);

/* 9. The prompt is a window of its own, which is what makes a button below the fold impossible. */
assert.match(prompt, /<PopoutWindow/, 'the prompt is its own window, not a panel inside a scrolling body');
assert.match(prompt, /dismissOnBackdrop=\{false\}/, 'and it too refuses to be dismissed by a stray click');

console.log('customiser unsaved-guard checks passed');
console.log('  backdrop : opt-out, and only the customiser opts out');
console.log('  gate     : one guard for close and for tab, so the two cannot disagree');
console.log('  prompt   : its own window, lists the changes, folded away by default');
console.log('  cannot   : prove the buttons work. That is Temp/probe-unsaved.cjs, with a browser.');
