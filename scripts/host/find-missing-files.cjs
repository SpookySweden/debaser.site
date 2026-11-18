/*
 * Looks on this PC for exact copies of the site's stored files that are still locked in the cloud project (SPEC-self-hosting.md,
 * Stage 6; Luke 2026-11-18: "i believe we have the ability to recover the missing profile pictures as well as music").
 * Reads only. G:\DEBASER-HOST\logs\missing-files.json lists each file's size and MD5 fingerprint (storage.objects' eTag);
 * this walks the given folders, opens a file only when its size is one of those, and reports a match only when its MD5 is
 * identical, so a match is the very same bytes. Results: G:\DEBASER-HOST\logs\found-files.json.
 *
 *   node find-missing-files.cjs <folder> [<folder> ...]
 */
const { createHash } = require('node:crypto');
const { createReadStream, opendirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const wanted = JSON.parse(readFileSync('G:\\DEBASER-HOST\\logs\\missing-files.json', 'utf8'));
const sizes = new Set(wanted.map((w) => Number(w.size)));
const SKIP = /^(\$WinREAgent|System Volume Information|Windows|Program Files|Program Files \(x86\)|ProgramData|node_modules|\.git|\.next|DEBASER-HOST|DEBASER|WindowsApps|AppData)$/i;
const found = [];
let seen = 0, checked = 0;

function md5(file) {
  return new Promise((resolve) => {
    const h = createHash('md5');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null));
  });
}

async function walk(dir) {
  let handle;
  try { handle = opendirSync(dir); } catch { return; }
  for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP.test(entry.name)) await walk(path); continue; }
    if (!entry.isFile()) continue;
    seen++;
    let size;
    try { size = statSync(path).size; } catch { continue; }
    if (!sizes.has(size)) continue;
    checked++;
    const hash = await md5(path);
    for (const w of wanted) if (Number(w.size) === size && w.etag === hash) found.push({ name: w.name, at: path });
  }
  handle.closeSync();
}

(async () => {
  for (const root of process.argv.slice(2)) {
    const before = Date.now();
    await walk(root);
    console.log(`${root}: done in ${Math.round((Date.now() - before) / 1000)}s (${seen} files looked at so far, ${checked} the right size, ${found.length} exact matches)`);
    writeFileSync('G:\\DEBASER-HOST\\logs\\found-files.json', JSON.stringify(found, null, 1));
  }
  const names = new Set(found.map((f) => f.name));
  console.log(`\n${names.size} of ${wanted.length} files found as exact copies:`);
  for (const w of wanted) console.log(`${names.has(w.name) ? 'FOUND  ' : 'missing'} ${w.name}${names.has(w.name) ? '  <- ' + found.find((f) => f.name === w.name).at : ''}`);
})();
