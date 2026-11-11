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
    await store.savePlace(aId, BOOK, OTHER);
    assert.equal(await store.place(aId, BOOK), OTHER, 'the store keeps a place');
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
    for (const id of marks) await a.client.from('book_bookmarks').delete().eq('id', id);
    if (lookBefore) await a.client.from('book_reader_settings').upsert({ person: aId, settings: lookBefore.settings }, { onConflict: 'person' });
    else await a.client.from('book_reader_settings').delete().eq('person', aId);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
