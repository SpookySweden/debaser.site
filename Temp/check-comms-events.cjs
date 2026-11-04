/**
 * Scratch check for game challenges recorded in the conversation (run from the root):
 *   npx tsc app/lib/games/events.ts app/lib/games/challenges.ts app/lib/games/catalogue.ts app/lib/games/types.ts app/lib/comms/threads.ts app/lib/comms/mock-comms-repository.ts app/lib/comms/types.ts app/lib/profile/presence.ts app/lib/forum/format.ts app/components/CommsProvider.tsx --outDir Temp/comms-events-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comms-events.cjs
 *
 * 1. the words: one place writes what a challenge says, in the thread's voice, not the reader's
 * 2. the act:   the row goes first, then the conversation, then the bell - and a lost later half
 *               never reads as a failed challenge
 * 3. the store: an event survives a round trip through the mock repository, and a typed message
 *               is not mistaken for one
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { commsEventBody, gameEvent, gameTitle, EVENT_LABELS } = require('./comms-events-out/lib/games/events.js');
const { answerChallenge, sendChallenge } = require('./comms-events-out/lib/games/challenges.js');

const read = (file) => fs.readFileSync(file, 'utf8');

/* 1. The words ------------------------------------------------------------------------- */

// A challenge names the game and nothing else about who: the row is signed, and one row is read by
// two accounts, so "challenged you" would be true for one of them and a lie for the other.
assert.equal(commsEventBody('invite', 'tic-tac-toe'), 'CHALLENGED :: TIC-TAC-TOE');
assert.equal(commsEventBody('answer', 'paddle-duel'), 'CHALLENGE ANSWERED :: PADDLE DUEL');
assert.equal(commsEventBody('cancel', 'paddle-duel'), 'CHALLENGE CALLED OFF :: PADDLE DUEL');
assert.doesNotMatch(commsEventBody('invite', 'tic-tac-toe'), /\bYOU\b|\bME\b/, 'and names nobody');

// A game this build does not know falls back to its own id rather than to the catalogue's *first*
// game, which is what `gameById` would have done - filing a wrong fact in a permanent record.
assert.equal(gameTitle('tic-tac-toe'), 'TIC-TAC-TOE', 'a known game is named');
assert.equal(gameTitle('chess'), 'CHESS', 'and an unknown one is not renamed to the first in the list');

// The plate's own label is the reader's words, since a plate is a label on a row, not a quotation.
for (const kind of ['invite', 'answer', 'cancel']) {
  assert.ok(EVENT_LABELS[kind].startsWith('['), `${kind} wears a plate, not a sentence`);
}

// The whole event, so no caller assembles the three fields by hand.
assert.deepEqual(gameEvent('invite', 'tic-tac-toe', 'inv-1'), {
  kind: 'invite',
  gameId: 'tic-tac-toe',
  inviteId: 'inv-1',
});


/* 2. The act: order, and what a failure means ------------------------------------------ */

const GAME = 'tic-tac-toe';
const FROM = { id: 'me', displayName: 'Sweden' };
const TO = { id: 'them', displayName: 'Bo' };

async function run() {
  const order = [];
  const repository = {
    create: async () => {
      order.push('row');
      return { id: 'inv-9', game: GAME, fromUserId: 'me', fromName: 'Sweden', toUserId: 'them', toName: 'Bo', status: 'pending', createdAt: '', updatedAt: '' };
    },
  };

  const sent = await sendChallenge({
    repository,
    record: async ({ withUserId, event }) => {
      order.push('record');
      assert.equal(withUserId, 'them', 'the line is filed in the conversation with the other account');
      assert.deepEqual(event, { kind: 'invite', gameId: GAME, inviteId: 'inv-9' });
    },
    notify: async () => void order.push('bell'),
    from: FROM,
    to: TO,
    game: GAME,
  });

  assert.deepEqual(order, ['row', 'record', 'bell'], 'the row, then the conversation, then the bell');
  assert.equal(sent.ok, true);

  // A guest has no row to sign, so nothing is filed at all.
  const asGuest = await sendChallenge({ repository, notify: async () => undefined, from: null, to: TO, game: GAME });
  assert.equal(asGuest.ok, false, 'a guest is refused before anything is written');

  // The conversation is the *record*: losing it is a missing line, not a failed challenge. An account
  // told "the store did not answer" about an invitation that was filed would be lied to.
  const lostRecord = await sendChallenge({
    repository,
    record: async () => {
      throw new Error('COMMS IS DOWN.');
    },
    notify: async () => undefined,
    from: FROM,
    to: TO,
    game: GAME,
  });
  assert.equal(lostRecord.ok, true, 'a challenge that was filed is not reported as a failure');

  // And the bell likewise: the row is the whole of the challenge.
  const lostBell = await sendChallenge({
    repository,
    notify: async () => {
      throw new Error('THE FEED IS DOWN.');
    },
    from: FROM,
    to: TO,
    game: GAME,
  });
  assert.equal(lostBell.ok, true, 'nor is it when only the alert is lost');

  // The answer side, with no bell at all: the account that answered knows, and the one that asked is
  // watching the arcade.
  const answered = [];
  await answerChallenge({
    record: async ({ event }) => void answered.push(event.kind),
    from: FROM,
    withUserId: 'them',
    inviteId: 'inv-9',
    game: GAME,
  });
  await answerChallenge({
    record: async ({ event }) => void answered.push(event.kind),
    from: FROM,
    withUserId: 'them',
    inviteId: 'inv-9',
    game: GAME,
    answered: false,
  });
  assert.deepEqual(answered, ['answer', 'cancel'], 'taken up and called off are different lines');

  const asGuestAgain = [];
  await answerChallenge({
    record: async ({ event }) => void asGuestAgain.push(event),
    from: null,
    withUserId: 'them',
    inviteId: 'inv-9',
    game: GAME,
  });
  assert.deepEqual(asGuestAgain, [], 'and a guest writes nothing');
}

/* 3. The store round trip -------------------------------------------------------------- */

async function store() {
  const { getMockCommsRepository } = require('./comms-events-out/lib/comms/mock-comms-repository.js');
  const repo = getMockCommsRepository();
  await repo.clearLocalThreads?.();

  // A pair nothing else in this check has written to, so the thread starts empty and the `at(-1)` below
  // is the message this test just filed rather than whatever the previous section left behind.
  const me = 'event-probe-a';
  const them = 'event-probe-b';

  const thread = await repo.sendMessage({
    authorId: me,
    recipientId: them,
    authorName: 'Sweden',
    body: commsEventBody('invite', GAME),
    event: gameEvent('invite', GAME, 'inv-9'),
  });

  const stored = thread.messages.at(-1);
  assert.deepEqual(
    stored.event,
    { kind: 'invite', gameId: GAME, inviteId: 'inv-9' },
    'the event survives a round trip through the store',
  );
  assert.equal(stored.body, commsEventBody('invite', GAME), 'and so does the line it is drawn with');

  const typed = await repo.sendMessage({ authorId: me, recipientId: them, authorName: 'Sweden', body: 'hello' });
  assert.equal(typed.messages.at(-1).event, undefined, 'a typed message carries no event');
  assert.equal(typed.messages.at(-1).body, 'hello', 'and is its own words');
}

/* 4. The two halves are wired, and neither is a second implementation ------------------ */

function wiring() {
  const hub = read('app/components/GamesHub.tsx');
  assert.match(hub, /record: recordGameEvent/, 'the arcade files the line when a challenge is sent');

  const provider = read('app/components/CommsProvider.tsx');
  assert.match(provider, /recordGameEvent:/, 'the provider declares the recorder');
  assert.match(
    provider,
    /body: commsEventBody\(event\.kind, event\.gameId\)/,
    'and writes the body through the events module, so neither store invents its own words',
  );

  // The panel draws it as a plate, not as prose, and offers the one useful press.
  const panel = read('app/components/CommsThreadPanel.tsx');
  assert.match(panel, /EVENT_LABELS\[message\.event\.kind\]/, 'the DM draws the challenge as a plate');
  assert.match(panel, /openArcade\(\{ kind: 'invite'/, 'with the invitation reachable from the line');
}

run()
  .then(store)
  .then(wiring)
  .then(() => {
    console.log('comms event checks passed');
    console.log('  words  : one place writes what a challenge says, in the thread`s voice');
    console.log('  act    : row, then conversation, then bell - and a lost half is never a failed challenge');
    console.log('  store  : an event survives the round trip; a typed message is not one');
    console.log('  wiring : the arcade files it, the provider writes it, the DM draws it as a plate');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
