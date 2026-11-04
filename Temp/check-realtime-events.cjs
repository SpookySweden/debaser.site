/*
 * The realtime A/B that explains "received messages never appear":
 *   node --env-file=.env.local Temp/check-realtime-events.cjs
 *
 * Two channels watch the same table from the same session. One is registered the way
 * app/lib/comms/supabase-comms-repository.ts registers it (`event: '*'`), the other with
 * the events Supabase Realtime actually filters on. A message is then written by the very
 * account that is listening, so delivery does not depend on anyone else.
 *
 * Whoever hears it is the one the site would hear it with. It signs in as kept test account A (see
 * scripts/browser.cjs), makes no account, and deletes the conversation it opened.
 */
const assert = require('node:assert/strict');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const stamp = Date.now().toString(36);
  const { client, id: me } = await testAccountClient('A');
  const threadId = `grp:${stamp}-events`;
  let wildcard = null;
  let explicit = null;

  /** Writes, and refuses to go on if the row was not filed. */
  async function write(body) {
    const { error: writeError } = await client
      .from('comms_messages')
      .insert({ thread_id: threadId, author_id: me, author_name: 'cline', body });

    assert.equal(writeError, null, `the message "${body}" is filed: ${writeError?.message ?? ''}`);
  }

  try {
    const { error: threadError } = await client
      .from('comms_threads')
      .insert({ id: threadId, kind: 'group', name: 'EVENT CHECK', created_by: me });
    assert.equal(threadError, null, `the group is filed: ${threadError?.message ?? ''}`);

    const { error: memberError } = await client
      .from('comms_members')
      .insert({ thread_id: threadId, user_id: me });
    assert.equal(memberError, null, `the membership is filed: ${memberError?.message ?? ''}`);

    // ---- 1. the registration the app uses: event '*' ---------------------------
    const heardWildcard = [];
    wildcard = client
      .channel('cline-events-wildcard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comms_messages' }, () =>
        heardWildcard.push('heard'),
      )
      .subscribe();
    await waitFor(4000);

    await write('ab test one');
    await waitFor(5000);
    await client.removeChannel(wildcard);
    wildcard = null;

    // ---- 2. the registration Supabase filters on -------------------------------
    const heardExplicit = [];
    explicit = client
      .channel('cline-events-explicit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comms_messages' }, () =>
        heardExplicit.push('heard'),
      )
      .subscribe();
    await waitFor(4000);

    await write('ab test two');
    await waitFor(5000);
    await client.removeChannel(explicit);
    explicit = null;

    // The rows are there either way - so a quiet subscription is the channel's doing.
    const { data: stored } = await client.from('comms_messages').select('body').eq('thread_id', threadId);
    console.log('stored     :', (stored ?? []).map((row) => row.body).join(' | '));
    console.log("event '*'      :", heardWildcard.length === 0 ? 'NOTHING (no event was ever chosen)' : 'heard');
    console.log("event 'INSERT' :", heardExplicit.length === 0 ? 'NOTHING' : 'heard');

    assert.equal((stored ?? []).length, 2, 'both messages are in the database');
    assert.equal(heardExplicit.length > 0, true, 'an explicit event is delivered');
    assert.equal(heardWildcard.length, 0, "event: '*' is never delivered");
    console.log("verdict    : a channel registered with event: '*' hears nothing at all");
  } finally {
    if (wildcard !== null) await client.removeChannel(wildcard);
    if (explicit !== null) await client.removeChannel(explicit);
    await client.from('comms_threads').delete().eq('id', threadId);
    await client.auth.signOut({ scope: 'local' });
    console.log('cleaned up : conversation deleted, this run signed out');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
