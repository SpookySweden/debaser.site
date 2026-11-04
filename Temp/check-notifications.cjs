/*
 * Scratch check for tagging and the notification feed (run from the root):
 *   npx tsc app/lib/forum/mentions.ts app/lib/notifications/types.ts app/lib/notifications/feed.ts app/lib/notifications/mock-notifications-repository.ts --outDir Temp/notifications-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/NotificationMenu.tsx app/components/NotificationBell.tsx --outDir Temp/notifications-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-notifications.cjs
 *
 * What it is for: a tag is the words themselves, so the rule that turns `@name` into an account
 * has to be right in three places at once - what a post says, who is told, and who is *not*
 * (the writer is never told about their own words, and a tag nobody answers to is just a name in
 * a post). Then the same for the feed: the newest first, unread means a null stamp, one row per
 * account per post however often the post names them, and an empty feed that is not the same
 * thing as a feed nobody could read.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  mentionToken,
  mentionTokens,
  mentionsIn,
  insertMention,
  removeMention,
  answeredAuthor,
} = require('./notifications-out/forum/mentions.js');
const {
  snippet,
  dedupeTargets,
  sortNotificationsNewestFirst,
  unreadNotificationCount,
  notificationSummary,
  notificationLabel,
  notificationVerb,
  isUnread,
  splitNotifications,
  notificationKindCounts,
  notificationBreakdown,
} = require('./notifications-out/notifications/feed.js');
const { MAX_NOTIFICATION_SNIPPET } = require('./notifications-out/notifications/types.js');
const { getMockNotificationsRepository } = require('./notifications-out/notifications/mock-notifications-repository.js');

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const notif = (id, kind, extra = {}) => ({
  id,
  userId: 'u-sweden',
  kind,
  actorId: 'u-amy',
  actorName: 'amy',
  threadId: 'thread-1',
  threadTitle: 'SHEET 03',
  body: 'look at the knuckles',
  createdAt: '2026-09-21T10:00:00.000Z',
  readAt: null,
  ...extra,
});

// 1. A mention is `@name` in the words.
const ACCOUNTS = [
  { id: 'u-amy', displayName: 'amy' },
  { id: 'u-sweden', displayName: 'sweden' },
  { id: 'u-house', displayName: 'debaser.site' },
  { id: 'u-two', displayName: 'two words' },
];

assert.equal(mentionToken('amy'), '@amy');
assert.equal(mentionToken('  debaser.site '), '@debaser.site');
assert.equal(mentionToken('two words'), '@two_words', 'a space becomes an underscore: one token, one account');
assert.deepEqual(mentionTokens('@amy and @sweden and @amy again'), ['amy', 'sweden'], 'read in order, once each');
assert.deepEqual(mentionsIn('hello @AMY', ACCOUNTS).map((a) => a.id), ['u-amy'], 'a name is matched case-insensitively');
assert.deepEqual(mentionsIn('see @two_words', ACCOUNTS).map((a) => a.id), ['u-two'], 'and the underscore folds back');
assert.deepEqual(mentionsIn('nobody here', ACCOUNTS), [], 'no tags, no notifications');
assert.deepEqual(mentionsIn('write to bob@example.com', ACCOUNTS), [], 'an address is not a tag');
assert.deepEqual(mentionsIn('@nobody', ACCOUNTS), [], 'a name nobody answers to is just words');

assert.equal(insertMention('look at this', 'amy'), 'look at this @amy ', 'the picker writes the same words');
assert.equal(insertMention('look at this @amy', 'AMY'), 'look at this @amy', 'tagging twice is tagging once');
assert.equal(removeMention('look at this @amy ', 'amy'), 'look at this', 'and it can be taken back out');
assert.equal(removeMention('@amy', 'amy'), '', 'even when it is the whole post');

// Who a reply answers, which is who it tags without being asked.
const THREAD = {
  author: { id: 'u-sweden', displayName: 'sweden' },
  comments: [
    { id: 'c1', threadId: 'thread-1', body: 'the second pass', author: { id: 'u-amy', displayName: 'amy' }, createdAt: '2026-09-21T09:30:00.000Z', tags: [] },
  ],
};
assert.equal(answeredAuthor(THREAD, undefined).id, 'u-sweden', 'a reply under a post answers its writer');
assert.equal(answeredAuthor(THREAD, 'c1').id, 'u-amy', 'a reply to a reply answers that writer');
assert.equal(answeredAuthor(THREAD, 'gone').id, 'u-sweden', 'and a reply to something removed still answers the post');
assert.equal(answeredAuthor(THREAD, undefined).displayName, 'sweden', 'the name comes with it, for the notice');

// 2. The feed's own rules, as plain functions both stores share.
assert.equal(snippet('a\n\nb   c'), 'a b c', 'a row is one line');
assert.equal(snippet('x'.repeat(400)).endsWith('...'), true, 'and it is shortened');
assert.equal(snippet('x'.repeat(400)).length, MAX_NOTIFICATION_SNIPPET, 'to the length the menu draws');

assert.deepEqual(
  dedupeTargets(
    [
      { userId: 'u-amy', kind: 'tag' },
      { userId: 'u-amy', kind: 'reply' },
      { userId: 'u-sweden', kind: 'tag' },
      { userId: 'u-amy', kind: 'tag' },
    ],
    'u-sweden',
  ),
  [{ userId: 'u-amy', kind: 'reply' }],
  'the tagger is never told, and being answered outranks being named',
);
assert.deepEqual(dedupeTargets([{ userId: '', kind: 'tag' }], null), [], 'a row with no recipient is not a row');

const older = notif('n1', 'tag', { createdAt: '2026-09-20T10:00:00.000Z' });
const newer = notif('n2', 'reply', { createdAt: '2026-09-21T10:00:00.000Z', readAt: '2026-09-21T11:00:00.000Z' });

assert.equal(sortNotificationsNewestFirst([older, newer])[0].id, 'n2', 'newest first');
assert.equal(isUnread(older), true);
assert.equal(isUnread(newer), false, 'seen is a stamp, not a flag to keep in step');
assert.equal(unreadNotificationCount([older, newer]), 1);
assert.equal(notificationSummary([]), 'NO NOTIFICATIONS');
assert.equal(notificationSummary([newer]), 'NOTHING NEW', 'a feed with nothing new says so');
assert.equal(notificationSummary([older]), '1 NEW');
assert.equal(notificationSummary([older, newer, { ...older, id: 'n3' }]), '2 NEW');

// The feed split into what is waiting and what has been seen - the two groups the menu draws - and
// the same split counted by kind, for its status line. Recency still rules inside each half.
assert.deepEqual(splitNotifications([older, newer]).fresh.map((item) => item.id), ['n1'], 'unread is one group');
assert.deepEqual(splitNotifications([older, newer]).earlier.map((item) => item.id), ['n2'], 'seen is the other');
assert.deepEqual(notificationKindCounts([older, newer]), { tag: 1, reply: 1, invite: 0 });
assert.equal(notificationBreakdown([older, newer]), '1 TAG :: 1 REPLY');
assert.equal(notificationBreakdown([older, older]), '2 TAGS :: 0 REPLIES', 'and the words count');
assert.equal(notificationBreakdown([]), '', 'an empty feed has no numbers to give');
assert.equal(notificationLabel('tag'), 'TAGGED YOU');
assert.equal(notificationLabel('reply'), 'REPLIED TO YOU');
assert.equal(notificationVerb('tag'), 'TAGGED');
assert.equal(notificationVerb('reply'), 'REPLIED');

// 3. The store: one row per account told, and the feed is the recipient's alone.
(async () => {
  const store = getMockNotificationsRepository();

  await store.notify({
    actorId: 'u-sweden',
    actorName: 'sweden',
    threadId: 'thread-1',
    threadTitle: 'SHEET 03',
    body: 'look at this @amy  @amy',
    targets: [
      { userId: 'u-amy', kind: 'tag' },
      { userId: 'u-sweden', kind: 'tag' },
    ],
  });

  // Nothing comes back: a notification belongs to the account it names, so the account that filed it
  // does not hold it (the write is made without a return for exactly that reason - see the contract
  // in app/lib/notifications/types.ts). What was filed is read where it landed.
  const amys = await store.list('u-amy');
  assert.equal(amys.length, 1, 'the writer is not told about their own words, and the named account is');
  assert.equal(amys[0].kind, 'tag');
  assert.equal(amys[0].readAt, null, 'it arrives unread');
  assert.equal(amys[0].actorName, 'sweden', 'signed with who did it');
  assert.equal(amys[0].threadTitle, 'SHEET 03', 'and carrying the post it happened on');
  assert.deepEqual(await store.list('u-sweden'), [], 'and nobody else does');

  // A reply to somebody the same post also names: one row, and it is the reply.
  await store.notify({
    actorId: 'u-sweden',
    actorName: 'sweden',
    threadId: 'thread-1',
    threadTitle: 'SHEET 03',
    body: 'answering @amy',
    targets: [
      { userId: 'u-amy', kind: 'tag' },
      { userId: 'u-amy', kind: 'reply' },
    ],
  });
  const afterTwo = await store.list('u-amy');
  assert.equal(afterTwo.length, 2, 'one row per post, not per mention');
  assert.equal(
    afterTwo.filter((row) => row.kind === 'reply').length,
    1,
    'answered beats named: the row filed by the pair says reply',
  );

  // Seen and unseen. Notifications are filed in the same millisecond here, so order by id.
  const before = await store.list('u-amy');
  assert.equal(unreadNotificationCount(before), 2);
  await store.markRead('u-amy', before[0].id);
  assert.equal(unreadNotificationCount(await store.list('u-amy')), 1, 'opening one marks that one');
  await store.markAllRead('u-amy');
  assert.equal(unreadNotificationCount(await store.list('u-amy')), 0, '[ MARK ALL READ ] clears the dot');
  assert.equal((await store.list('u-amy')).length, 2, 'and keeps the history');

  // A subscription hears about every write, which is what the bell listens to.
  const seen = [];
  const stop = store.subscribe('u-amy', (items) => seen.push(items.length));
  await store.notify({
    actorId: 'u-sweden',
    actorName: 'sweden',
    threadId: 'thread-1',
    threadTitle: 'SHEET 03',
    body: 'again',
    targets: [{ userId: 'u-amy', kind: 'tag' }],
  });
  assert.equal(seen.at(-1), 3, 'the fresh feed is handed over, not just the news');
  stop();

  await store.clearLocalNotifications();
  assert.deepEqual(await store.list('u-amy'), [], 'and local test rows can be purged');

  // 4. The menu: one list, newest first, unread drawn differently, and every row a way into
  //    the post it happened on.
  const FIXTURE = {
    ready: true,
    userId: 'u-sweden',
    items: [
      notif('n1', 'tag', { createdAt: '2026-09-21T10:00:00.000Z' }),
      notif('n2', 'reply', {
        createdAt: '2026-09-20T10:00:00.000Z',
        readAt: '2026-09-20T11:00:00.000Z',
        threadId: null,
        body: '',
      }),
    ],
    unread: 1,
    summary: '1 NEW',
    error: null,
    retry: () => undefined,
    markRead: async () => undefined,
    markAllRead: async () => undefined,
    notifyTagged: async () => undefined,
    source: 'mock',
  };

  let feed = FIXTURE;
  stub('./notifications-render/components/NotificationsProvider.js', {
    default: ({ children }) => children,
    useNotifications: () => feed,
  });

  // The row prints the tagger's name, which reads the lamps like every other name in the app.
  stub('./notifications-render/components/PresenceProvider.js', {
    default: ({ children }) => children,
    usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
    usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
  });

  const NotificationMenu = require('./notifications-render/components/NotificationMenu.js').default;
  const NotificationBell = require('./notifications-render/components/NotificationBell.js').default;
  const { NotificationMenuButton } = require('./notifications-render/components/NotificationBell.js');
  const element = React.createElement;
  const render = (child) => renderToStaticMarkup(child);
  const noop = () => undefined;

  const menu = render(element(NotificationMenu, { onClose: noop }));
  assert.match(menu, /NOTIFICATIONS :: 1 NEW/, 'the chrome counts what is waiting');
  assert.match(menu, /TAGGED YOU/, 'a tag says so');
  assert.match(menu, /REPLIED TO YOU/, 'and so does a reply');
  assert.match(menu, /amy/, 'signed with who did it');
  assert.match(menu, /look at the knuckles/, 'carrying the words');
  assert.match(menu, /ON: SHEET 03/, 'and the post');
  assert.match(menu, /href="\/forum#thread-thread-1"/, 'clicking one goes to the post');

  // The two groups, and what each row says it is. A reader has to be able to tell a tag from a reply
  // and what is waiting from what has been seen without reading the sentence.
  assert.match(menu, /\[ NEW \] :: 1/, 'the list is grouped into what is waiting');
  assert.match(menu, /\[ EARLIER \] :: 1/, 'and what has been seen');
  assert.ok(menu.indexOf('[ NEW ]') < menu.indexOf('[ EARLIER ]'), 'new first: that is what the feed is for');
  assert.equal((menu.match(/>TAG</g) ?? []).length, 1, 'a tag wears a tag badge');
  assert.equal((menu.match(/>REPLY</g) ?? []).length, 1, 'and a reply wears a reply badge');
  assert.equal(
    (menu.match(/bg-bubble-pale/g) ?? []).length,
    4,
    'the Rose is the site`s accent: the reply badge, the group heads and the row tint all wear it',
  );
  // (2026-10-25, SPEC-less-text.md) The foot's readback `1 NEW :: 1 TAG :: 1 REPLY` is cut: the title says
  // `1 NEW`, the group heads count each group, and each row wears its kind's badge (all asserted above). The
  // foot key `[ OPEN THE BOARD ]` -> `[ BOARD ]`.
  assert.doesNotMatch(menu, /1 NEW :: 1 TAG :: 1 REPLY|:: \d+ TAGS? :: \d+ REPL/, 'and the foot does not count them all again');
  assert.match(menu, /\[ BOARD \]/, 'the foot keeps its way to the board');
  assert.doesNotMatch(menu, /\[ OPEN THE BOARD \]/, 'under its short name');

  assert.equal((menu.match(/aria-label="Unread"/g) ?? []).length, 1, 'one filled square, one unread row');
  assert.equal(
    // (2026-10-23, docs/theming.md) border-black became border-ink-plate: Black in both themes, as a token.
    (menu.match(/h-2 w-2 shrink-0 border border-ink-plate bg-ena/g) ?? []).length,
    1,
    'drawn as a filled square, the way Win95 draws a selection',
  );
  assert.match(menu, /\[ MARK ALL READ \]/, 'and the way to clear the dot');
  assert.doesNotMatch(menu, /<svg|data:image/g, 'no icon is drawn in code');

  // Newest first, however many kinds are in the list.
  assert.ok(menu.indexOf('TAGGED YOU') < menu.indexOf('REPLIED TO YOU'), 'recency is the only order');

  // The four states a feed can be in, each with its own words - an empty feed must not look
  // like a feed nobody could read.
  feed = { ...FIXTURE, userId: null, items: [], unread: 0, summary: 'NO NOTIFICATIONS' };
  // (2026-10-25, SPEC-less-text.md) `TAGS AND REPLIES GO ACCOUNT TO ACCOUNT - SIGN IN TO BE TOLD ABOUT THEM.` ->
  // the locked-action line `[ LOG IN ] TO GET NOTIFICATIONS` (rule 3).
  const signedOutMenu = render(element(NotificationMenu, { onClose: noop }));
  assert.match(signedOutMenu, /\[ LOG IN \]<\/a> TO GET NOTIFICATIONS/);
  assert.doesNotMatch(signedOutMenu, /SIGN IN TO BE TOLD ABOUT THEM/);

  feed = { ...FIXTURE, items: [], unread: 0, summary: 'NO NOTIFICATIONS' };
  // (2026-10-25, SPEC-less-text.md) The empty state is `NOTHING YET.` (its how-to sentence is cut, rule 1).
  const emptyMenu = render(element(NotificationMenu, { onClose: noop }));
  assert.match(emptyMenu, /NOTHING YET\./);
  assert.doesNotMatch(emptyMenu, /IS WHAT LANDS IN THIS LIST/);

  feed = { ...FIXTURE, items: [], ready: false };
  assert.match(render(element(NotificationMenu, { onClose: noop })), /READING THE NOTIFICATIONS/);

  feed = { ...FIXTURE, items: [], error: 'THE NOTIFICATION FEED NEEDS A ONE-TIME DATABASE UPDATE' };
  const broken = render(element(NotificationMenu, { onClose: noop }));
  assert.match(broken, /FEED OFFLINE :: THE NOTIFICATION FEED NEEDS/);
  assert.match(broken, /\[ RETRY \]/, 'and a way to ask again');

  // The bell: the count before it is opened, the dot only when there is something unread, and the
  // notices glyph the side panel's other keys wear - the accessible name still says it in full.
  feed = FIXTURE;
  const bell = render(element(NotificationBell, null));
  assert.match(bell, /\[ 1 NEW \]/, 'and a count of what is waiting');
  assert.match(bell, /aria-label="Notifications: 1 NEW"/, 'it says what is waiting without being opened');
  assert.equal((bell.match(/bg-bubble-pale/g) ?? []).length, 1, 'and carries the unread dot');
  // The glyph is asserted by *source*, not by the rendered byte: a console cannot be trusted to carry
  // U+2600 through, and the thing worth holding is that the key wears the shared `ICON_BELL` (the
  // legend's own mark) rather than a `[ ! ]` typed into the component.
  assert.match(
    require('node:fs').readFileSync('app/components/NotificationBell.tsx', 'utf8'),
    /\{ICON_BELL\}/,
    'the bell wears the legend`s own notices glyph, not one of its own',
  );

  // A quiet day draws nothing at all. This is the change that makes the key an alert rather than
  // furniture: the panel's `[ COMMS ]` button already carries a count, so a second resting count beside
  // it would be two numbers for one question.
  feed = { ...FIXTURE, items: [], unread: 0, summary: 'NO NOTIFICATIONS' };
  assert.equal(
    render(element(NotificationBell, null)),
    '',
    'a bell with nothing unread is not drawn at all',
  );

  // The phone's row in the profile menu, and the pop-up it opens.
  feed = FIXTURE;
  assert.match(render(element(NotificationMenuButton, {})), /\[ NOTIFICATIONS \(1\) \]/);

  // The two ways the database can be behind the code, said as the script to run rather than as a
  // Postgres error: a table that is not there, and a table whose rules are not there - which is what
  // the live project looked like, and what `42501` on every write means.
  const feedStore = require('node:fs').readFileSync('app/lib/notifications/supabase-notifications-repository.ts', 'utf8');
  assert.match(feedStore, /isPolicyRefusal\(error\)/, 'a policy refusal is recognised');
  assert.match(feedStore, /error\.code === '42501'/, 'by the code Postgres refuses a row-level security check with');
  assert.match(feedStore, /NOTIFICATIONS_NEED_POLICIES/, 'and it has a sentence of its own');
  assert.match(feedStore, /20260923000017_notifications\.sql/, 'naming the script to run');
  assert.match(
    feedStore,
    /if \(isMissingSchema\(error\)\) this\.fail\(NOTIFICATIONS_NEED_MIGRATION\)/,
    'while the table-missing case keeps its own',
  );
  assert.equal((feedStore.match(/this\.refuse\(error\);/g) ?? []).length, 4, 'and every write asks the same question');

  console.log('notification checks passed');
  console.log('  mentions   : @name is the tag, matched case-insensitively, and an unknown name is just words');
  console.log('  feed       : newest first, one row per account per post, unread is a null stamp');
  console.log('  store      : the recipient reads it, the writer is never told, marks seen on demand');
  console.log('  menu       : one list of tags and replies, four honest states, and a dot on the bell');

// The notices key lives on the comms block's own row - the title bar, beside the count and the
// `[ COMMS ]` button that opens the conversations. A tag, a reply and a message are the same kind of
// thing: something addressed to this account, so they belong in the block about this account.
const sidebarComms = require('node:fs').readFileSync('app/components/SidebarComms.tsx', 'utf8');
assert.match(sidebarComms, /<NotificationBell \/>/, 'the side panel carries the notices key');
assert.match(
  sidebarComms,
  /\[ COMMS \][\s\S]{0,900}<NotificationBell \/>/,
  'and it sits on the same row as the `[ COMMS ]` button',
);
assert.doesNotMatch(
  require('node:fs').readFileSync('app/components/Taskbar.tsx', 'utf8'),
  /NotificationBell/,
  'and the tray does not: it was moved out, and must not creep back',
);
console.log('  notifies   : the bell is a key on the comms row, and only when something is unread');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
