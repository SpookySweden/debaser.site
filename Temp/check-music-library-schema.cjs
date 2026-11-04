/**
 * Whether the live Supabase project has what the music feature writes, and whether it is *sealed*.
 *
 *   node Temp/check-music-library-schema.cjs
 *
 * Two different questions, and the second is the one that matters:
 *
 *   1. **is the table there?** `music_likes` and `music_playlists` are read on every visit to the music
 *      window, and the reads deliberately swallow their own failures (an unreadable library draws as an
 *      empty one). So a table that is missing is not a page that breaks - it is a page that quietly says
 *      "you have liked nothing", which is the exact fault this whole feature was reviewed for. Asking the
 *      project is the only way to tell that from the truth.
 *
 *   2. **is the policy on?** These are the *first* music tables with an owner, so the question is not
 *      whether an account can read its own likes - it is whether it can read anybody else's. The anon key
 *      is the right instrument for exactly that: a request with no session must come back *empty*, not
 *      with rows. If anonymous requests can read `music_likes`, the policies did not land, and every
 *      reader's taste is on the open web.
 *
 * Reads only. No row is written and nothing is left behind.
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

/** Tables the library reads, and what each one is for. */
const TABLES = [
  { table: 'music_likes', what: 'what one account liked' },
  { table: 'music_playlists', what: 'the lists one account made' },
];

/**
 * A read with no session.
 *
 * No `Authorization` header at all, which is what a signed-out browser sends - so this is exactly the
 * request a stranger can make, and it is the one that must not return rows.
 */
async function anonRead(path) {
  const response = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY },
  });

  return { status: response.status, ok: response.ok, body: await response.text() };
}

(async () => {
  if (URL_BASE === undefined || KEY === undefined) {
    console.log('no Supabase project in .env.local - the site runs on the mock stores, so there is nothing to check.');
    return;
  }

  let bad = 0;

  console.log('the tables, and whether an anonymous reader can see into them:\n');

  for (const { table, what } of TABLES) {
    // 1. Does the table exist at all? A missing one is a 404 with a message naming the relation.
    const exists = await anonRead(`${table}?select=*&limit=1`);

    if (!exists.ok && /does not exist|schema cache/i.test(exists.body)) {
      console.log(`  MISSING  ${table.padEnd(18)} ${what}`);
      console.log(`           paste supabase/migrations/20260930000025_music_library.sql`);
      bad += 1;
      continue;
    }

    // 2. The policy question. An anonymous read that returns rows is the fault; an empty array is the
    //    seal working. `200 []` and `200 [...]` are both `ok`, so the *body* is what decides this.
    const rows = await anonRead(`${table}?select=*&limit=5`);

    if (!rows.ok) {
      console.log(`  REFUSED  ${table.padEnd(18)} ${what}`);
      console.log(`           the request failed outright (${rows.status}), which is not the same as sealed`);
      console.log(`           ${rows.body.slice(0, 110)}`);
      bad += 1;
      continue;
    }

    let parsed;

    try {
      parsed = JSON.parse(rows.body);
    } catch {
      console.log(`  ODD      ${table.padEnd(18)} could not read the answer (${rows.body.slice(0, 80)})`);
      bad += 1;
      continue;
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`  OPEN     ${table.padEnd(18)} ${parsed.length} row(s) readable with no session`);
      console.log(`           the own-rows-only policy did NOT land: check pg_policies for ${table}`);
      bad += 1;
      continue;
    }

    console.log(`  sealed   ${table.padEnd(18)} ${what} :: nothing readable without a session`);
  }

  console.log('');

  if (bad > 0) {
    console.log(`${bad} problem(s). If a table is MISSING, paste the migration. If one is OPEN, the`);
    console.log('table exists but anyone can read it - run this and expect 3 rows for music_likes and');
    console.log('4 for music_playlists, every one of them scoped to auth.uid():');
    console.log('');
    console.log("  select tablename, policyname, cmd from pg_policies");
    console.log("   where tablename in ('music_likes', 'music_playlists') order by tablename, cmd;");
    process.exitCode = 1;
    return;
  }

  console.log('library schema ready, and sealed: likes and lists exist, and neither is readable by a');
  console.log('stranger. Signing in is what makes them visible, which is what the policy says.');
})();
