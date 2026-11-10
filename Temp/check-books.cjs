/*
 * Books (SPEC-books.md, Luke 2026-11-10): asks the live database who may read and write highlights and reading places.
 *   node Temp/check-books.cjs
 *
 * TEST ACCOUNT A makes two highlights in one book (one locked) and saves a place; B and a visitor stand by. Everything A
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
  const add = (client, row) => client.from('book_highlights').insert({ person: aId, book_ref: BOOK, book_title: 'CHECK BOOK', place: 3, start_at: 0, end_at: 9, quote: 'made up', ...row }).select('id').single();

  try {
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
    console.log('  ok    the real database');
  } finally {
    for (const id of made) await a.client.from('book_highlights').delete().eq('id', id);
    await a.client.from('book_places').delete().eq('person', aId).eq('book_ref', BOOK);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
