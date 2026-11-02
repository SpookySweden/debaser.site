/*
 * For the media-server checks: compiles a copy of app/lib with a FIXED pair of test servers in
 * media-servers.ts (between the SERVERS markers), so the rules are tested the same way whatever servers Luke
 * has listed (the "Debaser Servers" program rewrites that list). His real list is checked on its own, in
 * check-web-media.cjs, against the code as it is.
 *
 *   const out = compileWithTestServers('out-web-media-fixed', ['lib/web/media-titles.ts', ...]);
 *   require(join(out, 'lib', 'web', 'media-titles.js'));
 */
const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = join(__dirname, '..');

const TEST_SERVERS = [
  "  { id: 'server_1', label: 'SERVER 1', base: 'https://placeholder-server1.xyz', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', series: '/debaser/play/tv/{tmdb}', other: '/debaser/play/item/{id}' } },",
  // Server 2 has no whole-series player, so the checks see a server without one.
  "  { id: 'server_2', label: 'SERVER 2', base: 'https://placeholder-server2.xyz', listPath: '/debaser/list.json', play: { movie: '/debaser/play/movie/{tmdb}', tv: '/debaser/play/tv/{tmdb}/{season}/{episode}', other: '/debaser/play/item/{id}' } },",
];

/** media-servers.ts with the test pair between the markers (extra lines, e.g. a fake server, go after them). */
function withTestServers(source, extra = []) {
  const text = source.replace(/\r\n/g, '\n');
  const start = text.indexOf('// SERVERS-START\n');
  // The END marker may sit at any indent (the Debaser Servers program and hand edits differ); keep its line whole.
  const end = text.search(/^[ \t]*\/\/ SERVERS-END/m);
  if (start < 0 || end < start) throw new Error('media-servers.ts has lost its SERVERS-START / SERVERS-END markers');
  return `${text.slice(0, start)}// SERVERS-START\n${[...TEST_SERVERS, ...extra].join('\n')}\n${text.slice(end)}`;
}

function compileWithTestServers(outName, entries, extra = []) {
  const base = join(ROOT, 'Temp', outName);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(join(base, 'src'), { recursive: true });
  cpSync(join(ROOT, 'app', 'lib'), join(base, 'src', 'lib'), { recursive: true });
  const file = join(base, 'src', 'lib', 'web', 'media-servers.ts');
  writeFileSync(file, withTestServers(readFileSync(file, 'utf8'), extra));
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [tsc, ...entries.map((entry) => join(base, 'src', entry)), '--outDir', join(base, 'out'), '--rootDir', join(base, 'src'), '--module', 'commonjs', '--target', 'es2022', '--lib', 'es2022,dom', '--skipLibCheck', '--esModuleInterop', '--moduleResolution', 'node'],
    { stdio: 'pipe' },
  );
  return join(base, 'out');
}

module.exports = { compileWithTestServers, withTestServers, TEST_SERVERS };
