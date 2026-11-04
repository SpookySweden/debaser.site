/*
 * Which checks a change can affect: the picking behind `npm run checks:changed` (Luke's rule, 2026-11-04: every task
 * runs the checks for what it touched; the whole suite runs before a big feature or once a week).
 *
 * There is no hand-kept list of areas, because a list goes stale without saying so. A check is picked when:
 *   1. it IS a changed file;
 *   2. its own text names a changed file (a `codeOf('app/...')` read, or a compiled `render-out/components/X.js`);
 *   3. a changed file is imported, at any depth, by a file its `npx tsc` lines compile;
 *   4. it walks the `app` folder itself, and anything under `app/` changed.
 * When in doubt it runs more, never less: a name that merely contains another picks the check too, and a change to the
 * build's own settings (or to this picking) picks everything. A file no check knows of picks nothing, and the run says so.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { dirname, join } = require('node:path');

const ROOT = join(__dirname, '..');

/** A change to any of these can move every check, so none can be left out. */
const EVERYTHING = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'postcss.config.mjs',
  'scripts/run-checks.cjs',
  'scripts/checks-changed.cjs',
]);

/** Only these folders hold what a check can be about: a spec or a note changes no check's answer. (`.claude`: two read the rules.) */
const CODE = /^(app|scripts|supabase|assets|docs|Temp|\.claude)\//;

const WALKS_APP = /\b(readdirSync|walk\w*|glob\w*)\b/;
const NAMES_APP = /['"`](\.\/)?app(\/[\w-]*)?\/?['"`]/;

/** The words in a check's text that would mean it is about this file. */
function needles(file) {
  const found = [file];
  if (file.startsWith('app/')) found.push(file.slice('app/'.length).replace(/\.\w+$/, ''));
  // A folder inside supabase/ (a check that reads every migration), not the word "supabase", which most checks say.
  if (file.startsWith('supabase/') && dirname(file) !== 'supabase') found.push(dirname(file));
  return found;
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** The file an import names, or null for a package. */
function resolveImport(from, spec, root) {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec).split('\\').join('/');
  const tries = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.cjs`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`];
  return tries.find((path) => isFile(join(root, path))) ?? null;
}

/** Every file reached from `starts` by following imports. */
function reachable(starts, root, memo) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !isFile(join(root, file))) continue;
    seen.add(file);
    if (!memo.has(file)) {
      const text = readFileSync(join(root, file), 'utf8');
      const specs = [...text.matchAll(/(?:from\s+|import\s+|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
      memo.set(file, specs.map((spec) => resolveImport(file, spec, root)).filter(Boolean));
    }
    stack.push(...memo.get(file));
  }
  return seen;
}

/**
 * Picks from `checks` (`{ name, path }`, `path` relative to `root`) the ones `changed` can affect.
 * Returns `{ all: reason | null, picked: Set<name> }`.
 */
function pickChecks(changed, checks, root = ROOT) {
  const trigger = changed.find((file) => EVERYTHING.has(file));
  if (trigger) return { all: trigger, picked: new Set(checks.map((check) => check.name)) };

  const code = changed.filter((file) => CODE.test(file));
  const words = code.flatMap(needles);
  const memo = new Map();
  const picked = new Set();

  for (const check of checks) {
    const text = readFileSync(join(root, check.path), 'utf8');
    const own = code.includes(check.path);
    const named = words.some((word) => text.includes(word));
    const walks = code.some((file) => file.startsWith('app/')) && WALKS_APP.test(text) && NAMES_APP.test(text);
    if (own || named || walks) {
      picked.add(check.name);
      continue;
    }

    const compiled = text
      .split('\n')
      .filter((line) => line.includes('tsc '))
      .flatMap((line) => line.match(/app\/[^\s"'`]+\.tsx?/g) ?? []);
    const reach = reachable(compiled, root, memo);
    if (code.some((file) => reach.has(file))) picked.add(check.name);
  }
  return { all: null, picked };
}

/**
 * What this work has changed: commits not yet on GitHub, edits not yet committed, and new files. Null when git cannot
 * say (no `origin/main` here), which the runner treats as "everything" rather than "nothing".
 *
 * `--no-renames`: a moved file is both paths. With git's default only the new one is listed, and a check still reading
 * the old one would not be picked, so the run would say "all passed" about a check it never ran.
 */
function changedFiles(root = ROOT) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);
  try {
    const base = git('merge-base', 'HEAD', 'origin/main').trim();
    return [...new Set([...lines(git('diff', '--name-only', '--no-renames', base)), ...lines(git('ls-files', '--others', '--exclude-standard'))])];
  } catch {
    return null;
  }
}

module.exports = { changedFiles, pickChecks };
