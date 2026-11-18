/*
 * Keeps the PC-hosted site's programs running (SPEC-self-hosting.md): starts each one listed in
 * G:\DEBASER-HOST\services.json, restarts it when it stops (waiting 5 s, doubling to at most 60 s while it keeps failing
 * quickly), and writes each one's output to G:\DEBASER-HOST\logs\<name>.log (moved to <name>.old.log past 10 MB).
 * Started hidden at Windows sign-in by the scheduled task "DebaserHost" (start-hidden.vbs). Only one copy runs: a second
 * one finds the guard port taken and leaves.
 *
 * services.json: [{ "name": "tunnel", "cwd": "...", "command": "C:\\...\\cloudflared.exe", "args": [...] }, ...]
 * The file is read again before each restart, so a changed command takes effect the next time that program restarts.
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

const guard = createServer();
guard.once('error', () => process.exit(0)); // already running
guard.listen(GUARD_PORT, '127.0.0.1', () => {
  log('keep-running', `${stamp()} keep-running started\n`);
  for (const s of services()) run(s.name);
});
