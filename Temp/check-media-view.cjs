/*
 * MEDIA's VIEW setting (Luke, 2026-11-14: "settings for the media ui that show the current view and a few others such as
 * a more thumbnail view like youtube has"), read from the files:
 *   node Temp/check-media-view.cjs
 *
 * - four views, LIST the default, kept in this browser only (guarded), and previews made of text characters
 * - every MEDIA result list follows it; GRID is a 4-across grid that narrows on smaller screens
 * - a row changes its picture box and what it shows, never how it plays: a video still goes through playFloating
 * - KINO and media-server cards keep their own card, the whole width of a GRID
 * - the summary line says the view
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const store = fs.readFileSync('app/lib/web/media-view.ts', 'utf8').replace(/\r\n/g, '\n');
assert.deepEqual([...store.matchAll(/value: '(\w+)', label: '(\w+)'/g)].map((m) => m[2]), ['LIST', 'GRID', 'LARGE', 'COMPACT'], 'the four views, in order');
assert.match(store, /: 'list';\n  \} catch \{\n    return 'list';/, 'LIST when nothing is kept or storage refuses');
assert.match(store, /try \{\n    window\.localStorage\.setItem\(KEY, view\);\n  \} catch/, 'keeping it is guarded');
assert.match(store, /\(\) => 'list',\n  \);/, "the server's draw is LIST, so the page and the browser agree");
assert.doesNotMatch(store, /supabase|fetch\(/, 'no database or network: this browser only');
assert.match(store, /grid grid-cols-4 [^']*max-sm:grid-cols-1/, 'GRID is about 4 across, one across on a narrow screen');
for (const line of store.match(/preview: \[[^\]]*\]/g)) assert.doesNotMatch(line, /<svg|<img|url\(/, 'previews are text characters, never drawn art');

const stream = fs.readFileSync('app/components/WebStream.tsx', 'utf8');
// Updated on purpose 2026-11-14: YOUR YOUTUBE is a view of its own now, its list laid out by VIEW like the others.
for (const list of ['aria-label="From your YouTube" className={viewListClass(view)}','<ul className={viewListClass(view)} aria-label={picksOrdered', 'className={viewListClass(view)}>{list.shown.map(renderRow)}']) {
  assert.ok(stream.includes(list), `a result list follows the view: ${list.slice(0, 40)}`);
}
assert.match(stream, /<span className=\{`block \$\{THUMB_BOX\[view\]\} shrink-0 overflow-hidden border border-ink-plate bg-paper`\}>/, 'the picture box is fixed per view, so a slow picture never moves the row');
assert.match(stream, /grid: 'aspect-video w-full'/, 'GRID pictures are 16:9');
assert.match(stream, /grid: 'text-sm line-clamp-2'/, 'GRID titles are two lines, then cut');
assert.match(stream, /item\.description && full && view !== 'grid'/, 'GRID and COMPACT leave the description out; LARGE shows more of it');
assert.match(stream, /\{` · \$\{viewLabel\(view\)\} VIEW`\}/, 'the SHOWING line says the view');
assert.equal((stream.match(/playFloating\(\{/g) ?? []).length, 1, 'a video still plays only through the floating player');
assert.ok(fs.readFileSync('app/components/WebPickedList.tsx', 'utf8').includes("className={viewListClass(view)}"), 'RECOMMENDED and DISCOVER follow it');
assert.ok(fs.readFileSync('app/components/WebCatalogueFinds.tsx', 'utf8').includes('<ul className={viewListClass(view)}>'), 'the tagged catalogue follows it');
assert.equal((fs.readFileSync('app/components/WebMediaRow.tsx', 'utf8').match(/rule-pixel col-span-full py-2/g) ?? []).length, 2, 'KINO and media-server cards keep their whole-width card in a GRID');

const key = fs.readFileSync('app/components/WebViewKey.tsx', 'utf8');
// Updated on purpose 2026-11-14 ("one initial expansion"): VIEW is a section of the FILTERS panel, folded like the others.
assert.match(stream, /<WebFilterFold id="media-filter-view" heading="VIEW" now=\{viewLabel\(view\)\}/, 'VIEW is a section of the FILTERS panel, saying which view is on');
assert.match(key, /aria-pressed=\{on\}/, 'each choice says whether it is on');
assert.match(key, /aria-hidden="true"[^>]*whitespace-pre/, 'the preview is decoration for screen readers; the label and line say it');

console.log('ok: MEDIA VIEW: four views, kept in this browser, every list follows it, playing unchanged');
