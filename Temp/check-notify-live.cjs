/*
 * SPEC-notifications.md phase 1 on the live database (20261120014611_notifications_phase1.sql), as TEST ACCOUNTS A and B.
 * Every probe is a refusal or a read, so nothing is left behind: nobody writes another's switches or picks, no browser
 * calls COMIC's way in, and a browser can't file one of the new kinds (the gate drops it). Needs `.env.test`.
 *   node Temp/check-notify-live.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

if (!fs.existsSync(path.join(__dirname, '..', '.env.test'))) {
  console.log('  skip  no .env.test: the live probe needs TEST ACCOUNTS A and B');
  process.exit(0);
}
const { testAccountClient } = require('../scripts/browser.cjs');

(async () => {
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');

  // The tables are there and the owner may read their own row.
  const own = await a.client.from('notification_prefs').select('replies, letters, live, comic, invites, balloons, weekly_email').eq('person', a.id);
  assert.equal(own.error, null, `A reads their own switches: ${own.error?.message}`);
  const picks = await a.client.from('live_watches').select('host').eq('watcher', a.id).limit(5);
  assert.equal(picks.error, null, `A reads their own picks: ${picks.error?.message}`);

  // Nobody writes another's switches or picks.
  const forged = await a.client.from('notification_prefs').insert({ person: b.id, replies: false });
  assert.notEqual(forged.error, null, "A can't make B's switches row");
  const forgedPick = await a.client.from('live_watches').insert({ watcher: b.id, host: a.id });
  assert.notEqual(forgedPick.error, null, "A can't pick somebody on B's behalf");
  const code = await a.client.from('notification_prefs').select('unsubscribe_code').eq('person', a.id);
  assert.notEqual(code.error, null, 'the unsubscribe code is never handed to a browser');

  // Nobody reads B's picks (B may have none; the read itself must answer nothing that is B's).
  const theirs = await a.client.from('live_watches').select('watcher').eq('watcher', b.id);
  assert.equal((theirs.data ?? []).length, 0, "A can't see B's picks");

  // COMIC's way in is the database's alone.
  const comic = await a.client.rpc('notify_comic_page', { p_ref: 'probe', p_title: 'X', p_body: '', p_href: '/forum' });
  assert.notEqual(comic.error, null, 'a browser cannot call notify_comic_page');

  // A browser filing a new kind is dropped by the gate: no error, and nothing in B's feed.
  const since = new Date(Date.now() - 5_000).toISOString();
  const fake = await a.client.from('forum_notifications').insert({ user_id: b.id, kind: 'live', actor_id: a.id, actor_name: 'PROBE', thread_title: 'PROBE', body: '', href: 'https://example.com' });
  assert.equal(fake.error, null, `the gate drops it quietly: ${fake.error?.message}`);
  const landed = await b.client.from('forum_notifications').select('id').eq('user_id', b.id).eq('kind', 'live').eq('actor_id', a.id).gte('created_at', since);
  assert.equal(landed.error, null, landed.error?.message);
  assert.equal((landed.data ?? []).length, 0, 'no faked live alert reached B');

  // A visitor reads nothing.
  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const seen = await visitor.from('notification_prefs').select('person').limit(1);
  assert.ok(seen.error !== null || (seen.data ?? []).length === 0, 'a visitor reads no switches');
  const seenPicks = await visitor.from('live_watches').select('watcher').limit(1);
  assert.ok(seenPicks.error !== null || (seenPicks.data ?? []).length === 0, 'a visitor reads no picks');

  console.log('check-notify-live: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
