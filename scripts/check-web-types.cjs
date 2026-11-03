/*
 * WEB's static rules (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`). Reads source; compiles nothing.
 *
 * - the WEB types have no engagement field (likes, views, downloads, ratings, followers, comments...)
 * - no browser file reaches `app/lib/web/safe-fetch.ts`, `app/lib/web/adapters/`, `app/lib/web/search/` or `app/lib/web/ingest.ts`, directly or through
 *   other imports: remote fetching is server-side only
 * - WEB code never renders HTML (`dangerouslySetInnerHTML`) and reads no NEXT_PUBLIC value for fetching
 * - the page's outbound links, thumbnails and player keep their safety attributes
 */
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { dirname, join, relative, resolve } = require('node:path');

const ROOT = join(__dirname, '..');
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/* ------------------------------------------------------------------ no engagement fields */
const FORBIDDEN =
  /\b(likes?|likeCount|views?|viewCount|downloads?|downloadCount|ratings?|avgRating|stars?|followers?|followerCount|following|comments?|commentCount|plays?|playCount|favou?rites?|favou?riteCount|subscribers?|subscriberCount|reviews?|score|popularity|engagement)\??\s*:/i;
const types = read('app/lib/web/types.ts');
// Only the type bodies: comments are allowed to *name* what is not kept.
const code = types.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const bodies = [...code.matchAll(/export type (WebItem|WebSource)\s*=\s*\{([\s\S]*?)\n\};/g)];
ok(bodies.length === 2, 'WebItem and WebSource are found in types.ts');
for (const [, name, body] of bodies) {
  const hit = body.match(FORBIDDEN);
  ok(!hit, `${name} has an engagement field: ${hit && hit[0]}`);
}
ok(/\btitle: string;/.test(bodies[0][2]), 'the WebItem body was actually read (it has title)');

/* ------------------------------------------------------------------ server-only fetching */
const APP = join(ROOT, 'app');
const SERVER_ONLY = [
  resolve(APP, 'lib/web/safe-fetch.ts'),
  resolve(APP, 'lib/web/adapters'),
  resolve(APP, 'lib/web/ingest.ts'),
  // Search everywhere (SPEC-web-search.md): its providers fetch, and the YouTube key is read beside them.
  resolve(APP, 'lib/web/search'),
];
const isServerOnly = (file) => SERVER_ONLY.some((path) => file === path || file.startsWith(path + '\\') || file.startsWith(path + '/'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(resolve(full));
  }
  return out;
}

/** A relative import, or the tsconfig `@/` alias (the project root); packages are not followed. */
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const importsOf = new Map();
function imports(file) {
  if (!importsOf.has(file)) {
    const text = readFileSync(file, 'utf8');
    // `import x from '...'`, `export ... from '...'`, a bare `import '...'`, and `import('...')`.
    const specs = [
      ...text.matchAll(/(?:import|export)[^'";]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1] ?? m[2]);
    importsOf.set(file, specs.map((spec) => resolveImport(file, spec)).filter(Boolean));
  }
  return importsOf.get(file);
}

const files = walk(APP);
const clientFiles = files.filter((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')));
ok(clientFiles.length > 10, `client files were found (${clientFiles.length})`);
ok(clientFiles.some((file) => file.endsWith('WebStream.tsx')), 'WebStream is among them');

for (const start of clientFiles) {
  const seen = new Set([start]);
  const queue = [[start, [start]]];
  while (queue.length > 0) {
    const [file, path] = queue.shift();
    for (const next of imports(file)) {
      if (isServerOnly(next)) {
        fail(`browser code reaches ${relative(ROOT, next)}: ${path.map((p) => relative(ROOT, p)).join(' -> ')}`);
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([next, [...path, next]]);
      }
    }
  }
  passed += 1;
}

/* ------------------------------------------------------------------ no HTML, no public fetching config */
// The page is /archive since WEB was renamed ARCHIVE (2026-11-03); DEBASER.SITE's rows are drawn by WebSiteFiles.tsx.
const webFiles = [...walk(join(APP, 'lib', 'web')), resolve(APP, 'components/WebStream.tsx'), resolve(APP, 'components/WebSiteFiles.tsx'), resolve(APP, 'archive/page.tsx')];
for (const file of webFiles) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(text), `${relative(ROOT, file)} renders HTML`);
}
const safeFetch = read('app/lib/web/safe-fetch.ts');
for (const file of [resolve(APP, 'lib/web/safe-fetch.ts'), ...walk(join(APP, 'lib', 'web', 'adapters')), ...walk(join(APP, 'lib', 'web', 'search'))]) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/NEXT_PUBLIC_/.test(text), `${relative(ROOT, file)} reads a NEXT_PUBLIC value`);
}
ok(/WEB_FETCH_CONTACT/.test(safeFetch), 'the User-Agent contact comes from the server-only env var');

/* ------------------------------------------------------------------ the page's safety attributes */
const stream = read('app/components/WebStream.tsx');
const anchors = [...stream.matchAll(/<a\b[\s\S]*?>/g)].map((m) => m[0]);
ok(anchors.length >= 2, 'the page has its outbound links');
for (const anchor of anchors) {
  ok(/rel="noopener noreferrer nofollow"/.test(anchor), `an outbound link lacks rel="noopener noreferrer nofollow": ${anchor.slice(0, 60)}`);
  ok(/href=\{(link|licence)\}/.test(anchor), 'an outbound link uses a checked address');
}
// What rowAddresses lets through is tested on hostile items in check-web-internet-archive.cjs; here, that the
// row draws only what it returned.
// The row passes the PeerTube instances from the public index (SPEC-web-search.md); rowAddresses still holds
// every address to the platform's path shapes (check-web-search-peertube.cjs).
ok(/const addresses = rowAddresses\(item, extraHosts\)/.test(stream), 'the row takes its addresses from rowAddresses');
ok(/src=\{thumb\}/.test(stream) && /const thumb = thumbFailed \? null : addresses\.thumb;/.test(stream), 'the thumbnail is the checked one');
// 2026-11-03: the row's language rides along for English subtitles (SPEC-subtitles.md).
ok(/src=\{startingEmbed\(embed, item\.platform(, contentLanguage\(item\))?\)\}/.test(stream) && /const \{ link, embed, licence \} = addresses;/.test(stream), 'the player and links are the checked ones (the player asked to start: check-web-audio.cjs)');
ok(!/item\.(url|thumbnailUrl|embedUrl|licenseUrl)\b/.test(stream.replace(/\/\*[\s\S]*?\*\//g, '')), 'no raw item address is used in the page');
const img = stream.match(/<img\b[\s\S]*?\/>/);
ok(img && /referrerPolicy="no-referrer"/.test(img[0]) && /loading="lazy"/.test(img[0]), 'the thumbnail is lazy and sends no referrer');
const iframe = stream.match(/<iframe\b[\s\S]*?\/>/);
// One exception, live-checked 2026-10-31 in Edge: YouTube's player shows "Error 153" and will not play with no
// referrer, and plays with the origin only. So YouTube alone gets strict-origin (never the path); every other
// player still sends nothing.
ok(
  iframe && /sandbox="[^"]*"/.test(iframe[0]) && /referrerPolicy=\{item\.platform === 'youtube' \? 'strict-origin' : 'no-referrer'\}/.test(iframe[0]),
  'the player is sandboxed and sends no referrer (YouTube: its origin only)',
);
ok(iframe && !/unsafe-url|no-referrer-when-downgrade|origin-when-cross-origin/.test(iframe[0]), 'no player is ever sent the page path');
ok(iframe && /sandbox="allow-scripts allow-same-origin"/.test(iframe[0]), 'the player sandbox is exactly allow-scripts allow-same-origin (live-checked; widen only with evidence)');
ok(/\{playing && embed \?/.test(stream), 'the player exists only after PLAY');

console.log(`ok: ${passed} assertions (WEB types, server-only fetching, page safety)`);
