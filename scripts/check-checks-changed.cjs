/*
 * `npm run checks:changed` has to pick the checks a change can break, and it fails quietly if it does not: the run
 * still says "all passed", about too few checks. So the picking is held here against the real tree.
 */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { pickChecks } = require('./checks-changed.cjs');

const root = mkdtempSync(join(tmpdir(), 'checks-changed-'));
const write = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

write('app/lib/leaf.ts', 'export const leaf = 1;\n');
write('app/lib/middle.ts', "import { leaf } from './leaf';\nexport const middle = leaf;\n");
write('app/components/Top.tsx', "import { middle } from '../lib/middle';\nexport default () => middle;\n");
write('app/components/Other.tsx', 'export default () => 2;\n');
write('app/components/Unwatched.tsx', 'export default () => 3;\n');
write('supabase/migrations/1_x.sql', 'select 1;\n');

const compiled = { name: 'check-compiled.cjs', path: 'Temp/check-compiled.cjs' };
const reader = { name: 'check-reader.cjs', path: 'Temp/check-reader.cjs' };
const walker = { name: 'check-walker.cjs', path: 'scripts/check-walker.cjs' };
const migrations = { name: 'check-migrations.cjs', path: 'scripts/check-migrations.cjs' };
write(compiled.path, '/*\n * npx tsc app/components/Top.tsx --outDir Temp/x-out\n */\n');
write(reader.path, "const code = codeOf('app/components/Other.tsx');\n");
write(walker.path, "for (const name of readdirSync('app')) look(name);\n");
write(migrations.path, "const all = readdirSync('supabase/migrations');\n");
const checks = [compiled, reader, walker, migrations];

const picked = (...changed) => [...pickChecks(changed, checks, root).picked].sort();

try {
  assert.deepEqual(picked('app/lib/leaf.ts'), ['check-compiled.cjs', 'check-walker.cjs'], 'a file imported two levels down picks the check that compiles it');
  assert.deepEqual(picked('app/components/Other.tsx'), ['check-reader.cjs', 'check-walker.cjs'], 'a file a check reads picks that check, and not the one compiling something else');
  assert.deepEqual(picked('app/components/Unwatched.tsx'), ['check-walker.cjs'], 'a file nothing names is still seen by a check that walks app/');
  assert.deepEqual(picked('supabase/migrations/2_new.sql'), ['check-migrations.cjs'], 'a new migration picks what reads the migrations');
  assert.deepEqual(picked('Temp/check-reader.cjs'), ['check-reader.cjs'], 'a changed check picks itself');
  assert.deepEqual(picked('SPEC-anything.md', 'HANDOFF.md'), [], 'a note changes no check');

  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts/run-checks.cjs', 'scripts/checks-changed.cjs']) {
    const result = pickChecks([file], checks, root);
    assert.equal(result.all, file, `${file} moves everything, and is named as the reason`);
    assert.equal(result.picked.size, checks.length, `${file} picks every check`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: checks:changed picks by what a check compiles, reads and walks');
