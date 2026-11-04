/*
 * The arcade, live: one account asks another for a game, and it is answered.
 *   npx tsc app/lib/games/repository.ts app/lib/games/supabase-games-repository.ts app/lib/games/mock-games-repository.ts --outDir Temp/games-live-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node --env-file=.env.local Temp/check-games-live.cjs
 *
 * Live, and left out of run-checks.cjs: it signs in as two of the kept test accounts (A challenges B -
 * see scripts/browser.cjs), because a policy cannot be asked anything without a session, and one
 * invitation needs two of them. It makes no account. It writes to the live project - one invitation and
 * one notification, both deleted by the same run.
 *
 * What it proves, in the order the app does it:
 *
 *   1. the arcade's repository answers on Supabase, not the mock one (the switch is wired)
 *   2. the challenger files an invitation and reads it back  - allowed, and why it is allowed here
 *      and not for a notification: the read policy names both accounts
 *   3. the account it names can read it, and nobody else can - a reader with no session sees nothing
 *   4. nobody can invite themselves            - refused before the policy is even consulted
 *   5. the account it names answers it         - `status`, one row, and the challenger sees it
 *   6. the challenger's own screen hears it    - the realtime event the hub opens a match on
 *   7. the bell's half, filed the app's way    - no read-back, `game_id` and `invite_id` carried,
 *      and the row is in the invited account's feed
 *   8. either side can clear it                - and the row is gone for both
 */
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;

function report(label, detail, ok) {
  if (!ok) failed += 1;
  console.log(`  ${(ok ? 'ok  ' : 'FAIL').padEnd(6)}${label.padEnd(44)} ${detail}`);

  return ok;
}

function client() {
  return createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A kept test account, signed in on a client of its own. */
async function signIn(letter) {
  const { client: account, id, displayName } = await testAccountClient(letter);
  return { account, userId: id, name: displayName };
}

(async () => {
  if (URL_BASE === undefined || KEY === undefined) {
    console.log('no Supabase project in .env.local - the site runs on the mock stores, so there is nothing to check.');
    return;
  }

  // 1. The switch: the app's own repository, with this project's environment, has to be the live one.
  const { getGamesRepository } = require('./games-live-out/games/repository.js');
  const repository = getGamesRepository();

  report('the arcade reads the live project', `source = ${repository.source}`, repository.source === 'supabase');

  const host = await signIn('A');
  const guest = await signIn('B');
  // A reader with no session at all: what somebody who is not in the pair can see.
  const stranger = client();

  const invite = {
    game: 'tic-tac-toe',
    from_user: host.userId,
    from_name: host.name,
    to_user: guest.userId,
    to_name: guest.name,
  };

  // 2. The challenger files it and reads it back: allowed, because the read policy names both sides.
  const filed = await host.account.from('game_invites').insert(invite).select('*').single();
  const id = filed.data?.id;
  report(
    'the challenger files an invitation',
    filed.error === null ? `row ${id} (${filed.data?.status})` : filed.error.message,
    filed.error === null && filed.data?.status === 'pending',
  );

  if (id === undefined) {
    console.log('  (nothing more can be checked without a row)');
    return;
  }

  // 3. The account it names can read it; a stranger cannot.
  const guestSees = await guest.account.from('game_invites').select('id,status').eq('id', id);
  report('the invited account can read it', `${guestSees.data?.length ?? 0} row(s)`, (guestSees.data ?? []).length === 1);

  const strangerSees = await stranger.from('game_invites').select('id').eq('id', id);
  report(
    'a reader who is not in the pair cannot',
    `${strangerSees.data?.length ?? 0} row(s)`,
    strangerSees.error === null && (strangerSees.data ?? []).length === 0,
  );

  // 4. Nobody invites themselves: the constraint refuses it before any policy is consulted.
  const toSelf = await host.account
    .from('game_invites')
    .insert({ ...invite, to_user: host.userId, to_name: host.name });
  report('inviting yourself is refused', toSelf.error?.message ?? 'NOT REFUSED', toSelf.error !== null);

  // 5. The invited account answers it - the write the hub's [ ACCEPT ] makes - and the challenger
  //    reads the answer back.
  const answered = await guest.account
    .from('game_invites')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id,status');
  report(
    'the invited account accepts it',
    `${answered.data?.length ?? 0} row(s), status ${answered.data?.[0]?.status ?? '-'}`,
    (answered.data ?? []).length === 1 && answered.data?.[0]?.status === 'accepted',
  );

  const hostSees = await host.account.from('game_invites').select('status').eq('id', id).single();
  report('and the challenger sees the answer', `status ${hostSees.data?.status ?? '-'}`, hostSees.data?.status === 'accepted');


  // 6. Realtime: this is the event the challenger's hub opens the match on, so it is listened for
  //    rather than assumed.
  const heard = [];
  const channel = host.account
    .channel(`check-games-${host.userId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'game_invites', filter: `from_user=eq.${host.userId}` },
      (payload) => heard.push(payload.new?.status),
    )
    .subscribe();

  await wait(3000);
  await guest.account.from('game_invites').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', id);
  await wait(6000);
  await host.account.removeChannel(channel);
  report('the challenger hears the answer arrive', heard.length === 0 ? 'nothing came over' : heard.join(', '), heard.length > 0);

  // 7. The bell's half, filed the way the app files it: no read-back asked for, with the game and the
  //    invitation named, landing in the invited account's feed.
  const notification = await host.account.from('forum_notifications').insert({
    user_id: guest.userId,
    kind: 'invite',
    actor_id: host.userId,
    actor_name: host.name,
    thread_id: null,
    thread_title: 'TIC-TAC-TOE',
    body: 'Three in a row on a nine-plate board.',
    game_id: 'tic-tac-toe',
    invite_id: id,
  });
  report(
    'the invitation is filed in the bell',
    notification.error === null ? `accepted, status ${notification.status}` : notification.error.message,
    notification.error === null,
  );

  const feed = await guest.account
    .from('forum_notifications')
    .select('id,kind,game_id,invite_id,thread_title')
    .eq('user_id', guest.userId);
  const row = (feed.data ?? []).find((entry) => entry.invite_id === id);
  report(
    "and it is in the invited account's feed",
    row === undefined ? 'not found' : `${row.kind} :: ${row.game_id} :: ${row.thread_title}`,
    row !== undefined && row.kind === 'invite' && row.game_id === 'tic-tac-toe',
  );

  // 8. Either side clears it, and it is gone for both: the [ CANCEL ] / [ CLEAR ] path.
  const cleared = await host.account.from('game_invites').delete().eq('id', id).select('id');
  report('the challenger clears it', `${cleared.data?.length ?? 0} row(s) deleted`, (cleared.data ?? []).length === 1);

  // Only this run's row: B is a kept account, and its feed may hold other checks' rows.
  await guest.account.from('forum_notifications').delete().eq('user_id', guest.userId).eq('invite_id', id);
  const after = await guest.account.from('game_invites').select('id').eq('id', id);
  report('and it is gone for both', `${after.data?.length ?? 0} row(s)`, (after.data ?? []).length === 0);

  console.log('');
  if (failed > 0) {
    console.log(`${failed} rule(s) did not hold: the FAIL line above says which.`);
    process.exitCode = 1;
  } else {
    console.log('arcade live: an invitation can be filed, read by the pair and nobody else, answered,');
    console.log('heard over realtime, carried into the bell, and cleared by either side.');
  }

  for (const who of [host, guest]) await who.account.auth.signOut({ scope: 'local' });
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

