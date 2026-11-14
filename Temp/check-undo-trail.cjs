/*
 * The undo trail behind the top bar's arrows (Luke, 2026-11-14: "make the back button in the top left not only go back on to the last
 * page you were on but act like a general undo button, for every function such as expanding even, with the other button acting in
 * reverse"). The trail's own rules, with no browser: the order of steps, redo, what a new step does to redo, the limit, stepping past
 * what is gone, and never pretending to undo what was sent. The browser's side is driven by Temp/browse drives, locally.
 *   npx tsc app/lib/ui/undo-trail.ts app/lib/ui/window-slot.ts --rootDir app --outDir Temp/undo-trail-out --module commonjs --target es2021 --lib es2021,dom,dom.iterable --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTrail, trailWords, pageWords, SENT_NOTICE, TRAIL_LIMIT, windowSlotChanged } = require('./undo-trail-out/lib/ui/undo-trail.js');
const { createWindowSlot } = require('./undo-trail-out/lib/ui/window-slot.js');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

/** A thing that can be open or shut, and a step that opens it. `gone` makes it vanish from the page. */
function fold(name) {
  const thing = { open: false, gone: false };
  const set = (open) => () => {
    if (thing.gone || thing.open === open) return 'gone';
    thing.open = open;
    return 'done';
  };
  const opened = () => {
    thing.open = true;
    return { kind: 'view', undoWords: `CLOSE ${name}`, redoWords: `OPEN ${name}`, undo: set(false), redo: set(true) };
  };
  return { thing, opened };
}

// 1. Steps are undone newest first, and redone in the order they were undone.
const trail = createTrail();
assert.deepEqual(trail.state(), { steps: 0, undoWords: null, undoKind: null, redoWords: null, redoKind: null, notice: null }, 'an empty trail has nothing to say');
const filters = fold('FILTERS');
const thread = fold('THREAD');
let told = 0;
trail.subscribe(() => { told += 1; });
trail.record(filters.opened());
trail.record(thread.opened());
assert.equal(told, 2, 'whoever draws the arrows is told of each step');
assert.equal(trail.state().undoWords, 'CLOSE THREAD', 'the arrow says what the next undo will do');
assert.equal(trail.state().redoWords, null, 'and there is nothing to redo yet');
assert.equal(trail.undo(), true);
assert.equal(thread.thing.open, false, 'the newest step is undone first');
assert.equal(filters.thing.open, true, 'and only that one');
assert.equal(trail.state().undoWords, 'CLOSE FILTERS');
assert.equal(trail.state().redoWords, 'OPEN THREAD', 'the other arrow says what redo will do');
assert.equal(trail.undo(), true);
assert.equal(filters.thing.open, false);
assert.equal(trail.state().steps, 0, 'nothing left to undo');
assert.equal(trail.undo(), false, 'and a press then does nothing');
assert.equal(trail.redo(), true);
assert.equal(filters.thing.open, true, 'redo goes back the other way, oldest undone last');
assert.equal(trail.redo(), true);
assert.equal(thread.thing.open, true);
assert.equal(trail.redo(), false, 'and stops when everything is done again');

// 2. A new step after an undo clears what could have been redone, as an editor does.
trail.undo();
assert.equal(trail.state().redoWords, 'OPEN THREAD');
const comms = fold('COMMS');
trail.record(comms.opened());
assert.equal(trail.state().redoWords, null, 'a new step clears the redo side');
assert.equal(trail.redo(), false);
assert.equal(thread.thing.open, false, 'so the undone thread stays folded');

// 3. A control that has gone from the page, or is already the way undo would leave it, is stepped past: the press undoes the thing before.
const a = fold('A');
const b = fold('B');
const c = fold('C');
const skipping = createTrail();
skipping.record(a.opened());
skipping.record(b.opened());
skipping.record(c.opened());
c.thing.gone = true;
b.thing.open = false;
assert.equal(skipping.undo(), true, 'one press');
assert.equal(a.thing.open, false, 'steps past the two that cannot be undone and undoes the one that can');
assert.equal(skipping.state().steps, 0);
assert.equal(skipping.state().redoWords, 'OPEN A', 'and only what was really undone can be redone');

// 4. What was sent is never undone, and never pretended: one line, and the press goes on to the thing before.
const sending = createTrail();
const menu = fold('MENU');
sending.record(menu.opened());
sending.record({ kind: 'sent', undoWords: SENT_NOTICE, redoWords: SENT_NOTICE, undo: () => { throw new Error('a sent step must never be run'); }, redo: () => { throw new Error('nor redone'); } });
assert.equal(sending.state().steps, 2);
assert.equal(sending.state().undoWords, null, 'the arrow does not promise to undo a sent thing');
assert.equal(sending.undo(), true, 'the press still undoes something: the thing before');
assert.equal(menu.thing.open, false);
assert.equal(sending.state().notice, "CAN'T UNDO: SENT", 'and says so in one line');
assert.equal(sending.state().redoWords, 'OPEN MENU', 'the sent thing is not on the redo side either');
sending.clearNotice();
assert.equal(sending.state().notice, null, 'the line goes away');
const onlySent = createTrail();
onlySent.record({ kind: 'sent', undoWords: SENT_NOTICE, redoWords: SENT_NOTICE, undo: () => 'gone', redo: () => 'gone' });
assert.equal(onlySent.undo(), false, 'with nothing before it, nothing is undone');
assert.equal(onlySent.state().notice, SENT_NOTICE, 'and the reader is told why');
assert.equal(onlySent.state().steps, 0);

// 5. Pages are steps like any other, named as back and forward.
const pages = createTrail();
let at = '/forum';
pages.record({ kind: 'page', undoWords: `BACK TO ${pageWords('/media?q=dune')}`, redoWords: `FORWARD TO ${pageWords('/forum')}`, undo: () => { at = '/media'; return 'done'; }, redo: () => { at = '/forum'; return 'done'; } });
assert.equal(pages.state().undoWords, 'BACK TO MEDIA');
assert.equal(pages.state().undoKind, 'page', 'so the arrow can keep its plain name, Back');
pages.undo();
assert.equal(at, '/media');
assert.equal(pages.state().redoWords, 'FORWARD TO FORUM');
// Going back by the browser's own key: the trail forgets back through its newest page step, so it never undoes things on a page left behind.
const mixed = createTrail();
const one = fold('ONE');
const two = fold('TWO');
mixed.record(one.opened());
mixed.record({ kind: 'page', undoWords: 'BACK TO MEDIA', redoWords: 'FORWARD TO FORUM', undo: () => 'done', redo: () => 'done' });
mixed.record(two.opened());
mixed.wentBackOutside();
assert.equal(mixed.state().steps, 1, 'the page step and what came after it are forgotten');
assert.equal(mixed.state().undoWords, 'CLOSE ONE', 'what was done on the page gone back to is still there to undo');
assert.equal(mixed.state().redoWords, null);

// 6. The trail has a length: the oldest steps fall off the far end.
assert.equal(TRAIL_LIMIT, 100);
const long = createTrail(3);
const folds = ['P', 'Q', 'R', 'S'].map(fold);
for (const each of folds) long.record(each.opened());
assert.equal(long.state().steps, 3, 'no longer than its limit');
long.undo();
long.undo();
long.undo();
assert.equal(long.undo(), false);
assert.equal(folds[0].thing.open, true, 'the oldest step fell off, so it is not undone');

// 7. Names: a control's words become a few plain capitals, the same whichever way the control is drawn.
assert.equal(trailWords('[ + FILTERS ]'), 'FILTERS');
assert.equal(trailWords('[ − FILTERS ]'), 'FILTERS', 'open or shut, the same name, so the control can be found again');
assert.equal(trailWords('[ COMMS ] ▾'), 'COMMS');
assert.equal(trailWords('About pins'), 'ABOUT PINS');
assert.equal(trailWords('[+] STREAM :: TEST ACCOUNT A :: 2026-11-14 0 REPLIES and a great deal more'), 'STREAM TEST ACCOUNT A', 'a long row is cut at a word');
assert.equal(trailWords('▾'), 'THIS', 'a bare mark still has something to be called');
assert.equal(pageWords('/'), 'HOME');
assert.equal(pageWords('/profile/abc?x=1'), 'PROFILE');

// 8. A window's store tells the trail, but nothing is recorded where there is no browser listening (the server, this check).
const slot = createWindowSlot({ open: false });
slot.set({ open: true });
assert.deepEqual(slot.state(), { open: true }, 'the store still works as before');
assert.doesNotThrow(() => windowSlotChanged({ open: false }, { open: true }, () => undefined));

// 9. The rules the browser's side keeps, read from the source.
const source = read('app/lib/ui/undo-trail.ts');
assert.match(source, /const TOGGLES = 'button\[aria-expanded\], \[role="button"\]\[aria-expanded\], summary';/, 'every fold on the site is seen by one listener, by what the markup says');
assert.match(source, /form\.getAttribute\('role'\) === 'search'/, "a search box's form is not a send");
assert.match(source, /if \(way === null \|\| typingIn\(event\.target\)\) return;/, "Ctrl+Z in a text box is left to the browser");
assert.match(source, /event\.defaultPrevented \|\| document\.querySelector\(OWN_UNDO\) !== null/, 'and a tool with its own undo keeps the key');
assert.match(source, /if \(inRoom\(before\) \|\| inRoom\(after\)\) return;/, "a stream room's window is never put back by the arrows");
assert.match(source, /whileReplaying\(\(\) => found\.click\(\)\)/, 'undo presses the same control again, so a window that asks before closing still asks');
const arrows = read('app/components/SiteArrows.tsx');
assert.match(arrows, /useEffect\(\(\) => startUndoTrail\(\), \[\]\)/, 'the arrows start the listening');
assert.match(arrows, /undoes \? undoStep\(\) : goSiteHistory\(-1\)/, "with nothing in the trail they are the site's back and forward, as before");
assert.match(arrows, /disabled=\{!undoes && !back\}/, 'and each goes quiet when it has nothing to do');
assert.match(arrows, /role="status"/, 'the one-line notice is read out');
assert.match(read('app/lib/ui/window-slot.ts'), /windowSlotChanged\(before, next,/, 'the window store tells the trail');

console.log('undo trail: newest first, redo in reverse, a new step clears redo, gone steps and sent things stepped past, 100 long: OK');
