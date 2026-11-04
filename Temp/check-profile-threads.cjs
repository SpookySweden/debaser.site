/*
 * Profile comments on the board: are they threads of their own, and does every board filter reach them?
 *   npx tsc app/lib/forum/profile-threads.ts app/lib/forum/anchors.ts app/lib/forum/board-query.ts app/lib/forum/site-author.ts app/lib/forum/tag-vocabulary.ts app/lib/forum/tags.ts --outDir Temp/board-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/AnchorLink.tsx --outDir Temp/profile-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-threads.cjs
 *
 * Offline: the fixtures are profile comments shaped exactly as the profile store hands them over
 * (`ProfileCommentEntry`), so nothing here needs the network. What it proves is the chain a comment
 * travels between the profile store and the board:
 *
 *   the profile store's comments -> one thread per subject (`profileCommentThreads`)
 *     -> the board's source filter, tag filter and search (`selectBoardThreads`)
 *       -> an answer filed from the board knows what to write and where (`profileAnchorTarget`)
 *       -> the card's link back to the page (`AnchorLink`, rendered for real)
 *
 * The three subjects are the profile itself, one picture version and one track version: a remark on
 * somebody's drawing is not a remark on their page, and a remark on v3 of a drawing is not a remark
 * on v7 of it. A thread that lost its version would silently merge two conversations.
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// The card's link is a Next link; render it as an anchor so the markup can be read as text.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'next/link') {
    return {
      __esModule: true,
      default: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
    };
  }
  if (request === 'next/image') {
    return {
      __esModule: true,
      default: ({ src, alt, ...rest }) => React.createElement('img', { src, alt, ...rest }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { profileAnchor, profileAnchorId, profileAnchorLabel, profileAnchorTarget } = require('./board-out/forum/anchors.js');
const { selectBoardThreads } = require('./board-out/forum/board-query.js');
const { profileCommentThreads } = require('./board-out/forum/profile-threads.js');
const { isItemOwnedThread, postCredit } = require('./board-out/forum/site-author.js');
const { tagKey } = require('./board-out/forum/tag-vocabulary.js');

const entry = ({ id, kind, body, createdAt, authorId = 'u9', authorLabel = 'MOSS', ...versions }) => ({
  comment: { id, kind, author: { id: authorId, displayName: authorLabel }, body, createdAt, ...versions },
  userId: 'u1',
  displayName: 'sweden',
});

const entries = [
  entry({
    id: 'c1',
    kind: 'profile',
    body: 'the lore here is thick, and the archive notes agree',
    createdAt: '2026-09-20T10:00:00.000Z',
  }),
  entry({
    id: 'c2',
    kind: 'avatar',
    avatarVersionId: 'v3',
    avatarVersionNumber: 3,
    body: 'v3 fixes the silhouette',
    createdAt: '2026-09-21T10:00:00.000Z',
  }),
  entry({
    id: 'c3',
    kind: 'avatar',
    avatarVersionId: 'v7',
    avatarVersionNumber: 7,
    body: 'v7 changes the mechanics of the lighting',
    createdAt: '2026-09-19T10:00:00.000Z',
  }),
  entry({
    id: 'c4',
    kind: 'song',
    songVersionId: 's2',
    songVersionNumber: 2,
    body: 'the track is a whole scene',
    createdAt: '2026-09-22T10:00:00.000Z',
  }),
  entry({
    id: 'c5',
    kind: 'profile',
    body: 'and the fourth wall is holding',
    createdAt: '2026-09-22T12:00:00.000Z',
  }),
  // A comment from before pictures carried versions: it belongs to the picture, not to the page.
  entry({ id: 'c6', kind: 'avatar', body: 'the old drawing', createdAt: '2026-09-18T10:00:00.000Z' }),
];

const threads = profileCommentThreads(entries);
const byId = new Map(threads.map((thread) => [thread.id, thread]));

const query = (over) => ({
  query: '',
  sourceFilter: 'all',
  tagKeys: [],
  tagMatchMode: 'any',
  sortMode: 'newest',
  ...over,
});


/* One thread per subject ---------------------------------------------------- */

assert.deepEqual(
  [...byId.keys()].sort(),
  ['profile:u1', 'profile:u1:picture', 'profile:u1:picture:v3', 'profile:u1:picture:v7', 'profile:u1:track:s2'],
  'each subject gets its own thread: the page, each picture version, each track version, the unversioned picture',
);

assert.equal(byId.get('profile:u1').anchor.label, 'PROFILE // SWEDEN');
assert.equal(byId.get('profile:u1:picture:v3').anchor.label, 'PICTURE v3 // SWEDEN');
assert.equal(byId.get('profile:u1:picture:v7').anchor.label, 'PICTURE v7 // SWEDEN');
assert.equal(byId.get('profile:u1:track:s2').anchor.label, 'TRACK v2 // SWEDEN');
assert.equal(byId.get('profile:u1:picture').anchor.label, 'PICTURE // SWEDEN');

for (const thread of threads) {
  assert.equal(thread.anchor.kind, 'profile', 'the anchor says where the thread came from');
  assert.equal(thread.anchor.href, '/profile/u1', 'the thread links back to the page it belongs to');
  // The thread is item-owned, and credited to the page's owner - not the site, as it was until
  // 2026-10-24 (Luke: `debaser.site` over a profile's comments read as an empty post by the site).
  // Each comment still names who wrote it.
  assert.equal(isItemOwnedThread(thread), true);
  assert.equal(postCredit(thread).id, 'u1', 'credited to the page owner');
  assert.equal(postCredit(thread).displayName, 'SWEDEN', 'named as the label spells them');
  assert.equal(thread.title, `COMMENTS ON ${thread.anchor.label}`, 'titled as what it is, not RE:');
}

/* The comments themselves -------------------------------------------------- */

assert.equal(byId.get('profile:u1').comments.length, 2, 'both remarks on the page are in one thread');
assert.deepEqual(
  byId.get('profile:u1').comments.map((comment) => comment.id),
  ['profile-comment:c5', 'profile-comment:c1'],
  'newest first, and namespaced so they cannot collide with a board comment id',
);
assert.equal(byId.get('profile:u1').comments[0].author.displayName, 'MOSS');
assert.equal(byId.get('profile:u1').comments[0].threadId, 'profile:u1', 'each comment names its thread');
assert.equal(byId.get('profile:u1').createdAt, '2026-09-22T12:00:00.000Z', 'a thread is as new as its newest remark');

/* Tags, read out of the comments: this is what the filter and the search work on ------------ */

assert.ok(
  byId.get('profile:u1').tags.some((tag) => tagKey(tag.label) === 'lore'),
  'a page remark mentioning the lore carries the LORE tag',
);
assert.ok(
  byId.get('profile:u1:picture:v7').tags.some((tag) => tagKey(tag.label) === 'mechanics'),
  'so does a picture remark about mechanics',
);
assert.ok(
  byId.get('profile:u1:picture:v3').tags.some((tag) => tagKey(tag.label) === 'character'),
  'and one about a silhouette carries CHARACTER',
);

/* The board's own filters -------------------------------------------------- */

assert.equal(selectBoardThreads(threads, query({ sourceFilter: 'profile' })).length, 5);
assert.equal(selectBoardThreads(threads, query({ sourceFilter: 'board' })).length, 0);
assert.equal(selectBoardThreads(threads, query({ sourceFilter: 'asset' })).length, 0);
assert.equal(selectBoardThreads(threads, query({ sourceFilter: 'text-box' })).length, 0);
assert.equal(selectBoardThreads(threads, query({})).length, 5, 'ALL SOURCES keeps them');

const mechanics = selectBoardThreads(threads, query({ tagKeys: [tagKey('MECHANICS')] }));

assert.deepEqual(
  mechanics.map((thread) => thread.id),
  ['profile:u1:picture:v7'],
  'the tag filter reaches a profile comment through the words in it',
);

assert.deepEqual(
  selectBoardThreads(threads, query({ query: 'picture v7' })).map((thread) => thread.id),
  ['profile:u1:picture:v7'],
  'the search reaches it by its subject',
);

/* Answering one from the board: what to write, and where ------------------- */

const target = (thread) => profileAnchorTarget(thread.anchor);

assert.deepEqual(target(byId.get('profile:u1')), { userId: 'u1', kind: 'profile' });
assert.deepEqual(target(byId.get('profile:u1:picture:v3')), { userId: 'u1', kind: 'avatar', versionId: 'v3' });
assert.deepEqual(target(byId.get('profile:u1:track:s2')), { userId: 'u1', kind: 'song', versionId: 's2' });
assert.deepEqual(
  target(byId.get('profile:u1:picture')),
  { userId: 'u1', kind: 'avatar' },
  'an unversioned picture thread writes the store default: whichever version is on display',
);
assert.equal(
  profileAnchorTarget({ kind: 'board', id: 'the-board', label: 'THE BOARD' }),
  null,
  'a board thread is answered on the board, not in the profile store',
);

/* Built by hand, the way the profile page builds one ------------------------- */

for (const kind of ['profile', 'avatar', 'song']) {
  const shaped = { userId: 'u1', displayName: 'sweden', kind, versionId: `${kind}-v`, versionNumber: 4 };
  const built = profileAnchor(shaped);

  assert.equal(built.id, profileAnchorId(shaped));
  assert.equal(profileAnchorTarget(built).kind, kind, 'an anchor round-trips back to what to write');
  assert.equal(
    profileAnchorLabel(shaped).includes('v4'),
    kind !== 'profile',
    'a picture or a track is labelled with its version; the page itself has none',
  );
}

console.log(
  `${threads.length} subject thread(s) from ${entries.length} comment(s), ${mechanics.length} by the MECHANICS tag`,
);

/* The link the card draws under the post -------------------------------------- */

const AnchorLink = require('./profile-render/components/AnchorLink.js').default;
const element = React.createElement;
const textOf = (html) => html.replace(/<[^>]*>/g, '');

const pageLink = renderToStaticMarkup(element(AnchorLink, { anchor: byId.get('profile:u1').anchor, prefix: 'FILED UNDER' }));

assert.match(pageLink, /href="\/profile\/u1"/, 'the thread opens the page it was filed under');
assert.match(textOf(pageLink), /FILED UNDER: PROFILE \/\/ SWEDEN/, 'and says which subject it is');
assert.doesNotMatch(
  pageLink,
  /PROFILE ITEM/,
  'no hover box: a page is not an artwork slot, and there is nothing to preview over one',
);

const sheetLink = renderToStaticMarkup(
  element(AnchorLink, { anchor: { kind: 'asset', id: 'sheet-03', label: 'SHEET 03', href: '/concepts' } }),
);

assert.match(sheetLink, /ASSET ITEM/, 'an asset still gets its notice when no drawing is filed yet');

