/*
 * Runs the Supabase CLI with `--linked --project-ref <ref>` already supplied.
 *
 *   node scripts/db-cli.cjs migration list
 *   node scripts/db-cli.cjs db push --dry-run
 *   node scripts/db-cli.cjs db push
 *
 * **Tracked in `scripts/` for the same reason as `db.cjs`:** `package.json` names it (`db:list`,
 * `db:push`, `db:push:dry`, `db:pull`), so a copy left in gitignored `Temp/` is a command a fresh
 * clone does not have.
 *
 * Why this wrapper exists, and it is two separate reasons that happen to have one answer.
 *
 * **The ref.** The CLI's `--linked` means "the project this checkout is linked to", and a checkout is
 * linked by `supabase link`, which writes `supabase/.temp/project-ref` and asks for the database
 * password. That file is in `.gitignore` - correctly, it is per-machine state - so on a fresh clone,
 * or any clone where nobody ran `link`, every `--linked` command answers `Cannot find project ref.
 * Have you run supabase link?` The ref is not a secret and is already in `.env.local` inside
 * `NEXT_PUBLIC_SUPABASE_URL`, so this reads it from there and passes it explicitly. Nothing is hidden
 * and nothing is guessed: the command that runs is the one printed by `db:push:dry`.
 *
 * **The spawn.** The CLI is invoked as `node node_modules/supabase/dist/supabase.js`, not as
 * `npx supabase`, because Node 24 on Windows refuses to `execFileSync` a `.cmd` shim (`spawnSync
 * npx.cmd EINVAL`) and the `shell: true` workaround joins arguments unescaped (`DEP0190`). The
 * reasoning is written out in full in scripts/db.cjs, which is where it was first found.
 *
 * Anything passed after the script name goes through to the CLI unchanged, so this adds two flags and
 * gets out of the way. `supabase migration new` is deliberately *not* wrapped: it writes a file and
 * needs no project, so package.json calls it directly.
 *
 * **`--include-all`, and why the push scripts pass it.** The CLI refuses to apply a migration whose
 * timestamp is older than the newest one already on the remote, on the assumption that a new
 * migration is always the newest thing - a sensible guard against re-writing history. This repository
 * breaks that assumption on purpose: the fifteen reconciled migrations carry *section numbers* as
 * their time part (20260921000009 ... 20260930000027), because the order they must run in is the
 * order of the sections in supabase/schema.sql rather than the order they were typed. So the newest
 * remote timestamp is fixed at 20260930..., and every migration created from now on - `db:new` stamps
 * it with the actual current time - is *older* than it by the clock. Without `--include-all`, `db
 * push` answers:
 *
 *   Found local migration files to be inserted before the last migration on remote database.
 *   Rerun the command with --include-all flag to apply these migrations.
 *
 * and applies nothing. `--include-all` means "apply every local migration the remote does not have,
 * regardless of timestamp", which is exactly right here: the history is already reconciled, so the
 * set of unapplied files is the set that genuinely needs running. The flag is on `db:push` and
 * `db:push:dry` together, so the preview and the act agree - a dry run that showed nothing while the
 * push did something would be worse than no preview.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

/** The project ref, from the url the site already uses. `https://<ref>.supabase.co` is the trick. */
function projectRef() {
  if (!existsSync('.env.local')) return undefined;

  const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1]?.trim();
  const match = url === undefined ? null : /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/.exec(url);

  return match === null ? undefined : match[1];
}

const passed = process.argv.slice(2);
const ref = projectRef();

/**
 * The CLI sometimes cannot authenticate its temporary login role.
 *
 * A few statements make the CLI open a *direct* Postgres connection as `cli_login_postgres` rather
 * than going through the Management API, and without `SUPABASE_DB_PASSWORD` that role is refused with
 * `password authentication failed` (SQLSTATE 28P01). What makes this confusing rather than merely
 * broken is that it is intermittent: the same command succeeds, fails, then succeeds again, because
 * the CLI only takes the direct route when it decides it has to.
 *
 * So a failure is retried **once**, because it costs one command and the alternative is a person
 * watching `db:list` fail at random and concluding their setup is wrong. The real fix is a line in
 * `.env.local` - `SUPABASE_DB_PASSWORD=...`, see .env.example - and this is only a cushion until
 * that is set.
 *
 * One retry and no more, deliberately: if the first attempt failed for a reason that is *not* the
 * login role, a loop would turn one clear error into a wall of them.
 */
function run(args) {
  const entry = join('node_modules', 'supabase', 'dist', 'supabase.js');

  // `stdio: inherit` rather than a pipe: `db push` prints a plan and wants to be watched, and
  // `migration list` draws a table. Capturing would mean re-printing it and losing the colour.
  try {
    execFileSync(process.execPath, [entry, ...args], { stdio: 'inherit' });
    return { ok: true };
  } catch (error) {
    return { ok: false, status: error.status ?? 1 };
  }
}

if (ref === undefined) {
  console.error('no NEXT_PUBLIC_SUPABASE_URL in .env.local, so there is no project to point at.');
  console.error('Copy .env.example to .env.local and fill in the two keys.');
  process.exitCode = 1;
} else {
  // `--linked` is kept alongside the explicit ref: it is what makes the CLI treat this as a remote
  // project rather than a local stack, and some subcommands read it for more than the ref.
  const args = [...passed, '--linked', '--project-ref', ref];

  // A retry cannot be silent about a *write*: a `db push` that failed halfway must not be re-run
  // quietly, because the second run would be applying part of the same set again. Reads and dry runs
  // are free to retry - neither has an effect to duplicate.
  const retryable = !passed.includes('push') || passed.includes('--dry-run');

  const first = run(args);

  if (first.ok) {
    process.exitCode = 0;
  } else if (retryable) {
    console.error('');
    console.error('That is usually the CLI failing to authenticate its temporary login role, which is');
    console.error('intermittent. Retrying once - set SUPABASE_DB_PASSWORD in .env.local to stop it.');
    console.error('');

    const second = run([...args, '--yes']);

    if (second.ok) {
      process.exitCode = 0;
    } else {
      console.error('');
      console.error('That failed twice. If it mentions SUPABASE_DB_PASSWORD, add it to .env.local');
      console.error('(see .env.example); otherwise the project may need linking once:');
      console.error(`  npm run db:link -- --project-ref ${ref}`);
      process.exitCode = second.status;
    }
  } else {
    console.error('');
    console.error('A `db push` is not retried automatically, because half of it may have landed.');
    console.error('Run `npm run db:list` to see what the remote now has before pushing again.');
    process.exitCode = first.status;
  }
}
