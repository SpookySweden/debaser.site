/*
 * Runs every scratch check that does not need the network (run from the root):
 *   node scripts/run-checks.cjs
 *
 * **Tracked in `scripts/`, not `Temp/`.** It lived in the gitignored scratch folder for most of this
 * project's life, which meant a fresh clone had no check runner at all - and, worse, that a *fix* to the
 * runner stayed on one machine. Most of the checks are still scratch files (`Temp/check-*.cjs`): they are
 * written against whatever is being worked on and are not a suite the site ships. What is tracked is the
 * thing that runs them - and a check the documentation points at by name, such as the deployed-site one
 * (`scripts/check-deployed.cjs`, also run standalone as `npm run deployed`), is tracked with it. Both
 * directories are scanned for `check-*.cjs` for that reason.
 *
 * Each check documents its own steps in a header comment - the `npx tsc ...` lines that
 * compile the few modules it needs - so those are read from the file and run before it, in
 * order. The ones that need Supabase credentials (`--env-file=.env.local` in their header)
 * and a browser are left out: they are live checks, run by hand against the deployed
 * project.
 *
 * A live check needs a session to ask the database anything (a policy needs one, and a tag needs
 * two accounts), so it signs in as the kept test accounts TEST ACCOUNT A-D - never a new account.
 * They are hidden from every list of people on the site (`profiles.is_hidden`), so a run leaves
 * nothing on /users. Checks used to sign a new account up per run (284 of the 293 accounts on
 * 2026-09-29 were this runner's); any old leftovers are still cleared with:
 *
 *     npm run db:sweep:review    the list, and it changes nothing
 *     npm run db:sweep           the same list, then the removal
 *
 * `scripts/sweep-throwaways.cjs` is that pair. It holds no SQL of its own - it runs the two
 * reviewed files in `supabase/cleanup/` in order, review first, so the survivors are read before
 * they are assumed. It used to say "in the SQL editor", which was two manual steps nobody could
 * run from a clone.
 */
const { execSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, relative } = require('node:path');
const { changedFiles, pickChecks } = require('./checks-changed.cjs');

/**
 * Where the checks live. `Temp/` holds the scratch ones, written against whatever is being worked on;
 * `scripts/` may also hold one, when a check is a *tool* the documentation points at by name and a fresh
 * clone therefore has to have it. `check-deployed.cjs` is that case - it was in `Temp/` and tracked
 * nowhere, and moving it to `scripts/` silently left it out of this suite, because this loop globbed one
 * directory. It globs both now: **a check that leaves the suite by being tidied is the same fault as a
 * check that never fails**, and it is worse, because the run still says "all passed".
 */
const CHECK_DIRS = [existsSync('Temp') ? 'Temp' : join(__dirname, '..', 'Temp'), __dirname];
const ROOT = join(__dirname, '..');

const SKIP = new Set([
  'check-channel-binding.cjs',
  'check-beatbox-songs.cjs',
  'check-comms-live.cjs',
  'check-comms-two-accounts.cjs',
  'check-live-shape.cjs',
  'check-live-tag-filter.cjs',
  'check-lore-schema.cjs',
  'check-music-bucket.cjs',
  'check-games-live.cjs',
  'check-notifications-schema.cjs',
  'check-realtime-events.cjs',
  'check-realtime-scope.cjs',
  'check-resend.cjs',
]);

/**
 * `--only <prefix>` narrows the run to the checks whose name starts with it (`npm run checks:web`).
 * `--changed` narrows it to the checks this work can affect (`npm run checks:changed`, `checks-changed.cjs`).
 */
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt === -1 ? 'check-' : process.argv[onlyAt + 1];
if (!ONLY || !ONLY.startsWith('check-')) throw new Error('--only needs a prefix starting with "check-"');

/** Every `check-*.cjs` in either directory, as `{ dir, name }`, in name order and deduplicated by name. */
const files = [];
const seen = new Set();
for (const dir of CHECK_DIRS) {
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith(ONLY) || !name.endsWith('.cjs')) continue;
    if (SKIP.has(name) || seen.has(name)) continue;
    seen.add(name);
    files.push({ dir, name });
  }
}
files.sort((a, b) => a.name.localeCompare(b.name));

const CHANGED = process.argv.includes('--changed');
/** The last whole-suite run on this machine: `checks:changed` says when another is due. */
const LAST_FULL_RUN = join(ROOT, 'Temp', '.last-full-checks.json');
const FULL_RUN_DAYS = 7;

if (CHANGED) {
  const changed = changedFiles();
  const inRepo = files.map(({ dir, name }) => ({ name, path: relative(ROOT, join(dir, name)).split('\\').join('/') }));
  const total = files.length;

  if (changed === null) {
    console.log('Git cannot compare with origin/main here (try `git fetch`), so running everything.');
  } else {
    const { all, picked } = pickChecks(changed, inRepo);
    files.splice(0, total, ...files.filter(({ name }) => picked.has(name)));

    console.log(`${changed.length} changed file(s); ${files.length} of ${total} checks can be affected.`);
    if (all) console.log(`Running everything, because ${all} changed.`);
    else if (files.length === 0) console.log('No check knows these files: verify and the live read are the proof.');
  }

  // A stamp that cannot be read counts as no stamp: it must never stop the checks, or hide that a full run is owed.
  let last = null;
  try {
    last = JSON.parse(readFileSync(LAST_FULL_RUN, 'utf8'));
  } catch {
    last = null;
  }
  const days = Math.floor((Date.now() - Date.parse(last?.at)) / 86_400_000);
  if (!Number.isFinite(days) || days >= FULL_RUN_DAYS || last.failed !== 0) {
    const state = Number.isFinite(days) ? `${days} day(s) ago, ${last.failed} failed` : 'none on this machine yet';
    console.log(`*** FULL RUN DUE: npm run checks (last: ${state}) ***`);
  }
  console.log('');
}

/**
 * A whole run starts from nothing. Compiled output left by an earlier run let checks pass against old code: two compiled
 * nothing at all and were still reading files from September until 2026-11-04. A narrowed run keeps them, to stay quick.
 */
if (!CHANGED && onlyAt === -1) {
  for (const { dir, name } of files) {
    for (const match of readFileSync(join(dir, name), 'utf8').matchAll(/--outDir (Temp\/[\w-]+)/g)) {
      rmSync(join(ROOT, match[1]), { recursive: true, force: true });
    }
  }
}

/**
 * These read the live database with the keys in `.env.local`, which never reaches a clean copy. Without it they are
 * skipped out loud rather than failed, so the count says what ran.
 */
const NEEDS_KEYS = new Set(['check-hidden-accounts.cjs', 'check-music-library-schema.cjs', 'check-music-schema.cjs']);
if (!existsSync(join(ROOT, '.env.local'))) {
  for (const key of NEEDS_KEYS) {
    const at = files.findIndex(({ name }) => name === key);
    if (at === -1) continue;
    files.splice(at, 1);
    console.log(`skip ${key.padEnd(34)} needs the database keys, which this copy has not got`);
  }
}

const failures = [];

/**
 * The `npx tsc ...` lines a check needs, read from its own header comment.
 *
 * **The whole comment, not the first twenty lines.** It used to be `slice(0, 20)`, and that silently broke
 * a check whose header grew past twenty lines: its compile steps were never run, so the check was handed
 * whatever the *previous* check had left in a shared output directory. It reported a pass against stale
 * compiled code - and when it failed, it failed for a reason that had nothing to do with the source, which
 * is the worst possible failure mode for a check to have. The block is read to its closing `*&#47;` instead,
 * so a header may be as long as it needs to be.
 */
function compileSteps(dir, file) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  const header = [];

  for (const line of lines) {
    header.push(line);
    if (header.length > 1 && line.trim().startsWith('*/')) break;
  }

  /**
   * **A header that names a compiler but does not start a step is an error, not an absence.**
   *
   * The prefix match below is `'npx tsc '` exactly, and a check that wrote `npm exec tsc ...` - the same
   * command, spelled another way - had its compiles silently skipped and was handed whatever the previous
   * check left in a shared output directory. It then failed on a missing module, which read as a broken check
   * rather than a wrong header. That is the `slice(0, 20)` defect again in a new costume, so this time the
   * runner says so out loud instead of quietly compiling nothing.
   */
  const mentionsCompiler = (line) => /\btsc\b/.test(line) && /--outDir/.test(line);
  const isStep = (line) => /^\s*\*\s*npx tsc /.test(line);

  for (const line of header) {
    if (mentionsCompiler(line) && !isStep(line) && !line.includes('`npx tsc')) {
      throw new Error(
        `${file}: header line looks like a compile step but does not start with "npx tsc ": ${line.trim()}`,
      );
    }
  }

  return header
    .filter((line) => line.includes('npx tsc '))
    .map((line) => line.replace(/^\s*\*\s*/, '').trim())
    .filter((line) => line.startsWith('npx tsc '));
}

/**
 * A step is written `npx tsc ...`, the command a person would type, but run as the same compiler through node:
 * `npx` spends about five seconds starting up on this machine before tsc does anything (5357ms against 404ms for
 * `tsc --version`, 2026-11-03), and `npm run verify` runs 34 of these.
 */
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
// `--strictNullChecks` is what tsconfig.json compiles the site with. Without it a check could not compile the site's
// `if (!result.ok) result.reason` code at all, and six checks tested nothing until 2026-11-04.
const direct = (step) => `"${process.execPath}" "${TSC}" --strictNullChecks ${step.slice('npx tsc '.length)}`;

for (const { dir, name } of files) {
  const steps = compileSteps(dir, name);

  try {
    for (const step of steps) execSync(direct(step), { stdio: 'pipe', cwd: ROOT });

    const output = execSync(`node "${join(dir, name)}"`, { stdio: 'pipe', cwd: ROOT }).toString().split('\n')[0];
    console.log(`ok   ${name.padEnd(34)} ${output.trim()}`);
  } catch (error) {
    // A check that throws says why on stderr; without it a failure printed an empty line.
    const said = `${error.stderr ?? ''}\n${error.stdout ?? error.message}`.split('\n');
    const reason = said.find((line) => /AssertionError|^\w*Error: |error TS\d/.test(line));
    const detail = (reason ? [reason] : said.filter(Boolean).slice(0, 4)).join(' / ');
    console.log(`FAIL ${name.padEnd(34)} ${detail.trim()}`);
    failures.push(name);
  }
}

if (!CHANGED && onlyAt === -1) {
  writeFileSync(LAST_FULL_RUN, JSON.stringify({ at: new Date().toISOString(), total: files.length, failed: failures.length }));
}

console.log(`\n${files.length - failures.length}/${files.length} checks passed`);
if (failures.length > 0) process.exitCode = 1;
