/*
 * Scratch check for pinned posts (run from the root):
 *   npx tsc app/lib/forum/pins.ts app/lib/forum/news-feed.ts app/lib/forum/anchors.ts app/lib/forum/mock-repository.ts app/lib/concepts/sheets.ts --outDir Temp/pins-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/NewsTicker.tsx app/components/ForumPinPanel.tsx app/components/ForumThreadCard.tsx app/components/ForumBoard.tsx --outDir Temp/pins-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-forum-pins.cjs
 *
 * What it is for: a pin is the one thing on the board that overrides the board's own order, so
 * the questions worth answering here are all about who and how long - that only the moderator can
 * take one, that it stops on time without anybody sweeping it up, that it holds the top of the
 * list and leads the wire, and that a lapsed pin changes nothing but the badge. Plus the two
 * places it is drawn, so the control and the panel are there for the moderator and not for
 * anybody else.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  PIN_DURATIONS,
  pinExpiry,
  isPinLive,
  livePins,
  pinForThread,
  remainingLabel,
  pinLabel,
  pinSummary,
  sortThreadsPinnedFirst,
  pinnedCount,
} = require('./pins-out/forum/pins.js');
const { buildNewsFeed, newsHref } = require('./pins-out/forum/news-feed.js');
const { getMockForumRepository } = require('./pins-out/forum/mock-repository.js');

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const AT = new Date('2026-09-22T12:00:00.000Z');

const thread = (id, createdAt, extra = {}) => ({
  id,
  title: `POST ${id}`,
  body: `${id} body`,
  author: { id: 'user-amy', displayName: 'amy' },
  createdAt,
  anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' },
  tags: [],
  comments: [],
  origin: 'user',
  ...extra,
});

const pin = (threadId, extra = {}) => ({
  threadId,
  pinnedById: 'debaser-site',
  pinnedByName: 'debaser.site',
  pinnedAt: '2026-09-22T11:00:00.000Z',
  expiresAt: null,
  ...extra,
});

// 1. How long a pin lasts: the four choices, and what each one comes to. The month was dropped
// with the cycling selector (commit 96fc066): an evening's event and a standing notice are the
// two lengths worth offering, and a pin that long is a post that should be written again.
assert.deepEqual(
  PIN_DURATIONS.map((duration) => duration.key),
  ['hour', 'day', 'week', 'forever'],
  'the moderator picks from four windows',
);
assert.equal(pinExpiry('hour', AT), '2026-09-22T18:00:00.000Z', 'six hours is six hours');
assert.equal(pinExpiry('day', AT), '2026-09-23T12:00:00.000Z', 'a day is a day');
assert.equal(pinExpiry('forever', AT), null, 'and forever never runs out');

// 2. Liveness: nothing sweeps a lapsed pin up, so this is the whole of "has it stopped".
assert.equal(isPinLive(pin('t1'), AT), true, 'a forever pin is live');
assert.equal(isPinLive(pin('t2', { expiresAt: '2026-09-22T13:00:00.000Z' }), AT), true, 'so is one with time left');
assert.equal(isPinLive(pin('t3', { expiresAt: '2026-09-22T11:59:00.000Z' }), AT), false, 'a pin that has run out is not');
assert.deepEqual(livePins([pin('t1'), pin('t3', { expiresAt: '2026-09-01T00:00:00.000Z' })], AT).map((row) => row.threadId), ['t1']);
assert.equal(pinForThread([pin('t1')], 't1', AT)?.threadId, 't1');
assert.equal(pinForThread([pin('t1')], 't9', AT), undefined, 'a post with no pin has none');
assert.equal(pinnedCount([], AT), 0);
assert.equal(pinnedCount(undefined, AT), 0, 'a store with no pins at all is not a crash');

// 3. What a pin says, and how long is left said honestly.
assert.equal(pinLabel(pin('t1'), AT), 'PINNED', 'a pin that never runs out just says it is pinned');
assert.equal(pinLabel(pin('t1', { expiresAt: '2026-09-22T15:00:00.000Z' }), AT), 'PINNED 3H LEFT');
assert.equal(pinSummary(pin('t1'), AT), 'BY DEBASER.SITE', 'the panel signs it without spelling out forever');
assert.equal(remainingLabel('2026-09-22T12:30:00.000Z', AT), '30M LEFT');
assert.equal(remainingLabel('2026-09-22T15:00:00.000Z', AT), '3H LEFT');
assert.equal(remainingLabel('2026-09-25T12:00:00.000Z', AT), '3D LEFT');
assert.equal(remainingLabel('2026-09-22T11:00:00.000Z', AT), 'EXPIRED');
assert.equal(pinLabel(pin('t1', { expiresAt: '2026-09-22T15:00:00.000Z' }), AT), 'PINNED 3H LEFT');
assert.equal(pinSummary(pin('t1', { expiresAt: '2026-09-22T15:00:00.000Z' }), AT), 'BY DEBASER.SITE :: 3H LEFT');

// 4. The board's order: pinned first, and the rest left exactly as they were.
const newest = thread('t-new', '2026-09-22T10:00:00.000Z');
const older = thread('t-old', '2026-09-15T10:00:00.000Z');
const middle = thread('t-mid', '2026-09-20T10:00:00.000Z');

assert.deepEqual(
  sortThreadsPinnedFirst([newest, middle, older], []).map((row) => row.id),
  ['t-new', 't-mid', 't-old'],
  'with nothing pinned, the order is untouched',
);
assert.deepEqual(
  sortThreadsPinnedFirst([newest, middle, older], [pin('t-old')]).map((row) => row.id),
  ['t-old', 't-new', 't-mid'],
  'a pinned post leads, however old it is',
);
assert.deepEqual(
  sortThreadsPinnedFirst(
    [newest, middle, older],
    [pin('t-old', { pinnedAt: '2026-09-22T09:00:00.000Z' }), pin('t-mid', { pinnedAt: '2026-09-22T11:00:00.000Z' })],
  ).map((row) => row.id),
  ['t-mid', 't-old', 't-new'],
  'and the most recently pinned leads the pins',
);
assert.deepEqual(
  sortThreadsPinnedFirst([newest, middle, older], [pin('t-old', { expiresAt: '2026-09-01T00:00:00.000Z' })]).map(
    (row) => row.id,
  ),
  ['t-new', 't-mid', 't-old'],
  'a pin that has lapsed lifts nothing',
);

// 5. The wire is the pinned posts, and nothing else: it reads as the archive's standing
// notices rather than as the whole board (app/lib/forum/news-feed.ts).
const feed = buildNewsFeed([newest, middle, older], 14, { pins: [pin('t-old')], at: AT });
assert.equal(feed.length, 1, 'the wire carries the pinned post and nothing else');
assert.equal(feed[0].threadId, 't-old', 'the pinned post leads the crawl');
assert.equal(feed[0].pinned, true, 'and says so');
assert.equal(feed[0].pinLabel, 'PINNED');
assert.equal(feed[0].href, newsHref('t-old'), 'each row still opens the post it came from');

// Two pins: the newest leads, which is the order the rules file sorts them in.
const bothPinned = buildNewsFeed([newest, middle, older], 14, {
  pins: [
    pin('t-old', { pinnedAt: '2026-09-22T09:00:00.000Z' }),
    pin('t-mid', { pinnedAt: '2026-09-22T11:00:00.000Z' }),
  ],
  at: AT,
});
assert.deepEqual(bothPinned.map((row) => row.threadId), ['t-mid', 't-old'], 'the most recently pinned leads');

// A pin whose post has gone is not a row, and neither is one that has run out: the strip simply
// has less on it, because there is nothing pinned.
assert.deepEqual(buildNewsFeed([newest], 14, { pins: [pin('t-gone')], at: AT }), [], 'a pin with no post is skipped');
assert.deepEqual(
  buildNewsFeed([newest, older], 14, { pins: [pin('t-old', { expiresAt: '2026-09-01T00:00:00.000Z' })], at: AT }),
  [],
  'a lapsed pin does not lead the wire either',
);

// A reply is conversation, not an announcement, so it never rides the wire - even when it sits
// under a post that has been pinned.
const withReply = buildNewsFeed(
  [thread('t-new', '2026-09-22T10:00:00.000Z', {
    comments: [
      {
        id: 'c1',
        threadId: 't-new',
        body: 'a reply',
        author: { id: 'user-luke', displayName: 'luke' },
        createdAt: '2026-09-22T10:30:00.000Z',
        tags: [],
      },
    ],
  })],
  14,
  { pins: [pin('t-new')], at: AT },
);
assert.equal(withReply.length, 1, 'a pinned post rides the wire alone');
assert.equal(withReply[0].kind, 'post', 'which is the post, not the reply filed under it');

// 6. The store: only the moderator pins, one pin per post, and it can be taken back.
const storeChecks = (async () => {
  const store = getMockForumRepository();
  await store.clearLocalPosts();

  const board = { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' };
  const first = await store.createThread({
    title: 'FIRST POST',
    body: 'one',
    anchor: board,
    author: { id: 'user-amy', displayName: 'amy' },
  });
  const second = await store.createThread({
    title: 'SECOND POST',
    body: 'two',
    anchor: board,
    author: { id: 'user-luke', displayName: 'luke' },
  });

  await assert.rejects(
    () => store.pinThread({ threadId: first.id, duration: 'day', moderator: { id: 'user-amy', displayName: 'amy' } }),
    /ONLY A MODERATOR MAY PIN A POST/,
    'a member cannot pin',
  );

  await assert.rejects(
    () =>
      store.pinThread({
        threadId: 'not-a-post',
        duration: 'day',
        moderator: { id: 'debaser-site', displayName: 'debaser.site' },
      }),
    /NOT ON THE BOARD/,
    'and a post that is not there cannot be pinned',
  );

  const heard = [];
  const stop = store.subscribePins((pins) => heard.push(pins.length));

  const pinned = await store.pinThread({
    threadId: first.id,
    duration: 'day',
    moderator: { id: 'debaser-site', displayName: 'debaser.site' },
  });
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].threadId, first.id);
  assert.equal(pinned[0].pinnedByName, 'debaser.site', 'the pin is signed with who took it');
  assert.equal(typeof pinned[0].expiresAt, 'string', 'and carries the deadline');
  assert.equal(heard.at(-1), 1, 'the pin is published to every open board');

  // Re-pinning is how a deadline is extended: one row per post, never two.
  const extended = await store.pinThread({
    threadId: first.id,
    duration: 'forever',
    moderator: { id: 'debaser-site', displayName: 'debaser.site' },
  });
  assert.equal(extended.length, 1, 'one pin per post');
  assert.equal(extended[0].expiresAt, null, 'and forever means forever');

  await store.pinThread({
    threadId: second.id,
    duration: 'hour',
    moderator: { id: 'debaser-site', displayName: 'debaser.site' },
  });
  assert.deepEqual((await store.listPins()).map((row) => row.threadId), [second.id, first.id], 'newest pin first');

  const afterUnpin = await store.unpinThread(second.id);
  assert.deepEqual(afterUnpin.map((row) => row.threadId), [first.id], 'a pin can be taken off');
  stop();

  await store.clearLocalPosts();
  assert.deepEqual(await store.listPins(), [], 'and clearing the local board clears its pins');
})();

// 7. The three places a pin is seen or taken: the panel, the wire, and the post itself.
const FORUM = {
  threads: [],
  pins: [],
  pinForThread: () => undefined,
  pinThread: async () => undefined,
  unpinThread: async () => undefined,
  author: { id: null, displayName: 'Anonymous' },
  ready: true,
  source: 'mock',
  tagVocabulary: [],
  tagColours: {},
  rememberTagColour: () => undefined,
};

let viewer = null;

stub('./pins-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  useForum: () => FORUM,
});

stub('./pins-render/components/AuthProvider.js', {
  default: ({ children }) => children,
  useAuth: () => ({ user: viewer, ready: true, banAccount: async () => undefined }),
});

stub('./pins-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

stub('./pins-render/components/CommsProvider.js', {
  default: ({ children }) => children,
  useComms: () => ({ accounts: [] }),
});

stub('./pins-render/components/NotificationsProvider.js', {
  default: ({ children }) => children,
  useNotifications: () => ({ notifyTagged: async () => undefined }),
});

stub('./pins-render/components/PopoutWindow.js', {
  __esModule: true,
  default: ({ children }) => React.createElement('div', null, children),
});

/** The composer's MP3 control reads the site's player; the player is not on trial here. */
stub('./pins-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => ({
    queue: [],
    track: undefined,
    playing: false,
    loading: false,
    elapsed: 0,
    duration: Number.NaN,
    play: () => undefined,
    toggle: () => undefined,
    refresh: () => undefined,
  }),
});

const NewsTicker = require('./pins-render/components/NewsTicker.js').default;
const ForumPinPanel = require('./pins-render/components/ForumPinPanel.js').default;
const { ThreadPinControl } = require('./pins-render/components/ForumPinPanel.js');
const element = React.createElement;
const render = (child) => renderToStaticMarkup(child);

const POST = thread('t-pinned', '2026-09-01T10:00:00.000Z', { comments: [] });
const LATER = thread('t-later', '2026-09-22T10:00:00.000Z', { comments: [] });

FORUM.threads = [POST, LATER];
FORUM.pins = [pin('t-pinned')];
FORUM.pinForThread = (threadId) => (threadId === 't-pinned' ? FORUM.pins[0] : undefined);

// The moderators' panel: what is held, who took it, and how to let it go.
viewer = { id: 'debaser-site', displayName: 'debaser.site' };
const panel = render(element(ForumPinPanel, null));
assert.match(panel, /PINNED POSTS :: MODERATORS/);
assert.match(panel, /\[ 1 PINNED \]/);
assert.match(panel, /PINNED<\/span>/, 'the badge says it is pinned');
assert.doesNotMatch(panel, /PINNED FOREVER/, 'and never spells out forever on the badge');
assert.match(panel, /BY DEBASER\.SITE/, 'and who took it');
assert.match(panel, /POST t-pinned/, 'naming the post');
assert.match(panel, /\[ UNPIN \]/, 'with the way to take it off');

viewer = { id: 'user-amy', displayName: 'amy' };
assert.equal(render(element(ForumPinPanel, null)), '', 'nobody but the moderator is handed the panel');
assert.equal(
  render(element(ThreadPinControl, { thread: POST })),
  '',
  'and nobody but the moderator is handed the control on a post',
);

// The post's own control, for the moderator: the durations, and the pin it already has.
viewer = { id: 'debaser-site', displayName: 'debaser.site' };
const control = render(element(ThreadPinControl, { thread: POST }));
assert.match(control, /\[ MOD \]/);
assert.match(control, /PINNED/);
assert.match(control, /\[ CHANGE PIN \]/, 'a pinned post can be re-pinned');
assert.match(control, /\[ UNPIN \]/);

const unpinnedControl = render(element(ThreadPinControl, { thread: LATER }));
assert.match(unpinnedControl, /\[ PIN POST \]/, 'a post with no pin offers one');
assert.doesNotMatch(unpinnedControl, /\[ UNPIN \]/, 'and there is nothing to take off it');

// The durations are behind the `[ PIN POST ]` toggle, which server rendering cannot click, so
// they are read in the source: one number that cycles through every window the rules file holds,
// in order, and wraps at the end.
const panelSource = require('node:fs').readFileSync('app/components/ForumPinPanel.tsx', 'utf8');
assert.match(panelSource, /PIN_DURATIONS\.findIndex/, 'the number cycles through every window');
// (2026-10-25, SPEC-less-text.md) What a pin does moved behind the panel's `[ ? ]` fold (InfoFold): it is a
// rule the controls do not show. Asserted inside the fold, not just somewhere in the file.
assert.match(
  panelSource,
  /<InfoFold topic="pins">\s*A PIN HOLDS A POST AT THE TOP OF THE BOARD AND LEADS THE WIRE[\s\S]*?<\/InfoFold>/,
  'and says what a pin does, inside the [ ? ] fold',
);
assert.doesNotMatch(panelSource, /NO POST IS PINNED AT THE MOMENT/, 'with no empty-state sentence under it');

// The wire: the pinned posts, marked, and the same run held twice for the crawl's seamless loop.
const wire = render(element(NewsTicker, null));
// (2026-10-25, SPEC-less-text.md) `NEWSWIRE :: PINNED POSTS` -> `NEWSWIRE`; the rows' `[ PINNED ]` says the rest.
assert.match(wire, /<span>NEWSWIRE<\/span>/, 'the strip names itself');
assert.doesNotMatch(wire, /NEWSWIRE :: PINNED POSTS/, 'in one word');
// (2026-10-23, SPEC-efficiency.md) The `[ n PINNED ]` count is cut.
assert.doesNotMatch(wire, /\[ 1 PINNED \]/, 'the strip does not count what is pinned');
assert.match(wire, /\[ PINNED \]/, 'and the pinned row wears the badge');
assert.doesNotMatch(wire, /PINNED FOREVER/, 'with no duration spelled out on the strip');
assert.doesNotMatch(wire, /bg-black/, 'the strip is one more panel of the board, not a black display');
assert.equal((wire.match(/\[ POST \]/g) ?? []).length, 2, 'the one pinned post, held twice for the loop');
// (2026-10-23, SPEC-efficiency.md) The how-to line is the crawl's hover tip now, not a line under it.
// (2026-10-25, SPEC-less-text.md) And the tip is cut too: a how-to (rule 1), on a strip whose rows are links.
assert.doesNotMatch(wire, /Point at it to stop the crawl/i, 'and the strip carries no how-to tip');
assert.match(wire, /href="\/forum#thread-/, 'its rows are links, which is how it is read');

void storeChecks
  .then(() => {
    console.log('forum pin checks passed');
    console.log('  durations  : four windows, forever included, and a lapsed pin simply stops counting');
    console.log('  order      : pinned first on the board and leading the wire, the rest untouched');
    console.log('  store      : only the moderator pins, one row per post, signed, and unpinnable');
    console.log('  screens    : the panel and the control for the moderator alone, the badge on the wire');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
