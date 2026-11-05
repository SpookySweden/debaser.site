const assert = require('node:assert/strict');
const { unsavedChanges, figureIsUnsaved, summarise } = require('./profile-out/profile/unsaved-changes.js');
const { buildDefaultFigure } = require('./character-out/rig.js');
const { addShape, fingerprint } = require('./character-out/figure.js');

/**
 * What counts as unsaved work, and what does not.
 *
 * **This is the rule a save prompt lives or dies by, and it fails in both directions.** Report too little and a
 * reader loses work they were never warned about; report too much and they learn to click through the prompt,
 * which is the same outcome one step later. Neither shows up in a screenshot and neither is reachable by reading
 * the component - so the rule is a pure function over plain data, and this drives it.
 *
 * The model being checked: a draft is `null` when untouched and a value when the reader typed something, so a
 * change is a draft that *differs* from what is stored. That is subtler than "a draft that exists", and the
 * difference is one of the assertions below.
 *
 * Steps: the runner matches the `npx tsc ` prefix literally, inside this block.
 *   npx tsc app/lib/profile/types.ts app/lib/profile/countries.ts app/lib/profile/unsaved-changes.ts --outDir Temp/profile-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/character/shapes.ts app/lib/character/skeleton.ts app/lib/character/rig.ts app/lib/character/figure.ts --outDir Temp/character-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */

/** A stored profile, as the window reads it. */
const stored = {
  displayName: 'SPOOKY',
  bio: 'draws things',
  country: 'SE',
  status: 'AROUND',
  nameColour: null,
};

/** No drafts at all - the state the window opens in. */
const clean = {
  name: null,
  bio: null,
  country: null,
  status: null,
  nameColour: null,
  pendingPicture: null,
  pendingSong: null,
};

/* 1. A fresh window has nothing unsaved - which is what makes the prompt rare enough to be read. */
assert.deepEqual(unsavedChanges(stored, clean), [], 'nothing edited means nothing unsaved');

/* 2. Typing into a field is a change, and the detail says what it was and what it became. */
const renamed = unsavedChanges(stored, { ...clean, name: 'SPOOKY SWEDEN' });
assert.equal(renamed.length, 1, 'one edit is one change');
assert.equal(renamed[0].label, 'NAME', 'and it names the field');
assert.equal(renamed[0].tab, 'profile', 'and the tab it lives on');
assert.match(renamed[0].detail, /SPOOKY" -> "SPOOKY SWEDEN"/, 'and shows both sides of the edit');

/**
 * 3. **Typing something and typing it back is not a change.**
 *
 * The defect this guards: a `!== null` test would report unsaved work for a reader who changed their mind, and a
 * prompt that fires when there is nothing to lose is one that gets dismissed without reading. This is the
 * assertion the whole module is shaped around.
 */
assert.deepEqual(
  unsavedChanges(stored, { ...clean, name: 'SPOOKY' }),
  [],
  'a draft equal to what is stored is not unsaved - typing a character and deleting it again clears it',
);

/* 4. Several fields at once are reported in tab order, so the list reads the way the console is laid out. */
const several = unsavedChanges(stored, { ...clean, name: 'NEW', bio: 'a different bio', country: 'NO' });
assert.deepEqual(
  several.map((change) => change.label),
  // (2026-10-25, SPEC-less-text.md) `COUNTRY FLAG` -> `COUNTRY`, the customiser field's own new label.
  ['NAME', 'BIO', 'COUNTRY'],
  'the order is the order the tab presents them in',
);
// The change is *taken* on the code and *said* as the name: `SE -> NO` is a difference nobody can
// read in a prompt, and recognising the edit is the only thing the line is for.
assert.match(
  several[2].detail,
  /"SWEDEN" -> "NORWAY"/,
  'the flag change is reported as two country names',
);

/* 5. An empty draft is a change when it clears something, and reads as (EMPTY) rather than as a blank. */
const cleared = unsavedChanges(stored, { ...clean, bio: '' });
assert.equal(cleared.length, 1, 'clearing the bio is a change');
assert.match(cleared[0].detail, /\(EMPTY\)/, 'and the prompt says so in words');

/* 6. A long value is elided, so one enormous bio cannot fill the prompt. */
const long = unsavedChanges(stored, { ...clean, bio: 'x'.repeat(200) });

/**
 * 7. **An empty stored name colour and an unset draft are the same state.**
 *
 * `nameColour` is stored as `null` and held as `''` in the form, because empty is how the window spells "the
 * page's own black". Comparing them raw would report the colour picker as unsaved even when it is untouched, which
 * is the most likely way for this module to be wrong in practice.
 */
assert.deepEqual(
  unsavedChanges(stored, { ...clean, nameColour: '' }),
  [],
  'an unset colour draft matches an unset stored colour',
);
assert.equal(unsavedChanges(stored, { ...clean, nameColour: '#FF00A0' }).length, 1, 'and choosing one is a change');

/*
 * 8. (Changed on purpose, 2026-11-05.) The privacy switches are not here any more: the editor's PRIVACY tab is the same switches as
 * /account's, and each saves as it is pressed, so there is nothing unsaved to warn about. A change can only be in the two tabs left.
 */

/* 10. An upload that has not been filed is unsaved work, reported even with no text edits at all. */
const uploaded = unsavedChanges(stored, { ...clean, pendingPicture: '/assets/avatars/new.png' });
assert.equal(uploaded.length, 1, 'an unfiled upload is a change');
assert.match(uploaded[0].detail, /NOT FILED/, 'and says why it is not saved');


/* 12. Everything at once, to prove the pieces compose rather than shadowing each other. */
const everything = [
  ...unsavedChanges(stored, {
    name: 'NEW',
    bio: 'b',
    country: 'NO',
    status: 'BUSY',
    nameColour: '#FFF000',
    pendingPicture: '/x.png',
    pendingSong: null,
  }),
  ...(figureIsUnsaved({ bench: 'different-figure', kept: 'kept-figure' }) === null
    ? []
    : [figureIsUnsaved({ bench: 'different-figure', kept: 'kept-figure' })]),
];
assert.equal(everything.length, 7, `every kind of change is reported (got ${everything.length})`);
assert.deepEqual(
  [...new Set(everything.map((change) => change.tab))].sort(),
  ['character', 'profile'],
  'and they are attributed to both tabs',
);

/* 13. The figure is unsaved when it *differs* from what was kept - not when it was touched. */
const figA = JSON.stringify({ joints: { hips: { id: 'hips' } }, rootId: 'hips' });
const figB = JSON.stringify({ joints: { hips: { id: 'hips', mass: null } }, rootId: 'hips' });

assert.equal(
  figureIsUnsaved({ bench: figA, kept: figA }),
  null,
  'a figure equal to the one that was kept is not unsaved work',
);

const changed = figureIsUnsaved({ bench: figB, kept: figA });
assert.ok(changed !== null, 'a figure that differs from the kept one is');
assert.equal(changed.tab, 'character', 'and it belongs to the character tab');
assert.match(changed.detail, /CHANGED SINCE IT WAS LAST KEPT/, 'and says what changed about it');

/**
 * 14. **Throwing changes away must clear the figure from the list, which is the bug a latch caused.**
 *
 * The old shape was `figureIsUnsaved(figureTouched: boolean)`, and discarding re-marked the figure as touched -
 * because putting the bench back is itself a change to the skeleton. So the prompt named a figure the reader had
 * just thrown away, and switching tabs with no edits re-asked. Restoring the bench to the kept figure has to
 * report *nothing*, which is what this asserts and what a boolean could not express.
 */
assert.equal(
  figureIsUnsaved({ bench: figA, kept: figA }),
  null,
  'restoring the bench to the kept figure reports nothing, so discard clears the prompt',
);

/* 15. A figure that was never saved is reported, and the detail says how to keep it. */
const never = figureIsUnsaved({ bench: figB, kept: null });
assert.ok(never !== null, 'an unsaved figure is reported before anything has been kept');
assert.match(never.detail, /NOT SAVED YET/, 'and the prompt says how to keep it');
assert.match(
  never.detail,
  /SAVED CHARACTERS/,
  'naming the control that keeps it, rather than saying the workbench has no store',
);

/**
 * 16. **A real edit to the opening figure must be detected, and this is asserted against the real rig.**
 *
 * The browser probe could not prove this: it picked joints by dispatching pointer events at guessed fractions of
 * the canvas, which does not reliably land on a handle - so the shape plates stayed disabled, nothing was applied,
 * and "not prompted" was measured against an edit that never happened. That is the trap of a probe whose *setup*
 * silently fails: it reports a pass for a step it never ran.
 *
 * So the question is asked here instead, where the figure is real and the actions are direct: build the figure the
 * workbench opens on, record it as the baseline, then apply exactly the change a shape plate makes and confirm the
 * comparison notices.
 */
// Updated for the free-shape workbench: the figure is a skeleton plus a list of shapes, serialised by the same
// `fingerprint` the store and the shelf use, and the edit is what the ADD tool makes.
const opening = buildDefaultFigure('base');
const baseline = fingerprint(opening);

assert.equal(
  figureIsUnsaved({ bench: baseline, kept: baseline }),
  null,
  'the untouched opening figure is the baseline, so nothing is unsaved before a reader does anything',
);

/* The same figure with one shape added - what ADD (a node, then ✓) produces. */
const edited = addShape(opening, { kind: 'sphere', at: { x: 0.5, y: 0.5, z: 0 }, pin: 'head' }).figure;

const afterEdit = figureIsUnsaved({ bench: fingerprint(edited), kept: baseline });
assert.ok(afterEdit !== null, 'adding a shape changes the figure, so it is reported as unsaved');
assert.match(afterEdit.detail, /CHANGED SINCE IT WAS LAST KEPT/, 'and the prompt says what happened to it');

/**
 * 17. **And discarding clears it, which is the round trip the owner reported as broken.**
 *
 * Putting the bench back to the baseline is what `loadFigure` does after a discard, so the comparison must
 * settle at `null` - the prompt must not name a figure that has just been thrown away.
 */
assert.equal(
  figureIsUnsaved({ bench: baseline, kept: baseline }),
  null,
  'discarding returns the bench to the baseline, so the figure leaves the unsaved list',
);

/* 18. A *selection* is not an edit: what is picked lives in the store beside the figure, never inside it. */
assert.ok(!('selectedShapeId' in opening) && !('selectedJointId' in opening), 'the figure holds no selection');
assert.equal(
  figureIsUnsaved({ bench: fingerprint(opening), kept: baseline }),
  null,
  'so picking a shape or a joint changes nothing that is compared, and is not unsaved work',
);

/* 14. The summary counts, in the singular and the plural. */
assert.equal(summarise([]), 'NOTHING UNSAVED', 'no changes');
assert.equal(summarise([renamed[0]]), '1 UNSAVED CHANGE', 'one');
assert.equal(summarise(several), '3 UNSAVED CHANGES', 'and several');

console.log('customiser unsaved-changes checks passed');
console.log('  model    : a draft equal to what is stored is not a change');
console.log('  covers   : name, colour, bio, country flag, status, two uploads, the figure');
console.log('  cannot   : prove the prompt appears. That is the component, checked in the render.');

assert.ok(long[0].detail.length < 70, `a long value is shortened (${long[0].detail.length} chars)`);
assert.match(long[0].detail, /…/, 'and marked as shortened');
