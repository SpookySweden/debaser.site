#!/usr/bin/env node
/*
 * SCREENS, the server by Windows Remote Desktop, on the PC that hosts the site (SPEC-screens.md, "The server: Remote
 * Desktop"; Luke, 2026-11-21). Switching it on, off, and saying where it stands.
 *
 *   node scripts/host/server-remote.cjs status
 *   node scripts/host/server-remote.cjs on
 *   node scripts/host/server-remote.cjs off
 *
 * ON (Luke's OK, 2026-11-21: the settings file he fills, and one route on the tunnel) does six things, saying each:
 *   1. makes the secret the site and the gateway share (or keeps the one already made) and writes it into the site's
 *      settings (site.env, which every build copies), the build being served now, and the gateway's settings
 *      (rdp.env). It is never printed.
 *   2. makes rdp.env when there is none: the four lines Luke fills in himself (the server's address and a Windows
 *      sign-in). This script never reads those lines back, and never prints them.
 *   3. copies the gateway (scripts/host/rdp-gateway.cjs) to G:\DEBASER-HOST\rdp-gateway\ and lists it in
 *      services.json as "rdp-gateway", so it starts with the PC.
 *   4. starts it now, through Windows itself (as screens.cjs starts the engine), so it outlives whatever ran this.
 *   5. adds the one tunnel route, debaser.site/api/screens/rdp-socket and rdp-door -> the gateway (127.0.0.1:8479),
 *      above the site's own line, and restarts the tunnel the way an update does (a few seconds' blip).
 *   6. restarts the site so it reads the secret.
 * guacd (Guacamole's translator) runs in Docker as "debaser-guacd", started with the PC by Docker itself.
 * The server remote itself stays SWITCHED OFF until Luke switches it on under [ REMOTE ] (its own switch, kept by the
 * gateway in rdp-switch.json); and over the internet it opens only once the extra lock (Cloudflare Access) is set up.
 *
 * OFF takes the secret out of the site's settings, the route out of the tunnel, and the gateway off the list, and
 * stops it. rdp.env is left as it is (it is Luke's), and so is guacd.
 *
 * For proving it without touching the real host: --host <folder> points it at a pretend host folder, and
 * --no-start / --no-restart skip the starting and restarting.
 */
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const args = process.argv.slice(2);
const verb = args[0];
const has = (flag) => args.includes(flag);
const value = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };

const HOST = resolve(value('--host') || 'G:\\DEBASER-HOST');
const SETTINGS = join(HOST, 'site.env');
const SERVICES = join(HOST, 'services.json');
const LOGS = join(HOST, 'logs');
const RDP_SETTINGS = join(HOST, 'rdp.env');
const GATEWAY_HOME = join(HOST, 'rdp-gateway');
const GATEWAY = join(GATEWAY_HOME, 'rdp-gateway.cjs');
const TUNNEL_CONFIG = join(HOST, 'cloudflared', 'config.yml');
const SECRET_LINE = 'SCREENS_RDP_SECRET';
const ROUTE_MARK = '# SCREENS: the server by Remote Desktop';
const ROUTE = [
  `  ${ROUTE_MARK} (scripts/host/server-remote.cjs). Only its websocket and its unlocking page, to the gateway on this PC.`,
  '  - hostname: debaser.site',
  '    path: ^/api/screens/rdp-(socket|door)$',
  '    service: http://127.0.0.1:8479',
];

const say = (text) => console.log(text);
function stop(text) { console.error(text); process.exit(1); }

/** A settings file with one line set (or taken out, value null). Every other line is kept as it was. */
function withLine(text, name, line) {
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith(`${name}=`));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (line !== null) lines.push(`${name}=${line}`);
  return `${lines.join('\n')}\n`;
}

/** The secret already made, so turning it on twice keeps passes in step; read from site.env only. */
function secretNow() {
  if (!existsSync(SETTINGS)) return null;
  const line = readFileSync(SETTINGS, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${SECRET_LINE}=`));
  const secret = line ? line.slice(SECRET_LINE.length + 1).trim() : '';
  return secret.length >= 32 ? secret : null;
}

const RDP_TEMPLATE = `# The server's Remote Desktop, for SCREENS (SPEC-screens.md). Read by the gateway on this PC
# (rdp-gateway\\rdp-gateway.cjs) and nothing else; the site and the browser never see these lines.
# Fill in the lines below yourself and save. No restart needed: the gateway reads this file on every connection.
#
# RDP_HOST: the server's address on the home network: its computer name, or its number (like 192.168.1.50).
RDP_HOST=
# RDP_USER and RDP_PASSWORD: a Windows account on the server that may use Remote Desktop.
# (For a Microsoft account, the email address and that account's password.)
RDP_USER=
RDP_PASSWORD=
# RDP_DOMAIN: leave empty unless the server is in a work domain.
RDP_DOMAIN=
# Optional, each on its own line:
#   RDP_KEYBOARD=sv-se-qwerty   the server's keyboard layout, when it is not US English (or failsafe: any layout)
#   RDP_SOUND=on                the server's sound in the browser
#   RDP_PORT=3389               only if Remote Desktop listens on another port
#   RDP_SECURITY=any            or nla, tls, rdp, when the server insists on one
#
# The extra lock (Cloudflare Access, a one-time code sent to your email), from the Zero Trust dashboard. Until both are
# filled in, the server is never opened over the internet:
# RDP_ACCESS_TEAM: your team name (the part before .cloudflareaccess.com)
RDP_ACCESS_TEAM=
# RDP_ACCESS_AUD: the application's "Application Audience (AUD) Tag"
RDP_ACCESS_AUD=
#
# Made by scripts/host/server-remote.cjs; this line keeps the gateway and the site in step. Leave it be.
`;

/** The tunnel's settings with the route added above the site's own line, or taken out (on false). */
function withRoute(text, on) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(ROUTE_MARK)) {
      i += ROUTE.length - 1;
      continue;
    }
    kept.push(lines[i]);
  }
  if (!on) return kept.join('\n');
  const site = kept.findIndex((l, i) => /^\s*-\s*hostname:\s*debaser\.site\s*$/.test(l) && /^\s*service:\s*http:\/\/127\.0\.0\.1:3000\s*$/.test(kept[i + 1] ?? ''));
  if (site < 0) return null;
  // Above the comment that heads the site's line, when there is one.
  const at = site > 0 && /^\s*#/.test(kept[site - 1]) ? site - 1 : site;
  kept.splice(at, 0, ...ROUTE);
  return kept.join('\n');
}

function services() { return JSON.parse(readFileSync(SERVICES, 'utf8')); }
function saveServices(list) { writeFileSync(SERVICES, `${JSON.stringify(list, null, 2)}\n`); }
function servedSettings() {
  const site = services().find((s) => s.name === 'site');
  return site && site.cwd ? join(site.cwd, '.env.production.local') : null;
}
function nodePath() {
  const site = services().find((s) => s.name === 'site');
  return site && site.command ? site.command : process.execPath;
}

const ps = (command) => spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true });
const pause = (ms) => ps(`Start-Sleep -Milliseconds ${ms}`);

function gatewayProcesses() {
  const r = ps(`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*${GATEWAY.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`);
  return (r.stdout || '').split(/\s+/).filter((t) => /^\d+$/.test(t)).map(Number);
}

function stopGateway() {
  const running = gatewayProcesses();
  for (const pid of running) { try { process.kill(pid); } catch { /* gone */ } }
  for (let tries = 0; running.length > 0 && tries < 20 && gatewayProcesses().length > 0; tries += 1) pause(300);
  return running.length;
}

function startGateway() {
  if (!existsSync(LOGS)) mkdirSync(LOGS, { recursive: true });
  const line = `cmd.exe /d /c ""${nodePath()}" "${GATEWAY}" >> "${join(LOGS, 'rdp-gateway.log')}" 2>&1"`;
  const quoted = (text) => `'${text.replace(/'/g, "''")}'`;
  const made = ps(`(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quoted(line)}; CurrentDirectory = ${quoted(GATEWAY_HOME)} }).ReturnValue`);
  if ((made.stdout || '').trim() !== '0') return `not started: Windows answered "${(made.stdout || made.stderr || '').trim()}"`;
  for (let tries = 0; tries < 20; tries += 1) {
    const running = gatewayProcesses();
    if (running.length > 0) return `process ${running[0]}`;
    pause(300);
  }
  return 'asked of Windows, but not seen running after six seconds: see logs\\rdp-gateway.log';
}

/** Stops a listed program with a planned-switch note, so keep-running starts it again at once with its settings. */
function restartListed(name, find) {
  const found = ps(`@(${find}).Count`);
  if (!(Number((found.stdout || '').trim()) > 0)) return `${name} was not found running, so it was not restarted: it reads the change at its next start`;
  if (!existsSync(LOGS)) mkdirSync(LOGS, { recursive: true });
  writeFileSync(join(LOGS, `${name}.switching`), 'server-remote.cjs\n');
  ps(`${find} | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`);
  return `${name} restarted the way an update restarts it (a few seconds' blip)`;
}
const restartSite = () => restartListed('site', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*next*start*-p*3000*' }");
const restartTunnel = () => restartListed('tunnel', "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -like '*DEBASER-HOST*config.yml*' }");

async function health() {
  try {
    const response = await fetch('http://127.0.0.1:8479/health', { signal: AbortSignal.timeout(2000) });
    return await response.json();
  } catch {
    return null;
  }
}

function guacd() {
  const r = spawnSync('docker', ['ps', '--filter', 'name=debaser-guacd', '--format', '{{.Status}}'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').trim() || 'not running';
}

async function status() {
  const said = await health();
  const route = existsSync(TUNNEL_CONFIG) && readFileSync(TUNNEL_CONFIG, 'utf8').includes(ROUTE_MARK);
  const served = existsSync(SERVICES) ? servedSettings() : null;
  say(`host folder                              ${HOST}`);
  say(`secret in the site's settings            ${secretNow() ? 'yes' : 'no'}`);
  say(`secret in the build being served         ${served && existsSync(served) && readFileSync(served, 'utf8').includes(`${SECRET_LINE}=`) ? 'yes' : 'no'}`);
  say(`rdp.env                                  ${existsSync(RDP_SETTINGS) ? 'there' : 'not made yet'}`);
  say(`the server's address filled in           ${said ? (said.serverSet ? 'yes' : 'no: fill in rdp.env') : 'unknown (the gateway is not answering)'}`);
  say(`gateway listed to start with the PC      ${existsSync(SERVICES) && services().some((s) => s.name === 'rdp-gateway') ? 'yes' : 'no'}`);
  say(`gateway answering now                    ${said && said.ok ? 'yes' : 'no'}`);
  say(`server remote switched on               ${said ? (said.on ? 'yes' : 'no (switched under [ REMOTE ])') : 'unknown'}`);
  say(`extra lock (Cloudflare Access) set up    ${said ? (said.locked ? 'yes' : 'no: RDP_ACCESS_TEAM and RDP_ACCESS_AUD in rdp.env') : 'unknown'}`);
  say(`tunnel route                           ${route ? 'yes' : 'no'}`);
  say(`guacd (Docker)                           ${guacd()}`);
}

async function on() {
  if (!existsSync(SETTINGS) || !existsSync(SERVICES) || !existsSync(TUNNEL_CONFIG)) stop(`No host found at ${HOST} (site.env, services.json and cloudflared\\config.yml are expected there).`);
  const tunnelText = readFileSync(TUNNEL_CONFIG, 'utf8');
  const routed = withRoute(tunnelText, true);
  if (routed === null) stop("The tunnel's settings have no plain debaser.site -> 127.0.0.1:3000 line to put the route above; nothing was changed.");

  // 1. The shared secret, never printed.
  const secret = secretNow() || crypto.randomBytes(32).toString('hex');
  writeFileSync(SETTINGS, withLine(readFileSync(SETTINGS, 'utf8'), SECRET_LINE, secret));
  const served = servedSettings();
  if (served && existsSync(served)) writeFileSync(served, withLine(readFileSync(served, 'utf8'), SECRET_LINE, secret));
  // 2. rdp.env: made when missing; otherwise only its secret line is set, every other line left as Luke wrote it.
  const made = !existsSync(RDP_SETTINGS);
  writeFileSync(RDP_SETTINGS, withLine(made ? RDP_TEMPLATE : readFileSync(RDP_SETTINGS, 'utf8'), SECRET_LINE, secret));
  say(`1. the shared secret is in the site's settings${served && existsSync(served) ? ', the build being served' : ''} and rdp.env (not shown)`);
  say(`2. ${made ? `made ${RDP_SETTINGS}: the server's address and a Windows sign-in go in there, typed by you` : `${RDP_SETTINGS} kept as it was (its secret line set)`}`);

  // 3. The gateway, copied and listed.
  const was = stopGateway();
  if (!existsSync(GATEWAY_HOME)) mkdirSync(GATEWAY_HOME, { recursive: true });
  copyFileSync(join(__dirname, 'rdp-gateway.cjs'), GATEWAY);
  const list = services().filter((s) => s.name !== 'rdp-gateway');
  list.push({ name: 'rdp-gateway', cwd: GATEWAY_HOME, command: nodePath(), args: [GATEWAY] });
  saveServices(list);
  say(`3. gateway copied to ${GATEWAY} and listed to start with the PC${was ? ' (the one running was stopped first)' : ''}`);

  // 4. Started now.
  say(has('--no-start') ? '4. not started (--no-start)' : `4. gateway started (${startGateway()})`);

  // 5. The tunnel route.
  if (routed !== tunnelText) {
    writeFileSync(TUNNEL_CONFIG, routed);
    say(`5. tunnel route added (debaser.site/api/screens/rdp-socket and rdp-door -> 127.0.0.1:8479); ${has('--no-restart') ? 'tunnel not restarted (--no-restart)' : restartTunnel()}`);
  } else {
    say('5. tunnel route already there');
  }

  // 6. The site, so it reads the secret.
  say(has('--no-restart') ? '6. site not restarted (--no-restart)' : `6. ${restartSite()}`);
  say('');
  say(`guacd: ${guacd()}`);
  say('ON (the server remote itself still switched OFF). Fill in rdp.env, set up the extra lock, then under [ REMOTE ] switch the server remote on and choose THE SERVER.');
}

function off() {
  if (!existsSync(SETTINGS) || !existsSync(SERVICES)) stop(`No host found at ${HOST}.`);
  writeFileSync(SETTINGS, withLine(readFileSync(SETTINGS, 'utf8'), SECRET_LINE, null));
  const served = servedSettings();
  if (served && existsSync(served)) writeFileSync(served, withLine(readFileSync(served, 'utf8'), SECRET_LINE, null));
  say("1. secret taken out of the site's settings and the build being served");
  saveServices(services().filter((s) => s.name !== 'rdp-gateway'));
  say(`2. gateway off the list and stopped (${stopGateway()} running)`);
  if (existsSync(TUNNEL_CONFIG)) {
    const text = readFileSync(TUNNEL_CONFIG, 'utf8');
    const without = withRoute(text, false);
    if (without !== text) {
      writeFileSync(TUNNEL_CONFIG, without);
      say(`3. tunnel route taken out; ${has('--no-restart') ? 'tunnel not restarted (--no-restart)' : restartTunnel()}`);
    } else say('3. no tunnel route to take out');
  }
  say(has('--no-restart') ? '4. site not restarted (--no-restart)' : `4. ${restartSite()}`);
  say('');
  say('OFF. THE SERVER is no longer offered on [ REMOTE ]. rdp.env and guacd are left as they are.');
}

if (require.main === module) {
  if (verb === 'status') void status();
  else if (verb === 'on') void on();
  else if (verb === 'off') off();
  else stop('node scripts/host/server-remote.cjs status | on | off');
}

module.exports = { withLine, withRoute };
