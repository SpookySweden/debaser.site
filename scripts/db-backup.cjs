/*
 * A copy of the database, on this machine, every day (`npm run db:backup`; a Windows scheduled task runs it at 04:00).
 *
 * The site's Supabase project is on the free plan, which keeps no backup we can restore from, and on 2026-11-06 that cost every
 * account on the site. This reads every table through the same route as `npm run db` (reads only, so it can change nothing) and
 * writes one JSON file per table, plus the list of stored files, to a dated folder OUTSIDE the repository, because it holds people's
 * email addresses and password hashes. The 14 newest are kept. The files themselves aren't copied: storage wasn't touched by what
 * happened and a delete of rows doesn't remove them.
 *
 * Left out, and said so in the folder's report: MEDIA's search tables (rebuilt by its own jobs, and too big for this route).
 * A table that fails is reported and the rest carry on; the exit code says if any did, and the report names them.
 */
const { execFileSync } = require('node:child_process');
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
process.chdir(ROOT);
const FOLDER = process.env.DEBASER_BACKUP_DIR || join(homedir(), 'Documents', 'debaser-backups');
const KEEP = 14;
const SKIPPED = /^web_(word_stats|word_facts|pool_items|pool_shards|seen_items|seen_caps|sweep_batches|sweep_state|tag_spend)$/;

function query(sql) {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--read-only', '--json', sql], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('{');
  return JSON.parse(out.slice(start)).rows;
}

function main() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const here = join(FOLDER, stamp);
  mkdirSync(here, { recursive: true });

  const tables = query("select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities'))) order by 1, 2");
  const report = { at: new Date().toISOString(), saved: {}, failed: {}, skipped: [] };
  for (const { s, t } of tables) {
    if (s === 'public' && SKIPPED.test(t)) {
      report.skipped.push(t);
      continue;
    }
    try {
      const rows = query(`select * from "${s}"."${t}"`);
      writeFileSync(join(here, `${s}.${t}.json`), JSON.stringify(rows));
      report.saved[`${s}.${t}`] = rows.length;
    } catch (error) {
      report.failed[`${s}.${t}`] = String(error.message).slice(0, 200);
    }
  }
  try {
    const files = query('select bucket_id, name, created_at, metadata from storage.objects where bucket_id <> \'web-pool\'');
    writeFileSync(join(here, 'storage.objects.json'), JSON.stringify(files));
    report.saved['storage.objects'] = files.length;
  } catch (error) {
    report.failed['storage.objects'] = String(error.message).slice(0, 200);
  }
  writeFileSync(join(here, 'report.json'), JSON.stringify(report, null, 1));

  const failed = Object.keys(report.failed);
  // Only a run that saved the accounts counts towards the 14 kept, so failing runs can't push the good copies out.
  if (report.saved['auth.users'] !== undefined && report.saved['public.profiles'] !== undefined) {
    const old = readdirSync(FOLDER).filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name)).sort().reverse().slice(KEEP);
    for (const name of old) rmSync(join(FOLDER, name), { recursive: true, force: true });
  }
  console.log(`${Object.keys(report.saved).length} tables saved to ${here}; ${failed.length} failed${failed.length ? `: ${failed.join(', ')}` : ''}; accounts: ${report.saved['auth.users'] ?? 'NOT SAVED'}`);
  if (failed.length > 0 || report.saved['auth.users'] === undefined) process.exitCode = 1;
}

main();
