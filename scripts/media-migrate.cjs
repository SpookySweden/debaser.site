/*
 * The media catalogue's one-off migration: every file the site already holds, brought in
 * (SPEC-media-catalogue.md, decision 8).
 *
 *   node scripts/media-migrate.cjs --review      read everything, fingerprint it, write the SQL to
 *                                                Temp/media-migration.sql and print what it would create
 *   node scripts/media-migrate.cjs --write       run the SQL the review wrote - that file, exactly, so
 *                                                what was read is what runs (the db script prints it first)
 *
 * What it reads (all read-only): `music_tracks`, `profile_avatar_versions`, `profile_song_versions`,
 * `forum_threads` / `forum_comments` (the picture and the track each carries), `profiles` (names),
 * every object in the site's buckets (`storage.objects`: a file dropped into a bucket by hand has no
 * row anywhere else, and the shelf lists it), and the concept sheets from the manifest in
 * app/lib/concepts/sheets.ts. Every distinct address is
 * downloaded once and fingerprinted the way the browser does (sha256 of the bytes; for a picture the
 * 9x8 difference hash too, through sharp) - so a file uploaded twice under two names is one
 * `media_items` row and two uses.
 *
 * The SQL it writes is idempotent: `on conflict (sha256) do nothing` for items, `on conflict do
 * nothing` for uses, so it can be run again after a partial run. It never deletes and never updates.
 *
 * Tracked in `scripts/` because `.claude/rules/core.md` names the pattern (review first, then the
 * write with Luke's OK); the SQL it writes lands in `Temp/`, which is gitignored.
 */
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join('Temp', 'media-migration.sql');
const SITE_ACCOUNT_LABEL = 'debaser.site';

function rows(sql) {
  const out = execFileSync('node', ['scripts/db.cjs', '--json', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf('{');
  if (start === -1) throw new Error(`no JSON in the db script's answer:\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed.rows ?? [];
}

function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonLiteral(value) {
  return `${literal(JSON.stringify(value))}::jsonb`;
}

/** The same 64-bit difference hash app/lib/media/fingerprint.ts computes in a canvas. */
async function looksHash(buffer) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return null;
  }

  try {
    const grey = await sharp(buffer).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = '';
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        bits += grey[row * 9 + column] > grey[row * 9 + column + 1] ? '1' : '0';
      }
    }
    let hex = '';
    for (let index = 0; index < 64; index += 4) hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

async function imageSize(buffer) {
  try {
    const sharp = require('sharp');
    const meta = await sharp(buffer).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** The bytes behind an address: the project's own assets folder, or the public bucket. */
async function fetchBytes(src) {
  if (src.startsWith('/assets/')) {
    const local = join(process.cwd(), src.slice(1));
    if (!existsSync(local)) return null;
    return readFileSync(local);
  }

  if (!/^https?:\/\//.test(src)) return null;

  const response = await fetch(src);
  if (!response.ok) return null;

  return Buffer.from(await response.arrayBuffer());
}

function kindOf(src, hint) {
  if (hint) return hint;
  const path = src.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/.test(path)) return 'image';
  if (/\.(mp3|m4a|ogg|wav|flac)$/.test(path)) return 'audio';
  if (/\.(mp4|webm)$/.test(path)) return 'video';
  return null;
}

function mimeOf(src, kind) {
  const ext = src.split('?')[0].toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const table = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
    mp4: 'video/mp4', webm: 'video/webm',
  };
  return table[ext] ?? `${kind}/${ext}`;
}

/** Bucket and path, read off a public storage address. */
function placeOf(src) {
  const match = src.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (match === null) return { bucket: '', path: src };
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

/** The concept sheets, read off the manifest the site itself reads. */
function sheets() {
  const source = readFileSync(join('app', 'lib', 'concepts', 'sheets.ts'), 'utf8');
  const out = [];
  const pattern = /id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*caption:\s*'([^']*)',\s*src:\s*'([^']+)',\s*width:\s*(\d+),\s*height:\s*(\d+)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ id: match[1], title: match[2], src: match[4], width: Number(match[5]), height: Number(match[6]) });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');

  if (write) {
    if (!existsSync(OUT)) {
      console.error(`${OUT} is not there: run --review first, read it, then --write.`);
      process.exit(1);
    }
    execFileSync('node', ['scripts/db.cjs', '--write', '--file', OUT], { stdio: 'inherit' });
    return;
  }

  const names = new Map(rows('select id, display_name from public.profiles').map((row) => [row.id, row.display_name]));
  const nameOf = (id) => (id === null || id === undefined ? SITE_ACCOUNT_LABEL : (names.get(id) ?? 'Unknown'));

  /** Every candidate item, by address: the first description of an address wins. */
  const items = new Map();
  const uses = [];

  const describe = (src, kind, fields) => {
    if (typeof src !== 'string' || src.length === 0) return;
    const resolved = kindOf(src, kind);
    if (resolved === null) return;
    if (!items.has(src)) items.set(src, { src, kind: resolved, ...fields });
  };

  // 1. Concept sheets.
  for (const sheet of sheets()) {
    describe(sheet.src, 'image', {
      title: sheet.title, credit: SITE_ACCOUNT_LABEL, tags: ['CONCEPT SHEET'], source: 'sheet',
      uploadedBy: null, uploadedByLabel: SITE_ACCOUNT_LABEL, createdAt: '2026-09-21T00:00:00+00:00',
      width: sheet.width, height: sheet.height, folderPath: null, length: '',
    });
    uses.push({ src: sheet.src, useKind: 'sheet', useId: sheet.id, href: `/concepts#${sheet.id}`, label: sheet.title, addedBy: null });
  }

  // 2. The music shelf.
  for (const row of rows('select id, title, credit, src, length, uploaded_by, uploaded_by_label, created_at, tags, folder_path from public.music_tracks order by created_at')) {
    describe(row.src, 'audio', {
      title: row.title, credit: row.credit ?? '', tags: Array.isArray(row.tags) ? row.tags : [], source: 'migrated',
      uploadedBy: row.uploaded_by, uploadedByLabel: row.uploaded_by_label ?? nameOf(row.uploaded_by), createdAt: row.created_at,
      width: null, height: null, folderPath: row.folder_path ?? null, length: row.length ?? '',
    });
  }

  // 3. Profile pictures and songs: each version is a use of its file.
  for (const row of rows('select user_id, version, src, alt, created_at from public.profile_avatar_versions order by created_at')) {
    const name = nameOf(row.user_id);
    describe(row.src, 'image', {
      title: `${name.toUpperCase()} // PICTURE v${row.version}`, credit: name, tags: [], source: 'migrated',
      uploadedBy: row.user_id, uploadedByLabel: name, createdAt: row.created_at, width: null, height: null, folderPath: null, length: '',
    });
    uses.push({ src: row.src, useKind: 'profile_picture', useId: `${row.user_id}:v${row.version}`, href: `/profile/${encodeURIComponent(row.user_id)}`, label: `${name.toUpperCase()}'S PROFILE PICTURE`, addedBy: row.user_id });
  }

  for (const row of rows('select user_id, version, src, title, credit, created_at from public.profile_song_versions order by created_at')) {
    const name = nameOf(row.user_id);
    describe(row.src, 'audio', {
      title: row.title ?? `${name.toUpperCase()} // TRACK v${row.version}`, credit: row.credit ?? name, tags: [], source: 'migrated',
      uploadedBy: row.user_id, uploadedByLabel: name, createdAt: row.created_at, width: null, height: null, folderPath: null, length: '',
    });
    uses.push({ src: row.src, useKind: 'profile_song', useId: `${row.user_id}:v${row.version}`, href: `/profile/${encodeURIComponent(row.user_id)}`, label: `${name.toUpperCase()}'S PROFILE TRACK`, addedBy: row.user_id });
  }

  // 4. The board: a picture or a track on a post, or on a reply.
  for (const row of rows('select id, title, author_id, author_label, media_src, media_alt, media_width, media_height, track, created_at from public.forum_threads order by created_at')) {
    const site = { href: `/forum#thread-${row.id}`, label: row.title, addedBy: row.author_id, useKind: 'post', useId: row.id };
    if (row.media_src) {
      describe(row.media_src, 'image', {
        title: row.media_alt || row.title, credit: row.author_label ?? '', tags: [], source: 'migrated',
        uploadedBy: row.author_id, uploadedByLabel: row.author_label ?? nameOf(row.author_id), createdAt: row.created_at,
        width: row.media_width ?? null, height: row.media_height ?? null, folderPath: null, length: '',
      });
      uses.push({ src: row.media_src, ...site });
    }
    const track = row.track && typeof row.track === 'object' ? row.track : null;
    if (track && typeof track.src === 'string') {
      describe(track.src, 'audio', {
        title: track.title ?? row.title, credit: track.credit ?? '', tags: Array.isArray(track.tags) ? track.tags : [], source: 'migrated',
        uploadedBy: row.author_id, uploadedByLabel: row.author_label ?? nameOf(row.author_id), createdAt: row.created_at,
        width: null, height: null, folderPath: null, length: track.length ?? '',
      });
      uses.push({ src: track.src, ...site });
    }
  }

  const threadTitles = new Map(rows('select id, title from public.forum_threads').map((row) => [row.id, row.title]));
  for (const row of rows('select id, thread_id, author_id, author_label, media_src, media_alt, media_width, media_height, track, created_at from public.forum_comments order by created_at')) {
    const label = `REPLY ON ${threadTitles.get(row.thread_id) ?? 'A POST'}`;
    const site = { href: `/forum#comment-${row.id}`, label, addedBy: row.author_id, useKind: 'reply', useId: row.id };
    if (row.media_src) {
      describe(row.media_src, 'image', {
        title: row.media_alt || label, credit: row.author_label ?? '', tags: [], source: 'migrated',
        uploadedBy: row.author_id, uploadedByLabel: row.author_label ?? nameOf(row.author_id), createdAt: row.created_at,
        width: row.media_width ?? null, height: row.media_height ?? null, folderPath: null, length: '',
      });
      uses.push({ src: row.media_src, ...site });
    }
    const track = row.track && typeof row.track === 'object' ? row.track : null;
    if (track && typeof track.src === 'string') {
      describe(track.src, 'audio', {
        title: track.title ?? label, credit: track.credit ?? '', tags: Array.isArray(track.tags) ? track.tags : [], source: 'migrated',
        uploadedBy: row.author_id, uploadedByLabel: row.author_label ?? nameOf(row.author_id), createdAt: row.created_at,
        width: null, height: null, folderPath: null, length: track.length ?? '',
      });
      uses.push({ src: track.src, ...site });
    }
  }

  // 4b. Every file in the shelf's and the customiser's buckets, for the ones no table describes
  //     (dropped in by hand, or filed before a table existed), titled the way the shelf titles such
  //     a file: from its name. The catalogue's own buckets (`images`, `video`) are not read: a file
  //     there without a row is one whose row was deleted on purpose.
  const bucketKinds = { mp3: 'audio', avatars: 'image' };
  const host = [...items.keys()].map((src) => src.match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/public\//)?.[1]).find(Boolean);
  if (host === undefined) {
    console.log('no storage address seen in the tables, so the buckets are not read this run');
  } else {
    for (const row of rows("select bucket_id, name, created_at from storage.objects where bucket_id in ('mp3', 'avatars') and name not like '%/' order by created_at")) {
      const kind = bucketKinds[row.bucket_id];
      if (kind === undefined) continue;
      const src = `${host}/storage/v1/object/public/${row.bucket_id}/${row.name.split('/').map(encodeURIComponent).join('/')}`;
      const plain = `${host}/storage/v1/object/public/${row.bucket_id}/${row.name}`;
      if (items.has(src) || items.has(plain)) continue;
      const owner = row.name.split('/')[0];
      const ownerKnown = names.has(owner);
      const stem = row.name.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toUpperCase();
      describe(plain, kind, {
        title: stem, credit: ownerKnown ? nameOf(owner) : '', tags: [], source: 'migrated',
        uploadedBy: ownerKnown ? owner : null, uploadedByLabel: ownerKnown ? nameOf(owner) : SITE_ACCOUNT_LABEL, createdAt: row.created_at,
        width: null, height: null, folderPath: null, length: '',
      });
    }
  }

  // 5. Fingerprint every address once.
  const fingerprinted = [];
  const missing = [];
  for (const item of items.values()) {
    const bytes = await fetchBytes(item.src);
    if (bytes === null) {
      missing.push(item.src);
      continue;
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let phash = null;
    let width = item.width;
    let height = item.height;
    if (item.kind === 'image') {
      phash = await looksHash(bytes);
      if (width === null || height === null) ({ width, height } = await imageSize(bytes));
    }

    fingerprinted.push({ ...item, sha256, phash, width, height, bytes: bytes.length, mime: mimeOf(item.src, item.kind), ...placeOf(item.src) });
  }

  // 6. The same bytes under two addresses: one row, and the later address's uses point at it.
  const bySha = new Map();
  const duplicates = [];
  const srcToSha = new Map();
  for (const item of fingerprinted) {
    srcToSha.set(item.src, item.sha256);
    const first = bySha.get(item.sha256);
    if (first === undefined) bySha.set(item.sha256, item);
    else duplicates.push({ original: first.src, copy: item.src });
  }

  // 7. The SQL.
  const lines = ['-- Written by scripts/media-migrate.cjs on ' + new Date().toISOString(), '-- Idempotent: re-running changes nothing already there.', 'begin;'];
  for (const item of bySha.values()) {
    lines.push(
      `insert into public.media_items (kind, bucket, path, src, sha256, phash, bytes, mime, width, height, length, title, credit, tags, folder_path, source, uploaded_by, uploaded_by_label, created_at)\n` +
        `values (${literal(item.kind)}, ${literal(item.bucket)}, ${literal(item.path)}, ${literal(item.src)}, ${literal(item.sha256)}, ${literal(item.phash)}, ${item.bytes}, ${literal(item.mime)}, ${literal(item.width)}, ${literal(item.height)}, ${literal(item.length)}, ${literal(item.title)}, ${literal(item.credit)}, ${jsonLiteral(item.tags)}, ${literal(item.folderPath)}, ${literal(item.source)}, ${literal(item.uploadedBy)}${item.uploadedBy ? '::uuid' : ''}, ${literal(item.uploadedByLabel)}, ${literal(item.createdAt)})\n` +
        `on conflict (sha256) do nothing;`,
    );
  }
  let usesWritten = 0;
  for (const use of uses) {
    const sha = srcToSha.get(use.src);
    if (sha === undefined) continue;
    usesWritten += 1;
    lines.push(
      `insert into public.media_uses (media_id, use_kind, use_id, href, label, added_by, used_at)\n` +
        `select id, ${literal(use.useKind)}, ${literal(use.useId)}, ${literal(use.href)}, ${literal(use.label)}, ${literal(use.addedBy)}${use.addedBy ? '::uuid' : ''}, now() from public.media_items where sha256 = ${literal(sha)}\n` +
        `on conflict (media_id, use_kind, use_id) do nothing;`,
    );
  }
  lines.push('commit;');

  mkdirSync('Temp', { recursive: true });
  writeFileSync(OUT, lines.join('\n\n') + '\n', 'utf8');

  const counts = { image: 0, audio: 0, video: 0 };
  for (const item of bySha.values()) counts[item.kind] += 1;

  console.log(`addresses read      : ${items.size}`);
  console.log(`fingerprinted       : ${fingerprinted.length} (${counts.image} pictures, ${counts.audio} tracks, ${counts.video} videos)`);
  console.log(`could not be fetched: ${missing.length}${missing.length === 0 ? '' : '\n    ' + missing.join('\n    ')}`);
  console.log(`same bytes twice    : ${duplicates.length}${duplicates.length === 0 ? '' : '\n    ' + duplicates.map((d) => `${d.copy}\n      -> ${d.original}`).join('\n    ')}`);
  console.log(`rows to insert      : ${bySha.size} items, ${usesWritten} uses`);
  console.log(`sql written to      : ${OUT}`);

  console.log('\nReview only. Read the file, then run with --write to apply it (the db script prints it first).');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
