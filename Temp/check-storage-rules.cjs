/*
 * The rules on uploaded files (storage.objects) must never read storage.objects themselves. Postgres calls that infinite recursion, and it refuses every insert into the
 * table, for every bucket, because a table's insert rules are all put together before any is decided: every signed-in upload on the site failed for three days
 * in November 2026 because of one such rule. A function can read it; a rule can't.
 *   node Temp/check-storage-rules.cjs
 *
 * Reads the migrations in order, so it sees what is in force: a dropped rule stops counting, a recreated one counts by its new words.
 * `STORAGE_RULES_BEFORE=<timestamp>` reads only the migrations before that one, which is how this check is shown catching the rule that did it.
 * Then, live, one real upload as test account A into its own folder, removed at once: the rule's words can be fine and the upload still broken.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const before = process.env.STORAGE_RULES_BEFORE ?? '';
const rules = new Map();
for (const file of fs.readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort()) {
  if (before !== '' && file >= before) continue;
  // Comments can name what they like.
  const sql = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n').replace(/--.*$/gm, '');
  for (const match of sql.matchAll(/(drop policy(?: if exists)?|create policy)\s+"([^"]+)"\s+on\s+storage\.objects\b([\s\S]*?);/gi)) {
    if (match[1].toLowerCase().startsWith('drop')) rules.delete(match[2]);
    else rules.set(match[2], { file, body: match[3] });
  }
}
assert.ok(rules.size >= 10, `the rules were found (${rules.size})`);

const reading = [...rules].filter(([, rule]) => /\bstorage\s*\.\s*objects\b|\bfrom\s+objects\b/i.test(rule.body)).map(([name, rule]) => `"${name}" (${rule.file})`);
assert.deepEqual(reading, [], `a rule on storage.objects reads storage.objects, which refuses every upload on the site: ${reading.join(', ')}`);
console.log(`  ok    none of the ${rules.size} rules in force reads its own table`);

(async () => {
  if (before !== '') return;
  loadEnv();
  const a = await testAccountClient('A');
  const name = `${a.id}/check-storage-rules-${Date.now()}.mp3`;
  const { error } = await a.client.storage.from('mp3').upload(name, Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]), { contentType: 'audio/mpeg', upsert: false });
  assert.equal(error, null, `a signed-in person can upload into their own folder: ${error?.message}`);
  const gone = await a.client.storage.from('mp3').remove([name]);
  assert.equal((gone.data ?? []).length, 1, 'and take it out again');
  console.log('  ok    a real upload goes through, and was removed');
})()
  .then(() => {
    console.log('storage rules: none reads its own table, and uploads work.');
    process.exit(0);
  })
  .catch((failure) => {
    console.error(`FAILED: ${failure.message}`);
    process.exit(1);
  });
