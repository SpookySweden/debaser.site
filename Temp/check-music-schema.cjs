/*
 * Whether the live Supabase project has what the music feature writes:
 *   node Temp/check-music-schema.cjs
 *
 * An anonymous reader is the right reader to ask: the board is public, `music_tracks` is public
 * and so is `music_folders`, so if the anon key cannot select a column then nothing that files or
 * plays audio can reach it either. Reads only - no row is written and nothing is left behind.
 *
 * Run it BEFORE the build that files audio or folders goes up:
 *
 *   - `forum_threads.track` / `forum_comments.track`: every post and reply carries the column in
 *     its insert, so until they exist the board refuses writes outright rather than merely losing
 *     the audio (supabase/migrations/20260927000020_forum_audio_and_track_tags.sql);
 *   - `music_tracks.tags`: only ever read, so a missing column costs a console warning and the
 *     shelf falls back to titles made from file names;
 *   - `music_tracks.folder_path` and `music_folders`: **[ NEW FILE ] writes both**, so until they
 *     exist filing a track fails with the database's own words. The listing itself still reads -
 *     the catalogue's folders are implied by the files - which makes this the one failure that
 *     looks like a broken button rather than a broken page
 *     (supabase/migrations/20260928000021_music_folders.sql).
 */
const fs = require('node:fs');

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** What the feature needs, and what each one holds. */
const NEEDED = [
  { table: 'forum_threads', column: 'track', what: 'the MP3 filed with a post' },
  { table: 'forum_comments', column: 'track', what: 'the MP3 filed with a reply' },
  { table: 'music_tracks', column: 'tags', what: 'how a track sounds, for the filter' },
  { table: 'music_tracks', column: 'folder_path', what: 'the folder a file is filed in' },
  { table: 'music_folders', column: 'path', what: 'the folders anybody signed in can make' },
];

async function read(table, column) {
  const response = await fetch(`${URL_BASE}/rest/v1/${table}?select=${column}&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });

  return { ok: response.ok, body: await response.text() };
}

(async () => {
  if (URL_BASE === undefined || KEY === undefined) {
    console.log('no Supabase project in .env.local - the site runs on the mock stores, so there is nothing to check.');
    return;
  }

  const missing = [];

  for (const need of NEEDED) {
    const { ok, body } = await read(need.table, need.column);
    const label = `${need.table}.${need.column}`.padEnd(34);

    if (ok) {
      console.log(`  ok      ${label} ${need.what}`);
      continue;
    }

    missing.push(need);
    console.log(`  MISSING ${label} ${body.slice(0, 110)}`);
  }

  if (missing.length > 0) {
    console.log('');
    console.log(`${missing.length} of ${NEEDED.length} missing. Paste, in the Supabase SQL editor:`);

    if (missing.some((need) => need.table.startsWith('forum'))) {
      console.log('  supabase/migrations/20260927000020_forum_audio_and_track_tags.sql  (posts and replies)');
    }
    if (missing.some((need) => need.table.startsWith('music'))) {
      console.log('  supabase/migrations/20260928000021_music_folders.sql               (filing files and folders)');
    }

    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('schema ready: a post or reply can carry an MP3, the shelf can tag one, and the archive');
  console.log('can be filed into from the page.');
})();
