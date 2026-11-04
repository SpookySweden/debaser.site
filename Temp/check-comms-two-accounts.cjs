/*
 * Live two-account check of the comms store against the deployed project:
 *   node --env-file=.env.local Temp/check-comms-two-accounts.cjs
 *
 * Why it exists: the page is only as good as what the store hands it. This drives the
 * real repository (compiled from app/lib/comms) with two real sessions, so the messages,
 * the participants of a group and the read markers that reach the screen can be printed
 * and inspected rather than assumed.
 *
 * It signs in as two of the kept test accounts (A and B - see scripts/browser.cjs), makes no
 * account, and at the end deletes the conversation between them and the group it opened (which
 * also checks the creator's delete policy), then signs both out of this run only.
 */
const assert = require('node:assert/strict');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** A kept test account with its own session, and the repository pointed at it. */
async function account(letter) {
  const { client, id, displayName } = await testAccountClient(letter);

  const clientPath = require.resolve('./comms-groups-out/supabase/client.js');
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { getSupabaseBrowserClient: () => client, isSupabaseConfigured: true },
  };
  delete require.cache[require.resolve('./comms-groups-out/comms/supabase-comms-repository.js')];

  return {
    id,
    label: displayName,
    client,
    repository: require('./comms-groups-out/comms/supabase-comms-repository.js').getSupabaseCommsRepository(),
  };
}

/** What a screen would draw, in one line. */
function describe(thread) {
  return [
    thread.id.startsWith('grp:') ? 'GROUP' : 'DM',
    thread.name.length > 0 ? `"${thread.name}"` : '(no name)',
    `members=[${thread.participants.length}]`,
    `messages=[${thread.messages.length}]`,
    thread.messages.map((message) => `${message.authorName}: ${message.body}`).join(' | '),
  ].join(' ');
}


(async () => {
  assert.ok(URL && KEY, 'run this with --env-file=.env.local');

  const a = await account('A');
  const b = await account('B');
  // The kept accounts may have talked before: their conversation is cleared first, and again at the end.
  const dmId = a.id <= b.id ? `dm:${a.id}|${b.id}` : `dm:${b.id}|${a.id}`;
  const theDm = (threads) => threads.find((thread) => thread.id === dmId);
  let group = null;

  try {
    // ---- a direct conversation -------------------------------------------------
    await a.client.from('comms_threads').delete().eq('id', dmId);
    assert.equal(theDm(await a.repository.listThreads(a.id)), undefined, 'A and B start with no conversation');

    const dm = await a.repository.openThread(a.id, b.id);
    console.log('openThread :', describe(dm));

    const withMessage = await a.repository.sendMessage({
      authorId: a.id,
      recipientId: b.id,
      authorName: a.label,
      body: 'hello from A',
    });
    console.log('A sends    :', describe(withMessage));

    const aList = theDm(await a.repository.listThreads(a.id));
    console.log('A sees     :', aList === undefined ? 'MISSING' : describe(aList));
    assert.ok(aList !== undefined, 'the conversation A just wrote in is in As list');
    assert.equal(aList.messages.length, 1, 'and the message A sent is in it');
    assert.equal(aList.messages[0].body, 'hello from A');

    const bList = theDm(await b.repository.listThreads(b.id));
    console.log('B sees     :', bList === undefined ? 'MISSING' : describe(bList));
    assert.ok(bList !== undefined, 'the conversation reaches the other side');
    assert.equal(bList.messages.length, 1, 'with the message in it');
    assert.deepEqual(bList.participants.slice().sort(), [a.id, b.id].sort(), 'and both accounts in it');

    const bReply = await b.repository.sendMessage({
      authorId: b.id,
      recipientId: a.id,
      authorName: b.label,
      body: 'hello from B',
    });
    console.log('B replies  :', describe(bReply));

    const aAgain = theDm(await a.repository.listThreads(a.id));
    console.log('A sees     :', aAgain === undefined ? 'MISSING' : describe(aAgain));
    assert.equal(aAgain?.messages.length, 2, 'A reads the reply');

    // ---- a group, and adding somebody to it ------------------------------------
    group = await a.repository.createGroup({
      creatorId: a.id,
      creatorName: a.label,
      name: 'LINE CHECK WARD',
      memberIds: [],
    });
    console.log('new group  :', describe(group));
    assert.deepEqual(group.participants, [a.id], 'a group starts with whoever opened it');

    const widened = await a.repository.addMember(group.id, b.id);
    console.log('add member :', describe(widened));
    assert.deepEqual(widened.participants.slice().sort(), [a.id, b.id].sort(), 'the account added is in the group');

    const reread = (await a.repository.listThreads(a.id)).find((thread) => thread.id === group.id);
    console.log('A re-reads :', reread === undefined ? 'MISSING' : describe(reread));
    assert.deepEqual(
      reread?.participants.slice().sort(),
      [a.id, b.id].sort(),
      'and it is still there when the conversation is read again',
    );

    const bGroup = (await b.repository.listThreads(b.id)).find((thread) => thread.id === group.id);
    console.log('B sees it  :', bGroup === undefined ? 'MISSING' : describe(bGroup));
    assert.deepEqual(bGroup?.participants.slice().sort(), [a.id, b.id].sort(), 'the added account sees the group too');

    const groupSent = await b.repository.sendMessage({
      authorId: b.id,
      threadId: group.id,
      authorName: b.label,
      body: 'hello the ward',
    });
    console.log('B writes   :', describe(groupSent));
    assert.equal(groupSent.messages.length, 1);

    const aGroup = (await a.repository.listThreads(a.id)).find((thread) => thread.id === group.id);
    console.log('A sees     :', aGroup === undefined ? 'MISSING' : describe(aGroup));
    assert.equal(aGroup?.messages.length, 1, 'a group message reaches the other member');
    assert.equal(aGroup?.kind, 'group', 'and reads as a group');
    assert.equal(aGroup?.name, 'LINE CHECK WARD', 'with its name');

    // ---- realtime: does a write reach a page that is already open? -------------
    // The listener is only called when something moved, so the first call *is* the event
    // worth counting - an earlier version of this check threw it away and reported a
    // working channel as silent.
    const heard = [];
    const unsubscribe = b.repository.subscribe((threads) => {
      const thread = threads.find((item) => item.id === group.id);
      if (thread !== undefined) heard.push(thread.messages.length);
    });

    // Let the channel join before writing, so the write cannot beat the subscription.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await a.repository.sendMessage({ authorId: a.id, threadId: group.id, authorName: a.label, body: 'ping' });

    for (let attempt = 0; attempt < 24 && heard.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    unsubscribe();

    const aAfter = (await a.repository.listThreads(a.id)).find((thread) => thread.id === group.id);
    console.log('A wrote    :', aAfter === undefined ? 'MISSING' : describe(aAfter));
    console.log('B heard    :', heard.length === 0 ? 'NOTHING' : `${heard.length} update(s), the group at ${heard.at(-1)} messages`);
    assert.equal(heard.length > 0, true, 'a write by the other account reaches a page that is already open');

    console.log('two-account comms checks passed');
  } finally {
    if (group !== null) {
      const { error } = await a.client.from('comms_threads').delete().eq('id', group.id);
      console.log('group gone :', error === null ? 'yes' : error.message);
    }

    const dmGone = await a.client.from('comms_threads').delete().eq('id', dmId);
    console.log('dm gone    :', dmGone.error === null ? 'yes' : dmGone.error.message);

    for (const who of [a, b]) {
      const { error } = await who.client.auth.signOut({ scope: 'local' });
      console.log(`${who.label} sign-out:`, error === null ? 'ok' : error.message);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
