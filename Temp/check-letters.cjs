/*
 * Letters (SPEC-letters.md, Luke 2026-11-10): asks the live database who may read and write a letter, as the site's rules
 * say: only the owner writes; a private letter is the owner's alone; anyone, signed out too, reads a public one.
 *   node Temp/check-letters.cjs
 *
 * Signs in as TEST ACCOUNT A (the owner) and B (someone else), with a visitor beside them. A makes one letter and deletes
 * it again at the end, whatever happens, so it leaves nothing behind.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = (await a.client.auth.getUser()).data.user.id;
  let letterId = null;

  const rows = async (client, table, column, value) => {
    const { data, error } = await client.from(table).select('id').eq(column, value);
    assert.equal(error, null, `${table} read: ${error?.message}`);
    return data.length;
  };

  try {
    // The owner makes a letter, private to start, and puts a thing on it.
    const made = await a.client.from('letters').insert({ owner, name: 'CHECK LETTER' }).select('id, is_public, stamp_opacity').single();
    assert.equal(made.error, null, `the owner makes a letter: ${made.error?.message}`);
    letterId = made.data.id;
    assert.equal(made.data.is_public, false, 'a new letter is private');
    assert.equal(made.data.stamp_opacity, 30, 'its pattern starts at 30%');
    const item = await a.client
      .from('letter_items')
      .insert({ letter_id: letterId, kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE', x: 0.4, y: 0.6, turn: 5 })
      .select('id')
      .single();
    assert.equal(item.error, null, `the owner adds a thing: ${item.error?.message}`);
    const twice = await a.client.from('letter_items').insert({ letter_id: letterId, kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE' });
    assert.equal(twice.error?.code, '23505', 'the same thing twice is refused');
    console.log('  ok    the owner makes a letter and adds to it');

    // Private: the owner's alone.
    assert.equal(await rows(a.client, 'letters', 'id', letterId), 1, 'the owner reads their private letter');
    assert.equal(await rows(b.client, 'letters', 'id', letterId), 0, 'someone else cannot read a private letter');
    assert.equal(await rows(visitor, 'letters', 'id', letterId), 0, 'a visitor cannot read a private letter');
    assert.equal(await rows(b.client, 'letter_items', 'letter_id', letterId), 0, 'nor what is on it (someone else)');
    assert.equal(await rows(visitor, 'letter_items', 'letter_id', letterId), 0, 'nor what is on it (a visitor)');
    console.log('  ok    a private letter is its owner\'s alone');

    // Public: anyone reads it, signed out too.
    assert.equal((await a.client.from('letters').update({ is_public: true }).eq('id', letterId)).error, null, 'the owner makes it public');
    assert.equal(await rows(b.client, 'letters', 'id', letterId), 1, 'someone else reads a public letter');
    assert.equal(await rows(visitor, 'letters', 'id', letterId), 1, 'a visitor reads a public letter');
    assert.equal(await rows(visitor, 'letter_items', 'letter_id', letterId), 1, 'and what is on it');
    console.log('  ok    a public letter is anyone\'s to read');

    // Only the owner writes, public or not.
    const renamed = await b.client.from('letters').update({ name: 'TAKEN' }).eq('id', letterId).select('id');
    assert.equal(renamed.data?.length ?? 0, 0, 'someone else cannot rename it');
    const gone = await b.client.from('letters').delete().eq('id', letterId).select('id');
    assert.equal(gone.data?.length ?? 0, 0, 'someone else cannot delete it');
    const sneaked = await b.client.from('letter_items').insert({ letter_id: letterId, kind: 'link', ref: 'https://example.com/', title: 'X' });
    assert.notEqual(sneaked.error, null, 'someone else cannot add to it');
    const moved = await b.client.from('letter_items').update({ x: 0.9 }).eq('letter_id', letterId).select('id');
    assert.equal(moved.data?.length ?? 0, 0, 'someone else cannot move its cards');
    const visitorMade = await visitor.from('letters').insert({ owner, name: 'VISITOR' });
    assert.notEqual(visitorMade.error, null, 'a visitor cannot make a letter');
    const stolen = await b.client.from('letters').insert({ owner, name: 'IN A\'S NAME' });
    assert.notEqual(stolen.error, null, 'nobody makes a letter in someone else\'s name');
    assert.equal(await rows(a.client, 'letters', 'name', 'TAKEN'), 0, 'the name is unchanged');
    console.log('  ok    only the owner writes');

    // The owner's own delete takes the things on it with it.
    const deleted = await a.client.from('letters').delete().eq('id', letterId).select('id');
    assert.equal(deleted.data?.length, 1, 'the owner deletes their letter');
    letterId = null;
    assert.equal(await rows(a.client, 'letter_items', 'id', item.data.id), 0, 'and its things go with it');
    console.log('  ok    the owner deletes it, things and all');
    console.log('  ok    the real database');
  } finally {
    if (letterId !== null) await a.client.from('letters').delete().eq('id', letterId);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
