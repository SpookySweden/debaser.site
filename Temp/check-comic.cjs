/*
 * COMIC, phase 1 (SPEC-comic.md): the plain rules, the panel guess, the mock store's own copy of the release rule, and the
 * migration's locks.
 *   npx tsc app/lib/comic/rules.ts app/lib/comic/panel-guess.ts app/lib/comic/mock-comic-repository.ts app/lib/comic/forum.ts --rootDir app --outDir Temp/comic-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comic.cjs
 *
 * What a browser shows (the reader's column, the studio, the panel pane) is driven on a local mock server:
 * Temp/browse/drive-comic.cjs. Whether a visitor really can't read an unreleased page row or file is a live-database
 * question: Temp/check-comic-live.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'comic-out');
const ROOT = path.join(__dirname, '..');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

(async () => {
  const rules = require(path.join(OUT, 'lib/comic/rules.js'));
  const { guessPanels } = require(path.join(OUT, 'lib/comic/panel-guess.js'));

  // ---------- reading order, numbers, addresses ----------
  const contents = {
    volumes: [{ id: 'v1', number: 1, title: '' }],
    chapters: [
      { id: 'c2', volumeId: 'v1', number: 2, title: '', coverPageId: null },
      { id: 'c1', volumeId: 'v1', number: 1, title: '', coverPageId: 'p3' },
    ],
    pages: [
      { id: 'p3', chapterId: 'c1', position: 2 },
      { id: 'p1', chapterId: 'c1', position: 0 },
      { id: 'p2', chapterId: 'c1', position: 1 },
      { id: 'q1', chapterId: 'c2', position: 5 },
    ],
  };
  assert.deepEqual(rules.chapterPages(contents, 'c1').map((p) => p.id), ['p1', 'p2', 'p3'], 'pages read in position order');
  assert.equal(rules.pageNumber(contents, { id: 'p3', chapterId: 'c1' }), 3, 'a page is numbered inside its chapter');
  assert.equal(rules.pageNumber(contents, { id: 'q1', chapterId: 'c2' }), 1, 'numbering starts again in each chapter');
  assert.deepEqual(rules.chaptersInOrder(contents).map((c) => c.number), [1, 2]);
  assert.equal(rules.coverOf(contents, contents.chapters[1]).id, 'p3', 'the chosen cover');
  assert.equal(rules.coverOf(contents, contents.chapters[0]).id, 'q1', 'no cover chosen: the first page');
  assert.equal(rules.nextChapter(contents, 1).number, 2);
  assert.equal(rules.nextChapter(contents, 2), null);
  assert.equal(rules.pagePath(3, 12), '/comic/3/12');
  assert.equal(rules.pagePath(3, 12, 'abc'), '/comic/3/12?panel=abc');
  assert.equal(rules.pageFileUrl({ id: 'x', version: 4 }, 'zoom'), '/api/comic/page/x/zoom?v=4');
  assert.deepEqual(rules.storagePaths('id', 2, 'png'), { original: 'original/id/v2.png', reading: 'reading/id/v2.jpg', zoom: 'zoom/id/v2.jpg' });
  assert.deepEqual(rules.parsePlace('3/12'), { chapter: 3, page: 12 });
  assert.equal(rules.parsePlace('3/x'), null);
  assert.equal(rules.parsePlace(null), null);
  assert.equal(rules.nextNumber([{ number: 1 }, { number: 4 }]), 5);
  assert.equal(rules.nextNumber([]), 1);

  // The alert's words (the database writes the same; SPEC-comic.md, Q12).
  assert.equal(rules.releaseTitle(3, [2, 2, 2]), '3 NEW PAGES IN CHAPTER 2');
  assert.equal(rules.releaseTitle(1, [2]), 'NEW PAGE IN CHAPTER 2');
  assert.equal(rules.releaseTitle(4, [2, 3]), '4 NEW PAGES');

  // ---------- the panel guess ----------
  // A white page with black panels: a wide strip on top, two side by side, a wide one at the foot.
  const picture = (width, height, boxes, ground = 255) => {
    const data = new Uint8Array(width * height).fill(ground);
    for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[y * width + x] = 20;
    return { width, height, data };
  };
  const page = picture(200, 300, [
    [10, 10, 190, 90],
    [10, 100, 95, 200],
    [105, 100, 190, 200],
    [10, 210, 190, 290],
  ]);
  const boxes = guessPanels(page);
  assert.equal(boxes.length, 4, 'four panels found');
  const near = (a, b) => Math.abs(a - b) < 0.01;
  assert.ok(near(boxes[0].x, 0.05) && near(boxes[0].y, 10 / 300) && near(boxes[0].w, 0.9), 'the top strip first');
  assert.ok(near(boxes[1].x, 0.05) && near(boxes[2].x, 105 / 200), 'then the left panel, then the right');
  assert.ok(near(boxes[3].y, 210 / 300), 'the foot last');

  // A black page with white panels: the background is read from the edge, not assumed white.
  const dark = picture(200, 300, [], 0);
  for (const [x0, y0, x1, y1] of [[10, 10, 190, 140], [10, 160, 190, 290]]) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) dark.data[y * 200 + x] = 240;
  assert.equal(guessPanels(dark).length, 2, 'panels on a black page');

  // A splash page (art to the edges): one panel. A blank page: none. Dust in a gutter doesn't join two panels.
  const splash = picture(200, 300, []);
  for (let i = 0; i < splash.data.length; i += 1) splash.data[i] = (i * 37) % 256;
  assert.deepEqual(guessPanels(splash), [{ x: 0, y: 0, w: 1, h: 1 }], 'a splash page (art to every edge) is one whole-page panel');
  assert.equal(guessPanels(picture(200, 300, [])).length, 0, 'a blank page has no panels');
  const dusty = picture(200, 300, [[10, 10, 190, 140], [10, 160, 190, 290]]);
  dusty.data[150 * 200 + 100] = 0;
  assert.equal(guessPanels(dusty).length, 2, 'a speck in the gutter is ignored');
  // Every box stays inside the page.
  for (const box of boxes) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001);

  // ---------- the mock store keeps the database's rules ----------
  global.window = { localStorage: { getItem: () => null, setItem: () => undefined } };
  stub(path.join(OUT, 'lib/docs/repository.js'), {
    getDocsRepository: () => ({ listDocs: async () => [{ id: 'd1', slug: 'mirela', title: 'MIRELA' }] }),
  });
  const mock = require(path.join(OUT, 'lib/comic/mock-comic-repository.js'));
  const store = mock.createMockComicRepository();

  mock.setComicViewerAdmin(false);
  const visitor = await store.contents();
  assert.ok(visitor.pages.length > 0 && visitor.pages.every((p) => p.releasedAt !== null), 'a visitor sees released pages only');
  const unreleasedChapterIds = new Set(visitor.chapters.map((c) => c.id));
  assert.ok(visitor.pages.every((p) => unreleasedChapterIds.has(p.chapterId)));
  await assert.rejects(store.release(['mock-p-2-3']), /ONLY THE HOUSE ACCOUNT/, 'a visitor cannot release');
  await assert.rejects(store.addVolume({ number: 9, title: '' }), /ONLY THE HOUSE ACCOUNT/, 'a visitor cannot write');
  assert.equal((await store.panels(['mock-p-2-3'])).length, 0, "an unreleased page's panels are hidden from a visitor");
  assert.equal(await store.findPanel('mock-p-2-3-a'), null, "and a board thread can't find them either");

  mock.setComicViewerAdmin(true);
  const admin = await store.contents();
  assert.ok(admin.pages.some((p) => p.releasedAt === null), 'the house account sees the queue');
  assert.equal(await store.release(['mock-p-2-3', 'mock-p-1-1']), 1, 'only queued pages are released; a released one is not again');
  await assert.rejects(store.release(['mock-p-2-3']), /NOTHING TO RELEASE/);
  mock.setComicViewerAdmin(false);
  assert.ok((await store.contents()).pages.some((p) => p.id === 'mock-p-2-3'), 'released: now everyone sees it');

  // Tags and APPEARS IN: released pages only; a CHARACTER mark.
  mock.setComicViewerAdmin(true);
  await store.setTags('mock-p-2-3-b', ['d1']);
  await store.setTags('mock-p-2-4-a', ['d1']);
  await store.setCharacter('d1', true);
  const seen = await store.appearances('d1');
  assert.deepEqual(seen.map((a) => `${a.chapterNumber}/${a.pageNumber}`), ['2/3'], 'APPEARS IN lists released pages only');
  assert.equal(await store.isCharacter('d1'), true);
  const tags = await store.tags(['mock-p-2-3-b']);
  assert.equal(tags['mock-p-2-3-b'][0].slug, 'mirela');

  // Saving a page's boxes keeps the ids of the boxes that stay (their tags and threads with them).
  const before = await store.panels(['mock-p-2-3']);
  await store.savePanels('mock-p-2-3', before.slice(0, 2).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, guessed: false })));
  const after = await store.panels(['mock-p-2-3']);
  assert.deepEqual(after.map((p) => p.id), before.slice(0, 2).map((p) => p.id), 'boxes keep their ids');
  assert.ok(after.every((p) => !p.guessed));
  assert.equal((await store.tags(['mock-p-2-3-b']))['mock-p-2-3-b'].length, 1, 'a kept box keeps its tags');

  // ---------- the forum anchor ----------
  const { comicPanelAnchor } = require(path.join(OUT, 'lib/comic/forum.js'));
  const anchor = comicPanelAnchor({ panelId: 'pn', chapterNumber: 3, pageNumber: 12, panelNumber: 2 });
  assert.equal(anchor.kind, 'comic');
  assert.equal(anchor.id, 'pn', 'one thread per panel: the anchor id is the panel id');
  assert.equal(anchor.label, 'COMIC · CH 3 · P 12 · PANEL 2');
  assert.equal(anchor.href, '/comic/3/12?panel=pn');

  // ---------- the migration's locks ----------
  const migration = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((name) => name.endsWith('_comic.sql'));
  assert.ok(migration, 'the comic migration exists');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', migration), 'utf8');
  for (const table of ['comic_volumes', 'comic_chapters', 'comic_pages', 'comic_releases', 'comic_panels', 'comic_panel_tags', 'comic_characters']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} has Row Level Security`);
  }
  assert.match(sql, /comic pages read once released[\s\S]*?using \(released_at is not null or \(select public\.is_admin\(\)\)\)/, 'pages read once released');
  const pageGrants = sql.match(/grant (insert|update) \(([^)]*)\) on public\.comic_pages/g) ?? [];
  assert.equal(pageGrants.length, 2, 'pages are written column by column');
  for (const grant of pageGrants) assert.ok(!/released_at|release_id/.test(grant), 'nobody writes the release columns directly');
  assert.ok(!/grant (insert|update)(,| ) [^(]*on public\.comic_pages/.test(sql.replace(/grant insert, update, delete on public\.comic_volumes[^;]*;/, '')), 'no whole-row write grant on pages');
  assert.match(sql, /function public\.comic_release[\s\S]*?if not public\.is_admin\(\) then/, 'release checks the house account');
  assert.match(sql, /revoke all on function public\.comic_release\(uuid\[\]\) from public, anon;/, 'visitors cannot call release');
  assert.match(sql, /to_regprocedure\('public\.notify_comic_page\(text,text,text,text\)'\)/, "release calls NOTIFY's alert only once it exists");
  assert.match(sql, /'comic:release:' \|\| v_release::text/, 'one alert per release, by its id');
  assert.match(
    sql,
    /row_number\(\) over \(order by p\.position, p\.id::text\) as n\s+from public\.comic_pages p where p\.chapter_id = v_chapter_id and p\.released_at is not null/,
    "the alert's page number counts released pages, as a reader sees them",
  );
  assert.match(sql, /\('comic', 'comic', false,/, 'the comic bucket is private');
  assert.match(sql, /comic copies read once released[\s\S]*?\(storage\.foldername\(name\)\)\[1\] in \('reading', 'zoom'\)/, 'visitors read copies, never originals');

  console.log('check-comic: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
