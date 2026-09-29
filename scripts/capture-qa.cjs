/*
 * Captures the built site's HTML, one file per route, into Temp/qa/ - the snapshot the QA audit reads.
 *
 *   npm run build
 *   npm run capture           # build must already be done; starts its own server on :3210
 *   npm run audit              # then reads what it wrote
 *
 * Tracked in `scripts/` rather than kept in `Temp/`, for the same reason as `read-site.cjs`: a viewer
 * that a fresh clone does not have is not a guarantee. The *output* is scratch (`Temp/qa/` is
 * gitignored); the ability to produce it is part of the repository.
 *
 * Why this exists. `scripts/qa-audit.cjs` is a reader: it reports unnamed fields, sub-thumb controls,
 * small text and contrast failures from HTML *files*. What it does not do is produce them, and for a
 * while those files were written by hand - which meant they went stale silently. On 2026-09-25 the
 * captures were two days older than the components, so the audit reported on a build nobody was
 * shipping and the pass meant nothing. This is the thing that closes that gap.
 *
 * What it captures is the HTML a visitor's browser gets *before any JavaScript runs*: no hydration,
 * no data from the database, every read still showing its `READING...` placeholder. That is deliberate
 * and it is what makes the audit worth running - it is the same bytes a screen reader and a crawler
 * meet, so a control with no label or a tap target too small is visible here and hidden in a
 * screenshot. What it cannot show is anything that fills in afterwards, which is why the audit also
 * ends by listing the questions a person has to walk through.
 *
 * The routes are read from `scripts/qa-audit.cjs` itself rather than repeated here, so the two cannot
 * disagree about what is being audited. A route that fails to capture is reported and the run exits
 * non-zero, rather than quietly leaving yesterday's file in place for the audit to read.
 */
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join('Temp', 'qa');

/** The route list, taken from the audit so there is one of them. */
function routes() {
  // Read from this file's own folder, not the scratch tree: the route list is part of the repository.
  const audit = readFileSync(join(__dirname, 'qa-audit.cjs'), 'utf8');
  const block = /const ROUTES = \[([\s\S]*?)\];/.exec(audit)?.[1];

  if (block === undefined) {
    throw new Error('could not read ROUTES out of scripts/qa-audit.cjs - has it been renamed?');
  }

  return [...block.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map(([, name, path]) => ({ name, path }));
}

/** Is something already listening? A refused socket is the answer that matters, not the error text. */
async function up() {
  try {
    const response = await fetch(`${BASE}/forum`, { signal: AbortSignal.timeout(4000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

(async () => {
  mkdirSync(OUT, { recursive: true });

  let server = null;

  if (!(await up())) {
    console.log(`starting next start on :${PORT} ...`);
    /**
     * `node node_modules/next/dist/bin/next`, not `npx next` with `shell: true`.
     *
     * The shim version had two faults and both were visible: Node 24 warns about `shell: true`
     * (`DEP0190` - arguments are concatenated, not escaped), and `server.kill()` killed the `cmd.exe`
     * that *wrapped* the server rather than the server, so a `next start` was left listening on :3210
     * after every capture. A leftover server is worse than untidy here: the next capture sees a
     * listener that answers, decides the site is already up, and captures whatever that stale build
     * serves - which is the exact staleness this script exists to prevent. Spawning the CLI entry with
     * `process.execPath` gives one process, and killing it kills the server. Same reasoning, and the
     * same fix, as `scripts/db-cli.cjs`.
     */
    server = spawn(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], {
      stdio: 'ignore',
      detached: false,
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await up()) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!(await up())) {
    console.error(`nothing is serving ${BASE}.`);
    console.error('');
    console.error('Run `npm run build` first, then either:');
    console.error(`  npx next start -p ${PORT}        # in another shell`);
    console.error('or re-run this and let it start one:  npm run capture');
    process.exitCode = 1;
    return;
  }

  const list = routes();
  let failed = 0;

  console.log(`capturing ${list.length} route(s) into ${OUT}\n`);

  for (const { name, path } of list) {
    try {
      const response = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache' } });

      if (!response.ok) {
        // A 404 is a real failure here: the audit would otherwise read whatever file was already
        // there under this name, which is exactly the staleness this script exists to prevent.
        console.log(`  FAIL  ${name.padEnd(10)} ${path}  -> ${response.status}`);
        failed += 1;
        continue;
      }

      const html = await response.text();
      writeFileSync(join(OUT, `${name}.html`), html, 'utf8');
      console.log(`  ok    ${name.padEnd(10)} ${path.padEnd(28)} ${html.length} bytes`);
    } catch (caught) {
      console.log(`  FAIL  ${name.padEnd(10)} ${path}  -> ${caught instanceof Error ? caught.message : 'unknown'}`);
      failed += 1;
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`${list.length - failed}/${list.length} captured. The failures must be looked at before`);
    console.log('the audit is trusted - a missing file is a route the audit silently skips.');
    process.exitCode = 1;
  } else {
    console.log(`${list.length}/${list.length} captured. Run \`npm run audit\` against them now -`);
    console.log('and re-capture after every change to a component, or the audit reads yesterday`s build.');
  }

  if (server !== null) server.kill();
})();
