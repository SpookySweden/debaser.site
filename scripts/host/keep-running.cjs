/*
 * Keeps the PC-hosted site's programs running (SPEC-self-hosting.md): starts each one listed in
 * G:\DEBASER-HOST\services.json, restarts it when it stops (waiting 5 s, doubling to at most 60 s while it keeps failing
 * quickly), and writes each one's output to G:\DEBASER-HOST\logs\<name>.log (moved to <name>.old.log past 10 MB).
 * Started hidden at Windows sign-in by the scheduled task "DebaserHost" (start-hidden.vbs). Only one copy runs: a second
 * one finds the guard port taken and leaves.
 *
 * services.json: [{ "name": "tunnel", "cwd": "...", "command": "C:\\...\\cloudflared.exe", "args": [...] }, ...]
 * The file is read again before each restart, so a changed command takes effect the next time that program restarts.
 *
 * It also watches Docker (the database, sign-in and files), which it does not start itself: Docker Desktop starts at
 * sign-in on its own. On 2026-11-18 Docker stopped at 18:58 UTC with nothing in its log, the PC stayed on, and
 * api.debaser.site answered 502 for three hours because nothing here looked. Now, once a minute, it asks the API
 * gateway (127.0.0.1:8000) for anything at all - a 401 without a key is an answer. After 3 misses in a row it acts:
 *   - the Docker engine answers  -> `docker compose up -d` in G:\DEBASER-HOST\supabase (starts what is stopped, no more)
 *   - the engine does not answer -> stop Docker Desktop, `wsl --shutdown`, wait 20 s, start Docker Desktop again.
 * That second recipe is the one that worked by hand that night: started on its own, Docker failed to attach its
 * disk with ERROR_NO_SYSTEM_RESOURCES until WSL had been shut down and given time to let go of it.
 * It waits 10 minutes after it starts (Docker is still coming up after sign-in), 5 after each attempt (doubling to 30 minutes while attempts keep failing), and
 * every step goes to logs\keep-running.log as "docker ...". A file named docker.paused in G:\DEBASER-HOST stops the
 * watch (for when Docker is quit on purpose); delete it to resume.
 */
const { spawn } = require('node:child_process');
const { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } = require('node:fs');
const { createServer } = require('node:net');
const { join } = require('node:path');

const HOST = 'G:\\DEBASER-HOST';
const LOGS = join(HOST, 'logs');
const LIST = join(HOST, 'services.json');
const GUARD_PORT = 38917;
const MAX_LOG = 10 * 1024 * 1024;

function log(name, text) {
  const file = join(LOGS, `${name}.log`);
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG) renameSync(file, join(LOGS, `${name}.old.log`));
    appendFileSync(file, text);
  } catch { /* a log that can't be written must not stop the program it describes */ }
}
const stamp = () => new Date().toISOString();

function services() {
  return JSON.parse(readFileSync(LIST, 'utf8'));
}

function run(name, delay = 5000) {
  const svc = services().find((s) => s.name === name);
  if (!svc) return log('keep-running', `${stamp()} ${name}: no longer listed, not restarted\n`);
  const started = Date.now();
  log('keep-running', `${stamp()} starting ${name}\n`);
  const child = spawn(svc.command, svc.args || [], { cwd: svc.cwd || HOST, env: { ...process.env, ...(svc.env || {}) }, windowsHide: true });
  child.stdout.on('data', (d) => log(name, d.toString()));
  child.stderr.on('data', (d) => log(name, d.toString()));
  child.on('error', (e) => log('keep-running', `${stamp()} ${name}: could not start: ${e.message}\n`));
  child.on('close', (code) => {
    // A planned switch (self-update.cjs leaves `<name>.switching` before stopping it) starts again at once and is not a
    // failure. Otherwise a program that ran for 10 minutes before stopping starts again quickly; one failing at once backs off.
    const planned = join(LOGS, `${name}.switching`);
    if (existsSync(planned)) {
      try { rmSync(planned, { force: true }); } catch { /* the restart matters more than the note */ }
      log('keep-running', `${stamp()} ${name} stopped for a planned switch; starting again now\n`);
      setTimeout(() => run(name, 5000), 500);
      return;
    }
    const next = Date.now() - started > 10 * 60 * 1000 ? 5000 : Math.min(delay * 2, 60000);
    log('keep-running', `${stamp()} ${name} stopped (code ${code}); restarting in ${next / 1000} s\n`);
    setTimeout(() => run(name, next), next);
  });
}

// ---- Docker watch -------------------------------------------------------------------------------------------------
const DOCKER = {
  probe: 'http://127.0.0.1:8000/auth/v1/health',
  everyMs: 60 * 1000,
  startupMs: 10 * 60 * 1000, // after Windows sign-in Docker Desktop and 11 containers come up slowly; leave them be
  graceMs: 5 * 60 * 1000,
  maxQuietMs: 30 * 60 * 1000,
  missesBeforeActing: 3,
  cli: 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  desktop: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  compose: join(HOST, 'supabase'),
  paused: join(HOST, 'docker.paused'),
};

/**
 * The watch's whole decision, with no clock or network of its own so a check can drive it.
 * state: { misses, attempts, quietUntil }; answered: did the gateway answer this minute; now: ms.
 * Returns the next state and whether to act ('recover') this minute.
 */
function decideDocker(state, answered, now) {
  if (answered) return { state: { misses: 0, attempts: 0, quietUntil: state.quietUntil }, act: null };
  if (now < state.quietUntil) return { state, act: null }; // starting up, or a recovery still settling
  const misses = state.misses + 1;
  if (misses < DOCKER.missesBeforeActing) return { state: { ...state, misses }, act: null };
  const attempts = state.attempts + 1;
  const quiet = Math.min(DOCKER.graceMs * 2 ** (attempts - 1), DOCKER.maxQuietMs);
  return { state: { misses: 0, attempts, quietUntil: now + quiet }, act: 'recover' };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Runs a program without blocking the loop (the services' output keeps being logged meanwhile).
function exec(command, args, { cwd, timeoutMs = 60 * 1000 } = {}) {
  return new Promise((done) => {
    let out = '';
    let child;
    try {
      child = spawn(command, args, { cwd: cwd || HOST, windowsHide: true });
    } catch (e) {
      return done({ code: -1, out: e.message });
    }
    const timer = setTimeout(() => { out += ' (timed out)'; child.kill(); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ code: -1, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, out: out.replace(/\0/g, '').trim() }); });
  });
}

async function gatewayAnswers() {
  try {
    const r = await fetch(DOCKER.probe, { signal: AbortSignal.timeout(10 * 1000) });
    return r.status < 500; // 401 (no key) is the gateway answering; a 502/503 is it with nothing behind it
  } catch {
    return false; // refused or timed out: nothing is listening
  }
}

async function recoverDocker() {
  const engine = await exec(DOCKER.cli, ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 30 * 1000 });
  if (engine.code === 0) {
    log('keep-running', `${stamp()} docker: engine ${engine.out} answers; starting the stopped containers\n`);
    const up = await exec(DOCKER.cli, ['compose', 'up', '-d'], { cwd: DOCKER.compose, timeoutMs: 5 * 60 * 1000 });
    return log('keep-running', `${stamp()} docker: compose up -d exited ${up.code}\n`);
  }
  log('keep-running', `${stamp()} docker: engine not answering; restarting Docker Desktop (WSL shut down first)\n`);
  for (const image of ['Docker Desktop.exe', 'com.docker.backend.exe', 'com.docker.build.exe']) {
    await exec('taskkill', ['/IM', image, '/T', '/F'], { timeoutMs: 30 * 1000 });
  }
  await sleep(3000);
  const wsl = await exec('wsl.exe', ['--shutdown'], { timeoutMs: 2 * 60 * 1000 });
  log('keep-running', `${stamp()} docker: wsl --shutdown exited ${wsl.code}\n`);
  await sleep(20 * 1000);
  try {
    spawn(DOCKER.desktop, [], { detached: true, stdio: 'ignore' }).unref();
    log('keep-running', `${stamp()} docker: Docker Desktop started; checking again in ${DOCKER.graceMs / 60000} min or more\n`);
  } catch (e) {
    log('keep-running', `${stamp()} docker: could not start Docker Desktop: ${e.message}\n`);
  }
}

function watchDocker() {
  let state = { misses: 0, attempts: 0, quietUntil: Date.now() + DOCKER.startupMs };
  let wasDown = false;
  let pausedSaid = false;
  const tick = async () => {
    try {
      if (existsSync(DOCKER.paused)) {
        if (!pausedSaid) log('keep-running', `${stamp()} docker: watch paused (docker.paused is there)\n`);
        pausedSaid = true;
        return;
      }
      if (pausedSaid) log('keep-running', `${stamp()} docker: watch resumed\n`);
      pausedSaid = false;
      const answered = await gatewayAnswers();
      if (answered && wasDown) log('keep-running', `${stamp()} docker: the API answers again\n`);
      if (!answered && !wasDown) log('keep-running', `${stamp()} docker: the API at ${DOCKER.probe} does not answer\n`);
      wasDown = !answered;
      const next = decideDocker(state, answered, Date.now());
      state = next.state;
      if (next.act === 'recover') {
        log('keep-running', `${stamp()} docker: down for ${DOCKER.missesBeforeActing} checks in a row; attempt ${state.attempts}\n`);
        await recoverDocker();
      }
    } catch (e) {
      log('keep-running', `${stamp()} docker: watch error: ${e.message}\n`);
    } finally {
      setTimeout(tick, DOCKER.everyMs);
    }
  };
  setTimeout(tick, DOCKER.everyMs);
}

module.exports = { decideDocker, DOCKER };

// Only when run as the program (start-hidden.vbs), never when a check loads decideDocker.
if (require.main === module) {
  const guard = createServer();
  guard.once('error', () => process.exit(0)); // already running
  guard.listen(GUARD_PORT, '127.0.0.1', () => {
    log('keep-running', `${stamp()} keep-running started\n`);
    for (const s of services()) run(s.name);
    watchDocker();
  });
}
