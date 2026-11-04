/*
 * What the player will actually find in the mp3 bucket:
 *   node --env-file=.env.local Temp/check-music-bucket.cjs
 *
 * An anonymous reader is the harshest test of the bucket policy there is - which is the
 * point: if the listing is refused, the player falls back to the archive's own hand-filed
 * tracks, and this says so rather than leaving it a mystery. Run it after
 * supabase/migrations/20260921000014_music_and_profile_songs.sql and the tracks already in the
 * bucket appear here, titled, and are what the player opens on and loops.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BUCKET = 'mp3';

(async () => {
  assert.ok(URL && KEY, 'run this with --env-file=.env.local');

  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = client.storage.from(BUCKET);

  const root = await storage.list('', { limit: 200, sortBy: { column: 'name', order: 'asc' } });

  if (root.error !== null) {
    console.log(`${BUCKET} ->`, root.error.message);
    console.log('  the bucket cannot be listed, so the player uses the archive tracks only.');
    console.log('  run supabase/migrations/20260921000014_music_and_profile_songs.sql for the "mp3 readable" policy.');
    return;
  }

  const entries = root.data ?? [];
  const files = [];
  const folders = [];

  for (const entry of entries) {
    if (entry.id === null) {
      folders.push(entry.name);
      const nested = await storage.list(entry.name, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
      for (const child of nested.data ?? []) {
        if (child.id !== null) files.push(`${entry.name}/${child.name}`);
      }
      continue;
    }

    files.push(entry.name);
  }

  console.log(`${BUCKET} ->`, entries.length, 'entries ::', files.length, 'track(s) ::', folders.length, 'folder(s)');

  for (const path of files) {
    const url = storage.getPublicUrl(path).data.publicUrl;
    const head = await fetch(url, { method: 'HEAD' });
    console.log(`  ${path}  ->  ${head.status} ${head.headers.get('content-type') ?? ''} ${head.headers.get('content-length') ?? ''}`);
  }

  if (files.length === 0) {
    console.log('  nothing in the bucket yet: the player opens on the archive theme instead.');
  } else {
    console.log('  the first of these is what the player opens on, and loops with [ LOOP: ON ].');
  }

  const rows = await client.from('music_tracks').select('title, src');
  console.log('music_tracks ->', rows.error === null ? `${(rows.data ?? []).length} row(s)` : rows.error.message);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
