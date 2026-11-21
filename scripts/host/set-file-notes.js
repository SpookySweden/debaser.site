// Runs INSIDE the storage container (node /tmp/set-file-notes.js /tmp/notes.json): gives files copied into the PC's storage
// by hand the two notes Supabase Storage's file backend keeps on each file it writes itself (extended attributes, see
// /app/dist/storage/backend/file.js METADATA_ATTR_KEYS), so they're served with their own type and cache time.
// notes.json: [{ "path": "/var/lib/storage/stub/stub/<bucket>/<name>/<version>", "type": "image/png", "cache": "max-age=3600" }]
// (SPEC-self-hosting.md, Stage 6; scripts/host/copy-cloud-files.cjs writes the list.)
const xattr = require('/app/node_modules/fs-xattr');
const fs = require('fs');
const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let done = 0;
const failed = [];
for (const f of list) {
  try {
    xattr.setAttributeSync(f.path, 'user.supabase.content-type', f.type || 'application/octet-stream');
    xattr.setAttributeSync(f.path, 'user.supabase.cache-control', f.cache || 'max-age=3600');
    done++;
  } catch (error) {
    failed.push(`${f.path}: ${error.message}`);
  }
}
console.log(`notes set on ${done} of ${list.length} files`);
for (const f of failed.slice(0, 10)) console.log(`  FAILED ${f}`);
