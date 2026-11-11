/*
 * The DEBASER reader (SPEC-reader.md, Luke 2026-11-11), offline: the pure parts and the book's route.
 *   npx tsc app/api/web/book/epub/route.ts app/lib/books/reader-look.ts app/lib/ui/themes.ts --outDir Temp/out-reader --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-reader.cjs
 *
 * - LOOK settings: anything saved is made safe (defaults for what's missing or wrong, steps kept in range)
 * - the CSS laid over a chapter carries the paper's colours and the font, and a hostile value can't break out of it
 * - each highlight colour, tinted on each paper as the reader lays it, keeps the book's words above 4.5:1
 * - an address opens at a CFI or a highlight, and nothing else; the %, minutes left and a bookmark's name
 * - the EPUB route: only a book with a Gutenberg number, only from www.gutenberg.org (a redirect elsewhere is refused),
 *   asked `no-store`, answered `private, no-store` (and the edge told the same), passed through as it came, the pictured
 *   editions first and the plain one when they're missing or too big, a body past the cap cut off, and nothing written:
 *   the route reaches no file, cache or database code, and no file is written while it answers.
 * The chapters' cleaning (no scripts, the Content-Security-Policy) needs a browser: Temp/drive-reader.cjs asks it live.
 * No book text is used: the bytes here are made up.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-reader');
const look = require(path.join(OUT, 'lib/books/reader-look.js'));
const { DEFAULT_THEME } = require(path.join(OUT, 'lib/ui/themes.js'));

/* 1. LOOK settings ---------------------------------------------------------------------------------- */
assert.deepEqual(look.readerSettingsFrom(null), look.DEFAULT_SETTINGS, 'nothing saved: the defaults');
assert.deepEqual(look.readerSettingsFrom('x'), look.DEFAULT_SETTINGS);
assert.deepEqual(look.readerSettingsFrom([1, 2]), look.DEFAULT_SETTINGS);
assert.deepEqual(
  look.readerSettingsFrom({ size: 999, spacing: -4, margin: 'huge', font: 'comic sans', paper: 'neon', extra: '<script>' }),
  { size: 200, spacing: 1.2, margin: 'normal', font: 'site', paper: 'dark' },
  'out of range is clamped, off-list takes the default, extras are dropped',
);
assert.deepEqual(look.readerSettingsFrom({ size: 133, spacing: 1.66, margin: 'wide', font: 'typewriter', paper: 'sepia' }), { size: 130, spacing: 1.7, margin: 'wide', font: 'typewriter', paper: 'sepia' }, 'onto the steps');
let s = look.DEFAULT_SETTINGS;
for (let n = 0; n < 30; n += 1) s = look.nudge(s, 'size', 1);
assert.equal(s.size, look.SIZE_MAX, 'A+ stops at the largest');
for (let n = 0; n < 30; n += 1) s = look.nudge(s, 'spacing', -1);
assert.equal(s.spacing, look.SPACING_MIN, 'spacing stops at the tightest');
assert.equal(look.nudge(look.DEFAULT_SETTINGS, 'spacing', 1).spacing, 1.7, 'a step is 0.1, with no float dust');
for (const margin of look.MARGINS) assert.match(look.marginLayout(margin).gap, /^\d+%$/);
console.log('  ok    LOOK settings');

/* 2. The CSS laid over a chapter --------------------------------------------------------------------- */
const faces = { site: '"__Plex_abc", "Courier New", monospace', typewriter: '"Courier New", monospace' };
const css = look.readerCss({ ...look.DEFAULT_SETTINGS, paper: 'sepia', size: 140, spacing: 1.8 }, { paper: '#f4ecd8', ink: '#4b3826' }, faces);
assert.match(css, /background: #f4ecd8 !important/, 'the paper');
assert.match(css, /color: #4b3826 !important/, 'the words');
assert.match(css, /font-size: 140% !important/, 'the size');
assert.match(css, /line-height: 1\.8 !important/, 'the spacing');
assert.match(css, /__Plex_abc/, 'the site face');
assert.match(css, /color-scheme: light/, 'sepia is a light page');
assert.doesNotMatch(look.readerCss({ ...look.DEFAULT_SETTINGS, font: 'book' }, { paper: '#000000', ink: '#ffffff' }, faces), /font-family/, "BOOK'S OWN leaves the book's type alone");
const hostile = look.readerCss(look.DEFAULT_SETTINGS, { paper: 'red; } body { display:none } x {', ink: '</style><script>' }, faces);
assert.doesNotMatch(hostile, /display:none \}|<script>|<\/style>/, 'a value read from the page can`t break out of its rule');
console.log('  ok    the chapter CSS');

/* 3. Highlight colours stay readable on every paper ------------------------------------------------ */
const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (hex) => [0, 1, 2].map((i) => channel(hex, i));
const tokens = DEFAULT_THEME.tokens;
let lowest = Infinity;
for (const paper of look.PAPERS) {
  const ground = rgb(tokens[`reader-${paper}-paper`]);
  const ink = rgb(tokens[`reader-${paper}-ink`]);
  assert.ok(ratio(ink, ground) >= 4.5, `${paper}: the words on the paper`);
  const tint = look.markTint(paper);
  for (const colour of look.HIGHLIGHT_COLOURS) {
    const mark = rgb(tokens[`mark-${colour}`]);
    const laid = ground.map((g, i) => {
      const top = tint.blend === 'multiply' ? g * mark[i] : mark[i];
      return g * (1 - tint.opacity) + top * tint.opacity;
    });
    const r = ratio(ink, laid);
    lowest = Math.min(lowest, r);
    assert.ok(r >= 4.5, `${paper} paper, ${colour} highlight: the words are ${r.toFixed(2)}:1, under 4.5`);
  }
}
for (const theme of [DEFAULT_THEME]) for (const colour of look.HIGHLIGHT_COLOURS) assert.ok(theme.tokens[`mark-${colour}`], `${colour} is a token`);
console.log(`  ok    every highlight colour on every paper (the lowest, ${lowest.toFixed(2)}:1)`);

/* 4. Where to open, and the small sums --------------------------------------------------------------- */
assert.deepEqual(look.spotFromSearch('at=epubcfi(/6/14!/4/2/10,/1:0,/1:45)'), { highlight: null, cfi: 'epubcfi(/6/14!/4/2/10,/1:0,/1:45)' });
assert.deepEqual(look.spotFromSearch('h=0f6c1d2e-aaaa-bbbb-cccc-1234567890ab'), { highlight: '0f6c1d2e-aaaa-bbbb-cccc-1234567890ab', cfi: null });
assert.deepEqual(look.spotFromSearch('at=12&h=x"><y'), { highlight: null, cfi: null }, 'an old paragraph number or an odd id opens nothing special');
assert.deepEqual(look.spotFromSearch(`at=epubcfi(${'/4'.repeat(400)})`), { highlight: null, cfi: null }, 'nor an overlong one');
assert.equal(look.percentOf(0.4567), 45);
assert.equal(look.percentOf(7), 100);
assert.equal(look.percentOf(NaN), 0);
assert.equal(look.minutesLeft(0.2), 'UNDER A MINUTE LEFT IN THE CHAPTER');
assert.equal(look.minutesLeft(11.2), '12 MIN LEFT IN THE CHAPTER');
assert.equal(look.minutesLeft(125), '2 H 5 MIN LEFT IN THE CHAPTER');
assert.equal(look.minutesLeft(undefined), '');
assert.equal(look.bookmarkLabel('  CHAPTER\nIV ', 12), 'CHAPTER IV · 12%');
assert.equal(look.bookmarkLabel('', 3), '3%');
assert.equal(look.bookmarkLabel('x'.repeat(300), 3).length, 120, 'a bookmark`s name fits the table');
assert.equal(look.quoteOf('  some\n\n words  ', 300), 'some words');
assert.equal(look.quoteOf('y'.repeat(400), 300).length, 300, 'a quote stays short');
console.log('  ok    where to open, and the small sums');

/* 5. The EPUB route --------------------------------------------------------------------------------- */
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'app/api/web/book/epub/route.ts'), 'utf8');
const booksSource = fs.readFileSync(path.join(__dirname, '..', 'app/lib/web/books.ts'), 'utf8');
for (const [name, source] of [['the route', routeSource], ['books.ts', booksSource]]) {
  assert.doesNotMatch(source, /from ['"](node:)?fs|from ['"]@supabase|unstable_cache|revalidate\s*=|writeFile|createWriteStream/, `${name} reaches no file, cache or database code`);
}

const writes = [];
for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']) {
  const original = fs[name];
  fs[name] = (...args) => {
    writes.push(name);
    return original.apply(fs, args);
  };
}
const { GET } = require(path.join(OUT, 'api/web/book/epub/route.js'));

let asked = [];
let answer = () => new Response('PK made-up bytes', { status: 200, headers: { 'content-type': 'application/epub+zip', 'content-length': '16' } });
globalThis.fetch = async (url, init) => {
  asked.push({ url: String(url), cache: init?.cache, redirect: init?.redirect, credentials: init?.credentials });
  return answer(String(url), asked.length);
};
const ask = (ref, address = '203.0.113.1') => GET(new Request(`https://debaser.site/api/web/book/epub?ref=${encodeURIComponent(ref)}`, { headers: { 'x-forwarded-for': address } }));

(async () => {
  let response = await ask('books:OL85892W-pg345');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'PK made-up bytes', 'passed through as it came');
  assert.equal(response.headers.get('cache-control'), 'private, no-store', 'answered private, no-store');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store', 'and the edge keeps nothing either');
  assert.equal(response.headers.get('content-type'), 'application/epub+zip');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, 'https://www.gutenberg.org/cache/epub/345/pg345-images-3.epub', 'Gutenberg`s own pictured EPUB');
  assert.equal(asked[0].cache, 'no-store', 'asked no-store');
  assert.equal(asked[0].redirect, 'manual', 'redirects followed by hand');
  assert.equal(asked[0].credentials, 'omit');

  for (const ref of ['books:OL85892W', 'audiobooks:271', 'books:OL1W-pg1/../x', 'https://evil.example/a.epub', '']) {
    asked = [];
    response = await ask(ref, '203.0.113.2');
    assert.ok(response.status === 400 || response.status === 404, `${ref || 'nothing'} is refused`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(asked.length, 0, `${ref || 'nothing'} fetches nothing`);
  }

  asked = [];
  answer = (url, n) => (n === 1 ? new Response(null, { status: 302, headers: { location: 'https://evil.example/book.epub' } }) : new Response('PK plain', { status: 200 }));
  response = await ask('books:OL85892W-pg345', '203.0.113.3');
  assert.ok(asked.every((each) => each.url.startsWith('https://www.gutenberg.org/')), 'a redirect off Gutenberg is never followed');
  assert.equal(await response.text(), 'PK plain', 'the next edition is taken instead');

  asked = [];
  answer = (url) =>
    url.endsWith('-images-3.epub')
      ? new Response('x', { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } })
      : url.endsWith('-images.epub')
        ? new Response('gone', { status: 404 })
        : new Response('PK the plain edition', { status: 200 });
  response = await ask('books:OL85892W-pg345', '203.0.113.4');
  assert.equal(await response.text(), 'PK the plain edition', 'too big or missing pictured editions: the plain one');
  assert.deepEqual(asked.map((each) => each.url.split('/').pop()), ['pg345-images-3.epub', 'pg345-images.epub', 'pg345.epub'], 'in that order');

  asked = [];
  answer = () => new Response('nope', { status: 404 });
  response = await ask('books:OL85892W-pg345', '203.0.113.5');
  assert.equal(response.status, 502, 'no edition answering is a plain refusal');
  assert.match(await response.text(), /PROJECT GUTENBERG DID NOT ANSWER/);

  // A body that runs past the cap (no length declared) is cut off, not delivered whole.
  const books = require(path.join(OUT, 'lib/web/books.js'));
  const big = new Uint8Array(1024 * 1024);
  let sent = 0;
  answer = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (sent > 45) return controller.close();
          sent += 1;
          controller.enqueue(big);
        },
      }),
      { status: 200 },
    );
  const opened = await books.openBookEpub('books:OL85892W-pg345', (url, init) => globalThis.fetch(url, init));
  await assert.rejects(new Response(opened.body).arrayBuffer(), 'a body past 40 MB is cut off');
  assert.ok(sent < 46, 'and the rest is never read');

  assert.deepEqual(writes, [], 'nothing was written to disk while the route answered');
  console.log('  ok    the EPUB route');

  /* 6. An Internet Archive book (Luke, 2026-11-11: its EPUB in the reader, the Archive's viewer otherwise) ---------- */
  const item = (files, metadata = {}) => JSON.stringify({ metadata: { identifier: 'made_up_book', mediatype: 'texts', title: 'Made Up', ...metadata }, files });
  const archive = (metadataBody, redirectTo = 'https://ia800300.us.archive.org/1/items/made_up_book/Made%20Up.epub') => (url) => {
    if (url.startsWith('https://archive.org/metadata/')) return new Response(metadataBody, { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://archive.org/download/')) return new Response(null, { status: 302, headers: { location: redirectTo } });
    if (url.startsWith('https://ia800300.us.archive.org/')) return new Response('PK archive bytes', { status: 200 });
    return new Response('no', { status: 404 });
  };
  const withEpub = item([
    { name: 'Made Up_lcp.epub', size: '900' },
    { name: 'Secret.epub', size: '10', private: 'true' },
    { name: 'Made Up.epub', size: '16' },
    { name: 'Made Up.pdf', size: '99' },
  ]);
  asked = [];
  answer = archive(withEpub);
  response = await ask('internet_archive:made_up_book', '203.0.113.6');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'PK archive bytes', 'the Archive book`s own EPUB, passed through');
  assert.equal(response.headers.get('cache-control'), 'private, no-store', 'never kept');
  assert.equal(asked[0].url, 'https://archive.org/metadata/made_up_book', 'its metadata asked fresh');
  assert.equal(asked[1].url, 'https://archive.org/download/made_up_book/Made%20Up.epub', 'the plain EPUB: not the LCP lending copy, not a private file');
  assert.equal(asked[2].url.split('/')[2], 'ia800300.us.archive.org', 'on to the Archive`s file server');
  assert.ok(asked.every((each) => each.cache === 'no-store'), 'every request asked no-store');

  asked = [];
  answer = archive(withEpub, 'https://evil.example/book.epub');
  response = await ask('internet_archive:made_up_book', '203.0.113.7');
  assert.equal(response.status, 502, 'a download sent anywhere but the Archive`s servers is refused');
  assert.ok(asked.every((each) => !each.url.includes('evil.example')), 'and never followed');

  asked = [];
  answer = archive(item([{ name: 'Made Up.pdf', size: '99' }, { name: 'Made Up_lcp.epub', size: '9' }]));
  response = await ask('internet_archive:made_up_book', '203.0.113.8');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'NO EPUB', viewer: true }, 'no EPUB anyone may read: the reader shows the Archive`s viewer');
  assert.equal(asked.length, 1, 'and no file is fetched');

  for (const [why, body] of [
    ['a lending-library item', item([{ name: 'Made Up.epub' }], { 'access-restricted-item': 'true' })],
    ['a film, not a book', item([{ name: 'Made Up.epub' }], { mediatype: 'movies' })],
    ['a dark item', JSON.stringify({ is_dark: true, files: [] })],
  ]) {
    asked = [];
    answer = archive(body);
    response = await ask('internet_archive:made_up_book', `203.0.113.${20 + why.length}`);
    assert.equal(response.status, 404, `${why} is refused`);
    assert.notEqual((await response.json()).viewer, true, `${why} gets no viewer either`);
    assert.equal(asked.length, 1, `${why}: nothing but the metadata is asked`);
  }
  for (const ref of ['internet_archive:../x', 'internet_archive:', 'internet_archive:a/b']) {
    asked = [];
    response = await ask(ref, '203.0.113.40');
    assert.ok(response.status === 400 || response.status === 404, `${ref} is refused`);
    assert.equal(asked.length, 0, `${ref} fetches nothing`);
  }
  assert.deepEqual(writes, [], 'still nothing written to disk');
  console.log('  ok    an Internet Archive book: its own EPUB, the viewer without one, never a lending copy');
  console.log('reader checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
