/*
 * Scratch check for the account page, the music page's controls and the notification window
 * (run from the root):
 *   npx tsc app/components/AccountConsole.tsx app/components/AccountDetails.tsx app/components/AccountSecurityPanel.tsx app/components/AccountForms.tsx app/components/NewArchiveFileWindow.tsx app/components/NewArchiveFolderWindow.tsx app/components/IncomingMessageWindow.tsx app/components/CommsNotifier.tsx --outDir Temp/account-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-account-music.cjs
 *
 * What it is for: the account page is the one page whose shape depends on who is looking at
 * it - signed out it is a way in, signed in it is a console - and the music page's upload
 * form states file rules (WAV and FLAC, a size cap) that nobody can check by reading the
 * markup. Both are asserted here, along with the pop-up a message arrives in.
 *
 * The window shell is stubbed to a div that keeps its title, because a portal renders nothing
 * on the server - without that, nothing inside any pop-up could be checked at all.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** Who is signed in, switched between renders: the page's shape depends on it. */
let account = null;
let status = 'signed-out';
/** Which auth backend the stub claims: the DANGER ZONE is drawn only for the local (mock) one. */
let mockAuth = false;

const PROFILE = {
  userId: 'user-sweden',
  displayName: 'sweden',
  bio: 'Draws the comic.',
  country: 'SE',
  avatar: { versions: [], currentVersionId: '' },
  song: { versions: [], currentVersionId: '' },
  visibility: { showTags: true, showProfileComments: true, showAvatarComments: true, showSongComments: true },
  tags: [],
  comments: [],
  updatedAt: '2026-09-21T00:00:00.000Z',
};

stub('./account-render/components/AuthProvider.js', {
  default: ({ children }) => children,
  useAuth: () => ({
    user: account,
    status,
    ready: true,
    backend: 'supabase',
    usingMockAuth: mockAuth,
    requiresEmailConfirmation: false,
    signIn: async () => ({ ok: true }),
    signUp: async () => ({ ok: true }),
    signOut: async () => undefined,
    updateDisplayName: async () => ({ ok: true }),
    updateEmail: async () => ({ ok: true }),
    updatePassword: async () => ({ ok: true }),
    banAccount: async () => undefined,
    unbanAccount: async () => undefined,
  }),
});

stub('./account-render/components/PresenceProvider.js', {
  default: ({ children }) => children,
  usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
  usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
});

stub('./account-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  useForum: () => ({
    threads: [],
    author: { id: null, displayName: 'Anonymous' },
    ready: true,
    source: 'supabase',
    tagVocabulary: [],
    tagColours: {},
    rememberTagColour: () => undefined,
  }),
});

/**
 * What the player at the bottom of the window is working from, for the directory's render:
 * two shelf files with their tags, so the counts and the play actions have something to say.
 */
const MUSIC_QUEUE = [
  {
    id: 'shelf-1',
    title: 'DEMO ONE - DEMO SESSIONS - SWEDEN',
    credit: 'SWEDEN',
    kind: 'DEMO SESSIONS :: 1999',
    src: 'https://example.supabase.co/storage/v1/object/public/mp3/user/demo-one.mp3',
    length: '2:10',
    tags: ['HIP HOP'],
    folderPath: 'SWEDEN/DEMO SESSIONS',
    trackNumber: 1,
    shelf: 'bucket',
  },
  {
    id: 'mira-volkov-static-bloom-01',
    title: 'GLASS CORRIDOR - STATIC BLOOM - MIRA VOLKOV',
    credit: 'MIRA VOLKOV',
    kind: 'STATIC BLOOM :: 1996',
    src: '/assets/audio/mira-volkov-static-bloom-01.mp3',
    length: '4:12',
    tags: ['AMBIENT', 'LO FI'],
    folderPath: 'MIRA VOLKOV/STATIC BLOOM',
    trackNumber: 1,
    shelf: 'archive',
  },
];

stub('./account-render/components/MusicPlayerProvider.js', {
  default: ({ children }) => children,
  useMusicPlayer: () => ({
    queue: MUSIC_QUEUE,
    track: undefined,
    index: 0,
    playing: false,
    loading: true,
    error: null,
    elapsed: 0,
    duration: Number.NaN,
    volume: 1,
    loop: true,
    toggle: () => undefined,
    next: () => undefined,
    previous: () => undefined,
    play: () => undefined,
    assign: () => undefined,
    playAt: () => undefined,
    setVolume: () => undefined,
    setLoop: () => undefined,
    seek: () => undefined,
    refresh: () => undefined,
  }),
});

stub('./account-render/components/CommsProvider.js', {
  default: ({ children }) => children,
  useComms: () => ({
    ready: true,
    userId: account === null ? null : account.id,
    threads: [],
    unreadTotal: 0,
    accounts: [],
    accountsReady: true,
    nameById: new Map(),
    error: null,
    markRead: () => undefined,
    send: async () => undefined,
    sendToThread: async () => undefined,
  }),
});

stub('./account-render/lib/profile/use-public-profile.js', {
  usePublicProfile: () => ({
    profile: PROFILE,
    ready: true,
    source: 'supabase',
    repository: {},
    refresh: async () => undefined,
  }),
});

stub('./account-render/lib/ui/use-compact-viewport.js', {
  useCompactViewport: () => false,
});

stub('next/navigation', {
  usePathname: () => '/forum',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  // The music directory reads its tag filter out of the address.
  useSearchParams: () => new URLSearchParams(''),
});

stub('next/link', {
  __esModule: true,
  default: ({ href, children, ...rest }) =>
    React.createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children),
});

stub('./account-render/components/ForumProvider.js', {
  default: ({ children }) => children,
  // No board in this render: the directory's rows are the shelf's own files.
  useForum: () => ({ threads: [], ready: true, author: { id: null, displayName: 'Anonymous' } }),
});

stub('./account-render/components/PopoutWindow.js', {
  __esModule: true,
  default: ({ title, badge, status: windowStatus, actions, children }) =>
    React.createElement(
      'div',
      { 'data-window': title, 'data-badge': badge, 'data-status': windowStatus },
      React.createElement('div', { 'data-actions': 'true' }, actions),
      children,
    ),
});

const AccountConsole = require('./account-render/components/AccountConsole.js').default;
const AccountSecurityPanel = require('./account-render/components/AccountSecurityPanel.js').default;
const AccountForms = require('./account-render/components/AccountForms.js').default;
const IncomingMessageWindow = require('./account-render/components/IncomingMessageWindow.js').default;
const CommsNotifier = require('./account-render/components/CommsNotifier.js').default;

const element = React.createElement;
const render = (child) => renderToStaticMarkup(child);

// 1. Signed out, the account page is a way in: a form to create an account and one to log in,
//    each with its fields, and the Google door beside them.
const forms = render(element(AccountForms, null));
assert.match(forms, /CREATE ACCOUNT/, 'the page offers account creation');
// (2026-10-23, SPEC-efficiency.md) The `[ SIGN UP ]` badge repeated the section's title, CREATE ACCOUNT: cut.
assert.doesNotMatch(forms, /\[ SIGN UP \]/, 'and no badge says the title again');
assert.match(forms, /type="email"/, 'with an address field');
assert.match(forms, /type="password"/, 'a password field');

const guestConsole = render(element(AccountConsole, null));
assert.match(guestConsole, /CREATE ACCOUNT/, 'a visitor is handed the forms');
// (2026-10-23, SPEC-efficiency.md) A guest is not "signed in as" anybody, so the line is drawn only for an
// account; and the `WHAT LIVES UNDER THIS TAB` contents list (of sections right below it) is cut.
assert.doesNotMatch(guestConsole, /SIGNED IN AS/, 'and is not told they are signed in as anybody');
assert.doesNotMatch(guestConsole, /WHAT LIVES UNDER THIS TAB|OPENS AFTER SIGN IN/, 'nor handed a contents list');
assert.doesNotMatch(guestConsole, /CUSTOMISE PUBLIC PROFILE|DANGER ZONE<\/span>/, 'and the console itself is not there');

// 2. Signed in, the page is a console: an index of the sections that live under the tab, the
//    profile panel itself, and the session controls - and no sign-in form any more.
account = { id: 'user-sweden', displayName: 'sweden', email: 'sweden@debaser.site', createdAt: '2026-09-01T00:00:00.000Z' };
status = 'signed-in';

const consolePage = render(element(AccountConsole, null));
assert.match(consolePage, /PUBLIC PROFILE/, 'the index names the profile section');
assert.match(consolePage, /EDIT ACCOUNT/, 'the account editing section');
assert.match(consolePage, /BOARD ACTIVITY/, 'what this account has filed');
// (2026-10-25, SPEC-less-text.md) On Supabase the DANGER ZONE held only the sentence "ACCOUNT DELETION IS
// HANDLED BY THE ARCHIVE OWNER." - nothing to press - so the section is drawn only for the local backend,
// where it has the delete and clear keys. The session control (sign out) lives in ACCOUNT DETAILS.
assert.match(consolePage, /\[ SIGN OUT \]/, 'and the session control, named for what it does');
assert.doesNotMatch(consolePage, /DANGER ZONE/, 'on Supabase there is no empty DANGER ZONE');
assert.doesNotMatch(consolePage, /HANDLED BY THE ARCHIVE OWNER/, 'nor the sentence that was all it held');
mockAuth = true;
const mockConsolePage = render(element(AccountConsole, null));
mockAuth = false;
assert.match(mockConsolePage, /DANGER ZONE/, 'on the local backend the DANGER ZONE is drawn');
assert.match(mockConsolePage, /\[ DELETE ACCOUNT \]/, 'with its shortened delete key');
assert.match(mockConsolePage, /\[ CLEAR LOCAL ACCOUNTS \]/, 'and its shortened clear key');
assert.doesNotMatch(mockConsolePage, /SIGNS YOU OUT AND CLEARS THE ACCOUNTS HELD IN THIS BROWSER/, 'without the local-mode note');
assert.match(consolePage, /sweden/, 'the signed-in name is read back to them');

const security = render(element(AccountSecurityPanel, null));
assert.match(security, /type="email"/, 'the account editing panel takes the address');
assert.match(security, /type="password"/, 'and a password');
assert.match(security, /sweden/, 'and shows the name on the account');

// 3. (2026-10-24, SPEC-media-catalogue.md) The music directory moved onto the media page as the
//    catalogue's AUDIO tab, drawn in the catalogue's own shape: Temp/check-media-catalogue.cjs holds it.

account = { id: 'user-sweden', displayName: 'sweden', email: 'sweden@debaser.site' };
status = 'signed-in';

// 4. A message that arrives: the pop-up names who it is from and carries the conversation.
const thread = {
  id: 'dm:user-amy|user-sweden',
  kind: 'direct',
  participants: ['user-amy', 'user-sweden'],
  name: '',
  createdAt: '2026-09-21T09:59:00.000Z',
  updatedAt: '2026-09-21T10:01:00.000Z',
  readAt: {},
  messages: [
    {
      id: 'm1',
      authorId: 'user-amy',
      authorName: 'amy',
      body: 'the third panel is filed',
      createdAt: '2026-09-21T10:00:00.000Z',
    },
    {
      id: 'm2',
      authorId: 'user-sweden',
      authorName: 'sweden',
      body: 'reading it now',
      createdAt: '2026-09-21T10:01:00.000Z',
    },
  ],
};

const incoming = render(
  element(IncomingMessageWindow, {
    thread,
    userId: 'user-sweden',
    otherId: 'user-amy',
    nameById: new Map([['user-amy', 'amy']]),
    onSend: async () => undefined,
    onClose: () => undefined,
  }),
);
// (2026-10-25, SPEC-less-text.md) The title shortened from `COMMS :: NEW MESSAGE FROM AMY` to `MESSAGE :: AMY`.
assert.match(incoming, /MESSAGE :: AMY/, 'the window names who wrote');
assert.doesNotMatch(incoming, /NEW MESSAGE FROM/, 'in the short title, not the long one');
// (2026-10-23, SPEC-efficiency.md) The `[ INCOMING ]` badge repeated the title (`NEW MESSAGE FROM ...`): cut.
assert.doesNotMatch(incoming, /\[ INCOMING \]/, 'and does not say so twice');
assert.match(incoming, /the third panel is filed/, 'the message is in it');
// (2026-10-25, SPEC-less-text.md) The how-to status line `ANSWER HERE, OR OPEN THE COMMS PAGE :: ESC CLOSES`
// is cut (rule 1); the answer box and the /comms key below are the way to answer.
assert.doesNotMatch(incoming, /ANSWER HERE, OR OPEN THE COMMS PAGE|ESC CLOSES/, 'without the how-to line');
assert.match(incoming, /<textarea|<input/, 'with the box to answer in');
assert.match(incoming, /\/comms/, 'or the way to the whole conversation');

// 5. The notifier says nothing until the store says there is something to say.
assert.equal(render(element(CommsNotifier, null)), '', 'no unread conversations, no pop-up');

console.log('account + music checks passed');
console.log('  signed out : forms to create an account and to log in');
console.log('  signed in  : the console index, the profile panel and the session controls');
console.log('  music      : the shelf reading its own list, the upload rules stated out loud');
console.log('  comms      : the incoming window named after the sender');
