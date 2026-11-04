/**
 * The queue window, held where it can fail.
 *
 * Steps (above the fold, because `run-checks.cjs` only reads the first 20 lines for these):
 *   npx tsc app/lib/audio/broadcast.ts app/lib/audio/track-context.ts app/lib/audio/follow.ts app/lib/audio/heartbeat.ts app/lib/audio/loops.ts app/lib/audio/queue-window.ts app/lib/audio/tracks.ts app/lib/audio/repository.ts app/lib/audio/library.ts app/lib/audio/tags.ts app/lib/audio/catalogue.ts app/lib/audio/archive-tree.ts app/lib/audio/mock-music-repository.ts --outDir Temp/queue-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/QueueWindow.tsx app/components/QueueBrowser.tsx app/components/RadioLoops.tsx app/components/LoopPopout.tsx app/components/QueueProfilePopout.tsx app/components/BroadcastHeartbeat.tsx app/components/QueueFollower.tsx --outDir Temp/queue-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *
 * What it holds, and why each one is worth holding:
 *
 *   1. **A window is a slot, not a provider** - opening it must not re-render the board, the fault
 *      `check-preferences.cjs` names.
 *   2. **The tab strip keeps its shape** - the third tab exists *because* the brief asked for three, so a
 *      check that let it be deleted would let the strip go back to two cells and move.
 *   3. **Following a queue keeps what it displaced** - the save has to happen *before* the play. Written
 *      the other way round it records the host's track as the loop, which is the exact inverse of the
 *      thing, and it reads as correct in a diff.
 *   4. **The window is drawn once by the shell and nowhere else** - a page that subscribed to it would
 *      re-render the board when a tab changed.
 *   5. **A recent is one plate per track, a loop is one per place** - the quick-access identity split.
 *      Written the other way round, a three-minute listen leaves 180 plates of one song in the grid.
 *   6. **A broadcast keeps moving** - the heartbeat is faster than the staleness window that would call
 *      it dead, or every queue silently reads SILENT.
 *   7. **A queue belongs to one account** - the mock used to hand back whoever wrote last.
 *   8. **The icon is the button, the caption escapes the scroller, and the globe has a real address.**
 *
 * The behavioural ones are asserted against the modules rather than against a string in a template,
 * because a source read cannot tell a call that is *made* from one that is merely written down (CLAUDE.md).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const slot = require('./queue-out/audio/queue-window.js');
const QueueWindow = require('./queue-render/components/QueueWindow.js').default;
const QueueBrowser = require('./queue-render/components/QueueBrowser.js').default;
const RadioLoops = require('./queue-render/components/RadioLoops.js').default;
const LoopPopout = require('./queue-render/components/LoopPopout.js').default;
const QueueProfilePopout = require('./queue-render/components/QueueProfilePopout.js').default;
const BroadcastHeartbeat = require('./queue-render/components/BroadcastHeartbeat.js').default;
const QueueFollower = require('./queue-render/components/QueueFollower.js').default;

const windowText = fs.readFileSync('app/components/QueueWindow.tsx', 'utf8');
const browserText = fs.readFileSync('app/components/QueueBrowser.tsx', 'utf8');
const loopsText = fs.readFileSync('app/components/RadioLoops.tsx', 'utf8');
const popoutText = fs.readFileSync('app/components/QueueProfilePopout.tsx', 'utf8');
const slotText = fs.readFileSync('app/lib/audio/queue-window.ts', 'utf8');
const layout = fs.readFileSync('app/layout.tsx', 'utf8');
const sidebar = fs.readFileSync('app/components/DesktopSidebar.tsx', 'utf8');
const bar = fs.readFileSync('app/components/MusicPlayer.tsx', 'utf8');

/* 1. Every new component renders, so the structure walk can reach it. */
for (const [name, component] of [
  ['QueueWindow', QueueWindow],
  ['QueueBrowser', QueueBrowser],
  ['RadioLoops', RadioLoops],
  ['LoopPopout', LoopPopout],
  ['QueueProfilePopout', QueueProfilePopout],
  ['BroadcastHeartbeat', BroadcastHeartbeat],
  ['QueueFollower', QueueFollower],
]) {
  assert.equal(typeof component, 'function', `${name} renders as a component, not a bare string`);
}

/* 2. The slot, and no provider - a window that opens cannot touch the board. */
assert.equal(typeof slot.queueWindowState, 'function', 'the window has a state reader');
assert.equal(typeof slot.subscribeToQueueWindow, 'function', 'and hands out a subscription');
assert.equal(typeof slot.openQueues, 'function', 'and an opener');
assert.equal(typeof slot.closeQueues, 'function', 'and a closer');
assert.equal(typeof slot.toggleQueues, 'function', 'and a toggle');
assert.equal(slot.queueWindowState().open, false, 'it starts shut, so nothing is open on load');

slot.toggleQueues();
assert.equal(slot.queueWindowState().open, true, 'a press opens it');
slot.toggleQueues();
assert.equal(slot.queueWindowState().open, false, 'and a second press shuts what the first opened');

assert.match(slotText, /createWindowSlot</, 'the state is a module-level slot');
assert.doesNotMatch(slotText, /useContext|createContext/, 'and not a context');

/* 3. The address: tabs named, a default for the rest, and the query spent when the window shuts. */
assert.equal(slot.QUEUES_HREF, '/forum?queues=1', 'the window is addressed on the board');
assert.equal(slot.queuesRequested('?queues=1'), true, 'that address asks for it');
assert.equal(slot.queuesRequested('?music=1'), false, 'a query about anything else does not');
assert.equal(slot.queueTabRequested('?queues=queues'), 'queues', 'queues names the list tab');
assert.equal(slot.queueTabRequested('?queues=third'), 'third', 'third names the empty one');
assert.equal(slot.queueTabRequested('?queues=1'), 'radio', 'and anything else is the default');
assert.equal(slot.queuesAddressSpentByClose('?queues=1'), true, 'shutting spends the address');
assert.equal(slot.queuesAddressSpentByClose('?music=1'), false, 'and leaves other addresses alone');
assert.match(windowText, /router\.replace\(pathname\)/, 'which the window really does');

/* 4. Two tabs, drawn as equal cells. */
// (2026-10-23, SPEC-efficiency.md) The MIXTAPES tab - a `NOT BUILT YET` placeholder - is cut until it is built; an
// address that still asks for the third tab (`?queues=third`) lands on RADI-OH instead.
assert.match(windowText, /<QueueTabPlate label="RADI-OH"/, 'the strip has a RADI-OH tab');
assert.match(windowText, /<QueueTabPlate label="QUEUES"/, 'a QUEUES tab');
assert.doesNotMatch(windowText, /<QueueTabPlate label="MIXTAPES"/, 'and no tab for a screen that is not built');
assert.match(windowText, /role="tablist"/, 'the strip is a tablist to a screen reader');
assert.match(windowText, /role="tab"/, 'with real tabs in it');
assert.match(windowText, /flex-1/, 'and the tabs share the width rather than sizing to their words');

// (2026-10-23, SPEC-efficiency.md) (see above) No placeholder screen either.
assert.doesNotMatch(windowText, /IS NOT BUILT YET/, 'and no placeholder screen saying it is unbuilt');

/* 6. Following a queue keeps what it displaced, and saves it *before* it plays the host's track.
 *
 * This is the one ordering this file exists for, and it is asserted by *reading the two statements'
 * positions* rather than by their presence - both orders contain both calls, so a check that only looked
 * for `saveLoop` would pass on the version that loses the reader's listening.
 *
 * Matched on the call's *name* rather than on a full line, because the play grew an argument (the origin
 * the globe opens) and a check pinned to `player.play(track)` then failed for a reason unrelated to the
 * order it was guarding. A check that breaks when unrelated code changes is a check that teaches you to
 * ignore it, which is the lesson `run-checks.cjs` already carries.
 */
const saveAt = popoutText.indexOf('saveLoop({');
const playAt = popoutText.search(/player\.play\(\s*track/);

assert.ok(saveAt > 0, 'following a queue saves a loop');
assert.ok(playAt > saveAt, 'and saves it BEFORE it plays the host`s track, or it records the wrong thing');

assert.match(popoutText, /kind: 'taken-over'/, 'the loop is marked as displaced rather than chosen');
assert.match(popoutText, /displacedBy:/, 'and names whose queue did the displacing');
assert.match(popoutText, /player\.elapsed/, 'the loop keeps where the reader actually was');
assert.match(popoutText, /CATCH UP/, 'the card offers a catch-up');
assert.match(popoutText, /SKIP AHEAD/, 'and a skip-ahead');
// The speed moved out of the card on 2026-10-12, deliberately: it lived in the card, so closing the card
// dropped a catch-up back to 1x halfway. The follower is drawn by the shell and owns it now.
const followerText = fs.readFileSync('app/components/QueueFollower.tsx', 'utf8');

assert.match(followerText, /setPlaybackRate\(step\.rate\)/, 'catch-up really sets a speed on the shared player');
assert.match(popoutText, /player\.setPlaybackRate\(1\)/, 'and UNFOLLOW hands it back to normal');
assert.doesNotMatch(popoutText, /setInterval/, 'the card no longer steers anything on a timer');
assert.match(popoutText, /follow: true/, 'the card`s play is marked as the follower`s, so it does not end the follow');

// The rate has to go back when a follow ends: it is player state, so a follow that ended at 1.6x would
// leave every later track - a profile's song, the shelf - running fast for no visible reason.
assert.match(followerText, /return \(\) => setRate\(1\)/, 'and ending a follow puts the player back to normal speed');
// (2026-11-04, SPEC-music-queues.md, commit f2613e8) A music broadcast is a room now and "the old broadcast heartbeat and
// follower retire": following somebody is joining their room, and the room window keeps it going. So the shell must not
// draw the old follower beside the new room (two things would steer one player), and it draws the keeper that reopens yours.
assert.doesNotMatch(layout0(), /<QueueFollower \/>/, 'the retired follower is not drawn alongside the rooms');
assert.match(layout0(), /<MusicRoomKeeper \/>/, 'the shell draws the keeper, so a reload does not lose a public room');

function layout0() {
  return fs.readFileSync('app/layout.tsx', 'utf8');
}

/* 7. The window is a DockWindow, and the board behind it is never covered. */
assert.match(windowText, /<DockWindow/, 'the queue window docks beside the feed');
assert.doesNotMatch(windowText, /<PopoutWindow/, 'it is not a screen-taking dialogue');
assert.match(windowText, /useSyncExternalStore\(/, 'the window reads its own slot');
assert.match(windowText, /if \(!state\.open\) return null/, 'and draws nothing at all while it is shut');

/* 8. Drawn once by the shell, and reachable from the panel and the bar. */
assert.match(layout, /<QueueWindow \/>/, 'the shell draws it once');
assert.match(layout, /<Suspense fallback=\{null\}>[\s\S]*<QueueWindow \/>/, 'behind the boundary, because it reads the address');

// Every page that draws the window must not subscribe to it - a page that did would re-render when a tab
// changed. The three files that may are the window itself, the panel's key and the bar's key.
assert.match(sidebar, /toggleQueues/, 'the side panel has the key');
assert.match(sidebar, /SIDE_QUEUES/, 'wearing the same mark and word the bar wears');
assert.match(bar, /toggleQueues/, 'the player bar has it too');
assert.match(bar, /SIDE_QUEUES\.mark/, 'drawn from SIDE_QUEUES rather than respelled');

/* 5. RADI-OH: a loop is a *place*, and the store really keeps one. */
const loops = require('./queue-out/audio/loops.js');

loops.clearAllLoops();
assert.deepEqual(loops.loopState(), [], 'the tab starts with nothing saved');

const shelf = [
  { id: 'a', title: 'ALPHA', src: '/one.mp3', artist: 'X' },
  { id: 'b', title: 'BETA', src: '/two.mp3', artist: 'Y' },
];

loops.saveLoop({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 42, kind: 'own' });
assert.equal(loops.loopState().length, 1, 'saving one keeps one');
assert.equal(loops.loopState()[0].positionSeconds, 42, 'and keeps where in the track it points');
assert.equal(loops.loopLabel(loops.loopState()[0], shelf), 'ALPHA', 'whose label resolves against the shelf');

// The label has to survive the track being taken off the shelf, because a loop is exactly the thing you
// keep for later - and "later" is when the archive has moved on. It stays *readable* and says plainly
// that the file it points at is gone, rather than resolving to a blank plate.
assert.equal(
  loops.loopLabel(loops.loopState()[0], []),
  'ALPHA (NOT ON THE SHELF)',
  'a loop whose track is gone still reads, and says the track is gone',
);

/* 5b. Quick access: one plate per TRACK, whatever you do to it.
 *
 * This is the assertion the whole quick-access change turns on. A recent keyed by *place* - the old
 * behaviour - would leave a plate per second listened to, and a three-minute track would fill the grid
 * with 180 copies of itself. A recent keyed by track updates one plate in place, which is what "previously
 * listening to" means.
 */
loops.clearAllLoops();

const first = loops.rememberPlay({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 0, origin: 'shelf' });
assert.equal(loops.loopState().length, 1, 'playing a track puts one plate in the grid');
assert.equal(first.plays, 1, 'and counts the first play');

// Twelve writes, as a listener would make over a minute of listening.
for (let second = 5; second <= 60; second += 5) {
  loops.rememberPlay({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: second, origin: 'shelf' });
}

assert.equal(loops.loopState().length, 1, 'and listening to it for a minute still leaves exactly ONE plate');
assert.equal(loops.loopState()[0].positionSeconds, 60, 'whose position follows you as you listen');
assert.equal(loops.loopState()[0].plays, 1, 'with the count still at one, because the track never changed');

// A second track is a second plate, and a second *play* of the first.
loops.rememberPlay({ label: 'BETA', trackId: '/two.mp3', positionSeconds: 3, origin: 'profile' });
assert.equal(loops.loopState().length, 2, 'another track is another plate');
assert.equal(loops.loopState()[0].trackId, '/two.mp3', 'and the newest is first');
assert.equal(loops.loopState()[0].origin, 'profile', 'carrying where it came from, which is its icon');

loops.rememberPlay({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 90, origin: 'shelf' });
assert.equal(loops.loopState().length, 2, 'going back to the first track does not add a third plate');
assert.equal(loops.loopState()[0].trackId, '/one.mp3', 'it moves back to the front');
assert.equal(loops.loopState()[0].plays, 2, 'and its play count says you returned to it');

// A deliberate *loop* is a place, and two places in one track are two plates - the other half of the split.
loops.saveLoop({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 30, kind: 'own' });
loops.saveLoop({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 45, kind: 'own' });
assert.equal(loops.loopState().length, 4, 'two deliberate places in one track are two plates');
assert.notEqual(
  loops.placeId('/one.mp3', 30),
  loops.placeId('/one.mp3', 45),
  'because a place is the track AND the second',
);
assert.notEqual(loops.placeId('/one.mp3', 30), loops.recentId('/one.mp3'), 'and a place is not a recent');

// The icons: three kinds of thing have to be tellable apart, since nothing here draws a picture.
assert.notEqual(loops.originMark('profile'), loops.originMark('shelf'), 'a profile song reads differently');
assert.notEqual(loops.originMark('profile'), loops.originMark('queue'), 'and a broadcast differs too');
assert.match(
  loops.originLabel({ ...first, kind: 'taken-over', displacedBy: 'ab12' }),
  /TAKEN OVER BY AB12/,
  'a displacement says whose queue did it',
);
// (2026-10-25, SPEC-less-text.md) `PLAYED FROM THE MUSIC WINDOW` -> `FROM THE SHELF` (app/lib/audio/loops.ts).
assert.equal(loops.originLabel(first), 'FROM THE SHELF', 'and a shelf file says where it came from');

loops.clearAllLoops();
assert.deepEqual(loops.loopState(), [], 'and the whole grid clears');

/* 5c. The grid is icon-only, and the caption is what explains it.
 *
 * The brief: an entry is *an icon and nothing else* until it is expanded. Everything the grid withholds
 * has to be readable somewhere, so the two places are asserted together - a caption on hover, and the
 * pop-out on a press. An icon-only grid with neither is a grid of meaningless glyphs.
 */
const radioText = fs.readFileSync('app/components/RadioLoops.tsx', 'utf8');

// The resting cell: one glyph, and the glyph IS the button. No title, no clock, no origin line beside it.
assert.match(radioText, /loopFace\(loop\.origin, mood, takenOver\)/, 'the resting cell draws the face');
assert.match(
  radioText,
  // (2026-10-25, SPEC-less-text.md) `${label} - press to go back to where you were in it` -> `Resume ${label}`.
  /aria-label=\{`Resume \$\{label\}`\}/,
  'and whose accessible name is the track, because the icon alone says nothing to a screen reader',
);

/**
 * **The glyph is the ONLY thing the button renders - asserted by counting *text nodes*, not expressions.**
 *
 * A check that looked for `originMark` would pass just as happily on a cell that also drew the title, the
 * clock and the origin line beside it, because it would still find the mark. Counting *every* expression
 * is too blunt as well: a className is an expression and renders nothing, which is how the first version
 * of this assertion failed on a correct cell.
 *
 * So the JSX comments are stripped and the *rendered* children are counted - `{originMark(...)}` and
 * nothing else. `{label}`, `{formatClock(...)}` or a literal `<span>text</span>` each add one, which is
 * precisely the fault the brief corrected.
 */
function restingCellChildren() {
  const at = radioText.indexOf('aria-label={`Resume ${label}`}');
  assert.ok(at > 0, 'the resting cell is found by its accessible name');
  const from = radioText.indexOf('>', at);
  const to = radioText.indexOf('</button>', from);

  return radioText
    .slice(from + 1, to)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/className=(?:"[^"]*"|\{`[^`]*`\})/g, '')
    .replace(/aria-hidden="true"/g, '')
    .trim();
}

const cell = restingCellChildren();

assert.match(cell, /loopFace\(loop\.origin/, 'the face is what the resting cell renders');
assert.doesNotMatch(cell, /\{label\}/, 'and the title is NOT - the cell is an icon, not a plate with an icon on it');
assert.doesNotMatch(cell, /formatClock/, 'no clock on the resting cell');
assert.doesNotMatch(cell, /originLabel/, 'and no origin line either');
assert.equal(
  cell.replace(/\s+/g, '').match(/\{[^}]*\}/g)?.length ?? 0,
  1,
  'exactly one thing renders in the resting cell, and it is the face',
);

/* 5c-2. The details strip replaced the floating caption (owner's call, 2026-10-12).
 *
 * The caption waited a second, then floated over the window's foot and covered the CLEAR ALL row. What it
 * said now lives in a fixed strip left of CLEAR ALL, in the same format the player bar uses
 * (`TrackDetails`): the uploader's picture, what it was heard as part of, the name, and position out of
 * length. A fixed strip can answer at once - nothing floats, so nothing strobes - and it keeps the last
 * face pointed at, so its globe link is reachable.
 */
assert.doesNotMatch(radioText, /createPortal/, 'the floating caption is gone');
assert.doesNotMatch(radioText, /CAPTION_DELAY_MS|setTimeout/, 'and so is its wait');
assert.match(radioText, /data-details="loop"/, 'the strip is there instead');
assert.match(radioText, /<TrackDetails/, 'in the shared details format');
assert.match(radioText, /onPointerEnter=\{onPoint\}/, 'pointing at a face shows it in the strip');
assert.match(radioText, /loops\.find\(\(loop\) => loop\.id === pointedId\)/, 'the strip keeps the last face pointed at');
{
  const row = radioText.slice(radioText.indexOf('data-details="loop"') - 200, radioText.lastIndexOf('[ CLEAR ALL ]'));
  assert.match(row, /flex-1/, 'the strip takes the space left of CLEAR ALL');
}
const detailsText = fs.readFileSync('app/components/TrackDetails.tsx', 'utf8');
assert.match(detailsText, /uploaderIdFromSrc/, 'the picture is the uploader`s, read from the file`s address');
assert.match(detailsText, /&nbsp;/, 'an empty context line still holds its height, so the strip never changes size');
assert.match(
  fs.readFileSync('app/components/MusicPlayer.tsx', 'utf8'),
  /<TrackDetails\s/,
  'the player bar uses the same format',
);

const context = require('./queue-out/audio/track-context.js');
assert.equal(
  context.uploaderIdFromSrc('https://x.supabase.co/storage/v1/object/public/mp3/640d9861-d8e4-402d-ab5f-db97bb4d88f1/song.mp3'),
  '640d9861-d8e4-402d-ab5f-db97bb4d88f1',
  'an upload names its uploader',
);
assert.equal(context.uploaderIdFromSrc('/assets/audio/theme.mp3'), null, 'a file that came with the site names nobody');
assert.equal(context.trackContext("SWEDEN'S QUEUE", 'HEXHAM/GRIDLOCK'), "SWEDEN'S QUEUE", 'what you pressed play inside comes first');
assert.equal(context.trackContext(undefined, 'HEXHAM/GRIDLOCK'), 'HEXHAM / GRIDLOCK', 'else the album or project folder');
assert.equal(context.trackContext(undefined, null), '', 'and a loose file has no context line');
assert.equal(context.lengthSeconds('5:12'), 312, 'a filed length reads as seconds');
assert.ok(Number.isNaN(context.lengthSeconds('')), 'and an unknown one as unknown');
loops.clearAllLoops();
loops.rememberPlay({ label: 'Q', trackId: '/q.mp3', positionSeconds: 0, originContext: "SWEDEN'S QUEUE", lengthSeconds: 190 });
loops.rememberPlay({ label: 'Q', trackId: '/q.mp3', positionSeconds: 5 });
assert.equal(loops.loopState()[0].originContext, undefined, 'a replay from somewhere with no context is no longer "in the queue"');
assert.equal(loops.loopState()[0].lengthSeconds, 190, 'but the length the player measured is kept');
loops.clearAllLoops();
assert.match(
  fs.readFileSync('app/components/MusicPlayerProvider.tsx', 'utf8'),
  /const recorded = heardFrom !== null && heardFrom\.src === source\.src \? heardFrom\.origin : null;/,
  'RADI-OH only files a track under the origin recorded for that same file, not the last press`s',
);
assert.doesNotMatch(radioText, /aria-live/, 'the strip is not a live region - its clock would be read aloud forever');

const globalsText = fs.readFileSync('app/globals.css', 'utf8');

assert.match(radioText, /animate-hop/, 'the face hops when pointed at');
assert.match(globalsText, /@keyframes hop/, 'with a hop the stylesheet defines');
assert.match(
  globalsText,
  /prefers-reduced-motion: reduce\) \{\s*\[class\*='animate-'\]/,
  'and the movement goes quiet when the reader asks it to',
);

// The pop-out is still the expansion.
assert.match(radioText, /<LoopPopout/, 'a press opens the window');
assert.match(radioText, /onClick=\{onOpen\}/, 'wired to the icon');

/* 5h. The fake catalogue is gone.
 *
 * The archive listed twenty invented releases - ten invented artists, sixty invented titles - and not one
 * of the files they pointed at existed. A shelf of rows waiting for files that were never made reads as
 * broken rather than as empty, and the owner asked for it out.
 */
const catalogue = fs.readFileSync('app/lib/projects/tracks.ts', 'utf8');

assert.match(catalogue, /const RELEASES: ReleaseSeed\[\] = \[\];/, 'the invented releases are gone');
assert.doesNotMatch(catalogue, /artist: '[A-Z]/, 'and no invented artist is left behind');
assert.doesNotMatch(catalogue, /title: '[A-Z]/, 'nor an invented title');
assert.match(catalogue, /export const TRACKS: Track\[\] = RELEASES\.flatMap/, 'the machinery stays, so a real file still plays');

/* 5e. The X is attached to the icon, and the icon IS the button.
 *
 * The owner's correction: the glyph is the control, so there must be no plate around it. This is asserted
 * by the *icon button's* own class list - a bordered, filled box with padding is the fault.
 */
assert.match(radioText, /-right-3 top-\[5px\] flex h-4 w-4/, 'the X sits on the face`s own top corner (no tile since 2026-10-12, so it drops to the face)');
assert.match(radioText, /bg-bubble-pale/, 'in the destructive red');
assert.doesNotMatch(radioText, /aspect-square/, 'the oversized square cell is gone');
assert.doesNotMatch(radioText, /py-2/, 'and so is the padding that made the box big');

/* 5f. The globe: a real link, only when there is somewhere true to go. */
assert.match(detailsText, /<Link href=\{href\}/, 'the details carry a link');
assert.match(radioText, /href=\{loop\.originHref\}/, 'pointing at the recorded origin');
assert.match(detailsText, /where === null \? null :/, 'and drawn only when an origin was recorded');

// The blue note: the shelf is the site's own music and wears its blue, and no two kinds read alike.
// "Its blue" is the *brand ink* rather than the Royal Blue dye named as an ink: the note is printed on
// the field, and the field moves with the theme, so the token that moves with it is the only one that
// can be legible on both (9.34:1 on the default field, 1.91:1 for the dye on the dark one).
assert.equal(loops.originMark('shelf'), '♪', 'a shelf entry wears a music note');

/* 5i. The faces: text-character art, the frame for where it came from, the eyes for the mood. */
const MOODS = ['rest', 'hover', 'press', 'scared', 'playing'];
for (const origin of ['shelf', 'profile', 'queue', 'own']) {
  const widths = new Set(MOODS.map((mood) => [...loops.loopFace(origin, mood)].length));
  assert.deepEqual([...widths], [7], `${origin}: every mood is the same seven characters, so a change of face moves nothing`);
  assert.equal(new Set(MOODS.map((mood) => loops.loopFace(origin, mood))).size, MOODS.length, `${origin}: and every mood looks different`);
}
assert.equal(loops.loopFace('shelf', 'rest'), 'd(-_-)b', 'the shelf is a face in headphones');
assert.notEqual(loops.loopFace('profile', 'rest'), loops.loopFace('shelf', 'rest'), 'a profile song wears another frame');
assert.notEqual(loops.loopFace('queue', 'rest'), loops.loopFace('profile', 'rest'), 'and so does a queue');
assert.notEqual(loops.loopFace('own', 'rest', true), loops.loopFace('own', 'rest'), 'a displaced track rests unhappy');
assert.equal(loops.loopNotes('rest'), '', 'nothing floats over a face at rest');
assert.notEqual(loops.loopNotes('hover'), '', 'and notes do when it is pointed at');
assert.match(radioText, /\[ REMOVE \]|onRemove/, 'the press prompt can remove the entry');
// (2026-10-25, SPEC-less-text.md) The pop-out's keys shortened: `[ GO BACK TO IT ]` -> `[ RESUME ]`,
// `[ REMOVE IT ]` -> `[ REMOVE ]`, and `[ LEAVE IT ]` (a third way to close, beside the card's x) is cut.
const loopPopoutText = fs.readFileSync('app/components/LoopPopout.tsx', 'utf8');
assert.match(loopPopoutText, /\[ REMOVE \]/, 'with its own key');
assert.match(loopPopoutText, /\[ RESUME \]/, 'beside the one that resumes it');
assert.doesNotMatch(loopPopoutText, /\[ REMOVE IT \]|\[ GO BACK TO IT \]|\[ LEAVE IT \]/, 'under the short names');
assert.match(loopPopoutText, /aria-label="Close"/, 'and the card still closes from its own x');
assert.match(
  fs.readFileSync('app/components/LoopPopout.tsx', 'utf8'),
  /player\.play\(track, undefined, \{ at: loop\.positionSeconds \}\)/,
  'GO BACK hands the position to the play, not to a seek on the track that was loaded before',
);
assert.equal(loops.originInk('shelf'), 'text-accent-ink', 'in the brand ink');
assert.notEqual(loops.originMark('queue'), loops.originMark('shelf'), 'a broadcast is a different note');
assert.notEqual(loops.originMark('profile'), loops.originMark('shelf'), 'and a profile song is not a note');

// Thirty entries, as the brief asks.
assert.equal(loops.MAX_LOOPS, 30, 'the grid holds thirty entries');

// The origin is recorded at the moment of playing, and the *first* one wins - the brief's "where you
// initially started playing it from" rather than where it was last heard.
loops.clearAllLoops();
const fromProfile = loops.rememberPlay({
  label: 'X',
  trackId: '/x.mp3',
  positionSeconds: 0,
  origin: 'profile',
  originHref: '/profile/abc',
  originWhere: 'THE PROFILE OF ABC',
});

assert.equal(fromProfile.originHref, '/profile/abc', 'the first play records where it came from');
assert.equal(loops.originWhereLabel(fromProfile), 'THE PROFILE OF ABC', 'which the globe can read out');

loops.rememberPlay({
  label: 'X',
  trackId: '/x.mp3',
  positionSeconds: 30,
  origin: 'shelf',
  originHref: '/forum?music=1',
  originWhere: 'THE MUSIC WINDOW',
});

assert.equal(
  loops.loopState()[0].originHref,
  '/profile/abc',
  'and a later play from somewhere else does NOT rewrite it - "where you INITIALLY started"',
);
assert.equal(loops.originWhereLabel({ ...fromProfile, originHref: undefined }), null, 'an entry with no recorded source has no globe');
loops.clearAllLoops();

const taken = {
  label: 'ALPHA',
  trackId: '/one.mp3',
  positionSeconds: 42,
  kind: 'taken-over',
  displacedBy: 'abc12345',
};
loops.saveLoop(taken);

// The same *place* saved twice is one loop, not two: a queue followed away and back must not stack up
// plates that all go to the same second. Identity is the track and the whole second together.
assert.equal(loops.loopState().length, 1, 'saving the same place again replaces it rather than stacking');
assert.equal(loops.loopState()[0].kind, 'taken-over', 'and the newer save is the one that stands');

// A different second in the same track is a different place, and is kept as its own loop.
loops.saveLoop({ label: 'ALPHA', trackId: '/one.mp3', positionSeconds: 43, kind: 'own' });
assert.equal(loops.loopState().length, 2, 'but another second in that track is its own loop');

const held = loops.loopState()[0];
assert.equal(held.positionSeconds, 43, 'the newest is first');
assert.equal(held.id, held.trackId + '@43', 'and its identity is the track and the second');

loops.clearLoop(held.id);
assert.equal(loops.loopState().length, 1, 'clearing one leaves the other');

const displaced = loops.loopState()[0];
assert.equal(displaced.kind, 'taken-over', 'which still remembers it was displaced by a queue');
assert.equal(displaced.displacedBy, 'abc12345', 'naming whose queue did it');

loops.clearAllLoops();
assert.deepEqual(loops.loopState(), [], 'and the whole shelf of them can go');

// The cap: a history nobody prunes is a list nobody reads, so the oldest go.
for (let index = 0; index < loops.MAX_LOOPS + 5; index += 1) {
  loops.saveLoop({ label: `T${index}`, trackId: `/t${index}.mp3`, positionSeconds: index, kind: 'own' });
}
assert.equal(loops.loopState().length, loops.MAX_LOOPS, `no more than ${loops.MAX_LOOPS} loops are kept`);
assert.equal(loops.loopState()[0].label, `T${loops.MAX_LOOPS + 4}`, 'and the newest is first');

loops.clearAllLoops();
assert.deepEqual(loops.loopState(), [], 'and the whole shelf of them can go');

/* 7. The heartbeat: a broadcast has to keep moving or the list reads it as dead. */
const beat = require('./queue-out/audio/heartbeat.js');
const broadcastLib = require('./queue-out/audio/broadcast.js');

// The interval is *derived* from the staleness window, so a broadcast cannot be starved by a heartbeat
// slower than the thing that decides it is dead. Half leaves room for a dropped write and a throttled
// background tab - which is the case that decides it, because every browser slows timers in a tab nobody
// is looking at, and a broadcast that dies when its owner reads another page is not a broadcast.
assert.ok(
  beat.QUEUE_HEARTBEAT_MS * 2 <= broadcastLib.QUEUE_STALE_SECONDS * 1000,
  'the heartbeat is at least twice as fast as the staleness window that would call it dead',
);
assert.ok(beat.QUEUE_HEARTBEAT_MS < broadcastLib.QUEUE_STALE_SECONDS * 1000, 'so it always lands inside it');

// A queue kept alive by beats stays readable as LIVE; one that is only written once goes SILENT. This is
// what the heartbeat exists for, so the pair is asserted rather than assumed.
const at = Date.parse('2026-09-25T12:00:00.000Z');
const beats = Math.floor(broadcastLib.QUEUE_STALE_SECONDS / (beat.QUEUE_HEARTBEAT_MS / 1000));

assert.ok(beats >= 1, 'there is at least one beat inside the window');
assert.equal(
  broadcastLib.hostState(row(beat.QUEUE_HEARTBEAT_MS / 1000, 0), at),
  'live',
  'a heartbeated queue reads LIVE',
);
assert.ok(
  beat.QUEUE_HEARTBEAT_MS * 2 <= broadcastLib.QUEUE_PAUSED_SECONDS * 1000,
  'the heartbeat beats at least twice inside the pause window, or a playing host would read as PAUSED',
);
assert.equal(
  broadcastLib.hostState(row(broadcastLib.QUEUE_PAUSED_SECONDS + 1, 0), at),
  'paused',
  'a row quiet for longer than a few beats is a host who paused',
);
assert.equal(
  broadcastLib.hostState(row(broadcastLib.QUEUE_STALE_SECONDS + 1, 0), at),
  'silent',
  'and one nobody has written to reads SILENT - which is what the heartbeat prevents',
);

/** A host row written `age` seconds before `at`, at `position` into '/host.mp3'. */
function row(age, position, trackId = '/host.mp3', userId = 'host') {
  return {
    userId,
    trackId,
    trackIndex: 0,
    trackTotal: 3,
    positionSeconds: position,
    updatedAt: new Date(at - age * 1000).toISOString(),
    startedAt: new Date(at - 600000).toISOString(),
  };
}

/* 7b. The lamp is about the host - the bug the owner hit.
 *
 * The list used to measure every row against whatever this player happened to be on, so a reader who
 * had followed nobody saw "4095S BEHIND :: 4.0x". The host's state is now a function of the host's row
 * alone, and the only place "behind" is drawn is inside the followed row's branch.
 */
assert.equal(broadcastLib.hostState.length, 2, 'the host`s state takes the row and the clock - not this player');
assert.equal(broadcastLib.hostPositionSeconds(row(5, 100), at), 105, 'a live host is walked forward by the row`s age');
assert.equal(
  broadcastLib.hostState({ ...row(1, 100), isPlaying: false }, at),
  'paused',
  'a pause write says PAUSED at once, not ten seconds later when the row goes quiet',
);
assert.equal(broadcastLib.hostPositionSeconds({ ...row(3, 100), isPlaying: false }, at), 100, 'and holds where they stopped');
assert.equal(broadcastLib.hostState({ ...row(1, 100), isPlaying: true }, at), 'live', 'a playing write is LIVE');
assert.equal(broadcastLib.hostPositionSeconds(row(30, 100), at), 100, 'a paused host is held where they stopped');
assert.deepEqual(
  broadcastLib.visibleQueues([row(3600, 0, '/a.mp3', 'old'), row(2, 0, '/b.mp3', 'new')], at).map((q) => q.userId),
  ['new'],
  'a row nobody has touched for an hour is not listed',
);
assert.deepEqual(
  broadcastLib.visibleQueues([row(60, 0, '/a.mp3', 'a'), row(2, 0, '/b.mp3', 'b')], at).map((q) => q.userId),
  ['b', 'a'],
  'and live hosts come before paused ones',
);
// (2026-11-04, SPEC-music-queues.md) The row is `RoomRow`, and there is no followed branch: the list says nothing about
// how far behind this player is. The bug stays closed by the row's lamp and clock reading only the room and the clock.
{
  const rowSource = browserText.slice(browserText.indexOf('function RoomRow('), browserText.indexOf('function QueuePeek('));
  assert.ok(rowSource.length > 0, 'the list draws a row per room');
  assert.doesNotMatch(rowSource, /BEHIND/, 'no row measures anybody against this player');
  assert.doesNotMatch(rowSource, /useMusicPlayer|player\.elapsed/, 'and a row cannot, because it never reads the player');
  assert.match(rowSource, /roomRowState\(live\.room, now\)/, 'the lamp is the room and the clock');
  assert.match(rowSource, /hostPosition\(live\.room, now\)/, 'and so is the time shown');
  assert.match(rowSource, /useQueueName\(live\.room\.hostId\)/, 'and a person is shown by name');
  assert.doesNotMatch(browserText, /(userId|hostId)\.slice\(0, 8\)/, 'not by an id');
}

/* 7c. Following: what the follower does each second, as arithmetic. */
const providerText = fs.readFileSync('app/components/MusicPlayerProvider.tsx', 'utf8');
const follow = require('./queue-out/audio/follow.js');
const mine = (src, seconds) => ({ src, seconds });

assert.equal(follow.followStep(null, mine('/host.mp3', 0), at, false).kind, 'lost', 'a host who left ends the follow');
assert.equal(
  follow.followStep(row(broadcastLib.QUEUE_STALE_SECONDS + 1, 0), mine('/host.mp3', 0), at, false).kind,
  'lost',
  'and so does one who went silent',
);
{
  const step = follow.followStep(row(1, 50, '/next.mp3'), mine('/host.mp3', 170), at, false);
  assert.equal(step.load, true, 'the host moved to another track: load it');
  assert.equal(Math.round(step.at), 51, 'at where the host is in it');
}
{
  const step = follow.followStep(row(1, 100), mine('/host.mp3', 101), at, false);
  assert.equal(step.rate, 1, 'level with the host: normal speed');
  assert.equal(step.at, undefined, 'and no jump');
  assert.equal(step.playing, true, 'playing, because they are');
}
{
  const step = follow.followStep(row(1, 100), mine('/host.mp3', 81), at, false);
  assert.ok(step.rate > 1, 'twenty seconds behind: speed up');
  assert.ok(step.rate <= follow.MAX_CATCH_UP_RATE, 'but never past the cap');
  assert.equal(step.catchingUp, true, 'and say so');
  assert.equal(step.at, undefined, 'without jumping - that is what catching up means');
}
assert.equal(
  follow.followStep(row(1, 100), mine('/host.mp3', 100.5), at, true).catchingUp,
  false,
  'a catch-up settles once level',
);
assert.equal(
  follow.followStep(row(1, 100), mine('/host.mp3', 99.5), at, false).catchingUp,
  false,
  'and a second of network wobble does not start one',
);
assert.equal(
  Math.round(follow.followStep(row(1, 300), mine('/host.mp3', 10), at, false).at),
  301,
  'minutes behind is a jump, not a chipmunk',
);
assert.equal(
  Math.round(follow.followStep(row(1, 100), mine('/host.mp3', 120), at, false).at),
  101,
  'well ahead of the host is a jump back, not a slow-down',
);
{
  const step = follow.followStep(row(30, 100), mine('/host.mp3', 120), at, false);
  assert.equal(step.playing, false, 'the host paused: so does the follower');
  assert.equal(step.at, 100, 'held where they stopped');
}
{
  // The reviewer's boundary case: our copy ended first and the host's next row has not landed.
  const step = follow.followStep(row(1, 52), { src: '/host.mp3', seconds: 50.9, duration: 51, playing: false }, at, false);
  assert.equal(step.playing, false, 'a finished copy waits for the host`s next track instead of replaying the opening');
  assert.equal(step.at, undefined, 'and does not seek');
  const looped = follow.followStep(row(1, 2), { src: '/host.mp3', seconds: 50.9, duration: 51, playing: false }, at, false);
  assert.equal(looped.playing, true, 'but a host who looped back to the start is followed round');
}
// Clock skew: a device 30 seconds fast must still read a fresh host as LIVE once it has calibrated.
broadcastLib.resetClockSkew();
{
  const fast = at + 30000;
  assert.equal(broadcastLib.hostState(row(1, 0), fast), 'paused', 'uncalibrated, a fast clock misreads a live host');
  broadcastLib.calibrateClock([row(0.2, 0)], fast);
  broadcastLib.calibrateClock([row(0.1, 0)], fast);
  assert.equal(broadcastLib.hostState(row(1, 0), fast), 'live', 'calibrated, it reads LIVE');
  broadcastLib.calibrateClock([row(3600, 0)], fast);
  assert.equal(broadcastLib.hostState(row(1, 0), fast), 'live', 'and a stale row in a reading does not throw it off');
  broadcastLib.resetClockSkew();
}
// (2026-10-25, SPEC-less-text.md) The reader's own presses stop a follow with no reason (`''`): the bar reads
// `STOPPED FOLLOWING ::` rather than `... - YOU MOVED THE PLAYHEAD`, since the reader just did it themselves.
// (2026-11-04, SPEC-music-queues.md) The same press now also takes the room's playback back (`hostingRoom`), so it is a block.
assert.match(providerText, /if \(options\?\.follow !== true\) \{\s*stopFollowing\(''\);\s*hostingRoom\(\);/, 'dragging the scrubber lets go of a follow');
assert.doesNotMatch(providerText, /YOU MOVED THE PLAYHEAD|YOU TOOK THE CONTROLS BACK|YOU PICKED SOMETHING ELSE/, 'without narrating the reader`s own press');
assert.match(followerText, /now\.seek\(step\.at, \{ follow: true \}\)/, 'while the follower`s own seeks do not');
assert.match(followerText, /row\.userId !== hostId/, 'switching hosts never steers by the previous host`s row');
assert.match(providerText, /start\.src === loadedSrc\.current/, 'a start position only lands on the file it was asked for');
assert.match(providerText, /setPlaybackRateState\(audio\.playbackRate\)/, 'the rate state is read back from the element after a load');
assert.match(heartbeatText0(), /position: clock\.current\.src !== trackId \? 0 : player\.elapsed/, 'a new track is published at zero, not at the old track`s time');
assert.equal(follow.paceRate(0), 1, 'no gap, no speed-up');
assert.ok(follow.paceRate(5) < follow.paceRate(20), 'a bigger gap runs faster');

// The store: one host at a time, and any transport key lets go.
follow.startFollowing('host', 'SWEDEN');
assert.equal(follow.isFollowing(), true, 'starting a follow follows');
follow.stopFollowing('YOU TOOK THE CONTROLS BACK');
assert.equal(follow.isFollowing(), false, 'and stopping stops');
assert.equal(follow.followState().ended, 'YOU TOOK THE CONTROLS BACK', 'saying why, for the bar');

for (const key of ['const toggle = useCallback', 'const stop = useCallback', 'const next = useCallback', 'const previous = useCallback']) {
  const body = providerText.slice(providerText.indexOf(key), providerText.indexOf(key) + 400);
  assert.match(body, /stopFollowing\(/, `${key.split(' ')[1]} lets go of a follow - touching the controls means "my turn"`);
}
assert.match(providerText, /if \(start\?\.follow !== true\) stopFollowing/, 'a play from anywhere but the follower lets go too');
assert.match(providerText, /if \(isFollowing\(\)\) \{\s*setPlaying\(false\);/, 'the end of a track waits for the host`s next one');
assert.match(providerText, /'loadedmetadata', onMetadata/, 'a start position is applied once the new file has loaded');
assert.ok(at > 0, 'the fixture timestamp parses');

assert.equal(beat.shouldPublish(10, 0, true), true, 'playing: always say where you are');
assert.equal(beat.shouldPublish(10, 10, false), false, 'paused and still: nothing changed to say');
assert.equal(beat.shouldPublish(11, 10, false), true, 'paused but moved: a seek is worth saying');
assert.equal(beat.shouldPublish(Number.NaN, 0, true), false, 'and a broken clock says nothing');

// The position written is where you are in the track. Changed on 2026-10-12, deliberately: this used to
// assert that a 2x catch-up published half the clock, which was the bug - `elapsed` is the element's
// `currentTime`, already the position in the file at any speed, so halving it told every listener the
// host was half as far in as they were.
assert.equal(beat.publishablePosition(60), 60, 'the clock is the position');
assert.equal(beat.publishablePosition(60, true, 2), 60, 'at any speed - a 2x catch-up is NOT halved, which was the bug');
assert.equal(beat.publishablePosition(-3), 0, 'never before the start');
assert.equal(beat.publishablePosition(Number.NaN), 0, 'and a broken clock is the start');
assert.match(heartbeatText0(), /\[broadcasting, index, playing, repository/, 'play and pause are written the moment they happen');

function heartbeatText0() {
  return fs.readFileSync('app/components/BroadcastHeartbeat.tsx', 'utf8');
}

// The heartbeat is drawn by the *shell*, beside the player whose clock it reads - not inside the window
// that starts a broadcast. A window comes and goes; a broadcast has to keep writing either way.
const heartbeatText = fs.readFileSync('app/components/BroadcastHeartbeat.tsx', 'utf8');

// (2026-11-04, SPEC-music-queues.md, commit f2613e8) The heartbeat retired with the follower; the room writes where the music is.
assert.doesNotMatch(layout, /<BroadcastHeartbeat \/>/, 'the shell no longer draws the retired heartbeat');
assert.doesNotMatch(windowText, /BroadcastHeartbeat/, 'and the queue window does not either');
assert.match(heartbeatText, /QUEUE_HEARTBEAT_MS/, 'the interval comes from the shared module, not a literal');
assert.doesNotMatch(heartbeatText, /setInterval\([^,]+,\s*\d/, 'so no interval is typed into the component');

// The clock lives in a ref because `elapsed` updates several times a second: an effect depending on it
// would rebuild its interval on every tick and never fire. This is the fault that would leave every
// broadcast silently dying, and it is why the ref is asserted rather than assumed.
assert.match(heartbeatText, /useRef\(/, 'the clock is held in a ref');
assert.match(heartbeatText, /clock\.current/, 'which the interval reads when it fires');
assert.match(heartbeatText, /useEffect\(\(\) => \{\s*clock\.current =/, 'and is written in an effect, not in render');

// The event is also what tells a *listener* the list changed, so the switch has to announce its write.
// (2026-11-04, SPEC-music-queues.md) The rows are rooms now, and a room's own write is the announcement: the list and the
// switch both subscribe to the room store, in both repositories, instead of one browser-tab event.
{
  const roomHook = fs.readFileSync('app/lib/watch/use-music-room.ts', 'utf8');
  assert.equal((roomHook.match(/repository\.subscribeLiveRooms\(read\)/g) ?? []).length, 2, 'the switch and the list both hear a room change');
  assert.match(browserText, /useLiveRooms\(\)/, 'and the browser draws from that list');
  assert.match(browserText, /useMusicRoomSwitch\(/, 'and that switch');
  for (const repo of ['mock', 'supabase']) {
    assert.match(fs.readFileSync(`app/lib/watch/${repo}-watch-repository.ts`, 'utf8'), /subscribeLiveRooms\(listener: \(\) => void\)/, `the ${repo} repository can say so`);
  }
}

/* 8. A queue belongs to one account - the hole the mock had.
 *
 * Written as an async block because the repository is promise-based, and run *last* because it is the only
 * section that talks to a store with state rather than to pure arithmetic.
 */
const repo = require('./queue-out/audio/mock-music-repository.js').getMockMusicRepository();

void (async () => {
  // No storage in a Node process, so the mock keeps its rows in memory for the length of this run. That is
  // enough for the question being asked, which is about *scoping* rather than persistence.
  await repo.publishQueue({
    userId: 'alice',
    trackId: '/alice.mp3',
    trackIndex: 0,
    trackTotal: 1,
    positionSeconds: 5,
    isPublic: false,
  });

  assert.equal(
    await repo.readOwnQueue('bob'),
    null,
    'bob does not read alice`s queue - the mock used to hand back whoever wrote last',
  );
  assert.equal((await repo.readOwnQueue('alice'))?.isPublic, false, 'and alice reads hers, private or not');
  assert.deepEqual(await repo.listQueues(), [], 'a private queue is on nobody`s list');

  await repo.publishQueue({
    userId: 'alice',
    trackId: '/alice.mp3',
    trackIndex: 0,
    trackTotal: 1,
    positionSeconds: 9,
    isPublic: true,
  });

  assert.equal((await repo.listQueues()).length, 1, 'going public puts it on the list');
  assert.equal((await repo.readOwnQueue('alice'))?.positionSeconds, 9, 'and the write really moved it');
  assert.equal(await repo.readOwnQueue('bob'), null, 'still without handing it to bob');

  await repo.clearQueue('alice');
  assert.equal(await repo.readOwnQueue('alice'), null, 'clearing forgets the row entirely');
  assert.deepEqual(await repo.listQueues(), [], 'and takes it off the list');

  console.log('queue checks passed');
})();
