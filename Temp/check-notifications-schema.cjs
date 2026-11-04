/*
 * Whether the live Supabase project has what the notification feed reads and writes:
 *   node Temp/check-notifications-schema.cjs
 *
 * The state this was written against: `forum_notifications` had never been created on the project,
 * so every signed-in reader's bell answered `FEED OFFLINE :: ... NEEDS A ONE-TIME DATABASE UPDATE`
 * while the board itself worked. The table is the first half; the four policies are the rest, and a
 * table with no policies is a feed nobody can write to. So once the table answers, this check signs
 * in as two of the kept test accounts (A tags B - see scripts/browser.cjs) and exercises the contract
 * the section promises:
 *
 *   the tagger files a row for the recipient   allowed      (actor_id = auth.uid())
 *   the tagger files one addressed to himself  refused      (no self-notifications)
 *   the recipient reads his feed               holds it
 *   the tagger reads his own feed              does not    (a feed is private)
 *   the tagger marks it read, then deletes it  nothing     (not his row)
 *   the recipient marks it read, then deletes  both work
 *
 * Realtime is reported rather than asserted: the bell also polls, so a missing publication is a
 * slower bell and not a broken one.
 *
 * It makes no account. Every row it files carries this run's own title, and every count and the
 * clean-up are scoped to that title: a kept account's feed may hold other checks' rows.
 *
 * supabase/migrations/20260923000017_notifications.sql is the file for section 17, and
 * supabase/cleanup/catch-up.sql is that plus sections 16 and 18, for a project that was
 * built before them. Both are safe to paste twice.
 */
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** This run's rows, and only these, are what every count below is about. */
const TITLE = `A CHECK ROW ${Date.now().toString(36)}`;

/** Everything the menu draws off a row, which is everything the repository writes. */
const COLUMNS = 'id,user_id,kind,actor_id,actor_name,thread_id,thread_title,body,created_at,read_at';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;

function report(label, detail, ok) {
  if (!ok) failed += 1;
  console.log(`  ${(ok ? 'ok  ' : 'FAIL').padEnd(6)}${label.padEnd(44)} ${detail}`);
  return ok;
}

/** A kept test account, signed in on a client of its own. */
async function signIn(letter) {
  const { client: account, id } = await testAccountClient(letter);
  return { account, userId: id };
}

/** The policies themselves, once the table is there. */
async function policies() {
  const actor = await signIn('A');
  const recipient = await signIn('B');

  const row = {
    user_id: recipient.userId,
    kind: 'tag',
    actor_id: actor.userId,
    actor_name: 'probe actor',
    thread_id: null,
    thread_title: TITLE,
    body: 'the words a tag carries',
  };

  // The write the app itself makes: no return asked for. A row is addressed to somebody else, so
  // the account that files it may not read it back - `insert().select()` would make PostgREST read
  // a row the read policy refuses and fail the whole write with an RLS error that reads like a
  // missing policy. See the contract in app/lib/notifications/types.ts.
  const filed = await actor.account.from('forum_notifications').insert(row);
  report(
    'a tag is filed for the account it names',
    filed.error === null ? `accepted, status ${filed.status}` : filed.error.message,
    filed.error === null,
  );

  const hisFeed = await recipient.account
    .from('forum_notifications')
    .select('id')
    .eq('user_id', recipient.userId)
    .eq('thread_title', TITLE);
  const id = (hisFeed.data ?? [])[0]?.id;
  report(
    "the recipient's feed holds it",
    `${hisFeed.data?.length ?? 0} row(s)`,
    hisFeed.error === null && id !== undefined,
  );

  if (id === undefined) return;

  // The shape the app must never use, kept as a rule of its own: filing with a read-back is refused,
  // and - because the insert and its return are one statement - it files nothing.
  const returned = await actor.account
    .from('forum_notifications')
    .insert({ ...row, body: 'the return probe' })
    .select('id');
  report('filing with a read-back is refused', returned.error?.message ?? 'NOT REFUSED', returned.error !== null);

  const stillOne = await recipient.account
    .from('forum_notifications')
    .select('id')
    .eq('user_id', recipient.userId)
    .eq('thread_title', TITLE);
  report(
    'and the refused one filed nothing',
    `${stillOne.data?.length ?? 0} row(s)`,
    (stillOne.data ?? []).length === 1,
  );

  const toSelf = await actor.account
    .from('forum_notifications')
    .insert({ ...row, user_id: actor.userId });
  report('a row addressed to the tagger is refused', toSelf.error?.message ?? 'NOT REFUSED', toSelf.error !== null);

  // The column's own rule: `kind` is a tag or a reply, and the menu's label is read off it.
  const badKind = await actor.account.from('forum_notifications').insert({ ...row, kind: 'mention' });
  report(
    'a kind that is neither a tag nor a reply is refused',
    badKind.error?.message ?? 'NOT REFUSED',
    badKind.error !== null,
  );

  const otherFeed = await actor.account
    .from('forum_notifications')
    .select('id')
    .eq('user_id', actor.userId)
    .eq('thread_title', TITLE);
  report(
    "the tagger's own feed does not",
    `${otherFeed.data?.length ?? 0} row(s)`,
    otherFeed.error === null && (otherFeed.data ?? []).length === 0,
  );

  const taken = await actor.account
    .from('forum_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  report(
    'the tagger cannot mark it read',
    `${taken.data?.length ?? 0} row(s) touched`,
    taken.error === null && (taken.data ?? []).length === 0,
  );

  const removed = await actor.account.from('forum_notifications').delete().eq('id', id).select('id');
  report(
    'nor delete it',
    `${removed.data?.length ?? 0} row(s) deleted`,
    removed.error === null && (removed.data ?? []).length === 0,
  );

  const before = await recipient.account.from('forum_notifications').select('read_at').eq('id', id).single();
  report('and it is still unread', String(before.data?.read_at), before.data?.read_at === null);

  const read = await recipient.account
    .from('forum_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .select('id,read_at');
  report(
    'the recipient marks it read',
    `${read.data?.length ?? 0} row(s), read at ${read.data?.[0]?.read_at ?? '-'}`,
    (read.data ?? []).length === 1 && read.data[0].read_at !== null,
  );

  // Realtime, reported rather than asserted: the bell's poll covers a publication that is not there.
  const heard = [];
  const channel = recipient.account
    .channel(`check-notifications-${recipient.userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'forum_notifications', filter: `user_id=eq.${recipient.userId}` },
      (payload) => heard.push(payload.new?.id),
    )
    .subscribe();

  await wait(4000);
  const second = await actor.account.from('forum_notifications').insert(row);
  await wait(6000);
  await recipient.account.removeChannel(channel);

  if (second.error !== null) {
    report('the second tag is filed', second.error.message, false);
  }

  // What the bell heard against what the feed holds: the row filed above is the newest in the
  // recipient's feed, and realtime delivered it if that id came over the channel too.
  const latest = await recipient.account
    .from('forum_notifications')
    .select('id')
    .eq('user_id', recipient.userId)
    .eq('thread_title', TITLE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const delivered = latest.data?.id !== undefined && heard.includes(latest.data.id);
  console.log(
    `  ${delivered ? 'ok  ' : 'note'}${'the bell hears it without a reload'.padEnd(44)} ${
      delivered
        ? 'realtime delivered the row'
        : 'realtime did not: the feed still polls, so the bell is slower rather than broken'
    }`,
  );

  // Everything this check filed, deleted by the account it was filed for: the first row (the tag
  // whose id came out of the feed) and the second (the one the bell was listening for).
  const cleaned = await recipient.account
    .from('forum_notifications')
    .delete()
    .eq('user_id', recipient.userId)
    .eq('thread_title', TITLE)
    .select('id');
  report('the recipient deletes what it holds', `${cleaned.data?.length ?? 0} row(s) deleted`, (cleaned.data ?? []).length === 2);

  const after = await recipient.account
    .from('forum_notifications')
    .select('id')
    .eq('user_id', recipient.userId)
    .eq('thread_title', TITLE);
  report("and none of this run's rows are left", `${after.data?.length ?? 0} row(s)`, (after.data ?? []).length === 0);

  for (const who of [actor, recipient]) await who.account.auth.signOut({ scope: 'local' });
}

(async () => {
  if (URL_BASE === undefined || KEY === undefined) {
    console.log('no Supabase project in .env.local - the site runs on the mock stores, so there is nothing to check.');
    return;
  }

  const response = await fetch(`${URL_BASE}/rest/v1/forum_notifications?select=${COLUMNS}&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const body = await response.text();

  report(
    'the table, and every column a row is drawn from',
    response.ok ? 'held by RLS, as it should be' : body.slice(0, 140),
    response.ok,
  );

  if (!response.ok) {
    console.log('');
    console.log('Paste, in the Supabase SQL editor:');
    console.log('  supabase/migrations/20260923000017_notifications.sql   (section 17: the table and its policies)');
    console.log('  supabase/cleanup/catch-up.sql                 (that, plus sections 16 and 18)');
    process.exitCode = 1;
    return;
  }

  await policies();

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of the feed's own rules did not hold: the FAIL line above names the rule, and`);
    console.log('each one is exercised on its own, so it says which part of section 17 is missing.');
    console.log('supabase/migrations/20260923000017_notifications.sql recreates the table and all four policies');
    console.log('by name, and supabase/cleanup/catch-up.sql is that plus sections 16 and 18.');
    process.exitCode = 1;
    return;
  }

  console.log('schema ready: a tag can be filed, read by the account it names and by nobody else, and marked');
  console.log('seen by that account alone.');
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
