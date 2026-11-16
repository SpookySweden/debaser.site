/*
 * Rooms' presence stays under Realtime's own limit (ROOMSYNC, list 4 item 3; Luke, 2026-11-16: "make it so the characters
 * stop popping in and out of existence when watching in a room together. it seems to correspond with the user also
 * dissapearing from the list of watchers").
 *   npx tsc app/lib/watch/presence-pace.ts app/lib/watch/supabase-watch-repository.ts --outDir Temp/presence-pace-check --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict --jsx react-jsx
 *   node Temp/check-presence-pace.cjs
 *
 * The cause, from the live Realtime logs: `ClientPresenceRateLimitReached` 171 times in a day. Supabase Realtime lets a
 * connection make 5 presence calls (track or untrack) per channel in 30 seconds and shuts the channel on the sixth
 * (supabase/realtime presence_handler.ex). A companion re-said its presence on the room's channel at every new spot,
 * mood or reaction, so the server shut the room's channel: that person left everybody's list of watchers, and their
 * companion vanished, until the room joined again.
 *
 * What it holds, on the real repository code (`supabase-watch-repository.ts`) against a stand-in Supabase client whose
 * server counts calls exactly as Realtime does:
 *   - a companion walking about in a room for five minutes never makes the server shut the room's channel, and the room
 *     still ends up hearing where it last stood;
 *   - the site-wide watching list (the TV keys) stays under the limit too, however fast the title changes, and ends on the
 *     newest title;
 *   - the pace itself: never more than its calls in a window, only the newest waiting call is sent, nothing after stop.
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const OUT = path.join(__dirname, 'presence-pace-check');

/* --- a clock the check moves by hand --------------------------------------------------------------------------- */
let now = Date.parse('2026-11-16T21:00:00Z');
const timers = [];
let timerId = 0;
const realSetImmediate = setImmediate;
global.setTimeout = (run, ms = 0) => {
  timerId += 1;
  timers.push({ id: timerId, at: now + Math.max(0, ms), run });
  return timerId;
};
global.clearTimeout = (id) => {
  const at = timers.findIndex((timer) => timer.id === id);
  if (at !== -1) timers.splice(at, 1);
};
global.setInterval = () => 0;
global.clearInterval = () => undefined;
Date.now = () => now;
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => realSetImmediate(resolve));
};
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    await settle();
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const next = timers[0];
    if (next === undefined || next.at > end) break;
    timers.shift();
    now = Math.max(now, next.at);
    next.run();
  }
  now = end;
  await settle();
}

/* --- Realtime, as far as presence calls go ---------------------------------------------------------------------- */
const MAX_CALLS = 5;
const WINDOW_MS = 30_000;
let calls = [];
let shut = [];
const limits = new Map();
function serverCounts(topic, kind, payload) {
  // supabase/realtime presence_handler.ex, limit_client_presence_event: a fixed window from the first counted call.
  const limit = limits.get(topic) ?? { counter: 0, resetAt: null };
  if (limit.resetAt === null || now > limit.resetAt) {
    limit.counter = 1;
    limit.resetAt = now + WINDOW_MS;
  } else if (limit.counter >= MAX_CALLS) {
    shut.push({ topic, at: now });
    limits.set(topic, limit);
    return;
  } else {
    limit.counter += 1;
  }
  limits.set(topic, limit);
  calls.push({ topic, kind, payload, at: now });
}
function fakeClient() {
  return {
    channel(topic) {
      const channel = {
        topic,
        on() {
          return channel;
        },
        subscribe(status) {
          setTimeout(() => status('SUBSCRIBED'), 50);
          return channel;
        },
        track(payload) {
          serverCounts(topic, 'track', payload);
          return Promise.resolve('ok');
        },
        untrack() {
          serverCounts(topic, 'untrack', null);
          return Promise.resolve('ok');
        },
        presenceState() {
          return {};
        },
      };
      return channel;
    },
    removeChannel() {
      return Promise.resolve('ok');
    },
    rpc() {
      return Promise.resolve({ data: new Date(now).toISOString(), error: null });
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange(listener) {
        listener('SIGNED_IN', { user: { id: 'u1' } });
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    realtime: { setAuth: () => Promise.resolve() },
  };
}
const client = fakeClient();
const load = Module._load;
Module._load = function (request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved.endsWith(path.join('supabase', 'client.js'))) return { getSupabaseBrowserClient: () => client };
  if (resolved.endsWith(path.join('watch', 'room-client.js'))) return { roomClient: () => client, guestClient: () => null, hasStoredGuest: () => false };
  return load.call(this, request, parent, isMain);
};

const { getSupabaseWatchRepository } = require(path.join(OUT, 'watch', 'supabase-watch-repository.js'));
const wire = require(path.join(OUT, 'companion', 'wire.js'));
const { presencePace } = require(path.join(OUT, 'watch', 'presence-pace.js'));

let passed = 0;
async function ok(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

/** A seeded dice, so a run is the same run every time. */
function dice(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

(async () => {
  const repository = getSupabaseWatchRepository();

  await ok('a companion walking about in a room for five minutes never gets the room\'s channel shut, and the room hears where it last stood', async () => {
    calls = [];
    shut = [];
    const membership = repository.joinRoom('room-1', { key: 'tab-1', userId: 'u1', guestId: null, name: 'TEST' }, () => undefined);
    await advance(1000);
    const roll = dice(7);
    let last = null;
    // A new spot, mood or reaction every 0.4 to 3 seconds, as a busy companion picks them.
    for (let step = 0; step < 300; step += 1) {
      last = { x: Math.round(roll() * 1000) / 1000, m: roll() < 0.7 ? 'walk' : 'stand', r: step, k: null, c: null, p: null };
      wire.sayCompanion(last);
      await advance(400 + Math.round(roll() * 2600));
    }
    await advance(40_000);
    const room = calls.filter((call) => call.topic === 'watch:room-1');
    assert.deepEqual(shut.filter((one) => one.topic === 'watch:room-1'), [], `the server shut the room's channel ${shut.length} times`);
    assert.ok(room.length >= 2, 'the room was told at all');
    assert.equal(room[room.length - 1].payload.companion.x, last.x, 'the room ends up hearing the newest spot');
    membership.leave();
  });

  await ok('the site-wide watching list stays under the limit however fast the title changes, and ends on the newest title', async () => {
    calls = [];
    shut = [];
    const off = repository.subscribeWatching(() => undefined);
    await advance(1000);
    for (let skip = 0; skip < 20; skip += 1) {
      repository.setWatching({ userId: 'u1', roomId: 'room-1', hostName: 'TEST', title: `VIDEO ${skip}`, hosting: true, unlisted: false });
      await advance(700);
    }
    await advance(60_000);
    const told = calls.filter((call) => call.topic === 'site-watching' || call.topic.includes('watching'));
    assert.deepEqual(shut, [], `the server shut a channel ${shut.length} times`);
    assert.ok(told.length > 0, 'the list was told');
    assert.equal(told[told.length - 1].payload.title, 'VIDEO 19', 'and it ends on the newest title');
    repository.setWatching(null);
    off();
  });

  await ok('the pace: never more than its calls in a window, only the newest waiting call is sent, nothing after stop', async () => {
    const sent = [];
    const clock = { now: () => now, later: (run, ms) => setTimeout(run, ms), cancel: (handle) => clearTimeout(handle) };
    const pace = presencePace(clock, 4, 32_000);
    for (let i = 0; i < 10; i += 1) pace.say(() => sent.push({ i, at: now }));
    assert.deepEqual(sent.map((one) => one.i), [0, 1, 2, 3], 'four go at once, the rest wait');
    await advance(1000);
    assert.deepEqual(sent.map((one) => one.i), [0, 1, 2, 3], 'nothing more inside the window');
    await advance(40_000);
    assert.deepEqual(sent.map((one) => one.i), [0, 1, 2, 3, 9], 'then only the newest waiting one, once the window allows');
    for (let a = 0; a < sent.length; a += 1) {
      const inWindow = sent.filter((one) => one.at >= sent[a].at && one.at < sent[a].at + 32_000);
      assert.ok(inWindow.length <= 4, 'never five in one window');
    }
    // The window full again, and one more waiting: stopped, it never goes.
    for (let i = 15; i < 20; i += 1) pace.say(() => sent.push({ i, at: now }));
    assert.ok(!sent.some((one) => one.i === 19), 'the fifth waits');
    pace.stop();
    await advance(60_000);
    assert.ok(!sent.some((one) => one.i === 19), 'nothing waiting goes after stop');
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
