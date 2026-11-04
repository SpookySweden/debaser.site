/**
 * The build's file lists stay out of the scratch folders.
 *
 * `next build` writes, for every server route, a list of the project files that route needs at run time
 * (`.next/server/app/**\/*.nft.json`), and Turbopack reads and hashes every file on those lists while it
 * writes them. On 2026-10-21 the two upload routes (`app/api/music/upload`, `app/api/profile/avatar`)
 * listed about 3,900 files under `Temp/` - their `path.join(directory, `${name}-${stamp}${ext}`)` was read
 * by the tracer as "every file in the project with a dash in its path" - so a headless Chrome running on a
 * profile under `Temp/browse/` (a locked `Cookies-journal`, a locked `Sessions/` file) crashed every
 * session's build with "Failed to write app endpoint /page ... being used by another process". The fix
 * was a `/* turbopackIgnore: true *\/` on that inner `path.join`. `outputFileTracingExcludes` does NOT
 * help: it is applied after Turbopack has already read the files.
 *
 * So this reads the lists the last build actually wrote and holds four things:
 *
 *   1. no route lists a file under `Temp/` or `.claude/`;
 *   2. the upload routes list no project files at all (they only write; node_modules and chunks are fine);
 *   3. the `/assets/[...path]` route still lists every file in `assets/` - the `outputFileTracingIncludes`
 *      in next.config.ts is what ships the artwork on Vercel, and losing it would break every picture;
 *   4. the build is newer than the files it is about, or it proves nothing - run `npm run build` first.
 *
 * Steps: none to compile. It reads `.next/`, so it needs a build (`npm run verify` runs one).
 */
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const APP = path.join(ROOT, '.next', 'server', 'app');
const failures = [];

if (!existsSync(APP)) {
  console.log('FAIL no .next/server/app - run `npm run build` first');
  process.exit(1);
}

/** Every trace file, with its route and its entries resolved to project-relative paths. */
const traces = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.nft.json')) {
      const files = JSON.parse(readFileSync(full, 'utf8')).files.map((file) =>
        path.relative(ROOT, path.resolve(path.dirname(full), file)).split(path.sep).join('/'),
      );
      const route = path.relative(APP, full).split(path.sep).join('/').replace(/\.js\.nft\.json$/, '');
      traces.push({ route, full, files });
    }
  }
}
walk(APP);

const own = (file) => !file.startsWith('node_modules/') && !file.startsWith('.next/');

// 4. freshness, first: a stale list would make every other answer about old code.
const sources = ['next.config.ts', 'app/api/music/upload/route.ts', 'app/api/profile/avatar/route.ts'];
for (const route of ['api/music/upload/route', 'api/profile/avatar/route']) {
  const trace = traces.find((t) => t.route === route);
  if (trace === undefined) {
    failures.push(`no trace for ${route}`);
    continue;
  }
  const built = statSync(trace.full).mtimeMs;
  for (const source of sources) {
    if (statSync(path.join(ROOT, source)).mtimeMs > built) {
      failures.push(`${source} is newer than the build - run \`npm run build\` first`);
    }
  }
}

// 1. nothing from the scratch folders, anywhere.
for (const { route, files } of traces) {
  const scratch = files.filter((file) => file.startsWith('Temp/') || file.startsWith('.claude/'));
  if (scratch.length > 0) failures.push(`${route} lists ${scratch.length} scratch files, e.g. ${scratch[0]}`);
}

// 2. the upload routes ship nothing of the project.
for (const route of ['api/music/upload/route', 'api/profile/avatar/route']) {
  const trace = traces.find((t) => t.route === route);
  const project = trace === undefined ? [] : trace.files.filter(own);
  if (project.length > 0) failures.push(`${route} lists ${project.length} project files, e.g. ${project[0]}`);
}

// 3. the artwork route still ships all of assets/.
const assetFiles = [];
(function list(dir) {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) list(rel);
    else assetFiles.push(rel);
  }
})('assets');
const assetTrace = traces.find((t) => t.route === 'assets/[...path]/route');
const shipped = new Set(assetTrace === undefined ? [] : assetTrace.files);
const missing = assetFiles.filter((file) => !shipped.has(file));
if (assetTrace === undefined) failures.push('no trace for assets/[...path]/route');
else if (missing.length > 0) failures.push(`/assets route is missing ${missing.length} artwork files, e.g. ${missing[0]}`);

if (failures.length > 0) {
  console.log(`FAIL ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`);
  for (const failure of failures.slice(1)) console.log(`     ${failure}`);
  process.exit(1);
}

console.log(
  `${traces.length} route file lists, none reach Temp/ or .claude/; the upload routes ship no project files; /assets ships all ${assetFiles.length} artwork files`,
);
