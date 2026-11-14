/*
 * An imported YouTube history's summary on the account (`user_watch_summary`, Luke's OK 2026-11-14: "A: Yes, new
 * table"), live, as kept test accounts A and B and as a visitor:
 *   node Temp/check-watch-summary.cjs
 *
 * - the owner can save, read and delete their own row; nobody else can read, change or delete it, and a visitor
 *   cannot read it at all
 * - nobody can write a row for someone else, and a row cannot hold more than 200 channels or 60 words
 * - the 12-month clean-up refuses anyone without the ingest lock
 * - and, read from the files: the shape Luke OK'd and nothing more, and the hourly fetch runs the clean-up
 *
 * It leaves nothing: A's row is made and deleted inside the run (a row left by a run that died is deleted by the
 * next run's first step, as A, which can only ever touch A's own row).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const CHANNEL = { name: 'Check channel', strength: 3, last: '2026-10' };

(async () => {
  // 1. From the files: the shape Luke OK'd, and nothing more.
  const migration = fs.readFileSync('supabase/migrations/20261114223035_watch_summary.sql', 'utf8');
  const columns = /create table if not exists public\.user_watch_summary \(([\s\S]*?)\n\);/.exec(migration)[1];
  assert.deepEqual([...columns.matchAll(/^  ([a-z_]+) [a-z]/gm)].map((match) => match[1]).filter((name) => name !== 'constraint'), ['person', 'channels', 'words', 'imported_at'], 'the person, channel names with a strength and a month, words, and when: no videos, titles or addresses');
  assert.doesNotMatch(columns, /title|url|video|token/i);
  assert.match(migration, /references auth\.users \(id\) on delete cascade/, 'deleted with the account');
  assert.match(migration, /revoke all on public\.user_watch_summary from public, anon, authenticated;/, 'visitors have no grant');
  assert.match(migration, /interval '12 months'/, 'the clean-up is 12 months');
  assert.match(fs.readFileSync('app/api/web/ingest/route.ts', 'utf8'), /rpc\('web_forget_old_watch_summary', \{ p_secret: lock \}\)/, 'the hourly fetch runs the clean-up with its lock');

  // 2. Live.
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const table = (who) => who.client.from('user_watch_summary');

  try {
    await table(a).delete().eq('person', a.id);
    const saved = await table(a).upsert({ person: a.id, channels: [CHANNEL], words: ['woodworking'], imported_at: new Date().toISOString() });
    assert.equal(saved.error, null, `the owner can save: ${saved.error?.message}`);
    const own = await table(a).select('channels, words').eq('person', a.id);
    assert.deepEqual(own.data, [{ channels: [CHANNEL], words: ['woodworking'] }], 'and read it back');

    const seen = await table(b).select('person').eq('person', a.id);
    assert.deepEqual(seen.data ?? [], [], 'another account reads nothing of it');
    await table(b).update({ words: ['hacked'] }).eq('person', a.id);
    await table(b).delete().eq('person', a.id);
    const still = await table(a).select('words').eq('person', a.id);
    assert.deepEqual(still.data, [{ words: ['woodworking'] }], 'nor can it change or delete it');
    const theirs = await visitor.from('user_watch_summary').select('person').limit(1);
    assert.ok(theirs.error !== null || (theirs.data ?? []).length === 0, 'a visitor reads nothing');

    const forged = await table(a).insert({ person: b.id, channels: [], words: [] });
    assert.notEqual(forged.error, null, 'nobody writes a row for someone else');
    const tooMany = await table(a).upsert({ person: a.id, channels: Array.from({ length: 201 }, () => CHANNEL), words: [] });
    assert.notEqual(tooMany.error, null, 'no more than 200 channels');
    const tooManyWords = await table(a).upsert({ person: a.id, channels: [], words: Array.from({ length: 61 }, (_, i) => `w${i}`) });
    assert.notEqual(tooManyWords.error, null, 'no more than 60 words');

    const clean = await visitor.rpc('web_forget_old_watch_summary', { p_secret: 'x'.repeat(64) });
    assert.notEqual(clean.error, null, 'the clean-up refuses a wrong lock');
    const cleanAsA = await a.client.rpc('web_forget_old_watch_summary', { p_secret: 'x'.repeat(64) });
    assert.notEqual(cleanAsA.error, null, '... and a signed-in account');

    const removed = await table(a).delete().eq('person', a.id);
    assert.equal(removed.error, null);
    assert.deepEqual((await table(a).select('person').eq('person', a.id)).data, [], 'REMOVE IMPORT deletes it');
  } finally {
    await table(a).delete().eq('person', a.id);
  }

  console.log('ok: an imported YouTube history summary is owner only, capped, and leaves nothing');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
