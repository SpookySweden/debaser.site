/*
 * ROOMCHAT (Luke 2026-11-17) on the live database, once, after 20261117023807_room_chat_private_anonymous.sql: who gets a
 * private room's names from discuss_room_chat. Run only through the notes folder's heavy-step.cjs with --live:
 *   node "<notes>\heavy-step.cjs" ROOMCHAT --live -- node scripts/live-room-chat-private.cjs
 *
 *   1. TEST ACCOUNT A says one line in its own private room over a made-up thing (a unique web_ref, so no real page shows it).
 *      The database stamps it private.
 *   2. A, who was in the room, reads it named, with its id, marked private_room and not anonymous.
 *   3. TEST ACCOUNT B (REMOVED from A's room, so outside it) and a signed-out visitor get no line naming A (a hidden account's
 *      line is left out for everyone outside its room).
 *   4. Real lines from a private room by real people, read as B (outside that room): every private one comes back with no id,
 *      no name (ANON-n), not marked GUEST. Only counts are printed, never anybody's words or names.
 * Leaves the one queue row and the one line (ids printed; deleting them waits for Luke). Needs `.env.test` (skipped without).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
if (!fs.existsSync(path.join(ROOT, '.env.test'))) {
  console.log('  skip  no .env.test: the live check needs TEST ACCOUNT A and B');
  process.exit(0);
}
const { testAccountClient } = require('../scripts/browser.cjs');
const ok = (what) => console.log(`  ok  ${what}`);

/** A read-only select through scripts/db.cjs (one line: Windows keeps only the first). */
function select(sql) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'db.cjs'), sql], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  return parsed.rows ?? [];
}

(async () => {
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // The function's answer now carries the two marks (proves the migration is in).
    const shape = select("select pg_get_function_result('public.discuss_room_chat(uuid, text, text[])'::regprocedure) as r");
    assert.match(shape[0].r, /private_room boolean, anonymous boolean/, 'the migration is applied');

    // 1. A's own main room, private.
    const { data: rooms, error: roomError } = await a.client.from('watch_rooms').select('id, privacy, origin').eq('original_host_id', a.id).eq('origin', 'music').is('ended_at', null).limit(1);
    assert.equal(roomError, null, roomError?.message);
    assert.equal(rooms.length, 1, "TEST ACCOUNT A's own room");
    const room = rooms[0];
    assert.equal(room.privacy, 'private', "A's own room is private");
    const ref = `check:roomchat-${Date.now()}`;
    const { data: entry, error: entryError } = await a.client
      .from('watch_queue')
      .insert({ room_id: room.id, source_url: `https://example.invalid/${ref.replace(':', '-')}`, source_kind: 'embed', source_title: 'ROOMCHAT CHECK', added_by: a.id, position: 900000, in_queue: false, web_ref: ref })
      .select('id')
      .single();
    assert.equal(entryError, null, entryError?.message);
    const { data: line, error: lineError } = await a.client
      .from('watch_messages')
      .insert({ room_id: room.id, queue_entry_id: entry.id, media_item_id: null, author_id: a.id, author_label: a.displayName, body: 'ROOMCHAT CHECK LINE', media_seconds: 61 })
      .select('id')
      .single();
    assert.equal(lineError, null, lineError?.message);
    const stamped = select(`select privacy_at_write from watch_messages where id = '${line.id}'`);
    assert.equal(stamped[0].privacy_at_write, 'private', 'the database stamped it private');
    ok(`A said a line in its private room over ${ref} (queue ${entry.id}, line ${line.id}), stamped private`);

    const ask = (client) => client.rpc('discuss_room_chat', { p_media_item_id: null, p_web_ref: ref, p_urls: null });

    // 2. In the room: named.
    const mine = await ask(a.client);
    assert.equal(mine.error, null, mine.error?.message);
    assert.equal(mine.data.length, 1, JSON.stringify(mine.data));
    assert.equal(mine.data[0].author_id, a.id);
    assert.equal(mine.data[0].author_label, a.displayName);
    assert.equal(mine.data[0].private_room, true);
    assert.equal(mine.data[0].anonymous, false);
    assert.equal(Number(mine.data[0].media_seconds), 61, 'timestamped to the moment in the video');
    ok(`A (in the room) reads it named: ${mine.data[0].author_label}, private_room, IN ROOM 61 s`);

    // 3. Outside the room.
    const { data: bRow } = await b.client.from('watch_members').select('removed_at').eq('room_id', room.id).eq('user_id', b.id).maybeSingle();
    assert.ok(bRow === null || bRow.removed_at !== null, 'B is not in A\'s room (removed or never there)');
    for (const [who, client] of [['B', b.client], ['a signed-out visitor', visitor]]) {
      const theirs = await ask(client);
      assert.equal(theirs.error, null, theirs.error?.message);
      assert.ok(theirs.data.every((row) => row.author_id !== a.id && row.author_label !== a.displayName), `${who} never gets A's name`);
      assert.equal(theirs.data.length, 0, `${who}: a hidden account's private line is left out outside its room`);
      ok(`${who} (outside the room) gets nothing of it`);
    }

    // 4. Real private lines, read by B from outside their room. Only counts leave this script.
    const targets = select(
      `select q.web_ref, q.source_url, q.media_item_id, count(*)::int n from watch_messages m join watch_queue q on q.id = m.queue_entry_id join watch_rooms r on r.id = m.room_id left join profiles p on p.id = m.author_id where m.privacy_at_write <> 'open' and r.chat_on_discuss and coalesce(p.room_chat_on_discuss, true) and not coalesce(p.is_hidden, false) and m.author_id <> '${b.id}' and r.host_id <> '${b.id}' and r.original_host_id <> '${b.id}' and not exists (select 1 from watch_members v where v.room_id = r.id and v.user_id = '${b.id}' and v.removed_at is null) group by 1, 2, 3 order by n desc limit 1`,
    );
    assert.equal(targets.length, 1, 'a real private line over something exists');
    const target = targets[0];
    const real = await b.client.rpc('discuss_room_chat', { p_media_item_id: target.media_item_id, p_web_ref: target.web_ref, p_urls: target.source_url === null ? null : [target.source_url] });
    assert.equal(real.error, null, real.error?.message);
    const privateRows = real.data.filter((row) => row.private_room === true);
    assert.ok(privateRows.length > 0, 'B gets the private lines (words and moment) anonymised, not left out');
    for (const row of privateRows) {
      assert.equal(row.anonymous, true, 'anonymised to an outsider');
      assert.equal(row.author_id, null, 'no id');
      assert.match(row.author_label, /^ANON(-\d+)?$/, 'no name');
      assert.equal(row.guest, false, 'not even GUEST');
      assert.ok(typeof row.body === 'string' && row.body.length > 0 && row.said_at, 'the words and the time still show');
    }
    ok(`B (outside) reads ${privateRows.length} real private-room lines over one thing (${target.n} expected from its own rooms, ${real.data.length - privateRows.length} open ones beside them): every one ANON-n, no id, no GUEST`);

    console.log(`\nroom chat, private rooms anonymised (live): OK. Leftovers: watch_queue ${entry.id}, watch_messages ${line.id} (in A's room ${room.id})`);
  } finally {
    await a.client.auth.signOut({ scope: 'local' });
    await b.client.auth.signOut({ scope: 'local' });
  }
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
