/*
 * Scratch check for watch together (SPEC-watch-together.md), run from the root:
 *   npx tsc app/lib/watch/rules.ts app/lib/watch/watch-window.ts app/lib/watch/mock-watch-repository.ts app/lib/watch/steady-timer.ts app/lib/forum/site-author.ts app/lib/forum/board-query.ts --outDir Temp/watch-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/WatchWindow.tsx app/components/StreamRecord.tsx app/components/StreamChatFolds.tsx --outDir Temp/watch-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 * (2026-11-04) The next steps compile all it requires: it had been passing on what earlier runs left in Temp/.
 *   npx tsc app/lib/watch/rules.ts app/lib/watch/watch-window.ts app/lib/watch/mock-watch-repository.ts app/lib/forum/site-author.ts app/lib/forum/board-query.ts app/lib/watch/steady-timer.ts --rootDir app/lib --outDir Temp/watch-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/media/catalogue.ts app/components/AuthProvider.tsx app/components/ForumProvider.tsx app/components/MusicPlayerProvider.tsx app/components/PresenceProvider.tsx app/components/PopoutWindow.tsx app/components/DockWindow.tsx app/components/WatchWindow.tsx app/components/WatchRoom.tsx app/components/StreamQueueWindow.tsx app/components/StreamRecord.tsx app/components/StreamChatFolds.tsx app/lib/watch/watch-window.ts app/lib/watch/use-watch-room.ts --rootDir app --outDir Temp/watch-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-watch.cjs
 *
 * The rules (sync, queue, handover), the mock store (which keeps the database's rules by hand), and the
 * screens drawn: the window before going live (account / guest), the room (host / viewer / guest / ended),
 * the forum record and the archive's folds.
 */
const assert = require('node:assert/strict');

const rules = require('./watch-out/watch/rules.js');
const windowStore = require('./watch-out/watch/watch-window.js');
const { getMockWatchRepository, resetMockWatch } = require('./watch-out/watch/mock-watch-repository.js');
const { displayTitle, isItemOwnedThread } = require('./watch-out/forum/site-author.js');
const { selectBoardThreads } = require('./watch-out/forum/board-query.js');

let passed = 0;
function ok(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  ${label}`);
    });
}

const T0 = Date.parse('2026-10-27T20:00:00.000Z');
const at = (ms) => new Date(T0 + ms).toISOString();
const room = (patch = {}) => ({
  id: 'r1',
  originalHostId: 'a',
  originalHostLabel: 'Alice',
  hostId: 'a',
  forumThreadId: null,
  currentEntryId: 'e1',
  positionSeconds: 10,
  isPlaying: true,
  startedAt: at(0),
  updatedAt: at(0),
  endedAt: null,
  ...patch,
});
const member = (key, userId, joinedAt, name = key) => ({ key, userId, name, joinedAt });

(async () => {
  rules.resetWatchClock();

  // 1. Where the host is.
  await ok('a playing host is walked forward by the row age; a paused one is held', () => {
    assert.equal(rules.hostPosition(room(), T0 + 3000), 13);
    assert.equal(rules.hostPosition(room({ isPlaying: false }), T0 + 3000), 10);
    assert.equal(rules.hostPosition(room({ positionSeconds: 9 }), T0 + 5000, 10), 10, 'never past the end');
  });

  await ok('live means not ended and written in the last 90s', () => {
    assert.equal(rules.roomIsLive(room(), T0 + 30000), true);
    assert.equal(rules.roomIsLive(room(), T0 + 91000), false);
    assert.equal(rules.roomIsLive(room({ endedAt: at(1) }), T0 + 2000), false);
  });

  // 2. Following.
  await ok('a follower jumps when over 2s off, nudges inside it, holds when close', () => {
    const mine = (seconds, extra = {}) => ({ seconds, duration: 60, playing: true, ended: false, ...extra });
    const host = room({ positionSeconds: 20 });
    assert.deepEqual(rules.viewerStep(host, mine(15), T0), { at: 20, rate: 1, playing: true });
    assert.deepEqual(rules.viewerStep(host, mine(19), T0), { at: undefined, rate: rules.CATCH_UP_RATE, playing: true });
    assert.deepEqual(rules.viewerStep(host, mine(21), T0), { at: undefined, rate: rules.HOLD_BACK_RATE, playing: true });
    assert.deepEqual(rules.viewerStep(host, mine(20.1), T0), { at: undefined, rate: 1, playing: true });
    assert.deepEqual(rules.viewerStep(room({ positionSeconds: 20, isPlaying: false }), mine(20.2), T0), { at: undefined, rate: 1, playing: false });
    assert.deepEqual(rules.viewerStep(room({ positionSeconds: 20, isPlaying: false }), mine(25), T0), { at: 20, rate: 1, playing: false });
  });

  await ok('at the end of the file a follower waits for the host to loop, then jumps back', () => {
    const ended = { seconds: 10, duration: 10, playing: false, ended: true };
    assert.deepEqual(rules.viewerStep(room({ positionSeconds: 9.9 }), ended, T0 + 500), { at: undefined, rate: 1, playing: false });
    assert.deepEqual(rules.viewerStep(room({ positionSeconds: 0 }), ended, T0 + 200), { at: 0.2, rate: 1, playing: true });
  });

  // 3. The queue.
  // (2026-11-04, SPEC-stream-queue.md) `inQueue` is new: an addition waits on its adder's list until it is pulled into the
  // queue. `link` and `series` are new too: an entry may be a link rather than a file, or an episode of a series.
  const entry = (id, patch = {}) => ({ id, roomId: 'r1', position: 0, inQueue: true, link: null, series: null, mediaItemId: `m-${id}`, addedBy: 'a', addedAt: at(0), playedAt: null, playIndex: null, ...patch });
  const queue = [
    entry('e1', { position: 0, playedAt: at(0), playIndex: 0 }),
    entry('e2', { position: 1 }),
    entry('e3', { position: 2 }),
    entry('e4', { position: 3, playedAt: at(5), playIndex: 1 }),
  ];
  await ok('play order is the order played; upcoming is the order queued', () => {
    assert.deepEqual(rules.playOrder(queue).map((e) => e.id), ['e1', 'e4']);
    assert.deepEqual(rules.upcoming(queue).map((e) => e.id), ['e2', 'e3']);
    assert.deepEqual(rules.upcoming([...queue, entry('e5', { position: 4, inQueue: false })]).map((e) => e.id), ['e2', 'e3'], 'an addition still waiting on a list is not upcoming');
    assert.equal(rules.nextPlayIndex(queue), 2);
    assert.equal(rules.nextQueuePosition(queue), 4);
    assert.equal(rules.queueBadge({ room: room({ currentEntryId: 'e4' }), queue, messages: [] }), '2 OF 4');
  });

  await ok('reordering swaps neighbours among what is still to play, and nothing at the ends', () => {
    assert.deepEqual(rules.moveInQueue(queue, 'e3', -1), [
      { id: 'e3', position: 1 },
      { id: 'e2', position: 2 },
    ]);
    assert.deepEqual(rules.moveInQueue(queue, 'e2', -1), []);
    assert.deepEqual(rules.moveInQueue(queue, 'e3', 1), []);
  });

  // 4. Who hosts next.
  await ok('handover goes to the signed-in account here longest; guests and the leaver never', () => {
    const members = [member('tab-a', 'a', 1), member('guest', null, 2), member('tab-c', 'c', 5, 'Cleo'), member('tab-b', 'b', 3, 'Bob'), member('tab-b2', 'b', 9)];
    assert.equal(rules.handoverTo(members, 'a').userId, 'b');
    assert.equal(rules.handoverTo([member('tab-a', 'a', 1), member('g', null, 2)], 'a'), null);
    assert.equal(rules.accountsPresent(members).length, 3);
    assert.equal(rules.guestsPresent(members), 1);
  });

  await ok('only the heir tab asks to take over, and only while the host is missing', () => {
    const without = [member('tab-c', 'c', 5), member('tab-b', 'b', 3), member('tab-b2', 'b', 9)];
    assert.equal(rules.shouldTakeOver(without, 'a', 'tab-b'), true);
    assert.equal(rules.shouldTakeOver(without, 'a', 'tab-b2'), false, "the same account's later tab");
    assert.equal(rules.shouldTakeOver(without, 'a', 'tab-c'), false);
    assert.equal(rules.shouldTakeOver([...without, member('tab-a', 'a', 1)], 'a', 'tab-b'), false, 'host still here');
  });

  // 5. Words.
  await ok('times, titles and fold labels read as the spec spells them', () => {
    assert.equal(rules.formatMediaTime(134.7), '02:14');
    assert.equal(rules.formatMediaTime(3734), '1:02:14');
    assert.equal(rules.streamThreadTitle('Test Account A', '2026-10-27T23:30:00.000Z'), 'STREAM :: TEST ACCOUNT A :: 2026-10-27');
    assert.equal(rules.streamFoldLabel('Bob', '2026-10-27T01:00:00Z', 1), '2026-10-27 :: HOSTED BY BOB :: 1 MESSAGE');
    assert.equal(rules.streamFoldLabel('Bob', '2026-10-27T01:00:00Z', 3), '2026-10-27 :: HOSTED BY BOB :: 3 MESSAGES');
  });

  // 6. The forum record.
  const thread = (anchor, patch = {}) => ({
    id: 't',
    title: 'STREAM :: ALICE :: 2026-10-27',
    body: '',
    author: { id: 'a', displayName: 'Alice' },
    createdAt: at(0),
    anchor,
    tags: [],
    comments: [],
    origin: 'user',
    ...patch,
  });
  await ok('a stream thread is a board post that names its room, keeps its title, and has its own filter', () => {
    const anchor = rules.streamAnchor('room-9');
    assert.equal(anchor.kind, 'board');
    assert.equal(rules.streamRoomId(anchor), 'room-9');
    assert.equal(rules.streamRoomId({ kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }), null);
    const record = thread(anchor);
    assert.equal(isItemOwnedThread(record), false, 'empty body, but not an item thread');
    assert.equal(displayTitle(record), 'STREAM :: ALICE :: 2026-10-27');
    const plain = thread({ kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, { id: 'p', title: 'HELLO', body: 'hi' });
    const options = { query: '', sourceFilter: 'stream', tagKeys: [], tagMatchMode: 'any', sortMode: 'newest' };
    assert.deepEqual(selectBoardThreads([record, plain], options).map((t) => t.id), ['t']);
    assert.equal(selectBoardThreads([record, plain], { ...options, sourceFilter: 'board' }).length, 2);
  });

  // 7. The window's address.
  await ok('the window reads and spells its two addresses', () => {
    assert.equal(windowStore.watchHref({ kind: 'room', roomId: 'abc' }), '/forum?watch=abc');
    assert.equal(windowStore.watchHref({ kind: 'prelive', mediaItemId: 'm1' }), '/forum?watch=new&media=m1');
    assert.deepEqual(windowStore.watchFocusFromSearch('?watch=abc'), { kind: 'room', roomId: 'abc' });
    assert.deepEqual(windowStore.watchFocusFromSearch('?watch=new&media=m1'), { kind: 'prelive', mediaItemId: 'm1' });
    // Changed on purpose 2026-11-03: `?watch=new` with no file is the side panel's GO LIVE key (the
    // pre-live window with the newest video loaded), so it is a pre-live window, not "nothing".
    // (2026-11-04, SPEC-cytube.md) That desktop-branch rule did not survive: GO LIVE (CYTUBE and the side panel) now calls
    // `goLiveEmpty` and opens an empty room with no address of this kind, so `?watch=new` with no file is nothing again.
    assert.equal(windowStore.watchFocusFromSearch('?watch=new'), null);
    assert.equal(windowStore.watchFocusFromSearch('?watch=new&media='), null);
    assert.equal(windowStore.watchFocusFromSearch('?arcade=1'), null);
  });

  // 7b. The GO LIVE key opens the pre-live window, shuts it on a second press, and never shuts a room
  //     (leaving a room goes through the room's own prompt).
  // (2026-11-04, SPEC-cytube.md) There is no pre-live window to toggle any more: GO LIVE opens an empty room in one press
  // (`goLiveEmpty`, shared by CYTUBE and the side panel). What this held still holds in the new shape: a host's key
  // never starts a second room, it goes back to the one they are in; and the store's window opens and shuts as before.
  await ok('GO LIVE opens one shared empty room, and a host is sent back to theirs rather than given a second', () => {
    for (const file of ['app/components/CytubePage.tsx', 'app/components/DesktopSidebar.tsx']) {
      const source = require('node:fs').readFileSync(file, 'utf8');
      assert.match(source, /goLiveEmpty\(/, `${file} starts a room through the shared call`);
      assert.match(source, /hosting === null \? '(\[ )?GO LIVE( \])?' : '(\[ )?BACK TO YOUR ROOM( \])?'/, `${file} offers a host the way back instead`);
    }
    assert.equal(windowStore.toggleGoLive, undefined, 'and the old toggle is gone from the window store');
    windowStore.closeWatch();
    assert.equal(windowStore.watchWindowState().open, false);
    windowStore.openWatch({ kind: 'room', roomId: 'r1' });
    assert.deepEqual(windowStore.watchWindowState().focus, { kind: 'room', roomId: 'r1' });
    windowStore.closeWatch();
    assert.equal(windowStore.watchWindowState().open, false);
  });

  // 8. The mock store keeps the database's rules.
  resetMockWatch();
  const repo = getMockWatchRepository();
  const realNow = Date.now;
  let read;
  await ok('GO LIVE opens a room with its file as play 0, on screen and playing', async () => {
    read = await repo.openRoom({ id: 'room-1', host: { id: 'a', label: 'Alice' }, mediaItemId: 'video-1' });
    assert.equal(read.room.hostId, 'a');
    assert.equal(read.room.isPlaying, true);
    assert.equal(read.queue[0].playIndex, 0);
    assert.equal(read.room.currentEntryId, read.queue[0].id);
    await repo.attachThread('room-1', 'thread-1');
    assert.equal((await repo.readRoom('room-1')).room.forumThreadId, 'thread-1');
  });

  await ok('a watcher adds, the host starts it: it becomes play 1 and the room points at it', async () => {
    const added = await repo.addToQueue({ roomId: 'room-1', mediaItemId: 'video-2', addedBy: 'b', position: 1 });
    assert.equal(added.playedAt, null);
    await repo.startEntry('room-1', added.id, 1);
    const now = await repo.readRoom('room-1');
    assert.equal(now.room.currentEntryId, added.id);
    assert.equal(now.queue.find((e) => e.id === added.id).playIndex, 1);
    await repo.removeFromQueue(added.id);
    assert.equal((await repo.readRoom('room-1')).queue.length, 2, 'a file that played stays on the record');
  });

  await ok('chat carries the play and the in-video time', async () => {
    const current = (await repo.readRoom('room-1')).room.currentEntryId;
    const message = await repo.sendMessage({ roomId: 'room-1', queueEntryId: current, mediaItemId: 'video-2', author: { id: 'b', label: 'Bob' }, body: '  hello  ', mediaSeconds: 134.4 });
    assert.equal(message.body, 'hello');
    assert.equal(message.mediaSeconds, 134.4);
    await assert.rejects(repo.sendMessage({ roomId: 'room-1', queueEntryId: current, mediaItemId: 'video-2', author: { id: 'b', label: 'Bob' }, body: '   ', mediaSeconds: 1 }));
  });

  await ok('a take-over is refused while the host is writing, won once they have been quiet 8s, by one caller', async () => {
    assert.equal(await repo.takeOver('room-1', 'a', 'b'), false, 'host just wrote');
    Date.now = () => realNow() + 9000;
    try {
      assert.equal(await repo.takeOver('room-1', 'z', 'b'), false, 'not the host the caller saw');
      const [first, second] = await Promise.all([repo.takeOver('room-1', 'a', 'b'), repo.takeOver('room-1', 'a', 'c')]);
      assert.equal(first !== second, true, 'exactly one wins');
    } finally {
      Date.now = realNow;
    }
    const now = await repo.readRoom('room-1');
    assert.equal(['b', 'c'].includes(now.room.hostId), true);
    assert.equal(now.room.originalHostId, 'a', 'the original host is kept');
  });

  await ok('an ended room takes no more chat or files, and a second stream of a file is a second fold, newest first', async () => {
    await repo.endRoom('room-1');
    await assert.rejects(repo.sendMessage({ roomId: 'room-1', queueEntryId: null, mediaItemId: 'video-1', author: { id: 'b', label: 'Bob' }, body: 'late', mediaSeconds: 0 }));
    await assert.rejects(repo.addToQueue({ roomId: 'room-1', mediaItemId: 'video-1', addedBy: 'b', position: 9 }));

    Date.now = () => realNow() + 60000;
    try {
      await repo.openRoom({ id: 'room-2', host: { id: 'c', label: 'Cleo' }, mediaItemId: 'video-2' });
    } finally {
      Date.now = realNow;
    }
    const folds = await repo.listStreamFolds(['video-1', 'video-2', 'video-3']);
    assert.deepEqual(folds['video-2'].map((fold) => fold.room.id), ['room-2', 'room-1']);
    assert.equal(folds['video-2'][1].messages.length, 1);
    assert.equal(folds['video-1'].length, 1);
    assert.equal(folds['video-3'], undefined, 'never streamed: no folds');
  });


  await ok('the steady timer beats, and stops when told (here, with no Worker, on the plain timer)', async () => {
    const { steadyInterval } = require('./watch-out/watch/steady-timer.js');
    assert.equal(typeof Worker, 'undefined', 'Node has no page Worker: this exercises the fallback');
    let beats = 0;
    const stop = steadyInterval(() => (beats += 1), 250);
    await new Promise((resolve) => setTimeout(resolve, 900));
    stop();
    const heard = beats;
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(heard >= 3, true, `${heard} beats in 900ms`);
    assert.equal(beats, heard, 'none after stop');
  });

  // 9. The screens, drawn (server render; effects do not run, so this is what each first paints).
  const Module = require('node:module');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const element = React.createElement;
  const stub = (relative, exports) => {
    const resolved = require.resolve(relative);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
  };
  let viewer = null;
  const ACCOUNT_A = { id: 'a', displayName: 'TEST ACCOUNT A' };
  const VIDEO = { id: 'v1', kind: 'video', bucket: 'video', path: 'a/x.webm', src: 'https://x.supabase.co/storage/v1/object/public/video/a/x.webm', sha256: 's', bytes: 1, mime: 'video/webm', length: '0:10', title: 'TEST SIGNAL // LOOP', credit: '', tags: [], source: 'upload', uploadedBy: 'a', uploadedByLabel: 'TEST ACCOUNT A', createdAt: at(0) };
  const realCatalogue = require('./watch-render/lib/media/catalogue.js');
  stub('./watch-render/lib/media/catalogue.js', { ...realCatalogue, useCatalogue: () => ({ entries: [{ item: VIDEO, uses: [] }], items: [VIDEO], answered: true, loading: false, bytesUsed: 1, reload: () => undefined }) });
  stub('./watch-render/components/AuthProvider.js', { default: ({ children }) => children, useAuth: () => ({ user: viewer, status: 'ready' }) });
  stub('./watch-render/components/ForumProvider.js', { useForum: () => ({ createThread: async () => ({ id: 't' }) }) });
  // (2026-11-04) The queue window lists the shelf's songs in its search, so the player answers with an empty shelf.
  stub('./watch-render/components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ playing: false, steer: () => undefined, queue: [], shelfSize: 0 }) });
  stub('./watch-render/components/PresenceProvider.js', { default: ({ children }) => children, usePresence: () => ({ ready: true, status: 'offline', record: undefined }) });
  // (2026-11-04) The queue window is a pop-up, which only draws through a portal in a browser, so a render sees its insides.
  stub('./watch-render/components/PopoutWindow.js', { default: ({ title, children }) => element('div', { 'data-window': title }, children) });
  stub('./watch-render/components/DockWindow.js', {
    default: ({ title, badge, children }) => element('aside', { 'data-title': title, 'data-badge': badge ?? '' }, children),
  });
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'next/navigation') return { useSearchParams: () => new URLSearchParams(''), usePathname: () => '/forum', useRouter: () => ({ replace: () => undefined, push: () => undefined }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  const WatchWindow = require('./watch-render/components/WatchWindow.js').default;
  const WatchRoom = require('./watch-render/components/WatchRoom.js').default;
  const StreamQueueWindow = require('./watch-render/components/StreamQueueWindow.js').default;
  const StreamRecord = require('./watch-render/components/StreamRecord.js').default;
  const StreamChatFolds = require('./watch-render/components/StreamChatFolds.js').default;
  const renderWindow = require('./watch-render/lib/watch/watch-window.js');
  const { primeRoom } = require('./watch-render/lib/watch/use-watch-room.js');
  const html = (node) => renderToStaticMarkup(node);

  // (2026-11-04, SPEC-cytube.md) GO LIVE is only on the CYTUBE page: an old `?watch=new&media=` address shows the file and
  // points there, and nothing in this window starts a room. The window's state has a server answer now (closed), so a static
  // render is handed the live state to draw what a browser draws once it has read the address.
  renderWindow.watchWindowServerState = renderWindow.watchWindowState;
  await ok('an old pre-live address: the host gets the file and a key to CYTUBE; a guest is told to log in', () => {
    renderWindow.openWatch({ kind: 'prelive', mediaItemId: 'v1' });
    viewer = ACCOUNT_A;
    const host = html(element(WatchWindow));
    assert.match(host, /data-title="STREAM :: TEST ACCOUNT A"/);
    assert.match(host, /data-badge="NOT LIVE"/);
    assert.match(host, /href="\/cytube"[^>]*>\[ GO LIVE ON CYTUBE \]/);
    assert.doesNotMatch(host, /\[ GO LIVE \]/, 'and no key here that starts a room itself');
    assert.match(host, /<video[^>]*src="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/video\/a\/x\.webm"/);
    viewer = null;
    const guest = html(element(WatchWindow));
    assert.doesNotMatch(guest, /GO LIVE/);
    assert.match(guest, /\[ LOG IN \]<\/a> TO STREAM/);
    renderWindow.closeWatch();
  });

  const now = new Date().toISOString();
  // (2026-11-04, SPEC-stream-queue.md, SPEC-music-queues.md) A room's read now carries its crowns (arranging the queue is a
  // crown's right, so the host wears one here), and a room says what it is.
  const liveRead = {
    crowns: [{ roomId: 'room-r', userId: 'a', givenBy: 'a', givenAt: now }],
    room: room({ id: 'room-r', currentEntryId: 'q2', updatedAt: now, forumThreadId: 'th-1', origin: 'stream', isPublic: true, clearedAt: null }),
    queue: [
      entry('q1', { roomId: 'room-r', mediaItemId: 'v1', playedAt: now, playIndex: 0 }),
      entry('q2', { roomId: 'room-r', mediaItemId: 'v1', position: 1, playedAt: now, playIndex: 1 }),
      entry('q3', { roomId: 'room-r', mediaItemId: 'v1', position: 2 }),
    ],
    messages: [
      { id: 'm1', roomId: 'room-r', queueEntryId: 'q1', mediaItemId: 'v1', authorId: 'b', authorLabel: 'TEST ACCOUNT B', body: 'look at the bars', mediaSeconds: 134.2, createdAt: now },
    ],
  };
  const noop = () => undefined;
  // (2026-11-04) The room asks whether its element is a real video (picture-in-picture, WatchRoom.tsx). It only ever draws
  // in a browser, since the window's server state is closed; Node has no such class, so this render gets an empty one.
  globalThis.HTMLVideoElement = globalThis.HTMLVideoElement ?? class {};

  // (2026-11-04, SPEC-stream-queue.md, SPEC-less-text.md, SPEC-readability.md) The room's words moved. The transport keys are
  // the bare marks, read by their aria-label; the send key is a mark too. The queue (its rows, host keys and [ + ADD ]) is no
  // longer on the page: it is `StreamQueueWindow`, behind the room's [ QUEUE ] key, so the same rules are held on that
  // window, drawn directly. The `2 OF 3` badge and `YOU ARE HOSTING` on a video room are gone (only a music bar still says it).
  const queueWindow = (userId) =>
    html(element(StreamQueueWindow, { read: liveRead, itemsById: new Map([['v1', VIDEO]]), live: true, userId, members: [], nowLive: false, onClose: noop }));

  await ok('the room for its host: transport, END STREAM, the queue key and window with its host keys, the timed chat, the field', () => {
    viewer = ACCOUNT_A;
    const page = html(element(WatchRoom, { read: liveRead, closing: false, onStay: noop, onLeft: noop }));
    assert.match(page, /aria-label="(Play|Pause)"/);
    assert.match(page, /title="Skip"/);
    assert.match(page, /\[ END STREAM \]/);
    assert.match(page, /CURRENT VIDEO:[\s\S]{0,400}TEST SIGNAL \/\/ LOOP/);
    assert.match(page, /\[ QUEUE \]/);
    // (2026-11-04) A chat line now reads name first, then the in-video time, then the words.
    assert.match(page, new RegExp('TEST ACCOUNT B[^]*02:14[^]*look at the bars'));
    assert.match(page, /aria-label="Send"/);
    const queue = queueWindow('a');
    assert.equal((queue.match(/data-queue-state="played"/g) ?? []).length, 1, 'what has played is marked');
    assert.equal((queue.match(/data-queue-state="now"/g) ?? []).length, 1, 'and exactly one row is on screen');
    assert.equal((queue.match(/data-queue-state="queued"/g) ?? []).length, 1, 'and what is still to come');
    assert.match(queue, /aria-label="Take TEST SIGNAL \/\/ LOOP out"/);
    // (2026-11-04) Adding starts at the window's search: `[ + ADD ]` appears on a result or a typed link, so the box is what is held.
    assert.match(queue, /id="stream-queue-search"/);
  });

  await ok('a signed-in viewer: no transport, but chat and [ + ADD ]; a guest: neither, [ LOG IN ] TO TALK', () => {
    viewer = { id: 'b', displayName: 'TEST ACCOUNT B' };
    const watcher = html(element(WatchRoom, { read: liveRead, closing: false, onStay: noop, onLeft: noop }));
    assert.doesNotMatch(watcher, /END STREAM|title="Skip"|aria-label="(Play|Pause)"|YOU ARE HOSTING/);
    assert.match(watcher, /aria-label="Send"/);
    const watcherQueue = queueWindow('b');
    assert.doesNotMatch(watcherQueue, /Take TEST SIGNAL/);
    assert.match(watcherQueue, /id="stream-queue-search"/);
    viewer = null;
    const guest = html(element(WatchRoom, { read: liveRead, closing: false, onStay: noop, onLeft: noop }));
    assert.doesNotMatch(guest, /aria-label="Send"|watch-chat/);
    const guestQueue = queueWindow(null);
    assert.doesNotMatch(guestQueue, /\+ ADD|id="stream-queue-search"/);
    assert.match(guestQueue, /\[ LOG IN \]<\/a> TO ADD VIDEOS/);
    assert.match(guest, /\[ LOG IN \]<\/a> TO TALK/);
    assert.match(guest, /look at the bars/, 'guests read the chat');
  });

  await ok('an ended room says so and links its record; nobody gets controls', () => {
    viewer = ACCOUNT_A;
    const ended = { ...liveRead, room: { ...liveRead.room, endedAt: now } };
    const page = html(element(WatchRoom, { read: ended, closing: false, onStay: noop, onLeft: noop }));
    assert.match(page, /STREAM ENDED\./);
    assert.match(page, /href="\/forum#thread-th-1"[^>]*>\[ READ THE RECORD \]/);
    // (2026-11-04) The send key is a mark and [ + ADD ] is in the queue window, as above.
    assert.doesNotMatch(page, /END STREAM|aria-label="Send"/);
    assert.doesNotMatch(html(element(StreamQueueWindow, { read: ended, itemsById: new Map([['v1', VIDEO]]), live: false, userId: 'a', members: [], nowLive: false, onClose: noop })), /\+ ADD|id="stream-queue-search"/);
  });

  await ok('the forum record: host, LIVE and a WATCH key while it runs, the plays in order with their lines counted', () => {
    primeRoom(liveRead);
    const live = html(element(StreamRecord, { roomId: 'room-r' }));
    assert.match(live, /HOSTED BY/);
    assert.match(live, />LIVE</);
    assert.match(live, /href="\/forum\?watch=room-r"[^>]*>\[ ▶ WATCH \]/);
    assert.match(live, /1\. TEST SIGNAL \/\/ LOOP :: 1 MESSAGE<[\s\S]*2\. TEST SIGNAL \/\/ LOOP :: 0 MESSAGES/);
    primeRoom({ ...liveRead, room: { ...liveRead.room, endedAt: now } });
    const over = html(element(StreamRecord, { roomId: 'room-r' }));
    assert.match(over, /ENDED/);
    assert.doesNotMatch(over, /WATCH \]|>LIVE</);
  });

  await ok('the archive: STREAM CHAT (n) under a streamed file, nothing under one never streamed', () => {
    const fold = { room: liveRead.room, messages: liveRead.messages };
    assert.match(html(element(StreamChatFolds, { folds: [fold, fold] })), /\[\+\] STREAM CHAT \(2\)/);
    assert.equal(html(element(StreamChatFolds, { folds: undefined })), '');
    assert.equal(html(element(StreamChatFolds, { folds: [] })), '');
  });

  console.log(`\nwatch: ${passed} passed`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
