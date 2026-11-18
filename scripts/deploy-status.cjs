/*
 * Waits until a pushed commit is live, and says how it went (run from the root):
 *   npm run deploy-status                  the current commit (HEAD) on debaser.site
 *   npm run deploy-status -- <sha>         another commit
 *   npm run deploy-status -- --timeout 900 seconds to wait (default 900 for debaser.site, 600 with --vercel)
 *   npm run deploy-status -- --vercel      the old check: Vercel's build of the commit (the way back, kept)
 *
 * Since 2026-11-18 the live site is debaser.site on Luke's PC (SPEC-self-hosting.md), which rebuilds itself from main
 * every 5 minutes (scripts/host/self-update.cjs). This asks https://debaser.site/api/version which commit it runs; a
 * newer commit that contains this one counts as live too. On the PC itself it also reads the self-update's status file,
 * so a failed build stops the wait at once (exit 1) instead of running out the clock.
 *
 * The --vercel way:
 * Vercel reports each build to GitHub's PUBLIC commit-status API, so this needs no login, no token and no extra tool:
 * plain Node `fetch`. (2026-11-02: a session waited on `gh api`, which is not installed on this machine; every try
 * failed, and its loop kept retrying because it only stopped on a build result. This script is the fix: the one way to
 * ask, kept in the repository, that stops loudly the moment it cannot ask.)
 *
 * Exit codes, so a caller can never mistake "could not ask" for "still building":
 *   0  live (debaser.site runs it or a newer commit / Vercel built it)
 *   1  the build failed (the PC's self-update, seen on the PC / Vercel's build)
 *   2  the commit is not on origin/main yet (nothing will build it: commit and push first)
 *   3  could not ask: 3 tries in a row failed (debaser.site down, the PC off, GitHub unreachable...)
 *   4  still building when the time ran out
 */
const { execFileSync } = require('node:child_process');

// DEPLOY_STATUS_REPO only for proving the 'could not ask' stop (a repository that does not exist answers 404).
const REPO = process.env.DEPLOY_STATUS_REPO ?? 'SpookySweden/debaser.site';
const EVERY_MS = 10_000;
const MAX_FAILURES_IN_A_ROW = 3;

const args = process.argv.slice(2);
const viaVercel = args.includes('--vercel');
const timeoutAt = args.indexOf('--timeout');
const timeoutSeconds = timeoutAt === -1 ? (viaVercel ? 600 : 900) : Number(args[timeoutAt + 1]);
const SITE_VERSION = process.env.DEPLOY_STATUS_URL ?? 'https://debaser.site/api/version';
const PC_STATUS = 'G:\\DEBASER-HOST\\logs\\update-status.json';
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
    finish(2, `NOT PUSHED: ${sha.slice(0, 7)} is not on origin/main, so nothing will build it. Commit and push first.`);
  }

  if (!viaVercel) return waitForSite(sha);

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

/** True when `served` is `sha` or a later commit that contains it. */
function contains(served, sha) {
  if (served === sha) return true;
  try {
    git('merge-base', '--is-ancestor', sha, served);
    return true;
  } catch {
    return false;
  }
}

async function waitForSite(sha) {
  const { existsSync, readFileSync } = require('node:fs');
  const deadline = Date.now() + timeoutSeconds * 1000;
  let failures = 0;
  for (;;) {
    let served = null;
    try {
      const response = await fetch(SITE_VERSION, { headers: { 'Cache-Control': 'no-cache' } });
      // 404: the running build is older than /api/version itself, so whatever it runs, it isn't this commit yet.
      if (!response.ok && response.status !== 404) throw new Error(`debaser.site answered HTTP ${response.status}`);
      served = response.ok ? (await response.json()).commit ?? null : null;
      failures = 0;
      console.log(`${new Date().toISOString().slice(11, 19)}  ${sha.slice(0, 7)}  debaser.site runs: ${served ? served.slice(0, 7) : 'unknown'}`);
      if (served && contains(served, sha)) finish(0, `LIVE: debaser.site runs ${served.slice(0, 7)}${served === sha ? '' : `, which contains ${sha.slice(0, 7)}`}.`);
    } catch (error) {
      failures += 1;
      console.log(`could not ask debaser.site (${failures}/${MAX_FAILURES_IN_A_ROW}): ${error.message}`);
      if (failures >= MAX_FAILURES_IN_A_ROW) finish(3, `COULD NOT ASK debaser.site ${MAX_FAILURES_IN_A_ROW} times in a row (is Luke's PC on?): stopping rather than waiting blind.`);
    }
    if (existsSync(PC_STATUS)) {
      try {
        const status = JSON.parse(readFileSync(PC_STATUS, 'utf8'));
        if (status.failed && contains(status.failed, sha)) finish(1, `BUILD FAILED on the PC for ${status.failed.slice(0, 7)} (still serving ${String(status.serving).slice(0, 7)}): see G:\\DEBASER-HOST\\logs\\update.log`);
      } catch { /* a status file being written is read again next round */ }
    }
    if (Date.now() + EVERY_MS > deadline) finish(4, `NOT LIVE after ${timeoutSeconds}s (debaser.site runs ${served ? served.slice(0, 7) : 'unknown'}). The PC checks main every 5 minutes, then builds for a few. Do not treat the site as updated.`);
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
}

main();
