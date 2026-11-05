/*
 * What a visitor with no session can do with the public key alone (the privacy plan's phase 0).
 *   node Temp/privacy-probe.cjs
 *
 * Live, against the real project. It prints counts and refused/allowed only, never a row's contents.
 * Signs in as the kept test accounts A and B. Its only lasting effect is on them: A's own presence stamp and A's
 * bio written back unchanged. One game invitation from A to B is made and deleted by the same run. The refused-write tests
 * send an empty id, so even an allowed insert stops at the database's not-null rule and writes nothing.
 */
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');
const { loadEnv, testAccountClient } = require('../scripts/browser.cjs');

loadEnv();
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSED = '42501';

let failures = 0;
function report(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` :: ${detail}`}`);
}
const stranger = () => createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/* --- wires --------------------------------------------------------------------------------------- */

/** Joins a topic; resolves to the status it settled on (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, or NO ANSWER). */
function join(client, topic, { isPrivate = false, on } = {}) {
  const channel = client.channel(topic, { config: { private: isPrivate, broadcast: { self: false } } });
  if (on) on(channel);
  const settled = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NO ANSWER'), 8000);
    channel.subscribe((status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  return { channel, settled };
}

/** Joins the way the site does: the private wire if it lets this account in, otherwise the public one. */
async function joinAsSite(client, topic, on) {
  const hidden = join(client, topic, { isPrivate: true, on });
  if ((await hidden.settled) === 'SUBSCRIBED') return { channel: hidden.channel, isPrivate: true };
  await client.removeChannel(hidden.channel);
  const open = join(client, topic, { on });
  await open.settled;
  return { channel: open.channel, isPrivate: false };
}

function presenceEntries(channel) {
  return Object.values(channel.presenceState()).flat();
}

/* --- parts --------------------------------------------------------------------------------------- */

async function fields(visitor) {
  console.log('\nProfile fields, signed out:');
  for (const column of ['banned_reason', 'banned_by', 'is_hidden', 'last_seen_at', 'is_online', 'updated_at', 'location', 'country_code']) {
    const { data, error } = await visitor.from('profiles').select(column).limit(1000);
    report(error?.code === REFUSED, `${column} cannot be read`, error === null ? `${(data ?? []).length} rows came back` : 'refused');
  }
  const all = await visitor.from('profiles').select('*').limit(1000);
  report(all.error?.code === REFUSED, 'a read of every column at once is refused', all.error === null ? `${(all.data ?? []).length} rows came back` : 'refused');

  const stamps = await visitor.from('profile_presence').select('user_id').limit(1000);
  report(stamps.error !== null || (stamps.data ?? []).length === 0, 'the presence stamps cannot be read', stamps.error === null ? `${(stamps.data ?? []).length} rows came back` : 'refused or not there');

  const open = await visitor.from('profiles').select('id, display_name, bio').limit(1000);
  report(open.error === null && (open.data ?? []).length > 0, 'names and bios still read (the board needs them)', open.error?.message ?? `${(open.data ?? []).length} rows`);
}

async function writes(visitor, a) {
  const doors = [
    ['forum_threads', 'author_id'],
    ['forum_comments', 'author_id'],
    ['profile_comments', 'author_id'],
    ['profile_tags', 'given_by'],
    ['music_tracks', 'uploaded_by'],
  ];
  for (const [label, client] of [['signed out', visitor], ['signed in, naming nobody', a.client]]) {
    console.log(`\nPosting with no author, ${label}:`);
    for (const [table, author] of doors) {
      // An empty id: `23502` means the row got past the rules and stopped at the not-null rule, so nothing is ever written.
      const { error } = await client.from(table).insert({ id: null, [author]: null });
      report(error?.code === REFUSED, `${table} refuses it`, error === null ? 'WRITTEN' : error.code === REFUSED ? 'refused by the rules' : `past the rules (${error.code})`);
    }
  }
}

async function functions(visitor) {
  console.log('\nFunctions, signed out:');
  const gone = {
    music_for_you: { people: 1 },
    music_mirror: undefined,
    record_profile_visit: { target: randomUUID() },
    room_canvas_readable: { canvas: randomUUID() },
    watch_take_over: { room: randomUUID(), gone_host: randomUUID() },
  };
  for (const [name, args] of Object.entries(gone)) {
    const { error } = await visitor.rpc(name, args);
    report(error?.code === REFUSED, `${name} is refused`, error === null ? 'answered' : error.code);
  }
  const kept = {
    watch_now: undefined,
    watch_close_stale: { room: randomUUID() },
    music_play_counts: { srcs: [] },
  };
  for (const [name, args] of Object.entries(kept)) {
    const { error } = await visitor.rpc(name, args);
    report(error === null, `${name} still answers (a page calls it signed out)`, error?.code ?? '');
  }
  const board = await visitor.from('forum_threads').select('id').limit(1);
  report(board.error === null, 'the board still reads signed out (its rule calls a helper function)', board.error?.code ?? '');
  const comms = await visitor.from('comms_members').select('thread_id').limit(1);
  report(comms.error === null && (comms.data ?? []).length === 0, 'comms answers nothing rather than an error', comms.error?.code ?? '0 rows');
}

// Presence only flows on a channel that asks for it, as the site's do.
const hearPresence = (channel) => channel.on('presence', { event: 'sync' }, () => undefined);

async function presenceWire(name, topic, visitorFactory, a, b, payload) {
  console.log(`\nThe ${name} wire:`);
  const seat = await joinAsSite(a.client, topic, hearPresence);
  report(seat.isPrivate, 'the signed-in side is on the private wire', seat.isPrivate ? '' : 'it is on the public one');
  await seat.channel.track(payload);

  const openEar = visitorFactory();
  const open = join(openEar, topic, { on: hearPresence });
  const openStatus = await open.settled;
  await wait(4000);
  const heard = presenceEntries(open.channel);
  report(!heard.some((meta) => meta.user_id === a.id), 'a signed-out listener on the open wire does not hear A', `${openStatus}, ${heard.length} people heard`);
  await openEar.removeChannel(open.channel);

  const hiddenEar = visitorFactory();
  const hidden = join(hiddenEar, topic, { isPrivate: true, on: hearPresence });
  const hiddenStatus = await hidden.settled;
  report(hiddenStatus !== 'SUBSCRIBED', 'a signed-out listener cannot join the private wire', hiddenStatus);
  await hiddenEar.removeChannel(hidden.channel);

  if (seat.isPrivate) {
    const friend = await joinAsSite(b.client, topic, hearPresence);
    await wait(4000);
    const friendHeard = presenceEntries(friend.channel);
    report(friend.isPrivate && friendHeard.some((meta) => meta.user_id === a.id), 'a signed-in account still hears A', `${friendHeard.length} people heard`);
    await b.client.removeChannel(friend.channel);
  }
  await a.client.removeChannel(seat.channel);
}

async function tableWire(a, b) {
  console.log('\nRow changes on the profile tables:');
  const events = [];
  const visitor = stranger();
  const channels = [];
  for (const table of ['profiles', 'profile_presence']) {
    const listen = visitor
      .channel(`probe-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        events.push({ table, id: payload.new?.id ?? payload.new?.user_id, keys: Object.keys(payload.new ?? {}) });
      });
    channels.push(listen);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 6000);
      listen.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        clearTimeout(timer);
        resolve();
      });
    });
  }
  let friendHeard = 0;
  const friend = b.client
    .channel('probe-friend')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_presence' }, (payload) => {
      if (payload.new?.user_id === a.id) friendHeard += 1;
    });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 6000);
    friend.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      clearTimeout(timer);
      resolve();
    });
  });
  await wait(3000);

  // A's heartbeat, the way the site stamps it.
  const moved = await a.client.from('profile_presence').upsert({ user_id: a.id, last_seen_at: new Date().toISOString(), is_online: true }, { onConflict: 'user_id' });
  const separate = moved.error === null;
  if (!separate) await a.client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', a.id);
  await wait(5000);
  const stamps = events.filter((event) => event.id === a.id).length;
  report(stamps === 0, "a signed-out listener does not hear A's heartbeat", `${stamps} events heard`);
  if (separate) report(friendHeard > 0, "a signed-in account still hears A's heartbeat", `${friendHeard} events`);

  // An ordinary edit (the bio written back unchanged): heard, but none of the private columns come with it.
  events.length = 0;
  const mine = await a.client.from('profiles').select('bio').eq('id', a.id).single();
  await a.client.from('profiles').update({ bio: mine.data.bio }).eq('id', a.id);
  await wait(5000);
  const leaked = new Set(events.flatMap((event) => event.keys).filter((key) => ['banned_reason', 'banned_by', 'is_hidden', 'last_seen_at', 'is_online', 'updated_at', 'location', 'country_code'].includes(key)));
  report(leaked.size === 0, 'a profile edit carries no private column to a signed-out listener', leaked.size === 0 ? `${events.length} events heard` : [...leaked].join(', '));

  for (const channel of channels) await visitor.removeChannel(channel);
  await b.client.removeChannel(friend);
}

async function editWire(a, b) {
  console.log('\nThe lore wire:');
  const topic = `lore:probe-${randomUUID()}`;
  const heard = [];
  const seat = await joinAsSite(a.client, topic, (channel) => channel.on('broadcast', { event: 'probe' }, ({ payload }) => heard.push(payload.from)));
  report(seat.isPrivate, 'an editor is on the private wire', seat.isPrivate ? '' : 'it is on the public one');

  for (const isPrivate of [false, true]) {
    const visitor = stranger();
    const seatOut = join(visitor, topic, { isPrivate });
    const status = await seatOut.settled;
    await seatOut.channel.send({ type: 'broadcast', event: 'probe', payload: { from: 'stranger' } });
    await wait(2500);
    if (isPrivate) report(status === 'SUBSCRIBED', 'a signed-out reader can still listen to the page', status);
    await visitor.removeChannel(seatOut.channel);
  }
  report(!heard.includes('stranger'), 'nothing a signed-out visitor sends reaches an editor', `${heard.filter((from) => from === 'stranger').length} messages arrived`);

  if (seat.isPrivate) {
    const friend = await joinAsSite(b.client, topic);
    await friend.channel.send({ type: 'broadcast', event: 'probe', payload: { from: 'friend' } });
    await wait(2500);
    report(heard.includes('friend'), 'another signed-in editor still reaches them');
    await b.client.removeChannel(friend.channel);
  }
  await a.client.removeChannel(seat.channel);
}

async function gameWire(a, b) {
  console.log('\nThe game wire:');
  const made = await a.client.from('game_invites').insert({ game: 'tic-tac-toe', from_user: a.id, from_name: a.displayName, to_user: b.id, to_name: b.displayName }).select('id').single();
  if (made.error !== null) {
    report(false, 'the test invitation was made', made.error.code);
    return;
  }
  const topic = `match:${made.data.id}`;
  const heard = [];
  const seat = await joinAsSite(a.client, topic, (channel) => channel.on('broadcast', { event: 'probe' }, ({ payload }) => heard.push(payload.from)));
  report(seat.isPrivate, 'a player is on the private wire', seat.isPrivate ? '' : 'it is on the public one');

  const visitor = stranger();
  const open = join(visitor, topic);
  await open.settled;
  await open.channel.send({ type: 'broadcast', event: 'probe', payload: { from: 'stranger' } });
  const hidden = join(stranger(), topic, { isPrivate: true });
  const hiddenStatus = await hidden.settled;
  await wait(2500);
  report(!heard.includes('stranger'), 'a signed-out visitor cannot reach the players');
  report(hiddenStatus !== 'SUBSCRIBED', 'a signed-out visitor cannot join the private wire', hiddenStatus);
  await visitor.removeChannel(open.channel);

  if (seat.isPrivate) {
    const other = await joinAsSite(b.client, topic);
    report(other.isPrivate, 'the other player can join');
    await other.channel.send({ type: 'broadcast', event: 'probe', payload: { from: 'other' } });
    await wait(2500);
    report(heard.includes('other'), 'and the two players hear each other');
    await b.client.removeChannel(other.channel);
  }
  await a.client.removeChannel(seat.channel);
  await a.client.from('game_invites').delete().eq('id', made.data.id);
}

async function roomWire(visitor) {
  console.log('\nA stream room wire:');
  const live = await visitor.from('watch_rooms').select('id').is('ended_at', null).limit(1);
  const ended = await visitor.from('watch_rooms').select('id').not('ended_at', 'is', null).limit(1);
  const liveId = live.data?.[0]?.id;
  const endedId = ended.data?.[0]?.id;
  if (endedId !== undefined) {
    const ear = stranger();
    const seat = join(ear, `watch:${endedId}`, { isPrivate: true });
    const status = await seat.settled;
    report(status !== 'SUBSCRIBED', 'an ended room has no private wire for a visitor', status);
    await ear.removeChannel(seat.channel);
  }
  if (liveId === undefined) {
    console.log('  ----  no room is live right now, so the live-room half was not tested');
    return;
  }
  // Open rooms stay open: a signed-out watcher is still in the room. Listening only, nothing is tracked.
  const ear = stranger();
  const seat = join(ear, `watch:${liveId}`, { isPrivate: true, on: hearPresence });
  const status = await seat.settled;
  report(status === 'SUBSCRIBED', 'a signed-out watcher can still join an open live room', status);
  await ear.removeChannel(seat.channel);
}

async function main() {
  const visitor = stranger();
  const a = await testAccountClient('A');
  const b = await testAccountClient('B');

  await fields(visitor);
  await writes(visitor, a);
  await functions(visitor);
  await presenceWire('who-is-online', 'site-presence', stranger, a, b, { user_id: a.id, state: 'active' });
  await presenceWire('who-is-watching', 'site-watching', stranger, a, b, { user_id: a.id, room_id: randomUUID(), host_name: '', title: '', hosting: false });
  await tableWire(a, b);
  await editWire(a, b);
  await gameWire(a, b);
  await roomWire(visitor);

  console.log(`\n${failures === 0 ? 'ALL HELD' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('the probe could not finish:', error.message);
  process.exit(2);
});
