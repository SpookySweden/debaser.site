/*
 * Scratch check for the board's post layout (run from the project root):
 *   npx tsc app/lib/forum/post-layout.ts --outDir Temp/layout-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-post-layout.cjs
 *
 * It mirrors what ForumThreadCard does: decide whether the thread is item-owned
 * (the same `isAutoFiledBody` rule) and ask buildPostLayout who the header names.
 */
const assert = require('node:assert/strict');
const { buildPostLayout, postLayoutInput, postMetaLine } = require('./layout-check/forum/post-layout.js');
const { SITE_AUTHOR, SITE_AUTHOR_PICTURE } = require('./layout-check/forum/site-author.js');

const LEGACY_AUTO_FILED_BODY = 'Auto-filed from a site comment box.';

/** Same rule as isAutoFiledBody in app/lib/forum/anchors.ts. */
function isAutoFiledBody(body) {
  const trimmed = body.trim();
  return trimmed.length === 0 || trimmed === LEGACY_AUTO_FILED_BODY;
}

const SHEET = {
  kind: 'asset',
  id: 'concept-sheet-01',
  label: 'SHEET 01 // FIGURE STUDY',
  href: '/concepts',
  preview: { src: '/assets/concepts/concept-sheet-01.png', alt: 'sheet', width: 352, height: 366 },
};

function thread(overrides) {
  return {
    id: 'thread-1',
    title: 'RE: SHEET 01 // FIGURE STUDY',
    body: '',
    author: { id: 'user-sweden', displayName: 'sweden' },
    createdAt: '2026-09-21T04:39:52.000Z',
    anchor: SHEET,
    tags: [],
    comments: [],
    origin: 'user',
    ...overrides,
  };
}

function layoutFor(subject, isOpen, authorProfile) {
  return buildPostLayout({
    thread: subject,
    isOpen,
    authorProfile,
    postedLabel: 'POSTED 2026-09-21 04:39:52',
    repliesLabel: '0 REPLIES',
    imageSourceLabel: 'ITEM ARTWORK', // the label imageSourceLabel('item') gives since SPEC-less-text.md
    postImage: SHEET.preview,
  });
}

const swedenProfile = {
  userId: 'user-sweden',
  displayName: 'sweden',
  bio: '',
  country: 'SE',
  avatar: { versions: [], currentVersionId: null },
  visibility: { showTags: true, showProfileComments: false, showAvatarComments: true },
  tags: [
    { id: 'tag-1', label: 'DESIGN', givenBy: { id: 'user-other', displayName: 'other' }, givenAt: '2026-09-20T00:00:00.000Z', hidden: false },
    { id: 'tag-2', label: 'HIDDEN ONE', givenBy: { id: 'user-other', displayName: 'other' }, givenAt: '2026-09-20T00:00:00.000Z', hidden: true },
  ],
  comments: [],
  updatedAt: '2026-09-21T00:00:00.000Z',
};

// 1. A thread a concept sheet's comment box opened: the sheet posted it, not sweden.
// The byline is the house account (app/lib/auth/builtin-account.ts), so it is a
// real account with a real id - the board just never names the first commenter.
const closedItemPost = layoutFor(thread(), false, null);
assert.equal(closedItemPost.author.credit.id, 'debaser-site', 'the item credit is the house account');
assert.equal(closedItemPost.author.credit.displayName, SITE_AUTHOR.displayName);
assert.equal(closedItemPost.author.name, 'debaser.site', 'header names the site');
assert.equal(closedItemPost.author.picture, SITE_AUTHOR_PICTURE, 'header uses the default pfp slot');
assert.equal(closedItemPost.author.country, '', 'the site has no country flag');
assert.deepEqual(closedItemPost.author.displayedTags, [], 'the site has no given tags');
assert.equal(closedItemPost.hasProfile, true, 'the byline opens the house account profile');
// The strip leads with the picture in both states: a picture that only arrives on hover cannot lead
// anything, and a phone has no hover to arrive with. `avatar` is 'shown' for anybody the board can
// name - the house account included, which falls back to the default pfp slot above.
assert.equal(closedItemPost.avatar, 'shown', 'the collapsed strip draws the picture too');
assert.equal(layoutFor(thread(), true, null).avatar, 'shown', 'and the open card draws the same strip');

// 2. Legacy filler body counts as item-owned too, so old rows credit the item.
const legacy = layoutFor(thread({ body: LEGACY_AUTO_FILED_BODY }), true, null);
assert.equal(legacy.author.name, 'debaser.site');

// 3. An ordinary post on the board keeps naming the account that wrote it.
const ownPost = layoutFor(
  thread({ title: 'FIGURES', body: 'Which line weight reads best?' }),
  true,
  swedenProfile,
);
assert.equal(ownPost.author.credit.displayName, 'sweden', 'a real post keeps its poster');
assert.equal(ownPost.author.name, 'sweden');
assert.equal(ownPost.author.picture, undefined, 'no default pfp for a person');
assert.equal(ownPost.author.country, 'SE', 'the flag comes from the profile');
assert.deepEqual(ownPost.author.displayedTags.map((tag) => tag.label), ['DESIGN'], 'hidden tag stays hidden');
assert.equal(ownPost.hasProfile, true);
// The byline *draws* the flag and the meta line *names* it, so a screen reader and a search result
// get the same fact the picture carries. This is the assertion behind the flag-as-text pairing.
assert.match(postMetaLine(ownPost), /SWEDEN/, 'the meta line names the country, not the code');
assert.equal(
  postMetaLine(closedItemPost).split(' :: ').length,
  2,
  'a byline with no flag adds no country to the meta line',
);

// 4. A guest post with no profile still has nothing to draw.
const guestPost = layoutFor(thread({ title: 'ANON', body: 'hello', author: { id: null, displayName: '' } }), false, null);
assert.equal(guestPost.author.name, 'Anonymous');
assert.equal(guestPost.avatar, 'hidden', 'guests have no picture');
assert.equal(guestPost.author.picture, undefined);

// 5. The labels belong to the thread, not to the caller: `postLayoutInput` reads the stamp, the reply
// count and where the picture came from off the thread itself, so the board's card, the gallery's tile
// and this file cannot come to disagree about what a post says about itself.
const derived = buildPostLayout(postLayoutInput(thread(), false, null));
assert.equal(derived.postedLabel, 'POSTED 2026-09-21 04:39', 'the stamp is read off the thread, to the minute, in UTC');
assert.equal(derived.repliesLabel, '0 REPLIES', 'and so is the reply count');
assert.equal(
  derived.left.imageSource,
  // (2026-10-25, SPEC-less-text.md) `ARTWORK OF THE ITEM THIS THREAD IS FILED UNDER` -> `ITEM ARTWORK`
  // (app/lib/forum/media.ts imageSourceLabel).
  'ITEM ARTWORK',
  'with no picture of its own, the thread previews the item it is filed under',
);

const withReplyImage = buildPostLayout(
  postLayoutInput(
    thread({
      body: 'a post of my own',
      comments: [
        {
          id: 'c1',
          threadId: 'thread-1',
          body: 'here is a detail',
          author: { id: 'user-amy', displayName: 'amy' },
          createdAt: '2026-09-21T10:00:00.000Z',
          tags: [],
          media: { src: '/assets/concepts/detail.png', alt: 'detail', width: 96, height: 96 },
        },
      ],
    }),
    false,
    null,
  ),
);
assert.equal(withReplyImage.repliesLabel, '1 REPLY', 'one reply is a reply, not replies');
assert.equal(
  withReplyImage.left.imageSource,
  'REPLY IMAGE', // (2026-10-25, SPEC-less-text.md) was `IMAGE ATTACHED TO A REPLY`
  'and a picture a reply came with is named as the reply`s, not the post`s',
);

// 6. (2026-10-24, Luke: the expanded item thread was messy and read as an empty post by the site.)
// An item's own thread is titled COMMENTS ON whatever an older build stored, and carries a *subject*
// for the strip instead of a byline. A profile's thread is credited to the page's owner, never the
// site; a sheet's keeps the site credit but leads with the sheet; a post has no subject at all.
const PROFILE = { kind: 'profile', id: 'profile:user-demzou', label: 'PROFILE // DEMZOU', href: '/profile/user-demzou' };
const profileThread = thread({
  title: 'RE: PROFILE // DEMZOU',
  anchor: PROFILE,
  comments: [
    {
      id: 'c1',
      threadId: 'thread-1',
      body: 'hello',
      author: { id: 'user-demzou', displayName: 'Demzou' },
      createdAt: '2026-09-22T01:48:00.000Z',
      tags: [],
    },
  ],
});
const owned = layoutFor(profileThread, true, null);
assert.equal(owned.author.credit.id, 'user-demzou', 'a profile thread is credited to the page owner');
assert.equal(owned.author.name, 'DEMZOU', 'spelt as the anchor spells it while no profile is to hand');
assert.equal(owned.author.picture, undefined, 'no house pfp for a person');
assert.equal(owned.title, 'COMMENTS ON PROFILE // DEMZOU', 'an old RE: title is shown as COMMENTS ON');
assert.deepEqual(owned.subject, { kind: 'person', owner: { id: 'user-demzou', displayName: 'DEMZOU' } });
assert.equal(owned.lastActivityAt, '2026-09-22T01:48:00.000Z', 'dated by the newest comment');
const withOwnerProfile = layoutFor(profileThread, true, { ...swedenProfile, userId: 'user-demzou', displayName: 'Demzou' });
assert.equal(withOwnerProfile.author.name, 'Demzou', 'the profile spells the name when it is to hand');
assert.equal(withOwnerProfile.author.country, 'SE', 'and the owner wears their flag');
assert.equal(withOwnerProfile.subject.owner.displayName, 'Demzou', 'the strip names them the same way (it drew DEMZOU before this line)');
assert.deepEqual(
  closedItemPost.subject,
  { kind: 'item', label: SHEET.label, href: '/concepts', preview: SHEET.preview },
  'a sheet thread leads with the sheet',
);
assert.equal(closedItemPost.title, 'COMMENTS ON SHEET 01 // FIGURE STUDY');
assert.equal(ownPost.subject, undefined, 'a post has a byline, not a subject');
assert.equal(ownPost.title, 'FIGURES', 'and keeps its own title');

console.log('post-layout checks passed');
console.log('  item-owned header :', closedItemPost.author.name, '| pfp slot:', closedItemPost.author.picture);
console.log('  own post header   :', ownPost.author.name, '::', postMetaLine(ownPost));
