/*
 * The second look for the site's locked files (SPEC-self-hosting.md, Stage 6): browser caches on this PC. Reads only.
 * A browser that showed an avatar or played a song kept its bytes: Chrome/Edge/Electron keep a big response as a plain file
 * (f_xxxxxx) and pack small ones into block files (data_1..3) with headers around them; Firefox keeps the body at the start
 * of each cache2 entry. So every cache file is read and, at offset 0 and wherever a PNG/JPEG/RIFF/ID3/WebM header begins,
 * the next <size> bytes are checked against each missing file's size and MD5 fingerprint. A match is the same bytes.
 * Writes the matches, as copies, to G:\DEBASER-HOST\recovered\<bucket>\<name> and the list to logs\found-in-caches.json.
 *
 *   node find-in-browser-caches.cjs            (looks under %LOCALAPPDATA% and %APPDATA%)
 */
const { createHash } = require('node:crypto');
const { mkdirSync, opendirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const wanted = JSON.parse(readFileSync('G:\\DEBASER-HOST\\logs\\missing-files.json', 'utf8'));
const already = new Set(JSON.parse(readFileSync('G:\\DEBASER-HOST\\logs\\found-files.json', 'utf8')).map((f) => f.name));
const todo = wanted.filter((w) => !already.has(w.name) && /^[0-9a-f]{32}$/.test(w.etag));
const OUT = 'G:\\DEBASER-HOST\\recovered';
const MAGIC = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('RIFF'), Buffer.from('ID3'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3])];
const found = new Map();
let files = 0, bytes = 0;

function check(buf, at, source) {
  for (const w of todo) {
    if (found.has(w.name)) continue;
    const size = Number(w.size);
    if (at + size > buf.length) continue;
    if (createHash('md5').update(buf.subarray(at, at + size)).digest('hex') !== w.etag) continue;
    const to = join(OUT, w.name.includes('/') ? '' : 'mp3', w.name);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, buf.subarray(at, at + size));
    found.set(w.name, { name: w.name, from: source, offset: at, savedTo: to });
  }
}

function scan(path) {
  let buf;
  try { if (statSync(path).size > 200 * 1024 * 1024) return; buf = readFileSync(path); } catch { return; }
  files++; bytes += buf.length;
  check(buf, 0, path);
  for (const m of MAGIC) for (let at = buf.indexOf(m, 1); at !== -1; at = buf.indexOf(m, at + 1)) check(buf, at, path);
}

function walk(dir, inCache) {
  let handle;
  try { handle = opendirSync(dir); } catch { return; }
  for (let e = handle.readSync(); e !== null; e = handle.readSync()) {
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path, inCache || /^(Cache_Data|cache2|Cache|Media Cache|entries)$/i.test(e.name));
    else if (e.isFile() && inCache) scan(path);
  }
  handle.closeSync();
}

const roots = [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean);
for (const r of roots) walk(r, false);
console.log(`read ${files} cache files (${(bytes / 1e9).toFixed(2)} GB); looked for ${todo.length} files`);
writeFileSync('G:\\DEBASER-HOST\\logs\\found-in-caches.json', JSON.stringify([...found.values()], null, 1));
for (const w of todo) console.log(`${found.has(w.name) ? 'FOUND  ' : 'missing'} ${w.name}${found.has(w.name) ? '  <- ' + found.get(w.name).from.replace(/.*AppData\\(Local|Roaming)\\/, '') : ''}`);
