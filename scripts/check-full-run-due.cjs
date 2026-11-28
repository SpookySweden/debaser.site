/*
 * When `npm run checks:changed` says FULL RUN DUE. `check-hidden-accounts` is red on purpose, so every full run has one
 * failure, and until 2026-11-28 any failure asked for the whole suite again, every time.
 *
 * The real runner is run, on a copy of it in a throwaway folder: its stamp of the last full run is `Temp/` beside it, so
 * the pretend stamps below never touch this machine's real one. The copy has no checks of its own except the pretend ones
 * written here, and the known-red list it reads is the real one (scripts/known-red-checks.cjs).
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = mkdtempSync(join(tmpdir(), 'full-run-due-'));
const scripts = join(root, 'scripts');
const stampFile = join(root, 'Temp', '.last-full-checks.json');
mkdirSync(scripts);
mkdirSync(join(root, 'Temp'));
// The runner skips check-hidden-accounts in a copy with no keys: an empty file stands in, so it runs the pretend one.
writeFileSync(join(root, '.env.local'), '');
for (const name of ['run-checks.cjs', 'checks-changed.cjs', 'known-red-checks.cjs']) {
  if (existsSync(join(__dirname, name))) copyFileSync(join(__dirname, name), join(scripts, name));
}

const run = (...flags) => {
  const result = spawnSync(process.execPath, [join('scripts', 'run-checks.cjs'), ...flags], { cwd: root, encoding: 'utf8' });
  assert.ok(result.stdout.includes('checks passed'), `the runner did not finish: ${result.stderr}`);
  return result.stdout;
};
/** The FULL RUN DUE line `checks:changed` prints for this stamp, or '' when it prints none. */
const due = (stamp) => {
  if (stamp === null) rmSync(stampFile, { force: true });
  else writeFileSync(stampFile, typeof stamp === 'string' ? stamp : JSON.stringify(stamp));
  return run('--changed').split('\n').find((line) => line.includes('FULL RUN DUE')) ?? '';
};
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const fullRun = (days, ...names) => ({ at: daysAgo(days), total: 269, failed: names.length, failedChecks: names });

const KNOWN = 'check-hidden-accounts.cjs';

try {
  // (a) Only the check that is red on purpose failed: nothing is owed.
  assert.equal(due(fullRun(1, KNOWN)), '', 'only the known red check failed, so no full run is due');
  assert.equal(due(fullRun(1)), '', 'nothing failed, so no full run is due');
  assert.equal(due({ at: daysAgo(1), total: 269, failed: 0 }), '', 'an older stamp with no names and no failures is fine');

  // (b) Any other failure is owed, and named. The known one is not named beside it.
  const other = due(fullRun(1, KNOWN, 'check-themes.cjs'));
  assert.match(other, /check-themes\.cjs/, 'another failed check makes a full run due, and is named');
  assert.doesNotMatch(other, /hidden-accounts/, 'the known red check is not named as the reason');
  assert.match(due({ at: daysAgo(1), total: 269, failed: 1 }), /not recorded/, 'an older stamp that cannot say which check failed is owed');

  // (c) No stamp, or one that cannot be read.
  for (const stamp of [null, '{"at": ', 'null', '{}']) {
    assert.match(due(stamp), /FULL RUN DUE/, `no readable stamp (${stamp}) makes a full run due`);
  }

  // (d) The days limit still counts, whatever failed.
  assert.equal(due(fullRun(6, KNOWN)), '', 'six days old is not yet due');
  assert.match(due(fullRun(7, KNOWN)), /7 day\(s\) ago/, 'a week old is due');

  // The writing side: a full run records which checks failed, and checks:changed reads that back.
  const pretend = (name) => writeFileSync(join(root, 'Temp', name), "throw new Error('pretend failure');\n");
  pretend(KNOWN);
  rmSync(stampFile, { force: true });
  run();
  assert.deepEqual(JSON.parse(readFileSync(stampFile, 'utf8')).failedChecks, [KNOWN], 'the stamp names the failed check');
  assert.equal(run('--changed').includes('FULL RUN DUE'), false, 'after that full run nothing is owed');
  pretend('check-pretend.cjs');
  run();
  assert.match(run('--changed'), /FULL RUN DUE.*check-pretend\.cjs/, 'after a full run with a new failure, it is owed and named');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: FULL RUN DUE only for an unexpected failure, no readable stamp, or a week since the last full run');
