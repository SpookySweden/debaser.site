/*
 * Books (SPEC-books.md, Luke 2026-11-10; SPEC-reader.md, 2026-11-11): asks the live database who may read and write
 * highlights (with their CFI and colour), reading places, bookmarks and reader settings, partly through the site's own
 * Supabase store (so a query the grants refuse is caught, as an upsert on bookmarks was on 2026-11-11).
 *   npx tsc app/lib/books/supabase-books-repository.ts --rootDir app --outDir Temp/out-books-live --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-books.cjs
 *
 * TEST ACCOUNT A makes two highlights in one book (one locked), saves a place, a bookmark and its look settings; B and a
 * visitor stand by. Everything A
 * made is deleted again at the end, whatever happens, so it leaves nothing behind. No book text is involved: a quote here
 * is made up.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

const BOOK = 'books:OL1W-pg1';

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const aId = (await a.client.auth.getUser()).data.user.id;
  const made = [];
  const marks = [];
  const kindRefs = [];
  let lookBefore = null;
  const add = (client, row) => client.from('book_highlights').insert({ person: aId, book_ref: BOOK, book_title: 'CHECK BOOK', place: 3, start_at: 0, end_at: 9, quote: 'made up', ...row }).select('id').single();

  try {
    lookBefore = (await a.client.from('book_reader_settings').select('settings').eq('person', aId).maybeSingle()).data;
    const open = await add(a.client, { comment: 'mine', is_locked: false });
    assert.equal(open.error, null, `A highlights: ${open.error?.message}`);
    made.push(open.data.id);
    const locked = await add(a.client, { is_locked: true });
    assert.equal(locked.error, null);
    made.push(locked.data.id);
    assert.notEqual((await add(b.client, {})).error, null, 'B cannot highlight in A`s name');
    assert.notEqual((await visitor.from('book_highlights').insert({ person: aId, book_ref: BOOK, place: 1, quote: 'x' })).error, null, 'a visitor cannot highlight');
    assert.notEqual((await add(a.client, { quote: 'x'.repeat(301) })).error, null, 'a quote is 300 characters at most');
    console.log('  ok    only the owner highlights');

    const seenByB = await b.client.from('book_highlights').select('id').eq('book_ref', BOOK);
    assert.deepEqual(seenByB.data.map((row) => row.id), [open.data.id], 'B reads the unlocked one, not the locked one');
    assert.equal((await visitor.from('book_highlights').select('id').eq('book_ref', BOOK)).data?.length ?? 0, 0, 'a visitor reads none');
    assert.equal((await a.client.from('book_highlights').select('id').eq('book_ref', BOOK)).data.length, 2, 'A reads both');
    console.log('  ok    a locked highlight is its owner`s alone');

    const changed = await b.client.from('book_highlights').update({ comment: 'taken' }).eq('id', open.data.id).select('id');
    assert.equal(changed.data?.length ?? 0, 0, 'B cannot change A`s');
    assert.equal((await b.client.from('book_highlights').delete().eq('id', open.data.id).select('id')).data?.length ?? 0, 0, 'nor delete it');
    const moved = await a.client.from('book_highlights').update({ quote: 'rewritten' }).eq('id', open.data.id);
    assert.notEqual(moved.error, null, 'even A cannot rewrite the quoted words, only the comment and the lock');
    assert.equal((await a.client.from('book_highlights').update({ is_locked: true }).eq('id', open.data.id)).error, null, 'A locks it');
    assert.equal((await b.client.from('book_highlights').select('id').eq('book_ref', BOOK)).data.length, 0, 'and now B reads none');
    await a.client.from('book_highlights').update({ is_locked: false }).eq('id', open.data.id);
    console.log('  ok    only the owner changes, locks and deletes');

    // The book's page: who has public highlights, names for signed-in people only. A is hidden, so A isn't listed at all.
    const forB = await b.client.rpc('book_readers', { p_ref: BOOK });
    assert.equal(forB.error, null);
    assert.equal(forB.data.length, 0, 'a hidden test account isn`t listed on a book`s page');
    const forVisitor = await visitor.rpc('book_readers', { p_ref: BOOK });
    assert.equal(forVisitor.error, null, 'a visitor may ask who has read a book');
    assert.ok(forVisitor.data.every((row) => row.person === null && row.display_name === null), 'and gets no names');
    console.log('  ok    the book`s readers');

    // Reading places: the owner's alone.
    assert.equal((await a.client.from('book_places').upsert({ person: aId, book_ref: BOOK, place: 12 }, { onConflict: 'person,book_ref' })).error, null, 'A saves a place');
    assert.equal((await b.client.from('book_places').select('place').eq('book_ref', BOOK)).data.length, 0, 'B cannot read A`s place');
    assert.equal((await visitor.from('book_places').select('place').eq('book_ref', BOOK)).data?.length ?? 0, 0, 'nor can a visitor');
    assert.equal((await a.client.from('book_places').select('place').eq('book_ref', BOOK).single()).data.place, 12, 'A reads it back');
    console.log('  ok    a reading place is its owner`s alone');

    // The reader (SPEC-reader.md): a highlight's CFI and colour, a place's CFI, bookmarks and look settings.
    const CFI = 'epubcfi(/6/14!/4/2/10,/1:0,/1:45)';
    const placed = await add(a.client, { cfi: CFI, colour: 'pink', place: 0, start_at: 0, end_at: 0 });
    assert.equal(placed.error, null, `A highlights at a CFI in pink: ${placed.error?.message}`);
    made.push(placed.data.id);
    assert.notEqual((await add(a.client, { colour: 'purple' })).error, null, 'a colour off the list is refused');
    assert.notEqual((await add(a.client, { cfi: 'not a cfi at all' })).error, null, 'a position that isn`t a CFI is refused');
    assert.equal((await a.client.from('book_highlights').update({ colour: 'green' }).eq('id', placed.data.id)).error, null, 'A recolours it');
    assert.equal((await b.client.from('book_highlights').update({ colour: 'red' }).eq('id', placed.data.id).select('id')).data?.length ?? 0, 0, 'B cannot');
    assert.notEqual((await a.client.from('book_highlights').update({ cfi: 'epubcfi(/6/2!/4/2)' }).eq('id', placed.data.id)).error, null, 'nobody moves a highlight to another spot');
    assert.equal((await a.client.from('book_highlights').select('colour').eq('id', placed.data.id).single()).data.colour, 'green', 'it reads back green');
    console.log('  ok    a highlight`s CFI and colour');

    assert.equal((await a.client.from('book_places').upsert({ person: aId, book_ref: BOOK, cfi: CFI }, { onConflict: 'person,book_ref' })).error, null, 'A saves a place as a CFI');
    assert.equal((await b.client.from('book_places').select('cfi').eq('book_ref', BOOK)).data.length, 0, 'B cannot read it');
    assert.equal((await a.client.from('book_places').select('cfi').eq('book_ref', BOOK).single()).data.cfi, CFI, 'A reads it back');
    console.log('  ok    a reading place`s CFI');

    const mark = await a.client.from('book_bookmarks').insert({ person: aId, book_ref: BOOK, cfi: CFI, label: 'CHAPTER I · 3%' }).select('id').single();
    assert.equal(mark.error, null, `A bookmarks: ${mark.error?.message}`);
    marks.push(mark.data.id);
    assert.notEqual((await b.client.from('book_bookmarks').insert({ person: aId, book_ref: BOOK, cfi: CFI })).error, null, 'B cannot bookmark in A`s name');
    assert.notEqual((await visitor.from('book_bookmarks').insert({ person: aId, book_ref: BOOK, cfi: CFI })).error, null, 'nor can a visitor');
    assert.notEqual((await a.client.from('book_bookmarks').insert({ person: aId, book_ref: BOOK, cfi: 'x' })).error, null, 'a bookmark needs a CFI');
    assert.equal((await b.client.from('book_bookmarks').select('id').eq('book_ref', BOOK)).data.length, 0, 'B reads none of A`s bookmarks');
    assert.equal((await visitor.from('book_bookmarks').select('id').eq('book_ref', BOOK)).data?.length ?? 0, 0, 'a visitor reads none');
    assert.equal((await b.client.from('book_bookmarks').delete().eq('id', mark.data.id).select('id')).data?.length ?? 0, 0, 'B cannot delete it');
    assert.equal((await a.client.from('book_bookmarks').select('id').eq('book_ref', BOOK)).data.length, 1, 'A reads it');
    console.log('  ok    a bookmark is its owner`s alone');

    // The same through the site's own store, as the reader calls it: adding, adding the same page again, a place, a look.
    const { createSupabaseBooksRepository } = require('./out-books-live/lib/books/supabase-books-repository.js');
    const store = createSupabaseBooksRepository(a.client);
    const OTHER = 'epubcfi(/6/16!/4/2/4,/1:0,/1:9)';
    const first = await store.addBookmark(aId, { bookRef: BOOK, cfi: OTHER, label: 'CHAPTER II · 5%' });
    marks.push(first.id);
    const twice = await store.addBookmark(aId, { bookRef: BOOK, cfi: OTHER, label: 'CHAPTER II · 5%' });
    assert.equal(twice.id, first.id, 'the same page bookmarked twice is the one bookmark');
    assert.equal((await store.bookmarks(aId, BOOK)).length, 2, 'the store lists both of A`s bookmarks');
    await store.savePlace(aId, BOOK, { cfi: OTHER, page: 0, title: 'CHECK BOOK', progress: 42, finishedAt: null });
    const kept = await store.place(aId, BOOK);
    assert.deepEqual([kept.cfi, kept.title, kept.progress, kept.finishedAt], [OTHER, 'CHECK BOOK', 42, null], 'the store keeps a place, its title and how far');
    await store.savePlace(aId, BOOK, { cfi: OTHER, page: 0, title: '', progress: 43, finishedAt: null });
    assert.equal((await store.place(aId, BOOK)).title, 'CHECK BOOK', 'a blank title leaves the saved one');

    // Keeping your place (SPEC-reading-places.md): one place for each kind of book, each listed at its percent, and
    // finishing one, all on the account. Your own file is its fingerprint; a PDF's or a scan's page is in `place`.
    const KINDS = [
      { ref: 'books:OL2W-pg2', cfi: OTHER, page: 0, progress: 40 },
      { ref: 'internet_archive:check_epub', cfi: OTHER, page: 0, progress: 41 },
      { ref: 'internet_archive:check_pdf', cfi: 'epubcfi(/6/100)', page: 50, progress: 39 },
      { ref: 'internet_archive:check_pictures', cfi: 'epubcfi(/6/94)', page: 47, progress: 38 },
      { ref: 'ipfs:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', cfi: OTHER, page: 0, progress: 37 },
      { ref: `own:${'ab'.repeat(32)}`, cfi: 'epubcfi(/6/12)', page: 6, progress: 50 },
    ];
    kindRefs.push(...KINDS.map((kind) => kind.ref));
    for (const kind of KINDS) await store.savePlace(aId, kind.ref, { cfi: kind.cfi, page: kind.page, title: `CHECK ${kind.ref.split(':')[0]}`, progress: kind.progress, finishedAt: null });
    const listed = await store.places(aId);
    for (const kind of KINDS) {
      const row = listed.find((place) => place.bookRef === kind.ref);
      assert.ok(row, `${kind.ref} is listed`);
      assert.deepEqual([row.cfi, row.page, row.progress, row.finishedAt], [kind.cfi, kind.page, kind.progress, null], `${kind.ref} reopens at its place and percent`);
    }
    assert.equal(listed[0].bookRef, KINDS[KINDS.length - 1].ref, 'newest first');
    assert.equal((await b.client.from('book_places').select('book_ref').in('book_ref', kindRefs)).data.length, 0, 'B reads none of them');
    assert.equal((await visitor.from('book_places').select('book_ref').in('book_ref', kindRefs)).data?.length ?? 0, 0, 'nor does a visitor');
    const done = '2026-11-13T10:00:00.000Z';
    await store.savePlace(aId, KINDS[0].ref, { cfi: KINDS[0].cfi, page: 0, title: '', progress: 100, finishedAt: done });
    assert.equal(Date.parse((await store.place(aId, KINDS[0].ref)).finishedAt), Date.parse(done), 'the last page: finished, with the date');
    await store.unfinish(aId, KINDS[0].ref);
    assert.equal((await store.place(aId, KINDS[0].ref)).finishedAt, null, '[ NOT FINISHED ] empties it');
    assert.notEqual((await a.client.from('book_places').upsert({ person: aId, book_ref: KINDS[0].ref, progress: 101 }, { onConflict: 'person,book_ref' })).error, null, 'a percent is 0 to 100');
    assert.notEqual((await a.client.from('book_places').upsert({ person: aId, book_ref: KINDS[0].ref, title: 'x'.repeat(301) }, { onConflict: 'person,book_ref' })).error, null, 'a title is 300 characters at most');
    assert.notEqual((await b.client.from('book_places').upsert({ person: aId, book_ref: 'books:OL9W-pg9', progress: 5 }, { onConflict: 'person,book_ref' })).error, null, 'B cannot write A`s');
    console.log('  ok    a place for every kind of book, how far, and finished');
    await store.saveReaderSettings(aId, { paper: 'light', size: 100 });
    assert.equal((await store.readerSettings(aId)).paper, 'light', 'and a look');
    const coloured = await store.add(aId, { bookRef: BOOK, bookTitle: 'CHECK BOOK', cfi: OTHER, quote: 'made up', comment: '', colour: 'blue', isLocked: true });
    made.push(coloured.id);
    await store.update(coloured.id, { colour: 'yellow' });
    assert.equal((await store.get(coloured.id)).colour, 'yellow', 'the store recolours a highlight');
    await store.removeBookmark(first.id);
    assert.equal((await store.bookmarks(aId, BOOK)).length, 1, 'and deletes a bookmark');
    console.log('  ok    the site`s own store, as the reader calls it');

    assert.equal((await a.client.from('book_reader_settings').upsert({ person: aId, settings: { paper: 'sepia', size: 120 } }, { onConflict: 'person' })).error, null, 'A saves a look');
    assert.equal((await b.client.from('book_reader_settings').select('settings').eq('person', aId)).data.length, 0, 'B cannot read it');
    assert.equal((await visitor.from('book_reader_settings').select('settings').eq('person', aId)).data?.length ?? 0, 0, 'nor can a visitor');
    assert.notEqual((await b.client.from('book_reader_settings').upsert({ person: aId, settings: {} }, { onConflict: 'person' })).error, null, 'B cannot write A`s');
    assert.notEqual((await a.client.from('book_reader_settings').upsert({ person: aId, settings: { x: 'y'.repeat(2000) } }, { onConflict: 'person' })).error, null, 'a look is small');
    assert.equal((await a.client.from('book_reader_settings').select('settings').eq('person', aId).single()).data.settings.paper, 'sepia', 'A reads it back');
    console.log('  ok    reader settings are their owner`s alone');
    console.log('  ok    the real database');
  } finally {
    for (const id of made) await a.client.from('book_highlights').delete().eq('id', id);
    await a.client.from('book_places').delete().eq('person', aId).eq('book_ref', BOOK);
    if (kindRefs.length) await a.client.from('book_places').delete().eq('person', aId).in('book_ref', kindRefs);
    for (const id of marks) await a.client.from('book_bookmarks').delete().eq('id', id);
    if (lookBefore) await a.client.from('book_reader_settings').upsert({ person: aId, settings: lookBefore.settings }, { onConflict: 'person' });
    else await a.client.from('book_reader_settings').delete().eq('person', aId);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
