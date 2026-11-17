/*
 * HISTORY's table (`user_plays`, 20261117022630_user_plays.sql; SPEC-history.md), live, as kept test accounts A and B and
 * as a visitor:
 *   node Temp/check-history-live.cjs
 *
 * - A writes a play through play_note and reads it back; the same play again at once is the same line
 * - B and a visitor read none of A's lines; a visitor cannot write one; B cannot change or delete A's
 * - a change may only say where the play stopped: A changing a line's title leaves it as written
 * - PAUSE: with A's history paused the database refuses a new line, and takes one again once resumed
 *
 * Before the migration is applied the table is not there, and this says so and passes (nothing to hold yet).
 * It leaves nothing: A's lines from the run are deleted by A at the end, and A's pause is put back as it was.
 * Guests are not tried here: checks never make accounts, and a guest is a new anonymous account.
 */
const assert = require('node:assert/strict');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const probe = await a.client.from('user_plays').select('id').limit(1);
  if (probe.error && /user_plays|relation|schema cache/i.test(probe.error.message)) {
    console.log('check-history-live: the table is not there yet (migration not applied); nothing to hold');
    return;
  }
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const ref = `check:history:${Date.now()}`;
  const note = (who, extra = {}) => who.client.rpc('play_note', { p_kind: 'song', p_ref: ref, p_title: 'Check song', p_maker: 'Check maker', p_how: 'yourself', p_where_label: 'CHECK', ...extra });
  const settings = (await a.client.from('user_history_settings').select('paused').eq('person', a.id).maybeSingle()).data;
  const wasPaused = settings?.paused === true;

  try {
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: false });
    const first = await note(a);
    assert.equal(first.error, null, 'the owner can write');
    const again = await note(a);
    assert.equal(String(again.data), String(first.data), 'the same play again at once is the same line');
    const mine = (await a.client.from('user_plays').select('id, title, how').eq('ref', ref)).data;
    assert.equal(mine.length, 1, 'one line');

    assert.equal(((await b.client.from('user_plays').select('id').eq('ref', ref)).data ?? []).length, 0, 'B reads none of it');
    assert.equal(((await visitor.from('user_plays').select('id').eq('ref', ref)).data ?? []).length, 0, 'a visitor reads none of it');
    assert.notEqual((await visitor.rpc('play_note', { p_kind: 'song', p_ref: ref })).error, null, 'a visitor cannot write');
    await b.client.from('user_plays').update({ left_at_seconds: 99 }).eq('id', mine[0].id);
    await b.client.from('user_plays').delete().eq('id', mine[0].id);

    await a.client.from('user_plays').update({ title: 'Changed', left_at_seconds: 12 }).eq('id', mine[0].id);
    const after = (await a.client.from('user_plays').select('title, left_at_seconds').eq('id', mine[0].id).single()).data;
    assert.equal(after.title, 'Check song', 'a change cannot rewrite what played');
    assert.equal(after.left_at_seconds, 12, 'only where it stopped, and B changed nothing');

    await a.client.from('user_history_settings').upsert({ person: a.id, paused: true });
    assert.notEqual((await note(a, { p_ref: `${ref}:paused`, p_how: 'own_queue' })).error, null, 'paused: the database refuses a new line');
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: false });
    assert.equal((await note(a, { p_ref: `${ref}:resumed` })).error, null, 'resumed: taken again');
  } finally {
    await a.client.from('user_plays').delete().like('ref', `${ref}%`);
    await a.client.from('user_history_settings').upsert({ person: a.id, paused: wasPaused });
  }
  console.log('check-history-live: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
