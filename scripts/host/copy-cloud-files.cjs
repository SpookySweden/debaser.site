/*
 * Stage 6 (SPEC-self-hosting.md): the stored files still on the old cloud project come to the PC, with NO database change.
 * Every file's record (storage.objects: bucket, name, version, size, eTag, owner) came across in Stage 4; the PC's file
 * service keeps each file at I:\DEBASER\files\stub\stub\<bucket>\<name>\<version>. So a file whose bytes the PC lacks is
 * read from the cloud and written to exactly that path, and its record is whole again, owner untouched.
 *
 * Only when the PC's record and the cloud's agree (same size and eTag) and the PC lacks the bytes; a record re-made on the
 * PC since (different eTag) is left alone. Read only on the cloud: public folders by their public address, private ones
 * (stream-art, web-pool) with the cloud's service key (see cloudServiceKey).
 * Each file is checked by size, and by MD5 where the eTag is one, before it is put in place (written aside, then moved).
 * The file service serves a file with the type and cache time it keeps as notes on the file itself (extended attributes),
 * so before a file is moved into place set-file-notes.js gives it the record's own type and cache time, run inside the
 * storage container; a file served before that would go out as application/octet-stream and Cloudflare would keep that.
 *
 *   node scripts/host/copy-cloud-files.cjs [--dry-run] [--only <bucket>/<name>]     (from the site checkout)
 * Writes G:\DEBASER-HOST\logs\copy-cloud-files.json.
 */
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { tmpdir } = require('node:os');

const CLOUD = 'https://uekreahyooezywjgzirr.supabase.co';
const FILES = 'I:\\DEBASER\\files\\stub\\stub';
const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const PUBLIC = new Set(['avatars', 'images', 'mp3', 'video', 'profile-characters', 'doc-pictures']);
const dryRun = process.argv.includes('--dry-run');
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];

const env = (file, key) => new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
const CLOUD_ANON = env('.env.production', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const enc = (name) => name.split('/').map(encodeURIComponent).join('/');

function pcRows() {
  const pw = env('G:\\DEBASER-HOST\\supabase\\.env', 'POSTGRES_PASSWORD');
  const out = execFileSync(DOCKER, ['exec', '-e', `PGPASSWORD=${pw}`, 'supabase-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c',
    "select coalesce(json_agg(json_build_object('b',bucket_id,'n',name,'v',version,'s',(metadata->>'size')::bigint,'e',replace(metadata->>'eTag','\"',''),'t',metadata->>'mimetype','c',metadata->>'cacheControl')),'[]') from storage.objects"], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function cloudRows() {
  const out = execFileSync(process.execPath, ['scripts/db.cjs', '--cloud', '--read-only', '--json',
    "select coalesce(json_agg(json_build_object('b',bucket_id,'n',name,'s',(metadata->>'size')::bigint,'e',replace(metadata->>'eTag','\"',''))),'[]')::text as j from storage.objects"], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(JSON.parse(out.slice(out.search(/^\{\s*$/m))).rows[0].j);
}

// The private folders' rules don't let any one account read all of them (a room's drawing only for those who can see that
// room's snapshot), so they're read with the cloud's service key, asked of the Management API with the access token in
// .env.local and held in memory only: never printed or written down. GET requests only.
async function cloudServiceKey() {
  const r = await fetch('https://api.supabase.com/v1/projects/uekreahyooezywjgzirr/api-keys?reveal=true', {
    headers: { Authorization: `Bearer ${env('.env.local', 'SUPABASE_ACCESS_TOKEN')}` },
  });
  const key = r.ok ? (await r.json()).find((k) => k.name === 'service_role')?.api_key : undefined;
  if (!key) throw new Error(`the cloud's service key could not be read: ${r.status}`);
  return key;
}

async function download(row, key) {
  const url = PUBLIC.has(row.b) ? `${CLOUD}/storage/v1/object/public/${row.b}/${enc(row.n)}` : `${CLOUD}/storage/v1/object/authenticated/${row.b}/${enc(row.n)}`;
  const r = await fetch(url, { headers: PUBLIC.has(row.b) ? {} : { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`cloud answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const pc = pcRows();
  const cloud = new Map(cloudRows().map((r) => [`${r.b}/${r.n}`, r]));
  const token = dryRun ? null : await cloudServiceKey();
  const report = { at: new Date().toISOString(), copied: [], alreadyThere: 0, leftAlone: [], notOnCloud: [], failed: [] };
  const todo = [];
  for (const row of pc) {
    const key = `${row.b}/${row.n}`;
    if (only !== null && key !== only) continue;
    const target = join(FILES, row.b, ...row.n.split('/'), row.v);
    if (existsSync(target)) { report.alreadyThere++; continue; }
    const c = cloud.get(key);
    if (!c) { report.notOnCloud.push(key); continue; }
    if (c.e !== row.e || Number(c.s) !== Number(row.s)) { report.leftAlone.push(key); continue; }
    todo.push({ ...row, target });
  }
  console.log(`${todo.length} to copy; ${report.alreadyThere} already there; ${report.leftAlone.length} differ (left alone); ${report.notOnCloud.length} not on the cloud${dryRun ? ' (dry run: nothing copied)' : ''}`);
  if (dryRun) { for (const t of todo.slice(0, 30)) console.log(`  would copy ${t.b}/${t.n} (${t.s} B)`); return; }

  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const row = todo[i++];
      try {
        const bytes = await download(row, token);
        if (bytes.length !== Number(row.s)) throw new Error(`size ${bytes.length}, record says ${row.s}`);
        if (/^[0-9a-f]{32}$/.test(row.e) && md5(bytes) !== row.e) throw new Error('fingerprint differs from the record');
        mkdirSync(dirname(row.target), { recursive: true });
        writeFileSync(`${row.target}.part`, bytes);
        ready.push(row);
      } catch (error) {
        report.failed.push({ file: `${row.b}/${row.n}`, why: error.message });
      }
    }
  }
  const ready = [];
  await Promise.all(Array.from({ length: 6 }, worker));

  // The notes (type, cache time), set inside the storage container on the files still aside, then each moved into place.
  if (ready.length > 0) {
    const notes = join(tmpdir(), 'debaser-file-notes.json');
    writeFileSync(notes, JSON.stringify(ready.map((r) => ({ path: `/var/lib/storage/stub/stub/${r.b}/${r.n}/${r.v}.part`, type: r.t, cache: r.c || undefined }))));
    execFileSync(DOCKER, ['cp', notes, 'supabase-storage:/tmp/debaser-file-notes.json']);
    execFileSync(DOCKER, ['cp', join(__dirname, 'set-file-notes.js'), 'supabase-storage:/tmp/set-file-notes.js']);
    console.log(execFileSync(DOCKER, ['exec', 'supabase-storage', 'node', '/tmp/set-file-notes.js', '/tmp/debaser-file-notes.json'], { encoding: 'utf8' }).trim());
  }
  for (const row of ready) {
    try {
      renameSync(`${row.target}.part`, row.target);
      report.copied.push(`${row.b}/${row.n}`);
    } catch (error) {
      report.failed.push({ file: `${row.b}/${row.n}`, why: error.message });
    }
  }
  writeFileSync('G:\\DEBASER-HOST\\logs\\copy-cloud-files.json', JSON.stringify(report, null, 1));
  console.log(`copied ${report.copied.length}, failed ${report.failed.length}`);
  for (const f of report.failed.slice(0, 10)) console.log(`  FAILED ${f.file}: ${f.why}`);
  for (const k of report.leftAlone) console.log(`  left alone (re-made on the PC): ${k}`);
  for (const k of report.notOnCloud.slice(0, 10)) console.log(`  not on the cloud: ${k}`);
})().catch((error) => { console.error(`STOPPED: ${error.message}`); process.exit(1); });
