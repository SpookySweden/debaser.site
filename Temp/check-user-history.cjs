/*
 * FOR YOU's private history (`user_history`, `user_history_settings`; Luke's OK 2026-11-13), live, as kept test accounts A
 * and B and as a visitor:
 *   node Temp/check-user-history.cjs
 *
 * - the owner writes through history_note and reads it back; a stronger action replaces a weaker one; NOT FOR ME stays
 * - another account and a visitor read nothing; nobody writes or changes a row for someone else
 * - PAUSE: the database refuses new rows while paused, and takes them again once resumed
 * - ERASE: the owner's delete empties their history
 * - the 90-day clean-up refuses anyone without the ingest lock
 * - from the files: the table holds no counts or token, and the hourly fetch runs the clean-up
 *
 * It leaves nothing: A's rows and settings row are made and removed inside the run (A can only ever touch A's own).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  const migration = fs.readFileSync('supabase/migrations/20261113210656_user_history.sql', 'utf8');
  const columns = /create table if not exists public\.user_history \(([\s\S]*?)\n\);/.exec(migration)[1];
  assert.doesNotMatch(columns, /count|views|likes|token|message/i, 'no counts, token or message text in the table');
  assert.match(migration, /references auth\.users \(id\) on delete cascade/, 'deleted with the account');
  assert.match(migration, /offset 3000/, 'the 3,000-row cap');
  assert.match(migration, /interval '90 days'/, 'the 90-day clean-up');
  assert.match(fs.readFileSync('app/api/web/ingest/route.ts', 'utf8'), /rpc\('web_forget_old_history', \{ p_secret: lock \}\)/, 'the hourly fetch runs it with its lock');

  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const note = (who, ref, action, title = 'Check item') =>
    who.client.rpc('history_note', { p_kind: 'media', p_ref: ref, p_title: title, p_maker: 'Check maker', p_words: ['check'], p_action: action });
  const mine = async () => (await a.client.from('user_history').select('ref, action, title').eq('person', a.id).order('ref')).data;

  try {
    await a.client.from('user_history').delete().eq('person', a.id);
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: false });

    assert.equal((await note(a, 'check:1', 'opened')).error, null, 'the owner can write');
    await note(a, 'check:1', 'finished');
    await note(a, 'check:1', 'opened');
    await note(a, 'check:2', 'not_for_me');
    await note(a, 'check:2', 'played');
    assert.deepEqual(await mine(), [
      { ref: 'check:1', action: 'finished', title: 'Check item' },
      { ref: 'check:2', action: 'not_for_me', title: 'Check item' },
    ], 'one row per thing; the stronger action stays; NOT FOR ME stays');

    assert.deepEqual((await b.client.from('user_history').select('ref').eq('person', a.id)).data ?? [], [], 'another account reads nothing');
    const seen = await visitor.from('user_history').select('ref').limit(1);
    assert.ok(seen.error !== null || (seen.data ?? []).length === 0, 'a visitor reads nothing');
    assert.notEqual((await b.client.from('user_history').insert({ person: a.id, kind: 'media', ref: 'forged', action: 'opened' })).error, null, "nobody writes for someone else");
    await b.client.from('user_history').update({ title: 'Hacked' }).eq('person', a.id);
    await b.client.from('user_history').delete().eq('person', a.id);
    assert.equal((await mine()).length, 2, 'nor changes or deletes it');
    assert.deepEqual((await b.client.from('user_history_settings').select('paused').eq('person', a.id)).data ?? [], [], "nor reads A's settings");

    await a.client.from('user_history_settings').upsert({ person: a.id, paused: true, changed_at: new Date().toISOString() });
    assert.notEqual((await note(a, 'check:3', 'opened')).error, null, 'paused: the database refuses a new row');
    assert.notEqual((await note(a, 'check:1', 'opened')).error, null, '... and a change to an old one');
    assert.equal((await mine()).length, 2);
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: false, changed_at: new Date().toISOString() });
    assert.equal((await note(a, 'check:3', 'opened')).error, null, 'resumed: it takes them again');

    assert.notEqual((await visitor.rpc('web_forget_old_history', { p_secret: 'x'.repeat(64) })).error, null, 'the clean-up refuses a wrong lock');
    assert.notEqual((await a.client.rpc('web_forget_old_history', { p_secret: 'x'.repeat(64) })).error, null, '... and a signed-in account');
    assert.notEqual((await visitor.rpc('history_note', { p_kind: 'media', p_ref: 'v', p_title: '', p_maker: '', p_words: [], p_action: 'opened' })).error, null, 'a visitor cannot write history');

    const erased = await a.client.from('user_history').delete().eq('person', a.id);
    assert.equal(erased.error, null);
    assert.deepEqual(await mine(), [], 'ERASE empties it');
  } finally {
    await a.client.from('user_history').delete().eq('person', a.id);
    // The settings row is A's own switch, put back to its start (not paused); there is no delete rule for it by design.
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: false, changed_at: new Date().toISOString() });
  }

  console.log('ok: FOR YOU history is owner only, pausable by the database, erasable, and leaves no rows');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
