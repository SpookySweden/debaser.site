/*
 * Scratch check for the shape of the profile page (run from the root):
 *   npx tsc app/components/PublicProfileWindow.tsx --outDir Temp/layout-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-layout.cjs
 *
 * What it is for: the page is two columns, each a thing with a thread tucked underneath it - the
 * drawing (`P2`) and the track (`M1`) - and then **one** crawling line across the whole window
 * carrying every remark the page has. That is a layout claim, and a layout claim only checked by
 * looking at it is one that quietly stops being true, so the order of the rendered markup is
 * asserted here: the columns, the feed, then the details, the biography and the profile's own
 * conversation last.
 *
 * Every store the page reads is stubbed, which is the only way to render a profile that has
 * something on it without a browser and a database.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const element = React.createElement;

/** The five hooks the page reads, each answered by hand. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const profile = {
  userId: 'user-sweden',
  displayName: 'sweden',
  bio: 'Draws the comic.',
  country: 'SE',
  avatar: {
    versions: [
      { id: 'p1', version: 1, src: '/one.png', alt: 'picture one', note: 'first pass', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'p2', version: 2, src: '/two.png', alt: 'picture two', note: 'reworked', createdAt: '2026-09-02T00:00:00.000Z' },
    ],
    currentVersionId: 'p2',
  },
  song: {
    versions: [
      {
        id: 'm1',
        version: 1,
        src: '/a.mp3',
        title: 'WARD THEME',
        credit: 'sweden',
        note: 'rough mix',
        createdAt: '2026-09-03T00:00:00.000Z',
      },
    ],
    currentVersionId: 'm1',
  },
  visibility: { showTags: true, showProfileComments: true, showAvatarComments: true, showSongComments: true },
  tags: [],
  comments: [
    {
      id: 'c-p1',
      kind: 'profile',
      author: { id: 'user-luke', displayName: 'luke' },
      body: 'the drawing is the one for me',
      createdAt: '2026-09-04T01:00:00.000Z',
    },
    {
      id: 'c-p2',
      kind: 'avatar',
      author: { id: 'user-amy', displayName: 'amy' },
      body: 'the second drawing is the one',
      createdAt: '2026-09-02T01:00:00.000Z',
      avatarVersionId: 'p2',
      avatarVersionNumber: 2,
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
  ],
  updatedAt: '2026-09-04T00:00:00.000Z',
};


stub('./layout-render/lib/profile/use-public-profile.js', {
  usePublicProfile: () => ({ profile, ready: true, source: 'supabase', repository: {}, refresh: async () => undefined }),
});

stub('./layout-render/components/AuthProvider.js', {
  default: ({ children }) => children,
  useAuth: () => ({
    user: null,
    ready: true,
    signIn: async () => ({ ok: false, error: 'x' }),
    signUp: async () => ({ ok: false, error: 'x' }),
    signOut: async () => undefined,
    updateDisplayName: async () => ({ ok: false, error: 'x' }),
    updateEmail: async () => ({ ok: false, error: 'x' }),
    updatePassword: async () => ({ ok: false, error: 'x' }),
  }),
});

/** The board, as the profile's wire and its activity list read it: one thread, two replies. */
const THREAD = {
  id: 'thread-1',
  title: 'SHEET 03',
  body: 'Which reads better at 100 percent?',
  author: { id: 'user-sweden', displayName: 'sweden' },
  createdAt: '2026-09-21T09:00:00.000Z',
  anchor: { kind: 'board', id: 'board', label: 'BOARD' },
  tags: [],
  origin: 'user',
  comments: [
    {
      id: 'r1',
      threadId: 'thread-1',
      body: 'the second pass',
      author: { id: 'user-amy', displayName: 'amy' },
      createdAt: '2026-09-21T10:00:00.000Z',
      tags: [],
    },
  ],
};

stub('./layout-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  useForum: () => ({
    threads: [THREAD],
    ready: true,
    pins: [],
    pinForThread: () => undefined,
    author: { id: null, displayName: 'Anonymous' },
    source: 'supabase',
  }),
});

/**
 * The account list: where a profile's join date comes from. A profile row carries no `created_at` and
 * the auth row belongs to its owner, so the status bar reads the one public source there is
 * (see ./ProfileStatusBar).
 */
// Updated on purpose (SPEC-test-accounts.md): the join date is now read from `allAccounts` - every account,
// the hidden test accounts included - so a test account's page has one too. Nobody is hidden here.
const SWEDEN_ACCOUNT = {
  id: 'user-sweden',
  email: 'sweden@example.test',
  displayName: 'sweden',
  createdAt: '2026-01-02T03:04:00.000Z',
  backend: 'mock',
};
stub('./layout-render/components/CommsProvider.js', {
  default: ({ children }) => children,
  useComms: () => ({
    accounts: [SWEDEN_ACCOUNT],
    allAccounts: [SWEDEN_ACCOUNT],
    unreadTotal: 0,
  }),
});

stub('./layout-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  /**
   * Offline, a while ago: the case the status bar exists for, and the one that has to read as a length
   * of time rather than as a stamp. The exact stamp is not asserted - the clock the label is measured
   * against is the real one - but its shape is.
   */
  usePresence: () => ({
    ready: true,
    status: 'offline',
    record: { userId: 'user-sweden', lastSeenAt: '2026-09-21T11:48:00.000Z', online: false },
    statusFor: () => 'offline',
    recordFor: () => undefined,
  }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

// The shell keeps its title and status as attributes (2026-10-25): the comment box lost its own heading to the
// window's title bar, so the title is what has to be read now.
stub('./layout-render/components/PopoutWindow.js', {
  __esModule: true,
  default: ({ title, status, children }) =>
    React.createElement('div', { 'data-window-title': title, 'data-window-status': status }, children),
});

stub('./layout-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => ({
    queue: [],
    track: undefined,
    index: 0,
    playing: false,
    loading: false,
    error: null,
    elapsed: 0,
    duration: Number.NaN,
    volume: 1,
    loop: true,
    toggle: () => undefined,
    next: () => undefined,
    previous: () => undefined,
    play: () => undefined,
    playAt: () => undefined,
    setVolume: () => undefined,
    setLoop: () => undefined,
    seek: () => undefined,
    refresh: () => undefined,
  }),
});

const PublicProfileWindow = require('./layout-render/components/PublicProfileWindow.js').default;
const html = renderToStaticMarkup(element(PublicProfileWindow, { userId: 'user-sweden' }));

function indexOf(pattern) {
  const found = html.search(pattern);
  assert.notEqual(found, -1, `the page draws ${String(pattern)}`);
  return found;
}

// 1. The two columns, each element named with its own tag, and then the page's feed under them.
// (2026-10-23, SPEC-efficiency.md) A profile shows a person, not a console: the drawing's `[ P2 ] (CURRENT)`
// caption and the track's `M1 (current) ::` prefix are cut. The columns are found by what is left in
// them - the drawing's own history fold, and the track column's caption.
assert.doesNotMatch(html, /\[ P2 \] \(CURRENT\)|M1 \(current\)/, 'no version tags read back at a visitor');
const picture = indexOf(/history \(2\)/);
const track = indexOf(/their track/);
// A remark only the feed carries now, so its first appearance is the feed's own line.
const feed = indexOf(/the second drawing is the one/);

assert.equal(picture < track, true, 'the drawing column is read before the track column');
assert.equal(track < feed, true, 'and the feed runs under both columns');

// 2. **One crawl on the page, and it is the feed.** The element threads used to crawl under their
//    own element as well - three lines in a window, two of them 212px wide. They keep their fold
//    and their list (`P2 ▸ 1`) and no longer crawl: their remarks are on the feed with everything
//    else said about the page (see app/components/ElementComments.tsx).
assert.equal((html.match(/class="crawl/g) ?? []).length, 1, 'only the feed crawls');
assert.equal((html.match(/border-dashed/g) ?? []).length, 1, 'and it sits on the surface it belongs to');
assert.equal((html.match(/▸ 1/g) ?? []).length, 3, 'each element folds its own thread away, and so does the panel');
assert.equal((html.match(/>comment</g) ?? []).length, 1, 'the profile has exactly one comment control');
assert.match(html, /aria-haspopup="menu"/, 'and it opens a menu');
assert.equal((html.match(/history \(2\)/g) ?? []).length, 1, 'only the drawing has other versions to offer');
assert.doesNotMatch(html, /\[ COMMENT \]/, 'and nothing is asked for with a button plate any more');

// 3. The feed itself: every remark the page carries - on the profile, on the drawing, on the
//    track - in one line across the full width of the window, in the band the old
//    `NEWSWIRE :: COMMENTS ON THIS PROFILE` caption used to explain the empty space in. No
//    heading, no placeholder, and each row stamped with what it was written about.
assert.doesNotMatch(html, /NEWSWIRE/, 'the feed carries no heading of its own');
assert.doesNotMatch(html, /NOBODY HAS COMMENTED|NOTHING YET/, 'and no placeholder for an empty one');
assert.match(html, /border-t border-dashed border-ink px-3 py-1/, 'as its own strip across the window');
assert.match(html, /\[ PROFILE \]/, 'the remark on the page itself is on it');
assert.match(html, /\[ P2 \]/, 'and the one on the drawing');
assert.match(html, /\[ M1 \]/, 'and the one on the track');
assert.doesNotMatch(html, /\[ POST \]/, 'and none of the board in it');
assert.match(html, /href="\/profile\/user-sweden#profile-comments"/, 'the page own remark opens the comments panel');
assert.equal(
  (html.match(/the second drawing is the one/g) ?? []).length,
  2,
  'and the run is held twice, so the crawl has no seam',
);

// 4. The rest of the page reads under the feed, in the order it is meant to: the account's own lines,
//    the biography, then the profile's conversation. (The details block used to be found by its
//    `ACCOUNT ID:` line; that line is gone from a profile - see section 7 - so it is found by the
//    country line, which is what it opens with now that the flag replaced the place.)
const details = indexOf(/COUNTRY:/);
// (2026-10-23, SPEC-efficiency.md) `BIOGRAPHY [ n CHARS ]` is cut; the bio is found by its own words.
const bio = indexOf(/Draws the comic\./);
assert.doesNotMatch(html, /BIOGRAPHY|CHARS \]/, 'with no heading counting its characters');
// The panel the feed's rows open, read by id rather than by a heading.
const profileComments = indexOf(/id="profile-comments"/);
assert.equal(feed < details, true, 'the details follow the feed');
assert.equal(details < bio, true, 'then the biography');
assert.equal(bio < profileComments, true, 'and the profile own conversation last');
// (2026-10-23, SPEC-efficiency.md) The second `general` heading and the `[ n VISIBLE ]` count are cut.
assert.doesNotMatch(html, /\[ 1 VISIBLE \]/, 'and the panel does not count what is on it');

// 4. The one comment control, and the menu behind it: three aspects, each saying whether it
//    is open to comments, drawn on every profile rather than only on profiles that happen to
//    have something filed.
const ProfileCommentMenu = require('./layout-render/components/ProfileCommentMenu.js');
const { ProfileCommentOptions } = require('./layout-render/components/ProfileCommentMenu.js');

const menuClosed = renderToStaticMarkup(
  element(ProfileCommentMenu.default, {
    options: [
      { kind: 'avatar', tag: 'P2', available: true },
      { kind: 'song', tag: 'M1', available: false, reason: 'switched off' },
      { kind: 'profile', available: true },
    ],
    onChoose: () => undefined,
  }),
);
assert.match(menuClosed, />comment</, 'the control is one comment link');
assert.match(menuClosed, /aria-haspopup="menu"/, 'and says a menu is what it opens');
// (2026-10-23, SPEC-efficiency.md) `n of 3 open to comments` is cut: the menu says it per aspect once opened.
assert.doesNotMatch(menuClosed, /open to comments/, 'and does not count what is open on it');
assert.doesNotMatch(menuClosed, /role="menu"/, 'the menu waits until it is asked for');

const menuOpen = renderToStaticMarkup(
  element(ProfileCommentOptions, {
    options: [
      { kind: 'avatar', tag: 'P2', available: true },
      { kind: 'song', tag: 'M1', available: false, reason: 'switched off' },
      { kind: 'profile', available: true },
    ],
    onChoose: () => undefined,
  }),
);
assert.match(menuOpen, /role="menu"/, 'the menu is a menu');
assert.match(menuOpen, /profile picture \(P2\)/, 'naming the drawing, with the version on screen');
assert.match(menuOpen, /music \(M1\)/, 'the track');
assert.match(menuOpen, /switched off/, 'with the threads the owner has closed marked as closed');
assert.equal((menuOpen.match(/<li /g) ?? []).length, 3, 'three options, one per aspect');

// A profile with nothing filed and every thread closed still draws the control, and the menu
// still lists all three aspects with the reason each is closed.
const bareOptions = [
  { kind: 'avatar', available: false, reason: 'nothing filed' },
  { kind: 'song', available: false, reason: 'nothing filed' },
  { kind: 'profile', available: false, reason: 'switched off' },
];

const menuBare = renderToStaticMarkup(
  element(ProfileCommentMenu.default, { options: bareOptions, onChoose: () => undefined }),
);
assert.match(menuBare, />comment</, 'the control is on every profile');
// (2026-10-23, SPEC-efficiency.md) (see above) The closed menu carries no count, empty or not.
assert.doesNotMatch(menuBare, /open to comments/, 'with no count when nothing is open either');

const bareMenu = renderToStaticMarkup(
  element(ProfileCommentOptions, { options: bareOptions, onChoose: () => undefined }),
);
assert.equal((bareMenu.match(/disabled=""/g) ?? []).length, 3, 'every option is there but not pressable');
// (2026-10-25, SPEC-less-text.md) Each option's tip repeated the reason drawn beside it: the tip is cut, so the
// reason is counted where it is drawn, as the row's own text.
assert.equal((bareMenu.match(/>nothing filed</g) ?? []).length, 2, 'and each says why it is not');
assert.equal((bareMenu.match(/>switched off</g) ?? []).length, 1, 'the profile itself included');
assert.doesNotMatch(bareMenu, /title="(nothing filed|switched off)"/, 'said once, not again as a tip');

// 5. The comment window: one window for the three things a profile can be commented on. The
//    choices are links inside one thin border (the border is what groups them), the aspect in
//    force is marked by the arrow, and the versions of the element follow in a strip of their
//    own when there is a choice to make. The window is a portal, so its shell is stubbed
//    (above, with the other stores) and the markup inside it is what is read here.
const ProfileCommentWindow = require('./layout-render/components/ProfileCommentWindow.js').default;
const { currentProfileElement } = require('./layout-render/lib/profile/elements.js');

function commentWindow(initial) {
  return renderToStaticMarkup(
    element(ProfileCommentWindow, {
      profile,
      repository: { addComment: async () => profile },
      viewer: { id: null, displayName: 'Anonymous' },
      viewerId: null,
      owner: false,
      initial,
      picture: currentProfileElement(profile, 'picture'),
      track: currentProfileElement(profile, 'track'),
      onSelect: () => undefined,
      onClose: () => undefined,
    }),
  );
}

const windowOnTrack = commentWindow('song');
assert.match(windowOnTrack, /ABOUT:/, 'the window asks what the comment is about');
assert.match(windowOnTrack, /profile picture \(P2\)/, 'and offers the drawing, named with its tag');
assert.match(windowOnTrack, /music \(M1\)/, 'the track, named with its tag');
assert.match(windowOnTrack, /▸ <\/span>music/, 'with the one in force marked by the arrow');
assert.match(windowOnTrack, /general/, 'and the profile itself, which has no version');
// (2026-10-25, SPEC-less-text.md) The box's own heading `COMMENT ON THIS MUSIC` repeated the window's title bar
// (`COMMENT ON THE MUSIC`, drawn by the stubbed shell): the box has no heading now. The guest footer
// `COMMENTS FROM GUESTS ARE SIGNED ANONYMOUS (GUEST) - LOG IN TO SIGN YOURS.` -> `POSTING AS GUEST.`
assert.match(windowOnTrack, /data-window-title="COMMENT ON THE MUSIC"/, 'the window is titled for the aspect in force');
assert.doesNotMatch(windowOnTrack, /COMMENT ON THIS MUSIC/, 'and the box does not say it again');
assert.match(windowOnTrack, /POSTING AS GUEST\./, 'a guest is told how their comment will be signed');
assert.doesNotMatch(windowOnTrack, /SIGNED ANONYMOUS \(GUEST\)/, 'in three words');
assert.match(windowOnTrack, /data-window-status="ABOUT: MUSIC[^"]*"/, 'the status line says what the comment is about');
assert.doesNotMatch(windowOnTrack, /ESC CLOSES/, 'and drops its ESC how-to');
assert.doesNotMatch(windowOnTrack, /VERSION:/, 'a single-version track has no version strip');
assert.doesNotMatch(windowOnTrack, /group relative/, 'and no drawing is hovered over');
assert.equal((windowOnTrack.match(/border border-ink bg-paper/g) ?? []).length, 1, 'the choices sit in one strip');

const windowOnDrawing = commentWindow('avatar');
assert.match(windowOnDrawing, /▸ <\/span>profile picture/, 'the drawing is the aspect in force');
assert.match(windowOnDrawing, /VERSION:/, 'and its other versions are offered underneath');
assert.match(windowOnDrawing, /\(current\)/, 'the version being read is said to be the current one');
assert.equal(
  (windowOnDrawing.match(/border border-ink bg-paper/g) ?? []).length,
  2,
  'the aspects and the versions are two runs, each in its own border',
);
assert.equal((windowOnDrawing.match(/group relative/g) ?? []).length, 2, 'each drawing is previewed while hovered');

// 6. The picture's own frame: the notice where there is room for the words, a plain `?` where
//    the frame is only a thumbnail's width - the side panel's card and the picture revealed on
//    hover are 56px, and "NO PICTURE" is wider than the box it would sit in.
const ProfileAvatar = require('./layout-render/components/ProfileAvatar.js').default;

const bigEmpty = renderToStaticMarkup(element(ProfileAvatar, { version: undefined, displayName: 'sweden', size: 128 }));
const smallEmpty = renderToStaticMarkup(element(ProfileAvatar, { version: undefined, displayName: 'sweden', size: 56 }));
const cornerEmpty = renderToStaticMarkup(
  element(ProfileAvatar, { version: undefined, displayName: 'sweden', size: 26, variant: 'plain' }),
);

assert.match(bigEmpty, /NO PICTURE/, 'a full-size frame says what is missing');
assert.doesNotMatch(smallEmpty, /NO PICTURE/, 'a thumbnail does not - the words do not fit');
assert.match(smallEmpty, /sprite-slot/, 'and shows the anonymous slot instead');
assert.match(cornerEmpty, /sprite-slot/, 'the corner chip is the same anonymous slot');

const filled = renderToStaticMarkup(
  element(ProfileAvatar, {
    version: { id: 'v1', version: 1, src: '/assets/concepts/concept-sheet-01.png', note: '', createdAt: 'x' },
    displayName: 'sweden',
    size: 128,
  }),
);
assert.match(filled, /alt="sweden profile picture v1"/, 'a picture on the profile is drawn at its own size');
assert.match(filled, /P1/, 'with the version under it');

// 7. The status bar at the foot of the window: whether they are about, when they were last here, and
//    when the account was made. It is the only place the last-seen question is answered now, and it
//    answers it as a length of time - `LAST ONLINE 12 MINUTES AGO`, never a UTC stamp - while the join
//    date stays a stamp, because a date is what that is. Two things are asserted *gone*, because they
//    were developer data on a person's page and this is what stops them creeping back: the raw account
//    id, and the console furniture (how many versions are filed, and which threads are switched on).
assert.match(html, /JOINED/, 'the join date is on the status bar');
assert.match(html, /JOINED <span[^>]*>2026-01-02 03:04/, 'read from the account list, the one public source of it');
assert.match(html, /LAST ONLINE \d+ [A-Z]+S? AGO/, 'the last-seen line is relative, not a stamp');
// Held to the shared `STATUS_BAR` itself rather than to a copy of its classes: the copy pinned
// `text-[10px]`, and the readability pass (SPEC-readability.md) raised every label to 13px - the
// status line was still the shared one, the check just remembered an old spelling of it.
const { STATUS_BAR } = require('./layout-render/lib/ui/controls.js');
assert.ok(
  html.includes(`class="${STATUS_BAR}`),
  "and it is drawn with the site's own status line, not as a sentence in the page",
);
assert.doesNotMatch(html, /ACCOUNT ID/, "the account id is not on a profile: it is the store's business");
assert.doesNotMatch(html, /PICTURE VERSIONS|TRACK VERSIONS|TAGS GIVEN/, 'nor is a count of how much is filed');
assert.doesNotMatch(html, /TAGS: VISIBLE|VISIBLE :: /, 'nor the row of visibility switches the customiser owns');

console.log('profile layout checks passed');
console.log('  columns     : drawing P2 and track M1, each with its fold and its own list');
console.log('  comment     : one control above both columns, opening a menu of the three aspects');
console.log('  feed        : every remark the page carries, on one line across the window');
console.log('  window      : one for the profile, three aspects, each run of choices in one border');
console.log('  underneath  : place, tags, biography, then the profile own comments');
console.log('  status bar  : online / last online in words, and the join date, on one rigid line');
