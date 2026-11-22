#!/usr/bin/env node
/*
 * SCREENS on the PC that hosts the site (SPEC-screens.md): switching it on, off, and saying where it stands.
 *
 * The site carries the feature for everyone but shows it to nobody until this PC names an owner and runs the screen
 * engine. This is the one step that does both, and the one step that undoes both. Luke runs it; nothing else does.
 *
 *   node scripts/host/screens.cjs status
 *   node scripts/host/screens.cjs on --owner <account id>      [--lan] [--site-elsewhere]
 *   node scripts/host/screens.cjs off
 *
 * ON does five things, and says each as it does it:
 *   1. writes SCREENS_OWNER_ID=<account id> into the site's settings (G:\DEBASER-HOST\site.env, which every new
 *      build copies) and into the build being served now. No other line is read out, changed or printed.
 *   2. copies the engine (engine\target\release\debaser-engine.exe from this copy of the repository; built first with
 *      `cargo build --release` when it is not there) to G:\DEBASER-HOST\engine\.
 *   3. lists it in services.json as "engine" (`serve --allow-control`), so it starts with the PC from now on.
 *   4. starts it now (keep-running only starts what was listed when it itself started).
 *   5. restarts the site the way an update does (a few seconds' blip), so it reads the new setting.
 *
 * Without --lan the engine can be reached only from a browser ON THIS PC: its web address and its video both stay on
 * 127.0.0.1. With --lan the video (never the web address) is also offered on the home network, which is what a
 * laptop needs; the first time, Windows asks whether to let it through its firewall, and that answer is Luke's.
 *
 * OFF takes the owner line out of both settings files, takes "engine" off the list, stops the engine and restarts
 * the site. The engine's file is left where it is.
 *
 * For proving it without touching the real host: --host <folder> points it at a pretend host folder, and
 * --no-start / --no-restart skip steps 4 and 5.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const args = process.argv.slice(2);
const verb = args[0];
const has = (flag) => args.includes(flag);
const value = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };

const REPO = resolve(__dirname, '..', '..');
const HOST = resolve(value('--host') || 'G:\\DEBASER-HOST');
const SETTINGS = join(HOST, 'site.env');
const SERVICES = join(HOST, 'services.json');
const LOGS = join(HOST, 'logs');
const ENGINE_HOME = join(HOST, 'engine');
const ENGINE = join(ENGINE_HOME, 'debaser-engine.exe');
const BUILT = join(REPO, 'engine', 'target', 'release', 'debaser-engine.exe');
const OWNER_LINE = 'SCREENS_OWNER_ID';
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const say = (text) => console.log(text);
function stop(text) { console.error(text); process.exit(1); }

function matchRunning() {
  try { return /League of Legends\.exe/i.test(execFileSync('tasklist', [], { encoding: 'utf8' })); } catch { return false; }
}

/** The settings file with the owner's line set, or taken out (id null). Every other line is kept as it was. */
function withOwner(text, id) {
  const lines = text.split(/\r?\n/).filter((line) => !line.startsWith(`${OWNER_LINE}=`));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (id !== null) lines.push(`${OWNER_LINE}=${id}`);
  return `${lines.join('\n')}\n`;
}

/** Whether a settings file names an owner. Says yes or no and nothing else about the file. */
function namesOwner(file) {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${OWNER_LINE}=`));
  return line ? line.slice(OWNER_LINE.length + 1).trim() : '';
}

function services() { return JSON.parse(readFileSync(SERVICES, 'utf8')); }
function saveServices(list) { writeFileSync(SERVICES, `${JSON.stringify(list, null, 2)}\n`); }

/** The copy of the site being served now (services.json says which), where the running build reads its settings. */
function servedSettings() {
  const site = services().find((s) => s.name === 'site');
  return site && site.cwd ? join(site.cwd, '.env.production.local') : null;
}

function engineProcesses() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name = 'debaser-engine.exe'" | Where-Object { $_.ExecutablePath -eq '${ENGINE.replace(/'/g, "''")}' } | ForEach-Object { $_.ProcessId }`],
  { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').split(/\s+/).filter((t) => /^\d+$/.test(t)).map(Number);
}

/** Stops the engine and waits until Windows has really let go of it (its file cannot be replaced before that). */
function stopEngine() {
  const running = engineProcesses();
  for (const pid of running) { try { process.kill(pid); } catch { /* already gone */ } }
  for (let tries = 0; running.length > 0 && tries < 20 && engineProcesses().length > 0; tries += 1) {
    spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300'], { windowsHide: true });
  }
  return running.length;
}

/** Copies the engine's program into the host folder, trying again for a few seconds while Windows still holds the old one. */
function copyEngine() {
  for (let tries = 0; ; tries += 1) {
    try { copyFileSync(BUILT, ENGINE); return; } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
      if (tries >= 20) throw error;
      spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300'], { windowsHide: true });
    }
  }
}

/**
 * Starts the engine through Windows itself (its process-creating service), not as a child of whatever ran this
 * script. A child dies with its parent: the engine started the plain way on 2026-11-21 was gone a few hours later,
 * when the session that had started it ended. Started this way it belongs to nobody and runs until it is stopped or
 * the PC restarts (when keep-running starts it from the list).
 */
function startEngine(lan, key = null) {
  if (!existsSync(LOGS)) mkdirSync(LOGS, { recursive: true });
  const log = join(LOGS, 'engine.log');
  const line = `cmd.exe /d /c ""${ENGINE}" ${engineArgs(lan, key).join(' ')} >> "${log}" 2>&1"`;
  const quoted = (text) => `'${text.replace(/'/g, "''")}'`;
  const made = spawnSync('powershell', ['-NoProfile', '-Command',
    `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quoted(line)}; CurrentDirectory = ${quoted(ENGINE_HOME)} }).ReturnValue`],
  { encoding: 'utf8', windowsHide: true });
  if ((made.stdout || '').trim() !== '0') return `not started: Windows answered "${(made.stdout || made.stderr || '').trim()}"`;
  for (let tries = 0; tries < 20; tries += 1) {
    const running = engineProcesses();
    if (running.length > 0) return running[0];
    spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300'], { windowsHide: true });
  }
  return 'asked of Windows, but not seen running after six seconds: see logs\\engine.log';
}

// --allow-fit: the room's FIT THE PC TO THIS SCREEN switch is offered (off until a viewer turns it on; Luke, 2026-11-21).
// --site-elsewhere (2026-11-22: the site moved to SERVER, the engine stayed on the gaming PC): the engine also listens
// on the home network, demanding its key (`--listen 0.0.0.0 --token <key>`), so the site on SERVER can pass the hello on.
const engineArgs = (lan, key = null) => [
  'serve', '--allow-control', '--allow-fit',
  ...(lan || key ? ['--lan'] : []),
  ...(key ? ['--listen', '0.0.0.0', '--token', key, '--internet'] : []),
];

/**
 * The engine's key when the site lives on another machine. Not made up here and sent across: both machines already
 * hold SCREENS_RDP_SECRET (SERVER's settings were copied from this PC), so each works out the same key from it and
 * nothing secret travels. SERVER's site.env gets SCREENS_ENGINE_TOKEN = this same value, worked out there the same way:
 *   HMAC-SHA256(SCREENS_RDP_SECRET, "debaser-engine-key"), base64url.
 */
function engineKeyFrom(settingsText) {
  const line = settingsText.split(/\r?\n/).find((l) => l.startsWith('SCREENS_RDP_SECRET='));
  const secret = line ? line.slice('SCREENS_RDP_SECRET='.length).trim() : '';
  if (secret.length < 32) return null;
  return require('node:crypto').createHmac('sha256', secret).update('debaser-engine-key').digest('base64url');
}

/** This PC's home-network IPv4 address (Wi-Fi or Ethernet), for SERVER's SCREENS_ENGINE_URL. */
function homeAddress() {
  const found = [];
  for (const list of Object.values(require('node:os').networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) found.push(a.address);
  }
  return found.find((a) => a.startsWith('192.168.')) || found[0] || null;
}

/** Stops the site the way an update does: keep-running sees the note and starts it again at once. */
function restartSite() {
  // Exactly what self-update.cjs does at a switch: the note first, then the site's own program and its children.
  const find = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*next*start*-p*3000*' }";
  const found = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(${find}).Count`], { encoding: 'utf8', windowsHide: true });
  if (!(Number((found.stdout || '').trim()) > 0)) return 'the site\'s program was not found running, so it was not restarted: it reads the setting at its next start';
  if (!existsSync(LOGS)) mkdirSync(LOGS, { recursive: true });
  writeFileSync(join(LOGS, 'site.switching'), 'screens.cjs\n');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `${find} | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`], { windowsHide: true });
  return 'the site was restarted the way an update restarts it (a few seconds\' blip)';
}

function status() {
  const owner = namesOwner(SETTINGS);
  const served = existsSync(SERVICES) ? servedSettings() : null;
  const listed = existsSync(SERVICES) ? services().find((s) => s.name === 'engine') : null;
  say(`host folder                         ${HOST}`);
  say(`owner named in the site's settings   ${owner === null ? 'no settings file' : owner === '' ? 'no' : `yes (${owner})`}`);
  say(`owner named in the build being served ${served === null ? 'unknown' : namesOwner(served) ? 'yes' : 'no'}`);
  say(`engine program in the host folder     ${existsSync(ENGINE) ? 'yes' : 'no'}`);
  say(`engine listed to start with the PC    ${listed ? `yes (${(listed.args || []).join(' ').replace(/--token \S+/, '--token <key>')})` : 'no'}`);
  say(`engine running now                    ${engineProcesses().length > 0 ? 'yes' : 'no'}`);
}

function on() {
  const owner = value('--owner');
  if (!owner || !ACCOUNT_ID.test(owner)) stop('ON needs the owner\'s account id: node scripts/host/screens.cjs on --owner <the long code with four dashes>');
  if (!existsSync(SETTINGS) || !existsSync(SERVICES)) stop(`No host found at ${HOST} (site.env and services.json are expected there).`);
  const lan = has('--lan');
  const elsewhere = has('--site-elsewhere');
  const key = elsewhere ? engineKeyFrom(readFileSync(SETTINGS, 'utf8')) : null;
  if (elsewhere && key === null) stop("--site-elsewhere works the engine's key out from SCREENS_RDP_SECRET in site.env, and there is none: run scripts/host/server-remote.cjs on first.");

  // 1. The owner, in the settings every build copies and in the build being served now.
  writeFileSync(SETTINGS, withOwner(readFileSync(SETTINGS, 'utf8'), owner));
  const served = servedSettings();
  if (served && existsSync(served)) writeFileSync(served, withOwner(readFileSync(served, 'utf8'), owner));
  say(`1. owner named: ${owner}${served && existsSync(served) ? ' (in the settings and in the build being served)' : ' (in the settings; the build being served was not found)'}`);

  // 2. The engine's program, into the host folder.
  if (!existsSync(BUILT)) {
    if (matchRunning()) stop('The engine is not built yet and a League match is running: building now would make the match stutter. Run this again after the match.');
    say('   the engine is not built in this copy of the repository: building it (a few minutes)');
    const built = spawnSync('cargo', ['build', '--release', '-j', '4'], { cwd: join(REPO, 'engine'), stdio: 'inherit', shell: true });
    if (built.status !== 0 || !existsSync(BUILT)) stop('The engine did not build; nothing further was done. The owner line is written: run "off" to take it out.');
  }
  const wasRunning = stopEngine();
  if (!existsSync(ENGINE_HOME)) mkdirSync(ENGINE_HOME, { recursive: true });
  copyEngine();
  say(`2. engine copied to ${ENGINE}${wasRunning ? ' (the one that was running was stopped first)' : ''}`);

  // 3. Listed, so it starts with the PC.
  const list = services().filter((s) => s.name !== 'engine');
  list.push({ name: 'engine', cwd: ENGINE_HOME, command: ENGINE, args: engineArgs(lan, key) });
  saveServices(list);
  say(`3. listed to start with the PC: ${engineArgs(lan, key).join(' ').replace(/--token \S+/, '--token <key>')}`);

  // 4. Started now.
  if (has('--no-start')) say('4. not started (--no-start)');
  else say(`4. engine started (process ${startEngine(lan, key)})${lan || key ? '. Windows may now ask about its firewall: allow it on PRIVATE networks only.' : ''}`);

  // 5. The site, so it reads the owner (not when it lives on another machine).
  if (elsewhere) {
    const at = homeAddress();
    say('5. the site lives on another machine: nothing restarted here. On that machine, its site.env needs:');
    say(`     SCREENS_ENGINE_URL=http://${at ?? "<this PC's home-network address>"}:8478`);
    say('     SCREENS_ENGINE_TOKEN=<worked out there from its own SCREENS_RDP_SECRET: HMAC-SHA256(secret, "debaser-engine-key"), base64url>');
    say('   (not printed here; both machines hold the same secret, so the key never travels)');
    return;
  }
  if (has('--no-restart')) say('5. site not restarted (--no-restart)');
  else say(`5. ${restartSite()}`);

  say('');
  say(lan
    ? 'ON. Sign in on the site as that account, open any room, and press [ SCREEN ]: on this PC, or on a device on the home network.'
    : 'ON, for a browser on this PC only. Sign in on the site as that account, open any room, and press [ SCREEN ]. For the laptop, run this again with --lan.');
}

function off() {
  if (!existsSync(SETTINGS) || !existsSync(SERVICES)) stop(`No host found at ${HOST} (site.env and services.json are expected there).`);
  writeFileSync(SETTINGS, withOwner(readFileSync(SETTINGS, 'utf8'), null));
  const served = servedSettings();
  if (served && existsSync(served)) writeFileSync(served, withOwner(readFileSync(served, 'utf8'), null));
  say('1. owner line taken out of the settings and the build being served');
  saveServices(services().filter((s) => s.name !== 'engine'));
  say('2. engine taken off the list of what starts with the PC');
  say(`3. engine stopped (${stopEngine()} running)`);
  if (has('--no-restart')) say('4. site not restarted (--no-restart)');
  else say(`4. ${restartSite()}`);
  say('');
  say('OFF. Nobody sees [ SCREEN ]; the site answers "not available" to everyone.');
}

// Only when run as the program, never when a check loads `withOwner`.
if (require.main === module) {
  if (verb === 'status') status();
  else if (verb === 'on') on();
  else if (verb === 'off') off();
  else stop('node scripts/host/screens.cjs status | on --owner <account id> [--lan] | off');
}

module.exports = { withOwner, engineKeyFrom, engineArgs };
