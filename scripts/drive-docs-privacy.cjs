/*
 * DOCS live privacy drive (SPEC-live-docs.md, "How it's proven"): a PRIVATE document can't be opened, listed or
 * listened to by B, checked through the database and the realtime channel, not only the screen.
 *   node scripts/drive-docs-privacy.cjs
 *
 * Signs in as the kept test accounts A and B (and asks once as a visitor with no session). A makes one document,
 * changes who can see it step by step, and deletes it at the end; nothing else is written. Prints counts and
 * allowed/refused only.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('./browser.cjs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Joins `doc:<id>` privately; answers whether it joined, what it heard, and a way to send. */
async function join(client, topic, label) {
  const heard = [];
  const channel = client.channel(topic, { config: { broadcast: { self: false }, private: true } });
  channel.on('broadcast', { event: 'yjs' }, ({ payload }) => heard.push(payload));
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 8000);
    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(state);
      }
    });
  });
  console.log(`  ${label.padEnd(34)} channel: ${status}`);
  return {
    status,
    heard,
    send: (payload) => channel.send({ type: 'broadcast', event: 'yjs', payload }),
    leave: () => client.removeChannel(channel),
  };
}

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const made = await a.client
    .from('docs')
    .insert({ title: 'PRIVACY DRIVE', summary: '', access: 'private', owner_label: a.displayName, created_by_label: a.displayName, updated_by_label: a.displayName })
    .select('id, owner_id, access')
    .single();
  assert.equal(made.error, null, `A makes a document: ${made.error?.message}`);
  const id = made.data.id;
  assert.equal(made.data.owner_id, a.id, 'it is A\'s, whatever the browser said');
  const topic = `doc:${id}`;
  console.log('A made a PRIVATE document.');

  try {
    // --- PRIVATE: B and a visitor get nothing ----------------------------------------------------------
    const bRead = await b.client.from('docs').select('id').eq('id', id);
    assert.equal(bRead.data.length, 0, 'B cannot open it');
    const bList = await b.client.from('docs').select('id').limit(500);
    assert.equal(bList.data.some((row) => row.id === id), false, 'B does not see it listed');
    const vRead = await visitor.from('docs').select('id').eq('id', id);
    assert.equal(vRead.data.length, 0, 'a visitor cannot open it');
    const bRole = await b.client.rpc('doc_role', { target: id });
    assert.equal(bRole.data, null, 'the database gives B no role in it');
    const bWrite = await b.client.from('docs').update({ body_text: 'B was here' }).eq('id', id).select('id');
    assert.equal(bWrite.data.length, 0, 'B cannot write to it');
    const bComment = await b.client.from('doc_comments').insert({ doc_id: id, body: 'hi', author_label: 'B' });
    assert.notEqual(bComment.error, null, 'B cannot comment on it');
    const bShareSelf = await b.client.from('doc_shares').insert({ doc_id: id, person_id: b.id, person_label: 'B', can_edit: true });
    assert.notEqual(bShareSelf.error, null, 'B cannot share it with themselves');
    const bAccess = await b.client.from('docs').update({ access: 'public' }).eq('id', id).select('id');
    assert.equal(bAccess.data.length, 0, 'B cannot make it public');
    console.log('  PRIVATE, database                  B: no read, no list, no role, no write, no comment, no self-share; visitor: no read');

    const aRoom = await join(a.client, topic, 'A on the channel');
    assert.equal(aRoom.status, 'SUBSCRIBED', 'the owner joins the channel');
    const bRoom = await join(b.client, topic, 'B on the channel (PRIVATE)');
    const vRoom = await join(visitor, topic, 'a visitor on the channel (PRIVATE)');
    await aRoom.send({ kind: 'update', from: 1, update: 'AAAA' });
    if (bRoom.status === 'SUBSCRIBED') await bRoom.send({ kind: 'update', from: 2, update: 'BBBB' });
    await wait(2500);
    assert.equal(bRoom.heard.length, 0, 'B hears nothing on a PRIVATE document\'s channel');
    assert.equal(vRoom.heard.length, 0, 'nor does a visitor');
    assert.equal(aRoom.heard.length, 0, 'and nothing B sends reaches A');
    console.log(`  PRIVATE, channel                   B heard ${bRoom.heard.length}, visitor heard ${vRoom.heard.length}, A heard from B ${aRoom.heard.length}`);
    await bRoom.leave();
    await vRoom.leave();

    // --- SHARED WITH B, CAN READ --------------------------------------------------------------------------
    assert.equal((await a.client.from('docs').update({ access: 'shared' }).eq('id', id).select('id')).data.length, 1);
    const share = await a.client.from('doc_shares').insert({ doc_id: id, person_id: b.id, person_label: b.displayName, can_edit: false });
    assert.equal(share.error, null, `A shares it with B: ${share.error?.message}`);
    assert.equal((await b.client.from('docs').select('id').eq('id', id)).data.length, 1, 'CAN READ: B opens it');
    assert.equal((await b.client.rpc('doc_role', { target: id })).data, 'read');
    assert.equal((await b.client.from('docs').update({ body_text: 'B was here' }).eq('id', id).select('id')).data.length, 0, 'but cannot write');
    const bReadRoom = await join(b.client, topic, 'B on the channel (CAN READ)');
    await wait(500);
    await aRoom.send({ kind: 'update', from: 1, update: 'CCCC' });
    if (bReadRoom.status === 'SUBSCRIBED') await bReadRoom.send({ kind: 'update', from: 2, update: 'DDDD' });
    await wait(2500);
    assert.ok(bReadRoom.heard.length >= 1, 'CAN READ: B hears the edits');
    assert.equal(aRoom.heard.length, 0, 'and what B sends is refused: it never reaches A');
    console.log(`  SHARED WITH B (CAN READ)           B reads yes, writes no; channel: B heard ${bReadRoom.heard.length}, A heard from B ${aRoom.heard.length}`);
    await bReadRoom.leave();

    // --- CAN EDIT -----------------------------------------------------------------------------------------
    assert.equal((await a.client.from('doc_shares').update({ can_edit: true }).eq('doc_id', id).eq('person_id', b.id)).error, null);
    assert.equal((await b.client.rpc('doc_role', { target: id })).data, 'edit');
    assert.equal((await b.client.from('docs').update({ body_text: 'B was here' }).eq('id', id).select('id')).data.length, 1, 'CAN EDIT: B writes');
    const bSneak = await b.client.from('docs').update({ access: 'public' }).eq('id', id).select('id');
    assert.notEqual(bSneak.error, null, 'an editor still cannot change who sees it');
    assert.equal((await b.client.from('docs').delete().eq('id', id).select('id')).data.length, 0, 'nor delete it');
    const bEditRoom = await join(b.client, topic, 'B on the channel (CAN EDIT)');
    await wait(500);
    await bEditRoom.send({ kind: 'update', from: 2, update: 'EEEE' });
    await wait(2500);
    assert.ok(aRoom.heard.length >= 1, 'CAN EDIT: what B sends reaches A');
    console.log(`  SHARED WITH B (CAN EDIT)           B writes yes, changes sharing no, deletes no; A heard from B ${aRoom.heard.length}`);
    await bEditRoom.leave();

    // --- PUBLIC: a visitor reads -------------------------------------------------------------------------
    assert.equal((await a.client.from('docs').update({ access: 'public' }).eq('id', id).select('id')).data.length, 1);
    assert.equal((await visitor.from('docs').select('id').eq('id', id)).data.length, 1, 'PUBLIC: a visitor reads it');
    assert.equal((await visitor.rpc('doc_role', { target: id })).data, 'read');
    console.log('  PUBLIC                             a visitor reads it');

    await aRoom.leave();

    // --- the review's tightened rules (20261113133339_docs_rules_tightened.sql) ----------------------------
    const sneaky = await a.client.from('docs').update({ title: 'PRIVACY DRIVE' }).eq('id', id).select('slug').single();
    assert.equal(sneaky.data.slug, null, 'a document outside LORE has no lore address');
    const claimed = await a.client.from('docs').insert({ title: 'SLUG GRAB', access: 'private', slug: 'slug-grab-drive', owner_label: 'A', created_by_label: 'A', updated_by_label: 'A' }).select('id, slug').single();
    assert.equal(claimed.error, null);
    assert.equal(claimed.data.slug, null, 'nobody can claim a /lore address on a document outside LORE');
    await a.client.from('docs').delete().eq('id', claimed.data.id);
    const lore = await a.client.from('docs').insert({ title: 'LORE DRIVE', access: 'public', slug: 'lore-drive-rules', folder_id: '00000000-0000-4000-8000-00000000d0c1', owner_label: 'A', created_by_label: 'A', updated_by_label: 'A' }).select('id, slug').single();
    assert.equal(lore.data.slug, 'lore-drive-rules', 'a page made in LORE keeps its address');
    const moved = await a.client.from('docs').update({ folder_id: null }).eq('id', lore.data.id).select('id');
    assert.notEqual(moved.error, null, 'and cannot be moved out of LORE');
    await a.client.from('docs').delete().eq('id', lore.data.id);
    for (let n = 1; n <= 20; n += 1) {
      const kept = await a.client.from('doc_versions').insert({ doc_id: id, yjs_state: 'AA==', snippet: '', name: `NAMED ${n}`, created_by_label: 'A' });
      assert.equal(kept.error, null, `named version ${n}: ${kept.error?.message}`);
    }
    const twentyFirst = await a.client.from('doc_versions').insert({ doc_id: id, yjs_state: 'AA==', snippet: '', name: 'NAMED 21', created_by_label: 'A' });
    assert.notEqual(twentyFirst.error, null, 'a 21st named version is refused');
    const hourly = await a.client.from('doc_versions').insert({ doc_id: id, yjs_state: 'AA==', snippet: '', name: null, created_by_label: 'A' }).select('id').single();
    const renamed = await a.client.from('doc_versions').update({ name: 'SNEAKED' }).eq('id', hourly.data.id).select('id');
    assert.notEqual(renamed.error, null, 'and naming an hourly copy cannot slip past the cap');
    console.log('  TIGHTENED RULES                    no /lore address outside LORE, lore stays in LORE, 20 named versions at most');
  } finally {
    const gone = await a.client.from('docs').delete().eq('id', id).select('id');
    console.log(`A deleted the document again (${gone.data?.length ?? 0} row).`);
  }

  console.log('docs-private-drive: every step held');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
