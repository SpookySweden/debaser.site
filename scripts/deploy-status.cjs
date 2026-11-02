/*
 * Waits for Vercel to finish building a pushed commit, and says how it went (run from the root):
 *   npm run deploy-status                  the current commit (HEAD)
 *   npm run deploy-status -- <sha>         another commit
 *   npm run deploy-status -- --timeout 600 seconds to wait (default 600)
 *
 * Vercel reports each build to GitHub's PUBLIC commit-status API, so this needs no login, no token and no extra tool:
 * plain Node `fetch`. (2026-11-02: a session waited on `gh api`, which is not installed on this machine; every try
 * failed, and its loop kept retrying because it only stopped on a build result. This script is the fix: the one way to
 * ask, kept in the repository, that stops loudly the moment it cannot ask.)
 *
 * Exit codes, so a caller can never mistake "could not ask" for "still building":
 *   0  Vercel built it (success)
 *   1  Vercel's build failed (failure / error)
 *   2  the commit is not on origin/main yet (nothing will build it: commit and push first)
 *   3  GitHub could not be asked: 3 tries in a row failed (offline, rate-limited, wrong repository...)
 *   4  still building when the time ran out
 */
const { execFileSync } = require('node:child_process');

// DEPLOY_STATUS_REPO only for proving the 'could not ask' stop (a repository that does not exist answers 404).
const REPO = process.env.DEPLOY_STATUS_REPO ?? 'SpookySweden/debaser.site';
const EVERY_MS = 10_000;
const MAX_FAILURES_IN_A_ROW = 3;

const args = process.argv.slice(2);
const timeoutAt = args.indexOf('--timeout');
const timeoutSeconds = timeoutAt === -1 ? 600 : Number(args[timeoutAt + 1]);
const shaArg = args.find((arg, index) => !arg.startsWith('--') && (timeoutAt === -1 || index !== timeoutAt + 1));

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

async function main() {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) finish(3, 'BAD --timeout: give a number of seconds.');
  let sha;
  try {
    sha = git('rev-parse', shaArg ?? 'HEAD');
    git('fetch', '-q', 'origin', 'main');
  } catch (error) {
    finish(3, `COULD NOT READ GIT: ${String(error.message).split('\n')[0]}`);
  }
  try {
    git('merge-base', '--is-ancestor', sha, 'origin/main');
  } catch {
    finish(2, `NOT PUSHED: ${sha.slice(0, 7)} is not on origin/main, so Vercel will not build it. Commit and push first.`);
  }

  const url = `https://api.github.com/repos/${REPO}/commits/${sha}/status`;
  const deadline = Date.now() + timeoutSeconds * 1000;
  let failures = 0;
  for (;;) {
    let state = null;
    try {
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'debaser-deploy-status' } });
      if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
      const body = await response.json();
      const vercel = (Array.isArray(body.statuses) ? body.statuses : []).find((status) => status.context === 'Vercel');
      state = vercel ? vercel.state : 'not reported yet';
      failures = 0;
      console.log(`${new Date().toISOString().slice(11, 19)}  ${sha.slice(0, 7)}  Vercel: ${state}`);
      if (state === 'success') finish(0, `LIVE: Vercel built ${sha.slice(0, 7)} (${vercel.updated_at}).`);
      if (state === 'failure' || state === 'error') finish(1, `BUILD FAILED on Vercel for ${sha.slice(0, 7)}: ${vercel.target_url ?? 'see the Vercel dashboard'}`);
    } catch (error) {
      failures += 1;
      console.log(`could not ask GitHub (${failures}/${MAX_FAILURES_IN_A_ROW}): ${error.message}`);
      if (failures >= MAX_FAILURES_IN_A_ROW) finish(3, `COULD NOT ASK GITHUB ${MAX_FAILURES_IN_A_ROW} times in a row: stopping rather than waiting blind.`);
    }
    if (Date.now() + EVERY_MS > deadline) finish(4, `STILL BUILDING after ${timeoutSeconds}s (last: ${state ?? 'no answer'}). Do not treat the site as updated.`);
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
}

main();
