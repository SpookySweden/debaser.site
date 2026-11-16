/*
 * The floating player and the site's arrows (SPEC-floating-player.md), offline. From the root:
 *   npx tsc app/lib/ui/float-geometry.ts app/lib/ui/floating-player.ts app/lib/ui/use-float-frame.ts app/lib/ui/site-history.ts app/lib/web/embed-time.ts app/lib/watch/room-start.ts --rootDir app --outDir Temp/out-floating-player --module commonjs --target es2022 --lib es2022,dom,dom.iterable --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *   node Temp/check-floating-player.cjs
 *
 * - where a float may be: whole on screen and off the strips along the foot, whatever is asked of it
 * - when the video leaves its box: no box, [ PIP ], or scrolled past
 * - one video at a time: a second PLAY replaces the first, under a new element; the row finds its box again
 * - nothing is stored or sent: places are memory, a reader's own browser tab, never a fetch
 * - a player's time: only YouTube and Vimeo say, third-party messages are read as nothing when they are nonsense
 * - the arrows: quiet at either end of the site's own entries; a place is saved per entry
 * - no row draws its own frame or <video> (a cross-origin iframe restarts if it moves), and the layer does
 *
 * The real "never reloads" proof needs a browser: scripts/drive-floating-player.cjs.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-floating-player');
const geometry = require(join(OUT, 'lib/ui/float-geometry.js'));
const store = require(join(OUT, 'lib/ui/floating-player.js'));
const history = require(join(OUT, 'lib/ui/site-history.js'));
const time = require(join(OUT, 'lib/web/embed-time.js'));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

let count = 0;
const ok = (value, message) => {
  count += 1;
  assert.ok(value, message);
};
const same = (actual, expected, message) => {
  count += 1;
  assert.deepEqual(actual, expected, message);
};

/* ---------------------------------------------------------------- where a float may be */
const screen = { w: 1280, h: 800 };
const floor = 90;
const corner = geometry.defaultFloat(geometry.FLOAT_VIDEO_SIZE, screen, floor);
ok(corner.x + corner.w <= screen.w && corner.x > screen.w / 2, 'it starts in the right-hand corner');
ok(corner.y + corner.h <= screen.h - floor, 'above the strips along the foot');
ok(corner.y + corner.h > screen.h - floor - 20, 'and at the foot, not the top');
for (const asked of [
  { x: -500, y: -500, w: 400, h: 300 },
  { x: 5000, y: 5000, w: 400, h: 300 },
  { x: 100, y: 780, w: 400, h: 300 },
  { x: 0, y: 0, w: 99999, h: 99999 },
  { x: 0, y: 0, w: 1, h: 1 },
]) {
  const rect = geometry.clampFloat(asked, screen, floor);
  ok(rect.x >= 0 && rect.x + rect.w <= screen.w, `on screen across: ${JSON.stringify(asked)}`);
  ok(rect.y >= 0 && rect.y + rect.h <= screen.h - floor, `off the music and START bars: ${JSON.stringify(asked)}`);
  ok(rect.w >= geometry.FLOAT_MIN.w && rect.h >= geometry.FLOAT_MIN.h, `never smaller than its keys need: ${JSON.stringify(asked)}`);
}
const phone = geometry.clampFloat({ x: 0, y: 0, w: 384, h: 256 }, { w: 300, h: 500 }, 80);
ok(phone.w <= 300 && phone.y + phone.h <= 420, 'a small screen shrinks it rather than hiding its keys');
same(geometry.resizedFloat({ x: 100, y: 100, w: 400, h: 300 }, { right: true, bottom: true }, 50, 20), { x: 100, y: 100, w: 450, h: 320 }, 'a bottom-right grip grows it, the top-left stays');
same(geometry.resizedFloat({ x: 100, y: 100, w: 400, h: 300 }, { left: true, top: true }, 50, 20), { x: 150, y: 120, w: 350, h: 280 }, 'a top-left grip moves the near edge, the far edge stays');
const tiny = geometry.resizedFloat({ x: 100, y: 100, w: 300, h: 100 }, { left: true }, 9999, 0);
same(tiny.x + tiny.w, 400, 'pulled past its smallest, the far edge still stays');
same(geometry.floorFrom(['90px', '', '132px', 'junk']), 132, 'the highest strip along the foot; unset and junk ignored');

/* ---------------------------------------------------------------- when it leaves its box */
const pane = { left: 0, top: 100, right: 800, bottom: 700 };
const box = (top) => ({ left: 10, top, right: 610, bottom: top + 300 });
same(geometry.shownShare(box(200), [pane]), 1, 'all showing');
same(geometry.shownShare(box(800), [pane]), 0, 'below the pane: nothing showing');
same(geometry.shownShare(box(-250), [pane]), 0, 'scrolled past: nothing showing');
ok(geometry.shownShare(box(-100), [pane]) > 0 && geometry.shownShare(box(-100), [pane]) < 1, 'part showing');
same(geometry.shownShare({ left: 0, top: 0, right: 0, bottom: 0 }, [pane]), 0, 'a box with no size shows nothing');
same(geometry.shownShare({ left: 0, top: 100, right: 800, bottom: 2000 }, [pane]), 1, 'a box taller than its pane still counts as showing when it fills it');
same(geometry.visiblePart(box(-100), [pane]), { left: 10, top: 100, right: 610, bottom: 200 }, 'the clip is what the pane shows of it');
same(geometry.shouldFloat(false, false, 1), true, 'no box: floats');
same(geometry.shouldFloat(true, true, 1), true, '[ PIP ]: floats with its box in view');
same(geometry.shouldFloat(true, false, 0.1), true, 'scrolled past: floats');
same(geometry.shouldFloat(true, false, 1), false, 'on screen: stays in its box');

/* ---------------------------------------------------------------- one video at a time */
global.window = { location: { pathname: '/media', search: '?q=trains' } };
const frameOf = (src) => ({ kind: 'frame', src, frameTitle: 't', referrerPolicy: 'no-referrer', sandbox: 'allow-scripts', allow: 'autoplay', allowFullScreen: false, timeFrom: null });
let shown = 0;
const fakeBox = () => ({ scrollIntoView: () => (shown += 1), isConnected: true });
same(store.floatingState().entry, null, 'nothing plays until a press');
store.playFloating({ id: 'web:a', title: 'A', shape: 'video', player: frameOf('https://a.test/') });
const first = store.floatingState().entry;
same(first.home, '/media?q=trains', 'it remembers the address it came from, search and all');
same(first.id, 'web:a');
const boxA = fakeBox();
const gone = store.registerBox('web:a', boxA);
same(shown, 1, 'just pressed PLAY: the box is brought into view as it arrives');
store.setFloatAsked(true);
same(store.floatingState().asked, true);
same(store.floatingState().entry, first, '[ PIP ] changes nothing about the player: the same entry, so the same element and address');
store.noteFloating(true);
same(store.floatingState().entry, first, 'floating changes nothing about the player');
gone();
same(store.boxOf('web:a'), undefined, 'the row left the page: no box');
same(store.floatingState().entry, first, 'and it plays on');
const again = store.registerBox('web:a', boxA);
same(store.floatingState().asked, false, 'coming back to the page puts it back in its box');
same(shown, 1, 'it was floating when it left, so it does not scroll the page: that is the arrows\' job');
same(store.keptBox(), null, 'and a saved scroll position wins');
store.noteFloating(false);
const realNow = Date.now;
Date.now = () => realNow() + 60000;
again();
const inView = store.registerBox('web:a', boxA);
same(shown, 2, 'it was in its box when its row left: back on the page, the box comes into view');
same(store.keptBox(), boxA, 'and it wins over a saved scroll position, since rows can come back in another order');
store.letKeptBoxGo();
same(store.keptBox(), null, 'until the reader does something');
store.noteFloating(true);
inView();
Date.now = realNow;
shown = 1;
store.wantBoxShown();
const back = store.registerBox('web:a', boxA);
same(shown, 2, 'the float\'s [ BACK ] from another page shows the box when it arrives');
back();
store.playFloating({ id: 'web:b', title: 'B', shape: 'video', player: frameOf('https://b.test/') });
same(store.floatingState().entry.id, 'web:b', 'a second PLAY replaces the video playing');
ok(store.floatingState().entry.play > first.play, 'under a new element');
store.closeFloatingIfMine('web:a');
same(store.floatingState().entry.id, 'web:b', 'another row closing leaves it alone');
const old = store.registerBox('web:a', boxA);
const newer = store.registerBox('web:a', fakeBox());
old();
ok(store.boxOf('web:a') !== undefined, 'a stale row going away does not take a newer box with it');
newer();

// (2026-11-15, SPEC-rooms-queues.md phases 1 and 2) Your own room: its window's screen takes the video over from its row
// and gives it back; the room hears a video end once, so the next thing queued starts; the bar's key orders the player.
const rowBox = fakeBox();
const roomScreen = fakeBox();
const leaveRow = store.registerBox('web:b', rowBox);
const leaveRoom = store.registerBox('web:b', roomScreen);
same(store.boxOf('web:b'), roomScreen, "the room window's screen takes the video over from its row");
same(store.floatingState().entry.id, 'web:b', 'and it is the same play: nothing is started again');
leaveRoom();
same(store.boxOf('web:b'), rowBox, 'the window shut: the row has the video again, rather than it floating off');
const goneRow = { ...fakeBox(), isConnected: false };
const leaveGone = store.registerBox('web:b', goneRow);
const leaveRoomAgain = store.registerBox('web:b', roomScreen);
leaveRow();
leaveRoomAgain();
same(store.boxOf('web:b'), undefined, 'a row that has left the page meanwhile is nothing to go back to');
leaveGone();
let ends = 0;
const stopHearing = store.onFloatingEnded(() => (ends += 1));
store.notePlace('web:b', null);
store.notePlace('web:b', null);
same(ends, 1, 'a player that says it has ended twice is heard once');
store.notePlace('web:a', null);
same(ends, 1, "another row's video is not the one that is on");
stopHearing();
const orders = [];
const stopOrders = store.onFloatingOrder((order) => orders.push(order));
store.orderFloating('pause');
stopOrders();
store.orderFloating('play');
same(orders, ['pause'], "the bar's order reaches the layer while it listens, and not after");
same(store.takesOrders({ player: frameOf('https://a.test/') }), false, 'a player that cannot be asked takes no orders');
same(store.takesOrders({ player: { ...frameOf('https://a.test/'), timeFrom: 'youtube' } }), true, 'one that answers messages does');
same(store.takesOrders({ player: { kind: 'file', src: '/x.mp4' } }), true, 'and so does one of our own files');

store.closeFloatingIfMine('web:b');
same(store.floatingState().entry, null, 'its own row closes it');

/* ---------------------------------------------------------------- a video's place */
same(store.placeOf('web:a'), null, 'no place until a player says');
store.notePlace('web:a', 42.5);
same(store.placeOf('web:a'), 42.5, 'kept for the visit');
store.notePlace('web:a', Number.NaN);
same(store.placeOf('web:a'), 42.5, 'nonsense is ignored');
store.notePlace('web:a', -1);
same(store.placeOf('web:a'), 42.5, 'nonsense is ignored');
store.notePlace('web:a', null);
same(store.placeOf('web:a'), null, 'finished: played again it starts again');
const storeSource = read('app/lib/ui/floating-player.ts');
ok(!/fetch\(|localStorage|sessionStorage|supabase/i.test(storeSource.replace(/\/\*[\s\S]*?\*\//g, '')), 'a video\'s place is never stored or sent');

/* ---------------------------------------------------------------- a player's time */
const ORIGIN = 'https://debaser.site';
same(time.timeSourceOf('youtube'), 'youtube');
same(time.timeSourceOf('vimeo'), 'vimeo');
for (const platform of ['internet_archive', 'peertube', 'wikimedia_commons']) same(time.timeSourceOf(platform), null, `${platform} cannot say where it is`);
const yt = new URL(time.embedWithPlace('https://www.youtube-nocookie.com/embed/abc?autoplay=1', 'youtube', 83.7, ORIGIN));
same(yt.searchParams.get('enablejsapi'), '1', 'YouTube is asked to answer');
same(yt.searchParams.get('origin'), ORIGIN, 'and told who is asking');
same(yt.searchParams.get('start'), '83', 'and starts from the place');
same(yt.searchParams.get('autoplay'), '1', 'keeping what the row asked of it');
same(new URL(time.embedWithPlace('https://www.youtube-nocookie.com/embed/abc', 'youtube', null, ORIGIN)).searchParams.get('start'), null, 'no place, no start');
same(new URL(time.embedWithPlace('https://www.youtube-nocookie.com/embed/abc', 'youtube', 0.4, ORIGIN)).searchParams.get('start'), null, 'under a second is the start');
same(time.embedWithPlace('https://player.vimeo.com/video/1?autoplay=1', 'vimeo', 61.2, ORIGIN), 'https://player.vimeo.com/video/1?autoplay=1#t=61s', 'Vimeo takes its place in the fragment');
same(time.embedWithPlace('https://archive.org/embed/x?autoplay=1', null, 50, ORIGIN), 'https://archive.org/embed/x?autoplay=1', 'a player that cannot say is framed exactly as it was');
same(time.readTimeMessage('youtube', JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12.5 } })), { seconds: 12.5 }, 'YouTube\'s time');
same(time.readTimeMessage('youtube', JSON.stringify({ event: 'infoDelivery', info: { playerState: 0, currentTime: 90 } })), 'ended', 'YouTube\'s end');
same(time.readTimeMessage('vimeo', JSON.stringify({ event: 'timeupdate', data: { seconds: 7 } })), { seconds: 7 }, 'Vimeo\'s time');
same(time.readTimeMessage('vimeo', JSON.stringify({ event: 'ended' })), 'ended', 'Vimeo\'s end');
for (const nonsense of ['', 'not json', '{"event":"infoDelivery"}', '{"event":"infoDelivery","info":null}', '{"event":"infoDelivery","info":{"currentTime":"9"}}', 'null', '[]', 5, null, undefined, { event: 'other' }]) {
  same(time.readTimeMessage('youtube', nonsense), null, `YouTube nonsense reads as nothing: ${String(nonsense)}`);
  same(time.readTimeMessage('vimeo', nonsense), null, `Vimeo nonsense reads as nothing: ${String(nonsense)}`);
}
const timeSource = read('app/lib/web/embed-time.ts');
ok(/event\.source !== frame\.contentWindow/.test(timeSource) && /origins\.includes\(event\.origin\)/.test(timeSource), 'only the frame\'s own player, from its own address, is listened to');
ok(!/createElement\('script'\)|loadScript|iframe_api/.test(timeSource), 'no script of theirs runs in our page for this');

/* ---------------------------------------------------------------- a double press on YouTube's picture */
let clock = 1000;
const presses = time.doublePressWatcher(() => clock);
const feed = (state, at) => {
  clock = at;
  return presses(state);
};
same(feed(1, 1000), false, 'playing: nothing');
same(feed(2, 5000), false, 'paused by the first press: nothing yet');
same(feed(3, 5100), false, 'loading again on the way back: nothing yet');
same(feed(1, 5400), true, 'measured in a real Chrome: paused and straight back to playing is a double press');
same(feed(1, 5450), false, 'YouTube saying playing again is not another');
same(feed(2, 9000), false, 'somebody pausing');
same(feed(1, 12000), false, 'and playing seconds later is not a double press');
same(feed(3, 20000), false, 'it stalling');
same(feed(1, 20100), false, 'and carrying on, with no pause, is not a double press');
same(feed(2, 30000), false, '');
same(feed(0, 30100), false, 'reaching the end is not a double press');
same(feed(1, 30200), false, 'nor playing again straight after it');
same(time.readYouTubeState(JSON.stringify({ event: 'infoDelivery', info: { playerState: 2 } })), 2, 'its state');
for (const nonsense of ['', 'not json', '{"event":"other","info":{"playerState":2}}', '{"event":"infoDelivery","info":{"playerState":"2"}}', 'null', 5, null]) same(time.readYouTubeState(nonsense), null, `nonsense reads as nothing: ${String(nonsense)}`);
ok(!/className="[^"]*inset-0[^"]*" onDoubleClick/.test(read('app/components/FloatingPlayer.tsx')), 'nothing is laid over a player to catch presses: its own controls keep working');
ok(/onDoubleClick=\{togglePlayerFullscreen\}/.test(read('app/components/FloatingPlayer.tsx')), 'a double press on the float\'s title line');
ok(/\[ FULL \]/.test(read('app/components/FloatingPlayer.tsx')) && /\[ FULL \]/.test(read('app/components/PlayerBox.tsx')), 'a [ FULL ] key on the float and beside every row\'s [ PIP ]');
ok(/onDoubleClick=\{fullOnDoublePress\}/.test(read('app/components/WatchRoom.tsx')), 'in a room, a double press on the picture is the FULL key');

/* ---------------------------------------------------------------- the arrows */
same(history.waysFrom(0, 1), 'none', 'one page: both quiet');
same(history.waysFrom(0, 3), 'forward', 'at the start: only forward');
same(history.waysFrom(1, 3), 'both', 'in the middle: both');
same(history.waysFrom(2, 3), 'back', 'at the end: only back');
same(history.waysFrom(-1, 0), 'none', 'not in the list: quiet');
same(history.siteHistoryServerWays(), 'none', 'the server draws them quiet');
global.window.sessionStorage = { getItem: () => null, setItem: () => undefined };
history.savePlace('entry-1', 'page', 400);
history.savePlace('entry-2', 'page', 90);
same(history.placeFor('entry-1'), { page: 400 }, 'a place per history entry');
same(history.placeFor('entry-2'), { page: 90 }, 'two visits to a page keep two places');
for (let n = 0; n < 200; n += 1) history.savePlace(`walk-${n}`, 'page', n);
same(history.placeFor('entry-1'), null, 'the oldest go first, so the tab never fills up');
same(history.placeFor('walk-199'), { page: 199 }, 'the newest stay');

/* ---------------------------------------------------------------- nobody draws their own player */
const rows = ['app/components/WebMediaRow.tsx', 'app/components/WebSiteFiles.tsx', 'app/components/MediaCatalogue.tsx'];
for (const path of rows) {
  const source = read(path);
  ok(!/<iframe|<video/.test(source), `${path}: no frame or <video> of its own`);
  ok(/<PlayerBox\b/.test(source), `${path}: a reserved box`);
  ok(/playFloating\(/.test(source), `${path}: plays in the one layer`);
  ok(/<PipKey\b/.test(source), `${path}: a [ PIP ] key`);
}
const stream = read('app/components/WebStream.tsx');
same((stream.match(/<iframe/g) ?? []).length, 1, 'WebStream: the one frame left is a reader (a book), which stays in its row');
ok(/playing && embed && !floats \?/.test(stream), 'and it is drawn only for what does not float');
ok(/<PlayerBox\b/.test(stream) && /playFloating\(/.test(stream) && /<PipKey\b/.test(stream), 'WebStream: its videos play in the one layer');
ok(/embedWithPlace\(startingEmbed\(embed, item\.platform, contentLanguage\(item\)\)/.test(stream), 'WebStream: the checked address, asked to start');
const layer = read('app/components/FloatingPlayer.tsx');
same((layer.match(/<iframe\s/g) ?? []).length, 1, 'the layer has one frame');
same((layer.match(/<video\s/g) ?? []).length, 1, 'and one <video>');
// Changed on purpose 2026-11-15 (SPEC-rooms-queues.md phase 5): the layer also draws a queued picture, under the same
// key per PLAY as the frame and the video, so there are three now.
same((layer.match(/key=\{playKey\}/g) ?? []).length, 3, 'each under one key per PLAY (the frame, the picture, the video), never a key that changes on floating');
ok(/player\.kind === 'picture' \? \(\s*<QueuedPicture key=\{playKey\}/.test(layer), 'a queued picture is drawn by QueuedPicture, which decides in the browser whether it may load');
ok(!/key=\{[^}]*floating/.test(layer), 'nothing about floating decides an element\'s identity');
ok(!/\{floating \? <(iframe|video)/.test(layer) && !/createPortal/.test(layer), 'the player is never moved in the page');
ok(/\[ BACK \]/.test(layer) && /\[ × \]/.test(layer) && /\[ POP OUT \]/.test(layer), 'the float\'s keys');
ok(/player\.kind === 'file' && document\.pictureInPictureEnabled/.test(layer), 'POP OUT is offered only for our own files');
ok(/sticky top-0/.test(layer) && /passScrollToPane/.test(layer) && /pane\.scrollTop \+= moved/.test(layer), 'the wheel over a video in its row still scrolls the page');
// Luke, 2026-11-05: scrolling up stuck where the video goes back in its box. The video's size change moved the wheel room,
// which reached the page as a scroll and flipped it back. scripts/drive-floating-player.cjs proves the real behaviour.
ok(/\[overflow-anchor:none\]/.test(layer), 'the wheel room is never moved by the browser\'s scroll anchoring');
ok(/if \(floats !== wasFloating\) \{[\s\S]*?scrollTop = ROOM_MIDDLE;[\s\S]*?roomSeen\.current = ROOM_MIDDLE;/.test(layer), 'and is back in the middle at every switch, so a switch never reaches the page as a scroll');
ok(/const moved = room\.scrollTop - roomSeen\.current;/.test(layer) && /setTimeout\(\(\) => \{\s*room\.scrollTop = ROOM_MIDDLE;/.test(layer), 'it goes back only once scrolling stops, so a real wheel\'s glide is not cut short');
ok(/overflow-y-scroll \[overflow-anchor:none\]/.test(layer) && !/overflow-hidden/.test(layer), 'the wheel works over the float too');
ok(/playCount\(\) !== playsBefore/.test(read('app/components/WebMediaRow.tsx')), 'a slow server\'s answer never replaces a newer PLAY');
const app = read('app/layout.tsx');
ok(/<FloatingPlayer \/>/.test(app) && /<SiteHistoryKeeper \/>/.test(app), 'both are drawn once, above every page');
const nav = read('app/components/SiteNav.tsx');
ok(nav.indexOf('<SiteArrows />') > -1 && nav.indexOf('<SiteArrows />') < nav.indexOf('MODULES.filter'), 'the arrows sit left of the modules');
const arrows = read('app/components/SiteArrows.tsx');
ok(/◄/.test(arrows) && /►/.test(arrows) && !/\[ ◄ \]/.test(arrows), 'the arrows are small keys without brackets (Luke, 2026-11-06: they take much less room)');
// Changed on purpose 2026-11-14 (Luke: "make the back button in the top left ... act like a general undo button ... with the other button
// acting in reverse"): the arrows are UNDO and REDO now (app/lib/ui/undo-trail.ts). With nothing to undo, and for a page step, they keep
// the plain names Back and Forward, and each still goes quiet when it has nothing to do. It was a fixed aria-label and `disabled={!back}`.
ok(/'Back'/.test(arrows) && /'Forward'/.test(arrows) && /aria-label=\{undoName\}/.test(arrows) && /aria-label=\{redoName\}/.test(arrows), 'named for a screen reader: Back and Forward for pages, Undo and Redo with the words for the rest');
ok(/disabled=\{!undoes && !back\}/.test(arrows) && /disabled=\{!redoes && !forward\}/.test(arrows), 'quiet when there is nothing to undo and nowhere to go');
ok(/pointer-coarse:min-h-tap/.test(arrows), 'a full tap size for a finger');
ok(/data-scroll-pane="page"/.test(read('app/components/SiteWindow.tsx')), 'the page\'s pane is named for its place');
const keeper = read('app/components/SiteHistoryKeeper.tsx');
ok(/closest\('main'\)/.test(keeper), 'only panes in the page count');
ok(/THE_READER_ACTS/.test(keeper), 'the reader doing anything stops a place being put back');
ok(!/transition/.test(layer) && !/animate-/.test(layer), 'nothing moves but what the reader moves: nothing to stop under reduced motion');

/* ---------------------------------------------------------------- WATCH IN ROOM (part 3) */
const roomStart = require(join(OUT, 'lib/watch/room-start.js'));
const playerOne = {};
same(roomStart.roomStartFor(playerOne, 'e1'), null, 'no place: from the top');
roomStart.noteRoomStart('e1', 90.5, 1000);
same(roomStart.roomStartFor(playerOne, 'e2', 1000), null, 'a place belongs to its own row');
same(roomStart.roomStartFor(playerOne, 'e1', 1000), 90.5, 'the room starts from where the viewer had got to');
same(roomStart.roomStartFor(playerOne, 'e1', 1000), null, 'each player once, so the host can go back to the top');
same(roomStart.roomStartFor({}, 'e1', 2000), 90.5, 'a private room draws its stage twice as it opens: the player that stays gets the place too');
same(roomStart.roomStartFor({}, 'e1', 60000), null, 'not long after: a player made later starts as the room says');
roomStart.noteRoomStart('e3', 0.4);
same(roomStart.roomStartFor({}, 'e3'), null, 'under a second is the top');
roomStart.noteRoomStart('e4', null);
same(roomStart.roomStartFor({}, 'e4'), null, 'a player that cannot tell starts from the top');
const roomKey = read('app/components/WatchInRoomKey.tsx');
// Updated on purpose 2026-11-14 (Luke's list M6): the key's words come from `useRoomKey`, which MEDIA's PLAY / + QUEUE key also
// reads (QueueHalf.tsx), so WebStream's rows reach it through `useQueueHalf` rather than drawing `<WatchInRoomKey>`.
ok(/words: 'WATCH IN ROOM'/.test(roomKey) && /'ADD TO ROOM'/.test(roomKey), 'one key with both words');
for (const path of ['app/components/WebSiteFiles.tsx', 'app/components/MediaCatalogue.tsx', 'app/components/FloatingPlayer.tsx']) ok(/<WatchInRoomKey\b/.test(read(path)), `${path}: has the key`);
ok(/useQueueHalf\(\{ bar: barItem, room: roomSource,/.test(read('app/components/WebStream.tsx')) && /useRoomKey\(\{ source: room,/.test(read('app/components/QueueHalf.tsx')), 'app/components/WebStream.tsx: has the key, as the second half of PLAY');
// Updated on purpose 2026-11-08: since 644b121 (Luke, 2026-11-07: "pick a server... watch in the room") a media server's title plays in
// a room, so its row has the key, with what its pickers chose (server-picks.ts `roomAddFor`). This line had failed since then.
ok(/<WatchInRoomKey\b/.test(read('app/components/WebMediaRow.tsx')) && /roomAddFor\(server, media, item\.title, pick\)/.test(read('app/components/WebMediaRow.tsx')), 'a media server\'s title has the key, for the pick on the chosen server');
ok(/entry\.room === undefined \? null : <WatchInRoomKey/.test(layer), 'the float has it only for what can play in a room');
// Added on purpose 2026-11-15 (SPEC-rooms-queues.md, phase 3): outside a room the float's key is GO LIVE, the same key as
// the bar's, which carries the video on the screen and your queue into the room; in a room it is still ADD TO ROOM.
ok(/<WatchInRoomKey key=\{entry\.play\}[^>]* live \/>/.test(layer) && /key\.mode === 'start' && props\.live === true\) return <GoLiveKey screenFirst \/>/.test(roomKey), 'outside a room the float\'s key is GO LIVE');
ok(/const mine = whatToCarry\(player, screenFirst\);/.test(read('app/components/GoLiveWindow.tsx')), 'every START carries what is on and your queue');
ok(/useState<RoomPrivacy>\('private'\)/.test(read('app/components/GoLiveWindow.tsx')), 'PRIVATE already picked');
ok(/const place = roomStartFor\(videoElement, entryId\);/.test(read('app/components/WatchRoom.tsx')), 'the host\'s room starts from the place');

/* ---------------------------------------------------------------- your room's keys, folding as PIP, and the picture as a handle
 * (SPEC-rooms-your-room.md, parts 1 and 2; added 2026-11-16). The browser proof is scripts/drive-rooms-your-room.cjs. */

// The clock: what the video's own player says, so PLAY and the seek line show what it is doing, not what was last asked.
same(store.floatingClock(), null, 'nothing on: no clock');
store.playFloating({ id: 'own:c', title: 'C', shape: 'video', player: { kind: 'file', src: '/c.mp4' } });
const playC = store.floatingState().entry.play;
same(store.floatingClock(), null, 'a player that has said nothing has no clock: the keys guess nothing');
let ticks = 0;
const stopTicks = store.subscribeToFloatingClock(() => (ticks += 1));
store.noteClock(playC, { seconds: 1, duration: 60, paused: false, volume: 0.8, muted: false });
same(store.floatingClock(), { play: playC, seconds: 1, duration: 60, paused: false, volume: 0.8, muted: false }, 'what the player said');
same(ticks, 1, 'and whoever draws keys for it is told');
store.noteClock(playC, { seconds: 1.1 });
same(ticks, 1, 'a tenth of a second is not news: four a second at most');
store.noteClock(playC, { paused: true });
same([ticks, store.floatingClock().paused, store.floatingClock().seconds, store.floatingClock().duration], [2, true, 1, 60], 'a pause inside the player is heard at once, and what it did not say is kept');
store.noteClock(playC - 1, { seconds: 50, paused: false });
same([ticks, store.floatingClock().seconds], [2, 1], 'a word about a video that is no longer on is dropped');
store.noteClock(playC, { seconds: Number.NaN, duration: -4, volume: Number.NaN });
same([store.floatingClock().seconds, store.floatingClock().duration, store.floatingClock().volume], [1, 60, 0.8], 'nonsense changes nothing');
store.noteClock(playC, { volume: 7 });
same(store.floatingClock().volume, 1, 'a volume is 0 to 1');
store.playFloating({ id: 'own:d', title: 'D', shape: 'video', player: { kind: 'file', src: '/d.mp4' } });
same(store.floatingClock(), null, "a new video starts with no clock: the last one's is not shown for it");
stopTicks();
store.closeFloating();
const askedOfLayer = [];
const stopAsked = store.onFloatingOrder((order) => askedOfLayer.push(order));
store.orderFloating({ seek: 12.5 });
store.orderFloating({ volume: 0.4, muted: true });
stopAsked();
same(askedOfLayer, [{ seek: 12.5 }, { volume: 0.4, muted: true }], 'the seek line and the sound key reach the layer as orders');

// A platform's messages, read as a clock. Third-party text: nothing is assumed of it.
same(
  time.readClockMessage('youtube', JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12.5, duration: 300, playerState: 1, volume: 40, muted: false } })),
  { seconds: 12.5, duration: 300, volume: 0.4, muted: false, paused: false },
  'YouTube: where it is, how long, playing, its sound out of a hundred',
);
same(time.readClockMessage('youtube', { event: 'infoDelivery', info: { playerState: 2 } }), { paused: true }, 'YouTube paused');
same(time.readClockMessage('youtube', { event: 'infoDelivery', info: { playerState: 0 } }), { paused: true }, 'at its end it is not playing');
same(time.readClockMessage('youtube', { event: 'infoDelivery', info: { playerState: 3, currentTime: 5 } }), { seconds: 5 }, 'buffering says nothing either way about paused');
// Seen in a drive: a YouTube frame that had not started read as playing, so the key offered PAUSE to a still picture.
same(time.readClockMessage('youtube', { event: 'infoDelivery', info: { playerState: -1 } }), { paused: true }, 'not started yet is not playing: the key offers PLAY');
same(time.readClockMessage('youtube', { event: 'infoDelivery', info: { playerState: 5 } }), { paused: true }, 'nor is cued');
// A pause and a play the site asked for are heard from outside exactly as a double press on YouTube's picture is, and a
// double press is FULL: the room's own key set it off until the layer learnt to tell its own orders apart
// (scripts/drive-rooms-your-room.cjs holds it in a browser).
ok(/if \(performance\.now\(\) - orderedAt\.current < OWN_ORDER_MS\) return;/.test(read('app/components/FloatingPlayer.tsx')) && /orderedAt\.current = performance\.now\(\);/.test(read('app/components/FloatingPlayer.tsx')), "the site's own pause and play are not taken for a double press");
same(time.readClockMessage('vimeo', JSON.stringify({ event: 'timeupdate', data: { seconds: 7, duration: 90, percent: 0.07 } })), { seconds: 7, duration: 90 }, 'Vimeo: where it is and how long');
same(time.readClockMessage('vimeo', { event: 'pause', data: { seconds: 7, duration: 90 } }), { paused: true, seconds: 7, duration: 90 }, 'Vimeo paused');
same(time.readClockMessage('vimeo', { event: 'play' }), { paused: false }, 'Vimeo playing');
for (const nonsense of ['', 'not json', null, 5, '{"event":"other"}', { event: 'infoDelivery', info: null }, { event: 'infoDelivery', info: { currentTime: '5', duration: -1, volume: 'loud', playerState: '1' } }]) {
  same(time.readClockMessage('youtube', nonsense), null, `nonsense is no clock: ${JSON.stringify(nonsense)}`);
}
same(time.readClockMessage('vimeo', { event: 'timeupdate', data: { seconds: 'x' } }), null, 'nor from Vimeo');
ok(/\['timeupdate', 'ended', 'play', 'pause'\]/.test(read('app/lib/web/embed-time.ts')), 'Vimeo is asked to say when it plays and pauses, which it only does when asked');

// The picture as a handle: the hook itself, pressed and moved as a pointer does it.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const frameHook = require(join(OUT, 'lib/ui/use-float-frame.js'));
class FakeElement {
  constructor(still) {
    this.still = still;
  }
  closest(selector) {
    return this.still && selector.includes('button') ? this : null;
  }
}
globalThis.Element = FakeElement;
let floatDrag = null;
let drawnAt = { x: 100, y: 100, w: 384, h: 256 };
const writes = [];
function Probe() {
  floatDrag = frameHook.useFloatFrame(() => null, () => drawnAt, (rect) => {
    writes.push(rect);
  });
  return null;
}
renderToStaticMarkup(React.createElement(Probe));
const captured = new Set();
const pointerBox = { setPointerCapture: (id) => captured.add(id), hasPointerCapture: (id) => captured.has(id), releasePointerCapture: (id) => captured.delete(id) };
const pointer = (x, y, more = {}) => ({ button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 7, currentTarget: pointerBox, target: new FakeElement(false), stopPropagation() {}, ...more });
floatDrag.picture.onPointerDown(pointer(200, 200));
floatDrag.picture.onPointerMove(pointer(203, 202));
same([writes.length, captured.size], [0, 0], 'a press on the picture that has hardly moved is still a press: nothing moves, nothing is captured (a double press is FULL)');
floatDrag.picture.onPointerMove(pointer(260, 170));
same(writes.at(-1), { x: 160, y: 70, w: 384, h: 256 }, 'past the threshold, the picture drags the float from where the press began');
same([...captured], [7], 'and the pointer is held, so the drag carries on off the picture');
floatDrag.picture.onPointerUp(pointer(260, 170, { buttons: 0 }));
same(captured.size, 0, 'let go');
floatDrag.picture.onPointerMove(pointer(400, 400));
same(writes.length, 1, 'after that nothing follows the pointer');
floatDrag.picture.onPointerDown(pointer(10, 10, { target: new FakeElement(true) }));
floatDrag.picture.onPointerMove(pointer(90, 90));
same(writes.length, 1, 'a key on the picture keeps its own presses');
floatDrag.picture.onPointerDown(pointer(200, 200, { button: 2 }));
floatDrag.picture.onPointerMove(pointer(300, 300));
same(writes.length, 1, 'only the main button drags');
floatDrag.picture.onPointerDown(pointer(200, 200));
floatDrag.picture.onPointerMove(pointer(300, 300, { buttons: 0 }));
floatDrag.picture.onPointerMove(pointer(320, 320));
same(writes.length, 1, 'a press let go somewhere else is over: the float does not then follow a bare pointer');
// The title line sits inside the box, so its press reaches the box too: the line has it, and the picture leaves it alone.
floatDrag.bar.onPointerDown(pointer(50, 50));
floatDrag.picture.onPointerDown(pointer(50, 50));
floatDrag.picture.onPointerMove(pointer(150, 150));
same(writes.length, 1, 'a press the title line has taken is not taken twice');
floatDrag.bar.onPointerMove(pointer(150, 150));
same(writes.at(-1), { x: 200, y: 200, w: 384, h: 256 }, 'and the title line drags it as before');
floatDrag.bar.onPointerUp(pointer(150, 150, { buttons: 0 }));
// The browser's own drag (a picture, or whatever a double press left selected) takes the pointer away mid-move: found by
// scripts/drive-floating-player.cjs over YouTube's cover, where the float stopped after its first step. A press the
// handle has is refused to the browser; with no press on, the browser's drags are left alone.
let refused = 0;
const browserDrag = { preventDefault: () => (refused += 1) };
floatDrag.picture.onDragStart(browserDrag);
same(refused, 0, 'with no press on the picture, a drag of the browser\'s own is left alone');
floatDrag.picture.onPointerDown(pointer(200, 200));
floatDrag.picture.onPointerMove(pointer(230, 230));
floatDrag.picture.onDragStart(browserDrag);
same(refused, 1, 'during a press on the picture the browser\'s own drag is refused, so the float keeps the pointer');
floatDrag.picture.onPointerUp(pointer(230, 230, { buttons: 0 }));
floatDrag.picture.onDragStart(browserDrag);
same(refused, 1, 'and not after it');
delete globalThis.Element;

// Bigger grips, on both floats; the windows keep theirs.
const corners = frameHook.FLOAT_GRIPS.filter((grip) => Object.keys(grip.edges).length === 2);
same([frameHook.FLOAT_GRIPS.length, corners.length], [8, 4], 'eight grips, four of them corners');
ok(corners.every((grip) => /\bh-5 w-5\b/.test(grip.className)), 'each corner a 20px square');
ok(/h-3 w-3 cursor-nwse-resize/.test(read('app/components/DockWindow.tsx')), "where a window's corner is 12px");
const floatChrome = read('app/components/RoomFloatChrome.tsx');
ok(/FLOAT_GRIPS\.map/.test(layer) && /FLOAT_GRIPS\.map/.test(floatChrome), "the site's float and a room's floating picture both draw them");
ok(/\{\.\.\.\(pictureFloats \? floatDrag\.picture : \{\}\)\}/.test(read('app/components/WatchRoom.tsx')), "a room's floating picture is a handle itself");
ok(!/inset-0/.test(floatChrome), 'and still nothing is laid over the picture to catch presses');

// Folding a room is PIP: the folded tile above the bar is gone, so the picture has the way back and no key to put it away.
const roomWindow = read('app/components/WatchWindow.tsx');
ok(!/data-watch-tv-box|function UpBox|<OwnRoomDoor folded/.test(roomWindow), 'no folded tile above the bar, for a live room or for yours');
ok(/pictureFloats=\{collapsed\}/.test(roomWindow) && /onMinimize=\{drawn \? onCollapse : undefined\}/.test(roomWindow), "a room's [ _ ] puts its picture out");
ok(/if \(collapsed && !drawn\) expandWatch\(\);/.test(roomWindow), 'a folded room with no picture left to float comes back as its window: it is never left with no way back');
ok(/Back to the room/.test(floatChrome) && !/Hide the picture/.test(floatChrome), 'the floating picture has BACK and no key that would leave a playing room with no way back');
ok(/box\.closest\('\[data-minimized="true"\]'\) !== null\) expandWatch\(\);/.test(layer), "BACK on the site's float brings back your room's folded window");
ok(!/collapseWatch/.test(read('app/lib/watch/use-music-room.ts')), 'joining a room opens it as a window: nothing folds it by itself');

// Another site's own fullscreen key is switched off where the site's own FULL works (Luke, 2026-11-16: "Switch it off"): theirs
// shows the bare player with black bars, ours the box with the chosen background (SPEC-rooms-your-room.md, part 3).
ok(store.withoutFullscreen('autoplay; fullscreen') === 'autoplay', 'fullscreen is taken out of a frame\'s permissions, the rest kept');
ok(store.withoutFullscreen('fullscreen') === '', 'a frame allowed only fullscreen is allowed nothing');
ok(store.withoutFullscreen('autoplay; Fullscreen *; encrypted-media; picture-in-picture') === 'autoplay; encrypted-media; picture-in-picture', 'however it is written, and nothing else goes with it');
ok(store.withoutFullscreen('autoplay') === 'autoplay' && store.withoutFullscreen('') === '', 'a frame that never had it is left as it was');
{
  const had = globalThis.document;
  try {
    delete globalThis.document;
    ok(store.siteFullscreenWorks() === false, 'with no document (the server) the site\'s fullscreen is not counted on');
    globalThis.document = { fullscreenEnabled: false };
    ok(store.siteFullscreenWorks() === false, 'a browser that cannot fullscreen a box (an iPhone) keeps the other site\'s own key: the only one that works there');
    globalThis.document = { fullscreenEnabled: true };
    ok(store.siteFullscreenWorks() === true, 'a browser that can is given the site\'s');
  } finally {
    if (had === undefined) delete globalThis.document;
    else globalThis.document = had;
  }
}
ok(/allow=\{ownFull \? withoutFullscreen\(player\.allow\) : player\.allow\}/.test(layer) && /allowFullScreen=\{ownFull \? false : player\.allowFullScreen\}/.test(layer), 'the layer\'s frame is given no fullscreen of its own where the site\'s works');
ok(/fullscreen: !siteFullscreenWorks\(\)/.test(read('app/lib/watch/vimeo-player.ts')) && /allowfullscreen: !siteFullscreenWorks\(\)/.test(read('app/lib/watch/twitch-player.ts')), 'nor Vimeo\'s and Twitch\'s players in a room');
ok(/fs: 0/.test(read('app/lib/watch/youtube-player.ts')), 'nor YouTube\'s (it never had one there)');
// A key with no permission behind it would be drawn and do nothing: the two players that have a word for "no key" are told it.
ok(new URL(store.withoutFullscreenKey('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&enablejsapi=1', 'youtube')).searchParams.get('fs') === '0', 'YouTube is asked for no fullscreen key');
ok(new URL(store.withoutFullscreenKey('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&fs=1', 'youtube')).search === '?autoplay=1&fs=0', 'over whatever its address said, the rest of the address kept');
ok(new URL(store.withoutFullscreenKey('https://player.vimeo.com/video/76979871?h=8272103f6e', 'vimeo')).search === '?h=8272103f6e&fullscreen=0', 'Vimeo too, in its own word');
ok(store.withoutFullscreenKey('https://archive.org/embed/some_film', null) === 'https://archive.org/embed/some_film' && store.withoutFullscreenKey('not an address', 'youtube') === 'not an address', 'any other player\'s address, and nonsense, is left exactly as it is');
ok(/src=\{ownFull \? withoutFullscreenKey\(player\.src, player\.timeFrom\) : player\.src\}/.test(layer), 'the layer\'s frame asks it, where the site\'s fullscreen works');

console.log(`ok: ${count} assertions (floating player, site arrows)`);
