/*
 * The PC-hosted site follows main by itself (SPEC-self-hosting.md, Stage 5; Luke: "PC rebuilds itself").
 *
 * Run every 5 minutes by the scheduled task "DebaserUpdate" (hidden). Two copies of the site live on G:
 * (G:\DEBASER-HOST\site and G:\DEBASER-HOST\site-b). services.json says which one "site" serves from. When origin/main has
 * a commit the served copy doesn't, this builds it in the OTHER copy (through heavy-step.cjs when it is there, so it takes
 * its turn with the sessions' builds), then points services.json at that copy and stops the running site; keep-running.cjs
 * starts it again from the new copy within seconds. A failed build changes nothing, is written to logs\update.log, and is
 * not retried until a newer commit arrives. One run at a time (update.lock).
 *
 * The site's settings (server keys, the Supabase address) live in G:\DEBASER-HOST\site.env and are copied into the
 * building copy as .env.production.local before each build.
 *
 *   node self-update.cjs            the normal run
 *   node self-update.cjs --force    rebuild even when the served copy is already on origin/main
 */
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync, appendFileSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const HOST = 'G:\\DEBASER-HOST';
const COPIES = [join(HOST, 'site'), join(HOST, 'site-b')];
const SERVICES = join(HOST, 'services.json');
const SETTINGS = join(HOST, 'site.env');
const LOG = join(HOST, 'logs', 'update.log');
const STATUS = join(HOST, 'logs', 'update-status.json');
const LOCK = join(HOST, 'update.lock');
const HEAVY = 'C:\\Users\\luke keating\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc\\side-session-notes\\local_27370d78-4644-44af-a1d7-9888cfb5e583\\heavy-step.cjs';
const REPO = 'https://github.com/SpookySweden/debaser.site.git';
const NPM = join(require('node:path').dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const force = process.argv.includes('--force');

const log = (text) => appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };

function run(cwd, command, args, env) {
  const r = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  appendFileSync(LOG, (r.stdout || '') + (r.stderr || ''));
  return r.status === 0;
}

function main() {
  // One run at a time; a lock older than 40 minutes is a run that died.
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 40 * 60 * 1000) return;
  writeFileSync(LOCK, String(process.pid));
  try {
    const services = readJson(SERVICES, []);
    const site = services.find((s) => s.name === 'site');
    if (!site) return log('no "site" in services.json; nothing to update');
    const served = COPIES.find((c) => c.toLowerCase() === String(site.cwd).toLowerCase()) ?? COPIES[0];
    const other = COPIES.find((c) => c !== served);

    git(served, 'fetch', '-q', 'origin', 'main');
    const target = git(served, 'rev-parse', 'origin/main');
    const current = git(served, 'rev-parse', 'HEAD');
    const status = readJson(STATUS, {});
    if (!force && target === current) return;
    if (!force && status.failed === target) return; // this commit already failed; wait for a newer one

    log(`main is ${target.slice(0, 7)}, serving ${current.slice(0, 7)} from ${served}; building in ${other}`);
    if (!existsSync(join(other, '.git'))) {
      if (!run(HOST, 'git', ['clone', '-q', '--branch', 'main', REPO, other])) throw new Error('clone failed');
    }
    git(other, 'fetch', '-q', 'origin', 'main');
    git(other, 'reset', '-q', '--hard', target); // a build copy, never edited by hand
    git(other, 'clean', '-q', '-fd', '-e', 'node_modules', '-e', '.next', '-e', '.env.production.local');

    // Packages: reinstall only when the lock file changed since the last install in this copy.
    const lockHash = createHash('sha256').update(readFileSync(join(other, 'package-lock.json'))).digest('hex');
    const stamp = join(other, 'node_modules', '.debaser-lock-hash');
    if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== lockHash) {
      log('installing packages (npm ci)');
      if (!run(other, process.execPath, [NPM, 'ci', '--no-audit', '--no-fund'], {})) throw new Error('npm ci failed');
      writeFileSync(stamp, lockHash);
    }

    copyFileSync(SETTINGS, join(other, '.env.production.local'));
    const env = { DEBASER_BUILD_COMMIT: target, DEBASER_HOST: 'pc', NEXT_TELEMETRY_DISABLED: '1' };
    const build = existsSync(HEAVY)
      ? run(other, process.execPath, [HEAVY, 'HOSTING-UPDATE', '--', process.execPath, NPM, 'run', 'build'], env)
      : run(other, process.execPath, [NPM, 'run', 'build'], env);
    if (!build) {
      writeFileSync(STATUS, JSON.stringify({ failed: target, at: new Date().toISOString(), serving: current }, null, 1));
      return log(`BUILD FAILED for ${target.slice(0, 7)}; still serving ${current.slice(0, 7)}`);
    }

    // Switch: point "site" at the new copy, then stop the running one; keep-running starts the new one.
    site.cwd = other;
    writeFileSync(SERVICES, JSON.stringify(services, null, 2) + '\n');
    spawnSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*next*start*-p*3000*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }"], { windowsHide: true });
    writeFileSync(STATUS, JSON.stringify({ serving: target, from: other, at: new Date().toISOString() }, null, 1));
    log(`switched to ${target.slice(0, 7)} (${other})`);
  } catch (error) {
    log(`UPDATE STOPPED: ${error.message}`);
  } finally {
    rmSync(LOCK, { force: true });
  }
}

main();
