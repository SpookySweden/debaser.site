/*
 * Scratch check for the board query and the profile permissions (run from the root):
 *   npx tsc app/lib/forum/board-query.ts app/lib/profile/visibility.ts app/lib/profile/elements.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ElementComments.tsx app/components/ProfileCommentBox.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-search-and-permissions.cjs
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { selectBoardThreads, threadAccountNames } = require('./check-out/forum/board-query.js');
const { canCommentOnPicture, canCommentOnProfile, canGiveTag, hiddenProfileCommentCount, withVisibilityDefaults } = require('./check-out/profile/visibility.js');
const { profileElementById } = require('./check-out/profile/elements.js');
const ElementComments = require('./render-out/components/ElementComments.js').default;
const ProfileCommentBox = require('./render-out/components/ProfileCommentBox.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;

/** The comment lines draw usernames, which read the account and its presence. */
const withPresence = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

const SHEET = { kind: 'asset', id: 'concept-sheet-01', label: 'SHEET 01 // FIGURE STUDY', href: '/concepts' };

/** A post an item's comment box opened: no body of its own. */
const itemPost = {
  id: 'thread-item',
  title: 'RE: SHEET 01 // FIGURE STUDY',
  body: '',
  author: { id: 'user-sweden', displayName: 'sweden' },
  createdAt: '2026-09-21T04:39:52.000Z',
  anchor: SHEET,
  tags: [],
  comments: [
    {
      id: 'c1',
      threadId: 'thread-item',
      body: 'The hands need one more pass.',
      author: { id: 'user-sweden', displayName: 'sweden' },
      createdAt: '2026-09-21T04:39:52.000Z',
      tags: [],
    },
    {
      id: 'c1b',
      threadId: 'thread-item',
      body: 'Agreed - the knuckles read flat.',
      author: { id: 'user-luke', displayName: 'luke' },
      createdAt: '2026-09-21T05:00:00.000Z',
      tags: [],
    },
  ],
  origin: 'user',
};

/** An ordinary board post by an account, with a guest reply. */
const boardPost = {
  id: 'thread-board',
  title: 'LINE WEIGHTS',
  body: 'Which reads better at 100%?',
  author: { id: 'user-mira', displayName: 'mira' },
  createdAt: '2026-09-20T10:00:00.000Z',
  anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD', href: '/forum' },
  tags: [{ id: 't1', kind: 'category', label: 'DESIGN' }],
  comments: [
    {
      id: 'c2',
      threadId: 'thread-board',
      body: 'try 2px',
      author: { id: null, displayName: '' },
      createdAt: '2026-09-20T11:00:00.000Z',
      tags: [],
    },
  ],
  origin: 'user',
};

const threads = [itemPost, boardPost];

function findBy(query) {
  return selectBoardThreads(threads, {
    query,
    sourceFilter: 'all',
    tagKeys: [],
    tagMatchMode: 'any',
    sortMode: 'newest',
  }).map((thread) => thread.id);
}

// 1. Names on a post: the credit first, then everyone who replied - in other
// words exactly the names the post puts on screen.
assert.deepEqual(threadAccountNames(boardPost), ['mira']);
assert.deepEqual(
  threadAccountNames(itemPost),
  ['debaser.site', 'sweden', 'luke'],
  'an item post is signed by the site, and its replies still carry their accounts',
);
assert.deepEqual(
  threadAccountNames({
    ...boardPost,
    comments: [
      { ...boardPost.comments[0], author: { id: 'user-mira', displayName: 'mira' } },
      { ...boardPost.comments[0], id: 'c3', author: { id: 'user-luke', displayName: 'luke' } },
    ],
  }),
  ['mira', 'luke'],
  'a name is not repeated',
);

// 2. Search by account: the poster, the site credit, and a reply's author.
assert.deepEqual(findBy('mira'), ['thread-board'], 'poster is searchable');
assert.deepEqual(findBy('sweden'), ['thread-item'], 'a reply author is searchable');
assert.deepEqual(findBy('luke'), ['thread-item'], 'every reply author is searchable');
assert.deepEqual(findBy('debaser.site'), ['thread-item'], 'the item credit is searchable');
assert.deepEqual(findBy('nobody'), [], 'unknown accounts match nothing');
assert.deepEqual(findBy('design'), ['thread-board'], 'tags still search');
assert.deepEqual(findBy('figure study'), ['thread-item'], 'the item label still searches');
assert.deepEqual(findBy('SwEdEn'), ['thread-item'], 'case is folded');


// 3. Owner permissions: the owner can always tag and comment on their own page.
const open = { showTags: true, showProfileComments: true, showAvatarComments: true };
const closed = { showTags: false, showProfileComments: false, showAvatarComments: false };

assert.equal(canGiveTag(true, closed), true, 'owner can tag their own profile');
assert.equal(canGiveTag(true, open), true);
assert.equal(canGiveTag(false, open), true, 'visitors can tag while tags show');
assert.equal(canGiveTag(false, closed), false, 'visitors get no box while tags are hidden');

assert.equal(canCommentOnProfile(true, closed), true, 'owner can comment on their own bio');
assert.equal(canCommentOnProfile(true, open), true);
assert.equal(canCommentOnProfile(false, open), true, 'visitors can comment while comments show');
assert.equal(canCommentOnProfile(false, closed), false, 'visitors read the notice instead');

// The picture's own box follows the same rule, and the button beside the version
// label is what offers it (the box itself lives in a window).
assert.equal(canCommentOnPicture(true, closed), true, 'owner can comment on their own picture');
assert.equal(canCommentOnPicture(false, open), true, 'visitors can while picture comments show');
assert.equal(canCommentOnPicture(false, closed), false, 'and get no button when they are switched off');

// The defaults a profile starts with (changed on purpose, 2026-11-05, SPEC-privacy-phase-1.md): everything closed until its owner opens it.
assert.equal(withVisibilityDefaults(undefined).showProfileComments, false, 'comments start closed');
assert.equal(withVisibilityDefaults(undefined).showAvatarComments, false, 'on the drawing too');
assert.equal(withVisibilityDefaults(undefined).showSongComments, false, 'and on the track');
assert.equal(withVisibilityDefaults(undefined).showTags, false, 'and tags');
assert.equal(withVisibilityDefaults({ showProfileComments: true }).showProfileComments, true, 'a switch on still wins');

// 4. The picture comment box is offered to the owner, and titled as their own.
const profile = {
  userId: 'user-sweden',
  displayName: 'sweden',
  bio: 'figure studies',
  country: 'SE',
  avatar: {
    versions: [
      {
        id: 'v1',
        version: 1,
        src: '/assets/profiles/uploads/mock-user.png',
        alt: 'picture',
        note: 'first pass',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'v2',
        version: 2,
        src: '/assets/profiles/uploads/mock-user-2.png',
        alt: 'picture',
        note: 'reworked the eyes',
        createdAt: '2026-09-21T00:00:00.000Z',
      },
    ],
    currentVersionId: 'v2',
  },
  visibility: { showTags: false, showProfileComments: false, showAvatarComments: true },
  tags: [],
  comments: [
    {
      id: 'c1',
      kind: 'avatar',
      author: { id: 'user-amy', displayName: 'amy' },
      body: 'the first version reads better',
      createdAt: '2026-09-20T01:00:00.000Z',
      avatarVersionId: 'v1',
      avatarVersionNumber: 1,
    },
    {
      id: 'c2',
      kind: 'avatar',
      author: { id: 'user-bob', displayName: 'bob' },
      body: 'the eyes are better here',
      createdAt: '2026-09-21T01:00:00.000Z',
      avatarVersionId: 'v2',
      avatarVersionNumber: 2,
    },
  ],
  updatedAt: '2026-09-21T00:00:00.000Z',
};

const viewer = { id: 'user-sweden', displayName: 'sweden' };
const element = React.createElement;

// 5. The comment feature is one thing for both elements, and it is a caption rather than a
//    plate of buttons: the tag says which version is being read (`P2` for a drawing, `M1`
//    for a track) and the thread folds behind one small arrow carrying its count. What is
//    under the fold is the list, and only that - the crawling moved to the profile's own feed
//    (see check-profile-layout.cjs), which carries every thread on the page in one line.
const pictureOne = profileElementById(profile, 'picture', 'v1');
const ownerHtml = withPresence(
  element(ElementComments, {
    profile,
    element: pictureOne,
    owner: true,
    repository: { setCommentPin: async () => profile },
    onComment: () => undefined,
    onSelect: () => undefined,
  }),
);
assert.match(ownerHtml, /P1/, 'the caption line carries the tag of the version on screen');
assert.doesNotMatch(ownerHtml, />comment</, 'and asks for no comment of its own any more');
assert.doesNotMatch(ownerHtml, /\[ COMMENT \]/, 'no plate is drawn to ask for a comment');
assert.match(ownerHtml, /▸ 1/, 'the thread waits behind a small arrow carrying its count');
assert.doesNotMatch(ownerHtml, /class="crawl/, 'and does not crawl under the element any more');
assert.doesNotMatch(ownerHtml, /the first version reads better/, 'so a folded thread prints none of itself');
assert.match(ownerHtml, /history \(2\)/, 'the other versions wait behind a link of their own');
assert.doesNotMatch(ownerHtml, /read P2/, 'so no version rows are drawn until it is opened');

const offProfile = { ...profile, visibility: { ...profile.visibility, showAvatarComments: false } };
const offHtml = withPresence(
  element(ElementComments, {
    profile: offProfile,
    element: profileElementById(offProfile, 'picture', 'v2'),
    owner: false,
    repository: { setCommentPin: async () => offProfile },
    onComment: () => undefined,
    onSelect: () => undefined,
  }),
);
assert.match(offHtml, /comments off/, 'a visitor is told the thread is switched off');
assert.doesNotMatch(offHtml, /the eyes are better here/, 'and is not shown what is in it');
assert.doesNotMatch(offHtml, /class="crawl/, 'nor is anything crawled past them');

// 6. The box is the field and the button; what the comment is about is handed to it, so one
//    box serves a drawing, a track and the profile without knowing which it is writing about.
const boxHtml = renderToStaticMarkup(
  element(ProfileCommentBox, {
    id: 'comment-check',
    title: 'COMMENT ON THIS PICTURE',
    placeholder: 'What do you make of this drawing?',
    submitLabel: '[ FILE COMMENT ]',
    onSubmit: async () => undefined,
    footer: 'COMMENTS FROM GUESTS ARE SIGNED ANONYMOUS (GUEST) - LOG IN TO SIGN YOURS.',
  }),
);
assert.match(boxHtml, /COMMENT ON THIS PICTURE/, 'the box is titled for the reader');
assert.match(boxHtml, /FILE COMMENT/, 'and files the comment');
assert.match(boxHtml, /<textarea/, 'with one field');
// (2026-10-23, SPEC-efficiency.md) A character count shows only in the last 10% before the limit, so an
// empty box shows none.
assert.doesNotMatch(boxHtml, /CHARS|\/ 400/, 'no count beside the button while there is room to spare');
assert.match(boxHtml, /SIGNED ANONYMOUS/, 'and the guest notice under it');
assert.doesNotMatch(boxHtml, /<select/, 'nothing is chosen with a dropdown');
assert.doesNotMatch(boxHtml, /group relative/, 'and the box carries no version buttons of its own any more');

const chosenHtml = renderToStaticMarkup(
  element(ProfileCommentBox, {
    id: 'chooser-check',
    title: 'COMMENT ON THIS PROFILE',
    placeholder: 'Say something about this profile...',
    submitLabel: '[ FILE COMMENT ]',
    onSubmit: async () => undefined,
    chooser: element('div', { className: 'HYPER-STRIP-MARK' }, ['profile picture', 'music', 'general']),
  }),
);
assert.match(chosenHtml, /HYPER-STRIP-MARK/, 'the run of choices is drawn by whoever knows the profile');
assert.match(chosenHtml, /general/, 'and holds them all');

console.log('search + permission checks passed');
console.log('  names on an item post :', threadAccountNames(itemPost).join(', '));
console.log('  "sweden" finds        :', findBy('sweden').join(', ') || '(nothing)');
console.log('  "debaser.site" finds  :', findBy('debaser.site').join(', ') || '(nothing)');
console.log('  comment box           :', /FILE COMMENT/.test(boxHtml) ? 'field, count, button - the choices come from the caller' : 'MISSING');
console.log('  element caption       :', /▸ 1/.test(ownerHtml) ? 'tag, fold with its count, and the list behind it' : 'MISSING');

/*
 * The owner is told how many profile comments visitors cannot see (found 2026-10-25: the page counted
 * "every comment minus the ones on screen", and the owner's screen holds every one, so it always said 0
 * and the line never showed). Only the switch hides one: all of them while it is off, none while it is on.
 */
{
  const comment = (id, kind) => ({ id, kind, author: { id: 'user-amy', displayName: 'amy' }, body: 'x', createdAt: '2026-10-25T00:00:00.000Z' });
  const comments = [comment('p1', 'profile'), comment('p2', 'profile'), comment('a1', 'avatar')];
  const withSwitch = (on) => ({ comments, visibility: { showTags: false, showProfileComments: on, showAvatarComments: true, showSongComments: true } });

  assert.equal(hiddenProfileCommentCount(withSwitch(false)), 2, 'switched off: both profile comments are hidden (the picture one is not a profile comment)');
  assert.equal(hiddenProfileCommentCount(withSwitch(true)), 0, 'switched on: none is hidden');
  assert.equal(hiddenProfileCommentCount({ ...withSwitch(false), comments: [] }), 0, 'switched off with nothing filed: nothing to count');
  console.log('  hidden profile comments: counted for the owner while the switch is off');
}
