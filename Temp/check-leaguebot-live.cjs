/*
 * LEAGUEBOT's Riot ID table (`user_league`, 20261117060000_user_league.sql; SPEC-leaguebot.md, Luke's 3B), live, as kept test
 * accounts A and B and as a visitor:
 *   node Temp/check-leaguebot-live.cjs
 *
 * - A saves a Riot ID and reads it back; saving again changes the same row
 * - B and a visitor read none of it; a visitor cannot write one; B cannot change or delete A's, nor write a row as A
 * - the table refuses a Riot ID that isn't one (a # in the name, an unknown server)
 *
 * Before the migration is applied the table is not there, and this says so and passes (nothing to hold yet).
 * It leaves nothing: A's row from the run is deleted by A at the end, and A's row from before (if any) is put back.
 */
const assert = require('node:assert/strict');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const probe = await a.client.from('user_league').select('person').limit(1);
  if (probe.error && /user_league|relation|schema cache/i.test(probe.error.message)) {
    console.log('check-leaguebot-live: the table is not there yet (migration not applied); nothing to hold');
    return;
  }
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const before = (await a.client.from('user_league').select('riot_name, riot_tag, region').eq('person', a.id).maybeSingle()).data;

  try {
    const save = await a.client.from('user_league').upsert({ person: a.id, riot_name: 'Check Name', riot_tag: 'CHK', region: 'EUW' });
    assert.equal(save.error, null, 'the owner can save');
    const again = await a.client.from('user_league').upsert({ person: a.id, riot_name: 'Check Name', riot_tag: 'CHK2', region: 'NA' });
    assert.equal(again.error, null, 'saving again changes the row');
    const mine = (await a.client.from('user_league').select('riot_tag, region').eq('person', a.id)).data;
    assert.deepEqual(mine, [{ riot_tag: 'CHK2', region: 'NA' }], 'one row, changed');

    assert.equal(((await b.client.from('user_league').select('person').eq('person', a.id)).data ?? []).length, 0, 'B reads none of it');
    assert.equal(((await visitor.from('user_league').select('person')).data ?? []).length, 0, 'a visitor reads nothing');
    assert.notEqual((await visitor.from('user_league').insert({ person: a.id, riot_name: 'x', riot_tag: 'xx', region: 'EUW' })).error, null, 'a visitor cannot write');
    assert.notEqual((await b.client.from('user_league').insert({ person: a.id, riot_name: 'x', riot_tag: 'xx', region: 'EUW' })).error, null, 'B cannot write a row as A');
    await b.client.from('user_league').update({ riot_tag: 'BAD' }).eq('person', a.id);
    await b.client.from('user_league').delete().eq('person', a.id);
    const after = (await a.client.from('user_league').select('riot_tag').eq('person', a.id).single()).data;
    assert.equal(after.riot_tag, 'CHK2', "B could neither change nor delete A's row");

    assert.notEqual((await a.client.from('user_league').upsert({ person: a.id, riot_name: 'Bad#Name', riot_tag: 'EUW', region: 'EUW' })).error, null, 'a # in the name is refused');
    assert.notEqual((await a.client.from('user_league').upsert({ person: a.id, riot_name: 'Name', riot_tag: 'EUW', region: 'MARS' })).error, null, 'an unknown server is refused');
  } finally {
    await a.client.from('user_league').delete().eq('person', a.id);
    if (before) await a.client.from('user_league').insert({ person: a.id, riot_name: before.riot_name, riot_tag: before.riot_tag, region: before.region });
  }
  const left = (await a.client.from('user_league').select('riot_name').eq('person', a.id)).data ?? [];
  assert.equal(left.length, before ? 1 : 0, 'nothing left behind');
  console.log('check-leaguebot-live: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
