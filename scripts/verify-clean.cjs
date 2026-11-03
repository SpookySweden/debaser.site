/*
 * Runs `npm run verify` on a commit in a kept clean copy of the site (run from the root):
 *   npm run verify:clean                   the current commit (HEAD): commit your own files first, push after it passes
 *   npm run verify:clean -- <sha>          another commit
 *   npm run verify:clean -- --wait 1800    seconds to wait while another session holds the copy (default 900)
 *
 * A run takes about five minutes (verify itself is most of it), so start it in the background.
 *
 * Why it exists (2026-11-03): several sessions share this folder, so one session's half-finished files fail another
 * session's verify. The way round it was a new detached worktree per push, and every one of them paid a full
 * `npm ci` (507 packages, 2-3 minutes: a node_modules junction breaks Turbopack, "Symlink points out of the
 * filesystem root"), then `npx next typegen` and `mkdir Temp`, steps each session rediscovered. Two builds in one
 * folder also refuse each other ("Another next build process is already running"), and the checks compile into
 * fixed Temp/out-* folders that two runs at once overwrite.
 *
 * This keeps ONE clean copy outside the repository (~\.debaser-clean-verify, a git worktree, so a commit made here
 * is already there) and reinstalls packages only when package-lock.json changed since its last install. Not under
 * AppData: the Claude app redirects that into its own package folder, so a terminal outside the app would see
 * another place. One session at a time: a lock file next to the copy names who holds it, and the next one waits.
 *
 * What it proves: the committed code passes verify on its own. What it does not: anything uncommitted, the scratch
 * checks in Temp/ (`npm run checks` still runs in this folder), a capture, or the deployed site.
 *
 * Exit codes: 0 verify passed, 1 verify failed, 2 the copy could not be set up, 3 the copy stayed busy.
 */
const { execFileSync, execSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COPY = path.join(os.homedir(), '.debaser-clean-verify');
const LOCK = `${COPY}.lock`;
const STAMP = path.join(COPY, 'node_modules', '.clean-verify-lock-hash');
/** A lock older than this is a crashed run, whatever its process id says (ids are reused). */
const STALE_MS = 60 * 60 * 1000;

const args = process.argv.slice(2);
const waitAt = args.indexOf('--wait');
const waitSeconds = waitAt === -1 ? 900 : Number(args[waitAt + 1]);
const shaArg = args.find((arg, index) => !arg.startsWith('--') && (waitAt === -1 || index !== waitAt + 1));

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Through the shell, because Node 24 on Windows will not spawn npm's .cmd shim directly. */
function run(command) {
  const started = Date.now();
  execSync(command, { cwd: COPY, stdio: 'inherit' });
  return Math.round((Date.now() - started) / 1000);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    return null;
  }
}

/** Claims the copy, or waits for it. A lock whose process is gone, or that is over an hour old, is taken over. */
async function claim(sha) {
  const deadline = Date.now() + waitSeconds * 1000;
  let said = 0;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, sha, started: new Date().toISOString() }));
      closeSync(fd);
      process.on('exit', () => {
        try {
          if (readLock()?.pid === process.pid) rmSync(LOCK, { force: true });
        } catch {
          // left behind: the next run sees this process is gone and takes it over
        }
      });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const held = readLock();
    if (!held || !alive(held.pid) || Date.now() - Date.parse(held.started) > STALE_MS) {
      rmSync(LOCK, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      finish(3, `BUSY: process ${held.pid} has held the clean copy since ${held.started} (verifying ${String(held.sha).slice(0, 7)}). Try again, or pass --wait <seconds>.`);
    }
    if (Date.now() - said > 60_000) {
      console.log(`waiting: process ${held.pid} is verifying ${String(held.sha).slice(0, 7)} in the clean copy (since ${held.started})`);
      said = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) finish(2, 'BAD --wait: give a number of seconds.');
  let sha;
  try {
    sha = git('rev-parse', '--verify', `${shaArg ?? 'HEAD'}^{commit}`);
  } catch {
    finish(2, `NO SUCH COMMIT: ${shaArg ?? 'HEAD'}`);
  }

  await claim(sha);
  const started = Date.now();
  const took = {};
  try {
    if (!existsSync(path.join(COPY, '.git'))) {
      if (existsSync(COPY)) finish(2, `${COPY} exists but is not a git worktree. Delete that folder and run this again.`);
      git('worktree', 'prune');
      git('worktree', 'add', '--detach', COPY, sha);
      console.log(`made the clean copy at ${COPY}`);
    }
    git('-C', COPY, 'checkout', '-q', '--detach', '--force', sha);
    git('-C', COPY, 'clean', '-fdq'); // untracked files only; node_modules, .next and Temp are ignored, so they stay
    console.log(`clean copy at ${sha.slice(0, 7)}: ${git('-C', COPY, 'log', '-1', '--format=%s')}`);

    const lockHash = createHash('sha1').update(readFileSync(path.join(COPY, 'package-lock.json'))).digest('hex');
    if (!existsSync(STAMP) || readFileSync(STAMP, 'utf8') !== lockHash) {
      console.log('package-lock.json changed since the last install (or there was none): npm ci');
      took.install = run('npm ci --prefer-offline --no-audit --no-fund');
      writeFileSync(STAMP, lockHash);
    }
    took.typegen = run('npx next typegen');
    mkdirSync(path.join(COPY, 'Temp'), { recursive: true });
  } catch (error) {
    finish(2, `COULD NOT SET UP THE CLEAN COPY: ${String(error.message).split('\n')[0]}`);
  }

  let passed = true;
  try {
    took.verify = run('npm run verify');
  } catch {
    passed = false;
  }
  const steps = `install ${took.install === undefined ? 'skipped (packages unchanged)' : `${took.install}s`}, typegen ${took.typegen}s, verify ${took.verify ?? 'failed'}${took.verify === undefined ? '' : 's'}`;
  const total = Math.round((Date.now() - started) / 1000);
  if (passed) finish(0, `CLEAN VERIFY PASSED: ${sha.slice(0, 7)} in ${total}s (${steps}). Push it from this folder.`);
  finish(1, `CLEAN VERIFY FAILED: ${sha.slice(0, 7)} after ${total}s (${steps}). Only committed code is in the copy, so a lint, typecheck, check or build failure above is in the commit, not another session's files.`);
}

// Anything that throws outside verify itself (the lock, git, the disk) is a setup failure, never "verify failed".
main().catch((error) => finish(2, `COULD NOT RUN THE CLEAN VERIFY: ${String(error && error.message).split('\n')[0]}`));
