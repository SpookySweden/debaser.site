/*
 * The floating player and the site's arrows (SPEC-floating-player.md), offline. From the root:
 *   npx tsc app/lib/ui/float-geometry.ts app/lib/ui/floating-player.ts app/lib/ui/site-history.ts app/lib/web/embed-time.ts app/lib/watch/room-start.ts --rootDir app --outDir Temp/out-floating-player --module commonjs --target es2022 --lib es2022,dom,dom.iterable --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
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
same((layer.match(/key=\{playKey\}/g) ?? []).length, 2, 'each under one key per PLAY, never a key that changes on floating');
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
ok(nav.indexOf('<SiteArrows />') > -1 && nav.indexOf('<SiteArrows />') < nav.indexOf('HEADER_ITEMS.map'), 'the arrows sit left of PROJECTS');
const arrows = read('app/components/SiteArrows.tsx');
ok(/\[ ◄ \]/.test(arrows) && /\[ ► \]/.test(arrows), 'the arrows are bracket keys');
ok(/aria-label="Back"/.test(arrows) && /aria-label="Forward"/.test(arrows), 'named for a screen reader');
ok(/disabled=\{!back\}/.test(arrows) && /disabled=\{!forward\}/.test(arrows), 'quiet when there is nowhere to go');
ok(/pointer-coarse:min-h-tap/.test(arrows), 'a full tap size for a finger');
ok(/data-scroll-pane="page"/.test(read('app/components/SiteWindow.tsx')), 'the page\'s pane is named for its place');
const keeper = read('app/components/SiteHistoryKeeper.tsx');
ok(/closest\('main'\)/.test(keeper), 'only panes in the page count');
ok(/THE_READER_ACTS/.test(keeper), 'the reader doing anything stops a place being put back');
ok(!/transition/.test(layer) && !/animate-/.test(layer), 'nothing moves but what the reader moves: nothing to stop under reduced motion');

/* ---------------------------------------------------------------- WATCH IN ROOM (part 3) */
const roomStart = require(join(OUT, 'lib/watch/room-start.js'));
same(roomStart.takeRoomStart('e1'), null, 'no place: from the top');
roomStart.noteRoomStart('e1', 90.5);
same(roomStart.takeRoomStart('e2'), null, 'a place belongs to its own row');
same(roomStart.takeRoomStart('e1'), 90.5, 'the room starts from where the viewer had got to');
same(roomStart.takeRoomStart('e1'), null, 'once, so the host can go back to the top');
roomStart.noteRoomStart('e3', 0.4);
same(roomStart.takeRoomStart('e3'), null, 'under a second is the top');
roomStart.noteRoomStart('e4', null);
same(roomStart.takeRoomStart('e4'), null, 'a player that cannot tell starts from the top');
const roomKey = read('app/components/WatchInRoomKey.tsx');
ok(/\[ WATCH IN ROOM \]/.test(roomKey) && /\[ ADD TO ROOM \]/.test(roomKey), 'one key with both words');
for (const path of ['app/components/WebStream.tsx', 'app/components/WebSiteFiles.tsx', 'app/components/MediaCatalogue.tsx', 'app/components/FloatingPlayer.tsx']) ok(/<WatchInRoomKey\b/.test(read(path)), `${path}: has the key`);
ok(!/<WatchInRoomKey\b/.test(read('app/components/WebMediaRow.tsx')), 'a media server\'s title can\'t play in a room: no key');
ok(/entry\.room === undefined \? null : <WatchInRoomKey/.test(layer), 'the float has it only for what can play in a room');
ok(/useState<RoomPrivacy>\('private'\)/.test(read('app/components/GoLiveWindow.tsx')), 'PRIVATE already picked');
ok(/const place = takeRoomStart\(entryId\);/.test(read('app/components/WatchRoom.tsx')), 'the host\'s room starts from the place');

console.log(`ok: ${count} assertions (floating player, site arrows)`);
