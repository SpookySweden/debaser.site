/*
 * Runs SQL against the deployed Supabase project, through the Supabase CLI:
 *
 *   npm run db -- "select count(*) from public.profiles;"
 *   npm run db -- --file supabase/cleanup/verify-live-schema.sql
 *   npm run db -- --read-only "select * from auth.users limit 5;"
 *   npm run db -- --json "select tablename from pg_tables where schemaname = 'public';"
 *
 * **Tracked in `scripts/`, not `Temp/`.** `package.json` names this file, and `Temp/` is gitignored,
 * so a copy kept there means `npm run db` does not exist on a fresh clone - the same defect
 * `read-site.cjs` and `run-checks.cjs` were moved out of. The scratch checks stay scratch; the
 * instrument a rule points at does not.
 *
 * Why it exists: every other script in `Temp/` talks to the project the way the *site* does - the
 * publishable key over PostgREST - and that key cannot run SQL. It can read the tables RLS lets it
 * read and call the functions the schema defines, and that is all; there is no SQL-over-HTTP door a
 * publishable key opens. So the checks can prove what a reader would see, and none of them can ask
 * why. This one can, and it is the same instrument the SQL editor uses: `supabase db query`, which
 * goes to the Management API with a personal access token.
 *
 * The token is the whole security story here, so it is worth being clear about what it is: a
 * **personal access token** (`sbp_...`) from https://supabase.com/dashboard/account/tokens, which
 * belongs to *you* and to every project you can see - not to this site. It is read from the
 * environment as `SUPABASE_ACCESS_TOKEN`, and the usual way to hold it is a line in `.env.local` -
 * which is gitignored, like `Temp/` but for its own reason. Nothing in `app/` ever reads it: the site is
 * built with the publishable key and nothing else, which is what keeps a bundling mistake from
 * shipping a database password to a browser.
 *
 * Two other things the CLI wants, and this script reports rather than hides when they are missing:
 *
 *   - `supabase login`, or `SUPABASE_ACCESS_TOKEN` in the environment - whichever is set wins;
 *   - `supabase link --project-ref <ref> [--password <db password>]`, once per checkout. `db query
 *     --linked` refuses without it, and the error the CLI gives is long enough to be worth
 *     translating. The project ref is derived here from `NEXT_PUBLIC_SUPABASE_URL`, which is already
 *     in `.env.local`, so there is nothing extra to find: `https://<ref>.supabase.co` is the ref.
 *
 * Writes are refused unless asked for. `db query` will happily run a `drop table`, so this script
 * looks at the statement and, when it is not a read, stops and prints what it is about to do and the
 * flag that says to do it. That is a courtesy rather than a guard - the CLI has no read-only mode -
 * but it is the difference between a typo and an outage:
 *
 *   --write      run a statement that changes something (`insert`, `update`, `alter`, `drop`, ...)
 *   --dry-run    print the statement and the command, and run nothing at all
 *
 * It writes nothing to the repository, holds no row of its own, and leaves the database as it found
 * it unless the SQL it was given says otherwise.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/** `.env.local`, read the way the other scripts read it, and the environment winning over it. */
function env() {
  const fromFile = existsSync('.env.local')
    ? Object.fromEntries(
        readFileSync('.env.local', 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
          }),
      )
    : {};

  return { ...fromFile, ...process.env };
}

/** The project, from the url the site already uses. `https://<ref>.supabase.co` is the whole trick. */
function projectRef(environment) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (url === undefined) return undefined;

  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/.exec(url.trim());
  return match === null ? undefined : match[1];
}

/**
 * The CLI, run from the repository root.
 *
 * It is invoked as `node node_modules/supabase/dist/supabase.js` rather than as `npx supabase`, and
 * that is not a style choice - it is the only form that works here. Node 24 on Windows refuses to
 * `execFileSync` a `.cmd` shim at all (`spawnSync npx.cmd EINVAL`), because the batch-file path is how
 * a shell-injection bug would arrive. `shell: true` gets around that, but then the arguments are
 * joined without escaping them, which Node itself warns about (`DEP0190`).
 *
 * Running the CLI's own entry point with the same `node` that is running this script sidesteps both:
 * no shim, no shell, no warning - and it uses the version pinned in package.json rather than whatever
 * `npx` might resolve. `npx supabase ...` typed into a terminal is unaffected; this is only about the
 * way a script spawns it.
 */
function cli(args, environment) {
  const entry = join('node_modules', 'supabase', 'dist', 'supabase.js');

  return execFileSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: environment,
    // The CLI prints progress and colour to a terminal; a pipe gets neither, but a wider buffer is
    // what keeps a `select *` on a big table from being cut in half.
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Is this statement allowed to change things?
 *
 * Deliberately crude: it strips the comments, then looks at the first word left and treats anything
 * but a read keyword as a write. A `with ... delete` is therefore a write, which is the right mistake
 * to make - the cost of a false "this is a write" is one extra flag, and the cost of a false "this is
 * a read" is somebody's table.
 */
function isRead(sql) {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trimStart()
    .toLowerCase();

  return /^(select|with|show|explain|table|values)\b/.test(stripped);
}

/** The statement in one line, for the summary - long ones are cut rather than printed whole. */
function describe(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length <= 96 ? flat : `${flat.slice(0, 93)}...`;
}

/** The statements to run: `--file <path>`, or everything that is not a flag. */
function statement(argv) {
  const at = argv.indexOf('--file') !== -1 ? argv.indexOf('--file') : argv.indexOf('-f');

  if (at === -1) {
    return { sql: argv.filter((arg) => !arg.startsWith('-')).join(' ').trim(), from: 'the command line' };
  }

  const path = argv[at + 1];

  if (path === undefined) {
    return { error: '--file needs a path: npm run db -- --file supabase/cleanup/verify-live-schema.sql' };
  }

  if (!existsSync(path)) return { error: `no such file: ${path}` };

  return { sql: readFileSync(path, 'utf8'), from: path };
}

/** The credential, before anything is attempted, so the answer is a sentence rather than a stack. */
function hasCredential(environment) {
  if (environment.SUPABASE_ACCESS_TOKEN !== undefined) return true;

  try {
    cli(['projects', 'list', '--output-format', 'json'], environment);
    return true;
  } catch {
    return false;
  }
}

/**
 * The run itself.
 *
 * `--file` is the transport rather than a shell argument, because a multi-statement script with `$`
 * quoting in it does not survive being passed through a command line - and half of supabase/ is
 * exactly that (dollar-quoted `do $$ ... $$` blocks). The file is written to a temp directory and
 * removed in the `finally`, so nothing is left in the repository and the same statement can be run
 * twice without the second run finding a file from the first.
 */
function run(sql, from, ref, environment, json) {
  const args = ['db', 'query', '--linked', '--project-ref', ref];
  if (json) args.push('--output-format', 'json');

  const dir = mkdtempSync(join(tmpdir(), 'debaser-sql-'));
  const tmp = join(dir, 'statement.sql');
  writeFileSync(tmp, sql, 'utf8');

  const started = Date.now();

  try {
    const out = cli([...args, '--file', tmp], environment);

    console.log(`${isRead(sql) ? 'read' : 'write'} :: ${from} :: ${Date.now() - started}ms`);
    console.log(`     ${describe(sql)}`);
    console.log('');
    process.stdout.write(out.trim() === '' ? '(no rows)\n' : `${out.trim()}\n`);
  } catch (error) {
    const detail = `${error.stdout?.toString() ?? ''}\n${error.stderr?.toString() ?? ''}`.trim();

    // The failures that are a setup step or a credential, said in one line each. Anything else is the
    // database's own words about the statement, which is the thing worth reading.
    if (/not linked|Cannot find project ref|no linked project/i.test(detail)) {
      console.error(`the checkout is not linked to ${ref} yet. Run this once:`);
      console.error('');
      console.error(`  npx supabase link --project-ref ${ref}`);
      console.error('');
      console.error('It asks for the database password (Dashboard -> Project Settings -> Database).');
    } else if (/Unauthorized|Invalid access token|401|403/i.test(detail)) {
      console.error('the token was refused. Make a new one at');
      console.error('https://supabase.com/dashboard/account/tokens and put it in SUPABASE_ACCESS_TOKEN.');
    } else {
      console.error(detail === '' ? String(error.message) : detail);
    }

    process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const environment = env();
  const ref = projectRef(environment);
  const json = argv.includes('--json');
  const readOnly = argv.includes('--read-only');
  const write = argv.includes('--write');
  const dryRun = argv.includes('--dry-run');

  const { sql, from, error } = statement(argv);

  if (error !== undefined) {
    console.error(error);
    process.exitCode = 1;
    return;
  }

  if (sql.length === 0) {
    console.error('nothing to run. Either:');
    console.error('  npm run db -- "select count(*) from public.profiles;"');
    console.error('  npm run db -- --file supabase/cleanup/verify-live-schema.sql');
    process.exitCode = 1;
    return;
  }

  if (readOnly && !isRead(sql)) {
    console.error('--read-only was given but the statement is not a read:');
    console.error(`  ${describe(sql)}`);
    console.error('Drop the flag if it is meant to change something.');
    process.exitCode = 1;
    return;
  }

  // The project, before anything is printed: a dry run names the ref in its command, so the ref has to
  // be known first. A missing url is a setup step, and it is the same answer for every flag.
  if (ref === undefined) {
    console.error('no NEXT_PUBLIC_SUPABASE_URL in .env.local, so there is no project to point at.');
    console.error('Copy .env.example to .env.local and fill in the two keys.');
    process.exitCode = 1;
    return;
  }

  // A dry run is a preview, so it is answered before the write guard: seeing what a migration would
  // do is exactly the case a dry run is for, and it runs nothing either way.
  if (dryRun) {
    console.log(`npx supabase db query --linked --project-ref ${ref} --file <temp>`);
    console.log('(nothing is run)');
    console.log('');
    console.log(sql.trim());
    return;
  }

  // A write stops here unless it was asked for, and the SQL is printed rather than the flag, so the
  // review is of what is about to happen.
  if (!isRead(sql) && !write) {
    console.error('this statement changes the database:');
    console.error('');
    console.error(sql.trim());
    console.error('');
    console.error('Nothing was run. Re-run with --write to do it, or --dry-run to see the command.');
    process.exitCode = 1;
    return;
  }

  if (!hasCredential(environment)) {
    console.error('no Supabase credential. One of these:');
    console.error('');
    console.error('  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # this shell only');
    console.error('  SUPABASE_ACCESS_TOKEN=sbp_...            # a line in .env.local, gitignored');
    console.error('  npx supabase login                        # stores it for the machine, in the browser');
    console.error('');
    console.error('A token is made at https://supabase.com/dashboard/account/tokens - it is a *personal*');
    console.error('access token: it belongs to your account and reaches every project you can see, not just');
    console.error('this one. That is why it lives in .env.local and never in app/ or .env.production.');
    process.exitCode = 1;
    return;
  }

  run(sql, from, ref, environment, json);
}

main();
