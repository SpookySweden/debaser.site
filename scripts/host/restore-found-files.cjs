/*
 * Puts recovered copies of the site's locked files back into the PC's storage (SPEC-self-hosting.md, Stage 6; Luke's OK
 * 2026-11-18: "yes and attribute them accordingly"). For each match in logs\found-files.json (and found-in-caches.json):
 *   1. reads the file's record (bucket, owner, type) as imported from the cloud, before anything changes;
 *   2. checks the copy's MD5 against the record's fingerprint once more;
 *   3. uploads it through the PC's file service as the server (upsert, so the existing record is reused);
 *   4. puts the record's original owner back (the upload stamps the server), so owners can still replace or delete it;
 *   5. downloads it through https://api.debaser.site's public address and checks the fingerprint again.
 * A record changed since the import (re-uploaded on the PC) is left alone. Prints no key.
 */
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const SUPA = readFileSync('G:\\DEBASER-HOST\\supabase\\.env', 'utf8');
const SERVICE = /^SERVICE_ROLE_KEY=(.*)$/m.exec(SUPA)[1].trim();
const PW = /^POSTGRES_PASSWORD=(.*)$/m.exec(SUPA)[1].trim();
const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const lit = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

function sql(statement) {
  return execFileSync(DOCKER, ['exec', '-e', `PGPASSWORD=${PW}`, 'supabase-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}

(async () => {
  // The lists to restore from: the given ones (each [{ name, at }]), or the two the searches wrote.
  const sources = new Map();
  const lists = process.argv.slice(2);
  if (lists.length > 0) {
    for (const list of lists) for (const f of JSON.parse(readFileSync(list, 'utf8'))) if (!sources.has(f.name)) sources.set(f.name, f.at);
  } else {
    for (const f of JSON.parse(readFileSync('G:\\DEBASER-HOST\\logs\\found-files.json', 'utf8'))) if (!sources.has(f.name)) sources.set(f.name, f.at);
    if (existsSync('G:\\DEBASER-HOST\\logs\\found-in-caches.json')) for (const f of JSON.parse(readFileSync('G:\\DEBASER-HOST\\logs\\found-in-caches.json', 'utf8'))) if (!sources.has(f.name)) sources.set(f.name, f.savedTo);
  }

  let restored = 0;
  for (const [name, from] of sources) {
    const row = sql(`select json_build_object('bucket', bucket_id, 'owner', owner, 'owner_id', owner_id, 'type', metadata->>'mimetype', 'cache', metadata->>'cacheControl', 'etag', replace(metadata->>'eTag', '"', ''), 'size', (metadata->>'size')::bigint, 'updated', updated_at > created_at + interval '1 hour') from storage.objects where name = ${lit(name)} and bucket_id <> 'web-pool'`);
    if (!row) { console.log(`skip   ${name}: no record`); continue; }
    const r = JSON.parse(row);
    const bytes = readFileSync(from);
    if (md5(bytes) !== r.etag || bytes.length !== Number(r.size)) { console.log(`skip   ${name}: the copy no longer matches`); continue; }
    if (existsSync(`I:\\DEBASER\\files\\stub\\stub\\${r.bucket}\\${name.replace(/\//g, '\\')}`)) { console.log(`skip   ${name}: already on the PC (re-uploaded since the move)`); continue; }

    const path = name.split('/').map(encodeURIComponent).join('/');
    const up = await fetch(`http://127.0.0.1:8000/storage/v1/object/${r.bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'x-upsert': 'true', 'content-type': r.type || 'application/octet-stream', 'cache-control': `max-age=${(r.cache || 'max-age=3600').replace(/\D/g, '') || 3600}` },
      body: bytes,
    });
    if (!up.ok) { console.log(`FAILED ${name}: upload answered ${up.status} ${(await up.text()).slice(0, 150)}`); continue; }

    sql(`update storage.objects set owner = ${lit(r.owner)}, owner_id = ${lit(r.owner_id)} where bucket_id = ${lit(r.bucket)} and name = ${lit(name)}`);
    const back = await fetch(`https://api.debaser.site/storage/v1/object/public/${r.bucket}/${path}`);
    const got = Buffer.from(await back.arrayBuffer());
    const ok = back.ok && md5(got) === r.etag;
    if (ok) restored++;
    console.log(`${ok ? 'ok    ' : 'CHECK '} ${r.bucket}/${name}  (${(bytes.length / 1e6).toFixed(2)} MB, owner ${r.owner ? r.owner.slice(0, 8) : 'none'}, public download ${back.status}${ok ? ', same fingerprint' : ''})`);
  }
  console.log(`\n${restored} of ${sources.size} restored and checked`);
})();
