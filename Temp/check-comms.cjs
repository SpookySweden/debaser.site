/*
 * Scratch check for comms (run from the root):
 *   npx tsc app/lib/comms/threads.ts app/lib/comms/mock-comms-repository.ts app/lib/comms/ascii-emoticons.ts --outDir Temp/comms-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CommsThreadPanel.tsx app/components/CommsConsole.tsx app/components/SiteNav.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comms.cjs
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  groupThreadId,
  isThreadId,
  lastMessage,
  otherParticipant,
  participantFromThread,
  resolveAuthor,
  threadIdFor,
  threadLabel,
  threadsWithNewMessages,
  unreadCount,
  validateMessage,
} = require('./comms-out/comms/threads.js');
const { ASCII_EMOTICONS, insertAtCaret } = require('./comms-out/comms/ascii-emoticons.js');
const { getMockCommsRepository } = require('./comms-out/comms/mock-comms-repository.js');
const CommsThreadPanel = require('./render-out/components/CommsThreadPanel.js').default;
const CommsConsole = require('./render-out/components/CommsConsole.js').default;
const SiteNav = require('./render-out/components/SiteNav.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;
const CommsProvider = require('./render-out/components/CommsProvider.js').default;

const element = React.createElement;

/** Everything a comms screen needs: the account, the lamps and the conversations. */
const withProviders = (child) =>
  renderToStaticMarkup(
    element(
      AuthProvider,
      null,
      element(PresenceProvider, null, element(CommsProvider, null, child)),
    ),
  );

// 1. The thread id is the pair, so both sides agree without a lookup.
assert.equal(threadIdFor('user-b', 'user-a'), threadIdFor('user-a', 'user-b'));
assert.equal(threadIdFor('user-a', 'user-b'), 'dm:user-a|user-b');
assert.equal(validateMessage('   '), 'THE MESSAGE IS EMPTY.');
assert.equal(validateMessage('hello'), undefined);
assert.equal(typeof validateMessage('x'.repeat(801)), 'string');

const message = (id, authorId, createdAt) => ({
  id,
  threadId: 'dm:user-a|user-b',
  authorId,
  authorName: authorId,
  body: `message ${id}`,
  createdAt,
});

const thread = {
  id: 'dm:user-a|user-b',
  participants: ['user-a', 'user-b'],
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T10:05:00.000Z',
  readAt: { 'user-a': '2026-09-21T10:01:00.000Z' },
  messages: [
    message('m1', 'user-b', '2026-09-21T10:00:00.000Z'),
    message('m2', 'user-a', '2026-09-21T10:01:00.000Z'),
    message('m3', 'user-b', '2026-09-21T10:05:00.000Z'),
  ],
};

// 2. Unread counts the other side only, and stops at the read marker.
assert.equal(unreadCount(thread, 'user-a'), 1, 'm3 arrived after user-a last read');
assert.equal(unreadCount(thread, 'user-b'), 1, 'user-b has never read: only the message from user-a counts');
assert.equal(
  unreadCount({ ...thread, readAt: { 'user-a': '2026-09-21T10:00:00.000Z' } }, 'user-a'),
  1,
  'a message you wrote yourself is never unread, however far back the marker is',
);
assert.equal(unreadCount({ ...thread, readAt: {} }, 'user-a'), 2, 'never read: everything from them counts');
assert.equal(lastMessage(thread).id, 'm3');
assert.equal(otherParticipant(thread, 'user-a'), 'user-b');

const names = new Map([['user-a', 'sweden']]);
assert.equal(resolveAuthor(message('m4', 'user-a', ''), names).displayName, 'sweden', 'live names win');
assert.equal(resolveAuthor(message('m5', 'user-c', ''), names).displayName, 'user-c', 'the written name is the fallback');
assert.equal(participantFromThread(thread, 'user-a', names).displayName, 'user-b');
assert.equal(participantFromThread(thread, 'user-a', names).unread, 1);

// 3. Notification rule: only messages from the other side, only new ones.
const known = new Set(['m1', 'm2']);
assert.deepEqual(threadsWithNewMessages([thread], 'user-a', known).map((t) => t.id), [thread.id]);
assert.deepEqual(threadsWithNewMessages([thread], 'user-a', new Set(['m1', 'm2', 'm3'])), []);
assert.deepEqual(
  threadsWithNewMessages([thread], 'user-b', new Set(['m1', 'm2'])).map((t) => t.id),
  [],
  'your own new message does not notify you',
);
assert.deepEqual(
  threadsWithNewMessages([thread], 'user-b', new Set(['m1', 'm3'])).map((t) => t.id),
  [thread.id],
  'what the other side wrote does',
);
assert.deepEqual(
  threadsWithNewMessages([thread], 'user-a', new Set(['m1'])).map((t) => t.id),
  [thread.id],
);

// 4. The store: opening a thread is idempotent, sending and reading behave, and
//    one account never sees another account's conversations.
(async () => {
  const repository = getMockCommsRepository();
  const pushed = [];
  const unsubscribe = repository.subscribe((snapshot) => pushed.push(snapshot));

  const opened = await repository.openThread('user-a', 'user-b');
  assert.equal(opened.id, threadIdFor('user-a', 'user-b'));
  assert.equal(opened.messages.length, 0);
  const again = await repository.openThread('user-b', 'user-a');
  assert.equal(again.id, opened.id, 'the same pair opens the same conversation');
  assert.equal((await repository.listThreads('user-c')).length, 0, 'nobody else sees it');

  // A few milliseconds between opening and writing: an unread marker is only ever
  // older than the message it hides, which is true of every real send.
  await new Promise((resolve) => setTimeout(resolve, 5));

  await repository.sendMessage({ authorId: 'user-a', recipientId: 'user-b', authorName: 'sweden', body: 'hello' });
  const waitingForB = (await repository.listThreads('user-b'))[0];
  assert.equal(unreadCount(waitingForB, 'user-b'), 1, 'the message from user-a is waiting for user-b');
  assert.equal(unreadCount(waitingForB, 'user-a'), 0, 'and the sender has nothing waiting');

  // Same reason as above: the reply has to be a millisecond younger than the read
  // marker user-a's own send left, or the two stamps tie and "unread" reads as 0.
  await new Promise((resolve) => setTimeout(resolve, 5));

  await repository.sendMessage({ authorId: 'user-b', recipientId: 'user-a', authorName: 'luke', body: 'hi back' });
  const afterReply = (await repository.listThreads('user-a'))[0];
  assert.equal(afterReply.messages.length, 2);
  assert.equal(unreadCount(afterReply, 'user-a'), 1, 'the reply is waiting for user-a');
  assert.equal(unreadCount(afterReply, 'user-b'), 0, 'replying counts as reading, so nothing waits for user-b');

  await repository.markRead('user-a', afterReply.id);
  const readByA = (await repository.listThreads('user-a'))[0];
  assert.equal(unreadCount(readByA, 'user-a'), 0);
  assert.equal(
    readByA.readAt['user-a'],
    afterReply.messages[1].createdAt,
    'the read marker lands on the newest message',
  );
  assert.equal(
    (await repository.markRead('user-a', readByA.id)).readAt['user-a'],
    readByA.readAt['user-a'],
    'reading again is a no-op, so it cannot loop through the subscription',
  );
  await assert.rejects(() =>
    repository.sendMessage({ authorId: 'user-a', recipientId: 'user-b', authorName: 'sweden', body: '   ' }),
  );
  assert.ok(pushed.length >= 3, 'every write pushed a snapshot to the listeners');
  await assert.rejects(() => repository.openThread('user-a', 'user-a'), /CANNOT MESSAGE ITSELF/);

  await repository.clearLocalThreads();
  assert.equal((await repository.listThreads('user-a')).length, 0);
  unsubscribe();

  // 5. Rendering: the nav carries COMMS, and the console copes with no session.
  const nav = withProviders(element(SiteNav, { active: 'comms' }));
  // (2026-11-04) The header dropped COMMS on purpose (SiteNav's HEADER_ITEMS); the side panel and phone menus draw NAV_ITEMS.
  const navSource = require('node:fs').readFileSync('app/components/SiteNav.tsx', 'utf8');
  assert.match(navSource, /\{ key: 'comms', label: 'COMMS', mark: ICON_COMMS, href: '\/comms' \}/, 'the comms page is in the shared list of keys');
  assert.doesNotMatch(nav, /href="\/comms"/, 'and not in the header');
  assert.doesNotMatch(nav, /\(\d+\)/, 'no unread badge with nobody signed in');

  const consoleHtml = withProviders(element(CommsConsole, null));
  // (2026-10-23, SPEC-efficiency.md) The guest panel (a title and two lines) is one line now.
  assert.match(consoleHtml, /\[ LOG IN \]<\/a> TO MESSAGE PEOPLE/, 'a guest is told what an account buys, in one line');
  assert.doesNotMatch(consoleHtml, /NOBODY SIGNED IN|MESSAGES TRAVEL BETWEEN ACCOUNTS/, 'and nothing more');

  // The thread panel is shared by the page and the pop-up window.
  const panel = withProviders(
    element(CommsThreadPanel, {
      idPrefix: 'check',
      thread,
      userId: 'user-a',
      otherId: 'user-b',
      nameById: new Map([
        ['user-a', 'sweden'],
        ['user-b', 'luke'],
      ]),
      onSend: async () => undefined,
    }),
  );
  // (2026-10-23, SPEC-efficiency.md) The thread's `TO: name` + `n MESSAGES` line is cut: the title line and the
  // field's placeholder already name the other side.
  assert.doesNotMatch(panel, /TO:/);
  assert.match(panel, /luke/, 'the conversation names the other side');
  assert.match(panel, /message m3/, 'the newest message is drawn');
  assert.match(panel, /\[ YOU \]/, 'your own message is marked');
  // (2026-10-23, SPEC-efficiency.md) The Enter-to-send line is the field's hover tip now, not a line under it.
  assert.match(panel, /title="ENTER SENDS/, 'the composer explains Enter-to-send, as the field`s tip');

  // 5. Group conversations: a name, a membership, and no pair at all. Wrapped in a
  //    block of its own, so its names cannot collide with the ones above.
  {
  const repository = getMockCommsRepository();
  await repository.clearLocalThreads?.();

  const group = await repository.createGroup({
    creatorId: 'user-a',
    creatorName: 'sweden',
    name: 'the ward',
    memberIds: ['user-b', 'user-c'],
  });

  assert.equal(group.kind, 'group');
  assert.equal(group.name, 'the ward');
  assert.deepEqual(group.participants, ['user-a', 'user-b', 'user-c'], 'members sorted, creator included');
  assert.ok(group.id.startsWith('grp:'), 'a group mints its own id');
  assert.deepEqual((await repository.listThreads('user-a')).map((item) => item.id), [group.id], 'a member sees it');
  assert.deepEqual(await repository.listThreads('user-z'), [], 'an account outside it sees nothing');

  const sent = await repository.sendMessage({
    authorId: 'user-b',
    threadId: group.id,
    authorName: 'luke',
    body: 'anybody here',
  });
  assert.equal(sent.id, group.id, 'a message addressed to a group lands in it');
  assert.equal(lastMessage(await repository.markRead('user-a', group.id))?.body, 'anybody here');

  const widened = await repository.addMember(group.id, 'user-z');
  assert.equal(widened.participants.length, 4, 'anybody in the group can add somebody');
  assert.equal((await repository.listThreads('user-z')).length, 1, 'and they see it from then on');

  // 6. A direct conversation still behaves exactly as it did.
  const dm = await repository.openThread('user-a', 'user-b');
  assert.equal(dm.kind, 'dm');
  assert.equal(dm.name, '');
  await assert.rejects(() => repository.addMember(dm.id, 'user-z'), /GROUP/, 'a dm takes no new members');
  assert.equal(isThreadId(dm.id), true);
  assert.equal(isThreadId(group.id), true);
  assert.equal(isThreadId('somewhere-else'), false);

  const dmSent = await repository.sendMessage({
    authorId: 'user-a',
    recipientId: 'user-b',
    authorName: 'sweden',
    body: 'still works',
  });
  assert.equal(dmSent.id, threadIdFor('user-a', 'user-b'));
  assert.equal(lastMessage(dmSent)?.body, 'still works');

  const nameFor = (id) => (id === 'user-b' ? 'luke' : id);
  assert.equal(threadLabel(dm, 'user-a', nameFor), 'luke', 'a dm is named after the other account');
  assert.equal(
    threadLabel(widened, 'user-a', nameFor),
    'THE WARD [ 4 ]',
    'a group is named after itself, with its head count',
  );
  assert.equal(groupThreadId() === groupThreadId(), false, 'two groups never share an id');

  // 7. The emoticon shelf is ASCII, has no repeats, and drops in at the caret.
  const emoticons = ASCII_EMOTICONS.flatMap((entry) => entry.emoticons);
  assert.ok(emoticons.length >= 24, 'the shelf is worth opening');
  assert.equal(new Set(emoticons.map((emoticon) => emoticon.text)).size, emoticons.length, 'no duplicates');

  for (const emoticon of emoticons) {
    assert.match(emoticon.text, /^[\x20-\x7e]+$/, `${emoticon.text} is plain ASCII`);
  }

  assert.deepEqual(
    insertAtCaret('hello world', 5, 5, ' :)'),
    { value: 'hello :) world', caret: 8 },
    'an emoticon lands where the caret was',
  );
  assert.deepEqual(
    insertAtCaret('hello world', 6, 11, 'again'),
    { value: 'hello again', caret: 11 },
    'and replaces whatever was selected',
  );
  assert.deepEqual(insertAtCaret('abc', 99, 99, '!'), { value: 'abc!', caret: 4 }, 'a caret past the end is clamped');

  console.log('  groups     :', group.id.slice(0, 12) + '...', '::', group.participants.length, 'members, then 4 after an add');
  console.log('  emoticons  :', emoticons.length, 'ASCII faces in', ASCII_EMOTICONS.length, 'groups, inserted at the caret');
  }

  console.log('comms checks passed');
  console.log('  thread ids :', threadIdFor('user-a', 'user-b'), '(the pair, both ways)');
  console.log('  unread     : user-a sees', unreadCount(thread, 'user-a'), ':: user-b sees', unreadCount(thread, 'user-b'));
  console.log('  store      : open is idempotent, send and markRead behave, other accounts see nothing');
  console.log('  nav + panel: COMMS in the header, guest console asks for a sign-in, panel is shared');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

