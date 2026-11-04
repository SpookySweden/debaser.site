/*
 * Scratch checks for a profile's pinned comments (run from the root):
 *   npx tsc app/lib/profile/feed.ts app/lib/profile/mock-profile-repository.ts --outDir Temp/pins-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ProfileWire.tsx app/components/CommentRow.tsx app/components/ProfileCommentPin.tsx --outDir Temp/pins-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-comment-pins.cjs
 *
 * Three things are being pinned down, and they are the three ways this feature can be wrong:
 *
 *   1. the run of threes - one pinned row, two of everything else, every comment its turn once;
 *   2. the store - a pin changes the mark and nothing else, only on a comment on the profile
 *      itself, and it tells the page the pin was taken on;
 *   3. what is drawn - the blue pin beside a comment, the `PINNED` plate on the row and on the
 *      wire, and no wire at all for a profile nobody has commented on.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  buildProfileNewsFeed,
  pinnedWireComments,
  scatteredWireComments,
  PROFILE_PIN_LABEL,
} = require('./pins-out/profile/feed.js');

const {
  getMockProfileRepository,
  resetMockProfiles,
} = require('./pins-out/profile/mock-profile-repository.js');

/**
 * The lamp beside a name is not this check's business, and the store it comes from needs a
 * provider the renderer does not have: stub it, the way the profile layout check does.
 */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('./pins-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined, statusFor: () => 'offline', recordFor: () => undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

/** An author, since every row prints one. */
const AMY = { id: 'user-amy', displayName: 'amy' };
const LUKE = { id: 'user-luke', displayName: 'luke' };

/** The comments a page has: five on the profile, one on the drawing, two of them pinned. */
const comments = [
  { id: 'c1', kind: 'profile', author: AMY, body: 'nice page', createdAt: '2026-09-01T10:00:00.000Z' },
  {
    id: 'c2',
    kind: 'profile',
    author: LUKE,
    body: 'the drawing is the one for me',
    createdAt: '2026-09-02T10:00:00.000Z',
    pinned: true,
    pinnedAt: '2026-09-05T09:00:00.000Z',
  },
  { id: 'c3', kind: 'profile', author: AMY, body: 'where is the track from', createdAt: '2026-09-03T10:00:00.000Z' },
  {
    id: 'c4',
    kind: 'profile',
    author: LUKE,
    body: 'read this one first',
    createdAt: '2026-09-04T10:00:00.000Z',
    pinned: true,
    pinnedAt: '2026-09-06T09:00:00.000Z',
  },
  { id: 'c5', kind: 'profile', author: AMY, body: 'quiet, is this right?', createdAt: '2026-09-05T10:00:00.000Z' },
  {
    id: 'c6',
    kind: 'avatar',
    author: AMY,
    body: 'the second drawing is the one',
    createdAt: '2026-09-06T10:00:00.000Z',
    avatarVersionId: 'p2',
    avatarVersionNumber: 2,
  },
];

// 1. The run of threes over the whole page: every third row is a pin, in the order the pins were
//    taken, and every comment the page carries gets its turn exactly once - the remark on the
//    drawing included, tagged `P2` so a reader knows what it was written about.
const rows = buildProfileNewsFeed(comments, { userId: 'user-sweden' });

assert.equal(rows.length, 6, 'two runs of three, and nothing padded out past what there is');
assert.deepEqual(
  rows.map((row) => row.id),
  ['news-comment-c4', 'news-comment-c3', 'news-comment-c1', 'news-comment-c2', 'news-comment-c5', 'news-comment-c6'],
  'the newest pin leads, the rest fill the two rows behind it, then the other pin leads',
);
assert.equal(rows[0].pinned, true, 'the first row of a run is a pin');
assert.equal(rows[0].pinLabel, PROFILE_PIN_LABEL, 'stamped with what the board stamps its pins');
assert.equal(rows[3].pinned, true, 'and so is the fourth');
assert.equal(rows[1].pinned, undefined, 'the two between them are not');
assert.deepEqual(
  rows.filter((row) => row.pinned === true).map((row) => row.id),
  ['news-comment-c4', 'news-comment-c2'],
  'the pins take the leading row in the order they were taken',
);
assert.deepEqual(
  rows
    .filter((row) => row.pinned !== true)
    .map((row) => row.id)
    .sort(),
  ['news-comment-c1', 'news-comment-c3', 'news-comment-c5', 'news-comment-c6'],
  'and the rest of the conversation fills the rows behind them, whoever and whatever it is',
);
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'no comment is shown twice');
assert.deepEqual(
  rows.map((row) => row.tag).sort(),
  ['P2', 'PROFILE', 'PROFILE', 'PROFILE', 'PROFILE', 'PROFILE'],
  'every row says what it was written about',
);
assert.equal(
  rows.find((row) => row.id === 'news-comment-c6').href,
  undefined,
  'a remark on the drawing leads nowhere on its own - it is read at that drawing\u2019s fold',
);
assert.equal(rows[0].href, '/profile/user-sweden#profile-comments', 'while the page own remarks open the panel');
assert.equal(rows[0].author.displayName, 'luke', 'with the byline of whoever wrote it');

// 2. The scatter: stable (the server and the browser must draw the same run), not newest-first,
//    and complete - and with nothing pinned the feed is simply every comment, mixed.
const unpinned = comments.filter((comment) => comment.pinned !== true);
const scattered = scatteredWireComments(unpinned).map((comment) => comment.id);
const newestFirst = [...unpinned]
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  .map((comment) => comment.id);

assert.deepEqual(scatteredWireComments(unpinned).map((comment) => comment.id), scattered, 'the scatter never moves');
assert.notDeepEqual(scattered, newestFirst, 'the scatter is not just newest-first');
assert.deepEqual([...scattered].sort(), [...newestFirst].sort(), 'and it loses nobody');

const noPins = buildProfileNewsFeed(
  comments.map((comment) => ({ ...comment, pinned: undefined, pinnedAt: undefined })),
  { userId: 'user-sweden' },
);
assert.equal(noPins.length, 6, 'a feed with nothing pinned is every comment the page carries');
assert.equal(noPins.some((row) => row.pinned === true), false, 'and nothing on it pretends to be pinned');

// The limit still holds a long wire down, and a short one is not padded out to it.
const many = Array.from({ length: 20 }, (_, index) => ({
  id: `many-${index}`,
  kind: 'profile',
  author: AMY,
  body: `remark ${index}`,
  createdAt: `2026-09-${String((index % 9) + 1).padStart(2, '0')}T10:00:00.000Z`,
}));

// 3. The store: a pin changes the mark and the moment it was taken, and nothing else. Any comment
//    the page carries can take one, and the page is told when a pin moves.
async function storeChecks() {
  resetMockProfiles();

  const store = getMockProfileRepository();
  const owner = 'user-sweden';
  const profile = await store.addComment(owner, { kind: 'profile', author: AMY, body: 'nice page' });
  const commentId = profile.comments[0].id;

  const heard = [];
  const stop = store.subscribe((next) => heard.push(next.comments[0].pinned));

  const pinned = await store.setCommentPin(owner, commentId, true);
  assert.equal(pinned.comments[0].pinned, true, 'the comment is pinned');
  assert.equal(typeof pinned.comments[0].pinnedAt, 'string', 'and the moment it was taken is kept');
  assert.equal(pinned.comments[0].body, 'nice page', 'the words are untouched');
  assert.equal(pinned.comments[0].author.displayName, 'amy', 'and so is the byline');
  assert.equal(pinned.comments[0].createdAt, profile.comments[0].createdAt, 'and the time it was filed');
  assert.deepEqual(heard, [true], 'the page the pin was taken on is told');
  stop();

  const unpinned = await store.setCommentPin(owner, commentId, false);
  assert.equal(unpinned.comments[0].pinned, false, 'a pin can be taken off again');
  assert.equal(unpinned.comments[0].pinnedAt, undefined, 'and it stops claiming a moment');

  await assert.rejects(
    () => store.setCommentPin(owner, 'not-a-comment', true),
    /THAT COMMENT IS NOT ON THIS PROFILE/,
    'a comment that is not on this profile cannot be pinned',
  );

  await store.addAvatarVersion(owner, { src: '/one.png', note: 'first pass' });
  const withDrawingComment = await store.addComment(owner, {
    kind: 'avatar',
    author: LUKE,
    body: 'the second drawing is the one',
  });
  const drawingComment = withDrawingComment.comments.find((comment) => comment.kind === 'avatar');

  // A remark on the drawing carries a pin the same way: the feed under the columns is made of all
  // three kinds, so this one has somewhere to lead.
  const pinnedDrawing = await store.setCommentPin(owner, drawingComment.id, true);
  const drawing = pinnedDrawing.comments.find((comment) => comment.id === drawingComment.id);
  assert.equal(drawing.pinned, true, 'a remark on the drawing can be pinned');
  assert.equal(drawing.body, 'the second drawing is the one', 'and its words are untouched too');

  const feed = buildProfileNewsFeed(pinnedDrawing.comments, { userId: owner });
  assert.equal(feed[0].id, `news-comment-${drawingComment.id}`, 'so it leads the feed');
  assert.equal(feed[0].tag, 'P1', 'tagged with the drawing it was written about');
}

// 4. What is drawn: the blue pin beside a comment, the `PINNED` plate on a pinned row, every kind
//    of remark on the feed, and no feed at all for a page nobody has commented on.
async function renderChecks() {
  const element = React.createElement;
  const ProfileWire = require('./pins-render/components/ProfileWire.js').default;
  const CommentRow = require('./pins-render/components/CommentRow.js').default;
  const ProfileCommentPin = require('./pins-render/components/ProfileCommentPin.js').default;

  const wire = renderToStaticMarkup(element(ProfileWire, { userId: 'user-sweden', comments }));
  assert.match(wire, /class="crawl/, 'the feed crawls');
  assert.doesNotMatch(wire, /NEWSWIRE|NOTHING YET|NOBODY HAS COMMENTED/, 'with no heading and no placeholder');
  assert.equal((wire.match(/\[ PROFILE \]/g) ?? []).length, 5 * 2, 'the remarks on the profile, twice for the loop');
  assert.equal((wire.match(/\[ P2 \]/g) ?? []).length, 2, 'the remark on the drawing says what it is about');
  assert.equal((wire.match(/\[ PINNED \]/g) ?? []).length, 2 * 2, 'and the pinned ones wear the plate');

  const empty = renderToStaticMarkup(element(ProfileWire, { userId: 'user-sweden', comments: [] }));
  assert.equal(empty, '', 'a profile nobody has commented on has no feed at all');

  const row = { id: 'c1', author: AMY, body: 'nice page', createdAt: '2026-09-01T10:00:00.000Z', tag: 'PROFILE' };
  const control = element(ProfileCommentPin, {
    userId: 'user-sweden',
    commentId: 'c1',
    pinned: false,
    repository: { setCommentPin: async () => ({ comments: [] }) },
  });
  const ownerRow = renderToStaticMarkup(element(CommentRow, { data: row, action: control }));

  assert.match(ownerRow, /aria-pressed="false"/, 'the pin says whether the comment carries it');
  // (2026-10-25, SPEC-less-text.md) The tip `PIN :: THE COMMENT LEADS EVERY THIRD ROW OF THE WIRE` -> `PIN` (a tip
  // names an unlabelled control in a few words, rule 1); the accessible name says it in full.
  assert.match(ownerRow, /title="PIN"/, 'and what pressing it does, in a word');
  assert.match(ownerRow, /aria-label="Pin this comment"/, 'with the full name for a screen reader');
  assert.doesNotMatch(ownerRow, /EVERY THIRD ROW OF THE WIRE/, 'and no sentence in the tip');
  assert.match(ownerRow, /bg-ena/, 'it is the blue plate');
  assert.match(ownerRow, /📌/, 'carrying the pushpin');
  assert.doesNotMatch(ownerRow, /\[ PINNED \]/, 'and an unpinned comment wears no plate');

  const pinnedRow = renderToStaticMarkup(
    element(CommentRow, {
      data: row,
      pinnedLabel: PROFILE_PIN_LABEL,
      action: element(ProfileCommentPin, {
        userId: 'user-sweden',
        commentId: 'c1',
        pinned: true,
        repository: { setCommentPin: async () => ({ comments: [] }) },
      }),
    }),
  );
  assert.match(pinnedRow, /\[ PINNED \]/, 'a pinned comment says so');
  assert.match(pinnedRow, /aria-pressed="true"/, 'and its pin offers to take it off');
  assert.match(pinnedRow, /UNPIN/, 'in as many words');

  const visitorRow = renderToStaticMarkup(element(CommentRow, { data: row, pinnedLabel: PROFILE_PIN_LABEL }));
  assert.match(visitorRow, /\[ PINNED \]/, 'a visitor sees the pin');
  assert.doesNotMatch(visitorRow, /<button/, 'and is handed no control over it');

  console.log('profile comment pin checks passed');
  console.log('  feed      :', rows.map((item) => `${item.id.replace('news-comment-', '')}:${item.tag}${item.pinned ? '*' : ''}`).join(' '), '(* pinned)');
  console.log('  scatter   :', scattered.join(' '), ':: stable, not newest-first');
  console.log('  store     : a pin keeps the words, notifies the page, and is taken on any of the three kinds');
  console.log('  drawn     : blue pushpin for the owner, PINNED plate for everybody, nothing when empty');
}

Promise.resolve()
  .then(storeChecks)
  .then(renderChecks)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

assert.equal(buildProfileNewsFeed(many, { userId: 'user-sweden' }).length, 14, 'the strip takes the limit');
assert.equal(buildProfileNewsFeed(unpinned, { userId: 'user-sweden' }).length, 4, 'and asks for no more than it has');
assert.deepEqual(buildProfileNewsFeed([], { userId: 'user-sweden' }), [], 'nothing said, nothing drawn');
assert.deepEqual(
  pinnedWireComments(comments).map((comment) => comment.id),
  ['c4', 'c2'],
  'pins are read newest pin first',
);
