/*
 * npm run tags:build: runs TAG STATION's real build (app/lib/tag-station/graph.ts: closeness, then the map) on the mock
 * items and writes the answer to Temp/tag-station-graph.json, so the map's data can be read without a server.
 *
 *   npm run tags:build                       the mock
 *   npm run tags:build -- --from <file.json> rows from a file: [{ "item": { ...a WEB item... }, "claudeWords": [...] }]
 *
 * Reads no database and writes nothing but that one scratch file (SPEC-tag-station.md).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Temp', 'tag-station-build-out');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(
  process.execPath,
  [TSC, 'app/lib/tag-station/graph.ts', 'app/lib/tag-station/mock-tag-repository.ts', '--rootDir', 'app/lib', '--outDir', OUT, '--module', 'commonjs', '--target', 'es2020', '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--strictNullChecks'],
  { cwd: ROOT, stdio: 'inherit' },
);

const { buildStationGraph } = require(path.join(OUT, 'tag-station', 'graph.js'));
const { MOCK_STATION_ROWS } = require(path.join(OUT, 'tag-station', 'mock-tag-repository.js'));

const fromAt = process.argv.indexOf('--from');
const rows = fromAt === -1 ? MOCK_STATION_ROWS : JSON.parse(fs.readFileSync(process.argv[fromAt + 1], 'utf8'));

const started = Date.now();
const graph = buildStationGraph(rows);
const took = Date.now() - started;

const target = path.join(ROOT, 'Temp', 'tag-station-graph.json');
fs.writeFileSync(target, JSON.stringify(graph));
const close = graph.tags.reduce((sum, tag) => sum + tag.partners.filter((partner) => partner.close).length, 0) / 2;
console.log(`${graph.items.length} items, ${graph.tags.length} words, ${close} close pairs, built in ${took}ms, ${Math.round(fs.statSync(target).size / 1024)}KB.`);
console.log(`Wrote ${path.relative(ROOT, target)}.`);
