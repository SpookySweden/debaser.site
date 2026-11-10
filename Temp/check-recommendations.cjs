/*
 * Recommendations (SPEC-recommendations.md, Luke 2026-11-10): asks the live database who may send, read, open and delete one.
 *   node Temp/check-recommendations.cjs
 *
 * TEST ACCOUNT A sends one to B only and posts one publicly; C and a visitor stand by. Everything A sends is deleted again at
 * the end, whatever happens (its recipients, plays and notifications go with it), so it leaves nothing behind.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  loadEnv();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const c = await testAccountClient('C');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const idOf = async (who) => (await who.client.auth.getUser()).data.user.id;
  const [aId, bId] = [await idOf(a), await idOf(b)];
  const made = [];
  const things = [
    { kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE', picture: '' },
    { kind: 'lore', ref: 'the-city', title: 'THE CITY', picture: '' },
  ];
  const send = (who, message, isPublic, items, to) => who.client.rpc('recommendation_send', { p_message: message, p_public: isPublic, p_items: items, p_to: to });

  try {
    // Refusals, before anything is written.
    assert.match((await send(a, '', false, things, [aId])).error?.message ?? '', /not to yourself/, 'never to yourself');
    assert.match((await send(a, '', false, [], [bId])).error?.message ?? '', /1 to 50 things/, 'never empty');
    assert.match((await send(a, '', false, things, [])).error?.message ?? '', /send it to someone/, 'to someone, or public');
    assert.notEqual((await send({ client: visitor }, '', true, things, [])).error, null, 'a visitor cannot send');
    console.log('  ok    the send refuses what it should');

    // A to B only.
    const sent = await send(a, 'for you', false, things, [bId]);
    assert.equal(sent.error, null, `A sends to B: ${sent.error?.message}`);
    made.push(sent.data);
    const one = sent.data;
    const title = await a.client.from('recommendations').select('title').eq('id', one).single();
    assert.equal(title.data.title, 'for you', 'with two things and a message, the message is the title');
    const forB = await b.client.rpc('recommendations_list', { p_tab: 'for_me', p_limit: 50 });
    assert.ok(forB.data.some((rec) => rec.id === one && rec.read_at === null && rec.sender === aId), 'B has it under FOR YOU, NEW, from A');
    const told = await b.client.from('forum_notifications').select('kind, recommendation_id').eq('recommendation_id', one);
    assert.equal(told.data?.length, 1, 'B was notified');
    assert.equal(told.data[0].kind, 'recommend');
    assert.equal((await c.client.from('recommendations').select('id').eq('id', one)).data.length, 0, 'C cannot read it');
    assert.equal((await c.client.from('recommendation_items').select('id').eq('recommendation_id', one)).data.length, 0, 'nor its things');
    assert.equal((await visitor.from('recommendation_items').select('id').eq('recommendation_id', one)).data.length, 0, 'nor can a visitor');
    assert.equal((await b.client.from('recommendation_items').select('id').eq('recommendation_id', one)).data.length, 2, 'B reads its things');
    console.log('  ok    one sent to B is for B and A alone');

    // B opens it and plays something in it; C can't do either.
    await b.client.from('recommendation_to').update({ read_at: new Date().toISOString() }).eq('recommendation_id', one).eq('person', bId);
    const opened = await b.client.rpc('recommendations_list', { p_tab: 'for_me', p_limit: 50 });
    assert.notEqual(opened.data.find((rec) => rec.id === one).read_at, null, 'opening it takes its NEW away');
    await b.client.rpc('recommendation_played', { p_rec: one });
    await c.client.rpc('recommendation_played', { p_rec: one });
    const plays = await a.client.from('recommendation_plays').select('person').eq('recommendation_id', one);
    assert.deepEqual(plays.data.map((row) => row.person), [bId], 'B`s play shows; C, who cannot read it, adds nothing');
    console.log('  ok    opening and playing');

    // Public: anyone reads its things; the list gives a visitor no names.
    const pub = await send(a, '', true, things.slice(0, 1), []);
    assert.equal(pub.error, null, `A posts one publicly: ${pub.error?.message}`);
    made.push(pub.data);
    const pubTitle = await a.client.from('recommendations').select('title').eq('id', pub.data).single();
    assert.equal(pubTitle.data.title, 'EXAMPLE', 'one thing and no message: its own title');
    assert.equal((await visitor.from('recommendation_items').select('id').eq('recommendation_id', pub.data)).data.length, 1, 'a visitor reads a public one`s things');
    assert.equal((await c.client.from('recommendations').select('id').eq('id', pub.data)).data.length, 1, 'C reads a public one');
    const visitorList = await visitor.rpc('recommendations_list', { p_tab: 'public', p_limit: 200 });
    assert.equal(visitorList.error, null);
    assert.ok(visitorList.data.every((rec) => rec.sender === null && rec.sender_name === null), 'a visitor sees no names');
    assert.ok(!visitorList.data.some((rec) => rec.id === pub.data), 'and a hidden test account`s public one isn`t listed');
    assert.equal((await visitor.rpc('recommendations_list', { p_tab: 'for_me', p_limit: 50 })).data.length, 0, 'a visitor has no FOR YOU');
    console.log('  ok    a public one is anyone`s to read, with no names for visitors');

    // Only the sender deletes.
    assert.equal((await b.client.from('recommendations').delete().eq('id', one).select('id')).data.length, 0, 'B cannot delete A`s');
    assert.equal((await a.client.from('recommendations').delete().eq('id', one).select('id')).data.length, 1, 'A deletes it');
    made.splice(made.indexOf(one), 1);
    assert.equal((await b.client.from('forum_notifications').select('id').eq('recommendation_id', one)).data.length, 0, 'and B`s notification goes with it');
    console.log('  ok    only the sender deletes');
    console.log('  ok    the real database');
  } finally {
    for (const id of made) await a.client.from('recommendations').delete().eq('id', id);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
