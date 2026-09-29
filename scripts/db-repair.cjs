/*
 * Records the fifteen existing migrations as already applied, without running any of them.
 *
 *   node scripts/db-repair.cjs            # show the timestamps and what the remote history says
 *   node scripts/db-repair.cjs --applied  # record them all as applied
 *
 * Why this exists and why it is only ever run once. The schema was built by pasting schema.sql into
 * the SQL editor, so the project already has everything in supabase/migrations/ while
 * `supabase_migrations.schema_migrations` - the table `db push` consults - is empty. A push would
 * therefore try to run all fifteen files against a database that already has their contents. They are
 * written to be re-runnable, so that would mostly be harmless, but "mostly" is not a property to rely
 * on for `revoke update on public.comms_threads` or a `drop policy`.
 *
 * `supabase migration repair --status applied <timestamp>` marks one file as done *without* running
 * it, which is exactly the right tool: it is a statement of what is already true. This script just
 * does it for every file in the folder, reading the timestamps off the names, so nobody has to copy
 * fifteen of them by hand and get one wrong.
 *
 * It is the same instrument `supabase migration list` reports on: run `npm run db:repair:list` after,
 * and every line should read `applied` in the remote column.
 */
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

/** The timestamps the chain is made of, in order, taken from the file names themselves. */
function timestamps() {
  return readdirSync('supabase/migrations')
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort();
}

/** The project ref, derived from the url the site already uses - same trick as scripts/db.cjs. */
function projectRef() {
  if (!existsSync('.env.local')) return undefined;

  const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1]?.trim();
  const match = url === undefined ? null : /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/.exec(url);

  return match === null ? undefined : match[1];
}

const APPLY = process.argv.includes('--applied');
const stamps = timestamps();
const ref = projectRef();

/**
 * The CLI, run in-process.
 *
 * `node node_modules/supabase/dist/supabase.js`, not `npx supabase`: Node 24 on Windows refuses to
 * `execFileSync` a `.cmd` shim (`EINVAL`), and the `shell: true` workaround joins arguments unescaped
 * (`DEP0190`). Same reasoning as scripts/db.cjs, which is where it was first written down.
 */
function cli(args) {
  const entry = join('node_modules', 'supabase', 'dist', 'supabase.js');

  return execFileSync(process.execPath, [entry, ...args], { stdio: 'pipe', encoding: 'utf8' });
}

console.log(`${stamps.length} migration(s) in supabase/migrations/:`);
for (const stamp of stamps) console.log(`  ${stamp}`);

if (ref === undefined) {
  console.log('');
  console.log('no NEXT_PUBLIC_SUPABASE_URL in .env.local, so there is no project to repair.');
  process.exitCode = 1;
} else if (!APPLY) {
  console.log('');
  console.log(`project: ${ref}`);
  console.log('Nothing was changed. Re-run with --applied to record them all as applied, then');
  console.log('`npm run db:list` to read the two columns back.');
} else {
  let failed = 0;

  for (const stamp of stamps) {
    try {
      cli(['migration', 'repair', '--linked', '--project-ref', ref, '--status', 'applied', stamp]);
      console.log(`  applied  ${stamp}`);
    } catch (error) {
      failed += 1;
      const detail = `${error.stdout?.toString() ?? ''}${error.stderr?.toString() ?? ''}`.trim();
      console.log(`  FAILED   ${stamp}  ${detail.split('\n')[0]}`);
    }
  }

  console.log('');
  console.log(`${stamps.length - failed}/${stamps.length} recorded as applied. Run \`npm run db:list\` to check,`);
  console.log('and `npm run db:push:dry` to see what a push would now apply (it should be nothing).');

  if (failed > 0) process.exitCode = 1;
}
