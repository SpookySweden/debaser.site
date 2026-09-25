/*
 * Runs every scratch check that does not need the network (run from the root):
 *   node scripts/run-checks.cjs
 *
 * **Tracked in `scripts/`, not `Temp/`.** It lived in the gitignored scratch folder for most of this
 * project's life, which meant a fresh clone had no check runner at all - and, worse, that a *fix* to the
 * runner stayed on one machine. The checks themselves are still scratch files (`Temp/check-*.cjs`): they
 * are written against whatever is being worked on and are not a suite the site ships. What is tracked is
 * the thing that runs them.
 *
 * Each check documents its own steps in a header comment - the `npx tsc ...` lines that
 * compile the few modules it needs - so those are read from the file and run before it, in
 * order. The ones that need Supabase credentials (`--env-file=.env.local` in their header)
 * and a browser are left out: they are live checks, run by hand against the deployed
 * project.
 *
 * A live check signs accounts up to ask the database anything (a policy needs a session, and a
 * tag needs two accounts), and it cannot delete them: that takes the service role, which the
 * site never holds. Those accounts show up in the user directory on /users, so after a session
 * of live checks, run `supabase/cleanup/throwaway-accounts-review.sql` and then
 * `supabase/cleanup/throwaway-accounts-sweep.sql` in the SQL editor.
 */
const { execSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Where the scratch checks live, found from this file so either copy of the runner works. */
const CHECK_DIR = existsSync('Temp') ? 'Temp' : join(__dirname, '..', 'Temp');
const ROOT = join(__dirname, '..');

const SKIP = new Set([
  'check-channel-binding.cjs',
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

const files = readdirSync(CHECK_DIR)
  .filter((name) => name.startsWith('check-') && name.endsWith('.cjs') && !SKIP.has(name))
  .sort();

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
function compileSteps(file) {
  const lines = readFileSync(join(CHECK_DIR, file), 'utf8').split('\n');
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

for (const file of files) {
  const steps = compileSteps(file);

  try {
    for (const step of steps) execSync(step, { stdio: 'pipe', cwd: ROOT });

    const output = execSync(`node ${join(CHECK_DIR, file)}`, { stdio: 'pipe', cwd: ROOT }).toString().split('\n')[0];
    console.log(`ok   ${file.padEnd(34)} ${output.trim()}`);
  } catch (error) {
    const detail = (error.stdout?.toString() ?? error.message).split('\n').slice(0, 4).join(' / ');
    console.log(`FAIL ${file.padEnd(34)} ${detail.trim()}`);
    failures.push(file);
  }
}

console.log(`\n${files.length - failures.length}/${files.length} checks passed`);
if (failures.length > 0) process.exitCode = 1;
