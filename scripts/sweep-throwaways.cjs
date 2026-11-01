/*
 * Removes the accounts a live check leaves behind - one command, with the list read before it acts.
 *
 *   npm run db:sweep:review    list exactly what a sweep would remove, and change nothing
 *   npm run db:sweep           the same list, then the sweep itself
 *
 * **Why this exists.** Every check that talks to the real project signs accounts up, because a
 * policy cannot be asked anything without a session and a tag needs two accounts. The client cannot
 * delete them - that takes the service role, which the site never holds - so they pile up in
 * `auth.users`, and `auth.users` is what the directory on /users lists. On 2026-09-29 that directory
 * held **293** accounts of which **284** were the checks': a single pass of the suite leaves the
 * board's own member list full of `probe actor` and `diag <stamp>`. The suite cannot clean up after
 * itself - which is the fact this script answers - so the sweep has to come *after* the last live
 * check run and never before it.
 *
 * **The review runs first, always, and its output is printed before anything is removed.** That is
 * the pattern `supabase/cleanup/` was written around and it is the difference between a bounded
 * delete and a hopeful one: the list names the accounts and counts the survivors, so the survivors
 * are *confirmed* rather than assumed. `--review` stops after the list, which is what
 * `npm run db:sweep:review` does.
 *
 * The two statements are the reviewed pair in `supabase/cleanup/`; this script holds no SQL of its
 * own. It runs them in order through `scripts/db.cjs`, which supplies the credential and refuses a
 * write that was not asked for - so `--write` appears here, once, next to the sweep it names. The
 * sweep is idempotent: a second run finds nothing and removes nothing.
 */
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const REVIEW = join('supabase', 'cleanup', 'throwaway-accounts-review.sql');
const SWEEP = join('supabase', 'cleanup', 'throwaway-accounts-sweep.sql');
const DB = join(__dirname, 'db.cjs');

const REVIEW_ONLY = process.argv.includes('--review');

/** One statement, through the same instrument every other `npm run db` command uses. */
function sql(file, write) {
  const args = [DB, ...(write ? ['--write'] : []), '--file', file];
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

const missing = [DB, REVIEW, SWEEP].filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error('missing, so nothing was run:');
  for (const file of missing) console.error(`  ${file}`);
  process.exitCode = 1;
} else {
  try {
    console.log('REVIEW - what a sweep would remove, and what it would leave:');
    console.log('');
    sql(REVIEW, false);

    if (REVIEW_ONLY) {
      console.log('');
      console.log('Nothing was removed. Confirm the survivors above are the accounts that should survive,');
      console.log('then `npm run db:sweep` to act on that list.');
    } else {
      console.log('');
      console.log('SWEEP - removing exactly the accounts the review listed:');
      console.log('');
      sql(SWEEP, true);
      console.log('');
      console.log('Read it back with `npm run db:sweep:review`: it should now have nothing to remove, and');
      console.log('/users should list only the accounts somebody really made.');
    }
  } catch (caught) {
    const detail = `${caught.stdout ?? ''}${caught.stderr ?? ''}`.trim();
    console.error('');
    console.error('the database did not answer cleanly:');
    console.error(detail === '' ? String(caught.message ?? caught) : detail.split('\n').slice(0, 12).join('\n'));
    process.exitCode = 1;
  }
}
