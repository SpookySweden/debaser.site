/*
 * YOUR YOUTUBE on the account (`user_youtube_taste`, Luke's OK 2026-11-13), live, as kept test accounts A and B and as
 * a visitor:
 *   node Temp/check-youtube-taste.cjs
 *
 * - the owner can save, read and delete their own row; nobody else can read, change or delete it, and a visitor
 *   cannot read it at all
 * - nobody can write a row for someone else, and a row cannot hold more than 50 channels or 30 topics
 * - the 30-day clean-up refuses anyone without the ingest lock
 * - and, read from the files: no counts or token in the table or the browser's copy, UNLINK deletes the row
 *
 * It leaves nothing: A's row is made and deleted inside the run (a row left by a run that died is deleted by the
 * next run's first step, as A, which can only ever touch A's own row).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const CHANNEL = { id: `UC${'c'.repeat(22)}`, name: 'Check channel' };

(async () => {
  // 1. From the files: the shape Luke OK'd, and nothing more.
  const migration = fs.readFileSync('supabase/migrations/20261113173009_youtube_taste.sql', 'utf8');
  const columns = /create table if not exists public\.user_youtube_taste \(([\s\S]*?)\n\);/.exec(migration)[1];
  assert.doesNotMatch(columns, /count|views|likes|token/i, 'no counts and no token in the table');
  assert.match(migration, /references auth\.users \(id\) on delete cascade/, 'deleted with the account');
  assert.match(migration, /revoke all on public\.user_youtube_taste from public, anon, authenticated;/, 'visitors have no grant');
  assert.match(migration, /interval '30 days'/, 'the clean-up is 30 days');
  const browser = fs.readFileSync('app/lib/web/youtube-taste.ts', 'utf8');
  assert.doesNotMatch(browser, /provider_token|access_token/, 'the account copy never carries a token');
  assert.match(fs.readFileSync('app/lib/web/youtube-link.ts', 'utf8'), /void forgetAccountTaste\(\);/, 'UNLINK deletes the row');
  assert.match(fs.readFileSync('app/api/web/ingest/route.ts', 'utf8'), /rpc\('web_forget_old_youtube_taste', \{ p_secret: lock \}\)/, 'the hourly fetch runs the clean-up with its lock');

  // 2. Live.
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const table = (who) => who.client.from('user_youtube_taste');

  try {
    await table(a).delete().eq('person', a.id);
    const saved = await table(a).upsert({ person: a.id, channels: [CHANNEL], topics: ['Film'], updated_at: new Date().toISOString() });
    assert.equal(saved.error, null, `the owner can save: ${saved.error?.message}`);
    const own = await table(a).select('channels, topics').eq('person', a.id);
    assert.deepEqual(own.data, [{ channels: [CHANNEL], topics: ['Film'] }], 'and read it back');

    const seen = await table(b).select('person').eq('person', a.id);
    assert.deepEqual(seen.data ?? [], [], 'another account reads nothing of it');
    await table(b).update({ topics: ['Hacked'] }).eq('person', a.id);
    await table(b).delete().eq('person', a.id);
    const still = await table(a).select('topics').eq('person', a.id);
    assert.deepEqual(still.data, [{ topics: ['Film'] }], 'nor can it change or delete it');
    const theirs = await visitor.from('user_youtube_taste').select('person').limit(1);
    assert.ok(theirs.error !== null || (theirs.data ?? []).length === 0, 'a visitor reads nothing');

    const forged = await table(a).insert({ person: b.id, channels: [], topics: [] });
    assert.notEqual(forged.error, null, "nobody writes a row for someone else");
    const tooMany = await table(a).upsert({ person: a.id, channels: Array.from({ length: 51 }, () => CHANNEL), topics: [] });
    assert.notEqual(tooMany.error, null, 'no more than 50 channels');
    const tooManyTopics = await table(a).upsert({ person: a.id, channels: [], topics: Array.from({ length: 31 }, (_, i) => `t${i}`) });
    assert.notEqual(tooManyTopics.error, null, 'no more than 30 topics');

    const clean = await visitor.rpc('web_forget_old_youtube_taste', { p_secret: 'x'.repeat(64) });
    assert.notEqual(clean.error, null, 'the clean-up refuses a wrong lock');
    const cleanAsA = await a.client.rpc('web_forget_old_youtube_taste', { p_secret: 'x'.repeat(64) });
    assert.notEqual(cleanAsA.error, null, '... and a signed-in account');
  } finally {
    await table(a).delete().eq('person', a.id);
  }
  const gone = await table(a).select('person').eq('person', a.id);
  assert.deepEqual(gone.data, [], 'the owner can delete it (UNLINK), and the run leaves nothing');

  console.log('ok: YOUR YOUTUBE on the account is owner only, capped, and leaves nothing');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
