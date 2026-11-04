/*
 * Scratch checks for the profile's two elements and the board's wire (run from the root):
 *   npx tsc app/lib/profile/elements.ts app/lib/profile/visibility.ts app/lib/forum/news-feed.ts --outDir Temp/elements-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ElementComments.tsx app/components/NewsTicker.tsx app/components/AuthProvider.tsx app/components/PresenceProvider.tsx app/components/ForumProvider.tsx --outDir Temp/elements-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-elements-and-wire.cjs
 *
 * The point of both halves is the same: a drawing and a track are read as one kind of
 * thing, and the board's wire is read as the same rows the profile threads are. One tag
 * vocabulary (`P2`, `M1`, `POST`, `REPLY`) is what makes that true on screen, so it is
 * checked here rather than eyeballed.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  canCommentOnElement,
  commentTag,
  currentProfileElement,
  elementNoun,
  elementPrefix,
  elementTag,
  profileElementById,
  profileElements,
  visibleElementComments,
} = require('./elements-out/profile/elements.js');

const { buildNewsFeed, clipForNews, newsTag } = require('./elements-out/forum/news-feed.js');

// 1. One letter each, and the tag every version and comment is named with.
assert.equal(elementPrefix('picture'), 'P');
assert.equal(elementPrefix('track'), 'M');
assert.equal(elementTag('picture', 2), 'P2');
assert.equal(elementTag('track', 11), 'M11');
assert.equal(elementNoun('picture'), 'PICTURE');
assert.equal(elementNoun('track'), 'TRACK');

const profile = {
  userId: 'user-sweden',
  displayName: 'sweden',
  bio: '',
  country: '',
  avatar: {
    versions: [
      { id: 'p1', version: 1, src: '/one.png', alt: 'picture one', note: 'first pass', createdAt: '2026-09-01T00:00:00.000Z' },
      {
        id: 'p2',
        version: 2,
        src: '/two.png',
        alt: 'picture two',
        note: 'reworked the eyes',
        createdAt: '2026-09-02T00:00:00.000Z',
        restoredFromVersion: 1,
      },
    ],
    currentVersionId: 'p2',
  },
  song: {
    versions: [
      { id: 'm1', version: 1, src: '/a.mp3', title: 'WARD THEME', credit: 'sweden', note: 'rough mix', createdAt: '2026-09-03T00:00:00.000Z' },
    ],
    currentVersionId: 'm1',
  },
  visibility: { showTags: false, showProfileComments: false, showAvatarComments: true, showSongComments: true },
  tags: [],
  comments: [
    {
      id: 'c-p1',
      kind: 'avatar',
      author: { id: 'user-amy', displayName: 'amy' },
      body: 'the first one reads better',
      createdAt: '2026-09-01T01:00:00.000Z',
      avatarVersionId: 'p1',
      avatarVersionNumber: 1,
    },
    {
      id: 'c-m1',
      kind: 'song',
      author: { id: 'user-luke', displayName: 'luke' },
      body: 'this mix is the one',
      createdAt: '2026-09-03T01:00:00.000Z',
      songVersionId: 'm1',
      songVersionNumber: 1,
    },
    {
      id: 'c-profile',
      kind: 'profile',
      author: { id: null, displayName: 'Anonymous' },
      body: 'nice page',
      createdAt: '2026-09-04T01:00:00.000Z',
    },
  ],
  updatedAt: '2026-09-04T00:00:00.000Z',
};


// 2. The same two histories, read the same way: newest first, tagged P/M, current marked.
const pictures = profileElements(profile, 'picture');
const tracks = profileElements(profile, 'track');
assert.deepEqual(pictures.map((element) => element.tag), ['P2', 'P1'], 'newest drawing first');
assert.deepEqual(tracks.map((element) => element.tag), ['M1']);
assert.equal(pictures[0].current, true, 'the version on display is marked');
assert.equal(pictures[1].current, false);
assert.equal(pictures[0].restoredFromVersion, 1, 'and a restore says which version it copied');
assert.equal(tracks[0].title, 'WARD THEME', 'a track keeps its title');
assert.equal(tracks[0].credit, 'sweden');
assert.equal(pictures[0].title, 'PROFILE PICTURE', 'a drawing has no title of its own');
assert.equal(currentProfileElement(profile, 'track').tag, 'M1');
assert.equal(profileElementById(profile, 'picture', 'p1').tag, 'P1');
assert.equal(profileElementById(profile, 'picture', ''), undefined, 'nothing picked reads as nothing');

// 3. A comment says what it is about, and a comment on the profile itself says nothing.
assert.equal(commentTag(profile.comments[0]), 'P1');
assert.equal(commentTag(profile.comments[1]), 'M1');
assert.equal(commentTag(profile.comments[2]), undefined, 'the profile has no version to tag');

// 4. The owner's switch gates the whole thread, count included.
assert.equal(visibleElementComments(profile, 'picture').length, 1);
assert.equal(visibleElementComments(profile, 'track').length, 1);
const switchedOff = {
  ...profile,
  visibility: { ...profile.visibility, showAvatarComments: false, showSongComments: false },
};
assert.deepEqual(visibleElementComments(switchedOff, 'picture'), [], 'a visitor sees nothing while it is off');
assert.equal(canCommentOnElement(false, switchedOff.visibility, 'picture'), false, 'and cannot add to it');
assert.equal(canCommentOnElement(true, switchedOff.visibility, 'track'), true, 'the owner always can');

// 5. The board's wire: the pinned posts, as rows, clipped and stamped with what is left of the
//    pin. Everything else filed on the board is not on the wire any more - the strip is the
//    archive's standing announcements rather than a second copy of the list (see
//    app/lib/forum/news-feed.ts).
const threads = [
  {
    id: 'thread-1',
    title: 'LINE WEIGHTS',
    body: 'Which reads better at 100%?   Plenty of whitespace in here.',
    author: { id: 'user-mira', displayName: 'mira' },
    createdAt: '2026-09-20T10:00:00.000Z',
    comments: [
      {
        id: 'reply-1',
        threadId: 'thread-1',
        body: 'try 2px',
        author: { id: null, displayName: '' },
        createdAt: '2026-09-20T11:00:00.000Z',
        tags: [],
      },
    ],
  },
  {
    id: 'thread-2',
    title: 'SHEET 03',
    body: '',
    author: { id: 'user-sweden', displayName: 'sweden' },
    createdAt: '2026-09-21T10:00:00.000Z',
    comments: [],
  },
];

const pinned = [{ threadId: 'thread-1', pinnedAt: '2026-09-21T12:00:00.000Z', expiresAt: null }];
const wire = buildNewsFeed(threads, undefined, { pins: pinned });
assert.deepEqual(wire.map((item) => item.id), ['news-post-thread-1'], 'the pinned post leads the wire');
assert.equal(wire[0].pinned, true, 'and says that it is pinned');
assert.equal(wire[0].pinLabel, 'PINNED', 'a pin that never runs out is simply PINNED');
assert.equal(newsTag(wire[0]), 'POST');
assert.equal(wire[0].text, 'Which reads better at 100%? Plenty of whitespace in here.', 'runs of whitespace are closed up');
assert.equal(wire[0].threadId, 'thread-1', 'each item knows the thread it came from');
assert.equal(buildNewsFeed(threads).length, 0, 'nothing pinned, nothing on the wire');

const timed = [{ ...pinned[0], expiresAt: '2026-09-22T12:00:00.000Z' }];
assert.equal(
  buildNewsFeed(threads, undefined, { pins: timed, at: new Date('2026-09-21T13:00:00.000Z') })[0].pinLabel,
  'PINNED 23H LEFT',
  'a pin with time left says how much',
);
assert.equal(
  buildNewsFeed(threads, undefined, { pins: timed, at: new Date('2027-01-01T00:00:00.000Z') }).length,
  0,
  'and a pin that has run out stops leading anything',
);
assert.equal(clipForNews('x'.repeat(200)).length, 113, 'a long item is clipped, with an ellipsis');


// 6. The panel as it is drawn: the track's version is named `M1`, its history offers a
//    player, and no thread is printed until it is asked for.
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('./elements-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  useForum: () => ({
    threads,
    pins: pinned,
    ready: true,
    author: { id: null, displayName: 'Anonymous' },
    source: 'mock',
  }),
});

const ElementComments = require('./elements-render/components/ElementComments.js').default;
const NewsTicker = require('./elements-render/components/NewsTicker.js').default;
const AuthProvider = require('./elements-render/components/AuthProvider.js').default;
const PresenceProvider = require('./elements-render/components/PresenceProvider.js').default;
const element = React.createElement;

/** The names and lamps are drawn from the account and presence stores, as on the site. */
const withSite = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

const trackPanel = withSite(
  element(ElementComments, {
    profile,
    element: tracks[0],
    owner: false,
    repository: { setCommentPin: async () => profile },
    onSelect: () => undefined,
    onPlay: () => undefined,
  }),
);
// The caption under the track: the tag, the arrow, and the count. No comment control here (the
// profile has one, above both columns) and - since the page's feed took over the crawling - no
// thread crawling underneath either: folded, the remark is simply behind the arrow.
assert.match(trackPanel, /M1/, 'the track caption carries the tag on screen');
assert.doesNotMatch(trackPanel, />comment</, 'the caption has no comment control of its own');
assert.match(trackPanel, /▸ 1/, 'the fold carries how much is behind it');
assert.doesNotMatch(trackPanel, /class="crawl/, 'and the thread no longer crawls under the element');
assert.doesNotMatch(trackPanel, /this mix is the one/, 'so a folded thread prints nothing of itself');
assert.doesNotMatch(trackPanel, /history \(/, 'a single-version track has no history to offer');

const picturePanel = withSite(
  element(ElementComments, {
    profile,
    element: pictures[0],
    owner: true,
    repository: { setCommentPin: async () => profile },
    onSelect: () => undefined,
  }),
);
assert.match(picturePanel, /P2/, 'the drawing caption carries the version on screen');
assert.match(picturePanel, /history \(2\)/, 'and offers the other versions as a link');
assert.doesNotMatch(picturePanel, /class="crawl/, 'this version has nothing said about it, so nothing crawls');
// Beside each row of an unfolded list the owner gets the pin - which is asserted where the rows
// are drawn, in check-profile-comment-pins.cjs: a panel folded by default prints no rows here.

const wireHtml = withSite(element(NewsTicker, null));
// (2026-10-25, SPEC-less-text.md) The title `NEWSWIRE :: PINNED POSTS` shortened to `NEWSWIRE`: the rows wear
// `[ PINNED ]`, which says what the wire is of.
assert.match(wireHtml, /<span>NEWSWIRE<\/span>/, 'the wire names itself');
assert.doesNotMatch(wireHtml, /NEWSWIRE :: PINNED POSTS/, 'in one word');
// (2026-10-23, SPEC-efficiency.md) The wire's `[ n PINNED ]` count is cut: the rows are what is on it.
assert.doesNotMatch(wireHtml, /\[ 1 PINNED \]/, 'and does not count what is on it');
assert.match(wireHtml, /class="crawl/, 'and crawls');
assert.match(wireHtml, /\[ POST \]/, 'a post says it is a post');
assert.match(wireHtml, /\[ PINNED \]/, 'and says it is the pinned one');
assert.match(wireHtml, /href="\/forum#thread-thread-1"/, 'each row links to the thread it came from');
assert.equal(
  (wireHtml.match(/href="\/forum#thread-thread-1"/g) ?? []).length,
  2,
  'the run is held twice, so the crawl has no seam',
);

console.log('element + wire checks passed');
console.log('  tags        :', elementTag('picture', 2), '::', elementTag('track', 1), '::', newsTag(wire[0]));
console.log('  pictures    :', pictures.map((item) => item.tag).join(' '), ':: current is', currentProfileElement(profile, 'picture').tag);
console.log('  tracks      :', tracks.map((item) => item.tag).join(' '), '::', tracks[0].title);
console.log('  elements    : captions and folds, no crawl of their own - the profile feed carries them now');
console.log('  wire        :', wire.length, 'pinned post(s) crawling, each linking to its thread');
