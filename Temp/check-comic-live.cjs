/*
 * COMIC's locks on the LIVE database (supabase/migrations/20261120015329_comic.sql, SPEC-comic.md "Who reads"): what a
 * visitor and an ordinary account (TEST ACCOUNT A, not the house account) can and can't do. Read-only for them by design:
 * every write below is one the database must refuse, so nothing is left behind.
 *   node Temp/check-comic-live.cjs
 * Run it through heavy-step.cjs --live-check (it asks the live database). Skips when there is no Supabase project or
 * test password on this machine.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const { testAccountClient } = require(path.join(__dirname, '..', 'scripts', 'browser.cjs'));

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let account;
  try {
    account = await testAccountClient('A');
  } catch (error) {
    console.log(`check-comic-live: skipped (${error.message})`);
    return;
  }
  const visitor = createClient(url ?? process.env.NEXT_PUBLIC_SUPABASE_URL, key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = account.client ?? account;

  for (const [who, client] of [
    ['a visitor', visitor],
    ['TEST ACCOUNT A', signedIn],
  ]) {
    // Reading: only released pages, never an unreleased one.
    const pages = await client.from('comic_pages').select('id, released_at').limit(500);
    assert.equal(pages.error, null, `${who} can read the released pages`);
    assert.ok((pages.data ?? []).every((row) => row.released_at !== null), `${who} sees no unreleased page`);

    // Writing: refused everywhere.
    const volume = await client.from('comic_volumes').insert({ number: 9999, title: 'LOCK PROBE' });
    assert.ok(volume.error !== null, `${who} cannot add a volume`);
    const release = await client.rpc('comic_release', { p_page_ids: ['00000000-0000-4000-8000-000000000000'] });
    assert.ok(release.error !== null, `${who} cannot release pages`);

    // Files: no original, and nothing to upload.
    const upload = await client.storage.from('comic').upload('reading/lock-probe/v1.jpg', new Uint8Array([255, 216, 255]), { contentType: 'image/jpeg' });
    assert.ok(upload.error !== null, `${who} cannot put a file in the comic bucket`);
    const listed = await client.storage.from('comic').list('original', { limit: 5 });
    assert.ok((listed.data ?? []).length === 0, `${who} cannot list the originals`);
  }

  // An ordinary account's release is refused in the house account's words.
  const refused = await signedIn.rpc('comic_release', { p_page_ids: ['00000000-0000-4000-8000-000000000000'] });
  assert.match(refused.error?.message ?? '', /only the house account releases pages/);

  console.log('check-comic-live: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
