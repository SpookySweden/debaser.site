/*
 * Whether the live Supabase project has what the lore pages read and write:
 *   node Temp/check-lore-schema.cjs
 *
 * An anonymous reader is the right reader to ask: a lore page is readable by anybody - only opening
 * and filing one take an account - so if the anon key cannot select a column then nothing that
 * shows or saves a page can reach it either. Reads only: no row is written and nothing is left
 * behind.
 *
 * Run it BEFORE the build that puts a lore page up:
 *
 *   - `lore_pages.slug` and `updated_at`: the index lists pages by them, and a join reads one page
 *     by its address, so a missing column is a shelf that reports an error rather than an empty one;
 *   - `lore_pages.body_text` and `yjs_state`: what a save writes, so a missing one refuses the save
 *     with the database's own words while the editing itself still works;
 *   - the table itself, which is what the policies are attached to.
 *
 * supabase/migrations/20260929000022_lore_pages.sql is the file to run, and section 22 of
 * supabase/schema.sql holds the same thing.
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
  { table: 'lore_pages', column: 'slug', what: 'the page address, and the key a link names' },
  { table: 'lore_pages', column: 'updated_at', what: 'what the shelf is ordered by' },
  { table: 'lore_pages', column: 'body_text', what: 'the writing as plain text, for a reader' },
  { table: 'lore_pages', column: 'yjs_state', what: 'the document an editor opens' },
  { table: 'lore_pages', column: 'updated_by_label', what: 'who filed it last' },
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
    const label = `${need.table}.${need.column}`.padEnd(30);

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
    console.log('  supabase/migrations/20260929000022_lore_pages.sql   (the lore pages, and their policies)');

    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('schema ready: a page can be listed, read, opened and filed, and the shelf is ordered by');
  console.log('when it was last written in.');
})();
