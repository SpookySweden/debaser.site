/*
 * SPEC-forum-v3.md part 2: the one live check of `user_settings` (Luke's OK 2026-11-18: "you have the okay"). Against the
 * live database on Luke's PC, as the kept test accounts:
 *   - TEST ACCOUNT A writes and reads its own row;
 *   - TEST ACCOUNT B can neither read it, change it, nor write a row in A's name;
 *   - a visitor (no session) cannot read the table at all.
 * It leaves A's row behind (nobody may delete rows through the site: there is no delete rule), so it is not in the checks
 * suite. Clean-up, with Luke's OK: `npm run db:backup`, then a `select` and a `delete` of A's row from a file.
 *
 *   node scripts/probe-user-settings.cjs     (through heavy-step.cjs --live-check)
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('./browser.cjs');

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = { keys: {}, made: { drawings: true, characters: true, files: true, tracks: true, letters: true }, probe: 'forum-v3-part2' };

  // A, its own row.
  const wrote = await a.client.from('user_settings').upsert({ person: a.id, settings: probe, updated_at: new Date().toISOString() });
  assert.equal(wrote.error, null, `A can save its own settings (${wrote.error?.message ?? ''})`);
  const own = await a.client.from('user_settings').select('person, settings').eq('person', a.id);
  assert.equal(own.error, null);
  assert.equal(own.data.length, 1, 'A reads its own row back');
  assert.equal(own.data[0].settings.probe, 'forum-v3-part2');
  console.log('  ok    A saves and reads its own row');

  // B, someone else.
  const bReads = await b.client.from('user_settings').select('person').eq('person', a.id);
  assert.equal(bReads.error, null);
  assert.equal(bReads.data.length, 0, "B cannot read A's row");
  const bAll = await b.client.from('user_settings').select('person');
  assert.ok((bAll.data ?? []).every((row) => row.person === b.id), "B's whole read of the table holds only B's own row, if any");
  const bChanges = await b.client.from('user_settings').update({ settings: { keys: { theme: 'default' } } }).eq('person', a.id).select('person');
  assert.equal((bChanges.data ?? []).length, 0, "B cannot change A's row");
  const bForges = await b.client.from('user_settings').insert({ person: a.id, settings: { keys: {} } });
  assert.notEqual(bForges.error, null, "B cannot write a row in A's name");
  const bDeletes = await b.client.from('user_settings').delete().eq('person', a.id).select('person');
  assert.equal((bDeletes.data ?? []).length, 0, "B cannot delete A's row");
  console.log("  ok    B cannot read, change, forge or delete A's row");

  // A visitor.
  const seen = await visitor.from('user_settings').select('person');
  assert.ok(seen.error !== null || (seen.data ?? []).length === 0, 'a visitor reads nothing');
  assert.notEqual(seen.error, null, 'a visitor is refused the table outright (no grant)');
  console.log('  ok    a visitor is refused');

  // A's row is as A left it.
  const after = await a.client.from('user_settings').select('settings').eq('person', a.id);
  assert.equal(after.data?.[0]?.settings?.probe, 'forum-v3-part2', "A's row is untouched by B");
  console.log(`  ok    A's row untouched. Leftover to clean up: user_settings where person = '${a.id}' (TEST ACCOUNT A).`);
  await Promise.all([a.client.auth.signOut(), b.client.auth.signOut()]);
  console.log('probe-user-settings: ok');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
