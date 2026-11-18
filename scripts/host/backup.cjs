/*
 * The daily copy of the live site on Luke's PC (SPEC-self-hosting.md, Stage 7; Luke 2026-11-18: "dont do back ups to google
 * drive for now"). Run at 04:00 by the scheduled task "DebaserBackup" (copied to G:\DEBASER-HOST\backup.cjs).
 *
 * Into I:\DEBASER\backups\<date-time>\ it writes:
 *   database.dump   the whole database (pg_dump, custom format: structure and data, every schema, accounts included)
 *   roles.sql       the database's own roles (no passwords), for a restore into a fresh install
 *   files\          the uploaded files (songs, avatars, pictures...) from I:\DEBASER\files
 *   settings\       what it takes to bring the same server back: Supabase's settings file (its keys decrypt the vault),
 *                   the site's settings, the tunnel's settings and credentials, the keep-running list
 *   report.json     sizes, table counts, how long it took
 * The 30 newest are kept. These copies hold email addresses, password hashes and the server's keys: they stay on Luke's
 * own drive, never in the repo, and are not encrypted while nothing leaves the house (add that with an off-site copy).
 *
 * A failed copy writes "DEBASER BACKUP FAILED.txt" on Luke's desktop (removed by the next good one) and logs to
 * G:\DEBASER-HOST\logs\backup.log. Exit 0 good, 1 failed.
 */
const { spawn, spawnSync } = require('node:child_process');
const { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const HOST = 'G:\\DEBASER-HOST';
const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const BACKUPS = 'I:\\DEBASER\\backups';
const FILES = 'I:\\DEBASER\\files';
const KEEP = 30;
const LOG = join(HOST, 'logs', 'backup.log');
const ALARM = join(homedir(), 'Desktop', 'DEBASER BACKUP FAILED.txt');
const SETTINGS = [
  [join(HOST, 'supabase', '.env'), 'supabase.env'],
  [join(HOST, 'supabase', 'docker-compose.debaser.yml'), 'docker-compose.debaser.yml'],
  [join(HOST, 'site.env'), 'site.env'],
  [join(HOST, 'services.json'), 'services.json'],
  [join(HOST, 'cloudflared', 'config.yml'), 'cloudflared-config.yml'],
  [join(HOST, 'cloudflared', 'debaser-home.json'), 'cloudflared-debaser-home.json'],
];

const log = (text) => appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`);
const password = () => /^POSTGRES_PASSWORD=(.*)$/m.exec(readFileSync(join(HOST, 'supabase', '.env'), 'utf8'))[1].trim();

/** Runs a command in the database container and streams what it prints into a file. */
function dumpTo(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, ['exec', '-e', `PGPASSWORD=${password()}`, 'supabase-db', ...args], { windowsHide: true });
    const out = createWriteStream(file);
    let err = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => out.close(() => (code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}: ${err.slice(0, 300)}`)))));
  });
}

function psql(sql) {
  const r = spawnSync(DOCKER, ['exec', '-e', `PGPASSWORD=${password()}`, 'supabase-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}

async function main() {
  const started = Date.now();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const here = join(BACKUPS, stamp);
  mkdirSync(join(here, 'settings'), { recursive: true });
  const report = { at: new Date().toISOString(), folder: here };

  // The database: everything, in pg_dump's own format (pg_restore can bring back all of it or one table).
  await dumpTo(join(here, 'database.dump'), ['pg_dump', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-Fc']);
  await dumpTo(join(here, 'roles.sql'), ['pg_dumpall', '-h', 'localhost', '-U', 'supabase_admin', '--roles-only', '--no-role-passwords']);
  report.databaseBytes = statSync(join(here, 'database.dump')).size;
  // A copy that can't be read back is not a copy: list its contents.
  const listed = spawnSync(DOCKER, ['exec', '-i', 'supabase-db', 'pg_restore', '--list'], { input: readFileSync(join(here, 'database.dump')), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (listed.status !== 0) throw new Error(`the dump does not read back: ${(listed.stderr || '').slice(0, 300)}`);
  report.tablesWithData = (listed.stdout.match(/ TABLE DATA /g) || []).length;
  report.accounts = Number(psql('select count(*) from auth.users'));
  report.threads = Number(psql('select count(*) from public.forum_threads'));

  // The uploaded files (robocopy: exit codes below 8 mean it worked).
  const copied = spawnSync('robocopy', [FILES, join(here, 'files'), '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { encoding: 'utf8', windowsHide: true });
  if (copied.status === null || copied.status >= 8) throw new Error(`copying the files failed (robocopy ${copied.status})`);
  report.files = existsSync(join(here, 'files')) ? readdirSync(join(here, 'files'), { recursive: true }).length : 0;

  // The server's settings and keys.
  report.settings = [];
  for (const [from, to] of SETTINGS) if (existsSync(from)) { copyFileSync(from, join(here, 'settings', to)); report.settings.push(to); }

  report.seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(here, 'report.json'), JSON.stringify(report, null, 1));

  // Keep the newest 30 dated folders (only folders this script names: yyyy-mm-dd-hh-mm).
  const dated = readdirSync(BACKUPS).filter((n) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(n)).sort();
  for (const old of dated.slice(0, Math.max(0, dated.length - KEEP))) rmSync(join(BACKUPS, old), { recursive: true, force: true });

  writeFileSync(join(BACKUPS, 'LAST-BACKUP.txt'), `Last good copy: ${here} (${report.seconds}s, ${report.accounts} accounts, ${report.tablesWithData} tables with data, ${report.files} files)\n`);
  rmSync(ALARM, { force: true });
  log(`ok ${stamp}: ${(report.databaseBytes / 1e6).toFixed(1)} MB database, ${report.tablesWithData} tables, ${report.files} files, ${report.seconds}s`);
  console.log(JSON.stringify(report, null, 1));
}

main().catch((error) => {
  const line = `${new Date().toISOString()} DEBASER BACKUP FAILED: ${error.message}`;
  try { log(line); } catch { /* the log is on G:, which may be the problem */ }
  try { writeFileSync(ALARM, `${line}\n\nThe site's daily copy did not complete. Ask a Claude session to look at G:\\DEBASER-HOST\\logs\\backup.log.\n`); } catch { /* nowhere left to say it */ }
  console.error(line);
  process.exit(1);
});
