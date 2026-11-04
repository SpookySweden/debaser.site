/*
 * Does one un-published table take the whole channel down?
 *   node --env-file=.env.local Temp/check-channel-binding.cjs
 *
 * app/lib/comms/supabase-comms-repository.ts registers one channel against four tables:
 * comms_messages, comms_threads, comms_members - all in the `supabase_realtime`
 * publication - and comms_reads, which supabase/schema.sql never adds to it.
 *
 * Two channels are opened here, differing only in that one binding, and each is asked to
 * hear a message written while it listens. The rows are read back either way, so a quiet
 * channel is the channel's doing and not a missing write. It signs in as kept test account A (see
 * scripts/browser.cjs), makes no account, and deletes the conversation it opened.
 */
const assert = require('node:assert/strict');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BINDING = { event: '*', schema: 'public' };

(async () => {
  const stamp = Date.now().toString(36);
  const { client, id: me } = await testAccountClient('A');
  const threadId = `grp:${stamp}-binding`;

  async function write(body) {
    const { error: writeError } = await client
      .from('comms_messages')
      .insert({ thread_id: threadId, author_id: me, author_name: 'cline', body });

    assert.equal(writeError, null, `the message "${body}" is filed: ${writeError?.message ?? ''}`);
  }

  /** Opens one channel with those tables, writes, and reports what it heard. */
  async function listen(label, tables) {
    const heard = [];
    const statuses = [];
    let channel = client.channel(`cline-binding-${label}`);

    for (const table of tables) {
      channel = channel.on('postgres_changes', { ...BINDING, table }, () => heard.push(table));
    }

    channel.subscribe((status, channelError) => statuses.push(`${status}${channelError === undefined ? '' : ` :: ${channelError.message}`}`));
    await waitFor(4000);

    await write(`${label} message`);
    await waitFor(6000);
    await client.removeChannel(channel);

    console.log(`${label.padEnd(14)}:`, statuses.join(' / ') || 'no status', '->', heard.length === 0 ? 'NOTHING' : heard.join(','));

    return heard.length > 0;
  }

  try {
    const { error: threadError } = await client
      .from('comms_threads')
      .insert({ id: threadId, kind: 'group', name: 'BINDING CHECK', created_by: me });
    assert.equal(threadError, null, `the group is filed: ${threadError?.message ?? ''}`);

    const { error: memberError } = await client.from('comms_members').insert({ thread_id: threadId, user_id: me });
    assert.equal(memberError, null, `the membership is filed: ${memberError?.message ?? ''}`);

    const withoutReads = await listen('messages+threads', ['comms_messages', 'comms_threads']);
    const withReads = await listen('plus reads', ['comms_messages', 'comms_threads', 'comms_reads']);
    const withMembers = await listen('plus members', ['comms_messages', 'comms_threads', 'comms_members']);
    const likeTheApp = await listen('like the app', ['comms_messages', 'comms_threads', 'comms_reads', 'comms_members']);

    const { data: stored } = await client.from('comms_messages').select('body').eq('thread_id', threadId);
    console.log('stored        :', (stored ?? []).length, 'messages');

    console.log('verdict       :', withReads ? 'reads is harmless' : 'SUBSCRIBING TO comms_reads SILENCES THE CHANNEL');
    console.log('               ', 'members alone:', withMembers ? 'fine' : 'silences it', ':: like the app:', likeTheApp ? 'fine' : 'silent', ':: without reads:', withoutReads ? 'fine' : 'silent');
  } finally {
    await client.from('comms_threads').delete().eq('id', threadId);
    await client.auth.signOut({ scope: 'local' });
    console.log('cleaned up    : conversation deleted, this run signed out');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
