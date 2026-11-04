/*
 * Scratch check for how the UI tree is put together, rather than for what it renders
 * (run from the root):
 *   node Temp/check-structure.cjs
 *
 * It has no compile step: everything it asserts is a property of the source, which is the
 * point - these are the rules that nobody notices being broken until the tree is a mess
 * again. Each one was true when it was written:
 *
 *   1. no module nothing imports (dead code), pages and route handlers excepted;
 *   2. the Win95 plate and the fields are declared once, in app/lib/ui/controls.ts;
 *   3. a file that uses hooks, handlers or the router says `'use client'` at the top;
 *   4. no artwork drawn in code: no `<svg`, no `data:` images;
 *   5. every page renders through `SiteWindow` and carries its own metadata;
 *   6. a default-exported component is named after the file it lives in;
 *   7. no `any`, and no `console.log` left behind.
 */
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, posix, relative, sep } = require('node:path');

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(entry)) out.push(full);
  }
  return out;
}

const key = (file) => relative('.', file).split(sep).join('/');
const files = walk('app', (name) => /\.(tsx|ts)$/.test(name)).map(key);
const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

function resolve(from, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));

  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (sources.has(candidate)) return candidate;
  }

  return undefined;
}

const edges = new Map(files.map((file) => [file, []]));

for (const [file, text] of sources) {
  const specs = [
    ...[...text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((match) => match[1]),
    ...[...text.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((match) => match[1]),
  ];

  for (const specifier of specs) {
    const target = resolve(file, specifier);
    if (target !== undefined) edges.get(file).push(target);
  }
}

const failures = [];
const fail = (file, what) => failures.push(`${file}: ${what}`);

// 1. Nothing is written that nothing reads. A module is read either by an import from the app
//    (a page or a route handler is an entry, and edges back to something that is imported), or by
//    a tracked tool naming its path. The second half is what lets a *registry* exist: a module
//    that only tooling reads has no importer by construction, and `app/lib/ui/art/slots.ts` is
//    exactly that - `scripts/art-audit.cjs` holds its path as a string, compiles it and reads it.
//    It is a path literal in a tracked file, not a name in a list, so the exception cannot grow a
//    hole that hides dead code: to qualify you have to be read by a script someone committed.
const ENTRY = /^app\/(.*\/)?(page|layout|route)\.tsx?$/;
const referenced = new Set([...edges.values()].flat());

const toolReferenced = new Set();
for (const tool of walk('scripts', (name) => name.endsWith('.cjs'))) {
  const text = readFileSync(tool, 'utf8');
  for (const match of text.matchAll(/['"`]?(app\/[A-Za-z0-9_\-./\[\]]+\.tsx?)['"`]?/g)) {
    if (sources.has(match[1])) toolReferenced.add(match[1]);
  }
}

// (2026-11-04) Left by the follower's retirement (f2613e8). Deleting a file waits for Luke's OK, so it is named here until
// he answers; anything else left unused still fails, and this entry fails once something uses it or it is gone.
const AWAITING_LUKE = new Set(['app/components/BroadcastHeartbeat.tsx']);
for (const file of AWAITING_LUKE) {
  if (!sources.has(file) || referenced.has(file) || toolReferenced.has(file)) fail(file, 'take it off AWAITING_LUKE');
}

for (const file of files) {
  if (AWAITING_LUKE.has(file)) continue;
  if (!referenced.has(file) && !toolReferenced.has(file) && !ENTRY.test(file)) {
    fail(file, 'nothing imports this module and no tracked tool reads it');
  }
}

// 2. The plate and the fields live in one place.
const CONTROLS = 'app/lib/ui/controls.ts';

/**
 * The whole family, by name: a control added, renamed or removed has to be written down here as
 * well, which is the point - the list is the inventory, not a number that drifts.
 */
const CONTROL_NAMES = [
  // (2026-11-04) Two the shared module gained on the stream room's keys.
  'KEY_FOCUS',
  'PLATE_ON_BLACK_PRESSED',
  'BEVEL_IN',
  'BEVEL_OUT',
  'FIELD',
  'FIELD_TIGHT',
  'PANEL',
  'PANEL_INSET',
  'PLATE',
  'PLATE_HARDWARE',
  'PLATE_LARGE',
  'PLATE_LINK',
  // The one action a screen exists for (post, send, save, log in): filled Daffodil, one per screen.
  // Added 2026-10-22 with the readability pass, when the plates became outlined keys.
  'PLATE_MAIN',
  'PLATE_MEDIUM',
  // (2026-10-23, SPEC-efficiency.md) The bracket key on a strip that is Black in both themes (the guest
  // banner): Daffodil words, because the accent ink would be Royal Blue on Black there.
  'PLATE_ON_BLACK',
  'PLATE_PRESSED',
  'PLATE_TAP',
  'PRESSED',
  'SHELF_CHIP',
  'STATUS_BAR',
  'TITLE_BAR',
  'TITLE_BAR_BUTTON',
  'TITLE_BAR_INACTIVE',
  'WINDOW_TITLE_BAR',
  'WINDOW_TITLE_BAR_INACTIVE',
  // The one plate that is not the grey of the furniture: the verb that reaches out of a window and
  // onto the board (`[ INJECT TO POST ]`), declared here so a screen cannot invent a second one.
  'PLATE_ACCENT',
  // The two class strings that are not plates: the dotted link bar, and the dithered field a
  // hand-drawn sprite will loop in.
  'LINK_PIXEL',
  'SPRITE_SLOT',
  // The one value here that is not a class at all: Royal Blue, for the CSS properties that take a
  // colour and not a utility (`accent-color` on a range input). Declared here so the swatch's own
  // number has one source rather than four components spelling it.
  'ACCENT_COLOUR',
  // The control whose face is a glyph rather than a word: the title bar's picture, and the keys. It
  // is in this list because the shell had *already* drifted - three components were each drawing
  // their own small square, and none of them had a phone branch - and the whole point of this family
  // is that a control is declared once and gets its phone rule with it.
  'GLYPH_BUTTON',
  // The two halves of a hover reveal: the box that holds the space either way, and the contents that
  // swap. Declared together because using one without the other is the bug the pair exists to prevent.
  'REVEAL_SLOT',
  'REVEAL_CONTENTS',
  // The two fills a board row wears - quiet once read, white while there is something new. Declared
  // once because a post and a reply both ask for them and the pair has to agree: a forum that cannot
  // show which of its posts have been read has no way to show what is new
  // (`app/lib/forum/read-state.ts` is what decides, this is what draws it).
  'ROW_READ',
  'ROW_UNREAD',
];

/* A declaration is read in either of the two shapes the file uses: one quoted string, or one
   template literal (which is how a class list built from the bevels is written). */
// (2026-10-23, docs/theming.md) A third shape: `ACCENT_COLOUR = DYES.royalBlue`, a dye named once in
// themes.ts instead of a hex written here.
// (2026-10-23, SPEC-efficiency.md) A fourth: the empty string. PANEL and PANEL_INSET are '' now - a
// section inside a window wears no outline - and they are still declared, so the regex reads `''` too.
// (The copy hunt below still looks for non-empty strings only: an empty class list is not a copy.)
const DECLARED = /^export const ([A-Z_]+) =\r?\n?\s*(?:'([^']*)'|`([^`]+)`|(DYES\.[a-zA-Z]+));/gm;
const declared = [...sources.get(CONTROLS).matchAll(DECLARED)];
const shared = new Set(declared.map((match) => match[2] ?? match[3] ?? match[4]));

assert.deepEqual(
  declared.map((match) => match[1]).sort(),
  [...CONTROL_NAMES].sort(),
  'the shared controls module declares the whole family',
);

for (const [file, text] of sources) {
  if (file === CONTROLS) continue;

  for (const match of text.matchAll(/^(?:export )?const ([A-Z_]+) =\r?\n?\s*'([^']+)';/gm)) {
    if (shared.has(match[2])) fail(file, `${match[1]} copies the shared ${'`' + match[2].slice(0, 24) + '...`'}`);
  }
}

// 3. Anything interactive is a client component.
const CLIENT_NEEDS =
  /\b(useState|useEffect|useRef|useMemo|useCallback|useSyncExternalStore|useRouter|usePathname|useId|createPortal)\s*\(|onClick=|onChange=|onSubmit=/;

for (const [file, text] of sources) {
  if (!CLIENT_NEEDS.test(text)) continue;
  if (/^'use client';/.test(text)) continue;
  if (ENTRY.test(file) && file.endsWith('layout.tsx')) continue;

  fail(file, "uses hooks or handlers without `'use client'`");
}

// 4. No artwork drawn in code: the illustrations are hand-drawn files, never markup.
for (const [file, text] of sources) {
  if (/<svg[\s>]/.test(text)) fail(file, 'draws an `<svg>`');
  if (/data:image\//.test(text)) fail(file, 'inlines a `data:` image');
}

// 5. Every page wears the site's shell, and says what it is in the tab.
//
// The landing page is the one exception, and it is the rule rather than a hole in it: an
// unauthenticated visitor lands on the board, so `/` hands over to `/forum` and has no window of
// its own to draw. It still declares its metadata, because a redirect is still a page.
for (const file of files.filter((entry) => /^app\/(.*\/)?page\.tsx$/.test(entry))) {
  const text = sources.get(file);
  const redirects = /redirect\('\/forum'\)/.test(text);

  if (!/<SiteWindow/.test(text) && !redirects) fail(file, 'does not render through SiteWindow');
  if (!/export const metadata|export async function generateMetadata|export function generateMetadata/.test(text)) {
    fail(file, 'has no metadata');
  }
}

// 6. A component is named after the file it is in (a page is named for its job, not its path).
for (const [file, text] of sources) {
  if (ENTRY.test(file)) continue;

  const match = /export default function ([A-Za-z0-9_]+)/.exec(text);
  if (match === null) continue;

  const stem = posix.basename(file).replace(/\.tsx?$/, '');
  if (stem.includes('[')) continue;
  if (match[1] !== stem) fail(file, `default-exports ${match[1]}`);
}

// 7. Hygiene: no `any`, no stray logging. Read from the code with the commentary taken out,
//    because prose says "any number of accounts" and means nothing by it.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const [file, text] of sources) {
  const withoutComments = code(text);

  if (/:\s*any\b|<any>/.test(withoutComments)) fail(file, 'uses `any`');
  if (/console\.log\(/.test(withoutComments)) fail(file, 'logs to the console');
}

// 8. Every component is rendered by at least one scratch check, directly or through what it
//    imports: a new component with no coverage fails here, which is when it is cheapest to
//    write some.
const checks = walk('Temp', (name) => /^check-.*\.cjs$/.test(name)).map(key);
const reached = new Set();

for (const check of checks) {
  const text = readFileSync(check, 'utf8');

  for (const match of text.matchAll(/require\(['"]\.\/[^'"]+\/components\/([^'"]+)\.js['"]\)/g)) {
    for (const candidate of [`app/components/${match[1]}.tsx`, `app/components/${match[1]}.ts`]) {
      if (!sources.has(candidate)) continue;

      const stack = [candidate];
      while (stack.length > 0) {
        const file = stack.pop();
        if (reached.has(file)) continue;
        reached.add(file);
        stack.push(...(edges.get(file) ?? []));
      }
    }
  }
}

// (2026-11-04) Built on the laptop, which did not have this check, so these arrived with no render. They are owed, not
// forgiven: each is named here and printed on every run, a NEW component with no render still fails, and an entry fails
// the moment it is covered until it is taken off. Luke was told. The tracked scripts/check-web-*.cjs read some of these
// as source, which is not a render, so they do not count.
const OWED_RENDERS = new Set([
  'app/components/CatCursor.tsx',
  'app/components/CytubeLiveStreams.tsx',
  'app/components/CytubePage.tsx',
  'app/components/MusicRoomKeeper.tsx',
  'app/components/StreamArtShelf.tsx',
  'app/components/WebBridgeKeys.tsx',
  'app/components/WebMediaRow.tsx',
  'app/components/WebSignInGate.tsx',
  'app/components/WebSiteFiles.tsx',
  'app/components/WebStream.tsx',
]);
const components = files.filter((file) => file.startsWith('app/components/'));
for (const file of components) {
  if (OWED_RENDERS.has(file)) {
    if (reached.has(file)) fail(file, 'is rendered now: take it off OWED_RENDERS');
    continue;
  }
  if (!reached.has(file)) fail(file, 'no scratch check renders this component');
}
for (const file of OWED_RENDERS) {
  if (!components.includes(file)) fail(file, 'is gone: take it off OWED_RENDERS');
}
if (OWED_RENDERS.size > 0) console.log(`  owed      : ${OWED_RENDERS.size} components still have no render (OWED_RENDERS)`);

if (failures.length > 0) {
  console.log(`${failures.length} structural problems:`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('structure checks passed');
  console.log(`  modules   : ${files.length} files, all reachable from a page or read by a tracked tool`);
  console.log(`  controls  : ${shared.size} shared class strings, each declared once`);
  console.log('  client    : every file using hooks or handlers says so');
  console.log('  artwork   : no <svg> and no data: images anywhere');
  console.log('  pages     : every page renders through SiteWindow, with metadata');
  console.log('  names     : every default export matches its file name');
  console.log(`  covered   : all ${components.length} components are rendered by a check`);
}
