/*
 * Which side of realtime is broken:
 *   node --env-file=.env.local Temp/check-realtime-scope.cjs
 *
 * Two rows are watched from one session, both by tables the schema puts in the
 * `supabase_realtime` publication:
 *   profiles        written by the subscriber itself (the simplest case there is)
 *   comms_messages  written by the other account, which is what a chat needs
 *
 *   profiles arrives, comms_messages does not  -> the comms tables are not published
 *   neither arrives                            -> replication is off for the project
 *
 * It signs in as kept test accounts A and B (see scripts/browser.cjs) and makes no account. B's bio is
 * written for the profiles event and put back as it was; the conversations it opens are deleted.
 */
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function account(letter) {
  const { client, id } = await testAccountClient(letter);
  return { id, client };
}

(async () => {
  const stamp = Date.now().toString(36);
  const a = await account('A');
  const b = await account('B');
  const threadId = `dm:${[a.id, b.id].sort().join('|')}`;
  let channel = null;
  // B's bio as it was, or null if it could not be read - in which case it is left alone rather than blanked.
  const bio = (await b.client.from('profiles').select('bio').eq('id', b.id).single()).data?.bio ?? null;

  try {
    await a.client
      .from('comms_threads')
      .upsert(
        {
          id: threadId,
          kind: 'dm',
          name: '',
          participant_a: [a.id, b.id].sort()[0],
          participant_b: [a.id, b.id].sort()[1],
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

    const heard = [];
    const statuses = [];

    channel = b.client
      .channel('cline-scope-probe')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => heard.push('profiles UPDATE'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comms_messages' }, () =>
        heard.push('comms_messages INSERT'),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comms_threads' }, () =>
        heard.push('comms_threads INSERT'),
      )
      .subscribe((status, error) => statuses.push(`${status}${error === undefined ? '' : ` :: ${error.message}`}`));

    for (let attempt = 0; attempt < 20 && statuses.includes('SUBSCRIBED') === false; attempt += 1) {
      await waitFor(500);
    }

    console.log('channel     :', statuses.join(' / ') || 'no status at all');

    // 1. The subscriber writes its own profile: the simplest event there is.
    if (bio !== null) await b.client.from('profiles').update({ bio: `scope probe ${stamp}` }).eq('id', b.id);
    await waitFor(4000);
    console.log('after self  :', heard.length === 0 ? 'NOTHING' : heard.join(', '));
    const profilesDelivered = heard.includes('profiles UPDATE');

    // 2. Another account opens a conversation with the subscriber.
    await a.client.from('comms_threads').insert({
      id: `dm:${[a.id, b.id].sort().join('|')}-second`,
      kind: 'dm',
      name: '',
      participant_a: '00000000-0000-0000-0000-000000000000',
      participant_b: '00000000-0000-0000-0000-000000000001',
    });
    await a.client
      .from('comms_messages')
      .insert({ thread_id: threadId, author_id: a.id, author_name: 'TEST ACCOUNT A', body: 'probe' });
    await waitFor(5000);

    console.log('after comms :', heard.length === 0 ? 'NOTHING' : heard.join(', '));
    console.log(
      'verdict     :',
      profilesDelivered
        ? heard.includes('comms_messages INSERT')
          ? 'realtime delivers comms messages'
          : 'REALTIME WORKS, THE COMMS TABLES ARE NOT PUBLISHED'
        : 'realtime is not delivering anything for this project',
    );
  } finally {
    if (channel !== null) await b.client.removeChannel(channel);
    await a.client.from('comms_threads').delete().eq('id', threadId);
    await a.client.from('comms_threads').delete().eq('id', `${threadId}-second`);

    if (bio !== null) await b.client.from('profiles').update({ bio }).eq('id', b.id);
    console.log("tidy        : B's bio put back, the conversations deleted");
    for (const who of [a, b]) await who.client.auth.signOut({ scope: 'local' });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
