/*
 * PERF (2026-11-17, Luke: "make it run better overall", items 4-6 of perf-plan.md): the Supabase stores ask the database less,
 * and still show every change. Compiled fresh on every run:
 *   npx tsc app/lib/audio/supabase-music-repository.ts app/lib/forum/supabase-repository.ts app/lib/profile/supabase-profile-repository.ts app/lib/comms/supabase-comms-repository.ts app/lib/supabase/client.ts --outDir Temp/perf-quiet-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-perf-quiet.cjs
 *
 * The Supabase client is faked at the module boundary (as check-comms-groups does), so the real store code runs and every
 * table read, storage listing and channel is counted. Held here:
 *   1. the music shelf lists its bucket once for several asks close together, and again after an upload or a minute;
 *   2. the forum board reads every post once for a burst of changes (it read once per change), still reads after the
 *      burst, and never after it is unsubscribed;
 *   3. presence changes a few seconds apart are read once (each stamp made every tab read the whole table);
 *   4. the inbox store says it is live only while its channel reports SUBSCRIBED.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = process.env.PERF_QUIET_OUT ? path.resolve(process.env.PERF_QUIET_OUT) : path.join(__dirname, 'perf-quiet-out');
/** `PERF_QUIET_ONLY=2` runs one part alone (to watch each fail on old code). */
const only = Number(process.env.PERF_QUIET_ONLY || 0);
const part = (n) => only === 0 || only === n;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A permissive fake of supabase-js: every query chain answers no rows; reads, storage listings and channels are counted. */
function makeClient() {
  const counts = { tables: {}, lists: 0, uploads: 0 };
  const channels = [];
  const chain = (table) => {
    counts.tables[table] = (counts.tables[table] ?? 0) + 1;
    const answer = { data: [], error: null, count: 0 };
    const proxy = new Proxy(function () {}, {
      get(_target, key) {
        if (key === 'then') return (resolve, reject) => Promise.resolve(answer).then(resolve, reject);
        if (key === 'single' || key === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
        return () => proxy;
      },
    });
    return proxy;
  };
  const client = {
    from: (table) => chain(table),
    rpc: (name) => chain(`rpc:${name}`),
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
    storage: {
      from: () => ({
        list: async () => {
          counts.lists += 1;
          return { data: [{ name: 'song.mp3', id: 'f1' }], error: null };
        },
        upload: async () => {
          counts.uploads += 1;
          return { data: {}, error: null };
        },
        getPublicUrl: (p) => ({ data: { publicUrl: `https://example.invalid/${p}` } }),
      }),
    },
    channel: (name) => {
      const made = { name, handlers: [], status: null, removed: false };
      const api = {
        on: (_kind, filter, handler) => {
          made.handlers.push({ table: filter && filter.table, handler });
          return api;
        },
        subscribe: (callback) => {
          made.status = callback ?? null;
          return api;
        },
        track: async () => undefined,
        untrack: async () => undefined,
        presenceState: () => ({}),
        send: async () => undefined,
      };
      made.api = api;
      channels.push(made);
      return api;
    },
    removeChannel: async (api) => {
      const found = channels.find((one) => one.api === api);
      if (found) found.removed = true;
    },
  };
  return { client, counts, channels, fire: (table) => channels.filter((c) => !c.removed).forEach((c) => c.handlers.filter((h) => h.table === table).forEach((h) => h.handler({}))) };
}

function load(fake) {
  const clientPath = require.resolve(path.join(OUT, 'supabase/client.js'));
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { getSupabaseBrowserClient: () => fake.client, isSupabaseConfigured: true, supabaseAuthStorageKey: () => null } };
  for (const key of Object.keys(require.cache)) if (key.startsWith(OUT) && key !== clientPath) delete require.cache[key];
  return {
    music: require(path.join(OUT, 'audio/supabase-music-repository.js')),
    forum: require(path.join(OUT, 'forum/supabase-repository.js')),
    profile: require(path.join(OUT, 'profile/supabase-profile-repository.js')),
    comms: require(path.join(OUT, 'comms/supabase-comms-repository.js')),
  };
}

(async () => {
  // 1. The music shelf.
  if (part(1)) {
    const fake = makeClient();
    const { music } = load(fake);
    const shelf = music.getSupabaseMusicRepository();
    await Promise.all([shelf.listTracks(), shelf.listTracks(), shelf.listTracks(), shelf.listTracks()]);
    assert.equal(fake.counts.lists, 1, `four parts of the page asking at once list the bucket once (listed ${fake.counts.lists} times)`);
    await shelf.listTracks();
    assert.equal(fake.counts.lists, 1, 'and an ask a moment later shares the same listing');
    assert.equal(fake.counts.tables.music_tracks >= 5, true, 'while the shelf table itself is still read on every ask (titles stay fresh)');
    const file = { name: 'song.mp3', type: 'audio/mpeg', size: 1000 };
    await shelf.uploadTrack({ title: 'A SONG', credit: '', uploaderId: 'u1', uploaderName: 'U', file }).catch(() => undefined);
    assert.equal(fake.counts.uploads, 1, 'the upload went to the bucket');
    await shelf.listTracks();
    assert.equal(fake.counts.lists, 2, 'after an upload the bucket is listed again, so the new song shows');
    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 1000;
    await shelf.listTracks();
    Date.now = realNow;
    assert.equal(fake.counts.lists, 3, 'and a minute on it is listed again');
    console.log('  ok  music shelf: one bucket listing for four asks; again after an upload or a minute');
  }

  // 2. The forum board.
  if (part(2)) {
    const fake = makeClient();
    const { forum } = load(fake);
    const board = forum.getSupabaseForumRepository();
    const heard = [];
    const stop = board.subscribe((threads) => heard.push(threads));
    const reads = () => fake.counts.tables.forum_threads ?? 0;
    const before = reads();
    for (let n = 0; n < 5; n += 1) {
      fake.fire('forum_threads');
      fake.fire('forum_comments');
    }
    await sleep(300);
    assert.equal(reads(), before, 'ten changes in a burst: nothing is read yet');
    await sleep(2200);
    assert.equal(reads() - before, 1, `ten changes in a burst read every post once (read ${reads() - before} times; it read once per change)`);
    assert.equal(heard.length, 1, 'and the board hears the fresh list');
    fake.fire('forum_comments');
    stop();
    await sleep(2500);
    assert.equal(reads() - before, 1, 'a change just before unsubscribing is not read after it');
    assert.equal(heard.length, 1, 'nor heard');
    console.log('  ok  forum board: a burst of ten changes is one read of every post, and nothing after unsubscribing');
  }

  // 3. Presence.
  if (part(3)) {
    const fake = makeClient();
    const { profile } = load(fake);
    const store = profile.getSupabaseProfileRepository();
    const heard = [];
    const stop = store.subscribePresence((records) => heard.push(records));
    const reads = () => fake.counts.tables.profile_presence ?? 0;
    const before = reads();
    for (let n = 0; n < 6; n += 1) fake.fire('profile_presence');
    await sleep(3400);
    assert.equal(reads() - before, 1, `six presence stamps close together are one read of the table (read ${reads() - before} times)`);
    assert.equal(heard.length, 1, 'and the lamps hear it');
    fake.fire('profile_presence');
    await sleep(3400);
    assert.equal(reads() - before, 2, 'a later stamp is read too');
    stop();
    console.log('  ok  presence: stamps a few seconds apart are read once, later ones still read');
  }

  // 4. The inbox store's live flag.
  if (part(4)) {
    const fake = makeClient();
    const { comms } = load(fake);
    const inbox = comms.getSupabaseCommsRepository();
    assert.equal(inbox.isLive(), false, 'not live before anything listens');
    const stop = inbox.subscribe(() => undefined);
    for (let n = 0; n < 20 && !fake.channels.some((c) => c.name === 'comms-inbox'); n += 1) await sleep(25);
    const channel = fake.channels.find((c) => c.name === 'comms-inbox');
    assert.ok(channel, 'the inbox channel opened');
    assert.equal(inbox.isLive(), false, 'not live until the channel says it joined');
    channel.status('SUBSCRIBED');
    assert.equal(inbox.isLive(), true, 'live once SUBSCRIBED (the timed read can slow to once a minute)');
    channel.status('CHANNEL_ERROR', new Error('dropped'));
    assert.equal(inbox.isLive(), false, 'not live after an error (back to the 15-second read)');
    channel.status('SUBSCRIBED');
    stop();
    assert.equal(inbox.isLive(), false, 'not live once nothing listens');
    console.log('  ok  inbox: live only while its channel is joined');
  }

  console.log('check-perf-quiet: all passed');
})().catch((failure) => {
  console.error(`check-perf-quiet FAILED: ${failure.message}`);
  process.exitCode = 1;
});
