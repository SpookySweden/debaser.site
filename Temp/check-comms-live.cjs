/*
 * Live check: the comms store against the deployed project, with no session.
 *   node --env-file=.env.local Temp/check-comms-live.cjs
 *
 * An anonymous visitor is the harshest reader there is: Row Level Security hands back
 * nothing, and every write is refused. What this proves is that the store *answers* on a
 * real project - it used to throw before it could even ask, because it read a table the
 * database did not have - and that a refusal reaches the screen as an error rather than as
 * a silent success.
 *
 * The two-account check beside this one (Temp/check-comms-two-accounts.cjs) is the one
 * that proves messages, groups and realtime, because it signs in.
 */
const assert = require('node:assert/strict');
const { getSupabaseCommsRepository } = require('./comms-groups-out/comms/supabase-comms-repository.js');

(async () => {
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL, 'run this with --env-file=.env.local');

  const comms = getSupabaseCommsRepository();
  assert.equal(comms.source, 'supabase', 'the store under test is the Supabase one');

  const threads = await comms.listThreads('00000000-0000-0000-0000-000000000000');
  assert.deepEqual(threads, [], 'the conversation read answers instead of throwing');
  console.log('read      :', threads.length, 'conversations for an anonymous visitor (RLS)');

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/comms_threads?select=*,comms_members(user_id),comms_messages(*),comms_reads(*)`,
    { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } },
  );
  assert.equal(response.status, 200, 'the group-aware read the store uses is answerable');
  console.log('schema    : the members embed reads back at', response.status, '(the group script has run)');

  await assert.rejects(
    () =>
      comms.createGroup({
        creatorId: '00000000-0000-0000-0000-000000000000',
        creatorName: 'sweden',
        name: 'THE WARD',
        memberIds: [],
      }),
    (error) => typeof error.message === 'string' && error.message.length > 0,
    'a group written with no session is refused, not silently dropped',
  );
  console.log('groups    : refused for an anonymous writer, with a reason');

  console.log('live comms checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
